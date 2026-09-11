import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { ReleaseHookService } from './release-hook.service';

/**
 * CI/CD 发布触发与状态查询接口（`/api/hooks/*`）。
 *
 * 与控制台（JWT）和 MCP（API Key）并列为第三条发布入口，
 * 但**不新增执行路径** —— 内部仍调用 `PipelineService.submit`，
 * 因此锁 / 审批 / 审计 / 通知 / 度量 / 回滚语义三者完全一致。
 *
 * 鉴权：HMAC-SHA256 签名（`X-Hub-Signature-256` + `X-Ws-Timestamp`），
 * 不走 JWT —— CI 环境不持有控制台登录态；而控制台 JWT 是 24h 短期登录凭据，
 * 放进 CI secrets 次日即失效，且权限过大（能发布/取消/审批）。见 `pipelineStatus` 注释。
 *
 * 端点不返回任何敏感信息（无密钥、无内部路径、无阶段日志）。
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

  /**
   * 查询流水线状态（供 CI 轮询至终态）。
   *
   * 复用触发端的同一套 HMAC 验签：GET 无请求体，签名对象是空串
   * （即 `sha256=hmac(secret, `${ts}.`)`），与 CI 端计算方式一致。
   */
  @Get('pipelines/:jobId')
  @ApiOperation({ summary: '查询流水线状态（HMAC 签名；供 CI 轮询）' })
  async pipelineStatus(
    @Req() req: { rawBody?: Buffer },
    @Param('jobId') jobId: string,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-ws-timestamp') timestamp?: string,
  ) {
    const raw = req?.rawBody?.toString('utf8') ?? '';
    this.hooks.verifySignature(raw, signature, timestamp);
    return this.hooks.pipelineStatus(jobId);
  }
}
