/**
 * 生成「业务架构图 / 技术架构图」两张传统分层 SVG + 一张 HTML 索引页。
 *
 * 用法：node scripts/gen-arch-diagrams.mjs
 * 产出：docs/architecture/kedou-business-architecture.svg
 *       docs/architecture/kedou-technical-architecture.svg
 *       docs/architecture/kedou-architecture-diagrams.html
 *
 * 数据驱动：改图只需改下面的 DATA，不手改 SVG（同「生成物禁手改」纪律）。
 * 事实来源：docs/architecture/system-overview.md、servers/ 与 packages/ 目录、
 *           packages/shared/src/services.ts（端口口径）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'docs/architecture');

const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const W = 1480;
const PAD = 28;
const LANE_X = 150;          // 左侧层名列宽
const CONTENT_X = PAD + LANE_X + 18;
const CONTENT_W = W - CONTENT_X - PAD;
const LANE_W = LANE_X;
const GAP = 12;              // box 间距
const ROW_GAP = 30;          // 层间距（放箭头）
const TITLE_SIZE = 15;
const ITEM_SIZE = 12.5;
const LINE_H = 19;
const SUB_SIZE = 11.5;

const TONES = {
  cyan:  { main: '#0e7490', soft: '#cffafe', line: '#67e8f9' },
  blue:  { main: '#1d4ed8', soft: '#dbeafe', line: '#93c5fd' },
  orange:{ main: '#c2410c', soft: '#ffedd5', line: '#fdba74' },
  purple:{ main: '#6d28d9', soft: '#ede9fe', line: '#c4b5fd' },
  green: { main: '#047857', soft: '#d1fae5', line: '#6ee7b7' },
  slate: { main: '#334155', soft: '#e2e8f0', line: '#cbd5e1' },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 估算字符宽度：CJK ≈ fontSize，ASCII ≈ 0.62 fontSize（实测含字距，偏保守防溢出） */
const charW = (ch, size) => {
  if (/[\u4e00-\u9fa5\u3000-\u303f（）：；、「」]/.test(ch)) return size;
  if (ch === ' ') return size * 0.32;
  return size * 0.62;
};
function wrap(text, size, maxW) {
  const widthOf = (s) => [...s].reduce((a, ch) => a + charW(ch, size), 0);
  const lines = [];
  let cur = '', curW = 0;
  const flush = () => { if (cur) lines.push(cur.replace(/\s+$/, '')); cur = ''; curW = 0; };
  for (const tk of String(text).split(/(\s+)/).filter((t) => t.length)) {
    const w = widthOf(tk);
    if (curW + w <= maxW) { cur += tk; curW += w; continue; }
    if (w > maxW) {
      // 单个超长 token（无空格的中文长句 / 长标识符）→ 逐字符硬断
      flush();
      let seg = '', segW = 0;
      for (const ch of tk) {
        const cw = charW(ch, size);
        if (segW + cw > maxW && seg) { lines.push(seg); seg = ''; segW = 0; }
        seg += ch; segW += cw;
      }
      cur = seg; curW = segW;
    } else {
      flush();
      cur = tk.replace(/^\s+/, '');
      curW = widthOf(cur);
    }
  }
  flush();
  return lines.length ? lines : [''];
}

/* ---------------- 图数据（事实来自代码与 system-overview.md） ---------------- */

