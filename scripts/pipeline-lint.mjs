#!/usr/bin/env node
/**
 * pipeline-lint — 流水线动作脚本体检（Phase 1 防再犯）
 *
 * 为什么需要：动作脚本以字符串存在 deploy_pipeline_actions.script，改坏了没人知道。
 * 2026-09-29 实测两类病变，其中第二类 `bash -n` 完全抓不到：
 *   ① 语法错误（缺续行符导致多行命令断裂）→ bash -n 可抓
 *   ② ssh 行尾缺续行符 → 语法合法但**语义致命**：
 *        $SSH "$PROD_USER@$PROD_HOST"
 *          "rm -rf '$PROD_PATH/$VER' && ..."     ← 这行落到流水线执行机本地执行
 *      当时 12 条流水线的 prod 发布动作全部中招，prod 发布等于在 dev 机上删目录。
 *
 * 用法（仓库是公开的，**不写死任何服务器 IP/用户名/密钥路径**，一律经 env 或参数注入）：
 *   export LINT_SSH_HOST=you@your-host        # 或 --ssh you@your-host
 *   export LINT_SSH_KEY=$HOME/.ssh/id_ed25519 # 或 --key <path>（可选，缺省用 ~/.ssh/id_ed25519）
 *   export DEV_DB_PASSWORD=...                # MySQL 口令
 *   node scripts/pipeline-lint.mjs --from-db [--db web_system_deploy]
 *   node scripts/pipeline-lint.mjs --file /tmp/actions.json      # 离线体检（CI 用）
 *   node scripts/pipeline-lint.mjs --from-db --json > report.json
 *   node scripts/pipeline-lint.mjs --from-db --dump /tmp/actions.json   # 导出供离线复检
 *
 * 退出码：0 = 无 error；1 = 有 error（CI 可用）
 *
 * 规则级别（2026-09-30 起 L4 由 warning 升为 error）：
 *   error（阻断）：L1 bash -n 语法 / L2 kind 白名单 / L3 env 条件不得 `!= local`
 *                 L4 变量引用存在性 / L5 ssh 行尾缺续行符
 *   warning（提示）：L6 危险命令疑似本地上下文（远端 ssh 块内的 rm -rf 会误报，仅提示）
 *
 * 聚合规则（跨 action，最后统一检查）：
 *   L7（error）构建 RELEASE_TAG 与投递 VER 的**环境段口径**必须一致（仅 site-version）
 *   L8（error）env-dir 应用的投递路径必须含 ${DEPLOY_ENV}（只检查 dev/prod）
 *   L9（error）调 $CONSOLE_API 的 curl 必须带 -f（否则 HTTP 失败静默通过）
 *
 * ⚠️ L4 判据：只有「裸引用 ${X}」或「空兜底 ${X:-}」才算未声明；
 *    `${X:-具体值}` 视为脚本自带兜底，不报。误报修复见 undeclaredVars()。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 平台注入变量 —— 权威来源 `pipeline.service.ts` 的 `resolveStageVars()`
 * （脚本可直接引用，无需在流水线变量表声明；勿凭猜测增删）。
 */
const PLATFORM_VARS = new Set([
  'DEPLOY_ENV', 'MODULE_KEY', 'MODULE_TYPE', 'MODULE_DIR', 'BRANCH', 'COMMIT_ID',
  'RELEASE_DIR', 'STAGE', 'PM2_NAME', 'PORT', 'PORT_SOURCE', 'PM2_SCRIPT', 'PM2_CWD',
  'PUBLIC_PATH', 'ENTRY_FILE', 'BUILD_OUTPUT_DIR', 'ARTIFACT_DIR', 'ARTIFACTS_DIR',
  'DEPLOY_ROOT', 'DEPLOY_TARGET', 'GATEWAY_URL', 'GATEWAY_TTL_SEC', 'KEEP_VERSIONS',
  'PROTECTED_VERSIONS', 'WS_SAFE_DELETE', 'CONSOLE_API', 'CONSOLE_TOKEN',
  // 流水线 run id：脚本调平台接口时透传为锁 owner（2026-10-09 加，与 resolveStageVars 同源）
  'RUN_ID',
  // shell 内建与脚本内临时量
  'HOME', 'PATH', 'USER', 'PWD', 'SHELL', 'SSH', 'SCP', 'TS',
  'VERSION_TAG', 'VERSION', 'VER', 'BUILD_ENV',
]);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const SSH_HOST = val('--ssh', process.env.LINT_SSH_HOST || '');
const SSH_KEY = val('--key', process.env.LINT_SSH_KEY || `${process.env.HOME}/.ssh/id_ed25519`);
const DB = val('--db', process.env.LINT_DB || 'web_system_deploy');
const DB_USER = val('--user', process.env.LINT_DB_USER || 'root');
const DB_PASS = process.env.DEV_DB_PASSWORD || process.env.DB_PASSWORD || '';

