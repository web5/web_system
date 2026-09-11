#!/usr/bin/env node
/**
 * 集成分支自动发布 watcher（**本地发布目录专用**）
 *
 * 作用：轮询远程集成分支（默认 `feature/test`），一旦有新提交就
 *   1) 把发布目录硬同步到该提交（`git reset --hard origin/<branch>`）；
 *   2) 通过 deploy-console 流水线把**全部模块**重新发布一遍；
 *   3) 全部跑完后再回到轮询（发布期间不会重复触发）。
 *
 * 发布顺序（重要）：后端服务 → 前端/微前端 → **deploy-console 最后**。
 *   原因：发布 deploy-console 会重启它自己，若它排在中间，会把它自己正在执行的
 *   流水线打断（deploy-console 是流水线引擎本体）。
 *
 * 状态：把"上次成功发布的 commit"记在 `<发布目录>/.watch-integration.state`，
 *   因此 watcher / 机器重启后不会重复发布；只有远程出现新提交才触发。
 *
 * 用法：
 *   node scripts/watch-integration.mjs                       # 常驻（默认 30s 轮询）
 *   node scripts/watch-integration.mjs --once                # 只检查一次，有更新才发
 *   node scripts/watch-integration.mjs --force               # 无视状态，立刻全量发布一次
 *   node scripts/watch-integration.mjs --dry-run             # 只打印将要做什么
 *   node scripts/watch-integration.mjs --branch feature/test --interval 30 --env local
 *
 * 常驻（推荐，pm2 管理；不要写进 ecosystem.config.cjs，避免 dev/prod 环境误启动）：
 *   pm2 start scripts/watch-integration.mjs --name web-release-watcher --interpreter node --cwd <发布目录>
 *   pm2 save
 *
 * 前置：
 *   - 发布目录（RELEASE_DIR，默认脚本上级目录）处于干净的 git 工作区；
 *   - deploy-console 在跑（默认 http://127.0.0.1:6200），其 .env 里可读到 ADMIN_USER/ADMIN_PASS；
 *   - 发布目录的 `servers/gateway/.env` 的 DEPLOY_ENV_ID 与 `--env` 一致（本地为 local）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 发布目录：脚本所在的仓库根（发布目录里跑就是发布目录） */
const RELEASE_DIR = process.env.RELEASE_DIR || path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (name) => args.includes(name);

const BRANCH = getArg('--branch', process.env.WATCH_BRANCH || 'feature/test');
const INTERVAL_S = Math.max(5, Number(getArg('--interval', process.env.WATCH_INTERVAL || '30')));
const ENV_ID = getArg('--env', process.env.WATCH_ENV || 'local');
const CONSOLE_URL = getArg('--console', process.env.DEPLOY_CONSOLE_URL || 'http://127.0.0.1:6200').replace(/\/+$/, '');
const ONCE = hasFlag('--once');
const DRY = hasFlag('--dry-run');
/** 单个模块发布超时（20 分钟）；超时只告警，不阻塞后续模块 */
const MODULE_TIMEOUT_MS = Number(getArg('--module-timeout-ms', '1200000'));

const C = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[90m', x: '\x1b[0m' };
const log = (m) => console.log(`${C.g}[watch]${C.x} ${m}`);
const warn = (m) => console.warn(`${C.y}[watch][WARN]${C.x} ${m}`);
const fail = (m) => console.error(`${C.r}[watch][ERROR]${C.x} ${m}`);
const short = (sha) => String(sha || '').slice(0, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 .env 解析 */
function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = v;
  }
  return out;
}

const consoleEnv = {
  ...loadEnvFile(path.join(RELEASE_DIR, 'servers/deploy-console/.env')),
  ...loadEnvFile(path.join(RELEASE_DIR, '.env')),
};
const ADMIN_USER = consoleEnv.ADMIN_USER || 'admin';
const ADMIN_PASS = consoleEnv.ADMIN_PASS || '';

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: RELEASE_DIR, encoding: 'utf8' }).trim();
}

