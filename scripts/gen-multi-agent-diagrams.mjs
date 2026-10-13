/**
 * 生成「多 Agent 编排」两张 SVG + 索引页。
 *
 * 用法：node scripts/gen-multi-agent-diagrams.mjs
 * 产出：docs/architecture/multi-agent-paradigms.svg（四种范式对比与选型）
 *       docs/architecture/multi-agent-delegation-flow.svg（Agent-as-Tool 委派调用链）
 *       docs/architecture/multi-agent-diagrams.html（索引页，svg 内联，自包含）
 *
 * 数据驱动：改图只改下面的 DATA，不要手改产出的 SVG / HTML。
 * 事实底座：docs/architecture/multi-agent-design.md（结论均取自代码）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'docs/architecture');
const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const charW = (ch, size) => {
  if (/[\u4e00-\u9fa5\u3000-\u303f（）：；、「」]/.test(ch)) return size;
  if (ch === ' ') return size * 0.32;
  return size * 0.6;
};
const widthOf = (s, size) => [...s].reduce((a, ch) => a + charW(ch, size), 0);

function wrap(text, size, maxW) {
  const lines = [];
  let cur = '', curW = 0;
  const flush = () => { if (cur) lines.push(cur.replace(/\s+$/, '')); cur = ''; curW = 0; };
  for (const tk of String(text).split(/(\s+)/).filter((t) => t.length)) {
    const w = widthOf(tk, size);
    if (curW + w <= maxW) { cur += tk; curW += w; continue; }
    if (w > maxW) {
      flush();
      let seg = '', segW = 0;
      for (const ch of tk) {
        const cw = charW(ch, size);
        if (segW + cw > maxW && seg) { lines.push(seg); seg = ''; segW = 0; }
        seg += ch; segW += cw;
      }
      cur = seg; curW = segW;
    } else { flush(); cur = tk.replace(/^\s+/, ''); curW = widthOf(cur, size); }
  }
  flush();
  return lines.length ? lines : [''];
}

const TONE = {
  orange: { main: '#c2410c', soft: '#ffedd5', line: '#fdba74' },
  blue:   { main: '#1d4ed8', soft: '#dbeafe', line: '#93c5fd' },
  cyan:   { main: '#0e7490', soft: '#cffafe', line: '#67e8f9' },
  slate:  { main: '#334155', soft: '#eef2f7', line: '#cbd5e1' },
  rose:   { main: '#be123c', soft: '#ffe4e6', line: '#fda4af' },
};

const svgHead = (W, H, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" font-family="${FONT}">
<title>${esc(id.title)}</title><desc>${esc(id.desc)}</desc>
<defs>
  <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
    <path d="M1,1 L9,5 L1,9" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </marker>
</defs>
<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

/* ==================== 图 1：四种范式对比 ==================== */
const PARADIGMS = [
  { tone: 'orange', name: 'Agent-as-Tool 层级委派', ctrl: '控制流在父模型：子 Agent 作为一个「特殊工具」被调用',
    fit: '适配：专业分工与能力复用，覆盖约 80% 场景', tag: '推荐先做' },
  { tone: 'slate', name: 'Supervisor-Worker 编排分发', ctrl: '控制流在编排器：拆任务后分发给专职 worker',
    fit: '适配：任务边界清晰、可明确拆分的批处理', tag: '需新增编排器' },
  { tone: 'slate', name: 'Handoff 控制权交接', ctrl: '控制流在当前 Agent：主动把会话整个交出',
    fit: '适配：客服转人工这类会话态转移', tag: '需会话状态机' },
  { tone: 'slate', name: 'Pipeline 确定性图', ctrl: '控制流在代码：DAG 提前定义，模型只填节点内容',
    fit: '适配：流程固定且需可审计（如发布流水线）', tag: '与 ReAct 冲突' },
];

const PARADIGM_CONCL = [
  '选型：先做 Agent-as-Tool —— 它复用现有 ReAct 引擎与 ToolRegistry，不引入第二套控制流。',
  'Supervisor 与 Pipeline 的本质是「把控制流从模型手里收回」，与自主循环互斥，只在特定业务线按需引入。',
];

