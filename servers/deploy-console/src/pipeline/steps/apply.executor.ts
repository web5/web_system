import { Injectable } from '@nestjs/common';
import { DeployService } from '../../deploy/deploy.service';
import { StepContext } from './step.types';

/**
 * apply 内置步骤执行体（category=deploy）：**后台模块的「部署生效」**。
 *
 * 为什么需要它（方案 A，2026-09-17；规划见
 * specs/deploy-console/gateway-and-shell-versioned-release.md §3）：
 *
 * 流水线的 release 节点原本只有两个 action ——「上传产物」（版本目录落盘）
 * 与「写版本记录」（deploy_versions）。**没人把版本目录变成正在运行的服务**：
 * 后台模块此前靠「就地构建 + restart」顶着（build 直接编译到 `servers/<dir>/dist`，
 * restart 脚本再 `pm2 start dist/main.js`），于是
 *   · 没有版本可言 → **不可回滚**；
 *   · gateway 也不例外 —— 它明明有 `tpl-gateway-{local,dev,prod}` 三条流水线，
 *     跑完却还得人工去控制台点「部署」。
 *
 * 这个步骤把控制台「部署」按钮背后的能力（`DeployService.deployVersion()`）下沉为
 * **流水线里的一个 service action**（design §3：平台能力 = action，节点仍只有 shell / approval 两类）：
 * 版本目录 → `dist` + pm2 重启 → 改指针。流水线跑完即生效，且可回滚。
 *
 * 为什么不用现有的 `restart`：restart 假定 dist 已是待发布版本（就地构建产物），
 * 而终态要求「产物先进版本目录、再由部署动作落地」，两者模型不同。
 *
 * ⚠️ 影响面：本步骤会**重启后台服务**。gateway 是静态产物与 API 的宿主，
 * 重启期间所有微前端与 API 调用短暂不可用 —— 由流水线模板决定是否启用。
 */
@Injectable()
export class ApplyExecutor {
  constructor(private readonly deploy: DeployService) {}

  async run(ctx: StepContext): Promise<void> {
    const p = ctx.pipeline;
    if (!p.versionTag) {
      throw new Error('部署生效失败：版本号为空（git 节点未解析出 COMMIT_ID，检查拉码节点是否执行成功）');
    }
    await ctx.enterStage('部署生效（版本目录 → dist + 切指针）');
    const r = await this.deploy.deployVersion({
      moduleKey: p.moduleKey,
      env: p.env,
      versionTag: p.versionTag,
      operator: p.operator,
    });
    ctx.log(`部署已生效: ${r.env}/${r.moduleKey} → ${r.versionTag}（dist 已落地并重启，指针已更新）`);
    await ctx.save();
  }
}
