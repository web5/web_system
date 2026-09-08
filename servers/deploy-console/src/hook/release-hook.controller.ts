import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { ReleaseHookService } from './release-hook.service';

/**
 * CI/CD 发布触发接口（POST /api/hooks/release）。
 *
 * 与控制台（JWT）和 MCP（API Key）并列为第三条发布入口，
 * 但**不新增执行路径** —— 内部仍调用 `PipelineService.submit`，
 * 因此锁 / 审批 / 审计 / 通知 / 度量 / 回滚语义三者完全一致。
 *
 * 鉴权：HMAC-SHA256 签名（`X-Hub-Signature-256` + `X-Ws-Timestamp`），
 * 不走 JWT —— CI 环境不持有控制台登录态。
 * 端点不返回任何敏感信息（无密钥、无内部路径）。
 */
@ApiTags('CI/CD 发布触发')
@Controller('hooks')
@Public()
export class ReleaseHookController {
  constructor(private readonly hooks: ReleaseHookService) {}

  @Post('release')
  @ApiOperation({ summary: '提交发布意图（HMAC 签名 + deliveryId 幂等）' })
  async release(
    @Req() req: { rawBody?: Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-ws-timestamp') timestamp?: string,
  ) {
    // 必须用**原始请求体**验签：重新序列化 JSON 会因键顺序/空白差异导致签名永远不匹配
    const raw = req?.rawBody?.toString('utf8') ?? JSON.stringify(body ?? {});
    this.hooks.verifySignature(raw, signature, timestamp);
    const dto = await this.hooks.parse(raw);
    return this.hooks.handle(dto, raw);
  }
}
