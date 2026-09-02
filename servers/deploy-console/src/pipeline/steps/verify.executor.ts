import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { HttpProbeService } from '../../probe/http-probe.service';
import { Pm2ProbeService, Pm2ProbeResult } from '../../pm2/pm2-probe.service';
import { AuditService } from '../../audit/audit.service';
import * as releasePaths from '../release-paths';
import { StepContext } from './step.types';

/** gateway 版本缓存 TTL（秒）—— 验证阶段必须等它过期后再断言（历史坑） */
const GATEWAY_VERSION_TTL_SEC = 10;

/**
 * verify 内置步骤执行体（category=probe）。
 * 前端：产物 HEAD + 等 gateway TTL 后断言 __manifest__ 版本已更新；
 * 后端：pm2 进程 online + 端口真实可服务（假健康阻断 → 触发 verify 失败自动回滚）。
 */
@Injectable()
export class VerifyExecutor {
  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly httpProbe: HttpProbeService,
    private readonly pm2Probe: Pm2ProbeService,
    private readonly auditService: AuditService,
  ) {}

  /** gateway 内网地址（本地 http://localhost:6000，可配 GATEWAY_INTERNAL_URL） */
  private gatewayUrl(): string {
    return this.configService.get<string>('GATEWAY_INTERNAL_URL') || 'http://localhost:6000';
  }

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage('验证发布结果');

    if (p.moduleType === 'backend') {
      await this.verifyBackend(ctx);
      return;
    }

    // ── 前端：产物可访问 + manifest 版本断言 ─────────────────────
    const artifactUrl = releasePaths.moduleArtifactUrl(this.gatewayUrl(), p.moduleKey, p.versionTag!);
    const artifactOk = await this.httpProbe.headOk(artifactUrl);
    p.result = { ...(p.result ?? {}), artifactOk };

    if (p.mode === 'grayscale') {
      if (!artifactOk) {
        throw new Error(`灰度产物不可访问: ${artifactUrl}`);
      }
      ctx.log(`灰度产物可访问: ${artifactUrl}`);
      await ctx.save();
      return;
    }

    // 等 gateway 版本缓存 TTL 过期（历史坑：改完版本表立刻查会拿到旧版本）
    await ctx.sleep((GATEWAY_VERSION_TTL_SEC + 2) * 1000);

    const manifest = await this.httpProbe.fetchGatewayManifest(this.gatewayUrl());
    const entry = (manifest?.modules ?? []).find(
      (m) => m.name === p.moduleKey || m.key === p.moduleKey,
    );
    const online = entry?.version;
    p.result = { ...(p.result ?? {}), manifestVersion: online ?? null };

    if (online && online !== p.versionTag) {
      throw new Error(
        `验证失败：gateway manifest 版本为 ${online}，期望 ${p.versionTag}（TTL 已等待仍不一致，请检查 gateway 缓存或产物路径）`,
      );
    }
    if (!online) {
      throw new Error(`验证失败：manifest 中未找到模块 ${p.moduleKey}`);
    }
    ctx.log(`manifest 已确认: ${p.moduleKey} → ${online}`);
    await ctx.save();
  }

  /**
   * 后端验证：pm2 服务重启后保持 online，且端口真实可服务（避免「进程在但端口没起」的假健康）。
   *
   * 轮询语义：pm2 查询异常（jlist 失败/未纳管）→ 本轮跳过继续轮询；
   * 命中 online 但端口不可达 = 假健康 → **立即抛错**，交由 verify 失败处理自动回滚。
   */
  private async verifyBackend(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    const mod = await this.moduleRegistry.get(p.moduleKey);
    let ok = false;
    let healthCheck: { port?: string | number; ok?: boolean; checkedAt?: string; note?: string } = {};
    for (let i = 0; i < 12; i++) {
      await ctx.sleep(2000);
      let res: Pm2ProbeResult;
      try {
        res = await this.pm2Probe.probeOnce(p.moduleKey, mod?.pm2);
      } catch {
        // pm2 查询失败（jlist 异常等）继续轮询
        continue;
      }
      if (!res.online) {
        // 逐候选提示等待（app 存在但非 online / pm2 中未找到）
        for (const s of res.scans) {
          ctx.log(`等待服务上线: ${s.name}（${s.status ?? '未找到'}）`);
        }
        continue;
      }

      ok = true;
      const hit = res.hit!;
      ctx.log(`服务在线: ${hit.name}`);
      if (hit.port == null) {
        // 进程 online 但无 PORT：降级为进程状态探活（不阻断）
        healthCheck = { note: 'pm2_env.PORT 缺失，降级为进程状态探活', ok: undefined };
        break;
      }
      const reachable = res.reachable === true;
      healthCheck = { port: hit.port, ok: reachable, checkedAt: new Date().toISOString() };
      ctx.log(`端口探活 ${hit.port}: ${reachable ? '健康' : '未响应'}`);
      if (!reachable) {
        // 假健康必须阻断：进程 online 但端口无响应（典型：启动即崩、端口被占、依赖缺失）。
        // 抛错后由 verify 阶段失败处理自动回滚到上一稳定版本。
        p.result = { ...(p.result ?? {}), online: true, healthCheck };
        await ctx.save();
        throw new Error(
          `端口探活失败：${p.moduleKey} 进程已 online，但 127.0.0.1:${hit.port} 无响应（终止发布并自动回滚）`,
        );
      }
      break;
    }
    p.result = { ...(p.result ?? {}), online: ok, healthCheck };
    if (!ok) {
      throw new Error(`服务重启后未在线: ${p.moduleKey}（请查看 pm2 logs）`);
    }
    // 探活结果审计留痕
    await this.auditService.log({
      user: p.operator || 'unknown',
      action: 'pipeline.verify.healthcheck',
      env: p.env,
      component: p.moduleKey,
      status: healthCheck.ok === false ? 'warn' : 'success',
      detail: `发布后健康检查: ${p.moduleKey} → ${p.versionTag}（port=${healthCheck.port ?? 'n/a'}, ok=${healthCheck.ok ?? 'n/a'}）`,
    });
    await ctx.save();
  }
}
