/**
 * 统一 runner：用例发现 / 顺序执行 / 四态汇总 / exit code
 *
 * 四态语义：
 *   PASS     断言全过
 *   FAIL     任一断言失败（exit 1）
 *   BLOCKED  被 README「已知限制」明文条目挡住且确认非产品 bug（不计失败，exit 0）
 *   SKIP     环境不可用（launch 返回 null），runner 统一判（exit 0；MP_E2E_REQUIRE_ENV=1 时 exit 2）
 *
 * 执行模型：preflight（keys-guard + pages-guard + 试 launch）→ 顺序扫 casesDir/*.js
 * （文件名排序）→ 每条用例独立 launch/close（隔离语义，避免用例间 storage 污染叠加
 * 已知限制①）。
 */

const fs = require('fs');
const path = require('path');
const { launch, close } = require('./session');
const { assertKeysInSource } = require('./keys-guard');
const { assertPagesRegistered } = require('./pages-guard');
const { pollPath, switchTab, navigateTo, reLaunch, navigateBack } = require('./navigate');
const { currentPath, stackPaths, pageData, waitForData, tabBarSelected } = require('./page');
const { getStorage, setStorage, removeStorage } = require('./storage');
const { assertEqual, assertOk } = require('./assert');

/** 步骤级执行：PASS/FAIL，不因单条失败中断（迁移自 helper.js L174–187） */
async function run(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    console.log(`  ✅ PASS  ${name}  (${ms}ms)`);
    return { name, status: 'PASS', message: '' };
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`  ❌ FAIL  ${name}  (${ms}ms)`);
    console.log(`     ${String(e && e.message ? e.message : e)}`);
    return { name, status: 'FAIL', message: String(e && e.message ? e.message : e) };
  }
}

/** 步骤级 BLOCKED（承接 E3 手工 BLOCKED 先例）：须附理由+证据，见 README 附录 A §3.4 口径 */
function blocked(name, message) {
  console.log(`  ⚠️ BLOCKED  ${name}`);
  if (message) console.log(`     ${message}`);
  return { name, status: 'BLOCKED', message: message || '' };
}

/** 用例级 SKIP（环境不可用，runner 统一判，用例/卡上不用写） */
function skipped(name, message) {
  console.log(`  ⏭️  SKIP  ${name}`);
  if (message) console.log(`     ${message}`);
  return { name, status: 'SKIP', message: message || '' };
}

const STATUS_ICON = { PASS: '✅', FAIL: '❌', BLOCKED: '⚠️', SKIP: '⏭️' };

