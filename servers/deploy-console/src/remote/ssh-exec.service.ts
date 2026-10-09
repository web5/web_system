import { Injectable, BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'ssh2';
import * as fs from 'fs';
import { HostsService } from '../hosts/hosts.service';
import { ServerService } from '../server/server.service';
import { redactSecrets } from '../common/redact';

/**
 * SSH 目标机解析 + 远程执行（诊断 #15 收敛点之一）。
 *
 * 此前**同一份「环境 → 目标机 + 私钥」的解析逻辑有三份**：`deploy.service.getSshConfig`、
 * `monitor.service.getSshConfig`，以及新增能力时又会抄第三遍。三份逻辑一旦漂移，
 * 后果是「投递到没人读的目录」或「连错机器」。这里收敛成唯一实现，
 * `DeployService.getSshConfig` 已改为委托本服务（行为不变）。
 *
 * 执行侧统一带**硬超时 + 主动终止**（诊断 #11 的同一原则：远端挂住不能让调用方永久等待）。
 */

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  privateKey: Buffer;
}

export const DEFAULT_SSH_KEY_PATH = '~/.ssh/id_ed25519_servers';
export const DEFAULT_SSH_EXEC_TIMEOUT_MS = 10 * 60 * 1000;

@Injectable()
export class SshExecService {
  private readonly logger = new Logger(SshExecService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly hostsService: HostsService,
    private readonly serverService: ServerService,
  ) {}

  /** 默认私钥路径（供错误提示与测试复用） */
  private keyPath(explicit?: string): string {
    const raw = explicit || DEFAULT_SSH_KEY_PATH;
    return raw.startsWith('~') ? raw.replace(/^~/, process.env.HOME || '') : raw;
  }

  /**
   * 解析环境的 SSH 目标机：主机管理（deploy_hosts）优先，未登记回落服务器管理
   * （`<env>-default`），都没有则抛错 —— **不静默用默认机**（诊断 #15）。
   */
  async resolve(env: string): Promise<SshTarget> {
    let host: string;
    let sshUser: string;
    let sshKeyPath: string | undefined;

    const h = (await this.hostsService.resolveEnvHosts(env))[0] ?? null;
    if (h) {
      host = h.host;
      sshUser = h.sshUser;
      sshKeyPath = h.sshKeyPath || undefined;
    } else {
      const srv = await this.serverService.resolveEnvDefaultServer(env);
      if (!srv) {
        throw new BadGatewayException(
          `环境 ${env} 无可用主机：请先在「基础设施 → 主机管理」登记，或在「服务器管理」配置 <env>-default`,
        );
      }
      host = srv.host;
      sshUser = srv.sshUser;
      sshKeyPath = srv.sshKeyPath || undefined;
      this.logger.warn(
        `环境 ${env} 未在「主机管理」登记，回落到服务器管理默认机 ${host} —— 请在主机管理补登记以消除歧义`,
      );
    }

    const privateKeyPath = this.keyPath(sshKeyPath);
    if (!fs.existsSync(privateKeyPath)) {
      throw new BadGatewayException(
        `环境 ${env} 的 SSH 私钥不存在：${privateKeyPath} —— 请把私钥放到控制台所在机，或改「主机管理」的 sshKeyPath`,
      );
    }
    return { host, port: 22, username: sshUser, privateKey: fs.readFileSync(privateKeyPath) };
  }

  /**
   * 在目标机执行一条命令；非 0 退出码即失败，超时则发信号终止后断连。
   * 输出与错误消息统一脱敏（诊断 #8）。
   */
  async run(env: string, cmd: string, tag = env, timeoutMs?: number): Promise<string> {
    const cfg = await this.resolve(env);
    const limit =
      timeoutMs ??
      (Number(this.configService.get<string>('SSH_EXEC_TIMEOUT_MS')) || DEFAULT_SSH_EXEC_TIMEOUT_MS);

    return new Promise<string>((resolve, reject) => {
      const client = new Client();
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (err?: Error, out?: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          client.end();
        } catch {
          /* ignore */
        }
        err ? reject(err) : resolve(out || '');
      };

      client.on('ready', () => {
        client.exec(cmd, (err, stream) => {
          if (err) return done(new Error(`远程执行失败: ${err.message}`));
          timer = setTimeout(() => {
            try {
              (stream as unknown as { signal?: (s: string) => void }).signal?.('KILL');
            } catch {
              /* 远端不支持 signal 也要断连 */
            }
            try {
              stream.close();
            } catch {
              /* ignore */
            }
            done(new Error(`远程命令执行超时（${limit}ms，${tag}）`));
          }, limit);

          let out = '';
          let errOut = '';
          stream.on('data', (d: Buffer) => {
            out += d.toString();
          });
          stream.stderr.on('data', (d: Buffer) => {
            errOut += d.toString();
          });
          stream.on('close', (code: number) => {
            if (code !== 0) {
              return done(new Error(`远程命令退出码 ${code}: ${redactSecrets((errOut || out).trim())}`));
            }
            if (errOut.trim()) {
              this.logger.warn(`[${tag}] 远程 stderr: ${redactSecrets(errOut.trim())}`);
            }
            done(undefined, redactSecrets(out));
          });
        });
      });
      client.on('error', (e: Error) => done(new Error(`SSH 连接失败: ${e.message}`)));
      client.on('timeout', () => done(new Error('SSH 连接超时')));
      client.connect({ ...cfg, readyTimeout: 15000 });
    });
  }
}
