#!/usr/bin/env node
/**
 * 生成「技术流程图：发布主链路（控制面 / 数据面）」。
 *
 * 设计依据（均为仓库内事实，勿凭记忆改）：
 *   - docs/architecture/system-overview.md（服务与端口、发布链路）
 *   - docs/operations/pipeline-boundary-scripts.md（S1 边界脚本化、四变量注入、短期 run 令牌）
 *   - 2026-10-10《console 平台边界与配置中心设计》(J1/J2/J3 判据、控制面/数据面、S1/S2/S3 演进)
 *
 * 改图请改本脚本的数据区后重跑：node scripts/gen-pipeline-flow-diagram.mjs
 * 勿手改生成物（SVG / HTML）。
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const W = 1480;
const H = 960;
const X0 = 28;
const X1 = 1452;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 状态徽章：done=已落地，todo=待建 */
const BADGE = {
  done: { fill: '#dcfce7', text: '#15803d', label: '已落地' },
  todo: { fill: '#f1f5f9', text: '#64748b', label: '待建' },
  part: { fill: '#fef3c7', text: '#b45309', label: '部分' },
};

// ── 数据区 ────────────────────────────────────────────────────────────────
const TRIGGERS = [
  { t: 'console UI', d: ['手动部署 · 一键回滚', '模块 × 环境 × 版本'] },
  { t: '流水线', d: ['手动 / 定时 / CI 触发', '三层：步骤 → 任务 → 动作'] },
  { t: '内部接口', d: ['脚本 / API 调用', '统一写入服务收口'] },
  { t: 'MCP 工具', d: ['AI Agent 调用', '/api/mcp（API Key 鉴权）'] },
];

/** 门禁：两行排布，避免单行过长溢出画布 */
const GATE = {
  t: '门禁 Gate（左移 + 持续验证）',
  rows: [
    [
      { t: 'PR 期', d: 'pipeline-lint L1–L9', s: 'done' },
      { t: '发布前', d: 'release_plan 不变量校验', s: 'todo' },
      { t: '发布中', d: '节点审批 + 环境审批', s: 'done' },
    ],
    [
      { t: '并发', d: '发布锁 CAS，owner = RUN_ID', s: 'done' },
      { t: '发布后', d: 'verify_release 断言', s: 'todo' },
      { t: '凭据', d: '短期 run 令牌（rt1_，run 结束撤销）', s: 'done' },
    ],
  ],
};

/** 三栏泳道：控制面 / 数据面 / 目标机 */
const LANES = [
  {
    key: 'control',
    title: '控制面 · deploy-console :6200',
    sub: '裁决与真相（J1 全局仲裁，单一写者）',
    x: 28,
    w: 390,
    fill: '#eff6ff',
    stroke: '#93c5fd',
    ink: '#1d4ed8',
    items: [
      { t: '编排状态机', d: '九阶段 · 条件分流 · 挂起/恢复 · 节点审批', s: 'done' },
      { t: '并发仲裁', d: '发布锁 CAS，owner = RUN_ID 端到端同源', s: 'done' },
      { t: '版本真相 version', d: '登记 commit 与版本引用，单一写者', s: 'done' },
      { t: '指针真相 pointer', d: 'env-dir 入口指针 + 云库镜像（prod 可读）', s: 'done' },
      { t: '配置中心', d: 'AES-GCM 主密钥 · 三级 scope · 下发 .env.generated', s: 'done' },
      { t: '短期 run 令牌', d: 'rt1_ JWT，单次 run + run 结束撤销', s: 'done' },
      { t: '审计 · 度量 · 期望态', d: '字段级 before/after；期望态供对账', s: 'part' },
    ],
    foot: '凭据不出平台：主密钥 / 主机私钥只在控制面',
  },
  {
    key: 'data',
    title: '数据面 · 脚本 / runner',
    sub: '执行但不裁决（J3 纯机械，可重试）',
    x: 508,
    w: 390,
    fill: '#fffbeb',
    stroke: '#fcd34d',
    ink: '#b45309',
    items: [
      { t: 'check 安全校验', d: '平台保留（J1：下放即可被绕过）', s: 'done' },
      { t: 'pull', d: 'git fetch / checkout；平台回填真实 commit', s: 'todo' },
      { t: 'build', d: '模块构建命令', s: 'todo' },
      { t: 'upload', d: 'scp 投递；平台注入四变量（S1 已脚本化）', s: 'done' },
      { t: 'config-dispatch', d: '取 .env.generated，短期令牌', s: 'done' },
      { t: 'restart', d: 'pm2 restart + 探活（禁 --update-env）', s: 'part' },
      { t: 'cleanup', d: '远端产物清理，保护名单由平台给', s: 'done' },
    ],
    foot: '脚本不持 SSH 私钥、不持应用密钥',
  },
  {
    key: 'target',
    title: '目标机 · 线上真实态',
    sub: 'dev / prod 两台云主机（拓扑与端口见 system-overview）',
    x: 988,
    w: 464,
    fill: '#f0fdf4',
    stroke: '#86efac',
    ink: '#15803d',
    items: [
      { t: '版本目录', d: 'static/modules/<key>/<env>/<commit>/（不可变）', s: 'done' },
      { t: '配置落盘', d: '.env.generated，服务启动时读取', s: 'done' },
      { t: 'pm2 进程', d: 'restart 生效；prod 无 deploy-console', s: 'done' },
      { t: 'gateway :6000', d: '读指针 → 静态直出 / 版本缓存 10s', s: 'done' },
      { t: 'Fact 采集', d: '版本 · 进程 · 目录 · 端口 · 配置 hash', s: 'todo' },
    ],
    foot: 'prod 零触碰：console 不在 prod 部署，交付走 S1 → S3',
  },
];

