import {
  Controller,
  Post,
  Body,
  Req,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { DeployService } from './deploy.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';

/**
 * 内部发布接口（`/api/internal/release/*`）——供**流水线节点脚本**调用。
 *
 * 为什么需要它：新模型里「发布」节点 = 普通 shell 节点，脚本自己完成
 * 「上传文件 + 调平台接口（写版本 / 切指针）」，引擎不再用平台节点代写版本。
 * 脚本跑在 shell 里，拿不到用户 JWT，故沿用平台既有内部密钥机制
 * （`x-internal-key` ← `INTERNAL_API_KEY`），由引擎注入为脚本变量
 * `CONSOLE_API` / `CONSOLE_TOKEN`（见 `resolveStageVars`）。
 *
 * 开放范围（2026-09-21 扩大，见 `specs/pipeline-restart-verify-as-action/design.md` §2.4）：
 * - `versions` 写版本记录（发布节点：投递产物后落一条）
 * - `pointer`  切当前版本指针（restart/verify 下沉为 DB 脚本后，指针只能由**验证通过后**的脚本推进）
 *
 * 仍不开放：回滚 / 灰度规则 / 清理 —— 那些属人工决策，继续走控制台 JWT 接口。
 */
@ApiTags('内部发布接口')
@ApiHeader({ name: 'x-internal-key', description: '内部服务密钥' })
@Controller('internal/release')
@Public()
export class InternalReleaseController {
  constructor(
    private readonly deployService: DeployService,
    private readonly registry: ReleaseRegistryService,
  ) {}

  /** 校验内部密钥（与 INTERNAL_API_KEY 一致）；不一致一律 401 */
  private assertInternalKey(req: any): void {
    const expected = process.env.INTERNAL_API_KEY || '';
    const got = String(req?.headers?.['x-internal-key'] ?? '');
    if (!expected) {
      throw new UnauthorizedException('服务未配置 INTERNAL_API_KEY，内部接口不可用');
    }
    if (got !== expected) {
      throw new UnauthorizedException('x-internal-key 不正确');
    }
  }

  @Post('versions')
  @ApiOperation({ summary: '写版本记录（发布节点脚本调用：上传产物后落一条版本）' })
  async writeVersion(@Body() body: any, @Req() req: any) {
    this.assertInternalKey(req);
    const moduleKey = String(body?.moduleKey || body?.component || '').trim();
    const versionTag = String(body?.versionTag || body?.version || '').trim();
    if (!moduleKey) throw new BadRequestException('moduleKey 必填');
    if (!versionTag) throw new BadRequestException('versionTag 必填');
    const v = await this.deployService.recordReleaseVersion({
      moduleKey,
      versionTag,
      env: body?.env,
      gitCommit: body?.gitCommit,
      gitBranch: body?.gitBranch,
      note: body?.note ?? '由发布节点脚本写入',
      // 脚本无用户身份，操作人留痕为 pipeline-script（审计可追溯到流水线实例）
      operator: body?.operator || 'pipeline-script',
    });
    return { ok: true, id: v.id, moduleKey, versionTag: v.versionTag };
  }

  /**
   * 切当前版本指针（`deploy_deployments`）。
   *
   * 语义：**只改指针**，不落地、不重启 —— 落地与重启是 action 脚本自己的职责
   * （后端 restart 脚本：版本目录 → dist + pm2 重启；前端则是「切指针即生效」）。
   *
   * 典型用法：后端发布节点的 `verify` 动作在探活通过后调用本接口，
   * 保证「验证不通过 ⇒ 指针不前进」（旧版本继续对外服务，状态不撕裂）。
   */
  @Post('pointer')
  @ApiOperation({ summary: '切当前版本指针（发布节点脚本调用：验证通过后推进）' })
  async pointer(@Body() body: any, @Req() req: any) {
    this.assertInternalKey(req);
    const moduleKey = String(body?.moduleKey || body?.component || '').trim();
    const env = String(body?.env || '').trim();
    const currentVersion = String(
      body?.versionTag || body?.version || body?.currentVersion || '',
    ).trim();
    if (!moduleKey) throw new BadRequestException('moduleKey 必填');
    if (!env) throw new BadRequestException('env 必填');
    if (!currentVersion) throw new BadRequestException('versionTag 必填');

    await this.registry.setPointer({
      env,
      moduleKey,
      currentVersion,
      deployedBy: body?.operator || 'pipeline-script',
      taskId: body?.taskId,
    });
    return { ok: true, env, moduleKey, currentVersion };
  }
}
