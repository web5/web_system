import {
  Injectable,
  Logger,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Client } from 'ssh2';
import { EnvironmentService } from '../environment/environment.service';
import { ServerService } from '../server/server.service';

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
 * pm2 jlist 原始 JSON 结构（仅声明实际使用的字段，避免 any）
 */
interface RawPm2Process {
  name: string;
  pid?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    PORT?: number;
  };
  monit?: {
    cpu?: number;
    memory?: number;
  };
}

/**
 * 健康检查结果
 */
export interface HealthCheck {
  service: string;
  address: string;
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
    private readonly serverService: ServerService,
  ) {}

  /**
   * 获取 SSH 配置（读环境默认服务器 serverName = <env>-default）
   */
  private async getSshConfig(env: string): Promise<SshConfig> {
    const srv = await this.serverService.resolveEnvDefaultServer(env);
    if (!srv) {
      throw new BadGatewayException(`环境 ${env} 无默认服务器，请先在「服务器管理」中配置`);
    }
    let privateKeyPath = srv.sshKeyPath || '~/.ssh/id_ed25519_servers';
    if (privateKeyPath.startsWith('~')) {
      privateKeyPath = privateKeyPath.replace(/^~/, process.env.HOME || '');
    }
    let privateKey: Buffer | undefined;
    if (fs.existsSync(privateKeyPath)) {
      privateKey = fs.readFileSync(privateKeyPath);
    }
    return {
      host: srv.host,
      port: 22,
      username: srv.sshUser,
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

    let rawList: RawPm2Process[];
    try {
      rawList = JSON.parse(output.trim()) as RawPm2Process[];
    } catch {
      throw new BadGatewayException('解析 pm2 jlist 输出失败');
    }

    // 转换为结构化数据
    return rawList.map((proc) => this.toPm2Process(proc));
  }

  /**
   * 健康检查
   * 对各服务端口做连通性探测：只要能建立 HTTP 连接（任意状态码）即视为在线，
   * 不再依赖各服务是否实现 /health 端点（仅 gateway 有，其他服务 404/302 会被误判为离线）。
   * 端口按环境不同：dev=6000系, prod=3000系（mcp-gateway 特例为 6006）
   */
  async healthCheck(env: string): Promise<HealthCheck[]> {
    const sshConfig = await this.getSshConfig(env);

    // 服务地址从 DB 环境表的 ports 映射读取（完整 host:port 或域名）
    const envEntity = await this.environmentService.get(env);
    const ports = envEntity.ports || {};
    const services: Array<{ name: string; address: string }> = Object.entries(ports)
      .filter(([, addr]) => !!addr && addr.trim())
      .map(([name, address]) => ({ name, address: address.trim() }));

    const results: HealthCheck[] = [];

    // 并行执行各服务健康检查
    const checks = services.map(async (service) => {
      // 规范化 URL：含 // 视为已含协议；否则补 http://
      const url = service.address.includes('://')
        ? service.address.replace(/\/$/, '')
        : `http://${service.address.replace(/\/$/, '')}`;
      // 请求根路径：能拿到任何 HTTP 状态码说明端口在监听、服务进程存活；"000" 表示连接失败
      const command = `curl -s -o /dev/null -w "%{http_code}:%{time_total}" --connect-timeout 3 ${url}/ || echo "000:0"`;
      try {
        const output = await this.execSsh(sshConfig, command);
        const [httpCode, responseTime] = output.trim().split(':');
        const isUp = httpCode !== '000';
        results.push({
          service: service.name,
          address: service.address,
          status: isUp ? 'up' : 'down',
          response: httpCode,
          responseTime: parseFloat(responseTime) * 1000, // 转换为毫秒
        });
      } catch {
        results.push({
          service: service.name,
          address: service.address,
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

  // ===== 以下为本机（deploy-console 运行主机）监控，不走 SSH =====

  /**
   * 本机执行命令（Promise 封装，超时 10s）
   * 复用于本机 pm2 进程查询/探活/日志；pm2 退出码非零时若仍有 stdout 也返回
   */
  private execLocal(command: string, timeoutMs = 10000): string {
    try {
      return execSync(command, { timeout: timeoutMs, encoding: 'utf8' }).toString();
    } catch (e: any) {
      if (e?.stdout) return e.stdout.toString();
      throw new BadGatewayException(`本机命令执行失败: ${e?.message || e}`);
    }
  }

  /**
   * 获取本机 PM2 进程列表（在 deploy-console 运行主机直接执行 pm2 jlist）
   */
  async getLocalPm2List(): Promise<Pm2Process[]> {
    let rawList: RawPm2Process[];
    try {
      rawList = JSON.parse(this.execLocal('pm2 jlist').trim()) as RawPm2Process[];
    } catch {
      throw new BadGatewayException('解析本机 pm2 jlist 输出失败');
    }
    return rawList.map((proc) => this.toPm2Process(proc));
  }

  /**
   * 将 pm2 jlist 原始进程转换为结构化 Pm2Process（本地/远端共用，消除两份漂移代码）
   */
  private toPm2Process(proc: RawPm2Process): Pm2Process {
    return {
      name: proc.name,
      pid: proc.pid || 0,
      status: proc.pm2_env?.status || 'unknown',
      cpu: proc.monit?.cpu || 0,
      memory: proc.monit?.memory || 0,
      uptime: proc.pm2_env?.pm_uptime || 0,
      restarts: proc.pm2_env?.restart_time || 0,
      port: proc.pm2_env?.PORT || undefined,
    };
  }

  /**
   * 本机服务健康检查：对本机 pm2 进程暴露的端口做连通性探测
   */
  async getLocalHealth(): Promise<HealthCheck[]> {
    const procs = await this.getLocalPm2List();
    const checks = procs
      .filter((p) => p.port)
      .map(async (p): Promise<HealthCheck> => {
        const address = `127.0.0.1:${p.port}`;
        const command = `curl -s -o /dev/null -w "%{http_code}:%{time_total}" --connect-timeout 3 http://${address}/ || echo "000:0"`;
        try {
          const output = this.execLocal(command);
          const [httpCode, responseTime] = output.trim().split(':');
          return {
            service: p.name,
            address,
            status: httpCode !== '000' ? 'up' : 'down',
            response: httpCode,
            responseTime: parseFloat(responseTime) * 1000,
          } as HealthCheck;
        } catch {
          return { service: p.name, address, status: 'down', response: 'timeout' };
        }
      });
    return Promise.all(checks);
  }

  /**
   * 拉取本机 PM2 日志
   */
  async getLocalLogs(service: string, lines = 100): Promise<{ service: string; logs: string[] }> {
    const output = this.execLocal(
      `pm2 logs ${service} --lines ${lines} --nostream --raw 2>/dev/null || echo "无日志"`,
    );
    return { service, logs: output.trim().split('\n').filter(Boolean) };
  }
}