// ---------------------------------------------------------------- 取数

/** 从线上库导出：动作 + 任务元信息 + 流水线变量（全部 base64 传输，避免换行/转义歧义） */
function loadFromDb() {
  const sql = `
SELECT CONCAT(a.id,'||',s.pipeline_id,'||',t.name,'||',t.kind,'||',IFNULL(t.condition,''),'||',a.name,'||',REPLACE(TO_BASE64(a.script),CHAR(10),''))
FROM deploy_pipeline_actions a
JOIN deploy_pipeline_tasks t ON a.task_id=t.id
JOIN deploy_pipeline_steps s ON t.step_id=s.id;
SELECT CONCAT(v.pipeline_id,'||',v.\`key\`) FROM deploy_pipeline_vars v;
SELECT DISTINCT c.\`key\` FROM config_items c;`;
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-i', SSH_KEY, SSH_HOST,
    `MYSQL_PWD='${DB_PASS}' mysql -h127.0.0.1 -u${DB_USER} ${DB} --raw -N`], {
    input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const actions = [];
  const varsByPipe = new Map();
  const configKeys = new Set();
  for (const line of out.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const parts = s.split('||');
    if (parts.length >= 7) {
      const [id, pipelineId, taskName, kind, condition, name, b64] = parts;
      actions.push({
        id, pipelineId, taskName, kind, condition, name,
        script: Buffer.from(b64, 'base64').toString('utf8'),
      });
    } else if (parts.length === 2 && !parts[1].startsWith('{')) {
      const [pid, key] = parts;
      if (!varsByPipe.has(pid)) varsByPipe.set(pid, new Set());
      varsByPipe.get(pid).add(key);
    } else if (parts.length === 1) {
      // 第三条查询：配置中心全局键（resolveStageVars 会全量注入）
      configKeys.add(parts[0]);
    }
  }
  return { actions, varsByPipe, configKeys };
}

function loadFromFile(file) {
  const raw = JSON.parse(execFileSync('cat', [file], { encoding: 'utf8' }));
  return {
    actions: raw.actions,
    varsByPipe: new Map(Object.entries(raw.varsByPipe || {}).map(([k, v]) => [k, new Set(v)])),
    configKeys: new Set(raw.configKeys || []),
  };
}

// ---------------------------------------------------------------- 规则

