/**
 * 版本一致性守卫 —— 「正在测的是哪份代码」（E2E 前置，秒级，红在 launch 之前）
 *
 * 背景（真实事故，2026-11-27）：两个 worktree 并存（坏的 diag / 好的 fix），
 *   微信开发者工具开着 A 目录、E2E 命令跑在 B 目录。本包此前**从不核对 git HEAD**：
 *   它只把 `e2e.config.js` 所在目录当 `projectPath`，测哪些文件由 cwd 决定。
 *   于是「这轮结论到底属于哪份代码」无法回答，排查时一度错判。
 *
 * 判据设计原则（为什么默认「只打印不判定」）：
 *   存量调用方（`pnpm --filter <app> test:e2e`）**不设** `MP_E2E_EXPECT_SHA`，
 *   本守卫对它们必须 100% 零行为变化 —— 只多打印一行版本信息。
 *   只有**显式声明**了期望 sha（CI / 出码后回归 / 跨 worktree 排查）才升级为硬判据：
 *   声明了期望就必须能核对，读不到 git 也**不许**静默放过。
 *
 * 判定矩阵：
 *   非 git 工作区 / git 不可用 + 未设变量 → 打印「无法读取」，不失败
 *   正常                                  → 打印 `<branch>@<sha>`
 *   工作区脏（dirty）                     → 追加一行 warn，**不失败**（避免污染现有工作流）
 *   未设 `MP_E2E_EXPECT_SHA`              → 只打印，返回 matched:null（未判定）
 *   设了且匹配（前缀/大小写不敏感，逗号多候选命中任一） → 打印 OK
 *   设了且不匹配                          → throw（文案含实际 sha / 期望候选 / 被测目录 / 修法）
 *   设了但读不到 git                      → throw
 *
 * 共享层解析用「try/catch + 降级跳过」而不是硬 require：
 *   本包是可被单独拷进别的仓库的基建包，`scripts/lib/git-identity.js` 不一定在，
 *   那条路径下应当降级为「跳过版本校验」而不是让 E2E 起不来。
 */

'use strict';

const path = require('path');
const { execFileSync: defaultExecFileSync } = require('child_process');

/** 共享判据（版本真实性 P3 的抽取副本）在仓库根的位置：mp-e2e/src → ../../.. = 仓库根 */
const SHARED_IDENTITY_PATH = path.resolve(__dirname, '../../../scripts/lib/git-identity.js');

/** 期望 sha 的环境变量名（与 preflight 的 `--expect-sha` 同义，两处独立入口） */
const EXPECT_SHA_ENV = 'MP_E2E_EXPECT_SHA';

/**
 * 加载共享层；失败返回 null 由调用方降级（不抛）。
 * 抽成函数是为了让单测能注入「加载失败」这一格（见 tests/unit/version-guard.test.js）。
 */
function loadSharedIdentity() {
  try {
    // eslint-disable-next-line
    return require(SHARED_IDENTITY_PATH);
  } catch (e) {
    return null;
  }
}

/**
 * 核对「被测目录的 git 身份」与「调用方声明的期望 sha」是否一致。
 *
 * @param {object} opts
 * @param {string} opts.projectPath 被测小程序目录（e2e.config.js 解析出的 projectPath，绝对路径）
 * @param {object} [opts.env] 环境变量（默认 process.env；单测注入）
 * @param {Function} [opts.execFileSync] 注入的 child_process.execFileSync（单测注入假实现）
 * @param {Function} [opts.log] 打印函数（默认 console.log；单测注入收集器）
 * @param {Function} [opts.loadIdentity] 共享层加载器（默认 require 共享层；单测注入 null 覆盖降级分支）
 * @returns {{ok: boolean, sha: string, branch: string, dirty: boolean, matched: boolean|null}}
 *          `matched`：未声明期望 → null（未判定）；声明并命中 → true。不匹配一律 throw，故不会返回 false。
 *          `ok`：表示「本次未被本守卫阻断」（降级跳过也算 true），不表示「版本已核对」。
 * @throws {Error} 声明了 `MP_E2E_EXPECT_SHA` 但读不到 git / 与实际 sha 不匹配
 */
