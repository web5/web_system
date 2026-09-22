import { UnauthorizedException } from '@nestjs/common';

/**
 * 校验「脚本调平台」的内部密钥：请求头 `x-internal-key` 必须等于 `INTERNAL_API_KEY`。
 *
 * 为什么需要：流水线节点/动作脚本跑在 shell 里、拿不到用户 JWT，平台把
 * `INTERNAL_API_KEY` 注入为脚本变量 `CONSOLE_TOKEN`（见 `resolveStageVars`）。
 * 内部接口因此统一用**同一个密钥 + 同一个头**，本函数是它们的唯一实现
 * （`deploy/internal-release.controller.ts`、`config/config.controller.ts` 共用）。
 *
 * 未配置 `INTERNAL_API_KEY` 时**一律拒绝**：内部接口宁不可用，也不裸奔。
 */
export function assertInternalKey(req: { headers?: Record<string, unknown> }): void {
  const expected = process.env.INTERNAL_API_KEY || '';
  const got = String(req?.headers?.['x-internal-key'] ?? '');
  if (!expected) {
    throw new UnauthorizedException('服务未配置 INTERNAL_API_KEY，内部接口不可用');
  }
  if (got !== expected) {
    throw new UnauthorizedException('x-internal-key 不正确');
  }
}