const BUSINESS = {
  id: 'business',
  title: '科豆 AI · 业务架构图',
  subtitle: '从「谁在用 / 用来做什么」到「需要具备什么能力」——四层自上而下：渠道与用户 → 业务场景 → 业务能力 → 平台支撑',
  footnote: '事实口径：docs/architecture/system-overview.md（2026-10-08 现状）+ apps/ 与 servers/ 目录实证。虚线=支撑关系，实线=场景依赖能力。',
  layers: [
    {
      name: '渠道与用户', tone: 'cyan', note: '谁在用',
      groups: [{ boxes: [
        { title: '用户门户 portal', items: ['注册登录 · AI 对话 · 个人中心', 'API Key 申请与查看'] },
        { title: '管理后台 admin', items: ['Agent 定义 / 能力资产 / 版本', '知识集合 · 系统设置 · 字典'] },
        { title: '微信小程序 科豆AI', items: ['扫码登录 · 移动对话 · 作品'] },
        { title: '开放接入方', items: ['MCP API Key 订阅方', '第三方 Agent / 工作流'] },
        { title: '内容触达', items: ['公众号 大橙子社区', '企业微信每日推送'] },
      ] }],
    },
    {
      name: '业务场景', tone: 'orange', note: '做什么',
      groups: [{ boxes: [
        { title: 'AI 助手对话', items: ['多轮会话 · 上下文记忆', '生图 · TTS · 作品留存'] },
        { title: '智能体 Agent', items: ['定义 → 装配 → 运行 → 追踪', 'ReAct 多步：想 → 调工具 → 观察'] },
        { title: '内容中枢', items: ['财经 / 论文采集', 'LLM 加工 → 公众号发布'] },
        { title: '视觉创作 变变', items: ['图像转换流水线', '作品与素材管理'] },
        { title: 'MCP 开放平台', items: ['HTTP API → MCP 工具声明式转换', '多 MCP 聚合与订阅商业化'] },
        { title: '发布运维', items: ['流水线 · 审批 · 灰度', '版本指针 · 一键回滚'] },
      ] }],
    },
    {
      name: '业务能力', tone: 'purple', note: '靠什么能力',
      groups: [{ boxes: [
        { title: 'Agent 定义与版本', items: ['草稿/发布双态 + 版本快照', '模型与参数随定义走，可回滚'] },
        { title: '能力资产挂载', items: ['本地工具 · MCP 工具', '技能 · 知识集合（四类统一挂载）'] },
        { title: '运行时编排与追踪', items: ['循环执行 · 工具/文本两类步', '逐步轨迹 +成本归因'] },
        { title: '知识资产与评测', items: ['集合 / 文档 / 向量检索', 'Ragas 三指标离线评测'] },
        { title: '账号 · 权限 · 配额', items: ['JWT · 权限码 · 内部调用 Key', '按用户/按 Key 的配额'] },
        { title: '成本归因与定价基础', items: ['运行记录留痕（费用）', '字典化单价 → 毛利可算'] },
      ] }],
    },
    {
      name: '平台支撑', tone: 'slate', note: '底层保证', link: 'support',
      groups: [{ boxes: [
        { title: '统一认证', items: ['账密 / JWT / 微信 OAuth / 小程序'] },
        { title: '字典与系统配置', items: ['数据字典 · 开关 · 存储策略'] },
        { title: '审计与操作日志', items: ['操作留痕 · 可追溯'] },
        { title: '灰度与回滚', items: ['指针表 → 改一行即回滚'] },
        { title: '多环境治理', items: ['local / dev / prod 同 Schema'] },
        { title: '交付通道', items: ['Actions → 流水线 → 同步重启校验'] },
      ] }],
    },
  ],
  notes: [
    '能力资产是四条腿：本地工具（代码注册）、MCP 工具（远程）、技能（技能库）、知识集合（RAG）——在 admin「能力资产」页按 Agent 聚合只读展示。',
    'Agent 定义 draft/published 双态 + 版本快照 = 真正的「可回滚」，发布态改动不影响运行中的 Agent。',
  ],
};

