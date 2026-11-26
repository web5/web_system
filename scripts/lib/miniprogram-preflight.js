#!/usr/bin/env node
/**
 * 出码前预检（preflight）—— 六项检查，接在各 app 的出码载体之前
 *
 * 🔴 本文件是**唯一实现**，位置在仓库根共享层（台账 9136 从大橙子迁到这里）。
 *    两个 app 共用这一份，app 侧只剩薄壳／接线：
 *      · apps/dachengzi-minigram/scripts/preflight.js   —— 历史路径的薄壳（re-export）
 *      · apps/kedou-ai-minigram/scripts/preview.js     —— 第一条动作调 runGateOrExit
 *      · apps/kedou-ai-minigram/scripts/upload.js      —— 同上
 *    为什么不让每个 app 各存一份判据：同一条规矩存两份必然漂移（`scripts/lib/no-dev-copy-in-wxml`
 *    已经是这个形态的先例）。本文件里改一处判据会**同时**作用于两个 app —— 这正是它存在的意义；
 *    不要为了「只改一个 app」在这里加 switch。
 *    本文件自己**不是**入口（没有 CLI 尾巴）：要跑门禁请用 app 侧的
 *    `node apps/<app>/scripts/preflight.js …`，或直接跑出码载体。
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
 *    P1/P2/P3/P4/P5/P6 失败 = 硬阻断（exit 1），不是警告。
 *    （P4 自 2026-11-26 起默认硬拦；唯一逃生口是显式的 `--allow-any-dir`，且它会打印告警行。）
 *
 * 🔴 六项检查（顺序即打印顺序；**不短路**，一次把全部问题列出来，避免「改一条又冒一条」）：
 *    P1 版本真实性   package.json.version == utils/version.ts 的 APP_VERSION，且都 == 期望版本；
 *                    **version.ts 不存在直接失败**（识别 1.0.14 老目录最灵敏的信号）
 *    P2 私钥不入包   cli 模式：包根出现 *.key / *.pem → 失败（cli 根本不需要私钥，它在那儿纯属风险）；
 *                    ci 模式：包根私钥是**必需的**（preview.js:54 / upload.js:31 硬编码路径，无 env 覆盖），
 *                    故不阻断，但必须满足「packOptions.ignore 已覆盖私钥」→ 否则失败（那才是真会随包外发）
 *    P3 工作区身份   打印 分支@sha；给了 --expect-sha 就核对（支持逗号分隔的多个候选 sha），不符即失败
 *    P4 目录白名单   worktree 顶层名不在 web_system-<任务号> 内 → **失败**；
 *                    `--require-dir <正则>` 收紧到本轮发布轮次；`--allow-any-dir` 是唯一逃生口（降回警告+告警行）
 *    P5 工作区干净   `git status --short` 里有**会进包**的未提交改动 → 失败（`--allow-dirty` 显式放行）
 *    P6 CLI 可执行   cli 模式：候选顺序 = `WECHAT_DEVTOOLS_CLI`（显式指定，命中即用，**不再往下找**）
 *                    → 官方默认安装路径（macOS /Applications/wechatwebdevtools.app/Contents/MacOS/cli）
 *                    → `which cli`；回落默认路径会打印一行「已回落默认安装路径」
 *                    三者皆不可用 → 失败，且报错里列出**检查过的每一个路径**
 *                    （这是发布全程唯一的硬缺口：都找不到时 publish.js 回落字面量 'cli' → spawnSync ENOENT）
 *
 * 用法：
 *   本文件是**唯一的判据实现**；各 app 的出码载体都经 runGateOrExit() 调它（台账 9122 / 9136）：
 *     大橙子：scripts/publish.js（preview / upload 子命令）、scripts/preview.js、scripts/upload.js、
 *             以及 scripts/preflight.js 薄壳自身的 CLI
 *     科豆：  scripts/preview.js、scripts/upload.js
 *   命令一律在**app 目录下**跑（下面的 scripts/ 指该 app 的 scripts/）：
 *   node scripts/preflight.js                                 以本包为根跑六项检查
 *   node scripts/preflight.js --mode ci
 *   node scripts/preflight.js --expect-sha 47f74ba8,019d282b
 *   node scripts/preflight.js --require-dir '^web_system-1018(-r2)?$'
 *   node scripts/preflight.js --allow-any-dir                  显式放开 P4 白名单（会打印告警行）
 *   node scripts/preflight.js --skip-preflight                 整体跳过（打印风险自负，仅限已知异常场景）
 *   node scripts/preflight.js --root <路径>                    指定待检包根（只读，不改任何文件）
 *
 * 边界：零第三方依赖、只读（除 git / which 子进程外无副作用、不写文件）、
 *      不打印任何密钥内容（只打文件名/大小/时间）、不 spawn 微信开发者工具 CLI（只查文件可执行位）。
 */

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 待检包根的默认值**不在本文件**：本文件被两个 app 共用，`__dirname` 已不再等于任何一个 app 的包根。
 * 由调用方在 opts 里给 `root`，或给 `defaultRoot`（app 侧薄壳把自己的包根注入进来）。
 * 🔴 两者都没有时 runPreflight 直接抛错，**不猜**目录 —— 猜错＝「门禁查的根 ≠ 出码的根」，
 *    比没有门禁更坏（会给出「检查通过」的假信号）。
 */