function bashSyntax(script) {
  const dir = mkdtempSync(join(tmpdir(), 'plint-'));
  const f = join(dir, 'a.sh');
  writeFileSync(f, script);
  try {
    execFileSync('bash', ['-n', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return null;
  } catch (e) {
    return String(e.stderr || 'syntax error').split('\n').filter(Boolean)[0] || 'syntax error';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * L5：ssh/scp 行尾缺续行符 —— 语法合法、语义致命。
 * 特征：本行是 ssh/scp 调用且以 user@host 形态结尾、行尾无 `\`、下一行是缩进的续行内容。
 */
function sshContinuation(script) {
  const lines = script.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].replace(/\s+$/, '');
    if (!cur) continue;
    const isRemoteCall = /\b(ssh|scp)\b/i.test(cur) && !cur.startsWith('#');
    const endsWithHost = /["']?\$?[\w.-]*@\$?[\w.]+["']?\s*$/.test(cur);
    if (!isRemoteCall || !endsWithHost || cur.endsWith('\\')) continue;
    const next = (lines[i + 1] || '').trim();
    if (next && (next.startsWith('"') || next.startsWith("'"))) {
      hits.push({ line: i + 1, text: cur.trim().slice(0, 90) });
    }
  }
  return hits;
}

/**
 * L6：危险命令是否处于远端上下文。
 * 判定顺序：① 处于未闭合引号块内（ssh "多行命令" 的参数块）→ 安全；
 *          ② 向上 10 行内出现 ssh/scp → 安全；否则报 warning。
 * 为什么用引号奇偶：远端块常跨 40+ 行，靠行数窗口判不准。
 */
function dangerousLocal(script) {
  const lines = script.split('\n');
  const hits = [];
  const BAD = /\b(rm\s+-rf?|mkfs|dd\s+if=|shutdown|reboot)\b/;
  let quotes = 0; // 双引号累计奇偶（忽略 \" 转义）
  let heredocEnd = null; // 处于 heredoc 块时的终结符
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const stripped = cur.replace(/\\"/g, '');
    const before = quotes;
    quotes += (stripped.match(/"/g) || []).length;
    const inQuoteBlock = before % 2 === 1;
    // heredoc：ssh host <<'EOF' ... EOF —— 块内命令都在远端
    const hOpen = cur.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*$/);
    if (heredocEnd === null && hOpen) heredocEnd = hOpen[1];
    else if (heredocEnd !== null && cur.trim() === heredocEnd) heredocEnd = null;
    if (!BAD.test(cur) || cur.trim().startsWith('#')) continue;
    if (inQuoteBlock || heredocEnd !== null) continue;
    let inRemote = false;
    for (let j = Math.max(0, i - 10); j <= i; j++) {
      if (/\b(ssh|scp)\b/i.test(lines[j])) { inRemote = true; break; }
    }
    if (!inRemote) hits.push({ line: i + 1, text: cur.trim().slice(0, 90) });
  }
  return hits;
}

/** L4：变量引用存在性（排除脚本内部自己赋值的变量，否则全是噪音） */
function undeclaredVars(script, declared) {
  // 脚本内声明的：NAME=... / local NAME=... / for NAME in / read NAME / NAME=$(...)
  const local = new Set();
  // ⚠️ 旧正则用 `^\s*NAME=` 锚定行首，漏掉了「赋值不在行首」的写法，例如
  //    `case ...) TAG="${COMMIT_ID##*/}" ;;` 与 `if ...; then TAG_ENV=...; else ...; fi`
  //    → TAG / TAG_ENV 被误报未声明。改为按「前一个 token 是分隔符」判定。
  for (const m of script.matchAll(
    /(?:^|[;&|(){}\s])\s*(?:local\s+|export\s+|readonly\s+)?([A-Z_][A-Z0-9_]*)\s*=(?!=)/gm,
  )) local.add(m[1]);
  for (const m of script.matchAll(/\bfor\s+([A-Z_][A-Z0-9_]*)\s+in\b/g)) local.add(m[1]);
  for (const m of script.matchAll(/\bread\s+(?:-r\s+)?([A-Z_][A-Z0-9_]*)/g)) local.add(m[1]);

  // 带「非空默认值」的引用（`${X:-值}` / `${X:=值}` / `${X:?值}`）脚本已自带兜底，不算未声明。
  // ⚠️ 旧正则写成 `(?:-([^}]*)|:[=?][^}]*)`，匹配不到 `${X:-值}`（':' 在 '-' 前），
  //    导致 130+ 条假阳性。现改为统一识别 `:-` `:=` `:?` `:+` `-` `=` `?` `+` 并判空：
  //    默认值为空（`${X:-}`）等于静默展开成空串，仍视为引用并参与未声明检查。
  const stripped = script.replace(
    /\$\{([A-Z_][A-Z0-9_]*)\s*(?::-|:=|:?|\+|-|=|\?)([^}]*)\}/g,
    (m, _name, def) => (def.trim() === '' ? m : ''),
  );

  const used = new Set();
  for (const m of stripped.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)) used.add(m[1]);
  const miss = [];
  for (const v of used) {
    if (PLATFORM_VARS.has(v)) continue;
    if (local.has(v)) continue;
    if (declared && declared.has(v)) continue;
    miss.push(v);
  }
  return miss;
}

// ---------------------------------------------------------------- 主流程

// fail-fast：仓库已公开，工具不再内置目标机地址，必须由 env/参数显式提供
if (!has('--file') && !SSH_HOST) {
  console.error('[pipeline-lint] 缺少目标主机：请用 --ssh you@your-host 或 export LINT_SSH_HOST=you@your-host');
  console.error('  （密钥与库同理：LINT_SSH_KEY / LINT_DB / LINT_DB_USER / DEV_DB_PASSWORD）');
  process.exit(2);
}

const src = has('--file') ? loadFromFile(val('--file')) : loadFromDb();
const { actions, varsByPipe, configKeys = new Set() } = src;

if (has('--dump')) {
  writeFileSync(val('--dump'), JSON.stringify({
    actions,
    varsByPipe: Object.fromEntries([...varsByPipe].map(([k, v]) => [k, [...v]])),
    configKeys: [...configKeys],
  }, null, 2));
  console.log(`已导出 ${actions.length} 个动作到 ${val('--dump')}`);
  process.exit(0);
}

const errors = [];
const warnings = [];
const tmpSyntax = new Map();

for (const a of actions) {
  const at = `${a.pipelineId} / ${a.taskName} / ${a.name}`;

  // L2 kind 白名单
  if (!['script', 'approval'].includes(a.kind)) {
    errors.push({ rule: 'L2', at, msg: `非法 kind='${a.kind}'（UI 不渲染 action）` });
  }
  // L3 env 分流条件
  if (/!=\s*local/.test(a.condition || '')) {
    errors.push({ rule: 'L3', at, msg: `条件 '${a.condition}' 会截胡 prod（应为 == dev）` });
  }
  // L1 语法
  const syn = bashSyntax(a.script);
  if (syn) {
    tmpSyntax.set(a.id, syn);
    errors.push({ rule: 'L1', at, msg: `bash -n: ${syn.slice(0, 120)}` });
  }
  // L5 ssh 续行符（核心）
  for (const h of sshContinuation(a.script)) {
    errors.push({ rule: 'L5', at, msg: `第 ${h.line} 行 ssh/scp 缺续行符 → 下一行命令将落本地执行: ${h.text}` });
  }
  // L6 危险命令本地上下文
  for (const h of dangerousLocal(a.script)) {
    warnings.push({ rule: 'L6', at, msg: `第 ${h.line} 行危险命令疑似本地上下文: ${h.text}` });
  }
  // L4 变量引用（平台注入 + 流水线变量 + 配置中心）
  // 2026-09-30 升级为 error：假阳性已修（旧正则漏匹配 ${X:-值}、漏检非行首赋值），
  // 且 13 个未登记变量已补进 deploy_pipeline_vars，现网 0 命中 → 可作门禁。
  const declared = new Set([...(varsByPipe.get(a.pipelineId) || []), ...configKeys]);
  const miss = undeclaredVars(a.script, declared);
  if (miss.length) {
    errors.push({ rule: 'L4', at, msg: `未声明变量引用: ${miss.join(', ')}（补进 deploy_pipeline_vars 或改用 ${'${X:-默认值}'}）` });
  }
}

// L7 构建/投递口径一致性（site-version 类应用专用，跨 action 聚合后检查）
// 背景：2026-10-08 dev + prod 基座资源 404 事故。构建 hook 用 RELEASE_TAG 决定 vite base，
// 投递脚本用 VER 决定落盘目录；两者口径不一致时，index.html 里烘死的绝对路径与真实
// 落盘路径错位 → 构建成功、投递成功，但页面资源全 404（最难排查的一类"发布成功但页面坏"）。
// 判据只比"环境段口径"（是否含 ${DEPLOY_ENV}）：commit 段写法（COMMIT_ID / COMMIT_ID##*/ /
// 中间变量 COMMIT_SHORT）各流水线不统一，比它会误报。
{
  // 仅对 site-version 类应用生效：这类应用的 vite base 由 RELEASE_TAG 唯一决定
  // （apps/*/vite.config.ts 用 releaseTag 拼 base），口径错了必然 404。
  // env-dir 类（portal/admin）的 base 由 scripts/vite-micro-frontend.mjs 的 resolveMfBase()
  // 统一处理，RELEASE_TAG 只作标记，不参与路径 → 不检查，否则误报。
  // 判据来自 deploy_apps.deploy_mode='site-version'；lint 离线跑，此处白名单化。
  const SITE_VERSION_APPS = new Set(['shell']);
  // local 环境投递仍是 legacy flat 口径（VER=${COMMIT_ID}），属已知历史遗留，
  // 不纳入门禁，只比较真正上机器的 dev / prod。
  const GATED_ENVS = new Set(['dev', 'prod']);

  const byPipe = new Map();
  for (const a of actions) {
    if (!byPipe.has(a.pipelineId)) byPipe.set(a.pipelineId, []);
    byPipe.get(a.pipelineId).push(a);
  }
  // 注意：构建 hook 里是"行内前缀赋值"（RELEASE_TAG=... vite build），不是独立赋值行，
  // 只认引号内的表达式，避免把后面的命令行参数吃进来。
  const assignOf = (script, name) => {
    const out = [];
    const re = new RegExp(`(?:^|\\s)(?:export\\s+)?${name}\\s*=\\s*"([^"]*)"`, 'gm');
    for (const m of (script || '').matchAll(re)) out.push(m[1].trim());
    return out;
  };
  for (const [pid, list] of byPipe) {
    const appKey = (pid.match(/^tpl-(.+)-(?:dev|prod|local)$/) || [])[1];
    if (!appKey || !SITE_VERSION_APPS.has(appKey)) continue;
    const tags = [];
    const vers = [];
    for (const a of list) {
      for (const e of assignOf(a.script, 'RELEASE_TAG')) {
        tags.push({ at: `${pid} / ${a.taskName} / ${a.name}`, expr: e });
      }
      if (!GATED_ENVS.has(a.taskName)) continue;
      for (const e of assignOf(a.script, 'VER')) {
        vers.push({ at: `${pid} / ${a.taskName} / ${a.name}`, expr: e });
      }
    }
    if (!tags.length || !vers.length) continue;
    const hasEnv = (expr) => /\$\{?DEPLOY_ENV\}?/.test(expr);
    const tagShapes = new Set(tags.map((t) => (hasEnv(t.expr) ? 'env-prefixed' : 'flat')));
    const verShapes = new Set(vers.map((v) => (hasEnv(v.expr) ? 'env-prefixed' : 'flat')));
    if (tagShapes.size === 1 && verShapes.size === 1 && [...tagShapes][0] === [...verShapes][0]) continue;
    errors.push({
      rule: 'L7',
      at: pid,
      msg: `构建 RELEASE_TAG 口径 (${[...tagShapes].join('|')}) 与投递 VER 口径 (${[...verShapes].join('|')}) 不一致 → `
        + `产物 base 与落盘目录错位，页面资源 404（见 2026-10-08 基座事故）。`
        + ` 构建: ${tags.map((t) => t.expr).join(' , ')} ｜ 投递: ${vers.map((v) => v.expr).join(' , ')}`,
    });
  }
}

