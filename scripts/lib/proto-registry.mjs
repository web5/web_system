/**
 * admin 原型**整合注册表**（单一真相源）
 *
 *   scripts/lib/proto-registry.mjs
 *
 * ── 这个文件解决什么问题 ────────────────────────────────────────────────
 * 此前「整合」是**手工动作**：菜单里出现的屏写在 build-agents-hub.mjs 的 SCREEN_META
 * 里（占位的可以手写、真实的要从别的稿 copy DOM/CSS）。后果：
 *   · 某个模块出了一稿（如 admin-settings.html），整合稿里还是占位 → 两份真相，迭代只能二选一；
 *   · 每补一份原型就要改一次 build 脚本、重排一处菜单、再对一遍——「整合」变成重复劳动，
 *     且漏一次就要等产品（用户）用截图指出来。
 *
 * 现在：**每一屏一行**。写了 `source` 的屏由构建脚本从原型稿**同源抽取**真实内容；
 * 没写 `source` 的屏走占位渲染，占位内容（批次 / 骨架 / 复用件）也从这里读。
 *   → 新增/迭代一份原型 = 放开再写一行 `source`，重跑 build 即可，"整合"这门手艺被取消。
 *
 * ── 字段口径 ────────────────────────────────────────────────────────────
 *   screen  : 屏 key，必须与 scripts/lib/proto-shell.mjs 的 SHELL_NAV.screen 一致
 *             （壳与菜单归 proto-shell 管，这里只管"这一屏装什么内容"）
 *   batch   : 占位屏归属批次，与 specs/admin-prototype-coverage/tasks.md 对账（verify ⑩d 段）
 *   t/d/note/skel/reuse/kpi/tbl/cards : 占位屏渲染素材（note 里不许伪造业务数据）
 *   source  : 有原型稿时的抽取声明（见下 loadSource）
 *
 * source 字段：
 *   file      docs/ui/prototypes 下的原型稿文件名
 *   from/to   抽取区间（to 用 between 的"不含"，toIncl 用"含"）
 *   wrapper   需要剥掉的最外层开标签（通常就是 from）
 *   cssKeep   CSS 选择器白名单（函数）；不写则全取
 *   cssDrop   CSS 选择器黑名单片段；命中即丢弃（剥掉源稿自己的壳）
 *   scope     CSS 作用域：给每条规则加 `scope ` 前缀。**第三方/历史稿的类名往往是
 *             裸通用名（.btn/.card/.table/.modal），不合作用域就会污染其它屏**——
 *             这是 2026-10-11「样式完全是乱的」同型事故，别省这一步
 *   idPrefix  抽取片段内 id 加前缀（避免与其它屏 id 撞车，最常见是 toast）
 *             script 侧自动注入 getElementById 映射 shim，**只映射本源自己的 id**
 *   ns        源稿 DOM 用 inline handler（onclick="foo("）时必须给：把顶层函数挂到
 *             window[ns] 并把 DOM/script 里 `"foo(` 改写成 `"ns.foo(`，避免全局符号冲突
 *   trail     尾随片段：源稿里弹层（drawer / mask / toast）常挂在内容区**之外**，
 *             wrapper 剥完就被丢掉，导致「点新增记录 → 找不到抽屉」报错。
 *             声明 { from, to } 追加进来（同样参与 id 前缀与 inline handler 改写）
 *             配 shared 时这段**不进任何一屏**，由 build 单独放到整合稿的 .ad-desktop 末尾
 *             （弹层是模块级共享的，塞进某一屏会导致别的屏打不开它）
 *   rootToGlobal  true：源稿的 `:root` 变量**并入整合稿全局**（只补整合稿缺的 token，
 *             同名以整合稿为准）。用于「源稿补了设计系统级新 token」的场景（如金融涨跌档
 *             --ws-fin-up/down）—— 不并就是「声明在 :root 里、实际只在该屏生效」的假象。
 *   shared    **一份稿服务多屏**（内容中心这类「一组二级页 + JS 渲染」的模块）：
 *             { hostSel, screens }。
 *             抽取区间的 DOM 里按 hostSel 找到 N 个容器（每个带 data-cc="<屏 key>"），
 *             build 把它们**分别**装进各自的屏（不是复制 5 份），CSS/JS 全局只注入一次 ——
 *             否则同一份脚本注入 5 次 = 5 份状态机互相打架。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  between, stripWrapper, stripCssComments, cssBlocks, selOf, scopeCssBlocks, takeTopLevelElements,
} from './html-utils.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const PROTO_DIR = path.join(ROOT, 'docs/ui/prototypes');

/* ── 占位屏的说明文案构造器（不许伪造业务数据） ───────────────────────── */
const P4NOTE = (html) => ({ html: '本屏属 Agents 的 P4 后续批次，本稿只定「壳与复用口径」：' + html });
const OUTNOTE = (batch, html) => ({
  html: `本屏属 admin 原型补齐 <b>${batch}</b> 批次，内容由该批次单独出稿`
    + `（见 <code>specs/admin-prototype-coverage/tasks.md</code>）。${html}`,
});
const SRCNOTE = (file, extra) => ({
  html: `本屏内容由 <code>docs/ui/prototypes/${file}</code> <b>同源抽取</b>（不是复刻）：`
    + `改这份模块请改那份稿，然后重跑 <code>node scripts/build-agents-hub.mjs</code>。${extra || ''}`,
});

