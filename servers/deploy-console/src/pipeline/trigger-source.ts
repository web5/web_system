/**
 * 触发来源（triggerSource）归一化与派生 —— 纯函数，无 IO。
 *
 * 背景（2026-10-27 PROD 发布触发源归因）：两轮非预期 PROD 批量发布经 MCP Key
 * 通道提交 + 自动审批一体触发，`operator=1` 无法区分「谁的会话/哪把 Key/哪个脚本」。
 * 本模块把「这次发布是谁触发的」固化成一条可落库、可检索的短字符串：
 *
 *   ui                        ← 控制台（缺省派生）
 *   ui:page-releases          ← 控制台带页面/会话标识（调用方可选传）
 *   mcp:ai-ops-automation     ← MCP 通道（服务端强制并入 Key 名，不可被调用方抹掉）
 *   web|x|mcp:ai-ops-automation ← 调用方自报 + MCP Key 名
 *   ci:release.yml            ← CI hook 通道
 *
 * 安全：triggerSource 会落库（varchar 128）并进审计 detail 文本，
 * 故对**调用方传入**的片段做白名单硬校验（非法直接 400，不静默清洗），
 * 对**服务端派生**的片段（Key 名等）做白名单替换 + 截断（Key 名是用户建库时起的，
 * 可能含空格/中文，不能因脏数据把提交打挂）。
 */
import { BadRequestException } from '@nestjs/common';

/** triggerSource 总长上限（与实体列 varchar(128) 对齐） */
export const TRIGGER_SOURCE_MAX_LEN = 128;

/** 调用方传入片段的白名单：字母数字与 . _ : | @ - /（覆盖会话 id / 脚本名 / Key 名形态） */
const TRIGGER_SOURCE_RE = /^[A-Za-z0-9._:|@/-]{1,128}$/;

/**
 * 校验调用方传入的 triggerSource。
 *
 * 空/缺省 → undefined（由各通道派生缺省值）；
 * 非法字符或超长 → 抛 BadRequestException（400，带可读原因）。
 */
export function assertTriggerSource(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (!TRIGGER_SOURCE_RE.test(s)) {
    throw new BadRequestException(
      `triggerSource 含非法字符或超长（仅允许 [A-Za-z0-9._:|@/-]，长度 1-${TRIGGER_SOURCE_MAX_LEN}）: ${s.slice(0, 40)}`,
    );
  }
  return s;
}

/**
 * 服务端派生片段（Key 名 / CI source 等）：白名单外替换为 `_`，超长截断。
 * 空则回落 fallback（保证拼出来的来源永远非空、可解析）。
 */
export function sanitizeSourceFragment(
  raw: string | null | undefined,
  fallback: string,
): string {
  const s = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._:|@/-]/g, '_')
    .slice(0, 64);
  return s || fallback;
}

/**
 * UI 通道缺省派生：调用方可传页面/会话标识，缺省 `ui`。
 * 入参假定已过 assertTriggerSource。
 */
export function deriveUiTriggerSource(bodySource: string | undefined): string {
  return bodySource ?? 'ui';
}

/**
 * MCP 通道强制并入 Key 名：`mcp:<keyName>` 或 `<body.triggerSource>|mcp:<keyName>`。
 *
 * **不可被调用方抹掉**：即使 body 传了 triggerSource，Key 名段也强制拼在尾部；
 * 超长时让 body 段让位（截 body、保 mcp 段），保证归因字段始终能定位到 Key。
 */
export function composeMcpTriggerSource(
  bodySource: string | undefined,
  keyName: string | null | undefined,
): string {
  const key = sanitizeSourceFragment(keyName, 'unknown');
  const mcp = `mcp:${key}`;
  if (!bodySource) return mcp.slice(0, TRIGGER_SOURCE_MAX_LEN);
  // 强制段放尾部且不被截断：body 段按剩余预算截取
  const budget = TRIGGER_SOURCE_MAX_LEN - 1 - mcp.length; // 1 = '|'
  if (budget <= 0) return mcp.slice(0, TRIGGER_SOURCE_MAX_LEN);
  return `${bodySource.slice(0, budget)}|${mcp}`;
}

/**
 * hook（CI）通道派生：`ci:<source>` 形态，与 operator 的 `ci:<source>` 对齐。
 */
export function deriveCiTriggerSource(source: string | null | undefined): string {
  return `ci:${sanitizeSourceFragment(source, 'unknown')}`;
}

/**
 * 审批通道标记（审计用）：`ui` / `mcp:<keyName>`。
 * 与触发来源同一套字符集，便于归因检索。
 */
export function composeApprovalChannel(
  channel: string | null | undefined,
): string {
  if (!channel) return 'ui';
  return String(channel).trim().slice(0, TRIGGER_SOURCE_MAX_LEN) || 'ui';
}

/**
 * 提交审计 detail 文本（含 triggerSource，供归因检索）。
 * 单独抽出来是为了让「审计 detail 必须含来源」这条可被单测钉死。
 */
export function formatSubmitAuditDetail(
  id: string,
  mode: string,
  templateName: string,
  triggerSource: string | undefined,
  pending = false,
): string {
  const src = triggerSource ? `, 来源=${triggerSource}` : '';
  const tail = pending ? '→ 需审批，已阻断等待' : '';
  return `提交发布流水线 ${id}（mode=${mode}, 模板=${templateName}${src}）${tail}`;
}