function renderParadigms() {
  const W = 1200, PAD = 40, GAP = 24;
  const CW = (W - PAD * 2 - GAP) / 2, CH = 104;
  const P = [];
  let y = 76;
  P.push(`<text x="${PAD}" y="48" font-size="19" font-weight="700" fill="#0f172a">四种编排范式：区别只在「下一步由谁决定」</text>`);
  PARADIGMS.forEach((m, i) => {
    const cx = PAD + (i % 2) * (CW + GAP);
    const cy = y + Math.floor(i / 2) * (CH + 20);
    const t = TONE[m.tone];
    P.push(`<rect x="${cx}" y="${cy}" width="${CW}" height="${CH}" rx="10" fill="#ffffff" stroke="${t.line}" stroke-width="1.2"/>`);
    P.push(`<rect x="${cx}" y="${cy}" width="${CW}" height="5" rx="2.5" fill="${t.main}"/>`);
    P.push(`<text x="${cx + 18}" y="${cy + 30}" font-size="15" font-weight="700" fill="${t.main}">${esc(m.name)}</text>`);
    const ctrlLines = wrap(m.ctrl, 12.8, CW - 62);
    ctrlLines.forEach((l, k) => P.push(`<text x="${cx + 18}" y="${cy + 52 + k * 19}" font-size="12.8" fill="#475569">${esc(l)}</text>`));
    P.push(`<text x="${cx + 18}" y="${cy + 74 + (ctrlLines.length - 1) * 19}" font-size="12.2" fill="#64748b">${esc(m.fit)}</text>`);
    P.push(`<rect x="${cx + CW - 96}" y="${cy + 12}" width="80" height="22" rx="11" fill="${m.tone === 'orange' ? t.soft : '#f1f5f9'}"/>`);
    P.push(`<text x="${cx + CW - 56}" y="${cy + 27}" font-size="11.5" font-weight="700" fill="${m.tone === 'orange' ? t.main : '#64748b'}" text-anchor="middle">${esc(m.tag)}</text>`);
  });
  y += 2 * (CH + 20) + 4;
  P.push(`<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="80" rx="10" fill="${TONE.orange.soft}" stroke="${TONE.orange.line}" stroke-width="1.2"/>`);
  PARADIGM_CONCL.forEach((l, k) => P.push(`<text x="${PAD + 20}" y="${y + 30 + k * 26}" font-size="13.4" fill="${TONE.orange.main}" font-weight="${k === 0 ? '700' : '400'}">${esc(l)}</text>`));
  const H = y + 80 + 24;
  return svgHead(W, H, { title: '多 Agent 四种编排范式对比', desc: 'Agent-as-Tool 层级委派、Supervisor-Worker 编排分发、Handoff 控制权交接、Pipeline 确定性图四种范式的控制流归属与适配场景对比，推荐先做 Agent-as-Tool' }) + P.join('\n') + '</svg>';
}

/* ==================== 图 2：Agent-as-Tool 委派调用链 ==================== */
const FLOW = [
  { tone: 'blue', t: '父 Agent ReAct 循环', s: '模型采样决定下一步：调普通工具，还是委派子 Agent —— 出口唯一，引擎无需感知差异', extra: 'packages/agent-core/src/core/agent-engine.ts' },
  { tone: 'blue', t: 'tool_call: agent:<子 Agent id>', s: '走与普通工具同一条 execute 路径；工具名由 capabilities 解析出（与 mcp 取短名同款规则）', extra: 'capability-resolver.ts 新增 type=agent 分支' },
  { tone: 'orange', t: '四道护栏（缺一不可，任一失败即短路返回错误，不阻塞父循环）', guards: [
    '深度上限 depth ≤ 3，超限直接返回错误，不再展开子调用',
    '调用栈去重：A→B→A 立即熔断，杜绝循环烧钱',
    '全局步数预算跨层递减，避免父子 maxSteps 相乘放大成本',
    '权限取「父 ∩ 子声明」的交集，不是并集，防权限放大',
  ] },
  { tone: 'cyan', t: '子 Agent 独立循环（registerLazy 按需拉起）', s: '只接收「子任务描述」，不继承父的完整上下文 —— 上下文隔离正是委派的收益所在', extra: 'ToolRegistry.registerLazy(name, factory)' },
  { tone: 'cyan', t: '返回结构化摘要', s: '只回结论 + 关键证据，不回过程全量；否则父上下文被撑爆，第二轮就超限', extra: '子 run 末步强制生成 summary' },
  { tone: 'blue', t: '摘要作为 tool_result 回写父上下文', s: '父循环继续推理；子 run 落 agent_runs 并挂 parentRunId + depth，保证可归因', extra: 'agent_runs 新增 parentRunId / depth' },
];