/**
 * 把以 `\` 结尾的续行合并成逻辑行（L9 用）。
 * curl 命令常写成多行（每个 -H 一行），只看物理行会漏判。
 * @returns {{line: number, text: string}[]} line = 该逻辑行的起始行号
 */
function logicalLines(script) {
  const out = [];
  const raw = String(script || '').split('\n');
  let buf = '';
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (!buf) start = i + 1;
    const cont = /\\\s*$/.test(t);
    buf += (buf ? '\n' : '') + (cont ? t.replace(/\\\s*$/, ' ') : t);
    if (!cont) {
      if (buf.trim()) out.push({ line: start, text: buf });
      buf = '';
    }
  }
  if (buf.trim()) out.push({ line: start, text: buf });
  return out;
}

// L8：env-dir 应用投递路径必须含 ${DEPLOY_ENV}
// 背景（2026-10-09 诊断 #3/#9）：env-dir（微前端）的产物布局是
// `modules/<key>/<env>/<commit>/`，而磁盘入口指针写的是 `./<commit>/index.js`。
// 投递脚本若用扁平口径（VER=${COMMIT_ID}），产物会落到 `modules/<key>/<commit>/`，
// 与指针期望的层级错位 → 构建成功、投递成功、切指针成功，但页面 404。
// L7 只覆盖 site-version（其 base 由 RELEASE_TAG 决定），env-dir 的这类错位无人检查。
{
  const ENV_DIR_APPS = new Set(['portal', 'admin']);
  const GATED_ENVS = new Set(['dev', 'prod']);

  const byPipe = new Map();
  for (const a of actions) {
    if (!byPipe.has(a.pipelineId)) byPipe.set(a.pipelineId, []);
    byPipe.get(a.pipelineId).push(a);
  }
  const assignOf = (script, name) => {
    const out = [];
    const re = new RegExp(`(?:^|\\s)(?:export\\s+)?${name}\\s*=\\s*"([^"]*)"`, 'gm');
    for (const m of (script || '').matchAll(re)) out.push(m[1].trim());
    return out;
  };
  // 投递目标路径：VER 或含 modules/ 的目标目录表达式
  const hasEnvSegment = (expr) => /\$\{?DEPLOY_ENV\}?/.test(expr);
  /**
   * 去掉注释行再判。
   * 踩过的坑：脚本注释里常画布局示意（`static/modules/<key>/<envId>/<commit>/index.js`），
   * 带 `<` `>` 占位符的描述文字会被当成真实路径 → 误报（实测命中过）。
   * 另外只认**代码行**：注释以 `#` 开头（允许前置空白）。
   */
  const codeOf = (script) =>
    String(script || '')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');

  for (const [pid, list] of byPipe) {
    const appKey = (pid.match(/^tpl-(.+)-(?:dev|prod|local)$/) || [])[1];
    if (!appKey || !ENV_DIR_APPS.has(appKey)) continue;
    for (const a of list) {
      if (!GATED_ENVS.has(a.taskName)) continue;
      const code = codeOf(a.script);
      // 投递动作：脚本里出现 modules/ 路径或 VER 赋值才判定为「投递」
      const vers = assignOf(code, 'VER');
      const isDeliver = vers.length > 0 || /static\/modules\//.test(code);
      if (!isDeliver) continue;
      const all = [...vers, ...(code.match(/static\/modules\/[^"'\\\s]+/g) || [])];
      // 占位符描述（含 < > 或中文）不是真实路径，跳过
      const bad = all.filter((e) => !hasEnvSegment(e) && !/[<>]/.test(e));
      if (bad.length) {
        errors.push({
          rule: 'L8',
          at: `${pid} / ${a.taskName} / ${a.name}`,
          msg: `env-dir 应用投递路径缺 ${'${DEPLOY_ENV}'}：${bad.join(' , ')} → `
            + `产物会落到 modules/<key>/<commit>/，与磁盘指针（./<commit>/index.js）错位，`
            + `表现为「发布成功但页面 404」（见 2026-10-09 诊断 #3）。`,
        });
      }
    }
  }
}

// L9：调 $CONSOLE_API 的 curl 必须带 -f / --fail
// 背景：动作脚本用 curl 调平台内部接口（写版本 / 切指针）。curl 默认 **HTTP 4xx/5xx
// 也返回退出码 0**，脚本没有 set -e 或不检查返回码时，接口明确拒绝了（产物不存在、
// 并发被锁、鉴权失败）脚本照样往下走 —— 这就是「脚本侧静默失败无门禁」。
// 判据：逻辑行里同时出现 curl 与 CONSOLE_API，且不含 -f / --fail → error。
{
  for (const a of actions) {
    const at = `${a.pipelineId} / ${a.taskName} / ${a.name}`;
    for (const l of logicalLines(a.script)) {
      if (!/\bcurl\b/.test(l.text)) continue;
      if (!/CONSOLE_API/.test(l.text)) continue;
      if (/(^|\s)(-{1,2}[a-zA-Z-]*f[a-zA-Z-]*\b|--fail)(\s|$)/.test(l.text)) continue;
      // 允许显式检查退出码/HTTP 码的写法（等价于 -f 的效果）
      if (/\$?\?\s*(?:-ne|!=)\s*0|HTTP_CODE|http_code|-o\s+\/dev\/null\s+-w/.test(l.text)) continue;
      errors.push({
        rule: 'L9',
        at,
        msg: `第 ${l.line} 行 curl 调 $CONSOLE_API 未带 -f：HTTP 4xx/5xx 也会返回 0，`
          + `接口拒绝（产物不存在 / 并发锁 409 / 鉴权失败）时脚本照样继续 → 静默失败。`
          + ` 改法：curl -fsS ... 或 curl -f ...`,
      });
    }
  }
}

const report = {
  checkedAt: new Date().toISOString(),
  source: has('--file') ? val('--file') : `${SSH_HOST}:${DB}`,
  total: actions.length,
  errors, warnings,
};

if (has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`pipeline-lint · 来源 ${report.source} · 动作 ${report.total} 个`);
  console.log(`error ${errors.length} · warning ${warnings.length}\n`);
  if (errors.length) {
    console.log('== ERROR ==');
    for (const e of errors) console.log(`[${e.rule}] ${e.at}\n    ${e.msg}`);
    console.log('');
  }
  if (warnings.length) {
    console.log('== WARNING ==');
    for (const w of warnings.slice(0, 40)) console.log(`[${w.rule}] ${w.at}\n    ${w.msg}`);
    if (warnings.length > 40) console.log(`  ... 另有 ${warnings.length - 40} 条`);
  }
  if (!errors.length && !warnings.length) console.log('✓ 全部通过');
}

process.exit(errors.length ? 1 : 0);
