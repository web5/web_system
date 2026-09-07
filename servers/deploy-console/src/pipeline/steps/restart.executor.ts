import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { Pm2ProbeService } from '../../pm2/pm2-probe.service';
import { CommandService } from '../../shell/command.service';
// 配置中心服务（发布/重启时按 global→env→module 合并并强制覆盖注入进程环境）
import { ConfigService as ConfigCenterService } from '../../config/config.service';
import { StepContext } from './step.types';
import { readFile, writeFile, chmod } from 'fs/promises';
import { join } from 'path';

/**
 * restart 内置步骤执行体（category=deploy，后端服务重启）。
 * pm2 restart 前先 jlist 确认实际存在的服务名（restart 对不存在进程报错但退出码可能是 0）。
 */
@Injectable()
export class RestartExecutor {
  private readonly logger = new Logger(RestartExecutor.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly pm2Probe: Pm2ProbeService,
    private readonly command: CommandService,
    private readonly configs: ConfigCenterService,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage(`重启服务: ${p.moduleKey}`);
    const mod = await this.moduleRegistry.get(p.moduleKey);

    // pm2 restart 对不存在的进程报错但退出码可能是 0，不能依赖退出码判断。
    let names: string[] = [];
    try {
      const exists = new Set(this.pm2Probe.listProcesses().map((a) => a.name));
      names = this.pm2Probe.resolvePm2Names(p.moduleKey, mod?.pm2).filter((n) => exists.has(n));
    } catch {
      // jlist 失败时退回顺序尝试
      names = this.pm2Probe.resolvePm2Names(p.moduleKey, mod?.pm2);
    }
    if (names.length === 0) {
      throw new Error(
        `pm2 中未找到服务（尝试 ${this.pm2Probe
          .resolvePm2Names(p.moduleKey, mod?.pm2)
          .join(' / ')}），请确认服务已用 pm2 纳管`,
      );
    }

    const restarted = names[0];
    // 配置中心注入：强制覆盖进程环境（历史 `PORT=6200` 污染的对策，端口以配置中心为准）
    const injectEnv = await this.resolveInjectEnv(p, ctx);
    const ws =
      this.configService.get<string>('RELEASE_WORKSPACE') || '/Users/geekwen/web_system_release';

    // ---- 端口孤儿清理（铁律，参考 deploy-local.sh / publish-ai-agent.sh）----
    // restart 前确保目标端口占用者 == pm2 当前 pid；否则 kill 残留孤儿进程，避免新进程
    // EADDRINUSE 崩溃、对外仍是旧实例（如 ai-agent 6010 端口被旧孤儿抢占，发布不生效）。
    //
    // ⚠️ 防自杀护栏（2026-09-07 根因修复）：历史上 pm2_env.PORT 被污染（如 ai-agent 误存
    // PORT=6200）时，会把 6200 的真正占用者——正在执行流水线的 deploy-console 自己——误判为
    // "孤儿" kill -9 掉，导致发布卡死在 restart 阶段。因此：
    //   1) 只清理"非 pm2 纳管"的占用者（真孤儿/僵尸），pm2 里的服务一律不杀；
    //   2) 端口取"配置中心注入值 → pm2_env.PORT"两级，前者优先（配置中心是权威）；
    //   3) 若目标端口被其它 pm2 服务占用 → 记录告警（疑似 PORT 污染/冲突），不再自杀。
    const pm2Pids = new Set(
      this.pm2Probe
        .listProcesses()
        .map((a) => (a.pid != null ? String(a.pid) : ''))
        .filter(Boolean),
    );
    const app = this.pm2Probe.listProcesses().find((a) => a.name === restarted);
    const port = injectEnv.PORT ?? app?.pm2_env?.PORT;
    if (port != null) {
      const occupiers = this.command
        .exec(`lsof -tiTCP:${port} -sTCP:LISTEN`, ws, {}, 15_000)
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const orphans = occupiers.filter((occ) => !pm2Pids.has(occ));
      for (const occ of orphans) {
        this.command.exec(`kill -9 ${occ}`, ws, {}, 15_000);
        ctx.log(`清理端口 ${port} 孤儿进程 ${occ}（非 pm2 纳管）`);
      }
      const managedConflicts = occupiers.filter(
        (occ) => pm2Pids.has(occ) && occ !== String(app?.pid ?? ''),
      );
      if (managedConflicts.length) {
        ctx.log(
          `⚠️ 端口 ${port} 被其它 pm2 服务占用（${managedConflicts.join(', ')}），` +
            '疑似 pm2_env PORT 污染/配置冲突，已跳过清理。请核查该模块配置中心 PORT 后重新发布。',
        );
      }
      if (orphans.length) await ctx.save();
    }

    // ---- 配置中心值渲染落盘 .env（增量①）----
    // 背景：配置原本只经 pm2 restart --update-env 注入"进程 env"，但 ai-agent 等经
    // publish 脚本启动、以及远端 /data 路径的服务，都靠读 <serviceDir>/.env 文件拿配置，
    // 因此吃不到配置中心（历史上 key 只能手改服务器 .env，易改错位置）。
    // 这里在重启前把配置中心 resolve 结果（global→env→module 覆盖后）合并写进进程
    // 运行目录的 .env：文件持久化 + pm2 进程注入双保险。文件 0600（可能含密钥明文，
    // 仅本机服务读取，与人工编辑 .env 语义一致）。
    const injectKeys = Object.keys(injectEnv);
    if (injectKeys.length) {
      const proc = this.pm2Probe.listProcesses().find((a) => a.name === restarted);
      const runDir =
        (proc as any)?.pm2_env?.pm_cwd || join(ws, 'servers', mod?.dir || p.moduleKey);
      try {
        await renderEnvFile(join(runDir, '.env'), injectEnv);
        ctx.log(`[config] 配置中心值已渲染落盘 ${join(runDir, '.env')}（${injectKeys.length} 项, 0600）`);
        await ctx.save();
      } catch (e) {
        // 落盘失败不阻断：进程注入仍会生效；记 warn 供排查
        this.logger.warn(`渲染 .env 失败（不阻断重启）: ${(e as Error).message}`);
      }
    }

    try {
      // 90s 上限：pm2 restart 正常秒级返回；极端（daemon 响应/进程 graceful 阻塞）时不致流水线无限卡 restart
      this.command.exec(
        `"${this.command.pm2Bin()}" restart ${restarted} --update-env`,
        ws,
        injectEnv,
        90_000,
      );
    } catch (e) {
      // 超时/异常不等于发布失败：pm2 daemon 可能已重启完。记录告警，交给后续 verify 探活兜底。
      const msg = (e as Error).message;
      ctx.log(`[restart] 重启命令异常/超时: ${msg.slice(0, 240)}`);
      this.logger.warn(`pm2 restart ${restarted} 命令异常: ${msg}`);
    }
    ctx.log(`服务已重启: ${restarted}`);
    p.result = { ...(p.result ?? {}), restarted };
    await ctx.save();
  }