function renderFlow() {
  const W = 1200, PAD = 40, NW = W - PAD * 2, CX = W / 2;
  const P = [];
  let y = 76;
  P.push(`<text x="${PAD}" y="48" font-size="19" font-weight="700" fill="#0f172a">一次委派调用：父循环不动，子 Agent 只是一个「特殊工具」</text>`);
  FLOW.forEach((n, i) => {
    const t = TONE[n.tone];
    const sLines = wrap(n.s, 13, NW - 44);
    const gLines = (n.guards || []).map((g) => wrap(g, 12.6, NW - 62)).flat();
    const headH = 34;
    const bodyH = n.guards ? 20 + gLines.length * 21 : 8 + sLines.length * 20 + (n.extra ? 24 : 0);
    const h = headH + bodyH + 12;
    P.push(`<rect x="${PAD}" y="${y}" width="${NW}" height="${h}" rx="10" fill="#ffffff" stroke="${t.line}" stroke-width="1.2"/>`);
    P.push(`<rect x="${PAD}" y="${y}" width="5" height="${h}" rx="2.5" fill="${t.main}"/>`);
    P.push(`<text x="${PAD + 20}" y="${y + 23}" font-size="14.6" font-weight="700" fill="${t.main}">${esc(n.t)}</text>`);
    let ty = y + headH + 8;
    if (n.guards) {
      gLines.forEach((l) => { P.push(`<text x="${PAD + 34}" y="${ty + 12}" font-size="12.6" fill="#475569">${esc(l)}</text>`); ty += 21; });
    } else {
      sLines.forEach((l) => { P.push(`<text x="${PAD + 20}" y="${ty + 12}" font-size="13" fill="#475569">${esc(l)}</text>`); ty += 20; });
      if (n.extra) { P.push(`<text x="${PAD + 20}" y="${ty + 14}" font-size="11.8" fill="#94a3b8">代码落点：${esc(n.extra)}</text>`); ty += 18; }
    }
    y += h;
    if (i < FLOW.length - 1) {
      P.push(`<line x1="${CX}" y1="${y + 2}" x2="${CX}" y2="${y + 22}" stroke="#94a3b8" stroke-width="1.6" marker-end="url(#ah)"/>`);
      y += 26;
    }
  });
  const H = y + 24;
  return svgHead(W, H, { title: 'Agent-as-Tool 委派调用链', desc: '父 Agent ReAct 循环输出子 Agent 工具调用后，经四道护栏检查，按需拉起子 Agent 独立循环，返回结构化摘要回写父上下文' }) + P.join('\n') + '</svg>';
}

/* ==================== 输出 ==================== */
mkdirSync(OUT_DIR, { recursive: true });
const diagrams = [
  { file: 'multi-agent-paradigms.svg', svg: renderParadigms(), h2: '四种编排范式对比', span: '区别只在「下一步由谁决定」', lead: '先看这张定范式。四种范式不是并列优劣，而是「控制流放在谁手里」的差异：放在模型手里就有灵活性但难预测，放在代码手里就可控但丧失自主性。' },
  { file: 'multi-agent-delegation-flow.svg', svg: renderFlow(), h2: 'Agent-as-Tool 委派调用链', span: '父循环不动，子 Agent 只是一个「特殊工具」', lead: '范式定了之后看链路。关键点是子 Agent 走的是普通工具的同一条 execute 路径，所以引擎几乎不用改；真正要新增的是中间那道护栏。' },
];
for (const d of diagrams) {
  writeFileSync(resolve(OUT_DIR, d.file), d.svg, 'utf8');
  console.log('written:', d.file, `${(d.svg.length / 1024).toFixed(1)}KB`);
}

const page = `<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>多 Agent 编排 · 架构图</title>
<style>
  :root { --line:#e2e8f0; --ink:#0f172a; --muted:#64748b; --brand:#c2410c; --soft:#fff7ed; }
  body { margin:0; padding:32px 20px 64px; background:#f8fafc; color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; }
  .wrap { max-width:1240px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 6px; }
  .sub { color:var(--muted); font-size:13.5px; line-height:1.7; margin:0 0 8px; }
  .meta { color:#94a3b8; font-size:12.5px; margin:0 0 28px; }
  section { margin-top:34px; }
  h2 { font-size:17px; margin:0 0 4px; }
  h2 span { font-weight:400; font-size:13px; color:var(--muted); margin-left:8px; }
  .lead { color:#475569; font-size:13.5px; line-height:1.75; margin:0 0 14px; max-width:1000px; }
  .shot { background:#fff; border:1px solid var(--line); border-radius:12px; overflow:auto; padding:8px; }
  .note { margin-top:26px; background:var(--soft); border:1px solid #fed7aa; border-radius:10px; padding:14px 18px;
    font-size:13px; line-height:1.8; color:#7c2d12; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; font-size:12.5px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>多 Agent 编排 · 架构图</h1>
  <p class="sub">配套方案文档：<code>docs/architecture/multi-agent-design.md</code>。每张图说明「为什么这样选」与「落地改哪些文件」。</p>
  <p class="meta">生成物 · 改图请改 <code>scripts/gen-multi-agent-diagrams.mjs</code> 后重跑，不要手改 SVG / 本页</p>
${diagrams.map((d) => `  <section>
    <h2>${d.h2}<span>${d.span}</span></h2>
    <p class="lead">${d.lead}</p>
    <div class="shot">${d.svg.replace(/<rect x="0" y="0" width="\d+" height="\d+" fill="#ffffff"\/>/, '')}</div>
  </section>`).join('\n')}
  <div class="note">
    <strong>读法</strong>：先定范式（图一），再看链路（图二）。落地顺序建议「先补 <code>agent_runs.outcome</code> 质量归因，再上多 Agent」——
    顺序颠倒会得到一堆无法归因的失败：多 Agent 之后，「第几层第几步失败」在当前埋点下完全不可见。
  </div>
</div>
</body>
</html>
`;
writeFileSync(resolve(OUT_DIR, 'multi-agent-diagrams.html'), page, 'utf8');
console.log('written: multi-agent-diagrams.html', `${(page.length / 1024).toFixed(1)}KB`);