/**
 * 版本真源清单（P1）的**默认值**：只认 utils/version.ts 的 APP_VERSION（大橙子口径，
 * 与迁到共享层之前逐字一致）。
 *
 * 🔴 为什么默认必须是它、「包内没有版本常量」不许默认放行：
 *    utils/version.ts 是 1.0.17 才引入的，所以「它不存在」同时是「站错到 1.0.14 老目录」
 *    最灵敏的信号（web_system-dachengzi 那起事故就是这么漏的）。默认放宽＝把这道闸门关掉。
 *
 * 🔴 为什么允许调用方声明成空数组：科豆的包里**根本没有**编译期版本常量（关于页不展示版本号，
 *    版本真源只有 package.json）。给它凭空造一个 utils/version.ts 会改动已提审包的内容 ——
 *    比「P1 少一条子判据」危险得多。于是把「真源在哪」变成调用方声明的一项配置，
 *    判据仍然是这一份、这一处（不为任何 app 写第二套）。声明成空时 P1 只剩：
 *    package.json.version 必须存在，且（给了 --expect-version 时）必须等于期望版本。
 *    科豆的「站错目录」由 P3（--expect-sha）与 P4（目录白名单）兜。
 */
const DEFAULT_VERSION_SOURCES = [
  { rel: 'utils/version.ts', constName: 'APP_VERSION', label: 'utils/version.ts' },
];

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

/**
 * 从一个「版本真源」文件里读出常量字面量；返回 '' 表示没找到（文件不存在 / 没这个常量都算）。
 * 只读一行正则的字面量，**不执行**该文件（出码前预检不许有执行副作用）。
 */
