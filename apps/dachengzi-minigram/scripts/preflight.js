#!/usr/bin/env node
/**
 * 出码前预检（preflight）—— 四项硬检查，接在 publish.js 的 preview / upload 之前
 *
 * 🔴 为什么要有这个文件（真实事故面，已取证）：
 *    工作区里同时存在多个 worktree，其中一个名为 `web_system-dachengzi` 的目录
 *    分支叫 `devtools/dachengzi-preview`（名字直译「大橙子预览」，最像出码处），
 *    但它是 **1.0.14 的老代码**：
 *      · `package.json.version = 1.0.14`（不是 1.0.18）
 *      · `utils/version.ts` **不存在**（1.0.17 才引入）
 *      · 与 1.0.18 基线差 112 个文件（含整页 pages/chat/*）
 *      · 包根躺着一个 1679 B 的真实 `private.key`
 *    任何人想「给大橙子出个预览码」，第一直觉就是打开这个目录 ——
 *    一次误操作 = 发出去 1.0.14 旧包（微信**不支持回退已发版本**）+ 上传私钥随包外发。
 *
 * 🔴 两道闸只关了一道：
 *    `.gitignore` 有 `*.key`（私钥没进 git，好事），但 `project.config.json` 的
 *    `packOptions.ignore` 不含任何 key 规则 → **打包闸门不拦**。
 *    而 `docs/miniprogram/release-runbook.md` §1.1 的自检两条（`git check-ignore` 命中 +
 *    `git log --all` 为空）**都只验 git 闸门**。所以「私钥不入包」必须在这里单独兜。
 *
 * 🔴 设计取向：宁可跑不起来，也不发错包。
 *    P1/P2 失败 = 硬阻断（exit 1），不是警告。P4 只警告不阻断（目录命名没法当判据）。
 *
 * 用法（一般不直接跑，由 publish.js 调）：
 *   node scripts/preflight.js                    以本包为根跑四项检查
 *   node scripts/preflight.js --expect-sha 47f74ba8
 *   node scripts/preflight.js --root <路径>      指定待检包根（只读，不改任何文件）
 *
 * 边界：零第三方依赖、只读（除 git 子进程外不产生任何副作用、不写文件）、
 *      不打印任何密钥内容（只打文件名/大小/时间）。
 */

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

/** 本包根（scripts/ 的上一级）。允许调用方用 opts.root 覆盖（单测 / 只读实测用）。 */
const DEFAULT_ROOT = path.join(__dirname, '..');

/** 认定为「密钥文件」的扩展名。`.pub` 不算（公钥可公开），`.example` 是模板更不算。 */
const KEY_EXT = /\.(key|pem)$/i;
const KEY_TEMPLATE = /\.(example|sample|template)$/i;

/**
 * 深扫密钥时的跳目录：node_modules 里装着整个生态的测试证书，扫它只会制造噪声；
 * .git 是对象库不是包内容；.ci-output 是出码产物目录（本来也不进包）。
 */
const DEEP_SCAN_SKIP = new Set(['node_modules', '.git', '.ci-output', '.DS_Store']);

/** 深扫最大层数。包根一级以外纯属「多一层保险」，不追求全覆盖。 */
const DEEP_SCAN_MAX_DEPTH = 4;

/**
 * 合法出码目录名白名单（P4 只警告不阻断）：
 *   web_system、web_system-1018、web_system-1018-r2、web_system-9027 …
 * 反例：web_system-dachengzi（危险目录）、web_system-pkgkey（任务分支 worktree）。
 * 判据只能是「末段是四位任务号（可带 -r 轮次）」，这是本团队 worktree 的既有命名习惯。
 */
const ALLOWED_DIR_NAME = /^web_system(-\d{4}(-r\d+)?)?$/;

