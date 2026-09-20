/**
 * 节点「环境分支」拼装与解析（纯函数，便于单测）。
 *
 * 语义（specs/pipeline-env-branch/design.md §3.2）：
 * - 配置的真相源 = `{ [envId]: script }`（每环境一段**自包含**脚本）
 * - 执行体 = 由分支配置拼装出的单一脚本：各分支包成函数，末尾 `case $DEPLOY_ENV` 分派
 * - **未配置脚本的环境一律 fail-fast**（用户 2026-09-20 选定：强制显式配置，不做静默回落）
 *
 * 为什么每段是完整脚本而不是共享前置：
 * 环境间变量/前置逻辑往往不同（本机 cp 与远程 scp 依赖的变量就不一样），
 * 共享前置会把一个环境的假设泄漏给另一个环境；包成函数可保证零耦合，
 * 且 `set -e` 在函数内生效、退出码向外传播。
 */

/** envId 白名单：必须能作为 bash 函数名的一部分 */
const ENV_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** 函数名前缀（保证数字开头的 envId 也合法） */
const FN_PREFIX = '__branch_';

export interface EnvBranchResult {
  /** 拼装出的脚本正文（写入 command 列与 actions[shell].code） */
  script: string;
  /** 已配置的环境（按传入顺序） */
  envs: string[];
}

/**
 * 把「环境 → 脚本」拼装成单一执行脚本。
 *
 * @throws 分支配置为空 / envId 非法 / 脚本为空
 */
export function buildEnvBranchScript(branches: Record<string, string>): EnvBranchResult {
  const envs = Object.keys(branches ?? {});
  if (!envs.length) throw new Error('环境分支为空：至少配置一个环境的脚本');

  const fns: string[] = [];
  for (const env of envs) {
    if (!ENV_ID_RE.test(env)) {
      throw new Error(`环境 ID 非法: ${env}（只允许字母/数字/下划线/连字符，长度 1-32）`);
    }
    const body = String(branches[env] ?? '').replace(/\s+$/, '');
    if (!body.trim()) throw new Error(`环境 ${env} 的脚本为空（未配置脚本的环境请在页面删除该分支）`);
    fns.push(`${FN_PREFIX}${env}() {\n${indent(body)}\n}`);
  }

  const dispatch = envs.map((e) => `  ${e}) ${FN_PREFIX}${e} ;;`).join('\n');

  const script = `#!/usr/bin/env bash
# 自动生成：由「环境分支」配置拼装（勿手改 —— 改请到节点编辑器 → 环境分支）
# 未配置脚本的环境 → fail-fast（不做静默回落）
set -euo pipefail
: "\${DEPLOY_ENV:?缺少 DEPLOY_ENV（发布必须指定环境）}"

# ── 各环境分支体（自包含，互不共享变量）──
${fns.join('\n\n')}

# ── 分派 ──
case "$DEPLOY_ENV" in
${dispatch}
  *)
    echo "[env-branch] 环境 $DEPLOY_ENV 未配置发布脚本" >&2
    echo "[env-branch] 处置：流水线编辑 → 本节点 → 环境分支 → 新增该环境的脚本" >&2
    exit 1
    ;;
esac
`;

  return { script, envs };
}

/** 判断某脚本是否由本模块拼装（含分派标记） */
export function isEnvBranchScript(script: string | null | undefined): boolean {
  return !!script && script.includes(`${FN_PREFIX}`);
}

/**
 * 从拼装结果反解出「环境 → 脚本」（用于迁移存量脚本 / 编辑页回显兜底）。
 * 非拼装脚本返回 null（调用方据此判断该节点尚未启用环境分支）。
 */
export function parseEnvBranchScript(
  script: string | null | undefined,
): Record<string, string> | null {
  if (!isEnvBranchScript(script)) return null;
  const src = String(script);
  const out: Record<string, string> = {};
  const re = new RegExp(`^${FN_PREFIX}([A-Za-z0-9_-]+)\\(\\) \\{\\n([\\s\\S]*?)\\n\\}$`, 'gm');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out[m[1]] = dedent(m[2]);
  }
  return Object.keys(out).length ? out : null;
}

function indent(body: string): string {
  return body
    .split('\n')
    .map((l) => (l.trim() ? `  ${l}` : l))
    .join('\n');
}

function dedent(body: string): string {
  const lines = body.split('\n');
  const pad = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.length - l.replace(/^ +/, '').length),
  );
  return lines.map((l) => (pad > 0 && l.startsWith(' '.repeat(pad)) ? l.slice(pad) : l)).join('\n');
}