/* ── 两个已出稿模块的抽取声明 ─────────────────────────────────────────── */
const SRC_SETTINGS = {
  file: 'admin-settings.html',
  from: '<div class="ad-content">',
  to: '<div class="st-toast" id="stToast"></div>',
  toIncl: true,
  wrapper: '<div class="ad-content">',
  /* 类名都是 .st- 前缀（低冲突）；@ 规则本稿没有 @media/@keyframes，白名单留作护栏 */
  cssKeep: (s) => s.includes('.st-') || s.startsWith('@'),
  /* ⚠️ 静态 DOM 里确实没有 inline handler，但**内容是 JS 渲染的**，渲染出的 HTML 字符串里
     写着 onclick="asTab('basic')" 这类 —— 只 IIFE 不导出，点 tab 就会报 asTab is not defined。
     所以照样要 ns 导出 + 改写（改写对 JS 字符串同样生效）。 */
  iife: true,
  ns: 'AS',
  exports: ['asTab', 'asState', 'asCmp', 'asSave', 'asSwitch', 'asRadius', 'asTestMail', 'toast'],
  trace: ['id="stBody"', 'id="stToast"', 'class="st-head"'],
};

const SRC_DICTS = {
  file: 'dict-module.html',
  from: '<div class="content">',
  to: '<script>',
  wrapper: '<div class="content">',
  /* ⚠️ dict-module.html 的类名是裸通用名（.btn/.card/.table/.drawer/.modal/.content…），
     直接合入会污染整合稿其它屏 —— 必须作用域隔离 */
  scope: '.screen[data-screen="dicts"]',
  /* 注意 :root **不能** drop —— 那是源稿的私有变量（--primary/--text/--card/--border…），
     丢了按钮与文本会集体回退成默认色。scopeCssBlocks 会把它改写成作用域选择器。 */
  cssDrop: ['body', 'html', '.desktop', '.sidebar', '.side-group', '.side-item',
    '.logo', '.topbar', '.page-foot'],
  idPrefix: 'dm-',
  ns: 'DM',
  exports: ['toast', 'showView', 'openEdit', 'openItemDrawer', 'closeDrawer', 'closeM',
    'openDeleteType', 'saveType', 'saveItem', 'delField', 'addField', 'moveField',
    'pick', 'reload', 'showError', 'toggleRow', 'toggleSw', 'goPage', 'renderTypeList',
    'renderItems', 'onItemSearch', 'syncCrumb'],
  trail: { from: '<div class="drawer-mask" id="dMask"', to: '<script>' },
  trace: ['id="dm-typeList"', 'id="dm-itemBody"', 'id="dm-dItem"', 'id="dm-toast"'],
};

