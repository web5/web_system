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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from 'ssh2';
import { EnvironmentService } from '../environment/environment.service';
import { ServerService } from '../server/server.service';
import { HostsService } from '../hosts/hosts.service';
import { DeployHostEntity } from '../entities/deploy-host.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';

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
  /** 取数失败原因（SSH 不通 / 主机不可用…）；有值时页面顶部横幅用它提示真因 */
  error?: string;
  /** 所属主机组名（供表格「主机」列展示） */
  hostName?: string;
}

/**
 * 监控服务
 * 使用 ssh2 连接远程服务器，执行 pm2 命令和健康检查
 */
@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  /** 白名单：服务名（与 controller 的 SERVICE_RE 同规）与归一化后的 URL，拼进 shell 前校验 */
  private static readonly NAME_RE = /^[a-zA-Z0-9_-]+$/;
  private static readonly URL_RE = /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/;

  constructor(
    private readonly configService: ConfigService,
    private readonly environmentService: EnvironmentService,
    private readonly serverService: ServerService,
    private readonly hostsService: HostsService,
    @InjectRepository(DeployServiceEnvEntity)
    private readonly serviceEnvRepo: Repository<DeployServiceEnvEntity>,
  ) {}

  /**
   * 当前控制台实例标识（各份控制台 .env 的 CONSOLE_INSTANCE，**必配无默认值**）。
   * 缺失 = 系统错误：启动自检已 FATAL（ConsoleInstanceSelfCheck），此处再兜一道，
   * 避免运行期被改空后静默回落导致页签口径错乱。
   */
  private consoleInstance(): string {
    const v = (this.configService.get<string>('CONSOLE_INSTANCE') || '').trim();
    if (!v) {
      throw new BadGatewayException(
        'CONSOLE_INSTANCE 未配置：请在该控制台的 .env 写入实例标识（如 orchestrator / dev）后重启',
      );
    }
    return v;
  }

  /**
   * 当前控制台可管的环境（真相源 = 主机管理）。
   * 环境 E 可管 ⇔ 有 deploy_service_envs 指向 E ∧ 主机启用 ∧（managedBy 为空 ∨ 等于本实例）
   */
  async listMonitorEnvs(): Promise<Array<{ id: string; name: string }>> {
    const instance = this.consoleInstance();
    const allowed = new Set(await this.hostsService.listManagedEnvIds(instance));
    const rows = await this.environmentService.list();
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string }> = [];
    for (const e of rows) {
      if (!allowed.has(e.id) || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({ id: e.id, name: e.name || e.id });
    }
    return out;
  }

  /**
   * 解析某环境的目标：涉及的主机（去重、启用、按归属过滤）+ 服务×环境行（含解析出的地址）
   */
  private async resolveEnvTargets(env: string): Promise<{
    hosts: DeployHostEntity[];
    services: Array<{ serviceKey: string; hostName: string; port: number | null; address: string }>;
  }> {
    const instance = this.consoleInstance();
    const hosts = await this.hostsService.resolveEnvHosts(env, instance);
    if (!hosts.length) {
      throw new BadGatewayException(
        `环境 ${env} 在「主机管理」中没有可解析且归属本控制台的主机，请先在「基础设施 → 主机管理」登记`,
      );
    }
    const rows = await this.serviceEnvRepo.find({ where: { envId: env } });
    const addrByName = new Map(hosts.map((h) => [h.name, h.host]));
    const services = rows
      .filter((r) => !!r.hostName && addrByName.has(r.hostName))
      .map((r) => {
        const hostAddress = addrByName.get(r.hostName as string) as string;
        return {
          serviceKey: r.serviceKey,
          hostName: r.hostName as string,
          port: r.port ?? null,
          address: r.port ? `${hostAddress}:${r.port}` : hostAddress,
        };
      });
    return { hosts, services };
  }

  /**
   * 由主机行构造 SSH 配置（**私钥缺失一律显式报错**，不再静默 undefined）
   */
  private sshConfigFor(host: DeployHostEntity): SshConfig {
    let privateKeyPath = host.sshKeyPath || '~/.ssh/id_ed25519_servers';
    if (privateKeyPath.startsWith('~')) {
      privateKeyPath = privateKeyPath.replace(/^~/, process.env.HOME || '');
    }
    if (!fs.existsSync(privateKeyPath)) {
      throw new BadGatewayException(
        `主机 ${host.name}（${host.host}）的 SSH 私钥不存在：${privateKeyPath} —— 请把私钥放到控制台所在机或改「主机管理」的 sshKeyPath`,
      );
    }
    return {
      host: host.host,
      port: 22,
      username: host.sshUser,
      privateKey: fs.readFileSync(privateKeyPath),
    };
  }

  /**
   * 获取 SSH 配置（**走主机管理**：环境涉及的第一台主机）
   */
  private async getSshConfig(env: string): Promise<SshConfig> {
    const { hosts } = await this.resolveEnvTargets(env);
    return this.sshConfigFor(hosts[0]);
  }

  /**
   * 在某台主机上执行命令：**执行方式由主机管理登记的 `scope` 决定**
   * - `local` = 本机形态（编排者本机那种），走 execLocal，**不走 SSH**（本机通常没有 sshd）
   * - `cloud` / `container` = 走 SSH
   *
   * 注意：这不是"目标 IP 等不等于自己"的运行时探测（那条口径已被否决），
   * 而是主机管理里显式的业务登记 —— 与 release 侧 `env === 'local'` 同口径。
   */
  private execOnHost(host: DeployHostEntity, command: string, timeoutMs?: number): Promise<string> {
    if (host.scope === 'local') {
      try {
        return Promise.resolve(this.execLocal(command, timeoutMs ?? 10000));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return this.execSsh(this.sshConfigFor(host), command, timeoutMs);
  }

  /**
   * 通过 SSH 执行命令（Promise 封装）
   * 默认超时 10 秒；批量探活等远程侧并行较长的命令可放宽
   */
  private execSsh(
    sshConfig: SshConfig,
    command: string,
    timeoutMs: number = 10000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          client.end();
          reject(new BadGatewayException('SSH 连接超时'));
        }
      }, timeoutMs);

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
    // 本机形态的主机走本机执行（诊断页的「本机」与监控页的「本地」页签都依赖这条）
    const { hosts } = await this.resolveEnvTargets(env);
    if (hosts[0]?.scope === 'local') {
      return this.getLocalPm2List();
    }
    const sshConfig = this.sshConfigFor(hosts[0]);
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
   * 对各服务探测 `GET /health`（各后端服务已统一提供免鉴权端点，见
   * specs/backend-health-endpoint/design.md）。判活口径不变：只要能建立 HTTP 连接
   * （任意状态码）即视为在线 —— 未升级的服务 /health 会返回 404，仍按在线计。
   * 端口按环境不同：dev=6000系, prod=3000系（mcp-gateway 特例为 6006）
   *
   * 探活在**单条 SSH 会话内**完成（远程侧用 shell 后台任务并行），而非每个服务一条 SSH 连接：
   * 后者在模块较多时会超出 sshd 的 MaxStartups（默认 10:30:100），多余连接被丢弃 → 该服务被
   * 随机误判为「离线/timeout」。详见 specs/deploy-console/monitor-health-single-ssh.md
   */
  async healthCheck(env: string): Promise<HealthCheck[]> {
    // 服务 × 环境 → 主机组（deploy_hosts）+ 端口；探活在**该服务所在的那台主机**上发起
    const { hosts, services } = await this.resolveEnvTargets(env);

    // 归一化 URL 并白名单校验（地址来自 DB，拼进 shell 前必须校验）—— 沿用 PR #166 的安全口径
    const badAddress = new Set<string>();
    const byHost = new Map<string, typeof services>();
    for (const s of services) {
      const url = `http://${s.address}`;
      if (!s.port || !MonitorService.NAME_RE.test(s.serviceKey) || !MonitorService.URL_RE.test(url)) {
        badAddress.add(s.serviceKey);
        this.logger.warn(`服务 ${s.serviceKey} 的地址不合法，跳过探活: ${s.address}`);
        continue;
      }
      const list = byHost.get(s.hostName) || [];
      list.push(s);
      byHost.set(s.hostName, list);
    }

    const results: HealthCheck[] = [];
    // 不合法地址：不发起 SSH，直接标记（与「服务离线」「SSH 不通」区分开）
    for (const s of services) {
      if (!badAddress.has(s.serviceKey)) continue;
      results.push({
        service: s.serviceKey,
        address: s.address,
        hostName: s.hostName,
        status: 'down',
        response: 'bad-address',
      });
    }

    // 按主机归拢：**每台主机只建一条 SSH 连接**，一条命令把该主机上所有端口探完。
    // （踩坑：早期实现是"每个服务一条 SSH"，12 条并发握手会被 sshd 拒掉 → Connection lost before handshake）
    const perHost = [...byHost.entries()].map(async ([hostName, items]) => {
      const host = hosts.find((h) => h.name === hostName);
      if (!host) {
        for (const s of items) {
          results.push({
            service: s.serviceKey,
            address: s.address,
            hostName,
            status: 'down',
            response: 'timeout',
            error: `主机组 ${hostName} 不可用（未启用或不属于本控制台）`,
          });
        }
        return;
      }
      // 单条 SSH 会话：每个服务一个后台子任务，wait 等全部结束；
      // 子任务内先取结果再一次 printf 输出（< PIPE_BUF，避免并发写管道时行内交错）。
      // 探活目标先回环（命令就跑在这台机上，多数服务监听 127.0.0.1），000 再退到主机地址。
      const command = `${items
        .map(
          (s) =>
            `( r=$(curl -s -o /dev/null -w '%{http_code}:%{time_total}' --connect-timeout 3 --max-time 5 'http://127.0.0.1:${s.port}/health') || r=000:0; ` +
            `if [ "$r" = "000:0" ]; then r=$(curl -s -o /dev/null -w '%{http_code}:%{time_total}' --connect-timeout 3 --max-time 5 'http://${host.host}:${s.port}/health') || r=000:0; fi; ` +
            `printf '%s|%s\\n' '${s.serviceKey}' "$r" ) &`,
        )
        .join(' ')} wait`;
      let output: string;
      try {
        // 一次握手 + 远程侧并行（上界 ~10s：回环 + 主机地址两次尝试）+ 余量
        output = await this.execOnHost(host, command, 30000);
      } catch (e: any) {
        // 传输层故障：属「控制台连不上主机」，与「服务离线」区分开
        this.logger.error(`环境 ${env} 主机 ${hostName} 探活失败: ${e?.message || e}`);
        for (const s of items) {
          results.push({
            service: s.serviceKey,
            address: s.address,
            hostName,
            status: 'down',
            response: 'ssh-failed',
            error: (e as Error).message,
          });
        }
        return;
      }
      const parsed = this.parseProbeOutput(output);
      for (const s of items) {
        const raw = parsed.get(s.serviceKey);
        const row: HealthCheck = {
          service: s.serviceKey,
          address: s.address,
          hostName,
          status: 'down',
          response: raw ? undefined : 'no-result',
        };
        if (raw) {
          // 请求 /health：能拿到任何 HTTP 状态码说明端口在监听、服务进程存活；"000" 表示连接失败
          const [httpCode, responseTime] = raw.split(':');
          row.status = httpCode !== '000' ? 'up' : 'down';
          row.response = httpCode;
          row.responseTime = parseFloat(responseTime) * 1000; // 毫秒
        } else {
          row.error = `未取到探活结果（主机 ${host.host}）`;
        }
        results.push(row);
      }
    });

    await Promise.all(perHost);
    return results;
  }

  /** 解析批量探活输出（每行 `name|httpCode:timeTotal`） */
  private parseProbeOutput(output: string): Map<string, string> {
    const parsed = new Map<string, string>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf('|');
      if (idx <= 0) continue;
      parsed.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
    }
    return parsed;
  }

  /** 全部地址均不合法时的兜底结果（不发起 SSH） */
  private buildBadAddressResults(
    services: Array<{ name: string; address: string }>,
    badAddress: Set<string>,
  ): HealthCheck[] {
    return services.map((s) => ({
      service: s.name,
      address: s.address,
      status: 'down' as const,
      response: badAddress.has(s.name) ? 'bad-address' : 'no-address',
    }));
  }

  /**
   * PM2 进程（**按主机分组**）：环境内主机去重 → 逐台取 → 分组返回。
   * 单台失败不影响其它主机：失败组仍返回，带 error（页面据此显示分组 Alert 与顶部横幅）。
   */
  async getPm2ByHost(env: string): Promise<
    Array<{
      name: string;
      host: string;
      scope: string;
      runtime: string;
      ok: boolean;
      error?: string;
      tookMs: number;
      procs: Pm2Process[];
    }>
  > {
    const { hosts } = await this.resolveEnvTargets(env);
    const groups = hosts.map(async (host) => {
      const started = Date.now();
      const group = {
        name: host.name,
        host: host.host,
        scope: host.scope,
        runtime: host.runtime,
        ok: false,
        error: undefined as string | undefined,
        tookMs: 0,
        procs: [] as Pm2Process[],
      };
      try {
        const output = await this.execOnHost(host, 'pm2 jlist');
        const rawList = JSON.parse(output.trim()) as RawPm2Process[];
        group.procs = rawList.map((p) => this.toPm2Process(p));
        group.ok = true;
      } catch (e) {
        group.error = (e as Error).message || String(e);
      } finally {
        group.tookMs = Date.now() - started;
      }
      return group;
    });
    return Promise.all(groups);
  }

  /**
   * 拉取远程 PM2 日志
   * 执行 tail -n <lines> 获取指定服务的最近日志
   */
  async getLogs(
    env: string,
    service: string,
    lines: number = 100,
    keyword?: string,
  ): Promise<{ service: string; logs: string[]; matched?: number }> {
    const sshConfig = await this.getSshConfig(env);

    // 获取 pm2 日志路径
    const command = `pm2 logs ${service} --lines ${lines} --nostream --raw 2>/dev/null || echo "无日志"`;
    const output = await this.execSsh(sshConfig, command);

    // 按行分割日志；keyword 在**结果侧**过滤（不进命令，杜绝命令注入）
    const all = output.trim().split('\n').filter(Boolean);
    const kw = keyword?.trim().toLowerCase();
    const logs = kw ? all.filter((l) => l.toLowerCase().includes(kw)) : all;

    return { service, logs, matched: kw ? logs.length : undefined };
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
        const command = `curl -s -o /dev/null -w "%{http_code}:%{time_total}" --connect-timeout 3 --max-time 5 http://${address}/health || echo "000:0"`;
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
  async getLocalLogs(
    service: string,
    lines = 100,
    keyword?: string,
  ): Promise<{ service: string; logs: string[]; matched?: number }> {
    const output = this.execLocal(
      `pm2 logs ${service} --lines ${lines} --nostream --raw 2>/dev/null || echo "无日志"`,
    );
    const all = output.trim().split('\n').filter(Boolean);
    const kw = keyword?.trim().toLowerCase();
    const logs = kw ? all.filter((l) => l.toLowerCase().includes(kw)) : all;
    return { service, logs, matched: kw ? logs.length : undefined };
  }

  // ===== 自助诊断操作（任务 23）：进程重启 / 端口占用检测 =====

  /** 重启远程服务（pm2 restart；输出尾部便于页面直接展示） */
  async restartPm2(env: string, service: string): Promise<{ service: string; output: string }> {
    const sshConfig = await this.getSshConfig(env);
    const output = await this.execSsh(sshConfig, `pm2 restart ${service} 2>&1 | tail -20`);
    return { service, output: output.trim() };
  }

  /** 重启本机服务（pm2 restart） */
  restartLocalPm2(service: string): { service: string; output: string } {
    const output = this.execLocal(`pm2 restart ${service} 2>&1 | tail -20`);
    return { service, output: output.trim() };
  }

  /** 解析端口占用检测输出（lsof LISTEN 行）为结构化结果 */
  private parsePortLines(port: number, output: string): { port: number; occupied: boolean; lines: string[] } {
    const lines = output
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const occupied = !lines.some((l) => l.includes('__NONE__'));
    return { port, occupied, lines: occupied ? lines : [] };
  }

  /** 远程端口占用检测（lsof LISTEN；无结果/命令缺失均按未占用处理，诊断尽力而为） */
  async checkPort(env: string, port: number): Promise<{ port: number; occupied: boolean; lines: string[] }> {
    const sshConfig = await this.getSshConfig(env);
    const output = await this.execSsh(
      sshConfig,
      `lsof -iTCP:${port} -sTCP:LISTEN -P -n 2>/dev/null || echo "__NONE__"`,
    );
    return this.parsePortLines(port, output);
  }

  /** 本机端口占用检测 */
  checkLocalPort(port: number): { port: number; occupied: boolean; lines: string[] } {
    const output = this.execLocal(
      `lsof -iTCP:${port} -sTCP:LISTEN -P -n 2>/dev/null || echo "__NONE__"`,
    );
    return this.parsePortLines(port, output);
  }
}
