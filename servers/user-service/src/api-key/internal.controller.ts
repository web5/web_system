import { Controller, Post, Body, UseGuards, HttpCode } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { InternalGuard } from './internal.guard';

/**
 * 内部服务间接口（仅 mcp-gateway 等内部服务调用，受 InternalGuard 保护）
 * POST /internal/keys/verify { key } → { valid, ownerId?, keyId?, keyName? }
 *
 * keyName（mcp_api_keys.name）：2026-10-27 起随校验结果一并返回，
 * 供 deploy-console 把 Key 名并入触发来源（triggerSource）做归因。
 */
@Controller('internal/keys')
@UseGuards(InternalGuard)
export class InternalKeyController {
  constructor(private readonly svc: ApiKeyService) {}

  @Post('verify')
  @HttpCode(200)
  async verify(@Body() dto: { key: string }) {
    const record = await this.svc.verifyKey(dto.key);
    if (!record) return { valid: false, ownerId: null, keyId: null, keyName: null };
    return {
      valid: true,
      ownerId: record.ownerId ?? null,
      keyId: record.id,
      keyName: record.name ?? null,
    };
  }
}
