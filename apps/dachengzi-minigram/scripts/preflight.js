#!/usr/bin/env node
/**
 * 出码前预检（preflight）—— 六项检查，接在 publish.js 的 preview / upload 之前
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
 *    `packOptions.ignore` 曾不含任何 key 规则 → **打包闸门不拦**。
 *    而 `docs/miniprogram/release-runbook.md` §1.1 的自检两条（`git check-ignore` 命中 +
 *    `git log --all` 为空）**都只验 git 闸门**。所以「私钥不入包」必须在这里单独兜。
 *    （PR #690 已给 packOptions.ignore 补上 `private.key`；本文件 P2 会**自动核这条规则在不在**，
 *      规则被谁删掉都会立刻变红 —— 两道闸从此互为证据，而不是各说各话。）
 *
 * 🔴 设计取向：宁可跑不起来，也不发错包。
 *    P1/P2/P3/P5/P6 失败 = 硬阻断（exit 1），不是警告；P4 默认只警告（目录命名没法单独当判据，
 *    但可用 `--require-dir` 升级为硬拦）。
 *
 * 🔴 六项检查（顺序即打印顺序；**不短路**，一次把全部问题列出来，避免「改一条又冒一条」）：
 *    P1 版本真实性   package.json.version == utils/version.ts 的 APP_VERSION，且都 == 期望版本；
 *                    **version.ts 不存在直接失败**（识别 1.0.14 老目录最灵敏的信号）
 *    P2 私钥不入包   cli 模式：包根出现 *.key / *.pem → 失败（cli 根本不需要私钥，它在那儿纯属风险）；
 *                    ci 模式：包根私钥是**必需的**（preview.js:54 / upload.js:31 硬编码路径，无 env 覆盖），
 *                    故不阻断，但必须满足「packOptions.ignore 已覆盖私钥」→ 否则失败（那才是真会随包外发）
 *    P3 工作区身份   打印 分支@sha；给了 --expect-sha 就核对（支持逗号分隔的多个候选 sha），不符即失败
 *    P4 目录白名单   worktree 顶层名不在 web_system-<任务号> 内 → 警告；`--require-dir <正则>` 可升级为硬拦
 *    P5 工作区干净   `git status --short` 里有**会进包**的未提交改动 → 失败（`--allow-dirty` 显式放行）
 *    P6 CLI 可执行   cli 模式：`WECHAT_DEVTOOLS_CLI` 存在且可执行，否则回退 `which cli`，都没有 → 失败
 *                    （这是发布全程唯一的硬缺口：不设该变量时 publish.js 回落字面量 'cli' → spawnSync ENOENT）
 *
 * 用法（一般不直接跑，由 publish.js 调）：
 *   node scripts/preflight.js                                 以本包为根跑六项检查
 *   node scripts/preflight.js --mode ci
 *   node scripts/preflight.js --expect-sha 47f74ba8,019d282b
 *   node scripts/preflight.js --require-dir '^web_system-1018(-r2)?$'
 *   node scripts/preflight.js --root <路径>                    指定待检包根（只读，不改任何文件）
 *
 * 边界：零第三方依赖、只读（除 git / which 子进程外无副作用、不写文件）、
 *      不打印任何密钥内容（只打文件名/大小/时间）、不 spawn 微信开发者工具 CLI（只查文件可执行位）。
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
 * 出码目录名白名单形态（P4）：web_system、web_system-1018、web_system-1018-r2、web_system-9027 …
 * 反例：web_system-dachengzi（危险目录）、web_system-pkgkey（任务分支 worktree）。
 * 判据只能是「末段是四位任务号（可带 -r 轮次）」，这是本团队 worktree 的既有命名习惯。
 * 发布单建议显式加 `--require-dir '^web_system-1018(-r2)?$'` 收紧到当前发布轮次。
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
 *   · 包根一级命中 → 交给 P2 判定（cli 失败 / ci 视 ignore 规则）；
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

  // 包根一级已由 P2 处理，深扫只报「包根以外」的命中，避免同一条重复两遍。
  const rootSet = new Set(rootHits.map((h) => h.path));
  return { rootHits, deepHits: deepHits.filter((h) => !rootSet.has(h.path)) };
}

/**
 * 读 project.config.json 的 packOptions.ignore，并判断它是否覆盖「包根密钥文件」。
 *
 * 🔴 为什么要在这里核 ignore：ci 模式**必须**把 private.key 放在包根
 *    （preview.js:54 / upload.js:31 都是 `path.join(ROOT,'private.key')`，无 env 覆盖），
 *    此时「私钥不入包」就**只剩 packOptions.ignore 这一道闸**。
 *    这条规则被谁删掉（或从来没人加），这里必须立刻变红 —— 否则 ci 模式就是「能用但必然泄密」。
 */