// ---------- 小工具 ----------

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** 读 utils/version.ts 里的 APP_VERSION 字面量；返回 '' 表示没找到。 */
function readAppVersionConst(root) {
  try {
    const src = fs.readFileSync(path.join(root, 'utils', 'version.ts'), 'utf-8');
    const m = src.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isKeyFile(name) {
  return KEY_EXT.test(name) && !KEY_TEMPLATE.test(name);
}

/** 本地时间 yyyy-MM-dd HH:mm:ss（不用 ISO，避免与 runbook 里的本地时间对不上）。 */
function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 描述一个命中文件：只报名字/大小/时间，绝不读内容。 */
function describeHit(dir, name) {
  const full = path.join(dir, name);
  let size = -1;
  let mtime = '';
  try {
    const st = fs.statSync(full);
    size = st.size;
    mtime = fmtLocal(st.mtime);
  } catch {
    /* 读不到 stat 就只报路径 */
  }
  return { path: full, name, size, mtime };
}

/**
 * 扫密钥文件。
 *   · 包根一级命中 → 由 P2 判为**失败**（会随包外发）；
 *   · 更深层命中   → 只进 warnings（同样是风险，但可能是 vender 的测试固件，
 *                    先不阻断，交给 reviewer 判断；见回执「已知局限」）。
 */
function scanKeys(root) {
  const rootHits = [];
  const deepHits = [];

  for (const name of safeReaddir(root)) {
    let st;
    try {
      st = fs.lstatSync(path.join(root, name));
    } catch {
      continue;
    }
    if (st.isFile() && isKeyFile(name)) rootHits.push(describeHit(root, name));
  }

  const walk = (dir, depth) => {
    if (depth > DEEP_SCAN_MAX_DEPTH) return;
    for (const name of safeReaddir(dir)) {
      if (DEEP_SCAN_SKIP.has(name)) continue;
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (st.isFile() && isKeyFile(name)) deepHits.push(describeHit(dir, name));
    }
  };
  walk(root, 1);

  // 包根一级已由 P2 判为失败，深扫只报「包根以外」的命中，避免同一条重复两遍。
  const rootSet = new Set(rootHits.map((h) => h.path));
  return { rootHits, deepHits: deepHits.filter((h) => !rootSet.has(h.path)) };
}

/**
 * 取 git 身份；不抛异常（git 不可用 / 非仓库 → 返回 ok:false 由调用方降级为警告）。
 * toplevel = 仓库/worktree 顶层，P4 的目录白名单判的是它（不是 apps/dachengzi-minigram 这级）。
 */
function readGitIdentity(root, execFileSync) {
  const git = (args) => {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return typeof out === 'string' ? out.trim() : '';
  };
  try {
    return {
      ok: true,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      sha: git(['rev-parse', '--short', 'HEAD']),
      toplevel: git(['rev-parse', '--show-toplevel']),
    };
  } catch (e) {
    return { ok: false, branch: '', sha: '', toplevel: '', error: String((e && e.message) || e) };
  }
}

// ---------- 主体 ----------

/**
 * 跑出码前四项检查。
 *
 * @param {object} [opts]
 * @param {string} [opts.root]          待检包根，默认本包（scripts/ 的上一级）
 * @param {string} [opts.expectVersion] 期望版本；缺省从 package.json.version 推导
 * @param {string} [opts.expectSha]     期望 HEAD 短 sha；给了就核对，不符即失败
 * @param {Function} [opts.execFileSync] 注入点（单测用），默认 child_process.execFileSync
 * @returns {{ok:boolean, failures:Array, info:object}}
 */
function runPreflight(opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const execFileSync = opts.execFileSync || childProcess.execFileSync;

  const failures = [];
  const warnings = [];
  const fail = (code, title, detail, hint) => failures.push({ code, title, detail, hint });

  // ---------- P1 版本真实性 ----------
  // 判据链：package.json.version 必须存在；utils/version.ts 必须存在且能读出 APP_VERSION；
  //        两者必须字面相等；两者都必须等于期望版本（缺省＝package.json.version）。
  let pkgVersion = '';
  let appVersion = '';
  let versionTsExists = false;
  let expectVersion = opts.expectVersion || '';

  try {
    const pkg = readJson(path.join(root, 'package.json'));
    pkgVersion = typeof pkg.version === 'string' ? pkg.version : '';
    if (!pkgVersion) fail('P1', 'package.json 里没有 version 字段', `读取：${path.join(root, 'package.json')}`, '补齐 version 后重试');
  } catch (e) {
    fail(
      'P1',
      '读不到 package.json',
      `路径：${path.join(root, 'package.json')} · ${String((e && e.message) || e)}`,
      '确认 --root / 当前目录就是小程序包根（package.json 就在这一级）',
    );
  }

  versionTsExists = fs.existsSync(path.join(root, 'utils', 'version.ts'));
  if (versionTsExists) {
    appVersion = readAppVersionConst(root);
  }

  if (!versionTsExists) {
    // 🔴 这是识别「1.0.14 老目录」最灵敏的信号：utils/version.ts 是 1.0.17 才引入的。
    //    老目录里 package.json 也停在旧版本号，光看 package.json 还可能以为是「某个历史版本」，
    //    但少了 version.ts 就直接证明「这个目录的结构比当前基线还老」。
    fail(
      'P1',
      'utils/version.ts 不存在',
      `路径：${path.join(root, 'utils', 'version.ts')}（package.json=${pkgVersion || '读不到'}）`,
      '这个文件是 1.0.17 才引入的：没有它＝目录停在 1.0.14/1.0.16 一类的老基线。'
        + '极可能站错目录（例如 web_system-dachengzi），先确认 worktree，别在这里出码',
    );
  } else if (!appVersion) {
    fail(
      'P1',
      'utils/version.ts 里读不到 APP_VERSION',
      `路径：${path.join(root, 'utils', 'version.ts')}`,
      '导出形如 `export const APP_VERSION = \'1.0.18\';`，补上后重试',
    );
  }

  if (!expectVersion && pkgVersion) expectVersion = pkgVersion; // 未显式声明 → 从 package.json 推导

  if (pkgVersion && appVersion && pkgVersion !== appVersion) {
    fail(
      'P1',
      '两处版本号不一致',
      `package.json=${pkgVersion}，utils/version.ts=${appVersion}`,
      '两处必须字面相等（1.0.17 的「包是 1.0.17、关于页显示 v1.0.0」事故就是这么漏的）',
    );
  }

  if (expectVersion && pkgVersion && expectVersion !== pkgVersion) {
    fail(
      'P1',
      'package.json 版本 ≠ 期望版本',
      `package.json=${pkgVersion}，期望=${expectVersion}`,
      '站错目录或忘 bump 版本。微信**不支持回退已发版本**，发出去就收不回来',
    );
  }

  if (expectVersion && appVersion && expectVersion !== appVersion) {
    fail(
      'P1',
      'APP_VERSION ≠ 期望版本',
      `utils/version.ts=${appVersion}，期望=${expectVersion}`,
      '把 APP_VERSION 改成期望版本后重试',
    );
  }

  // ---------- P2 私钥不入包（P0 安全项） ----------
  let keyScan = { rootHits: [], deepHits: [] };
  try {
    keyScan = scanKeys(root);
  } catch (e) {
    warnings.push(`P2 密钥扫描异常：${String((e && e.message) || e)}`);
  }

  for (const hit of keyScan.rootHits) {
    fail(
      'P2',
      `包根存在密钥文件：${hit.name}`,
      `${hit.path}（${hit.size} B，${hit.mtime}）`,
      '这个文件会随包一起外发。出码前必须把它移出包根；'
        + '同时确认 project.config.json 的 packOptions.ignore 已覆盖 *.key / *.pem（打包闸门）',
    );
  }
  for (const hit of keyScan.deepHits) {
    warnings.push(
      `P2 深层发现密钥文件（未阻断，请人工确认是否会被打包）：${hit.path}（${hit.size} B，${hit.mtime}）`,
    );
  }

  // ---------- P3 工作区身份 ----------
  const git = readGitIdentity(root, execFileSync);
  if (!git.ok) {
    warnings.push(`P3 读不到 git 身份（可能不是 git 仓库 / worktree 未登记）：${git.error || '未知原因'}`);
  }
  if (opts.expectSha) {
    if (!git.ok || !git.sha) {
      fail(
        'P3',
        '无法核对期望 sha',
        `期望=${opts.expectSha}，但读不到当前 HEAD`,
        '确认目录是 git 仓库且 git 可用；或去掉 --expect-sha（此时 P3 只打印不判定）',
      );
    } else if (!isSameSha(git.sha, opts.expectSha)) {
      fail(
        'P3',
        'HEAD 与期望 sha 不符',
        `当前 HEAD=${git.sha}（${git.branch || 'detached'}），期望=${opts.expectSha}`,
        '站错 worktree 了。切到期望提交所在目录再出码；确认无误要硬出，可显式 --skip-preflight（会打印风险提示）',
      );
    } else {
      warnings.push(`P3 已按调用方声明的 --expect-sha 核对通过：${git.sha}`);
    }
  } else if (git.ok) {
    warnings.push(`P3 未声明 --expect-sha：只打印分支/sha，不做判定（当前 ${git.branch}@${git.sha}）`);
  }

  // ---------- P4 目录白名单提示（只警告，不阻断） ----------
  // 判的是 **worktree 顶层名**（web_system-dachengzi），不是包目录名（apps/dachengzi-minigram，
  // 后者在每个 worktree 里都一样，判它等于不判）。
  const projectName = pickProjectName(root, git.toplevel);
  const dirAllowed = ALLOWED_DIR_NAME.test(projectName);
  if (!dirAllowed) {
    warnings.push(
      `P4 项目目录不在出码白名单内：${projectName}（白名单形如 web_system-1018 / web_system-1018-r2）。`
        + '发布类 worktree 用任务号命名 —— 分支名好听不代表代码是对的',
    );
  }

  const info = {
    root,
    pkgVersion,
    appVersion,
    versionTsExists,
    expectVersion,
    branch: git.branch,
    headSha: git.sha,
    gitOk: git.ok,
    expectSha: opts.expectSha || '',
    projectName,
    dirAllowed,
    rootKeyHits: keyScan.rootHits,
    deepKeyHits: keyScan.deepHits,
    warnings,
  };

  return { ok: failures.length === 0, failures, info };
}

/**
 * 取「项目目录名」用于 P4 白名单判定：
 *   1. git 可用 → worktree 顶层目录名（权威）；
 *   2. 非 git（例如单测的临时目录）→ 从包根往上找第一个 web_system* 段；
 *   3. 都找不到 → 包根名。
 */
function pickProjectName(root, toplevel) {
  if (toplevel) return path.basename(toplevel);
  const segs = root.split(path.sep).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (/^web_system/.test(segs[i])) return segs[i];
  }
  return path.basename(root);
}

/** sha 前缀比较：短 sha 与全 sha 都能对上（大小写不敏感）。 */function isSameSha(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

// ---------- 输出 ----------

/**
 * 打印预检报告。失败项打在 stderr（红字可见），信息行打在 stdout。
 * 只打印文件名/大小/时间，不打印密钥内容。
 */
function printReport(result, io = {}) {
  const log = io.log || console.log;
  const err = io.error || console.error;
  const { info, failures } = result;

  log('[Preflight] 出码前检查（4 项）');
  log(`[Preflight]   目录   ${info.root}`);
  log(`[Preflight]   版本   package.json=${info.pkgVersion || '(读不到)'}`
    + ` · utils/version.ts=${info.versionTsExists ? info.appVersion || '(读不到 APP_VERSION)' : '(文件不存在)'}`
    + ` · 期望=${info.expectVersion || '(未声明)'}`);
  log(`[Preflight]   身份   ${info.gitOk ? `${info.branch}@${info.headSha}` : '(读不到 git 身份)'}`);

  for (const w of info.warnings) log(`[Preflight] ⚠️ ${w}`);

  if (failures.length === 0) {
    log('[Preflight] ✅ 四项检查通过，可以出码');
    return;
  }

  err(`[Preflight] ❌ 出码前检查未通过（${failures.length} 项失败），已阻断：`);
  for (const f of failures) {
    err(`[Preflight]   [${f.code}] ${f.title}`);
    err(`[Preflight]        ${f.detail}`);
    if (f.hint) err(`[Preflight]        处置：${f.hint}`);
  }
  err('[Preflight] 确认无误要硬出，可显式加 --skip-preflight（会打印「风险自负」提示）');
}

// ---------- CLI ----------

function parsePreflightArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--expect-sha') opts.expectSha = argv[++i];
    else if (a.startsWith('--expect-sha=')) opts.expectSha = a.slice('--expect-sha='.length);
    else if (a === '--expect-version') opts.expectVersion = argv[++i];
    else if (a.startsWith('--expect-version=')) opts.expectVersion = a.slice('--expect-version='.length);
    else opts._.push(a);
  }
  return opts;
}

if (require.main === module) {
  const opts = parsePreflightArgs(process.argv.slice(2));
  const result = runPreflight(opts);
  printReport(result);
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  runPreflight,
  printReport,
  parsePreflightArgs,
  isSameSha,
  readAppVersionConst,
  scanKeys,
  isKeyFile,
  DEFAULT_ROOT,
  ALLOWED_DIR_NAME,
  KEY_EXT,
  KEY_TEMPLATE,
  DEEP_SCAN_MAX_DEPTH,
};