/** 四态汇总（泛化自 helper.js L189–194，补 BLOCKED/SKIP 渲染与计数行） */
function summary(results) {
  console.log('\n================ 汇总 ================');
  for (const r of results) {
    console.log(`  ${STATUS_ICON[r.status] || ''} [${r.status}] ${r.name}${r.message ? ' —— ' + r.message.split('\n')[0] : ''}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(
    `  合计 ${results.length}：PASS ${count('PASS')} / FAIL ${count('FAIL')} / BLOCKED ${count('BLOCKED')} / SKIP ${count('SKIP')}`,
  );
}

/**
 * 由步骤结果推导用例级状态：
 * 任一 FAIL → FAIL；全 BLOCKED → BLOCKED；含 SKIP（用例级环境失败）→ SKIP；其余 PASS。
 */
function deriveCaseStatus(steps, fallback) {
  if (fallback) return fallback; // 用例模块自身抛错 / launch 失败
  if (steps.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (steps.length > 0 && steps.every((s) => s.status === 'BLOCKED')) return 'BLOCKED';
  return 'PASS';
}

/** exit code 语义（统一口径，见 README 第④章） */
function exitCodeOf(results, { envUnavailable }) {
  if (results.some((r) => r.status === 'FAIL')) return 1;
  if (envUnavailable || results.some((r) => r.status === 'SKIP')) {
    return process.env.MP_E2E_REQUIRE_ENV === '1' ? 2 : 0;
  }
  return 0;
}

/** 用例发现：casesDir 下 *.js 按文件名排序；命名不符合 <字母>-<slug>.js 打 warning（M3） */
function discoverCases(casesDir, filter) {
  if (!fs.existsSync(casesDir)) return [];
  const files = fs.readdirSync(casesDir).filter((f) => f.endsWith('.js')).sort();
  const picked = filter ? files.filter((f) => f.includes(filter)) : files;
  for (const f of picked) {
    if (!/^[A-Z]+-.+\.js$/.test(f)) {
      console.warn(`[mp-e2e] warning: 用例文件名 '${f}' 不符合 '<字母>-<slug>.js' 约定（README 附录 A §3.1）`);
    }
  }
  return picked.map((f) => ({ file: f, letter: f.split('-')[0], abs: path.join(casesDir, f) }));
}

/**
 * 构建用例上下文 ctx。
 * 约定（R4）：用例内引用 storage key 只许 ctx.KEYS.<别名>，禁字面量。
 * tap/dom 断言走 ctx.mp.currentPage() 的 page 对象、sourceShell 走裸 node execSync——
 * 这两类不封装、允许直达（R5，见 README 第③章）。
 */
function buildCtx(mp, cfg, launchCfg, steps) {
  return {
    mp,
    KEYS: cfg.storageKeys,
    // 步骤级 harness
    run: async (name, fn) => {
      const r = await run(name, fn);
      steps.push(r);
      return r;
    },
    blocked: (name, message) => {
      const r = blocked(name, message);
      steps.push(r);
      return r;
    },
    // 会话（E3 用例需要在用例内 close→launch 探测跨进程持久化）
    launch: () => launch(launchCfg),
    close,
    // storage
    getStorage,
    setStorage,
    removeStorage,
    // 导航
    pollPath,
    switchTab,
    navigateTo,
    reLaunch,
    navigateBack,
    // 页面读取
    currentPath,
    stackPaths,
    pageData,
    waitForData,
    tabBarSelected,
    // 断言
    assertEqual,
    assertOk,
  };
}

/**
 * runner 编程面。
 * @param {{ configPath: string, filter?: string }} opts
 * @returns {Promise<number>} exit code（0/1/2，语义见 exitCodeOf）
 */
async function runSuite({ configPath, filter }) {
  const appDir = path.dirname(configPath);
  // eslint-disable-next-line
  const cfg = require(configPath);
  const projectPath = cfg.projectPath || appDir;
  const casesDir = path.resolve(appDir, cfg.casesDir || 'tests/e2e/cases');
  const launchCfg = {
    callerDir: appDir,
    projectPath,
    cliPath: cfg.cliPath,
    launchTimeoutMs: cfg.launchTimeoutMs,
  };

  console.log(`[mp-e2e] app=${appDir}`);
  console.log(`[mp-e2e] casesDir=${casesDir}${filter ? ` filter='${filter}'` : ''}`);

  // —— preflight ①：静态守卫（纯文件 IO、秒级，红在 launch 之前）——
  assertKeysInSource({ keys: cfg.storageKeys || {}, srcDir: appDir });
  assertPagesRegistered({
    entryPath: cfg.entryPath,
    casesDir,
    appJsonPath: path.join(appDir, 'app.json'),
  });
  console.log('[mp-e2e] preflight 静态守卫通过（KEYS 对账 + page path 注册校验）');

  const cases = discoverCases(casesDir, filter);
  if (cases.length === 0) {
    console.warn('[mp-e2e] 未发现任何用例');
    return 0;
  }

  // —— preflight ②：试 launch 探测环境 ——
  const probe = await launch(launchCfg);
  if (!probe) {
    console.log('\n┌──────────────────────────────────────────────────────────┐');
    console.log('│  ⚠️  环境不可用：全部用例标 SKIP（不计失败）              │');
    console.log('│  排查：① 微信开发者工具已安装 ② 设置→安全设置→服务端口已开 │');
    console.log('│  严格模式：MP_E2E_REQUIRE_ENV=1 时本情形 exit 2            │');
    console.log('└──────────────────────────────────────────────────────────┘');
    const results = cases.map((c) => ({ name: c.file, status: 'SKIP', message: '环境不可用（launch 返回 null）' }));
    summary(results);
    return exitCodeOf(results, { envUnavailable: true });
  }
  await close(probe);

  // —— 顺序执行：每条用例独立 launch/close ——
  const caseResults = [];
  for (const c of cases) {
    console.log(`\n──── ${c.file} ────`);
    // eslint-disable-next-line
    const mod = require(c.abs);
    if (!mod || typeof mod.run !== 'function') {
      caseResults.push({ name: c.file, status: 'FAIL', message: '用例模块须导出 { name, run(ctx) }' });
      continue;
    }
    console.log(`■ ${mod.name || c.file}`);

    const mp = await launch(launchCfg);
    if (!mp) {
      caseResults.push(skipped(mod.name || c.file, '环境不可用（launch 返回 null）'));
      continue;
    }

    const steps = [];
    let fallback = null;
    try {
      const ctx = buildCtx(mp, cfg, launchCfg, steps);
      await mod.run(ctx);
    } catch (e) {
      fallback = 'FAIL';
      steps.push({ name: `${mod.name || c.file}（用例体未捕获异常）`, status: 'FAIL', message: String(e && e.message ? e.message : e) });
      console.log(`  ❌ FAIL  用例体未捕获异常: ${String(e && e.message ? e.message : e)}`);
    } finally {
      await close(mp);
    }

    // M3：步骤号与文件字母前缀一致性（warning，不挡信号）
    for (const s of steps) {
      if (!s.name.startsWith(c.letter)) {
        console.warn(`[mp-e2e] warning: 步骤名 '${s.name}' 与文件字母前缀 '${c.letter}' 不一致（README 附录 A §3.1）`);
      }
    }

    const status = deriveCaseStatus(steps, fallback);
    const failMsg = steps.find((s) => s.status === 'FAIL');
    caseResults.push({
      name: mod.name || c.file,
      status,
      message: failMsg ? failMsg.message : '',
      steps,
    });
  }

  summary(caseResults);
  return exitCodeOf(caseResults, { envUnavailable: false });
}

module.exports = { run, blocked, skipped, summary, deriveCaseStatus, exitCodeOf, discoverCases, buildCtx, runSuite };