/**
 * 内容中心（content:view / content:manage）：**一份稿 5 屏**的共享源。
 * 为什么不是「一屏一行」：这 5 屏是同一组二级页，DOM 由 JS 按当前屏渲染（状态机 / 筛选 /
 * 抽屉 / 弹窗都是模块级共享的），拆成 5 份就变成 5 个互不相通的状态机。
 * → 用 shared：DOM 按 data-cc 拆给各屏，CSS 作用域隔离，JS 只注入一次（IIFE + ns=CC）。
 */
const SRC_CONTENT = {
  file: 'admin-content-hub.html',
  from: '<div class="ad-content">',
  to: '<div class="mask"',
  wrapper: '<div class="ad-content">',
  /* 类名是裸通用名（.card/.btn/.tbl/.badge/.drawer/.modal…），不隔离会污染其它屏 */
  scope: '.cc-scope',
  cssDrop: ['body', 'html'],
  rootToGlobal: true,
  idPrefix: 'cc-',
  ns: 'CC',
  exports: ['go', 'setState', 'apply', 'toast', 'closeAll', 'modalOk', 'openDetail', 'confirmRerun',
    'confirmCollect', 'openSeats', 'openSeatForm', 'confirmDisable'],
  trail: { from: '<div class="mask"', to: '<script>' },
  shared: {
    hostSel: '.cc-host',
    screens: ['content-overview', 'content-items', 'content-detail', 'content-lhb', 'content-seats'],
  },
  trace: ['data-cc="content-overview"', 'data-cc="content-seats"', 'id="cc-drawer"', 'id="cc-toast"'],
};