/** 泳道之间的交互（横向箭头 + 说明） */
const FLOWS = [
  { y: 340, from: 'A', to: 'B', lines: ['下发', '参数 + run 令牌'] },
  { y: 410, from: 'B', to: 'A', lines: ['回调', '/internal/release/*'] },
  { y: 500, from: 'B', to: 'C', lines: ['scp / ssh', '（S1 已落地）', 'runner 本地', '（S3 待建）'] },
  { y: 590, from: 'C', to: 'B', lines: ['探活结果', '文件数回读'] },
];

const EFFECT = {
  t: '生效与验证',
  lines: [
    '切指针 → 通知 gateway 刷新版本缓存 → 线上可读（先落地后改指针；空壳产物不投递）',
    'verify 断言：当前版本 == 目标版本 · 入口 200 · 无 pageerror · cdn 非 404 → 上报平台 → **平台裁决是否回滚**（J1：回滚改指针 = 真相变更）',
  ],
};

const RECONCILE = {
  t: 'Fact 层对账（漂移检测）',
  lines: [
    '期望态：版本记录 / 指针 / 配置中心 deliveries.content_hash　　↔　　真实态：目标机实际版本 · 进程 cwd · 目录 · 配置 hash',
    '不一致 = 漂移 → 告警 + 一键重下发 / 一键回滚（只告警不自动修复，采集只读不写业务表）',
  ],
};
// ── 数据区结束 ────────────────────────────────────────────────────────────

const svg = [];
const push = (s) => svg.push(s);

