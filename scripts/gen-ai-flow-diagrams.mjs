/**
 * 生成 AI 子系统「架构图 + 流程图」SVG + 索引页。
 *
 * 用法：node scripts/gen-ai-flow-diagrams.mjs
 * 产出：docs/architecture/ai-subsystem-architecture.svg（AI 子系统分层架构）
 *       docs/architecture/ai-agent-run-flow.svg（一次 Agent 运行主链路）
 *       docs/architecture/ai-knowledge-flow.svg（知识入库 / 检索 / 评测链路）
 *       docs/architecture/ai-flow-diagrams.html（索引页，svg 内联）
 *
 * 数据驱动：改图只改下面的 DATA。全部事实取自代码（见 ai-flow-technical-design.md）。
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
  cyan:   { main: '#0e7490', soft: '#cffafe', line: '#67e8f9' },
  blue:   { main: '#1d4ed8', soft: '#dbeafe', line: '#93c5fd' },
  orange: { main: '#c2410c', soft: '#ffedd5', line: '#fdba74' },
  purple: { main: '#6d28d9', soft: '#ede9fe', line: '#c4b5fd' },
  green:  { main: '#047857', soft: '#d1fae5', line: '#6ee7b7' },
  slate:  { main: '#334155', soft: '#e2e8f0', line: '#cbd5e1' },
  rose:   { main: '#be123c', soft: '#ffe4e6', line: '#fda4af' },
};

/* ============================ 1. 分层架构图 renderer ============================ */

function renderLayered(cfg) {
  const W = 1400, PAD = 28, LANE_W = 138, GAP = 12, ROW_GAP = 28;
  const CONTENT_X = PAD + LANE_W + 16;
  const CONTENT_W = W - CONTENT_X - PAD;
  const P = [];
  let y = PAD + 62;

  const rows = cfg.layers.map((layer) => {
    const groups = layer.groups.map((g) => {
      const n = g.boxes.length;
      const bw = (CONTENT_W - GAP * (n - 1)) / n;
      const boxes = g.boxes.map((b) => {
        const inner = bw - 26;
        const titleLines = wrap(b.title, 14.5, inner);
        const itemLines = [];
        for (const it of b.items || []) itemLines.push(...wrap(it, 12, inner - 2));
        const headH = Math.max(32, 13 + titleLines.length * 20 + 2);
        const h = Math.max(headH + (itemLines.length ? 4 : 0) + itemLines.length * 18 + 12, 58);
        return { box: b, titleLines, itemLines, headH, h, w: bw };
      });
      return { ...g, boxes, h: Math.max(...boxes.map((b) => b.h)) };
    });
    const hasGT = layer.groups.some((g) => g.title);
    const h = groups.reduce((a, g) => a + g.h, 0) + (groups.length - 1) * 14
      + layer.groups.filter((g) => g.title).length * 20 + (hasGT ? 0 : 8);
    return { layer, groups, h };
  });

  for (const row of rows) {
    const tone = TONE[row.layer.tone];
    P.push(`<rect x="${PAD}" y="${y}" width="${LANE_W}" height="${row.h}" rx="10" fill="${tone.soft}" stroke="${tone.line}"/>`);
    P.push(`<rect x="${PAD}" y="${y}" width="5" height="${row.h}" rx="3" fill="${tone.main}"/>`);
    P.push(`<text x="${PAD + 18}" y="${y + row.h / 2 - 2}" font-family="${FONT}" font-size="15" font-weight="700" fill="${tone.main}">${esc(row.layer.name)}</text>`);
    P.push(`<text x="${PAD + 18}" y="${y + row.h / 2 + 15}" font-family="${FONT}" font-size="11" fill="#64748b">${esc(row.layer.note || '')}</text>`);

    let gy = y + 6;
    for (const g of row.groups) {
      if (g.title) {
        P.push(`<text x="${CONTENT_X + 2}" y="${gy + 12}" font-family="${FONT}" font-size="11.5" font-weight="700" fill="#475569">${esc(g.title)}</text>`);
        gy += 20;
      }
      let gx = CONTENT_X;
      for (const b of g.boxes) {
        P.push(`<rect x="${gx}" y="${gy}" width="${b.w}" height="${g.h}" rx="9" fill="#ffffff" stroke="${tone.line}" stroke-width="1.2"/>`);
        P.push(`<rect x="${gx}" y="${gy}" width="${b.w}" height="${b.headH}" rx="9" fill="${tone.soft}"/>`);
        P.push(`<rect x="${gx}" y="${gy + b.headH - 6}" width="${b.w}" height="6" fill="${tone.soft}"/>`);
        let ty = gy + 13 + 11;
        for (const l of b.titleLines) {
          P.push(`<text x="${gx + 13}" y="${ty}" font-family="${FONT}" font-size="14.5" font-weight="700" fill="${tone.main}">${esc(l)}</text>`);
          ty += 20;
        }
        let iy = gy + b.headH + 15;
        for (const l of b.itemLines) {
          P.push(`<text x="${gx + 13}" y="${iy}" font-family="${FONT}" font-size="12" fill="#475569">${esc(l)}</text>`);
          iy += 18;
        }
        gx += b.w + GAP;
      }
      gy += g.h + 14;
    }
    y += row.h + ROW_GAP;
    const cx = CONTENT_X + CONTENT_W / 2;
    P.push(`<line x1="${cx}" y1="${y - ROW_GAP + 6}" x2="${cx}" y2="${y - 8}" stroke="#64748b" stroke-width="2" marker-end="url(#arm-${cfg.id})"/>`);
  }

  const footY = y + 4;
  let ny = footY;
  const H = footY + cfg.notes.length * 22 + 46;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`
    + `<defs><marker id="arm-${cfg.id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#64748b"/></marker></defs>`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="#fffdf9"/>`
    + `<text x="${PAD}" y="${PAD + 8}" font-family="${FONT}" font-size="21" font-weight="800" fill="#0f172a">${esc(cfg.title)}</text>`
    + `<text x="${PAD}" y="${PAD + 32}" font-family="${FONT}" font-size="12.5" fill="#64748b">${esc(cfg.subtitle)}</text>`;
  svg += P.join('\n');
  svg += `<line x1="${PAD}" y1="${footY - 10}" x2="${W - PAD}" y2="${footY - 10}" stroke="#e2e8f0"/>`;
  for (const n of cfg.notes) {
    svg += `<text x="${PAD}" y="${ny + 12}" font-family="${FONT}" font-size="11.5" fill="#475569">· ${esc(n)}</text>`;
    ny += 22;
  }
  svg += `<text x="${PAD}" y="${ny + 26}" font-family="${FONT}" font-size="11" fill="#94a3b8">${esc(cfg.footnote)}</text></svg>`;
  return svg;
}

