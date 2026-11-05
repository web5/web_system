import { Injectable } from '@nestjs/common';
import { DeployService } from '../../deploy/deploy.service';
import { StepContext } from './step.types';

/**
 * dispatch-config 内置步骤执行体（category=deploy）：**发布流水线里的配置下发**（#8493）。
 *
 * 为什么需要它：发布流水线的 release 阶段走 `shell 工具 apply-runtime`（activate），
 * 绕过了「部署生效」路径 `DeployService.deployVersion` → `applyBackendRemote`，
 * 而配置下发（写远端 `.env.generated`）原先只挂在 `applyBackendRemote` 里 ——
 * 于是经发布流水线发版的场景，配置中心的下发内容永远到不了目标机
 * （2026-11-05 实测 prod gateway 发版后 `.env.generated` 不存在）。
 *
 * 本步骤把「渲染配置中心内容 → 写远端服务目录」的能力（`dispatchConfigForRelease`）
 * 下沉为流水线里的一个 service action，编排在 activate 之前调用它即可。
 *
 * ⚠️ 影响面：只写 `.env.generated`（0600 + 原子替换 + 备份），不改 dist、不重启进程；
 * 无 module 级条目时天然 no-op（204 语义，prod 无 config_items 记录时不改变现状）。
 */
@Injectable()
export class DispatchConfigExecutor {
  constructor(private readonly deploy: DeployService) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    await ctx.enterStage('下发配置（.env.generated → 目标机服务目录）');
    // 本地：部署生效由 deployVersion 的 applyBackendVersion 本地分支 writeGeneratedEnv 覆盖，
    // 且本步骤的远程下发（SSH 写远端）对 local 无目标机可写 —— 直接跳过。
    if (p.env === 'local') {
      ctx.log('本地环境跳过远程配置下发（由「部署生效」的 writeGeneratedEnv 覆盖）');
      await ctx.save();
      return;
    }
    await this.deploy.dispatchConfigForRelease(p.env, p.moduleKey);
    ctx.log(`配置下发完成: ${p.env}/${p.moduleKey}`);
    await ctx.save();
  }
}