function checkVersionConsistency({
  projectPath,
  env = process.env,
  execFileSync = defaultExecFileSync,
  log = console.log,
  loadIdentity = loadSharedIdentity,
} = {}) {
  const shared = loadIdentity();
  if (!shared) {
    // 被单独拷走的场景：宁可少一层校验，也不能让 E2E 起不来
    log(`[mp-e2e] warning: 共享层 ${SHARED_IDENTITY_PATH} 加载失败 —— 跳过版本一致性校验`);
    return { ok: true, sha: '', branch: '', dirty: false, matched: null };
  }

  const { readGitIdentity, isSameSha, parseShaList, describeIdentity } = shared;
  const expectShas = parseShaList(env[EXPECT_SHA_ENV]);
  const git = readGitIdentity(projectPath, execFileSync);

  if (!git.ok) {
    if (expectShas.length > 0) {
      // 声明了期望就必须能核对：读不到就红，不许静默放过（否则这个变量等于空转）
      throw new Error(
        `[mp-e2e] 版本一致性校验失败：声明了 ${EXPECT_SHA_ENV}=${expectShas.join(',')}，但读不到被测目录的 git 身份。\n` +
          `  被测目录：${projectPath}\n` +
          `  期望 sha：${expectShas.join(' | ')}\n` +
          `  git 报错：${git.error || '(无输出)'}\n` +
          `  处置：① 确认被测目录在 git 仓库内（\`git -C ${projectPath} status\` 应能跑通）；` +
          `或 ② 去掉 ${EXPECT_SHA_ENV} 再跑（本守卫默认只打印不判定）。`,
      );
    }
    log('[mp-e2e] 版本：无法读取（非 git 工作区或 git 不可用）');
    return { ok: true, sha: '', branch: '', dirty: false, matched: null };
  }

  log(`[mp-e2e] 版本：${describeIdentity(git)}`);
  if (git.dirty) {
    // 只 warn 不失败：现网开发流里长期存在未提交改动，判红会污染既有工作流
    log('[mp-e2e] 版本：（工作区有未提交改动，测的不是已提交版本）');
  }

  if (expectShas.length === 0) {
    // 默认路径：与引入本守卫之前的行为 100% 一致（多打印而已）
    return { ok: true, sha: git.sha, branch: git.branch, dirty: git.dirty, matched: null };
  }

  const matched = expectShas.some((s) => isSameSha(git.sha, s));
  if (!matched) {
    throw new Error(
      `[mp-e2e] 版本一致性校验失败：实际 HEAD 与期望 sha 不一致（测的不是你以为的那份代码）。\n` +
        `  实际 HEAD：${git.sha}（${describeIdentity(git)}${git.dirty ? '，工作区有未提交改动' : ''}）\n` +
        `  期望 sha：${expectShas.join(' | ')}（来自 ${EXPECT_SHA_ENV}）\n` +
        `  被测目录：${projectPath}${git.toplevel ? `（所属仓库：${git.toplevel}）` : ''}\n` +
        `  处置：① 切到期望版本再跑：\`git -C ${projectPath} switch <期望分支>\`；` +
        `或 ② 去掉 ${EXPECT_SHA_ENV} 再跑（默认只打印不判定）。\n` +
        `  提示：多 worktree 并存时，开发者工具打开的目录（projectPath）与命令所在目录是两个独立事实，` +
        `本守卫核对的是前者。`,
    );
  }

  log('[mp-e2e] 版本一致性 OK');
  return { ok: true, sha: git.sha, branch: git.branch, dirty: git.dirty, matched: true };
}

module.exports = { checkVersionConsistency, EXPECT_SHA_ENV, SHARED_IDENTITY_PATH };