const TECHNICAL = {
  id: 'technical',
  title: '科豆 AI · 技术架构图',
  subtitle: '六层：接入 → 前端/终端 → 应用服务（AI 域 / 平台域 / 运维域）→ 共享包 → 数据存储 → 外部依赖与交付通道',
  footnote: '端口取自 packages/shared/src/services.ts（单一真相源；本机 auth 为 6101，dev/prod 为 6001）。实线=请求调用，虚线=数据与异步通道。',
  layers: [
    {
      name: '接入层', tone: 'cyan', note: '流量入口',
      groups: [{ boxes: [
        { title: 'nginx（GATEWAY 机）', items: ['SSL 终止 → 反代 :6000 / :6006', '静态资源与 CDN 前缀'] },
        { title: 'gateway :6000', items: ['统一入口：SPA 回退 · /api 反代', '静态托管 · 灰度命中 · manifest'] },
      ] }],
    },
    {
      name: '前端与终端', tone: 'blue', note: '界面层',
      groups: [{ boxes: [
        { title: 'shell 基座', items: ['自研 loader + window.__SHARED__', '整页 HTML · site-version 部署'] },
        { title: 'portal / admin', items: ['SystemJS 子应用 MF_FORMAT=system', 'CSS 隔离 [data-module] 优先级归零'] },
        { title: 'deploy-console :6200', items: ['独立 SPA（非微前端）', '流水线 · 环境 · 版本 · 审批'] },
        { title: '小程序 kedou-ai-minigram', items: ['微信原生 + TS'] },
      ] }],
    },
    {
      name: '应用服务', tone: 'orange', note: '业务编排',
      groups: [
        { title: 'AI 域', boxes: [
          { title: 'ai-service :6003', items: ['对话 · 生图 · TTS · 变变', 'Agent 定义与运行日志'] },
          { title: 'ai-agent :6010', items: ['Agent 运行时（ReAct）', '工具/技能/MCP 装配 · OCR'] },
          { title: 'knowledge-service :6011', items: ['集合/文档/向量/检索', 'RAG 离线评测'] },
          { title: 'mcp-gateway :6006', items: ['streamable-http', 'HTTP API → MCP 声明式'] },
          { title: 'content-hub :6007', items: ['采集 · LLM 加工 · 发布'] },
        ] },
        { title: '平台域', boxes: [
          { title: 'auth-service :6001', items: ['JWT · 微信 OAuth · 二维码', '服务商联系方式'] },
          { title: 'user-service :6002', items: ['用户 · API Key · 权限 · 记忆'] },
          { title: 'system-service :6004', items: ['字典 · 设置 · 操作日志'] },
          { title: 'upload / todo :6008 / :6005', items: ['统一上传 · 待办'] },
        ] },
        { title: '运维域', boxes: [
          { title: 'deploy-console :6200', items: ['流水线三层：步骤/任务/动作', '配置版本化 · 恢复 · 一致性巡检'] },
        ] },
      ],
    },
    {
      name: '共享层', tone: 'purple', note: '复用资产',
      groups: [
        { title: 'Agent 运行时底座', boxes: [
          { title: 'agent-core', items: ['ReAct 引擎 · ToolRegistry', 'ClientRegistry（模型三级回落）', 'Memory · Skills · Plugins'] },
          { title: 'mcp-core', items: ['MCP 模块注册', '声明式 HTTP → MCP 转换'] },
          { title: 'agent-message', items: ['消息 blocks 解析', 'portal / admin / 小程序三端复用'] },
        ] },
        { title: '前端与通用', boxes: [
          { title: 'ui / types', items: ['设计 token + AntD 主题'] },
          { title: 'shared', items: ['服务 URL 单一真相源', 'SnakeNaming · 缺地址 fail-fast'] },
          { title: 'shell-loader', items: ['微前端加载器 + 版本检查'] },
        ] },
      ],
    },
    {
      name: '数据存储', tone: 'green', note: '状态沉淀', link: 'support',
      groups: [{ boxes: [
        { title: 'MySQL · web_system', items: ['业务主库：用户/权限/Agent 定义'] },
        { title: 'MySQL · web_system_knowledge', items: ['RAG：集合/文档/向量'] },
        { title: 'MySQL · web_system_deploy', items: ['流水线/版本指针/配置'] },
        { title: 'Redis', items: ['二维码票据 · Token 黑名单'] },
        { title: '静态产物', items: ['env-dir / site-version', 'prod 外置静态根'] },
      ] }],
    },
    {
      name: '外部依赖 / 交付', tone: 'slate', note: '外部与上线', link: 'external',
      groups: [{ boxes: [
        { title: 'LLM 供应商', items: ['TokenHub：hy3 / deepseek 等（字典驱动）', '意图识别独立小模型'] },
        { title: '第三方能力', items: ['腾讯 TTS · 生图 · OCR'] },
        { title: '外部数据源', items: ['财经/论文/公众号接口'] },
        { title: 'CI/CD', items: ['GitHub Actions + self-hosted runner', 'HMAC release hook → 流水线'] },
      ] }],
    },
  ],
  notes: [
    '知识链路：Agent 运行时 → MCP 工具 knowledge_* → mcp-gateway → knowledge-service /knowledge/mcp/*（InternalKey 鉴权）。',
    '服务互联地址全部走 packages/shared（缺关键地址 fail-fast，不在各服务里复制写）。',
    '上线链路：push master → Actions → HMAC 签名投递 release hook → 流水线 pipeline → 拉代码→构建→同步→重启→校验。',
  ],
};