  /** 解析要注入的环境变量（配置中心 global → env → module 合并）；解析失败只告警不阻断 */
  private async resolveInjectEnv(
    p: StepContext['pipeline'],
    ctx: StepContext,
  ): Promise<Record<string, string>> {
    try {
      const cfg = await this.configs.resolve(p.env, p.moduleKey);
      const keys = Object.keys(cfg);
      if (keys.length) {
        ctx.log(`[config] 注入 ${keys.length} 项配置（强制覆盖）`);
        await ctx.save();
      }
      return cfg;
    } catch (e) {
      this.logger.warn(`解析配置失败，本次不注入配置: ${(e as Error).message}`);
      return {};
    }
  }
}

/** dotenv 值序列化：纯安全字符裸写，其余用 JSON 双引号+转义（dotenv 兼容解析） */
function serializeEnvValue(v: string): string {
  if (/^[A-Za-z0-9_\-./:@%+=,]+$/.test(v)) return v;
  return JSON.stringify(v);
}

/**
 * 把配置中心 resolve 结果合并写进目标 .env 文件：
 * - 保留原文件其它行（注释/未被配置中心纳管的本地 key），仅覆盖/追加配置中心下发的 key；
 * - 已存在 key 覆盖首个匹配行，未命中则追加到文件末尾；
 * - 以 0600 写出（可能含密钥明文，仅供本机服务读取）。
 */
async function renderEnvFile(envFile: string, cfg: Record<string, string>): Promise<void> {
  let lines: string[] = [];
  try {
    const raw = await readFile(envFile, 'utf8');
    if (raw.trim() !== '') {
      lines = raw.split('\n');
      if (lines.length && lines[lines.length - 1] === '') lines.pop(); // 去尾空，末尾统一补一个
    }
  } catch {
    lines = []; // 文件不存在 → 新建
  }

  const keyAt = new Map<string, number>();
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !keyAt.has(m[1])) keyAt.set(m[1], i);
  });

  for (const [k, v] of Object.entries(cfg)) {
    const line = `${k}=${serializeEnvValue(v)}`;
    const idx = keyAt.get(k);
    if (idx !== undefined) {
      lines[idx] = line;
    } else {
      lines.push(line);
      keyAt.set(k, lines.length - 1);
    }
  }

  let out = lines.join('\n');
  if (out && !out.endsWith('\n')) out += '\n';
  // writeFile 的 mode 仅对新建文件生效；已存在文件需显式 chmod（可能含密钥明文 → 600）
  await writeFile(envFile, out, { mode: 0o600 });
  await chmod(envFile, 0o600);
}