function readPackIgnores(root) {
  try {
    const cfg = readJson(path.join(root, 'project.config.json'));
    const ignores = (cfg && cfg.packOptions && cfg.packOptions.ignore) || [];
    return { ok: true, ignores: Array.isArray(ignores) ? ignores : [] };
  } catch {
    return { ok: false, ignores: [] };
  }
}

/** ignore 列表里是否存在能盖住「密钥文件」的规则（按 miniprogram 的 type 语义判）。 */
function ignoreCoversKeys(ignores, fileName) {
  const name = String(fileName || 'private.key').toLowerCase();
  return ignores.some((e) => {
    if (!e || typeof e.value !== 'string') return false;
    const v = e.value.trim().toLowerCase();
    if (e.type === 'file') return v === name || KEY_EXT.test(v);
    if (e.type === 'suffix') return v === '.key' || v === '.pem';
    if (e.type === 'glob' || e.type === 'regexp') return v.includes('.key') || v.includes('.pem');
    return false;
  });
}

/**
 * 判断一条 git status 记录「会不会进包」：能进包的未提交改动才该阻断。
 * 只做一级目录/文件名级别的粗判（够用即可）：
 *   · 命中 packOptions.ignore 的 folder/file 规则 → 不进包
 *   · 落地约定里的工具目录（scripts/tests/docs/prototype/typings/.ci-output/node_modules）→ 不进包
 * 判不准时按「会进包」处理（宁可多拦一次，也别放过一次）。
 */
function dirtyEntryShipsPackage(entry, ignores, pkgPrefix = '') {
  // git status --short 形如 " M apps/xxx/file"、"?? path"、"A  path"；取状态之后的路径
  const raw = String(entry || '');
  const rel = raw.slice(2).trim().replace(/^"|"$/g, '');
  if (!rel) return false;
  // 重命名 "R  old -> new"：两边都算
  const paths = rel.split(' -> ').map((s) => s.trim());
  const toolDirs = new Set(['scripts', 'tests', 'docs', 'prototype', 'typings', '.ci-output', 'node_modules']);
  return paths.some((p) => {
    // git status 的路径是**仓库根相对**的（apps/dachengzi-minigram/pages/...），
    // 而打包范围是**包根相对**的。先换算到包内相对路径；不在本包内的改动不影响这个包。
    if (pkgPrefix) {
      if (!p.startsWith(pkgPrefix)) return false;
      p = p.slice(pkgPrefix.length);
    }
    const first = p.split('/')[0];
    if (toolDirs.has(first)) return false;
    const covered = ignores.some((e) => {
      if (!e || typeof e.value !== 'string') return false;
      const v = e.value.trim();
      if (e.type === 'folder') return p === v || p.startsWith(`${v}/`);
      if (e.type === 'file') return p === v || path.basename(p) === v;
      if (e.type === 'suffix') return p.endsWith(v);
      return false;
    });
    return !covered;
  });
}

/**
 * 取 git 身份；不抛异常（git 不可用 / 非仓库 → 返回 ok:false 由调用方降级为警告）。
 * toplevel = 仓库/worktree 顶层，P4 的目录白名单判的是它（不是 apps/dachengzi-minigram 这级）。
 * status   = `git status --short` 原文（P5 用）。
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
    return {
      ok: true,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      sha: git(['rev-parse', '--short', 'HEAD']),
      toplevel: git(['rev-parse', '--show-toplevel']),
      status: git(['status', '--short'], { keepLeading: true }),
    };
  } catch (e) {
    return {
      ok: false,
      branch: '',
      sha: '',
      toplevel: '',
      status: '',
      error: String((e && e.message) || e),
    };
  }
}

/**
 * 检查微信开发者工具 CLI 是否可用（P6）。只查文件可执行位，**不**执行它
 * （出码前预检不得产生任何出码副作用；登录态请出码后人工看 cli islogin）。
 */
function checkDevtoolsCli(execFileSync, env) {
  const configured = String((env && env.WECHAT_DEVTOOLS_CLI) || '').trim();
  const candidates = [];
  if (configured) {
    candidates.push({ path: configured, source: 'env' });
  } else {
    try {
      const found = String(execFileSync('which', ['cli'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }) || '').trim();
      if (found) candidates.push({ path: found, source: 'which' });
    } catch {
      /* cli 不在 PATH */
    }
  }
  for (const c of candidates) {
    try {
      fs.accessSync(c.path, fs.constants.X_OK);
      return { ok: true, path: c.path, source: c.source };
    } catch {
      /* 不可执行，继续看下一个 */
    }
  }
  return { ok: false, path: configured, source: configured ? 'env' : 'missing' };
}