/* ---------------- 排版与渲染 ---------------- */

function layoutBox(box, width) {
  const inner = width - 26;
  const titleLines = wrap(box.title, TITLE_SIZE, inner);
  const itemLines = [];
  for (const it of box.items || []) itemLines.push(...wrap(it, ITEM_SIZE, inner - 2));
  const headH = Math.max(34, 14 + titleLines.length * 21 + 4);
  const h = headH + (itemLines.length ? 6 : 0) + itemLines.length * LINE_H + 13;
  return { titleLines, itemLines, headH, h: Math.max(h, 62) };
}

function renderDiagram(cfg) {
  const P = [];
  let y = PAD + 62;
  const bounds = [];

  // 每条层：左侧 Lane 列 + 右侧内容
  const prepared = cfg.layers.map((layer) => {
    const groups = layer.groups.map((g) => {
      const n = g.boxes.length;
      const totalGroupW = CONTENT_W;
      const bw = (totalGroupW - GAP * (n - 1)) / n;
      const boxes = g.boxes.map((b) => ({ box: b, ...layoutBox(b, bw), w: bw }));
      const h = Math.max(...boxes.map((b) => b.h));
      return { ...g, boxes, bw, h };
    });
    const hasGroupTitle = layer.groups.some((g) => g.title);
    const groupsH = groups.reduce((a, g) => a + g.h, 0) + (groups.length - 1) * 14 + (hasGroupTitle ? layersGroupPad(layer) : 0);
    return { layer, groups, h: groupsH, hasGroupTitle };
  });
  function layersGroupPad(layer) { return layer.groups.filter((g) => g.title).length * 20; }

  for (const row of prepared) {
    const { layer, groups, h } = row;
    const tone = TONES[layer.tone];
    bounds.push({ y, h, tone });

    // 左侧层名列
    P.push(`<rect x="${PAD}" y="${y}" width="${LANE_W}" height="${h}" rx="10" fill="${tone.soft}" stroke="${tone.line}"/>`);
    P.push(`<rect x="${PAD}" y="${y}" width="5" height="${h}" rx="3" fill="${tone.main}"/>`);
    P.push(`<text x="${PAD + 18}" y="${y + h / 2 - 4}" font-family="${FONT}" font-size="16" font-weight="700" fill="${tone.main}">${esc(layer.name)}</text>`);
    P.push(`<text x="${PAD + 18}" y="${y + h / 2 + 16}" font-family="${FONT}" font-size="11.5" fill="#64748b">${esc(layer.note || '')}</text>`);

    // 右侧内容（分组）
    let gy = y + 6;
    for (const g of groups) {
      if (g.title) {
        P.push(`<text x="${CONTENT_X + 2}" y="${gy + 12}" font-family="${FONT}" font-size="12" font-weight="700" fill="#475569">${esc(g.title)}</text>`);
        gy += 20;
      }
      let gx = CONTENT_X;
      for (const b of g.boxes) {
        const headH = b.headH;
        P.push(`<rect x="${gx}" y="${gy}" width="${b.w}" height="${g.h}" rx="9" fill="#ffffff" stroke="${tone.line}" stroke-width="1.2"/>`);
        P.push(`<rect x="${gx}" y="${gy}" width="${b.w}" height="${headH}" rx="9" fill="${tone.soft}"/>`);
        P.push(`<rect x="${gx}" y="${gy + headH - 6}" width="${b.w}" height="6" fill="${tone.soft}"/>`);
        const titleStart = gy + 14 + TITLE_SIZE - 3;
        let ty = titleStart;
        for (const l of b.titleLines) {
          P.push(`<text x="${gx + 12}" y="${ty}" font-family="${FONT}" font-size="${TITLE_SIZE}" font-weight="700" fill="${tone.main}">${esc(l)}</text>`);
          ty += 21;
        }
        let iy = gy + headH + LINE_H - 4;
        for (const l of b.itemLines) {
          P.push(`<text x="${gx + 12}" y="${iy}" font-family="${FONT}" font-size="${ITEM_SIZE}" fill="#475569">${esc(l)}</text>`);
          iy += LINE_H;
        }
        gx += b.w + GAP;
      }
      gy += g.h + 14;
    }

    y += h + ROW_GAP;
    // 层间箭头（居中于内容区）
    P.push(arrow(CONTENT_X + CONTENT_W / 2, y - ROW_GAP + 6, CONTENT_X + CONTENT_W / 2, y - 7, layer.link === 'support' ? 'dashed' : 'solid'));
  }

  const totalH = y + 6;
  const footY = totalH + 6;
  const notesH = cfg.notes.length * 22 + 34;
  const H = totalH + notesH + 30;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">`;
  svg += `<defs>
    <marker id="ah-${cfg.id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 z" fill="#64748b"/>
    </marker>
    <marker id="ahd-${cfg.id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <path d="M0,0 L10,4 L0,8 z" fill="#94a3b8"/>
    </marker>
  </defs>`;
  svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fffdf9"/>`;
  // 标题区
  svg += `<text x="${PAD}" y="${PAD + 6}" font-family="${FONT}" font-size="22" font-weight="800" fill="#0f172a">${esc(cfg.title)}</text>`;
  svg += `<text x="${PAD}" y="${PAD + 30}" font-family="${FONT}" font-size="12.5" fill="#64748b">${esc(cfg.subtitle)}</text>`;
  svg += P.join('\n');
  // 说明
  let ny = footY + 4;
  svg += `<line x1="${PAD}" y1="${footY - 8}" x2="${W - PAD}" y2="${footY - 8}" stroke="#e2e8f0"/>`;
  for (const n of cfg.notes) {
    svg += `<text x="${PAD}" y="${ny + 12}" font-family="${FONT}" font-size="${SUB_SIZE}" fill="#475569">· ${esc(n)}</text>`;
    ny += 22;
  }
  svg += `<text x="${PAD}" y="${ny + 24}" font-family="${FONT}" font-size="11" fill="#94a3b8">${esc(cfg.footnote)}</text>`;
  svg += `</svg>`;
  return svg;
}

