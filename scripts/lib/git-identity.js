/**
 * git-identity — 「我正在测/出的到底是哪份代码」的判据（零外部依赖，纯函数 + 注入 exec）
 *
 * ⚠️ 本文件是 **唯一实现**：`scripts/lib/miniprogram-preflight.js`（P3 版本真实性）与
 *    `packages/mp-e2e/src/version-guard.js`（E2E 版本守卫）都 require 本文件，两处不再各留副本。
 *    逻辑从 preflight 侧逐字搬出，零改动（含 `git status --short` 必须保留前导空格的 `keepLeading` 口径）。
 *    **改动此处同时影响出码前预检与 E2E**：任何一侧语义漂移都会让
 *    「出码前预检说版本对」与「E2E 说版本对」得出不同结论。
 *
 * 为什么要有它（真实事故，2026-11-27 大橙子整包编译失败）：
 *   两个 worktree 并存（坏的 diag / 好的 fix），开发者工具开着 A 目录、E2E 命令跑在 B 目录，
 *   `@web-system/mp-e2e` 只把 `e2e.config.js` 所在目录当 projectPath、完全不读 git HEAD，
 *   于是「测的是哪份代码」这件事从未被核对过 —— 结论一度错判。
 *
 * exec 注入约定：`execFileSync` 由调用方传入（`require('child_process').execFileSync`），
 * 这样单测可以喂假实现，不依赖真实仓库状态。
 */

'use strict';

/**
 * 取 git 身份；**不抛异常**（git 不可用 / 非仓库 → 返回 ok:false 由调用方降级为警告）。
 *
 * toplevel = 仓库/worktree 顶层，判断「目录白名单」时判的是它（不是 `apps/<app>` 这级）。
 * status   = `git status --short` 原文（调用方据此判断工作区是否脏）。
 * dirty    = status 去空白后是否非空（新增字段：抽取时补上的派生值，避免每个调用方各写一遍）。
 *
 * @param {string} root 起点目录（git 用 `-C root`，可在子目录下调用）
 * @param {Function} execFileSync 注入的 child_process.execFileSync
 * @returns {{ok: boolean, branch: string, sha: string, toplevel: string, status: string, dirty: boolean, error?: string}}
 */
function readGitIdentity(root, execFileSync) {
  const git = (args, { keepLeading = false } = {}) => {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const str = typeof out === 'string' ? out : '';
    // `git status --short` 的前两列是状态码，" M path" 与 "M  path" 语义不同 —— 不能 trim 前导空格
    return keepLeading ? str.replace(/\n$/, '') : str.trim();
  };
  try {
    const status = git(['status', '--short'], { keepLeading: true });
    return {
      ok: true,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      sha: git(['rev-parse', '--short', 'HEAD']),
      toplevel: git(['rev-parse', '--show-toplevel']),
      status,
      dirty: status.trim().length > 0,
    };
  } catch (e) {
    return {
      ok: false,
      branch: '',
      sha: '',
      toplevel: '',
      status: '',
      dirty: false,
      error: String((e && e.message) || e),
    };
  }
}

/** sha 前缀比较：短 sha 与全 sha 都能对上（大小写不敏感）。 */
function isSameSha(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * 解析期望 sha 候选列表：逗号分隔、trim、去空。
 * 支持一次给多个候选（命中任一即通过），用于「同一个包在 A、B 两个基线之一上测都算合法」的场景。
 *
 * @param {string} s 形如 `abc1234, def5678`（也允许空 / 单个）
 * @returns {string[]} 例如 `['abc1234', 'def5678']`；空输入返回 `[]`
 */
function parseShaList(s) {
  return String(s == null ? '' : s)
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * 人读版本标识：正常 `<branch>@<sha>`；detached HEAD → `<sha>`；
 * git 读不到 → `(git 不可用)`（不抛异常，交给调用方决定是否升级为错误）。
 *
 * @param {{ok: boolean, branch: string, sha: string}} git readGitIdentity 的返回值
 * @returns {string}
 */
function describeIdentity(git) {
  if (!git || !git.ok) return '(git 不可用)';
  const sha = String(git.sha || '');
  const branch = String(git.branch || '');
  // detached HEAD 时 `git rev-parse --abbrev-ref HEAD` 返回字面量 `HEAD`
  if (!branch || branch === 'HEAD') return sha || '(git 不可用)';
  return `${branch}@${sha}`;
}

module.exports = { readGitIdentity, isSameSha, parseShaList, describeIdentity };