const text = (x, y, s, opt = {}) => {
  const {
    size = 12.5,
    fill = '#475569',
    weight = 400,
    anchor = 'start',
    baseline = 'alphabetic',
  } = opt;
  push(
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="${baseline}">${esc(s)}</text>`,
  );
};

const rect = (x, y, w, h, opt = {}) => {
  const { fill = '#ffffff', stroke = '#e2e8f0', sw = 1, rx = 9, dash } = opt;
  push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
  );
};

const arrow = (x1, y1, x2, y2, color = '#64748b') => {
  push(
    `<path d="M${x1},${y1} L${x2},${y2}" fill="none" stroke="${color}" stroke-width="1.4" marker-end="url(#ah-flow)"/>`,
  );
};

const badge = (x, y, state) => {
  const b = BADGE[state] || BADGE.todo;
  push(`<rect x="${x}" y="${y}" width="42" height="18" rx="9" fill="${b.fill}"/>`);
  text(x + 21, y + 9.5, b.label, {
    size: 10.5,
    fill: b.text,
    weight: 700,
    anchor: 'middle',
    baseline: 'central',
  });
};

push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`);
push(`<defs>
    <marker id="ah-flow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 z" fill="#64748b"/>
    </marker>
    <marker id="ah-flow-b" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 z" fill="#1d4ed8"/>
    </marker>
  </defs>`);
rect(0, 0, W, H, { fill: '#fffdf9', stroke: 'none' });

// 标题
text(X0, 34, '科豆 AI · 技术流程图：发布主链路（控制面 / 数据面）', {
  size: 22,
  weight: 800,
  fill: '#0f172a',
});
text(
  X0,
  58,
  '触发 → 门禁 → 编排裁决 → 脚本执行 → 真相写入 → 线上生效 → 验证 → 漂移对账　｜　判据：J1 全局仲裁留平台 · J2 凭据留平台 · J3 纯机械下放脚本',
  { size: 12.5, fill: '#64748b' },
);

// ── Row 1 触发源 ────────────────────────────────────────────────────────
const tY = 76;
const tH = 56;
const tW = 344;
const tGap = 16;
TRIGGERS.forEach((tr, i) => {
  const x = X0 + i * (tW + tGap);
  rect(x, tY, tW, tH, { stroke: '#67e8f9', sw: 1.2 });
  rect(x, tY, 5, tH, { fill: '#0e7490', rx: 3 });
  text(x + 16, tY + 22, tr.t, { size: 14.5, weight: 700, fill: '#0e7490' });
  text(x + 16, tY + 39, tr.d[0], { size: 11.5 });
  text(x + 16, tY + 51, tr.d[1], { size: 11.5 });
});
arrow(740, tY + tH, 740, tY + tH + 18);

// ── Row 2 门禁 ──────────────────────────────────────────────────────────
const gY = 152;
const gH = 88;
rect(X0, gY, X1 - X0, gH, { fill: '#fef2f2', stroke: '#fca5a5', sw: 1.2, rx: 10 });
rect(X0, gY, 5, gH, { fill: '#b91c1c', rx: 3 });
text(X0 + 16, gY + 24, GATE.t, { size: 15, weight: 800, fill: '#b91c1c' });
GATE.rows.forEach((row, ri) => {
  let cx = X0 + 16;
  const ty = gY + 46 + ri * 22;
  row.forEach((it) => {
    const label = `${it.t} ${it.d}`;
    text(cx, ty, label, { size: 12, fill: '#7f1d1d' });
    badge(cx + label.length * 11.6 + 8, ty - 13, it.s);
    cx += label.length * 11.6 + 68;
  });
});
arrow(740, gY + gH, 740, gY + gH + 18);

// ── Row 3 泳道 ──────────────────────────────────────────────────────────
const lY = 258;
const lH = 470;
LANES.forEach((lane) => {
  rect(lane.x, lY, lane.w, lH, { fill: lane.fill, stroke: lane.stroke, sw: 1.2, rx: 12 });
  text(lane.x + 16, lY + 26, lane.title, { size: 15, weight: 800, fill: lane.ink });
  text(lane.x + 16, lY + 44, lane.sub, { size: 11.5, fill: '#64748b' });

  const ix = lane.x + 16;
  const iw = lane.w - 32;
  let iy = lY + 58;
  const ih = lane.key === 'target' ? 56 : 46;
  const gap = lane.key === 'target' ? 12 : 8;
  lane.items.forEach((it) => {
    rect(ix, iy, iw, ih, { fill: '#ffffff', stroke: lane.stroke, sw: 1.1, rx: 9 });
    text(ix + 12, iy + (ih > 50 ? 22 : 20), it.t, { size: 13.5, weight: 700, fill: lane.ink });
    text(ix + 12, iy + (ih > 50 ? 40 : 35), it.d, { size: 11.5 });
    badge(ix + iw - 54, iy + (ih > 50 ? 30 : 26) - 9, it.s);
    iy += ih + gap;
  });
  text(lane.x + 16, lY + lH - 16, lane.foot, { size: 11, fill: '#64748b' });
});

// 泳道之间的横向流
const laneA = LANES[0];
const laneB = LANES[1];
const laneC = LANES[2];
FLOWS.forEach((f) => {
  const from = f.from === 'A' ? laneA : f.from === 'B' ? laneB : laneC;
  const to = f.to === 'A' ? laneA : f.to === 'B' ? laneB : laneC;
  const x1 = f.from === 'A' || f.from === 'B' ? from.x + from.w : from.x;
  const x2 = f.to === 'B' || f.to === 'C' ? to.x : to.x + to.w;
  const rightward = x2 > x1;
  arrow(rightward ? x1 + 2 : x1 - 2, f.y, rightward ? x2 - 3 : x2 + 3, f.y, '#1d4ed8');
  const mid = (Math.min(x1, x2) + Math.max(x1, x2)) / 2;
  f.lines.forEach((ln, i) => {
    text(mid, f.y + 16 + i * 13, ln, {
      size: 10.5,
      fill: '#1d4ed8',
      anchor: 'middle',
    });
  });
});
arrow(740, lY + lH, 740, lY + lH + 18);

// ── Row 4 生效与验证 ────────────────────────────────────────────────────
const eY = 746;
const eH = 76;
rect(X0, eY, X1 - X0, eH, { fill: '#eef2ff', stroke: '#a5b4fc', sw: 1.2, rx: 10 });
rect(X0, eY, 5, eH, { fill: '#4338ca', rx: 3 });
text(X0 + 16, eY + 24, EFFECT.t, { size: 15, weight: 800, fill: '#4338ca' });
EFFECT.lines.forEach((l, i) =>
  text(X0 + 16, eY + 44 + i * 17, l.replace(/\*\*/g, ''), { size: 12, fill: '#3730a3' }),
);
arrow(740, eY + eH, 740, eY + eH + 18);

// ── Row 5 漂移对账 ──────────────────────────────────────────────────────
const rY = 840;
const rH = 86;
rect(X0, rY, X1 - X0, rH, { fill: '#f5f3ff', stroke: '#c4b5fd', sw: 1.2, rx: 10 });
rect(X0, rY, 5, rH, { fill: '#6d28d9', rx: 3 });
text(X0 + 16, rY + 24, RECONCILE.t, { size: 15, weight: 800, fill: '#6d28d9' });
RECONCILE.lines.forEach((l, i) =>
  text(X0 + 16, rY + 44 + i * 17, l, { size: 12, fill: '#5b21b6' }),
);

// 底部注
text(
  X0,
  944,
  '读法：左栏「控制面」只做裁决与真相写入；中栏「数据面」只做执行；右栏是线上真实态。凭据（主密钥 / 主机私钥 / 应用密钥）全程不出左栏。',
  { size: 11.5, fill: '#64748b' },
);
push('</svg>');

const svgOut = svg.filter(Boolean).join('\n');
writeFileSync(resolve(ROOT, 'docs/architecture/deploy-pipeline-flow.svg'), svgOut + '\n');

// ── HTML 页 ─────────────────────────────────────────────────────────────
const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>科豆 AI · 技术流程图：发布主链路</title>
<style>
  :root { --bg:#fffdf9; --ink:#0f172a; --sub:#64748b; --brand:#c2410c; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; }
  header { padding:22px 28px 12px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 6px; font-size:19px; }
  header p { margin:0; color:var(--sub); font-size:12.5px; }
  section { padding:20px 28px 30px; border-bottom:1px dashed var(--line); }
  h2 { font-size:15px; margin:0 0 10px; }
  .shot { background:#fff; border:1px solid var(--line); border-radius:12px; overflow:auto; padding:6px; }
  .shot svg { display:block; width:100%; height:auto; }
  table { border-collapse:collapse; width:100%; font-size:12.5px; }
  th, td { border:1px solid var(--line); padding:7px 10px; text-align:left; vertical-align:top; }
  th { background:#f8fafc; font-weight:700; }
  footer { padding:18px 28px 40px; color:var(--sub); font-size:12px; line-height:1.8; }
</style>
</head>
<body>
<header>
  <h1>科豆 AI · 技术流程图：发布主链路（控制面 / 数据面）</h1>
  <p>生成脚本 <code>scripts/gen-pipeline-flow-diagram.mjs</code> · 改图请改脚本数据后重跑，勿手改 SVG/HTML</p>
</header>

<section>
  <h2>发布主链路</h2>
  <div class="shot">${svgOut}</div>
</section>

<section>
  <h2>读法</h2>
  <table>
    <tr><th style="width:120px">栏位</th><th>含义</th></tr>
    <tr><td>控制面</td><td>deploy-console :6200。只做「裁决与真相写入」：编排、并发锁、版本、指针、配置中心、审计。<b>判据 J1</b>——需要全局唯一裁决的，一律留平台。</td></tr>
    <tr><td>数据面</td><td>脚本 / runner。只做「执行」：拉取、构建、投递、重启、清理。<b>判据 J3</b>——给定参数即可完成、可重试。脚本拿短期 run 令牌回调平台，不持任何长期凭据。</td></tr>
    <tr><td>目标机</td><td>线上真实态：版本目录 / 配置落盘 / pm2 进程 / gateway 指针读取。prod 上不部署 console。</td></tr>
    <tr><td>徽章</td><td>已落地 = 代码已合入 master 并在 dev 验证；部分 = 已落地但未覆盖全部路径；待建 = 设计中尚未实现。</td></tr>
  </table>
</section>

<footer>
  依据：<code>docs/architecture/system-overview.md</code>、<code>docs/operations/pipeline-boundary-scripts.md</code>、
  <code>docs/development/release-reviews/2026-10-13-pipeline-boundary-scripts.md</code>。
</footer>
</body>
</html>
`;
writeFileSync(resolve(ROOT, 'docs/architecture/deploy-pipeline-flow.html'), html);

console.log('生成完成：');
console.log('  docs/architecture/deploy-pipeline-flow.svg');
console.log('  docs/architecture/deploy-pipeline-flow.html');