function arrow(x1, y1, x2, y2, kind) {
  const id = kind === 'dashed' ? 'ahd' : 'ah';
  const dash = kind === 'dashed' ? ' stroke-dasharray="6 5"' : '';
  const color = kind === 'dashed' ? '#94a3b8' : '#64748b';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"${dash} marker-end="url(#${id})"/>`;
}

mkdirSync(OUT_DIR, { recursive: true });
const svgs = {};
for (const cfg of [BUSINESS, TECHNICAL]) {
  const svg = renderDiagram(cfg);
  const p = resolve(OUT_DIR, `kedou-${cfg.id}-architecture.svg`);
  writeFileSync(p, svg, 'utf8');
  svgs[cfg.id] = svg;
  console.log('written:', p, `${(svg.length / 1024).toFixed(1)}KB`);
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>科豆 AI · 业务架构图 / 技术架构图</title>
<style>
  :root { --bg:#fffdf9; --ink:#0f172a; --sub:#64748b; --brand:#c2410c; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif; }
  header { padding:22px 28px 12px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); }
  h1 { margin:0 0 6px; font-size:19px; }
  header p { margin:0; color:var(--sub); font-size:12.5px; }
  nav { margin-top:10px; display:flex; gap:8px; }
  nav a { padding:5px 12px; border:1px solid var(--line); border-radius:999px; color:var(--sub); text-decoration:none; font-size:12.5px; }
  nav a:hover { border-color:var(--brand); color:var(--brand); }
  section { padding:20px 28px 34px; border-bottom:1px dashed var(--line); }
  h2 { font-size:15px; margin:0 0 10px; }
  h2 span { color:var(--sub); font-weight:400; font-size:12.5px; margin-left:8px; }
  .shot { background:#fff; border:1px solid var(--line); border-radius:12px; overflow:auto; padding:6px; }
  .shot svg { display:block; width:100%; height:auto; }
  img { display:block; width:100%; height:auto; }
  footer { padding:18px 28px 40px; color:var(--sub); font-size:12px; line-height:1.8; }
</style>
</head>
<body>
<header>
  <h1>科豆 AI · 架构图（业务架构 / 技术架构）</h1>
  <p>基于代码事实绘制 · 生成脚本 <code>scripts/gen-arch-diagrams.mjs</code> · 改图请改脚本数据后重跑，勿手改 SVG/HTML</p>
  <nav>
    <a href="#business">业务架构图</a>
    <a href="#technical">技术架构图</a>
    <a href="#legend">读法</a>
  </nav>
</header>

<section id="business">
  <h2>业务架构图<span>渠道 → 场景 → 能力 → 支撑</span></h2>
  <div class="shot">${svgs.business}</div>
</section>

<section id="technical">
  <h2>技术架构图<span>接入 → 前端/终端 → 应用服务 → 共享层 → 数据存储 → 外部依赖</span></h2>
  <div class="shot">${svgs.technical}</div>
</section>

<section id="legend">
  <h2>读法与口径<span>怎么读这两张图</span></h2>
  <ul style="font-size:13px; line-height:2; color:#475569; max-width:960px">
    <li><b>业务架构图</b>回答「谁在用、用来做什么、靠什么能力、底层靠什么兜住」——不含技术选型，用于对齐业务范围与能力缺口。</li>
    <li><b>技术架构图</b>回答「请求从哪进来、落到哪个服务、共享什么、数据存哪、外部依赖和上线链路是什么」——含端口与服务名，可当排障地图。</li>
    <li>实线箭头 = 调用/依赖方向；虚线箭头 = 支撑与数据/异步通道。</li>
    <li>端口口径：<code>packages/shared/src/services.ts</code> 为唯一真相源；本机 auth 用 6101（6001 被他项目占用），dev/prod 用 6001。</li>
    <li>事实来源：<code>docs/architecture/system-overview.md</code>、<code>servers/</code> 与 <code>packages/</code> 目录实证。</li>
  </ul>
</section>

<footer>
  生成时间：${new Date().toISOString().slice(0, 10)} · 由 scripts/gen-arch-diagrams.mjs 自动生成（生成物，勿手改）
</footer>
</body>
</html>`;
const hp = resolve(OUT_DIR, 'kedou-architecture-diagrams.html');
writeFileSync(hp, html, 'utf8');
console.log('written:', hp);