function readVersionConst(file, constName) {
  try {
    const src = fs.readFileSync(file, 'utf-8');
    const m = src.match(new RegExp(`${constName}\\s*=\\s*['"]([^'"]+)['"]`));
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/** 读 utils/version.ts 里的 APP_VERSION 字面量；返回 '' 表示没找到。（兼容导出，行为不变） */
function readAppVersionConst(root) {
  return readVersionConst(path.join(root, 'utils', 'version.ts'), 'APP_VERSION');
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
 * P6 的「官方默认安装路径」候选（按平台）。
 *
 * 🔴 为什么要有它（真实卡点，台账 9142）：此前 P6 只认 `WECHAT_DEVTOOLS_CLI`（外加 `which cli`），
 *    而官方安装包**不会**把 cli 放进 PATH、安装时也**不会**替你设这个环境变量。
 *    于是「工具明明装着、cli 就在默认位置」时 P6 照样红 —— 只能靠 release-one-shot.sh 里那段
 *    「前置补齐 CLI」（把变量设成官方默认路径再跑）绕过；任何不走 one-shot 的路径
 *    （`npm run preview` / `publish.js preview|upload`）仍然红。把官方默认位置变成正式候选，
 *    绕过逻辑就变成冗余而不再是必需品。
 *
 * 来源（只列**实测过**的平台）：macOS 官方安装包（.dmg → /Applications/wechatwebdevtools.app）内
 * 可执行文件位置。本机实测 `ls -l …/Contents/MacOS/cli` → 1794 B、`-rwxr-xr-x`。
 * Windows 官方安装目录随版本/语言在 `Program Files` / `Program Files (x86)` 与
 * 「微信web开发者工具」/「wechatwebdevtools」之间变化，未实测故**不猜** ——
 * 猜错的路径会以「检查过的路径」出现在报错里，反而误导下一个人。
 * Windows / Linux 请显式 export WECHAT_DEVTOOLS_CLI（Linux 官方无开发者工具）。
 */
const DEFAULT_CLI_PATHS = process.platform === 'darwin'
  ? ['/Applications/wechatwebdevtools.app/Contents/MacOS/cli']
  : [];

/** P6 报错/提示里给人看的候选来源名（报错文案会原样打印，别随手改）。 */
const CLI_SOURCE_LABEL = {
  env: '环境变量 WECHAT_DEVTOOLS_CLI（显式指定）',
  default: '官方默认安装路径',
  which: 'PATH 探测（which cli）',
  missing: '无候选',
};

/**
 * 检查微信开发者工具 CLI 是否可用（P6）。只查文件可执行位，**不**执行它
 * （出码前预检不得产生任何出码副作用；登录态请出码后人工看 cli islogin）。
 *
 * 候选顺序（🔴 显式环境变量永远第一，否则「我明明指了另一个 CLI」会被默认路径盖掉）：
 *   1. `WECHAT_DEVTOOLS_CLI` —— 设了就**只**认它。指错（不存在 / 不可执行 / 是目录）→ 直接失败，
 *      **不**回落默认路径：那种「静默换一个答案」会让人以为自己指对了。
 *   2. 官方默认安装路径（DEFAULT_CLI_PATHS，按平台）。
 *   3. `which cli`（PATH 探测）。
 * 命中第 2 条时 source === 'default'，调用方据此打印「已回落默认安装路径」提示行。
 *
 * @param {Function} execFileSync 注入点（单测不许跑真实子进程）
 * @param {object} env            注入点（单测不许读真实 process.env）
 * @param {{defaultCliPaths?: string[]}} [opts]
 *        默认路径注入点：单测传假路径，**绝不**依赖本机装没装开发者工具（否则 CI 与本机结论相反）
 * @returns {{ok:boolean, path:string, source:string, configured:boolean,
 *            checked:Array<{path:string, source:string, note?:string}>}}
 */
function checkDevtoolsCli(execFileSync, env, opts = {}) {
  const configured = String((env && env.WECHAT_DEVTOOLS_CLI) || '').trim();
  const defaultPaths = Array.isArray(opts.defaultCliPaths) ? opts.defaultCliPaths : DEFAULT_CLI_PATHS;
  /** 检查过的每一个候选（失败时报错要原样列出来，人才知道自己到底被找过哪儿）。 */
  const checked = [];

  // 通过条件 = 可执行 **且是文件**。目录也有 X_OK 位，只看 access 会把「路径存在但是个目录」
  // 判成可用 → 假绿之后 spawnSync 才炸，正是 P6 要拦的那类事故。
  const probe = (p, source) => {
    checked.push({ path: p, source });
    try {
      if (!fs.statSync(p).isFile()) return null;
      fs.accessSync(p, fs.constants.X_OK);
      return { ok: true, path: p, source, configured: Boolean(configured), checked };
    } catch {
      return null;
    }
  };

  // 1) 显式指定 = 唯一候选：指错就报错，不静默改用别的路径
  if (configured) {
    return probe(configured, 'env')
      || { ok: false, path: configured, source: 'env', configured: true, checked };
  }

  // 2) 官方默认安装路径
  for (const p of defaultPaths) {
    const hit = probe(p, 'default');
    if (hit) return hit;
  }

  // 3) PATH 探测
  try {
    const found = String(execFileSync('which', ['cli'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }) || '').trim();
    if (found) {
      const hit = probe(found, 'which');
      if (hit) return hit;
    } else {
      checked.push({ path: '(PATH 里的 cli)', source: 'which', note: '未找到' });
    }
  } catch {
    checked.push({ path: '(PATH 里的 cli)', source: 'which', note: '未找到' });
  }

  return { ok: false, path: '', source: 'missing', configured: false, checked };
}

/** 把「检查过的候选」渲染成报错里给人看的多行清单。 */
function formatCheckedCliCandidates(checked) {
  if (!checked || checked.length === 0) return '(没有任何候选可查)';
  return checked
    .map((c) => `${c.path}（来源：${CLI_SOURCE_LABEL[c.source] || c.source}${c.note ? `，${c.note}` : ''}）`)
    .join('\n        ');
}

// ---------- 主体 ----------

/**
 * 跑出码前六项检查。
 *
 * @param {object} [opts]
 * @param {string} [opts.root]          待检包根。与 defaultRoot 都没有时**抛错**（不猜目录）
 * @param {string} [opts.defaultRoot]   待检包根的兜底值（app 侧薄壳注入自己的包根）
 * @param {'cli'|'ci'} [opts.mode]      出码模式，默认 cli（决定 P2 / P6 的判定力度）
 * @param {string} [opts.expectVersion] 期望版本；缺省从 package.json.version 推导
 * @param {string} [opts.expectSha]     期望 HEAD sha；支持逗号分隔多个候选（命中任一即通过）
 * @param {Array<{rel:string, constName:string, label?:string}>} [opts.versionSources]
 *        版本真源清单（P1）。缺省 DEFAULT_VERSION_SOURCES（只认 utils/version.ts 的 APP_VERSION）；
 *        传 `[]` 表示「本包没有编译期版本常量」，P1 只核 package.json.version。
 *        详见 DEFAULT_VERSION_SOURCES 上方注释（为什么默认不放宽、为什么允许声明为空）。
 * @param {string|RegExp} [opts.requireDir] 收紧 P4：worktree 顶层名不匹配即**失败**
 * @param {boolean} [opts.allowAnyDir] 放宽 P4：无 requireDir 且目录不在白名单时降回警告（打印告警行）
 * @param {boolean} [opts.allowDirty]   放行「会进包的未提交改动」（P5 降级为警告）
 * @param {Function} [opts.execFileSync] 注入点（单测用），默认 child_process.execFileSync
 * @param {object} [opts.env]           注入点（单测用），默认 process.env
 * @param {string[]} [opts.defaultCliPaths] P6 的「官方默认安装路径」候选注入点（单测用）；
 *        缺省用 DEFAULT_CLI_PATHS（按平台）。🔴 单测必须注入假路径，否则本机装了开发者工具
 *        与 CI 没装会得出相反结论。
 * @returns {{ok:boolean, failures:Array, info:object}}
 */
function runPreflight(opts = {}) {
  const rootArg = opts.root || opts.defaultRoot;
  if (!rootArg) {
    // 宁可抛错也不猜：共享层没有「我的包根」这回事，猜错就是「门禁查的根 ≠ 出码的根」。
    throw new Error(
      'runPreflight 缺少待检包根：请传 opts.root（单测 / 只读实测）'
        + ' 或 opts.defaultRoot（app 侧薄壳的包根）。共享层不猜目录。',
    );
  }
  const root = path.resolve(rootArg);
  const execFileSync = opts.execFileSync || childProcess.execFileSync;
  const env = opts.env || process.env;
  const mode = opts.mode === 'ci' ? 'ci' : 'cli';
  const versionSources = Array.isArray(opts.versionSources)
    ? opts.versionSources
    : DEFAULT_VERSION_SOURCES;

  const failures = [];
  const warnings = [];
  const fail = (code, title, detail, hint) => failures.push({ code, title, detail, hint });

  // ---------- P1 版本真实性 ----------
  // 判据链：package.json.version 必须存在；每个「版本真源」文件必须存在、能读出常量；
  //        各真源必须与 package.json.version 字面相等；且都必须等于期望版本
  //        （缺省＝package.json.version）。真源清单由调用方声明，默认只有 utils/version.ts。
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

  // 逐个真源取「存在 / 常量值」。第一项同时作为 info 里的 appVersion / versionTsExists
  // （字段名沿用大橙子口径，保持既有 info 形状不变）。
  const sourceStates = versionSources.map((src) => {
    const label = src.label || src.rel;
    const file = path.join(root, src.rel);
    const exists = fs.existsSync(file);
    return {
      label,
      file,
      exists,
      constName: src.constName,
      value: exists ? readVersionConst(file, src.constName) : '',
    };
  });
  const primarySource = sourceStates[0] || null;
  versionTsExists = Boolean(primarySource && primarySource.exists);
  appVersion = primarySource ? primarySource.value : '';

  for (const s of sourceStates) {
    if (!s.exists) {
      // 🔴 这是识别「1.0.14 老目录」最灵敏的信号：utils/version.ts 是 1.0.17 才引入的。
      //    老目录里 package.json 也停在旧版本号，光看 package.json 还可能以为是「某个历史版本」，
      //    但少了 version.ts 就直接证明「这个目录的结构比当前基线还老」。
      fail(
        'P1',
        `${s.label} 不存在`,
        `路径：${s.file}（package.json=${pkgVersion || '读不到'}）`,
        '这个文件是 1.0.17 才引入的：没有它＝目录停在 1.0.14/1.0.16 一类的老基线。'
          + '极可能站错目录（例如 web_system-dachengzi），先确认 worktree，别在这里出码',
      );
    } else if (!s.value) {
      fail(
        'P1',
        `${s.label} 里读不到 ${s.constName}`,
        `路径：${s.file}`,
        `导出形如 \`export const ${s.constName} = '1.0.18';\`，补上后重试`,
      );
    }
  }

  if (!expectVersion && pkgVersion) expectVersion = pkgVersion; // 未显式声明 → 从 package.json 推导

  for (const s of sourceStates) {
    if (pkgVersion && s.value && pkgVersion !== s.value) {
      fail(
        'P1',
        '两处版本号不一致',
        `package.json=${pkgVersion}，${s.label}=${s.value}`,
        '两处必须字面相等（1.0.17 的「包是 1.0.17、关于页显示 v1.0.0」事故就是这么漏的）',
      );
    }
  }

  if (expectVersion && pkgVersion && expectVersion !== pkgVersion) {
    fail(
      'P1',
      'package.json 版本 ≠ 期望版本',
      `package.json=${pkgVersion}，期望=${expectVersion}`,
      '站错目录或忘 bump 版本。微信**不支持回退已发版本**，发出去就收不回来',
    );
  }

  if (primarySource && expectVersion && primarySource.value && expectVersion !== primarySource.value) {
    fail(
      'P1',
      `${primarySource.constName} ≠ 期望版本`,
      `${primarySource.label}=${primarySource.value}，期望=${expectVersion}`,
      `把 ${primarySource.constName} 改成期望版本后重试`,
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

  // ---------- P4 目录白名单（默认硬拦；--allow-any-dir 是唯一逃生口） ----------
  // 判的是 **worktree 顶层名**（web_system-dachengzi），不是包目录名（apps/dachengzi-minigram，
  // 后者在每个 worktree 里都一样，判它等于不判）。
  //
  // 🔴 2026-11-26 由「默认警告」改为「默认硬拦」：
  //    `web_system-dachengzi` 事故里，P4 当时只 warning，于是「顺手出个预览码」照样跑下去 ——
  //    一条只会出现在滚动日志里、退出码仍是 0 的警告，等于没有闸门。
  //    现在三种情形分开：
  //      ① 给了 --require-dir 且不匹配        → 硬失败（调用方显式声明的期望，必须尊重）
  //      ② 没给 --require-dir 且不在白名单    → 硬失败（默认口径）
  //      ③ 同② + --allow-any-dir              → 降回 warning，但**必须打印显式告警行**
  //    ① 与 ③ 的优先级：--allow-any-dir **不能**盖掉 ①，
  //    否则「显式要求匹配 X + 显式放行任意目录」会静默取后者，等于把 --require-dir 变成摆设。
  const projectName = pickProjectName(root, git.toplevel);
  const requireDir = opts.requireDir
    ? (opts.requireDir instanceof RegExp ? opts.requireDir : new RegExp(String(opts.requireDir)))
    : null;
  const allowAnyDir = opts.allowAnyDir === true;
  const dirAllowed = ALLOWED_DIR_NAME.test(projectName);
  const dirMatchesRequired = requireDir ? requireDir.test(projectName) : dirAllowed;
  if (requireDir && !dirMatchesRequired) {
    fail(
      'P4',
      `项目目录不匹配 --require-dir：${projectName}`,
      `当前 worktree 顶层名=${projectName}，要求匹配 /${requireDir.source}/`,
      '发布轮次只允许在指定 worktree 出码。换目录到匹配的 worktree；'
        + '或确认本轮就该在这个目录出口径相同的包，再用 --require-dir 精确匹配它（如 --require-dir '
        + `'^${projectName}$'）。--allow-any-dir 只放开默认白名单，盖不掉你显式声明的 --require-dir`,
    );
  } else if (!dirMatchesRequired) {
    if (allowAnyDir) {
      // 逃生口也留痕：门禁被降级这件事必须能在日志里被看见，不能静默
      warnings.push(
        `P4 ⚠️ 已用 --allow-any-dir 显式放行白名单外目录：${projectName}`
          + '（白名单形如 web_system-1018 / web_system-1018-r2）。'
          + '本次不阻断，但「目录不在发布轮次命名内」这条风险**依然成立** —— 出了错无法归因到门禁。',
      );
    } else {
      fail(
        'P4',
        `项目目录不在出码白名单：${projectName}`,
        `当前 worktree 顶层名=${projectName}，不匹配默认白名单 /${ALLOWED_DIR_NAME.source}/`
          + `（形如 web_system / web_system-1018 / web_system-1018-r2）`,
        '发布类 worktree 用任务号命名 —— 分支名好听不代表代码是对的（web_system-dachengzi 这起事故'
          + '就是分支叫 devtools/dachengzi-preview、里面却是 1.0.14 老码 + 真私钥）。'
          + "处置：① 换到本轮的发布 worktree；② 本轮确实要用这个目录，用 --require-dir 精确匹配它"
          + "（如 --require-dir '^web_system-1018(-r2)?$'）；③ 明知风险仍要放开白名单，"
          + '显式加 --allow-any-dir（会打印告警行）',
      );
    }
  } else if (allowAnyDir) {
    // 没用上也要说清：避免下次有人以为「我加了这个开关，所以刚才那次是放行的」
    warnings.push(
      `P4 已声明 --allow-any-dir，但当前目录 ${projectName} 本就在白名单内 → 该开关本次未生效`
        + '（它只用于放开白名单外的目录）。',
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
  let cli = { ok: true, path: '', source: 'n/a', skipped: mode === 'ci', configured: false, checked: [] };
  if (mode === 'cli') {
    cli = checkDevtoolsCli(execFileSync, env, { defaultCliPaths: opts.defaultCliPaths });
    if (!cli.ok) {
      // 报错三要素：现象 / 检查过的每一个路径 / 怎么办（下一个人要能自己解决，不用猜）
      const head = cli.configured
        ? `WECHAT_DEVTOOLS_CLI=${cli.path}（显式指定 → 唯一候选，指错了就报错，不会静默改用默认路径）`
        : 'WECHAT_DEVTOOLS_CLI=(未设置)';
      fail(
        'P6',
        '微信开发者工具 CLI 不可用',
        `${head} · 检查过 ${cli.checked.length} 个候选，均不可用（不存在 / 不是文件 / 无执行权限）：\n`
          + `        ${formatCheckedCliCandidates(cli.checked)}`,
        '二选一：① 装上微信开发者工具（官方默认安装即可，P6 会自动认 '
          + '/Applications/wechatwebdevtools.app/Contents/MacOS/cli，不必设变量）；'
          + '② 显式 export WECHAT_DEVTOOLS_CLI=<cli 绝对路径>，并确认它是**可执行文件**而不是目录。'
          + '两种都要在**同一条 shell** 里生效（别只在另一个窗口设）。'
          + '若确实没有开发者工具，别硬出：不设变量时 publish.js 会回落字面量 "cli"，'
          + '随后 spawnSync cli ENOENT —— 与代码内容无关',
      );
    } else {
      // 回落默认路径必须留一行**可 grep 的**证据：这是本条修复从红变绿的唯一可视凭据
      if (cli.source === 'default') warnings.push(`[P6] 已回落默认安装路径：${cli.path}`);
      else if (cli.source === 'which') warnings.push(`[P6] 已回落 PATH 里的 cli：${cli.path}`);
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
    // 版本真源清单（P1 实际核过的那几处）。空数组 = 本包声明「没有编译期版本常量」，
    // 报表据此打印「版本真源只有 package.json」，而不是假装查过一个不存在的文件。
    versionSources: sourceStates.map((s) => ({
      label: s.label, constName: s.constName, exists: s.exists, value: s.value,
    })),
    expectVersion,
    branch: git.branch,
    headSha: git.sha,
    gitOk: git.ok,
    expectSha: expectShas.join(','),
    projectName,
    dirAllowed: dirMatchesRequired,
    requiredDir: requireDir ? requireDir.source : '',
    allowAnyDir,
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
  // 版本真源是调用方声明的清单（见 DEFAULT_VERSION_SOURCES）：逐项打印，不写死某个文件路径
  // —— 否则科豆（清单为空）会被打印成「utils/version.ts=(文件不存在)」，读的人会以为门禁查错了。
  const versionLine = (info.versionSources || []).length === 0
    ? '· 版本真源只有 package.json（本包未声明编译期版本常量）'
    : (info.versionSources || [])
      .map((s) => `· ${s.label}=${s.exists ? s.value || `(读不到 ${s.constName})` : '(文件不存在)'}`)
      .join(' ');
  log(`[Preflight]   版本   package.json=${info.pkgVersion || '(读不到)'}`
    + ` ${versionLine}`
    + ` · 期望=${info.expectVersion || '(未声明)'}`);
  log(`[Preflight]   身份   ${info.gitOk ? `${info.branch}@${info.headSha}` : '(读不到 git 身份)'}`);
  log(`[Preflight]   CLI    ${info.cli.skipped
    ? 'ci 模式不需要开发者工具 CLI'
    : info.cli.ok
      ? `${info.cli.path}（可执行 · 来源 ${info.cli.source}）`
      : '不可用'}`);
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

// ---------- 门禁的唯一执行入口 ----------

/**
 * 上游入口把「门禁已经处理过了」这件事传给下游子进程用的环境变量名。
 *
 * 🔴 只有**真的跑过门禁（或显式跳过）的上游**才配设它 —— 见 runGateOrExit。
 */
const GATE_ENV = 'MINIPROGRAM_PREFLIGHT_GATE';
/** 上游已跑过门禁，且判定通过。 */
const GATE_DONE = 'done';
/** 上游已用 --skip-preflight 显式跳过门禁。 */
const GATE_SKIP = 'skip';

/**
 * 给子进程用的 env：把「门禁状态」这一件事写进去（唯一实现，调用方别自己拼字符串）。
 * state 为空 → 保证**不继承**父进程残留的状态（否则「谁都没跑却都说跑过」）。
 */
function withGateState(env, state) {
  const next = { ...(env || {}) };
  if (state) next[GATE_ENV] = state;
  else delete next[GATE_ENV];
  return next;
}

/**
 * 出码门禁的**唯一**执行入口：跑一次 → 打印一份报告 → 不通过就退出。
 *
 * 🔴 为什么要有这个薄函数（台账 9122，真实缺口）：
 *    「跑门禁 + 打印报告 + 失败退出」这段编排此前有**两份**：publish.js 的 preflightGate
 *    一份、本文件 CLI 尾巴一份。而真正的出码载体 scripts/preview.js / scripts/upload.js
 *    **一份都没有** —— 于是 `node scripts/preview.js` 这条直连路径把 P1–P6 全套绕过
 *    （grep -c preflight scripts/preview.js 曾是 0）。判据只有 runPreflight 一份，
 *    但「谁在什么时候调它」散在调用方，于是出现「门禁写着、路却绕得过」。
 *    现在编排也只此一处：大橙子的 publish.js / preview.js / upload.js / preflight.js 薄壳 CLI、
 *    科豆的 preview.js / upload.js 都调它（台账 9136 并入科豆后仍然只有这一份）。
 *    🔴 判据仍然只有 runPreflight 一份 —— 本函数不含任何判定逻辑，别往里加。
 *
 * 🔴 防重复执行（同一条命令链上只允许出现一份报告）：
 *    `publish.js preview --mode ci` 会先跑一次门禁，再 spawn scripts/preview.js，
 *    而 preview.js 本体也跑门禁 —— 不去重就会打印**两份报表**，
 *    出问题时没人分得清哪一份才是真判据（两份还可能因参数不同而结论不同）。
 *    机制是显式环境变量（GATE_ENV），由真正跑过门禁的上游用 withGateState() 注入：
 *      · GATE_DONE → 本入口只打一行「不重复执行」，不再判定、不再打印报表；
 *      · GATE_SKIP → 上游已显式跳过，本入口同样跳过（并留一行痕，不静默）。
 *    ⚠️ 不靠「反正跑两次也没坏处」：两份报表 = 两个判据来源 = 迟早漂。
 *    ⚠️ 反过来更危险：上游没跑却设了 GATE_DONE 等于**开门**。所以注入方必须
 *       手里真有门禁结果（见 publish.js cmdPreview/cmdUpload 的 gate 形参）。
 *
 * @param {object} [opts]  透传给 runPreflight 的选项；额外认 opts.skipPreflight（显式跳过）
 * @param {'preview'|'upload'} [sub] 子命令（决定 forUpload 提示项）
 * @param {{env?:object, log?:Function, warn?:Function, exit?:Function}} [ctx]
 *        注入点（单测用）：env/log/warn/exit。默认真实 process / console。
 * @returns {{ok:boolean, skipped?:boolean, failures?:Array, info?:object}}
 */
function runGateOrExit(opts = {}, sub = 'preview', ctx = {}) {
  const env = ctx.env || process.env;
  const log = ctx.log || console.log;
  const warn = ctx.warn || console.warn;
  const exit = ctx.exit || ((code) => process.exit(code));

  // 1) 上游已跑过 / 已显式跳过 → 不重复判定，只留一行可 grep 的痕
  const inherited = String((env && env[GATE_ENV]) || '').trim();
  if (inherited === GATE_DONE) {
    log(`[Preflight] ⏭ 上游入口已跑过门禁（${GATE_ENV}=${GATE_DONE}），本入口不重复执行`
      + '（同一份判据只出一份报告，避免两次结论打架）');
    return { ok: true, skipped: true, failures: [], info: {} };
  }
  if (inherited === GATE_SKIP) {
    warn(`[Preflight] ⚠️ 上游入口已用 --skip-preflight 跳过门禁（${GATE_ENV}=${GATE_SKIP}），`
      + '本入口不再检查，风险自负');
    return { ok: true, skipped: true, failures: [], info: {} };
  }

  // 2) 本入口自己带 --skip-preflight：留痕但不判定（逃生口必须一直可用，否则调试彻底失能）
  if (opts.skipPreflight === true) {
    warn('[Preflight] ⚠️ 已跳过出码前检查，风险自负（--skip-preflight）');
    return { ok: true, skipped: true, failures: [], info: {} };
  }

  // 3) 正常路径：跑一次 → 打印一份 → 不通过就退
  const result = runPreflight({ ...opts, forUpload: sub === 'upload' });
  printReport(result);
  if (!result.ok) exit(1);
  return result;
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
    else if (a === '--allow-any-dir') opts.allowAnyDir = true;
    else if (a === '--allow-dirty') opts.allowDirty = true;
    else if (a === '--skip-preflight') opts.skipPreflight = true;
    else opts._.push(a);
  }
  return opts;
}

/**
 * 预检 CLI 的**唯一**编排入口（台账 9136：从大橙子 preflight.js 的 CLI 尾巴提上来的）。
 *
 * app 侧薄壳只写一行 `main(process.argv.slice(2), { defaultRoot: <本包根> })` ——
 * 「解析参数 → 跑门禁 → 打印 → 失败退出」的顺序仍然只有这一处，不在各 app 重复。
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @param {{defaultRoot?: string, ctx?: object}} [options] defaultRoot：argv 没给 --root 时用它
 */
function main(argv, options = {}) {
  const opts = parsePreflightArgs(argv);
  // --root 显式给了就尊重它（单测 / 只读实测）；没给则落到调用方的包根 —— 不再有「猜 __dirname」。
  if (!opts.root && options.defaultRoot) opts.root = options.defaultRoot;
  return runGateOrExit(opts, 'preview', options.ctx);
}

module.exports = {
  runPreflight,
  printReport,
  runGateOrExit,
  withGateState,
  parsePreflightArgs,
  main,
  GATE_ENV,
  GATE_DONE,
  GATE_SKIP,
  isSameSha,
  readAppVersionConst,
  readVersionConst,
  scanKeys,
  isKeyFile,
  ignoreCoversKeys,
  readPackIgnores,
  dirtyEntryShipsPackage,
  checkDevtoolsCli,
  formatCheckedCliCandidates,
  pickProjectName,
  DEFAULT_VERSION_SOURCES,
  DEFAULT_CLI_PATHS,
  CLI_SOURCE_LABEL,
  ALLOWED_DIR_NAME,
  KEY_EXT,
  KEY_TEMPLATE,
  DEEP_SCAN_MAX_DEPTH,
};
