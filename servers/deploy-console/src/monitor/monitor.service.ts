import {
  Injectable,
  Logger,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'ssh2';
import { EnvironmentService } from '../environment/environment.service';

/**
 * SSH 连接配置
 */
interface SshConfig {
  host: string;
  port: number;
  username: string;
  privateKey?: Buffer;
}

/**
 * PM2 进程信息
 */
export interface Pm2Process {
  name: string;
  pid: number;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  port?: number;
}

/**
 * 健康检查结果
 */
export interface HealthCheck {
  service: string;
  port: number;
  status: 'up' | 'down';
  response?: string;
  responseTime?: number;
}

/**
 * 监控服务
 * 使用 ssh2 连接远程服务器，执行 pm2 命令和健康检查
 */
@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly environmentService: EnvironmentService,
  ) {}

  /**
   * 获取 SSH 配置（从 DB 环境表读取，支持任意环境 ID）
   */
  private async getSshConfig(env: string): Promise<SshConfig> {
    const envEntity = await this.environmentService.get(env);
    let privateKeyPath = envEntity.sshKeyPath || '~/.ssh/id_ed25519_servers';
    if (privateKeyPath.startsWith('~')) {
      privateKeyPath = privateKeyPath.replace(/^~/, process.env.HOME || '');
    }
    let privateKey: Buffer | undefined;
    if (fs.existsSync(privateKeyPath)) {
      privateKey = fs.readFileSync(privateKeyPath);
    }
    return {
      host: envEntity.host,
      port: 22,
      username: envEntity.sshUser,
      privateKey,
    };
  }

  /**
   * 通过 SSH 执行命令（Promise 封装）
   * 超时 10 秒
   */
  private execSsh(sshConfig: SshConfig, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          client.end();
          reject(new BadGatewayException('SSH 连接超时'));
        }
      }, 10000);

      client.on('ready', () => {
        client.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            if (!isResolved) {
              isResolved = true;
              client.end();
              reject(new BadGatewayException(`SSH 执行失败: ${err.message}`));
            }
            return;
          }

          let output = '';
          let stderr = '';

          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on('close', () => {
            clearTimeout(timeout);
            client.end();
            if (!isResolved) {
              isResolved = true;
              resolve(output);
            }
          });
        });
      });

      client.on('error', (err: Error) => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;
          reject(new BadGatewayException(`SSH 连接失败: ${err.message}`));
        }
      });

      client.connect({
        ...sshConfig,
        readyTimeout: 10000,
      });
    });
  }

  /**
   * 获取 PM2 进程列表
   * 执行 pm2 jlist 获取 JSON 格式的进程列表
   */
  async getPm2List(env: string): Promise<Pm2Process[]> {
    const sshConfig = await this.getSshConfig(env);
    const output = await this.execSsh(sshConfig, 'pm2 jlist');

    let rawList: any[];
    try {
      rawList = JSON.parse(output.trim());
    } catch {
      throw new BadGatewayException('解析 pm2 jlist 输出失败');
    }

    // 转换为结构化数据
    return rawList.map((proc: any) => ({
      name: proc.name,
      pid: proc.pid || 0,
      status: proc.pm2_env?.status || 'unknown',
      cpu: proc.monit?.cpu || 0,
      memory: proc.monit?.memory || 0,
      uptime: proc.pm2_env?.pm_uptime || 0,
      restarts: proc.pm2_env?.restart_time || 0,
      port: proc.pm2_env?.PORT || undefined,
    }));
  }

  /**
   * 健康检查
   * 对各服务端口做连通性探测：只要能建立 HTTP 连接（任意状态码）即视为在线，
   * 不再依赖各服务是否实现 /health 端点（仅 gateway 有，其他服务 404/302 会被误判为离线）。
   * 端口按环境不同：dev=6000系, prod=3000系（mcp-gateway 特例为 6006）
   */
  async healthCheck(env: string): Promise<HealthCheck[]> {
    const sshConfig = await this.getSshConfig(env);

    // 端口从 DB 环境表的 ports 映射读取（实现「不同环境指向不同端口」）
    const envEntity = await this.environmentService.get(env);
    const ports = envEntity.ports || {};
    const services: Array<{ name: string; port: number }> = Object.entries(ports).map(
      ([name, port]) => ({ name, port }),
    );

    const results: HealthCheck[] = [];

    // 并行执行各服务健康检查
    const checks = services.map(async (service) => {
      // 请求根路径：能拿到任何 HTTP 状态码说明端口在监听、服务进程存活；"000" 表示连接失败
      const command = `curl -s -o /dev/null -w "%{http_code}:%{time_total}" --connect-timeout 3 http://localhost:${service.port}/ || echo "000:0"`;
      try {
        const output = await this.execSsh(sshConfig, command);
        const [httpCode, responseTime] = output.trim().split(':');
        const isUp = httpCode !== '000';
        results.push({
          service: service.name,
          port: service.port,
          status: isUp ? 'up' : 'down',
          response: httpCode,
          responseTime: parseFloat(responseTime) * 1000, // 转换为毫秒
        });
      } catch {
        results.push({
          service: service.name,
          port: service.port,
          status: 'down',
          response: 'timeout',
        });
      }
    });

    await Promise.all(checks);
    return results;
  }

  /**
   * 拉取远程 PM2 日志
   * 执行 tail -n <lines> 获取指定服务的最近日志
   */
  async getLogs(env: string, service: string, lines: number = 100): Promise<{ service: string; logs: string[] }> {
    const sshConfig = await this.getSshConfig(env);

    // 获取 pm2 日志路径
    const command = `pm2 logs ${service} --lines ${lines} --nostream --raw 2>/dev/null || echo "无日志"`;
    const output = await this.execSsh(sshConfig, command);

    // 按行分割日志
    const logs = output.trim().split('\n').filter(Boolean);

    return { service, logs };
  }
}