/* ============================ 2. 流程图 renderer ============================ */

function renderFlow(cfg) {
  const W = 1320, PAD = 30;
  const CX = 430, NW = 560;           // 主干列：x 起点与宽度
  const NOTE_X = CX + NW + 46;        // 右侧注释列
  const NOTE_W = W - NOTE_X - PAD;
  const P = [];
  let y = PAD + 74;

  const openLoops = [];
  const openRecurs = [];
  const nodeTops = [];
  let seq = 0;

  const boxes = cfg.flow.map((n) => {
    const inner = NW - 30;
    const tLines = wrap(n.t, 14, inner);
    const sLines = n.s ? wrap(n.s, 12, inner) : [];
    // 右侧注释按行数占高，若不把节点撑到至少容纳注释，相邻注释卡片会重叠
    const noteLines = n.note ? wrap(n.note, 12, NOTE_W - 6) : [];
    const noteNeed = noteLines.length ? 14 + noteLines.length * 17 + 8 : 0;
    let h;
    if (n.k === 'decision') h = Math.max(72, 24 + tLines.length * 18 + (sLines.length ? sLines.length * 16 : 0));
    else if (n.k === 'start' || n.k === 'end') h = Math.max(48, 18 + tLines.length * 19 + (sLines.length ? sLines.length * 16 + 4 : 0));
    else h = Math.max(56, 18 + tLines.length * 19 + (sLines.length ? sLines.length * 16 + 4 : 0));
    if (noteNeed) h = Math.max(h, noteNeed);
    // 容器节点（循环/递归）不占序号，避免主链序号断号
    const isContainer = ['loop-start', 'loop-end', 'recur-start', 'recur-end'].includes(n.k);
    return { n, tLines, sLines, h, idx: isContainer ? 0 : ++seq, top: 0 };
  });

  for (const b of boxes) {
    const tone = TONE[b.n.tone || 'orange'];
    b.top = y;
    nodeTops.push(b.top);
    // 嵌套容器（循环 / 递归）按已打开层数缩进，避免内外框重叠
    const nestDepth = () => openLoops.length + openRecurs.length;

    if (b.n.k === 'loop-start') {
      const d = nestDepth();
      openLoops.push({ y, d, ...b.n });
      const bx = CX - 26 + d * 15, bw = NW + 52 - d * 30;
      P.push(`<rect x="${bx}" y="${y}" width="${bw}" height="0" rx="12" fill="#04785710" stroke="#34d399" stroke-dasharray="8 5" stroke-width="1.8" data-loop="1"/>`);
      P.push(`<text x="${bx + 18}" y="${y + 16}" font-family="${FONT}" font-size="12" font-weight="700" fill="${tone.main}">${esc(b.n.t)}</text>`);
      const nLines = wrap(b.n.s || '', 12, NOTE_W - d * 30);
      if (nLines.length) {
        P.push(`<text x="${NOTE_X}" y="${y + 16}" font-family="${FONT}" font-size="12" fill="#64748b">${nLines.map((l, i) => `<tspan x="${NOTE_X}" dy="${i ? 17 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
      }
      y += 30;
      continue;
    }
    if (b.n.k === 'loop-end') {
      const lp = openLoops.pop();
      if (lp) {
        // 补 loop 容器矩形高度
        const idx = P.findIndex((s) => s.includes('data-loop="1"') && s.includes(`y="${lp.y}"`));
        if (idx >= 0) P[idx] = P[idx].replace('height="0"', `height="${Math.max(40, y - lp.y - 10)}"`);
        // 左侧回环虚线（让开序号徽章列，内层随缩进右移）
        const lx = CX - 110 + lp.d * 21;
        P.push(`<path d="M ${CX} ${y + b.h / 2} L ${lx} ${y + b.h / 2} L ${lx} ${lp.y + 6} L ${CX - 58 - lp.d * 21} ${lp.y + 6}" fill="none" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="6 5" marker-end="url(#frm-${cfg.id})"/>`);
        P.push(`<text x="${lx - 6}" y="${(lp.y + y) / 2}" font-family="${FONT}" font-size="11.5" fill="#64748b" text-anchor="end">${esc(b.n.t || '循环')}</text>`);
      }
      continue;
    }
    // 递归层：子 Agent 委派时展开的一层子链路（不是循环，不画回环线，只画「回父」标注）
    if (b.n.k === 'recur-start') {
      const d = nestDepth();
      openRecurs.push({ y, d, ...b.n });
      const bx = CX - 26 + d * 15, bw = NW + 52 - d * 30;
      P.push(`<rect x="${bx}" y="${y}" width="${bw}" height="0" rx="12" fill="#0e749008" stroke="#67e8f9" stroke-dasharray="3 4" stroke-width="1.8" data-recur="1"/>`);
      P.push(`<text x="${bx + 18}" y="${y + 16}" font-family="${FONT}" font-size="12" font-weight="700" fill="${tone.main}">${esc(b.n.t)}</text>`);
      const nLines = wrap(b.n.s || '', 12, NOTE_W - d * 30);
      if (nLines.length) {
        P.push(`<text x="${NOTE_X}" y="${y + 16}" font-family="${FONT}" font-size="12" fill="#64748b">${nLines.map((l, i) => `<tspan x="${NOTE_X}" dy="${i ? 17 : 0}">${esc(l)}</tspan>`).join('')}</text>`);
      }
      y += 30;
      continue;
    }
    if (b.n.k === 'recur-end') {
      const rc = openRecurs.pop();
      if (rc) {
        const idx = P.findIndex((s) => s.includes('data-recur="1"') && s.includes(`y="${rc.y}"`));
        if (idx >= 0) P[idx] = P[idx].replace('height="0"', `height="${Math.max(40, y - rc.y - 10)}"`);
        P.push(`<path d="M ${CX + NW - 30} ${y + 4} L ${CX + NW - 30} ${y - 6}" fill="none" stroke="#0e7490" stroke-width="1.6" marker-end="url(#frm-${cfg.id})"/>`);
        P.push(`<text x="${CX + NW - 38}" y="${y + 12}" font-family="${FONT}" font-size="11.5" fill="#0e7490" text-anchor="end">${esc(b.n.t || '↑ 回父循环')}</text>`);
      }
      y += 24;
      continue;
    }

    // 节点本体
    if (b.n.k === 'decision') {
      const cy = y + b.h / 2;
      P.push(`<polygon points="${CX},${cy} ${CX + NW / 2},${y} ${CX + NW},${cy} ${CX + NW / 2},${y + b.h}" fill="#fff" stroke="${tone.main}" stroke-width="1.6"/>`);
      let ty = cy - (b.tLines.length * 18) / 2 + 14 - (b.sLines.length ? 8 : 0);
      for (const l of b.tLines) {
        P.push(`<text x="${CX + NW / 2}" y="${ty}" font-family="${FONT}" font-size="14" font-weight="700" fill="${tone.main}" text-anchor="middle">${esc(l)}</text>`);
        ty += 18;
      }
      let sy = ty + 2;
      for (const l of b.sLines) {
        P.push(`<text x="${CX + NW / 2}" y="${sy}" font-family="${FONT}" font-size="12" fill="#64748b" text-anchor="middle">${esc(l)}</text>`);
        sy += 16;
      }
      // 决策点也给序号，保证主链序号连续
      const dbx = CX - 20 - nestDepth() * 21;
      P.push(`<circle cx="${dbx}" cy="${cy}" r="13" fill="${tone.soft}" stroke="${tone.line}"/>`);
      P.push(`<text x="${dbx}" y="${cy + 5}" font-family="${FONT}" font-size="12" font-weight="700" fill="${tone.main}" text-anchor="middle">${b.idx}</text>`);
    } else {
      const rx = (b.n.k === 'start' || b.n.k === 'end') ? 22 : 10;
      P.push(`<rect x="${CX}" y="${y}" width="${NW}" height="${b.h}" rx="${rx}" fill="#fff" stroke="${tone.line}" stroke-width="1.5"/>`);
      const isCap = b.n.k === 'start' || b.n.k === 'end';
      // 起止节点内容整体垂直居中；其余节点顶部对齐（下方可能还有 s 行）
      const blockH = b.tLines.length * 19 + (b.sLines.length ? b.sLines.length * 16 + 4 : 0);
      let ty = isCap ? y + Math.max(10, (b.h - blockH) / 2 + 14) : y + 22;
      for (const l of b.tLines) {
        P.push(`<text x="${CX + 15}" y="${ty}" font-family="${FONT}" font-size="14" font-weight="700" fill="${tone.main}">${esc(l)}</text>`);
        ty += 19;
      }
      let sy = ty + 2;
      for (const l of b.sLines) {
        P.push(`<text x="${CX + 15}" y="${sy}" font-family="${FONT}" font-size="12" fill="#64748b">${esc(l)}</text>`);
        sy += 16;
      }
      // 序号徽章：按嵌套层级左移，避免压住循环 / 递归容器边框
      const bx = CX - 20 - nestDepth() * 21;
      P.push(`<circle cx="${bx}" cy="${y + b.h / 2}" r="13" fill="${tone.soft}" stroke="${tone.line}"/>`);
      P.push(`<text x="${bx}" y="${y + b.h / 2 + 5}" font-family="${FONT}" font-size="12" font-weight="700" fill="${tone.main}" text-anchor="middle">${b.n.k === 'end' ? '✓' : b.idx}</text>`);
    }

    // 右侧注释 / 分支说明
    if (b.n.note) {
      const nLines = wrap(b.n.note, 12, NOTE_W - 6);
      const nh = 14 + nLines.length * 17;
      const nt = TONE[b.n.noteTone || 'slate'];
      const ny0 = Math.max(y + b.h / 2 - nh / 2, y - 4);
      P.push(`<line x1="${CX + NW + 4}" y1="${y + b.h / 2}" x2="${NOTE_X - 6}" y2="${y + b.h / 2}" stroke="${nt.line}" stroke-width="1.4" stroke-dasharray="4 4"/>`);
      P.push(`<rect x="${NOTE_X}" y="${ny0}" width="${NOTE_W}" height="${nh}" rx="8" fill="${nt.soft}" stroke="${nt.line}"/>`);
      nLines.forEach((l, i) => {
        P.push(`<text x="${NOTE_X + 10}" y="${ny0 + 18 + i * 17}" font-family="${FONT}" font-size="12" fill="#475569">${esc(l)}</text>`);
      });
    }
    y += b.h + 26;
  }

  // 主干连接箭头（在相邻节点之间）
  const main = boxes.filter((b) => !['loop-start', 'loop-end', 'recur-start', 'recur-end'].includes(b.n.k));
  for (let i = 0; i < main.length - 1; i++) {
    const a = main[i], b2 = main[i + 1];
    const x = CX + NW / 2;
    const y1 = a.top + a.h + 2, y2 = b2.top - 4;
    if (y2 > y1) P.push(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#64748b" stroke-width="2" marker-end="url(#frm-${cfg.id})"/>`);
  }

  const H = y + 40;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`
    + `<defs><marker id="frm-${cfg.id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#64748b"/></marker></defs>`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="#fffdf9"/>`
    + `<text x="${PAD}" y="${PAD + 8}" font-family="${FONT}" font-size="21" font-weight="800" fill="#0f172a">${esc(cfg.title)}</text>`
    + `<text x="${PAD}" y="${PAD + 32}" font-family="${FONT}" font-size="12.5" fill="#64748b">${esc(cfg.subtitle)}</text>`
    + `<text x="${NOTE_X}" y="${PAD + 62}" font-family="${FONT}" font-size="11.5" font-weight="700" fill="#94a3b8">右侧 = 实现要点 / 分支说明 / 落点</text>`;
  svg += P.join('\n');
  svg += `<text x="${PAD}" y="${H - 14}" font-family="${FONT}" font-size="11" fill="#94a3b8">${esc(cfg.footnote)}</text></svg>`;
  return svg;
}

/* ============================ 3. 图数据 ============================ */

const AI_ARCH = {
  id: 'arch', type: 'layered', file: 'ai-subsystem-architecture',
  title: 'AI 子系统架构图（web_system）',
  subtitle: '六层：终端接入 → 服务编排（ai-agent / ai-service）→ 运行时核心（agent-core）→ 能力端口 → 模型层 → 数据与可观测',
  footnote: '事实来源：agent.controller.ts / agent-engine.ts / intent.service.ts / mcp.service.ts / knowledge-service。虚线=异步或可选。',
  layers: [
    { name: '终端接入', tone: 'slate', note: '谁发起',
      groups: [{ boxes: [
        { title: 'portal / admin / 小程序', items: ['SSE 消费逐字流与过程事件', 'admin-run 需 agents:debug'] },
        { title: '开放接入', items: ['MCP 订阅方 / API Key'] },
      ] }] },
    { name: '服务编排', tone: 'cyan', note: 'Nest 服务',
      groups: [{ boxes: [
        { title: 'ai-agent :6010', items: ['POST /agent/run（SSE）', 'IntentService 意图路由 / 定义检索', 'PermissionBroker 权限确认（60s）', 'Steps 落库 + 后置钩子'] },
        { title: 'ai-service :6003', items: ['chat / chatStream 普通对话', 'Agent 定义 CRUD（draft/published）', '运行日志 AgentRun 与成本统计'] },
      ] }] },
    { name: '运行时核心', tone: 'orange', note: 'agent-core',
      groups: [{ boxes: [
        { title: 'AgentEngine（ReAct）', items: ['for step < maxSteps 循环', '工具调用 → 结果回写 → 再推理', 'streaming 逐字透传'] },
        { title: '上下文装配', items: ['systemPrompt + 技能目录', '历史摘要 compaction', '长期 profile 记忆'] },
        { title: '遥测 TelemetryPort', items: ['run / llm / tool / skill / end'] },
      ] }] },
    { name: '能力端口', tone: 'purple', note: '工具生态',
      groups: [{ boxes: [
        { title: 'ToolRegistry', items: ['本地工具 · 统一 ToolResult'] },
        { title: 'MCP 适配器', items: ['mcp-gateway /mcp/tools/call', '异步 job + 轮询结果'] },
        { title: 'SkillLoader', items: ['按需 load_skill 挂载'] },
        { title: 'KnowledgeTool', items: ['knowledge_search / ingest 等'] },
        { title: '委派（子 Agent）', items: ['设计中 · 尚未实现', '方案见 multi-agent-design.md'] },
      ] }] },
    { name: '模型层', tone: 'blue', note: '可换',
      groups: [{ boxes: [
        { title: 'ClientRegistry', items: ['DB 字典 → env → 内置（60s 轮询）', 'getOrFallback 兜底不抛错', 'hy3 由专用 client 承载（混入清单会被跳过）'] },
        { title: '意图分类模型', items: ['INTENT_MODEL 独立小模型', '3s 超时 → 规则 → 兜底'] },
      ] }] },
    { name: '数据与可观测', tone: 'green', note: '沉淀',
      groups: [{ boxes: [
        { title: 'MySQL', items: ['agent_definitions / versions', 'agent_runs（步骤与用量）', 'agent_conversations（锁定）'] },
        { title: 'knowledge-service :6011', items: ['集合 / 文档 / 向量检索', 'Ragas 离线评测'] },
        { title: '成本与 trace', items: ['usage → DictPricing → cost'] },
      ] }] },
  ],
  notes: [
    '控制流所有权分工：代码定骨架（循环 + maxSteps + 判别失败），模型只决定「下一步调哪个工具」——ReAct 的叶子由模型填。',
    '意图路由优先级：@显式 > 显式传入 > 会话锁定 > 规则 > LLM(3s 超时) > 兜底 general；失败一律回落，绝不阻塞主对话。',
    '权限确认是工具级 HITL：permission_request 事件 → 前端确认 → POST /agent/permission/:requestId → Promise resolve/reject（60s 自动拒绝）。',
    '⚠ 本图按 master 现状绘制：调参仅透传 temperature（topP/maxTokens/thinking 在分支 feat/llm-tuning-multi-model 未合入）；多 Agent 委派为设计中能力，方案见 docs/architecture/multi-agent-design.md。',
  ],
};

const AGENT_FLOW = {
  id: 'flow', type: 'flow', file: 'ai-agent-run-flow',
  title: '一次 Agent 运行的完整链路（POST /agent/run · SSE）',
  subtitle: '从 HTTP 请求进入，到 SSE 流关闭；含意图路由、多步工具循环、权限确认、子 Agent 递归展开、超步数终止与异步落库',
  footnote: '事实来源：servers/ai-agent/src/agent/agent.controller.ts:122-348 · packages/agent-core/src/core/agent-engine.ts:60-366。青色虚线框 = 子 Agent 委派时递归展开的一层（设计中，方案见 docs/architecture/multi-agent-design.md）；单 Agent 场景下不进入该框。',
  flow: [
    { k: 'start', tone: 'slate', t: '客户端发起 POST /api/agent/run', s: 'Authorization 鉴权穿透（AuthGuard）',
      note: '响应头：text/event-stream + no-cache + X-Accel-Buffering:no（禁 nginx 缓冲）' },
    { k: 'step', tone: 'cyan', t: 'IntentService.resolve 意图路由', s: '客户端传死的 agentId → 服务端解析',
      note: '五步优先级：@显式 > 显式传入 > 会话锁定 > 规则(≥.88) > LLM(≥.75, 3s超时) > 兜底 general' },
    { k: 'step', tone: 'cyan', t: '下发 SSE intent 事件', s: '必须早于任何 token 输出',
      note: '前端据此渲染 Agent 徽标 / 排查误判；时序要求写在 controller 注释里' },
    { k: 'step', tone: 'cyan', t: 'AgentRegistry 取定义快照', s: 'systemPrompt / tools / model / version',
      note: '易漏点：要用解析后的 id 取快照，用 dto.agentId 会在 auto 时空掉' },
    { k: 'step', tone: 'orange', t: '上下文装配 messages', s: 'system + 技能目录 + 历史摘要 + 长期 profile + 用户输入',
      note: 'memory.compaction 摘要 + keepRecent；长期 profile 跨会话' },
    { k: 'decision', tone: 'purple', t: 'Agent 是否挂载技能？', s: 'capabilities.skills.length > 0',
      note: '是 → 追加技能目录到 systemPrompt，并注入 load_skill 工具；否 → 直接生成 tool schemas' },
    { k: 'step', tone: 'orange', t: 'ToolRegistry.toSchemas 生成工具 schema', s: 'temperature 透传（master 现状）',
      note: 'agent-engine.ts:165 只传 temperature（agent.interface.ts 仅有 maxSteps + temperature?）；topP/maxTokens/thinking 属 C7 变更，仍在分支 feat/llm-tuning-multi-model，未合入 master' },
    { k: 'loop-start', tone: 'green', t: '循环：for step < maxSteps', s: 'maxSteps 由 DB 定义配置' },
    { k: 'step', tone: 'blue', t: 'client.chatWithToolsStream 调模型', s: 'content_delta / reasoning_delta / done',
      note: '模型失败或空返回 → 带错误码 SSE error 事件 + onRunEnd(status=error)' },
    { k: 'decision', tone: 'rose', t: '模型返回工具调用？', s: 'resp.toolCalls.length === 0',
      note: '否 → memory.persist 落库 → 有工具步骤则发 summary → 发 final → end(ok)' },
    { k: 'step', tone: 'purple', t: '下发 tool_call 事件，执行工具', s: 'tool_call → 执行 → tool_result',
      note: '四类工具：本地 / MCP（经 mcp-gateway 异步 job 轮询）/ load_skill 内置 / 子 Agent 委派（第四类 = 下方递归块，设计中）' },
    { k: 'decision', tone: 'rose', t: '工具是否需要人工确认？', s: 'requiresConfirm = 写操作',
      note: '是 → permission_request 事件挂起 → 前端 POST /agent/permission/:requestId；60s 超时自动拒绝；子 Agent 委派同样先过这道门' },
    { k: 'recur-start', tone: 'cyan', t: '↻ 条件进入：工具是「子 Agent」时才展开这一层（depth+1）',
      s: '设计中 · 方案见 docs/architecture/multi-agent-design.md；入口前先过四道护栏' },
    { k: 'step', tone: 'cyan', t: '四道护栏（任一不满足即短路返回错误，不阻塞父循环）', s: 'depth ≤ 3 · 调用栈去重 · 全局步数预算 · 权限取交集',
      note: '预算必须跨层共享：父子各用各自 maxSteps 会相乘放大成本；权限取「父 ∩ 子」而非并集，防越权' },
    { k: 'step', tone: 'cyan', t: '取子定义快照 + 装配子上下文（registerLazy 拉起）', s: '只传子任务描述，不继承父上下文 —— 上下文隔离正是委派的收益',
      note: '子 run 落 agent_runs 并挂 parentRunId + depth，否则多层失败无法归因（这也是先补 outcome 再上多 Agent 的原因）' },
    { k: 'step', tone: 'cyan', t: '子 Agent 独立 ReAct 循环', s: '走的还是本图 ⑤→⑫ 这一段，只是换了一套定义与上下文',
      note: 'SSE 口径：子链路的过程事件默认折叠，对外只表现为父的一条 tool_call / tool_result —— 否则前端事件流翻倍且难以归因' },
    { k: 'step', tone: 'cyan', t: '末步产出结构化摘要', s: '只回结论 + 关键证据，不回过程全量',
      note: '不截断就会把父上下文撑爆，第二轮直接超窗；摘要回写后父循环继续推理' },
    { k: 'recur-end', t: '摘要作为 tool_result 回到父循环' },
    { k: 'step', tone: 'orange', t: 'tool_result 回写 messages', s: 'onToolSpan(ok/latency) 遥测',
      note: '特殊项：present-music-card 的工具结果额外转成 card 事件下发前端' },
    { k: 'loop-end', t: '继续下一轮推理（工具结果入上下文）' },
    { k: 'step', tone: 'rose', t: '超步数终止', s: '达到最大步数限制 (maxSteps)',
      note: '先 persist 已产生消息，再发 error 事件 + onRunEnd(status=error) —— 不丢已有上下文' },
    { k: 'step', tone: 'green', t: 'SSE 关闭 res.end()', s: 'steps 流水异步落库 agent_runs（含 usage）',
      note: 'content_delta / reasoning_delta 逐字增量不落 steps，避免表膨胀' },
    { k: 'end', tone: 'green', t: '后置钩子 fire-and-forget', s: '用户记忆更新等插件（失败不影响结果）' },
  ],
};

const KB_FLOW = {
  id: 'kbf', type: 'flow', file: 'ai-knowledge-flow',
  title: '知识链路：入库 → 检索 → 评测（knowledge-service :6011）',
  subtitle: '知识以「集合」为单位绑定 Agent 定义，经 MCP 工具被运行时调用；离线评测独立于在线链路',
  footnote: '事实来源：servers/knowledge-service/src/knowledge/* · ai-agent agent-def-sync.service.ts（装配规则）· mcp.service.ts。',
  flow: [
    { k: 'step', tone: 'cyan', t: 'admin 创建知识集合 / 上传文档', s: 'collections.service / documents.service',
      note: '集合是绑定单位：一个 Agent 可绑多个集合，工具按集合级 enabled 校验' },
    { k: 'step', tone: 'cyan', t: '入库：分块 → embedding → 落库', s: 'documents → chunks → vectors',
      note: '库：web_system_knowledge（与业务主库分离）' },
    { k: 'step', tone: 'purple', t: '装配：集合随 Agent 定义绑定', s: 'ai-agent agent-def-sync 同步 → ToolRegistry 注册 MCP 工具',
      note: '装配规则：按集合操作的工具（search/ingest/delete）必须有 collectionId；集合无关的（list/status）只要绑定 ≥1 个集合就注册' },
    { k: 'step', tone: 'orange', t: '运行时检索：模型调用 knowledge_search', s: 'ToolRegistry.execute → McpToolExecutor',
      note: '工具链：Agent → mcp-gateway :6006 → /knowledge/mcp/search（InternalKey 鉴权）' },
    { k: 'step', tone: 'green', t: '检索返回 topK 上下文', s: '默认 topK=5，余弦检索',
      note: '当前无混合检索 / rerank —— 召回质量是待补的最高质量杠杆' },
    { k: 'step', tone: 'orange', t: '结果回写 messages 继续推理', s: '工具结果作为 tool 消息入上下文',
      note: '模型据此生成最终回答，与普通工具结果走同一条回写路径' },
    { k: 'decision', tone: 'rose', t: '需要量化检索质量时？', s: '离线评测独立于在线链路',
      note: '是 → POST /knowledge/mcp/eval 跑 Ragas 三指标；否 → 在线链路到此结束' },
    { k: 'step', tone: 'green', t: '评测：context_relevance · answer_relevance · faithfulness', s: 'rag-eval.service.ts 逐个 case 打分后取均值',
      note: '用例集目前由请求体传入（cases:[{question}]），尚未沉淀成版本化 golden 集 —— Phase4 eval_cases 待落地' },
    { k: 'end', tone: 'green', t: '产出评估报告 → 指导改 KB / prompt / 编排', s: 'metrics 三均值 + 每个 case 明细' },
  ],
};

/* ============================ 4. 输出 ============================ */
mkdirSync(OUT_DIR, { recursive: true });
const out = [];
for (const cfg of [AI_ARCH, AGENT_FLOW, KB_FLOW]) {
  const svg = cfg.type === 'layered' ? renderLayered(cfg) : renderFlow(cfg);
  const p = resolve(OUT_DIR, `${cfg.file}.svg`);
  writeFileSync(p, svg, 'utf8');
  out.push({ cfg, svg });
  console.log('written:', p, `${(svg.length / 1024).toFixed(1)}KB`);
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>AI 子系统架构图与流程图</title>
<style>
  :root { --bg:#fffdf9; --ink:#0f172a; --sub:#64748b; --brand:#c2410c; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; }
  header { padding:22px 28px 12px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); }
  h1 { margin:0 0 6px; font-size:19px; }
  header p { margin:0; color:var(--sub); font-size:12.5px; }
  nav { margin-top:10px; display:flex; gap:8px; flex-wrap:wrap; }
  nav a { padding:5px 12px; border:1px solid var(--line); border-radius:999px; color:var(--sub); text-decoration:none; font-size:12.5px; }
  nav a:hover { border-color:var(--brand); color:var(--brand); }
  section { padding:20px 28px 34px; border-bottom:1px dashed var(--line); }
  h2 { font-size:15px; margin:0 0 10px; }
  h2 span { color:var(--sub); font-weight:400; font-size:12.5px; margin-left:8px; }
  .shot { background:#fff; border:1px solid var(--line); border-radius:12px; overflow:auto; padding:6px; }
  .shot svg { display:block; width:100%; height:auto; }
  footer { padding:18px 28px 40px; color:var(--sub); font-size:12px; line-height:1.9; }
  code { background:#f1f5f9; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<header>
  <h1>AI 子系统 · 架构图与流程图</h1>
  <p>基于代码事实绘制 · 生成脚本 <code>scripts/gen-ai-flow-diagrams.mjs</code> · 改图请改脚本数据后重跑，勿手改 SVG/HTML</p>
  <nav>
    <a href="#arch">AI 子系统架构</a>
    <a href="#flow">Agent 运行主链路</a>
    <a href="#kb">知识链路</a>
    <a href="#read">读法与口径</a>
  </nav>
</header>
${out.map((o) => `
<section id="${o.cfg.id}">
  <h2>${o.cfg.title}<span>${o.cfg.subtitle}</span></h2>
  <div class="shot">${o.svg}</div>
</section>`).join('\n')}
<section id="read">
  <h2>读法与口径<span>怎么读这三张图</span></h2>
  <ul style="font-size:13px; line-height:2; color:#475569; max-width:980px">
    <li><b>AI 子系统架构图</b>：看「职责分层」——谁编排、谁执行循环、能力怎么挂、模型怎么换、数据落在哪。</li>
    <li><b>Agent 运行主链路</b>：看「一次请求怎么走完」——每个 SSE 事件在哪个阶段产出、哪里会失败、失败怎么兜住。图中<b>青色虚线框</b>是子 Agent 委派的递归展开层：子 Agent 走的是同一条链路，只是换一套定义与上下文，且过程事件折叠不上浮。</li>
    <li><b>知识链路</b>：看「知识从哪来、怎么被 Agent 用到、质量怎么量」——当前缺口是<b>召回率未测</b>与<b>golden 集未版本化</b>。</li>
    <li>实线箭头 = 主干流向；虚线箭头 = 异步/可选/回看路径；菱形 = 决策点，右侧框是它的分支说明；绿色虚线框 = 循环体，青色虚线框 = 递归展开层（多 Agent）。</li>
    <li>配套方案文档：<code>docs/architecture/ai-flow-technical-design.md</code>（链路表 + 容错降级 + 待补口径）。</li>
  </ul>
</section>
<footer>生成时间：${new Date().toISOString().slice(0, 10)} · 由 scripts/gen-ai-flow-diagrams.mjs 自动生成（生成物，勿手改）</footer>
</body>
</html>`;
const hp = resolve(OUT_DIR, 'ai-flow-diagrams.html');
writeFileSync(hp, html, 'utf8');
console.log('written:', hp);
