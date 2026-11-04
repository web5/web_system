#!/usr/bin/env node
// 生成 docs/architecture/知识库拓扑.svg —— web_system 开发维护知识库拓扑（AI 防跑偏总图）
// 真源（文字版）：docs/知识库拓扑.md
// 改图纪律：只改本脚本内的数据后重跑，禁止手改 SVG / HTML 生成物。
//   node scripts/gen-kb-topology.mjs           写盘
//   node scripts/gen-kb-topology.mjs --check   自检：现有 SVG 是否与本脚本一致（不写盘）
// 视觉规范：浅色白底（--bg #FFFFFF / --text #1A1A1F / --brand #F97316 / --accent #0EA5A4）

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/architecture/知识库拓扑.svg');
const CHECK = process.argv.includes('--check');

const C = {
  bg: '#FFFFFF', card: '#FFFFFF', text: '#1A1A1F', sub: '#4B5563',
  line: 'rgba(0,0,0,.08)', brand: '#F97316', teal: '#0EA5A4',
  red: '#A32D2D', green: '#3B6D11',
  l0: '#EEEDFE', l0s: '#534AB7', l1: '#E6F1FB', l1s: '#185FA5',
  l2: '#E1F5EE', l2s: '#0F6E56', l3: '#FAEEDA', l3s: '#BA7517',
  l4: '#FCEBEB', l4s: '#A32D2D', gate: '#EAF3DE', gates: '#3B6D11',
  gray: '#F1EFE8', grays: '#888780',
};
const FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const p = [];
const push = (s) => p.push(s);

