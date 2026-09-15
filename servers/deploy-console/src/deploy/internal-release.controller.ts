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

/**
 * 内部发布接口（`/api/internal/release/*`）——供**流水线节点脚本**调用。
 *
 * 为什么需要它：新模型里「发布」节点 = 普通 shell 节点，
 * 脚本自己完成「上传文件 + **调用写版本接口**」，引擎不再用平台节点代写版本。
 * 脚本跑在 shell 里，拿不到用户 JWT，故沿用平台既有内部密钥机制
 * （`x-internal-key` ← `INTERNAL_API_KEY`，与流水线权限同步、user-service 同一套）。
 *
 * 注意：这里只开放**写版本**。指针切换（部署）属于「模块管理 → 环境部署」的人工动作，
 * 走控制台 JWT 接口，不对脚本开放。
 */
@ApiTags('内部发布接口')
@ApiHeader({ name: 'x-internal-key', description: '内部服务密钥' })
@Controller('internal/release')
@Public()
export class InternalReleaseController {
  constructor(private readonly deployService: DeployService) {}

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
}
