import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { CanaryService } from '../../canary/canary.service';
import { ModuleRegistryService } from '../../module-registry/module-registry.service';
import { ReleaseRegistryService } from '../../registry/release-registry.service';
import { CdnAssetVerifier } from '../cdn-asset-verifier.service';
import { defaultReleaseWorkspace } from '../release-paths';
import { StepContext } from './step.types';

/**
 * pointer 内置步骤执行体（category=semantic，发布语义真相源，不可被命令覆盖）。
 * direct=upsert 版本指针；grayscale=写灰度规则（不切 stable 指针）。
 *
 * 2026-11-04（Phase 2 / S6）：**切指针前加 CDN 硬门禁**。
 * 顺序不可交换 —— 先让产物在 CDN 上真的可取且哈希一致，再让流量指过去；
 * 反过来就是「指针已切、资源 404」的线上白屏，而 DB 里一切显示成功。
 * 该门禁只在 `CDN_LAYOUT_MODE=cdn` 时生效，legacy 路径零变化。
 */
@Injectable()
export class PointerExecutor {
  constructor(
    private readonly registry: ReleaseRegistryService,
    private readonly canaryService: CanaryService,
    private readonly configService: ConfigService,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly cdnVerifier: CdnAssetVerifier,
  ) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    // 灰度与全量都要对外供流量，故门禁放在分支之前
    await this.assertCdnReady(ctx);

    if (p.mode === 'grayscale') {
      await ctx.enterStage('写入灰度规则（不切 stable 指针）');
      const rule = await this.canaryService.create({
        envId: p.env,
        moduleKey: p.moduleKey,
        canaryVersion: p.versionTag!,
        matchRule: p.grayscaleRule as never,
        enabled: true,
      });
      p.canaryRuleId = rule.id;
      ctx.log(`灰度规则已创建: ${rule.id} → ${p.versionTag}`);
      await ctx.save();
      return;
    }

    await ctx.enterStage('切换当前版本指针');
    await this.registry.setPointer({
      env: p.env,
      moduleKey: p.moduleKey,
      currentVersion: p.versionTag!,
      deployedBy: p.operator,
      taskId: p.id,
    });
    ctx.log(`指针已切换: ${p.env}/${p.moduleKey} → ${p.versionTag}`);
    await ctx.save();
  }

  /** CDN 模式下的切指针前置校验（legacy 直接返回，不发任何请求） */
  private async assertCdnReady(ctx: StepContext): Promise<void> {
    if (!this.cdnVerifier.isCdnMode()) return;
    const p = ctx.pipeline;
    if (!p.versionTag) {
      throw new Error('CDN 校验失败：版本号为空（version 阶段未写入，无法定位产物目录）');
    }
    const ws = this.configService.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace();
    const dir = await this.moduleDir(p.moduleKey);
    const localDir = path.join(ws, p.moduleType === 'backend' ? 'servers' : 'apps', dir, 'dist');
    await ctx.enterStage('校验 CDN 产物（清单 200 + sha256 对账）');
    await this.cdnVerifier.assertReady({
      env: p.env,
      app: p.moduleKey,
      commit: p.versionTag,
      localDir,
      log: ctx.log,
    });
  }

  /** 模块目录名（与 upload 执行体同口径：注册表 `dir`，缺省回落 moduleKey） */
  private async moduleDir(moduleKey: string): Promise<string> {
    try {
      const mod = await this.moduleRegistry.get(moduleKey);
      return mod?.dir || moduleKey;
    } catch {
      return moduleKey;
    }
  }
}