function rect(x, y, w, h, fill, stroke, rx = 10, sw = 1) {
  push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
}
function txt(x, y, s, size = 12, color = C.text, weight = 400, anchor = 'start') {
  push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`);
}
function card(x, y, w, h, title, lines, accent) {
  rect(x, y, w, h, C.card, C.line, 8, 1);
  rect(x, y + 6, 3, h - 12, accent, accent, 1.5, 0);
  txt(x + 12, y + 19, title, 13, C.text, 500);
  lines.slice(0, Math.max(0, Math.floor((h - 26) / 15))).forEach((l, i) => {
    txt(x + 12, y + 36 + i * 15, l, 11.5, C.sub);
  });
}

const LAYERS = [
  {
    y: 110, h: 118, cols: 4, rows: 1, fill: C.l0, stroke: C.l0s,
    name: 'L0 · 注入域', note: '每次会话自动加载，不靠人跳转；指针只放判据 + 绝对路径',
    cards: [
      { t: '项目级 MEMORY.md', l: ['.workbuddy/memory/MEMORY.md', '≤4KB 索引 · 每次注入 · 判据 + 真源'] },
      { t: '总控域 MEMORY.md', l: ['~/AiWorkspace/.workbuddy/memory/', 'cwd=总控时注入 · R1 另一份指针'] },
      { t: 'CODEBUDDY.md', l: ['.codebuddy/CODEBUDDY.md', 'CodeBuddy 常驻 · 只放规则与入口'] },
      { t: 'SessionStart hooks', l: ['scripts/redline/hook-*.py', '注入 UI 动作门摘要 · Claude 域无此钩'] },
    ],
  },
  {
    y: 240, h: 104, cols: 3, rows: 1, fill: C.l1, stroke: C.l1s,
    name: 'L1 · 入口层', note: '= 工程事实真源，可含数值且只此一份；L0 注入层只放指针',
    cards: [
      { t: 'README.md', l: ['§4.5 env · §5 端口 · §7.1 发布路由', '§9 只留指针，不复制路由表'] },
      { t: '.codebuddy/rules/', l: ['4×RULE.mdc + 最佳实践'] },
      { t: '协作指令速查.md', l: ['红线 · 动作门 · commit trailer'] },
    ],
  },
  {
    y: 356, h: 100, cols: 2, rows: 1, fill: C.l2, stroke: C.l2s,
    name: 'L2 · 总索引', note: '先查这一层，再打开唯一真源；不要一上来全仓 grep',
    cards: [
      { t: 'docs/INDEX.md — 唯一「分」入口', l: ['按问句 → 唯一真源 · 只路由', '统计口径只在此处顶部写一处'] },
      { t: 'docs/知识库拓扑.md — 本图真源', l: ['五层载体 · 门禁 · 禁止路径 · 冲突优先级'] },
    ],
  },
  {
    y: 468, h: 388, cols: 3, rows: 3, fill: C.l3, stroke: C.l3s,
    name: 'L3 · 真源', note: '当前事实与能力的落点；跨仓资产也在这一层，按绝对路径取用',
    cards: [
      { t: '发布能力（仓库外）', l: ['~/skills/web-system-deploy/SKILL.md', 'publish.sh · mcp-deploy.sh · references/', '先判 moduleKey；判不准用 list_modules'] },
      { t: '工程事实', l: ['docs/architecture/system-overview.md', '§3 三环境端口矩阵', '端口/服务/库名以代码与配置为准'] },
      { t: '开发 · 接口 · UI 规范', l: ['docs/development/** · api/contracts.md', 'docs/ui/design-system.md', '判据清单 · 事故复盘 · 排障速查'] },
      { t: '规格（设计态）', l: ['specs/*/design.md（41 份）', '设计定稿 ≠ 已上线，须查落地状态', 'specs/*/tasks.md 正文已归档（原位已删）'] },
      { t: '门禁实现', l: ['scripts/redline/scan-rules.sh（R1–R16）', 'scripts/verify/ · .githooks/', 'S7：能力源 → 运行源单向同步'] },
      { t: 'AI 技能（能力源 / 运行源）', l: ['.codebuddy/agent-kit/（80 文件）', '→ .codebuddy/skills/（61 文件）', 'IDE 加载运行源；禁手改（S7 会拦）'] },
      { t: '脚本与生成物', l: ['scripts/（132 文件）· gen-*.mjs', '→ docs/architecture/*.svg / *-diagrams.html', '改图改脚本重跑，禁手改 SVG/HTML'] },
      { t: '小程序 · 运维 · 产品', l: ['docs/miniprogram/ · docs/operations/', 'docs/products/ · docs/admin/', '出码走固定出口 IP 的 CI 执行机'] },
      { t: '台账与规范（仓库外）', l: ['30-任务产物/_待验证清单.md', '20-私域资产/记忆索引化验收规范.md', '2026-11-04-web_system文档治理/'] },
    ],
  },
  {
    y: 868, h: 138, cols: 3, rows: 1, fill: C.l4, stroke: C.l4s,
    name: 'L4 · 史料（物理隔离）', note: '只解释「当时为什么」，不用于「现在是什么」',
    foot: '事实检索一律 grep -R --exclude-dir=archive　·　R7：入口层不给存档建索引、不列路径',
    cards: [
      { t: 'archive/docs-history/', l: ['80 份史料正文 + README（81 md）', '物理隔离 · 逐字节未改动 · 非当前事实'] },
      { t: '原位桩已删（11-04）', l: ['活跃区零副本 · 备份在治理 backup/', '48 处历史链接失效已列清单'] },
      { t: '记忆深水区（不进 archive）', l: ['2026-*.md（19 份 append-only 日志）', 'topics/ 工程长期记忆全文（26735B）'] },
    ],
  },
];

function layer(L) {
  rect(40, L.y, 960, L.h, L.fill, L.stroke, 14, 1);
  txt(56, L.y + 21, L.name, 14, C.text, 500);
  txt(56 + 130, L.y + 21, L.note, 11.5, C.sub);
  const pad = 16, titleH = 32, gap = 10, footH = L.foot ? 18 : 0;
  const innerW = 960 - 2 * pad;
  const cw = (innerW - gap * (L.cols - 1)) / L.cols;
  const availH = L.h - titleH - pad - footH;
  const ch = (availH - gap * (L.rows - 1)) / L.rows;
  L.cards.forEach((c, i) => {
    const cx = 40 + pad + (i % L.cols) * (cw + gap);
    const cy = L.y + titleH + Math.floor(i / L.cols) * (ch + gap);
    card(cx, cy, cw, ch, c.t, c.l, L.stroke);
  });
  if (L.foot) txt(56, L.y + L.h - 6, L.foot, 12, C.red, 500);
}

function panel(x, y, w, h, title, fill, stroke, lines, lh = 19, color = C.text) {
  rect(x, y, w, h, fill, stroke, 12, 1);
  txt(x + 14, y + 23, title, 13, C.text, 500);
  lines.forEach((l, i) => txt(x + 14, y + 43 + i * lh, l, 11.5, color));
}

function arrow(x1, y, x2, color, dashed = false) {
  push(`<path d="M${x1} ${y} L${x2} ${y}" fill="none" stroke="${color}" stroke-width="1.2" ${dashed ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#arr)"/>`);
}
function varrow(x, y1, y2, color) {
  push(`<path d="M${x} ${y1} L${x} ${y2}" fill="none" stroke="${color}" stroke-width="1.2" marker-end="url(#arr)"/>`);
}

function build() {
  p.length = 0;
  push('<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1170" viewBox="0 0 1400 1170" role="img">');
  push('<title>web_system 开发维护知识库拓扑 · AI 防跑偏总图</title>');
  push('<desc>五层知识载体 L0 注入域到 L4 史料隔离，右侧为门禁、冲突优先级、禁止路径与已知缺口，底部为正确执行路径。</desc>');
  push('<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>');
  rect(0, 0, 1400, 1170, C.bg, C.bg, 0, 0);
  rect(40, 30, 7, 44, C.brand, C.brand, 3, 0);
  txt(60, 50, 'web_system 开发维护知识库拓扑 · AI 防跑偏总图', 22, C.text, 500);
  txt(60, 74, '先判层 → 再找唯一真源 → 过门禁 → 才执行　｜　绿色 = 正确路径　红色 = 已踩过的跑偏路径　灰色 = 未确认缺口', 12, C.sub);
  txt(1360, 50, '盘点 2026-11-04', 11.5, C.sub, 400, 'end');
  txt(1360, 74, '真源 docs/知识库拓扑.md', 11, C.teal, 400, 'end');

  LAYERS.forEach(layer);
  for (let i = 0; i < LAYERS.length - 1; i++) {
    varrow(520, LAYERS[i].y + LAYERS[i].h, LAYERS[i + 1].y, C.teal);
  }

  panel(1020, 110, 340, 238, '门禁带 · 动手前必过', C.gate, C.gates, [
    '记忆索引化 R1–R7',
    'R1 跨注入域各存一份指针  R2 问句反查',
    'R3 入口带路由  R4 废弃正文清零',
    'R5 不复制数值  R6 史料物理隔离+零副本',
    'R7 入口层不给存档建索引',
    '',
    '红线 R1–R16 · scan-rules.sh',
    '动作门：UI D2/D3 · 发布 R14',
    '契约 R13 · 新增接口 R15 · 机检 R16',
    'trailer：Release / Contract / Code',
    'Proto / Design / Micro-exempt',
  ], 17.2, C.text);

  panel(1020, 358, 340, 190, '冲突时以谁为准（高 → 低）', C.l1, C.l1s, [
    '1 运行时事实：代码 / 配置 / DB 实况',
    '2 能力入口：web-system-deploy skill',
    '3 工程事实：README → system-overview',
    '4 专题规范：docs/development · api',
    '5 设计定稿：specs/*/design.md',
    '6 历史快照：archive · 日志（桩已删）',
    '互斥结论必须写显式覆盖声明',
  ], 20, C.text);

  panel(1020, 558, 340, 230, '禁止路径（AI 实际踩过）', C.l4, C.l4s, [
    '× 全仓 grep 不带 --exclude-dir=archive',
    '× 顺 2026-09 旧手册找发布入口',
    '× 自签 JWT 打 POST /api/pipelines',
    '× status=succeeded 当成已生效',
    '× specs/*/design.md 当成已上线',
    '× 把 archive 索引当成真源',
    '',
    '证据门槛：verdict=verified / 探活',
    '进程目录 · 目标 HEAD · 端口占用 pid',
  ], 20, C.red);

  panel(1020, 798, 340, 208, '已知缺口（不猜，已落台账）', C.gray, C.grays, [
    '#8441 release-deploy-console.sh',
    '  被 README / MEMORY 引用但文件不存在',
    '#8443 21 个 SVG 中 13 个生成源未确认',
    '#8444 ui-design-spec.html 无过时声明',
    '~/WorkBuddy/chase 个人 AI 工作空间',
    '≡ ~/AiWorkspace（symlink，勿当两份）',
  ], 22, C.text);

  rect(40, 1020, 1320, 62, C.gate, C.gates, 12, 1);
  const steps = ['① 问句', '② L0 判据', '③ INDEX 路由', '④ 唯一真源', '⑤ 过门禁', '⑥ 执行 + 证据'];
  const sw = 198, sg = 16;
  steps.forEach((s, i) => {
    const x = 56 + i * (sw + sg);
    rect(x, 1032, sw, 38, C.card, C.gates, 8, 0.8);
    txt(x + sw / 2, 1056, s, 12, C.green, 500, 'middle');
    if (i < steps.length - 1) arrow(x + sw + 2, 1051, x + sw + sg - 4, C.gates);
  });
  txt(40, 1104, '绿色实线 = 正确执行路径　·　红虚线 = 已踩过的跑偏路径　·　灰框 = 未确认缺口，不作为事实使用', 12.5, '#374151');
  txt(40, 1128, '改图改脚本重跑：node scripts/gen-kb-topology.mjs　｜　自检：--check　｜　新增 md 必须在 docs/INDEX.md §1 登记一行（R5）', 12.5, '#374151');
  txt(40, 1152, '载体规模与统计口径只写 docs/INDEX.md 顶部一处；archive 80 份史料另存，不进事实检索', 12.5, '#374151');
  push('</svg>');
  return p.join('\n') + '\n';
}

const svg = build();
if (CHECK) {
  if (!existsSync(OUT)) {
    console.error('STALE: 目标 SVG 不存在，请重跑 node scripts/gen-kb-topology.mjs');
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== svg) {
    console.error('STALE: SVG 与生成脚本不一致，请重跑 node scripts/gen-kb-topology.mjs');
    process.exit(1);
  }
  console.log('OK: docs/architecture/知识库拓扑.svg 与生成脚本一致');
} else {
  writeFileSync(OUT, svg, 'utf8');
  console.log('WROTE ' + OUT);
}