/* ── 注册表本体：22 屏，与 BasicLayout.vue 菜单逐项对应 ───────────────── */
export const REGISTRY = [
  /* —— 非 Agents 模块 —— */
  {
    screen: 'dashboard', batch: 'P5', t: '工作台', d: '后台首页：关键指标与常用入口。',
    note: OUTNOTE('P5', '本模块视觉为主、交互少。'),
    skel: 'KPI 卡行 + 近 7 日趋势图（Echarts）+ 快捷入口卡组。',
    reuse: ['KPI 卡（admin 既有）', 'Echarts 图表（admin 既有）', '.tbl 列表'],
  },
  {
    screen: 'bianbian', batch: 'P3', t: '变变管理', d: '「变变」图像转换业务的数据与任务管理。',
    note: OUTNOTE('P3', '含用户上传素材与生成结果，涉隐私内容，需明确留存与删除口径。'),
    skel: '任务列表（.tbl）+ 筛选条 + 任务详情（结果图预览与失败原因）。',
    reuse: ['.tbl 列表', '.st 状态标签', '筛选条（admin 既有）'],
  },
  {
    screen: 'users', batch: 'P1', t: '用户管理', d: '用户列表与详情：账号状态、角色、登录方式与权益。',
    note: OUTNOTE('P1', '列表 + 详情两页，权限相关字段多，最易产生交互分歧。'),
    skel: '列表（.tbl：用户 / 角色 / 状态 / 最近登录）+ 筛选 + 详情页（基本信息 / 角色 / 权益）。',
    reuse: ['.tbl 列表', '.st 状态标签', '详情字段栅格 .frow'],
  },
  {
    screen: 'settings', source: SRC_SETTINGS,
    note: SRCNOTE('admin-settings.html（已定稿：4 tab 版，含外观/操作日志）',
      '演示控件（状态演示 / 变更对照）属于该稿自身的原型演示区，不带进生产口径。'),
  },
  {
    screen: 'roles', batch: 'P2', t: '角色权限', d: '角色定义与权限码勾选；误操作代价高，保存前需影响面提示。',
    note: OUTNOTE('P2', '误操作代价高（删角色 / 改权限）。'),
    skel: '角色列表（.tbl）+ 权限树勾选（按模块分组）+ 保存前影响面提示 + 危险操作二次确认。',
    reuse: ['.tbl 列表', '权限树（admin 既有）', '危险操作二次确认'],
  },
  {
    screen: 'dicts', source: SRC_DICTS,
    note: SRCNOTE('dict-module.html（旧专题稿，v5）',
      '机械迁移：<b>CSS 已做作用域隔离</b>（原稿类名是裸通用名，不隔离会污染其它屏），'
      + 'id 统一加 <code>dm-</code> 前缀。P2 批次正式重出稿后本条改为指向新稿。'),
  },
  {
    screen: 'mcp', batch: 'P4', t: 'MCP 管理', d: 'MCP 服务与工具清单、连接状态与调用统计。',
    note: OUTNOTE('P4', '与 Agents 同批（P4），含密钥类字段，须脱敏呈现。'),
    skel: '服务列表 + 工具清单展开（工具名 / 入参契约 / 开关）+ 调用统计；密钥类字段脱敏。',
    reuse: ['.tbl 列表', '.st 状态标签', '脱敏字段呈现'],
  },
  {
    screen: 'database', batch: 'P3', t: '数据浏览', d: '只读表数据浏览，敏感字段脱敏。',
    note: OUTNOTE('P3', '涉敏感数据：全程只读、脱敏列显式标注。'),
    skel: '左侧表清单 + 右侧只读表格（分页 / 条件查询）；脱敏列显式标注。',
    reuse: ['.tbl 列表', '分页条（admin 既有）', '脱敏列标注'],
  },

  /* —— 内容中心子菜单（共享源：一份稿 5 屏，CSS 作用域隔离 + JS 只注入一次） —— */
  ...SRC_CONTENT.shared.screens.map((s) => ({
    screen: s, source: SRC_CONTENT,
    note: SRCNOTE('admin-content-hub.html（内容中心模块稿 · 5 屏共享一份 JS 状态机）',
      '字段与接口对照 M1 落码：<code>collect_runs</code> / <code>content_items.quality_*</code> / '
      + '<code>lhb_records</code> / <code>hotmoney_seats</code>，不是编的。'),
  })),

  /* —— Agents 子菜单（P4 批次，带示意数据） —— */
  {
    screen: 'overview', t: 'Agent 概览', d: 'Agents 模块总览：定义、运行、成功率与技能一览。',
    note: { brand: true, ...P4NOTE('数字卡位与图表复用 admin 既有组件，不新造。') },
    kpi: [['4', '定义总数'], ['1,286', '今日运行'], ['98.2%', '成功率'], ['3', '启用技能']],
    skel: 'KPI 卡行 + 近 7 日运行趋势图（Echarts，admin 既有图表组件）+ 各定义运行 Top 列表（.tbl 骨架）。',
    reuse: ['.tbl 列表', 'KPI 卡（admin 既有）', 'Echarts 图表（admin 既有）'],
  },
  {
    screen: 'observe', t: 'Agent 观测', d: 'Agent 运行指标：运行量、成功率、耗时与成本。',
    note: P4NOTE('卡片位与趋势图复用 admin 既有 KPI 卡 / Echarts，不新造；下钻到明细即「运行记录」屏。'),
    kpi: [['1,286', '今日运行'], ['98.2%', '成功率'], ['2.4s', 'P95 耗时'], ['¥3.7', '今日成本']],
    skel: 'KPI 卡行 + 近 7 日运行量 / 耗时趋势（Echarts）+ 按定义汇总表（.tbl）。',
    reuse: ['.tbl 列表', 'KPI 卡（admin 既有）', 'Echarts 图表（admin 既有）'],
  },
  {
    screen: 'records', t: '运行记录', d: 'Run 级追踪：耗时、步数、状态；展开详情的消息渲染复用调试台同一套组件。',
    note: P4NOTE('列表骨架先按 .tbl 定稿；Run 详情展开后的消息渲染复用下方「定义详情 · 调试台」同一套消息组件。'),
    tbl: {
      head: ['Run / 定义', '模型', '耗时 / 步数', '状态'],
      rows: [
        ['<div class="nm">r-10241</div><div class="id">report-helper</div>', 'deepseek-v4-flash', '2.4s · 3 步', '<span class="st pass">成功</span>'],
        ['<div class="nm">r-10240</div><div class="id">intent-router</div>', 'deepseek-v4-flash', '0.3s · 1 步', '<span class="st pass">成功</span>'],
        ['<div class="nm">r-10239</div><div class="id">code-review</div>', 'hy3', '—', '<span class="st fail">失败</span>'],
      ],
    },
    skel: 'Run 列表（.tbl）+ 筛选条（定义 / 状态 / 时间）。Run 详情抽屉：过程卡片复用 <b>ProcCard</b>，回答复用 <b>AnswerBlocks</b>。',
    reuse: ['.tbl 列表', '.st 状态标签', 'ProcCard', 'AnswerBlocks'],
  },
  {
    screen: 'capabilities', t: '能力资产', d: 'Agent 可调用的能力资产（技能 / 工具）：清单、参数契约与被引用情况。',
    note: P4NOTE('清单与配置器复用 admin 既有 .tbl 与表单栅格；能力参数契约以 <code>docs/api/contracts.md</code> 为准，此处不另立口径。'),
    tbl: {
      head: ['能力', '类型', '提供方', '被引用'],
      rows: [
        ['<div class="nm">financial-data</div><div class="id">财务指标查询</div>', '工具', '内置 · mcp-gateway', '3 个定义'],
        ['<div class="nm">doc-search</div><div class="id">文档检索</div>', '工具', '内置 · content-hub', '2 个定义'],
        ['<div class="nm">repo-diff</div><div class="id">代码变更读取</div>', '工具', '内置 · mcp-gateway', '1 个定义'],
      ],
    },
    skel: '能力清单（.tbl）+ 能力配置器（参数契约表单）+「被哪些定义引用」反查。',
    reuse: ['.tbl 列表', '表单栅格 .frow/.fitem/.fld', '.st 状态标签'],
  },
  {
    screen: 'knowledge', t: '知识集合', d: '知识库集合与文档：上传、切分、索引状态。',
    note: P4NOTE('集合列表与文档表复用 .tbl；索引状态用 .st 状态标签，上传复用 admin 既有上传组件。'),
    tbl: {
      head: ['集合', '文档数', '索引状态', '更新时间'],
      rows: [
        ['<div class="nm">contracts-2026</div><div class="id">合同范本库</div>', '18', '<span class="st pass">已就绪</span>', '今天 16:20'],
        ['<div class="nm">financial-reports</div><div class="id">财报原文</div>', '246', '<span class="st wait">索引中 62%</span>', '今天 15:48'],
        ['<div class="nm">product-docs</div><div class="id">产品文档</div>', '9', '<span class="st pass">已就绪</span>', '10-10 11:02'],
      ],
    },
    skel: '集合列表（.tbl）+ 文档列表 + 上传与索引进度；被定义引用时在定义侧提示。',
    reuse: ['.tbl 列表', '.st 状态标签', '上传组件（admin 既有）'],
  },
  {
    screen: 'retrieval', t: '检索调试', d: '对知识集合做检索试跑：召回片段、分数与出处。',
    note: P4NOTE('试跑过程与结果展示复用对话调试同一套过程卡片 <b>ProcCard</b>，不另造渲染。'),
    skel: '左查询区（集合选择 + 查询语句 + topK）+ 右召回结果列表（片段 / 分数 / 出处）。过程展示复用 ProcCard。',
    reuse: ['ProcCard', '.tbl 列表', '.seg 分段单选'],
  },
  {
    screen: 'list', importFrom: 'admin-agent-def-detail.html',
    note: { html: '本屏内容由 <code>docs/ui/prototypes/admin-agent-def-detail.html</code> <b>同源抽取</b>（定稿，不由本注册表渲染）。' },
  },
  {
    screen: 'skills', t: '技能库', d: '可被 Agent 调用的技能：技能调试入口的对话区同样复用消息组件。',
    note: P4NOTE('卡片网格先定稿；技能调试入口的对话区同样复用消息组件（技能也是「一问一答 + 工具过程」结构）。'),
    cards: [
      ['financial-data', '财务指标查询 · 3 个定义在用'],
      ['doc-search', '文档检索 · 2 个定义在用'],
      ['repo-diff', '代码变更读取 · 1 个定义在用'],
    ],
    skel: '技能卡片网格 + 「调试」入口（进对话调试，与 Playground 同构）。',
    reuse: ['卡片网格', 'Turn / Bubble / AnswerBlocks / ProcCard'],
  },
  {
    screen: 'pg', importFrom: 'admin-agents.html',
    note: { html: '本屏内容由 <code>docs/ui/prototypes/admin-agents.html</code> <b>同源抽取</b>（Playground 定稿，不由本注册表渲染）。' },
  },
];