// ---------- 主体 ----------

/**
 * 跑出码前六项检查。
 *
 * @param {object} [opts]
 * @param {string} [opts.root]          待检包根，默认本包（scripts/ 的上一级）
 * @param {'cli'|'ci'} [opts.mode]      出码模式，默认 cli（决定 P2 / P6 的判定力度）
 * @param {string} [opts.expectVersion] 期望版本；缺省从 package.json.version 推导
 * @param {string} [opts.expectSha]     期望 HEAD sha；支持逗号分隔多个候选（命中任一即通过）
 * @param {string|RegExp} [opts.requireDir] 收紧 P4：worktree 顶层名不匹配即**失败**
 * @param {boolean} [opts.allowDirty]   放行「会进包的未提交改动」（P5 降级为警告）
 * @param {Function} [opts.execFileSync] 注入点（单测用），默认 child_process.execFileSync
 * @param {object} [opts.env]           注入点（单测用），默认 process.env
 * @returns {{ok:boolean, failures:Array, info:object}}
 */
function runPreflight(opts = {}) {
  const root = path.resolve(opts.root || DEFAULT_ROOT);
  const execFileSync = opts.execFileSync || childProcess.execFileSync;
  const env = opts.env || process.env;
  const mode = opts.mode === 'ci' ? 'ci' : 'cli';

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

  // ---------- P2 私钥不入包（P0 安全项，按出码模式分层） ----------
  let keyScan = { rootHits: [], deepHits: [] };
  try {
    keyScan = scanKeys(root);
  } catch (e) {
    warnings.push(`P2 密钥扫描异常：${String((e && e.message) || e)}`);
  }

  const packCfg = readPackIgnores(root);
  const rootKeyNames = keyScan.rootHits.map((h) => h.name);
  const ignoreCoversRootKeys = rootKeyNames.length > 0
    && rootKeyNames.every((n) => ignoreCoversKeys(packCfg.ignores, n));

  for (const hit of keyScan.rootHits) {
    const covered = ignoreCoversKeys(packCfg.ignores, hit.name);
    if (mode === 'ci') {
      // ci 模式：私钥是**必需**的（preview.js:54 / upload.js:31 硬编码包根路径）。
      // 此时「私钥不入包」只剩 packOptions.ignore 一道闸 → 规则缺失才是真失败。
      if (!covered) {
        fail(
          'P2',
          `ci 模式：包根密钥未被 packOptions.ignore 覆盖：${hit.name}`,
          `${hit.path}（${hit.size} B，${hit.mtime}）· project.config.json 的 packOptions.ignore 里没有能盖住它的规则`,
          'ci 模式必须把私钥放在包根（脚本硬编码路径，暂无 env 覆盖），所以这里**只能**靠 ignore 拦。'
            + '给 packOptions.ignore 补 {"type":"file","value":"' + hit.name + '"}（或 {"type":"suffix","value":".key"}）后重试',
        );
      } else {
        warnings.push(
          `P2 ci 模式：包根存在 ${hit.name}（${hit.size} B）—— 这是 ci 模式的必需文件，`
            + '已确认被 packOptions.ignore 覆盖（不会进包）。根治办法：让 preview.js/upload.js 支持 '
            + 'MINIPROGRAM_PRIVATE_KEY_PATH，把私钥移出包目录',
        );
      }
    } else {
      // cli 模式：根本不需要私钥（走开发者工具登录态）。它出现在包根 = 纯风险 + 老目录典型症状。
      fail(
        'P2',
        `包根存在密钥文件：${hit.name}`,
        `${hit.path}（${hit.size} B，${hit.mtime}）`,
        'cli 模式出码不需要私钥，它在这里只会随包外发。出码前必须把它移出包根；'
          + '同时确认 project.config.json 的 packOptions.ignore 覆盖 *.key / *.pem（打包闸门）。'
          + '确实要用 ci 模式请显式 --mode ci（那时私钥必需，改由 ignore 规则兜底）',
      );
    }
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
  const expectShas = String(opts.expectSha || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (expectShas.length) {
    if (!git.ok || !git.sha) {
      fail(
        'P3',
        '无法核对期望 sha',
        `期望=${expectShas.join('|')}，但读不到当前 HEAD`,
        '确认目录是 git 仓库且 git 可用；或去掉 --expect-sha（此时 P3 只打印不判定）',
      );
    } else if (!expectShas.some((s) => isSameSha(git.sha, s))) {
      fail(
        'P3',
        'HEAD 与期望 sha 不符',
        `当前 HEAD=${git.sha}（${git.branch || 'detached'}），期望=${expectShas.join('|')}`,
        '站错 worktree 了。切到期望提交所在目录再出码；确认无误要硬出，可显式 --skip-preflight（会打印风险提示）',
      );
    } else {
      warnings.push(`P3 已按调用方声明的 --expect-sha 核对通过：${git.sha}`);
    }
  } else if (git.ok) {
    warnings.push(`P3 未声明 --expect-sha：只打印分支/sha，不做判定（当前 ${git.branch}@${git.sha}）`);
  }

  // ---------- P4 目录白名单（默认警告；--require-dir 升级为硬拦） ----------
  // 判的是 **worktree 顶层名**（web_system-dachengzi），不是包目录名（apps/dachengzi-minigram，
  // 后者在每个 worktree 里都一样，判它等于不判）。
  const projectName = pickProjectName(root, git.toplevel);
  const requireDir = opts.requireDir
    ? (opts.requireDir instanceof RegExp ? opts.requireDir : new RegExp(String(opts.requireDir)))
    : null;
  const dirAllowed = ALLOWED_DIR_NAME.test(projectName);
  const dirMatchesRequired = requireDir ? requireDir.test(projectName) : dirAllowed;
  if (requireDir && !dirMatchesRequired) {
    fail(
      'P4',
      `项目目录不匹配 --require-dir：${projectName}`,
      `当前 worktree 顶层名=${projectName}，要求匹配 /${requireDir.source}/`,
      '发布轮次只允许在指定 worktree 出码。换目录，或确认要放开就改 --require-dir / 用 --skip-preflight',
    );
  } else if (!dirMatchesRequired) {
    warnings.push(
      `P4 项目目录不在出码白名单内：${projectName}（白名单形如 web_system-1018 / web_system-1018-r2）。`
        + '发布类 worktree 用任务号命名 —— 分支名好听不代表代码是对的。'
        + "要硬拦请显式加 --require-dir '^web_system-1018(-r2)?$'",
    );
  }

  // ---------- P5 工作区干净（未提交改动会改变「你发的到底是什么」） ----------
  let dirty = { total: 0, shipping: [], excluded: [] };
  if (git.ok) {
    const pkgPrefix = git.toplevel && root.startsWith(git.toplevel)
      ? `${path.relative(git.toplevel, root).split(path.sep).join('/')}/`
      : '';
    const lines = String(git.status || '').split('\n').map((s) => s.trimEnd()).filter(Boolean);
    dirty.total = lines.length;
    dirty.shipping = lines.filter((l) => dirtyEntryShipsPackage(l, packCfg.ignores, pkgPrefix));
    dirty.excluded = lines.filter((l) => !dirtyEntryShipsPackage(l, packCfg.ignores, pkgPrefix));
    if (dirty.shipping.length > 0 && !opts.allowDirty) {
      const head = dirty.shipping.slice(0, 8).join('\n        ');
      fail(
        'P5',
        `工作区有 ${dirty.shipping.length} 处会进包的未提交改动`,
        `git status --short：\n        ${head}${dirty.shipping.length > 8 ? `\n        …（共 ${dirty.shipping.length} 条）` : ''}`,
        '这些改动会随包发出去，但**不在任何提交里**（出事无法回溯）。先提交或 stash；'
          + '确实要带脏工作区出码，用 --allow-dirty（会打印警告）',
      );
    } else if (dirty.shipping.length > 0) {
      warnings.push(
        `P5 已用 --allow-dirty 放行 ${dirty.shipping.length} 处会进包的未提交改动`
          + `（另有 ${dirty.excluded.length} 处改动不进包）`,
      );
    } else if (dirty.total > 0) {
      warnings.push(
        `P5 工作区有 ${dirty.total} 处未提交改动，但都不在打包范围内（scripts/tests/docs 等）→ 不阻断`,
      );
    }
  }

  // ---------- P6 微信开发者工具 CLI 可执行（cli 模式专有） ----------
  let cli = { ok: true, path: '', source: 'n/a', skipped: mode === 'ci' };
  if (mode === 'cli') {
    cli = checkDevtoolsCli(execFileSync, env);
    if (!cli.ok) {
      fail(
        'P6',
        '微信开发者工具 CLI 不可用',
        `WECHAT_DEVTOOLS_CLI=${String((env && env.WECHAT_DEVTOOLS_CLI) || '(未设置)')}`
          + ` · 回退 which cli 也未找到可执行文件 · 实际解析路径=${cli.path || '(无)'}`,
        '不设该变量时 publish.js 会回落字面量 "cli"，随后 spawnSync cli ENOENT —— 与代码内容无关。'
          + 'export WECHAT_DEVTOOLS_CLI=/Applications/wechatwebdevtools.app/Contents/MacOS/cli，'
          + '并确认该路径可执行（必须在**同一条 shell** 里 export，别只在另一个窗口设）',
      );
    } else {
      warnings.push(`P6 开发者工具 CLI 可执行：${cli.path}（来源 ${cli.source}）`);
    }
  }

  // ---------- P7 提示：upload 模式的「后台是否已有同版本」无法自动校验 ----------
  // 🔴 微信**不提供**列开发版本列表的只读接口（cli / miniprogram-ci / 公开 API 都没有）。
  //    写成自动断言只会得到「永远查不到 → 永远通过」的假检查，比不查更危险。故只做提醒。
  const modeNotes = [];
  if (opts.forUpload) {
    modeNotes.push(
      'upload：无法自动校验「后台是否已有同版本开发版」（微信无只读接口，同版本重传是覆盖）。'
        + '出码前请人工确认：公众平台 → 管理 → 版本管理 → 开发版本列表里是否已有该版本',
    );
  }
  if (mode === 'ci') {
    modeNotes.push('ci 模式：走 miniprogram-ci，需要出码机出口 IP 在公众平台 IP 白名单内（与 P6 无关）');
  }
  for (const n of modeNotes) warnings.push(n);

  const info = {
    root,
    mode,
    pkgVersion,
    appVersion,
    versionTsExists,
    expectVersion,
    branch: git.branch,
    headSha: git.sha,
    gitOk: git.ok,
    expectSha: expectShas.join(','),
    projectName,
    dirAllowed: dirMatchesRequired,
    requiredDir: requireDir ? requireDir.source : '',
    rootKeyHits: keyScan.rootHits,
    deepKeyHits: keyScan.deepHits,
    packIgnoreOk: packCfg.ok,
    packIgnoreCoversKeys: ignoreCoversRootKeys,
    dirty,
    cli,
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

/** sha 前缀比较：短 sha 与全 sha 都能对上（大小写不敏感）。 */
function isSameSha(a, b) {
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

  log(`[Preflight] 出码前检查（P1–P6 · mode=${info.mode}）`);
  log(`[Preflight]   目录   ${info.root}`);
  log(`[Preflight]   版本   package.json=${info.pkgVersion || '(读不到)'}`
    + ` · utils/version.ts=${info.versionTsExists ? info.appVersion || '(读不到 APP_VERSION)' : '(文件不存在)'}`
    + ` · 期望=${info.expectVersion || '(未声明)'}`);
  log(`[Preflight]   身份   ${info.gitOk ? `${info.branch}@${info.headSha}` : '(读不到 git 身份)'}`);
  log(`[Preflight]   CLI    ${info.cli.skipped
    ? 'ci 模式不需要开发者工具 CLI'
    : info.cli.ok ? `${info.cli.path}（可执行）` : '不可用'}`);
  log(`[Preflight]   私钥   ${info.rootKeyHits.length === 0
    ? '包根无密钥文件'
    : `包根有 ${info.rootKeyHits.map((h) => h.name).join(', ')}`
      + ` · packOptions.ignore 覆盖=${info.packIgnoreCoversKeys ? '是' : '否'}`}`);

  for (const w of info.warnings) log(`[Preflight] ⚠️ ${w}`);

  if (failures.length === 0) {
    log('[Preflight] ✅ 六项检查通过，可以出码');
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
    else if (a === '--mode') opts.mode = argv[++i];
    else if (a === '--expect-sha') opts.expectSha = argv[++i];
    else if (a.startsWith('--expect-sha=')) opts.expectSha = a.slice('--expect-sha='.length);
    else if (a === '--expect-version') opts.expectVersion = argv[++i];
    else if (a.startsWith('--expect-version=')) opts.expectVersion = a.slice('--expect-version='.length);
    else if (a === '--require-dir') opts.requireDir = argv[++i];
    else if (a.startsWith('--require-dir=')) opts.requireDir = a.slice('--require-dir='.length);
    else if (a === '--allow-dirty') opts.allowDirty = true;
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
  ignoreCoversKeys,
  readPackIgnores,
  dirtyEntryShipsPackage,
  checkDevtoolsCli,
  pickProjectName,
  DEFAULT_ROOT,
  ALLOWED_DIR_NAME,
  KEY_EXT,
  KEY_TEMPLATE,
  DEEP_SCAN_MAX_DEPTH,
};