/** "上次成功发布的 commit"落盘位置（随发布目录，不进 git） */
const STATE_FILE = path.join(RELEASE_DIR, '.watch-integration.state');
function readState() {
  try {
    return readFileSync(STATE_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}
function writeState(sha) {
  try {
    writeFileSync(STATE_FILE, `${sha}\n`);
  } catch (e) {
    warn(`写入状态文件失败（下次可能重复发布）：${e.message}`);
  }
}

async function login() {
  const res = await fetch(`${CONSOLE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`deploy-console 登录失败：HTTP ${res.status}`);
  const body = await res.json();
  const token = body.token || body.accessToken || body?.data?.token;
  if (!token) throw new Error('deploy-console 登录响应中没有 token');
  return token;
}

async function api(method, p, token, body) {
  const res = await fetch(`${CONSOLE_URL}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${method} ${p} → HTTP ${res.status}`);
  return res.json();
}

/**
 * 发布顺序：后端 → 前端/微前端 → deploy-console（最后，因为它重启会打断流水线引擎自己）。
 */
function orderModules(mods) {
  const rank = (m) => (m.key === 'deploy-console' ? 2 : m.type === 'backend' ? 0 : 1);
  return [...mods].sort((a, b) => rank(a) - rank(b) || String(a.key).localeCompare(String(b.key)));
}

/** 把发布目录硬同步到目标提交；工作区脏则拒绝（避免覆盖人工改动） */
function syncTo(sha) {
  const dirty = git('status', '--porcelain');
  if (dirty) {
    warn('发布目录有未提交改动，跳过本次自动同步（避免覆盖你的本地修改）');
    return false;
  }
  const cur = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (cur !== BRANCH) {
    log(`切换分支：${cur} → ${BRANCH}`);
    git('checkout', BRANCH);
  }
  git('reset', '--hard', sha);
  log(`发布目录已同步到 ${short(sha)}`);
  return true;
}

/** 逐个模块发布（串行；失败不中断，最后汇总） */
async function publishAll(sha) {
  const token = await login();
  const all = await api('GET', '/api/deploy/modules', token);
  const mods = orderModules(Array.isArray(all) ? all.filter((m) => m.enabled !== false) : []);
  log(`开始全量发布（${mods.length} 个模块，环境=${ENV_ID}，版本=${short(sha)}）`);
  log(`顺序：${mods.map((m) => m.key).join(' → ')}`);

  const results = [];
  for (const m of mods) {
    const r = await publishOne(m.key, token);
    results.push(r);
  }

  const ok = results.filter((r) => r.status === 'succeeded').length;
  const bad = results.filter((r) => r.status !== 'succeeded');
  log(`全量发布结束：成功 ${ok}/${results.length}`);
  if (bad.length) {
    warn(`未成功：${bad.map((b) => `${b.key}(${b.status})`).join(', ')}`);
  }
  return results;
}

async function publishOne(moduleKey, token) {
  let jobId;
  try {
    const res = await api('POST', '/api/pipelines', token, {
      env: ENV_ID,
      moduleKey,
      branch: BRANCH,
    });
    jobId = res.jobId || res.id;
  } catch (e) {
    fail(`${moduleKey}: 提交失败：${e.message}`);
    return { key: moduleKey, status: 'submit-failed' };
  }
  log(`  ${moduleKey}: 已提交 ${jobId}，等待完成…`);

  const deadline = Date.now() + MODULE_TIMEOUT_MS;
  let lastMsg = '';
  while (Date.now() < deadline) {
    await sleep(5000);
    let st;
    try {
      st = await api('GET', `/api/pipelines/${jobId}`, token);
    } catch {
      // deploy-console 自身发布时会重启，短暂不可达属正常，继续等
      continue;
    }
    lastMsg = st.progress?.message || st.stage || '';
    if (['succeeded', 'failed', 'cancelled'].includes(st.status)) {
      const mark = st.status === 'succeeded' ? '✓' : '✗';
      log(`  ${moduleKey}: ${mark} ${st.status}${st.error ? `（${st.error}）` : ''}`);
      return { key: moduleKey, status: st.status, versionTag: st.versionTag };
    }
  }
  warn(`  ${moduleKey}: 超时未完成（最后状态：${lastMsg}）`);
  return { key: moduleKey, status: 'timeout' };
}

/** 执行一次"同步 + 全量发布"；仅在全部流程走完后推进状态（失败则下轮重试） */
async function syncAndPublish(sha) {
  if (DRY) {
    log(`（dry-run）将同步到 ${short(sha)} 并全量发布到 ${ENV_ID} 环境`);
    return;
  }
  if (!syncTo(sha)) return; // 工作区脏 → 跳过（不推进状态，等人工处理）
  await publishAll(sha);
  writeState(sha);
}

async function main() {
  log(`watcher 启动：分支=${BRANCH}、环境=${ENV_ID}、轮询=${INTERVAL_S}s、发布目录=${RELEASE_DIR}`);
  if (DRY) warn('DRY-RUN：只检查与打印，不执行同步与发布');

  git('fetch', 'origin', BRANCH);
  const remote0 = git('rev-parse', `origin/${BRANCH}`);
  let state = readState();
  if (!state) {
    // 首次运行：把当前远程位置记为基线、不发布（当前代码通常已手工部署过）
    log(`首次运行，记录基线 ${short(remote0)}（本次不发布）`);
    if (!DRY) writeState(remote0);
    state = remote0;
  } else {
    log(`上次已发布 ${short(state)}；当前 origin/${BRANCH} = ${short(remote0)}`);
  }

  if (hasFlag('--force')) {
    log('--force：立刻执行一次全量发布');
    await syncAndPublish(remote0);
    return;
  }

  if (ONCE) {
    if (remote0 === state) {
      log('无更新，无需发布');
      return;
    }
    log(`检测到更新：${short(state)} → ${short(remote0)}`);
    await syncAndPublish(remote0);
    return;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(INTERVAL_S * 1000);
    try {
      git('fetch', 'origin', BRANCH);
      const remote = git('rev-parse', `origin/${BRANCH}`);
      if (remote === state) continue;

      log(`检测到 ${BRANCH} 更新：${short(state)} → ${short(remote)}`);
      await syncAndPublish(remote);
      const advanced = readState();
      if (advanced && advanced !== state) state = advanced;
    } catch (e) {
      warn(`本轮检查失败（下轮重试）：${e.message}`);
    }
  }
}

main().catch((e) => {
  fail(e.message);
  process.exit(1);
});