export const BY_SCREEN = Object.fromEntries(REGISTRY.map((r) => [r.screen, r]));
/**
 * 抽取声明**去重后**的列表（按源稿文件；共享源会被多屏引用，但只能抽一次）。
 * build 用它注入 CSS/JS —— 不去重 = 同一份脚本注入 5 次，5 个状态机互相打架。
 */
export const SOURCE_DEFS = [...new Map(
  REGISTRY.filter((r) => r.source).map((r) => [r.source.file, r.source]),
).values()];
/** 待补齐批次（占位屏）→ verify ⑩d 段与 specs/admin-prototype-coverage/tasks.md 对账 */
export const BATCHES = Object.fromEntries(
  REGISTRY.filter((r) => r.batch).map((r) => [r.screen, r.batch]),
);

/* ── 抽取执行 ─────────────────────────────────────────────────────────── */
/**
 * 按 source 声明从原型稿抽取 { html, css, js }。
 * 所有改写都是**机械**的（作用域 / id 前缀 / 命名空间），不改源稿业务代码。
 */
export function loadSource(src) {
  const file = path.join(PROTO_DIR, src.file);
  const text = fs.readFileSync(file, 'utf8');

  /* 1) DOM 片段 */
  const region = src.toIncl
    ? (() => { const i = text.indexOf(src.from); const j = text.indexOf(src.to, i);
      if (i < 0 || j < 0) throw new Error(`${src.file}：抽取区间找不到`);
      return text.slice(i, j + src.to.length); })()
    : between(text, src.from, src.to);
  let html = src.wrapper ? stripWrapper(region, src.wrapper) : region;
  if (src.toIncl && src.to) {
    /* toast 这类挂在 content 外的元素：补进片段尾部（script 依赖它） */
    const extra = src.to;
    if (!html.includes(extra)) html += '\n        ' + extra;
  }
  /* trail：共享源下单独返回（弹层是模块级共享的，塞进某一屏别的屏就打不开它） */
  let trailHtml = '';
  if (src.trail) {
    trailHtml = takeTopLevelElements(between(text, src.trail.from, src.trail.to));
    if (!src.shared) html += '\n        ' + trailHtml;
  }

  /* 2) id 前缀：抽取片段内 id="x" → id="pfx-x"（避免与其它屏撞 id，最常见是 toast） */
  const ids = new Set();
  const addPrefix = (s) => (src.idPrefix
    ? s.replace(/id="([A-Za-z][-\w]*)"/g, (m, id) => { ids.add(id); return `id="${src.idPrefix}${id}"`; })
    : s);
  html = addPrefix(html);
  if (src.shared) trailHtml = addPrefix(trailHtml);

  /* 3) script：全部 <script> 段拼起来（源稿可能拆多段） */
  let js = [...text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

  /*  3a) getElementById shim —— **只映射本源自己的 id**，其它 id 一律走原生。
       inline handler 之后还会被调用，所以 shim 必须长期有效，不能探完即恢复。 */
  let prelude = '';
  if (src.idPrefix && ids.size) {
    prelude = `  var RAW_BY_ID = document.getElementById.bind(document);\n`
      + `  var SELF_IDS = ${JSON.stringify([...ids])}.reduce(function(a,i){a[i]=1;return a;},{});\n`
      + `  document.getElementById = function(id){ return SELF_IDS[id] ? RAW_BY_ID('${src.idPrefix}'+id) : RAW_BY_ID(id); };\n`;
  }
  /*  3b) 命名空间导出：把顶层函数挂到 window[ns]，并改写 inline handler 里的调用
       —— 把改写范围限制在 **inline 属性值内**（不限就是全局词替换，会误伤普通代码里的
          同名变量）。（源稿 onclick="foo(" 直接写 → 不 IIFE 化会全局冲突，IIFE 化又会找不到函数） */
  const nsAttrs = (s) => (src.ns && src.exports
    ? s.replace(/on(?:click|input|change|keydown|submit)="([^"]*)"/g, (m, code) => m.replace(
      code, code.replace(new RegExp(`\\b(${src.exports.join('|')})\\s*\\(`, 'g'), `${src.ns}.$1(`),
    ))
    : s);
  if (src.ns && src.exports) {
    html = nsAttrs(html);
    trailHtml = nsAttrs(trailHtml);
    js = nsAttrs(js);
    js += `\n  window.${src.ns} = { ${src.exports.map((f) => `${f}:${f}`).join(', ')} };\n`;
  }
  const body = prelude + js;
  js = src.iife || src.ns ? `(function(){\n${body}\n})();\n` : body;

  /* 4) CSS：按规则块筛选 → 必要时加作用域
       ⚠️ between 的切片含 '<style>' 开标签，必须剥掉：字面标签混进 CSS 流会把第一条规则
       （常是 :root）连到它上面，导致变量整块失效 / 标签被写进样式表（2026-10-11 同型事故） */
  const cssRaw = stripCssComments(between(text, '<style>', '</style>').replace(/^<style>/, ''));
  let blocks = cssBlocks(cssRaw).filter((b) => {
    const s = selOf(b);
    if (src.cssDrop && src.cssDrop.some((d) => s.includes(d))) return false;
    if (src.cssKeep && !src.cssKeep(s)) return false;
    return true;
  });
  /* 4a) rootToGlobal：:root 块不进作用域 CSS，改为「并进整合稿全局 :root」的候选声明
         （作用域化 :root 会让这些 token 只在该屏生效，与「设计系统级 token」的语义不符） */
  let rootDecls = [];
  if (src.rootToGlobal) {
    rootDecls = (blocks.filter((b) => /^:root$/i.test(selOf(b)))
      .map((b) => b.slice(b.indexOf('{') + 1, b.lastIndexOf('}')))
      .join(';') || '')
      .split(';').map((d) => d.trim()).filter((d) => d.startsWith('--'));
    blocks = blocks.filter((b) => !/^:root$/i.test(selOf(b)));
  }
  const css = src.scope ? scopeCssBlocks(blocks, src.scope).join('\n  ') : blocks.join('\n  ');

  /* 5) shared：把抽取片段里的 N 个 host 容器按 data-cc 拆给各屏（不是复制 N 份） */
  let hosts = null;
  if (src.shared) {
    hosts = {};
    const re = /<div class="([^"]*)\bcc-host\b([^"]*)"([^>]*)data-cc="([^"]+)"([^>]*)>\s*<\/div>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      hosts[m[4]] = `<div class="cc-host" data-cc="${m[4]}"></div>`;
    }
    const missing = src.shared.screens.filter((s) => !hosts[s]);
    if (missing.length) throw new Error(`${src.file}：共享源缺 host：${missing.join(', ')}`);
    html = '';   /* 共享源没有「整段 DOM」，只有 host + 模块级 trail */
  }

  return {
    html, css, js, ids: [...ids], blocks: blocks.length, scoped: !!src.scope,
    hosts, trailHtml, rootDecls, shared: !!src.shared,
  };
}
