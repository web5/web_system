#!/usr/bin/env node
/**
 * 出码前预检（preflight）· 大橙子侧**薄壳**（台账 9136）
 *
 * 🔴 判据与编排的**唯一实现**在仓库根共享层：
 *      scripts/lib/miniprogram-preflight.js
 *    本文件只做两件事：
 *      ① 告诉共享层「大橙子的包根在哪」（共享层不猜 __dirname，猜错＝门禁查的根 ≠ 出码的根）；
 *      ② 把共享层的 API 原样导出 —— 保住**既有 require 路径**（`./preflight`）与**导出符号**，
 *         让 publish.js / preview.js / upload.js / preview-push.js 与 tests/*.test.ts 一行都不用改。
 *
 * 🔴 为什么不在这里留一份判据：同一条规矩存两份必然漂移。科豆（apps/kedou-ai-minigram）
 *    在同一轮接的是**同一个**共享层文件 —— 改判据只改共享层，两个 app 一起生效。
 *    `scripts/lib/no-dev-copy-in-wxml` 是同一形态的先例（一份实现，两个 app 各写入口）。
 *
 * 用法（在本 app 目录下，与迁出前完全一致）：
 *   node scripts/preflight.js
 *   node scripts/preflight.js --mode ci
 *   node scripts/preflight.js --expect-sha 47f74ba8,019d282b
 *   node scripts/preflight.js --require-dir '^web_system-1018(-r2)?$'
 *   node scripts/preflight.js --allow-any-dir / --allow-dirty / --skip-preflight
 *   node scripts/preflight.js --root <路径>          指定待检包根（只读，不改任何文件）
 *   逐项判据说明见共享层文件头注释（那里是唯一真源，本文件不复述，避免两份说明互相漂）。
 */

'use strict';

const path = require('path');
const shared = require('../../../scripts/lib/miniprogram-preflight');

/** 本包根（scripts/ 的上一级）。共享层没有「我的包根」这回事，由这一行注入。 */
const DEFAULT_ROOT = path.join(__dirname, '..');

/**
 * 给 opts 补上本包默认根。调用方显式给的 opts.root **优先**（单测 / 只读实测指定别处）。
 * 只补默认值，不做任何判定 —— 判据一律留在共享层。
 */
function withDefaultRoot(opts) {
  return { root: DEFAULT_ROOT, ...(opts || {}) };
}

module.exports = {
  // 共享层原样透出（runPreflight / printReport / parsePreflightArgs / GATE_* / 各判据小工具…）
  ...shared,
  // 覆盖成「默认根 = 本包」的两个入口；其余符号与共享层完全一致
  DEFAULT_ROOT,
  runPreflight: (opts) => shared.runPreflight(withDefaultRoot(opts)),
  runGateOrExit: (opts, sub, ctx) => shared.runGateOrExit(withDefaultRoot(opts), sub, ctx),
  main: (argv, options) => shared.main(argv, { ...(options || {}), defaultRoot: DEFAULT_ROOT }),
};

if (require.main === module) {
  // 编排仍走共享层那唯一一份：解析参数 → 跑门禁 → 打印 → 不通过 exit 1
  module.exports.main(process.argv.slice(2));
}
