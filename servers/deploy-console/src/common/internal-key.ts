import { UnauthorizedException } from '@nestjs/common';
import { describeVerifyFailure, looksLikeRunToken, verifyRunToken } from './run-token';

/**
 * 校验「脚本调平台」的内部凭据：请求头 `x-internal-key`。
 *
 * 为什么需要：流水线节点/动作脚本跑在 shell 里、拿不到用户 JWT，平台把凭据注入为
 * 脚本变量 `CONSOLE_TOKEN`（见 `resolveStageVars`）。内部接口因此统一用
 * **同一个头**，本函数是它们的唯一实现（`deploy/internal-release.controller.ts`、
 * `config/config.controller.ts` 共用）。
 *
 * **两种凭据并存**（2026-10-13）：
 *   1. **run 短期令牌**（`rt1_...`，见 `run-token.ts`）：每次 run 现签，带
 *      runId/env/moduleKey，过期或 run 结束即失效。**流水线脚本的推荐路径** —— 静态
 *      `INTERNAL_API_KEY` 长期躺在脚本 env 里，泄露一个就永久可切 prod 指针。
 *   2. **静态 `INTERNAL_API_KEY`**：存量脚本、运维脚本、服务间调用仍用它。它不会被移除，
 *      只是不再是发布脚本的唯一选择。
 *
 * 未配置 `INTERNAL_API_KEY` 时**一律拒绝静态 key**：内部接口宁不可用，也不裸奔。
 * run 令牌走签名校验，不依赖该配置 —— 否则「没配静态 key 就发不了版」会变成新的摩擦。
 *
 * @returns 调用方身份，供审计留痕（此前审计只能记 `pipeline-script`，无从归因到某次发布）
 */
export type InternalIdentity =
  | { kind: 'static-key' }
  | {
      kind: 'run-token';
      /** 流水线 run id（`deploy_pipeline_runs.id`） */
      runId: string;
      env: string;
      moduleKey: string;
      /** 令牌 id（撤销的最小单位） */
      jti: string;
    };

export function assertInternalKey(req: { headers?: Record<string, unknown> }): InternalIdentity {
  const got = String(req?.headers?.['x-internal-key'] ?? '').trim();

  // run 令牌优先：带 rt1_ 前缀的一律按短期令牌处理，**不再与静态 key 比对**。
  // 否则「静态 key 恰好以 rt1_ 开头」这种巧合会让两种凭据的排障信息互相污染。
  if (looksLikeRunToken(got)) {
    const r = verifyRunToken(got);
    if (!r.ok) {
      throw new UnauthorizedException(`x-internal-key 无效：${describeVerifyFailure(r.reason)}`);
    }
    return {
      kind: 'run-token',
      runId: r.claims.runId,
      env: r.claims.env,
      moduleKey: r.claims.moduleKey,
      jti: r.claims.jti,
    };
  }

  const expected = process.env.INTERNAL_API_KEY || '';
  if (!expected) {
    throw new UnauthorizedException(
      '服务未配置 INTERNAL_API_KEY，内部接口不可用（run 短期令牌不受此限制）',
    );
  }
  if (got !== expected) {
    throw new UnauthorizedException('x-internal-key 不正确');
  }
  return { kind: 'static-key' };
}
