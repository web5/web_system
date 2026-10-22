#!/usr/bin/env node
/**
 * 原型体系「一键全量机检」
 *
 *   node scripts/verify-proto-all.mjs          # 全量（含 4 条浏览器机检）
 *   node scripts/verify-proto-all.mjs --fast   # 快档：构建 + 审计 + 体检 + 整合稿机检
 *   node scripts/verify-proto-all.mjs --only=audit,adopt
 *
 * ── 为什么要有这个入口 ──────────────────────────────────────────────────
 * 2026-10-22 那次整合，每改一处就要手工跑 5 条命令（build + 4 条 verify），
 * 一轮几十秒、来回十几轮。问题不在慢，在**容易漏**：漏跑一条就出现
 * 「改完 verify-agents-hub 绿了，但 proto-shell 早就红了却没人知道」。
 * 一次跑全、一次给结论，把「记得跑哪几条」这件事从人脑里拿掉。
 *
 * 顺序有依赖：build 必须最先（其余四条都读生成物）；audit / adopt 是静态检查，
 * 不依赖产物，但放在后面，这样产物问题优先暴露。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_DEFS } from './lib/proto-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const args = process.argv.slice(2);
const fast = args.includes('--fast');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

const STEPS = [
  {
    key: 'build', name: 'build-agents-hub', script: 'scripts/build-agents-hub.mjs',
    desc: '生成整合稿 + 自检', slow: false,
    /* build 有自己的自检（11 条），输出「已生成 …（N 行）」+ 失败时抛错 */
    pick: (s) => (s.match(/已生成[^\n]*/) || s.match(/问题 \d+ 项[^\n]*/) || [''])[0].trim(),
  },
  {
    key: 'hub', name: 'verify-agents-hub', script: 'scripts/verify-agents-hub.mjs',
    desc: '整合稿整合层断言', slow: true,
    pick: (s) => (s.match(/合计\s*\d+\/\d+\s*通过/) || s.match(/\d+\/\d+\s*通过/) || [''])[0].trim(),
  },
  {
    key: 'shell', name: 'verify-proto-shell', script: 'scripts/verify-proto-shell.mjs',
    desc: '三稿壳与菜单一致', slow: true,
    pick: (s) => (s.match(/合计\s*\d+\/\d+\s*通过/) || [''])[0].trim(),
  },
  {
    key: 'parity', name: 'verify-playground-parity', script: 'scripts/verify-playground-parity.mjs',
    desc: '对话调试消息结构 parity', slow: true,
    pick: (s) => (s.match(/合计\s*\d+\/\d+\s*通过/) || [''])[0].trim(),
  },
  {
    key: 'detail', name: 'verify-agent-def-detail', script: 'scripts/verify-agent-def-detail.mjs',
    desc: '定义详情稿（118 项）', slow: true,
    pick: (s) => (s.match(/合计\s*\d+\/\d+\s*通过/) || s.match(/全部通过[^\n]*/) || [''])[0].trim(),
  },
  {
    key: 'audit', name: 'audit-proto-registry', script: 'scripts/audit-proto-registry.mjs',
    desc: '散落稿 / 版本族 / 登记自洽', slow: false,
    pick: (s) => (s.match(/[✓✗]\s*(PASS|FAIL)\s+\d+ 项问题[^\n]*/) || [''])[0].trim(),
  },
  {
    key: 'adopt', name: 'check-proto-adopt', script: 'scripts/check-proto-adopt.mjs',
    desc: '已并入稿可并入性回归', slow: false,
    /* 对每份已并入的稿单独体检：登记过的应该全 PASS，红了说明登记与源稿脱节 */
    dynamic: true,
  },
];

const run = (script, argv = []) => {
  const t0 = Date.now();
  const r = spawnSync(NODE, [script, ...argv], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  /* 子进程输出可能带 ANSI 色码（audit 用了）—— 不剥掉，pick 的正则会被 \x1b[0m 打断，
     结果行永远抽不出来，汇总表上就是一片空白。 */
  const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
  return { code: r.status, ms: Date.now() - t0, out };
};

/* adopt 是对「已并入的稿」逐个跑：一份稿一行结果，避免某一份退化了被整体平均掉 */
const runAdoptAll = () => {
  const rows = [];
  let code = 0, ms = 0;
  for (const s of SOURCE_DEFS) {
    const r = run('scripts/check-proto-adopt.mjs', [`docs/ui/prototypes/${s.file}`]);
    ms += r.ms;
    if (r.code !== 0) code = 1;
    const line = (r.out.match(/结论：([^\n]+)/) || [, r.code ? '需改造' : '可直接并入'])[1];
    rows.push(`${s.file}：${line}`);
  }
  return { code, ms, rows };
};

const chosen = STEPS.filter((s) => (!only.length || only.includes(s.key)) && !(fast && s.slow));
const results = [];
let total = 0;

console.log(`\n── 原型体系全量机检  ${fast ? '（--fast：跳过浏览器项）' : '（全量）'}`);

for (const st of chosen) {
  const r = st.dynamic ? runAdoptAll() : run(st.script);
  total += r.ms;
  const ok = r.code === 0;
  const detail = st.dynamic
    /* WARN 不打叉：FAIL 0 就是通过。之前用「结论是否含『可直接并入』」判，
       把「可并入（有提示项）」也标成 ✗ —— 假红比没红更糟，人会开始忽略这一列。 */
    ? (r.rows || []).map((x) => (/FAIL 0|可直接并入/.test(x) ? `✓ ${x}` : `✗ ${x}`)).join('  ')
    : (st.pick(r.out) || '');
  results.push({ st, ok, ms: r.ms, detail, out: r.out });
  console.log(`   ${ok ? '✓' : '✗'} ${st.name.padEnd(26)} ${String((r.ms / 1000).toFixed(1)).padStart(6)}s  ${detail}`);

  /* 失败时把该步的失败行直接打出来 —— 否则要再手工跑一遍才知道哪条红了 */
  if (!ok) {
    const bad = (r.out || '').split('\n').filter((l) => /FAIL|✗|问题 \d+ 项|Error/.test(l)).slice(0, 6);
    for (const b of bad) console.log(`       ${b.trim().slice(0, 160)}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n   ${failed.length ? '✗ FAIL' : '✓ PASS'}  ${results.length - failed.length}/${results.length} 步通过 · 总 ${(total / 1000).toFixed(1)}s`);
if (failed.length) {
  console.log(`   失败步骤：${failed.map((f) => f.st.name).join(', ')}`);
  console.log(`   单步复查：node ${failed[0].st.script}`);
}
process.exit(failed.length ? 1 : 0);
