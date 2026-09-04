import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { Pm2ProbeService } from '../../pm2/pm2-probe.service';
import { CommandService } from '../../shell/command.service';
// 配置中心服务（发布/重启时按 global→env→module 合并并强制覆盖注入进程环境）
import { ConfigService as ConfigCenterService } from '../../config/config.service';
import { StepContext } from './step.types';

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
    const app = this.pm2Probe.listProcesses().find((a) => a.name === restarted);
    const port = app?.pm2_env?.PORT;
    if (port != null) {
      const pm2Pid = app?.pid != null ? String(app.pid) : undefined;
      const occupiers = this.command
        .exec(`lsof -tiTCP:${port} -sTCP:LISTEN`, ws, {})
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const orphans = pm2Pid ? occupiers.filter((occ) => occ !== pm2Pid) : [];
      for (const occ of orphans) {
        this.command.exec(`kill -9 ${occ}`, ws, {});
        ctx.log(`清理端口 ${port} 孤儿进程 ${occ}（非 pm2 pid ${pm2Pid}）`);
      }
      if (orphans.length) await ctx.save();
    }

    this.command.exec(
      `"${this.command.pm2Bin()}" restart ${restarted} --update-env`,
      ws,
      injectEnv,
    );
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
