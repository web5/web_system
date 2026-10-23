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
 *
 * ── 2026-10-22 新增字段（自媒体运营模块接入时补的四个缺口，都是"整稿带壳"才会踩到）──
 *   mount     **一份 DOM 服务多屏的第二形态**（与 shared 的分工见下）：
 *             { screens: { '<hub 屏 key>': '<源稿内的根键>' } }
 *             · shared = 构建期**按 host 把 DOM 拆给各屏**；
 *             · mount  = **DOM 不拆**，整块挂在其中一屏，切屏时由 hub 在**运行时搬过去**
 *               （showHub 里 appendChild），并调用源稿自己的 go(根键) 让它切到对应子页。
 *             适用场景：模块内部还有一层子页（列表 → 编辑 → 详情），且子页之间有
 *             **跨根键跳转**（例：明细详情 →「去公众号成文」、成文空态 →「前往发布管线」）。
 *             拆开就跳不过去（目标 section 在别的屏里，被 hub 隐藏了）。
 *   trails    trail 的多段版：[{from,to}, …]。源稿的弹层常散落在内容区之外的多个位置
 *             （手动触发弹窗 + 成文预览抽屉 + toast），单段 trail 一次切不全。
 *   jsDrop    [[startMarker, endMarker], …]：把源稿脚本里这两段标记**所在的整行区间**丢掉。
 *             专治「源稿自带评审台」：它写 location.hash = '#s=<key>'，而整合稿的 hash
 *             是它自己的路由（#/content/items）—— 两者会互相打断，必须整段丢弃。
 *             源稿里被测函数一律用 `typeof X !== 'undefined'` 守卫（丢弃后安全）。
 *   sprite    {from,to}：源稿的 <svg><symbol> 图标库（挂在 body 顶层、内容区之外）。
 *             整合稿只注入一次；**symbol id 必须全局唯一**（build 生成自检会数重复）。
 *   cssExtra  追加在**作用域内**的 CSS。源稿靠 body 给的基准排版（字体/字号/行高/字色）
 *             在 body 规则被丢弃后要补回来 —— 否则模块文本会继承整合稿的排版。
 *   wrap      构建期给这份 DOM 套的容器 class（通常 = scope 去掉点号）；不写则不套。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  between, betweenInclusive, stripWrapper, stripCssComments, cssBlocks, selOf, scopeCssBlocks, takeTopLevelElements,
} from './html-utils.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const PROTO_DIR = path.join(ROOT, 'docs/ui/prototypes');

/**
 * 已明确存档的原型稿：真实代码里已无对应页面/路由，留着只为追溯历史。
 *
 * 为什么要单独登记：审计要把「存档」与「散落」分开。
 *   散落 = 有稿、有用、但没进整合稿（该处理）
 *   存档 = 有稿、但已不是当前设计（合法保留，不该反复报警）
 * 两者混在一起，人会因为「一堆红字」而忽略真正新增的散落稿。
 *
 * 2026-10-22 清空：原唯一的 admin-content-hub.html（内容中心 5 屏）已随「自媒体运营」5 页
 * 接替而**物理删除**（真实 router/index.ts 已无 采集总览 / 龙虎榜 / 席位库 三个路由）。
 * 留空数组而不是删掉导出：审计脚本按「存档 = 0」继续工作，且以后再有存档稿直接往这里加。
 */
export const ARCHIVED_PROTOS = [];

/**
 * 明确**不并入 admin 整合稿**的稿（有理由，不是「忘了登记」）。
 *
 * 为什么需要这一层：审计的「散落」定义是「有稿、有用、却没进整合稿」。
 * 但目录里还有一类稿，它们的宿主根本不是 admin —— deploy-console 控制台的原型、
 * 发布平台的历史终稿、外观风格探索稿。把它们算作「散落」会让真的散落稿淹没在噪音里：
 * 实测 16 份「散落」中 6 份属于这一类，每次审计都红一次，人就开始无视审计了。
 *
 * 判定口径是**「该不该进 admin 整合稿」**，不是「这份稿好不好」：
 *   - 有理由进 admin（admin 侧模块）却没登记 → 散落（FAIL）
 *   - 宿主是别的端 / 已定性为历史 → 这里登记（范围外，不计散落）
 *
 * ⚠️ 加进这里等于宣布「这份稿永远不会出现在整合稿里」。如果只是「还没排期并入」，
 * 别加 —— 那是散落，该留在散落清单里被催。
 */
export const OUT_OF_SCOPE_PROTOS = {
  'deploy-console-domain.html':
    '当前有效稿（README §一）：deploy-console 双域控制台 + 系统设置/存储配置。宿主是 deploy-console，不是 admin。',
  'deploy-console-version-deploy.html':
    '当前有效稿（README §一）：版本部署页（VersionDeploy.vue）。宿主是 deploy-console 的微前端域。',
  'pipeline-env-branch-canvas.html':
    '当前有效稿（README §一）：流水线编辑画布（OrchestrationEditor.vue）。宿主是 deploy-console 的流水线编辑页。',
  'module-deploy-target-prototype.html':
    '历史专题稿：部署目标专题，非当前控制台结构，已被 deploy-console 双域结构取代。',
  'release-platform-v14-整合框架.html':
    '发布平台历史终稿：v5～v14 共 11 份旧稿已于 2026-10-22 收敛，仅留这一份作设计过程记录（README §三）。',
  'radius-style-dual.html':
    '外观风格探索稿：圆角双风格（柔和/清爽）对比，属设计系统层探索，不是业务模块页。',
};

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
 * 自媒体运营（content:view / content:manage）—— **一份稿 8 个 section 服务 5 个菜单页**。
 *
 * 取代此前的「内容中心」5 屏（admin-content-hub.html：采集总览 / 内容条目 / 条目详情 /
 * 龙虎榜 / 席位库）。2026-10-22 产品侧把该模块重构为「自媒体运营」功能组，真实代码
 * （apps/admin/src/layouts/BasicLayout.vue + apps/admin/src/router/index.ts）已无
 * 采集总览 / 龙虎榜 / 席位库三个路由 —— 原型侧继续留着就是**第二真相源**，故整体替换。
 * （admin-content-hub.html 已于 2026-10-22 删除，不再登记进整合稿。）
 *
 * 为什么用 mount 而不是 shared：这 5 屏的二级页之间有**跨根键跳转**
 *   · screen-item-detail → go('publications')「去『公众号成文』查看」
 *   · screen-publications 空态 → go('pipelines')「前往发布管线」
 * 把 8 个 section 按菜单页拆到 5 个 host 里，这两处点了会跳到「被 hub 隐藏的那一屏」，
 * 什么也不会发生。→ DOM 不拆，整块一块，切屏时由 hub 在运行时搬过去（见 mount 字段口径）。
 */
const SRC_MEDIA = {
  file: 'admin-media-ops.html',
  from: '<div class="content">',
  to: '<aside class="demo-ctl"',
  wrapper: '<div class="content">',
  /* 类名是裸通用名且与整合稿**大面积重叠**（.btn / .card / .table / .page-head / .chip /
     .tag / .screen / .seg / .empty …），hub 自己也用 .page-head 与 .screen —— 不隔离必然
     互相污染（2026-10-11「样式完全是乱的」同型事故）。 */
  scope: '.zm-scope',
  wrap: 'zm-scope',
  /* 丢弃源稿自己的壳（整页导航壳在这里没有意义）与评审台（其 DOM 未抽取，规则留着只会误伤） */
  cssDrop: ['body', 'html', '.app', '.sider', '.topbar', '.menu-', '.crumb', '.env-tag',
    '.avatar', '.content', '.demo-', '.dc-', '.preset', '.only-', '@media print'],
  /* 源稿的 :root 是**模块私有 token**（--brand / --bg-page / --t1 …），不能并进整合稿
     全局 :root —— 里面 --border / --bg-surface 这类名字与别的稿重名，会互相覆盖。
     交给 scopeCssBlocks 改写成 `.zm-scope{…}`，只在本模块子树生效。
     但 body 上的基准排版被丢掉了，得在作用域内补回来（否则文本继承整合稿排版）。 */
  cssExtra: '  .zm-scope{font-family:var(--sans);font-size:14px;color:var(--t2);line-height:1.6;}\n',
  idPrefix: 'zm-',
  ns: 'ZM',
  exports: ['go', 'toast', 'openTrigger', 'setRcState', 'runTrigger', 'resetFilter',
    'openPreview', 'closeModal', 'runTest', 'setTestState', 'confirmDel',
    /* 账号管理（2026-10-23 新增第 6 个菜单页）：内联 onclick 用到的函数必须在此登记，
       否则抽取时 IIFE 化后点击报 is not defined */
    'accResetSecret', 'accCancelSecret', 'accCheck', 'accDelOpen', 'accDelClose'],
  /* 内容区之外的三块：手动触发弹窗 + 成文预览抽屉（同一段）、toast —— 源稿把弹层挂在
     .content 之外，按 from/to 切内容区会连它们一起丢掉，点「触发」就找不到弹窗 */
  trails: [
    { from: '<div class="mask" id="triggerMask">', to: '<aside class="demo-ctl"' },
    { from: '<div id="toast">', to: '<script>' },
  ],
  /* 评审台脚本整段丢弃：它写 location.hash = '#s=<key>'，与整合稿的 hash 路由互斥
     （切一次场景包，整合稿就被踢回默认屏）。源稿里对它的调用都做了 typeof 守卫。 */
  jsDrop: [['DEMO-PANEL-START', 'DEMO-PANEL-END']],
  /* 图标库 sprite 挂在 body 顶层、内容区之外，不抽就是整稿「图标全空」 */
  sprite: { from: '<svg style="display:none"', to: '</svg>' },
  mount: {
    screens: {
      'content-sources': 'sources',
      'content-items': 'items',
      'content-publications': 'publications',
      'content-pipelines': 'pipelines',
      'content-monitor': 'runs',
      /* 'content-accounts': 'accounts' —— 账号管理（源稿里已有 2 个 section，2026-10-23）
         ⛔ 暂不登记：build 自检会报「mount 屏缺 hub 容器」—— hub 的屏容器由壳生成，
            壳的真相源是真实 BasicLayout.vue，而 apps/admin 尚无该路由/菜单。
         落地 PR 里补三件事后打开这一行：① router/index.ts 加 /content/accounts 路由
         ② BasicLayout.vue 加「账号管理」菜单项 ③ 建 ContentAccounts.vue（可先骨架）
         → 然后 node scripts/build-agents-hub.mjs + node scripts/verify-agents-hub.mjs */
    },
  },
  trace: ['id="zm-triggerMask"', 'id="zm-previewMask"', 'id="zm-toast"', 'class="screen on"'],
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

  /* —— 自媒体运营子菜单（mount 源：一份 DOM 8 个 section 服务 5 个菜单页） —— */
  ...Object.keys(SRC_MEDIA.mount.screens).map((s) => ({
    screen: s, source: SRC_MEDIA,
    note: SRCNOTE('admin-media-ops.html（自媒体运营模块稿 · 8 个 section / 5 个菜单页 · 一份 JS 状态机）',
      '字段与接口对照 M1 落码：<code>collect_sources</code> / <code>collect_runs</code> / '
      + '<code>content_items.quality_*</code> / <code>content_publications</code> / '
      + '<code>publish_pipelines</code>，不是编的。'),
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
  /* trail / trails：共享源下单独返回（弹层是模块级共享的，塞进某一屏别的屏就打不开它） */
  const trailDefs = src.trails || (src.trail ? [src.trail] : []);
  let trailHtml = '';
  if (trailDefs.length) {
    trailHtml = trailDefs
      .map((tr) => takeTopLevelElements(between(text, tr.from, tr.to)))
      .filter(Boolean).join('\n        ');
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

  /*  3-0) jsDrop：把标记**所在整行区间**整段丢弃（如源稿自带的评审台）
        —— 按"行"切而不是按标记串切，是为了连标记行的注释一起带走，不留半截注释。 */
  for (const [mA, mB] of (src.jsDrop || [])) {
    const i = js.indexOf(mA);
    const j = js.indexOf(mB, i < 0 ? 0 : i);
    if (i < 0 || j < 0) throw new Error(`${src.file}：jsDrop 标记找不到（${mA} / ${mB}）`);
    const lineStart = js.lastIndexOf('\n', i) + 1;
    const lineEnd = js.indexOf('\n', j);
    js = js.slice(0, lineStart) + js.slice(lineEnd < 0 ? js.length : lineEnd + 1);
  }

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

  /* 4b) sprite：图标库 <svg><symbol>（挂在源稿 body 顶层，不抽就整稿图标全空）。
         只抽一次由 build 负责；这里返回原文，注入时不做改写（symbol id 全局唯一由 build 自检）。 */
  const spriteHtml = src.sprite ? betweenInclusive(text, src.sprite.from, src.sprite.to) : '';

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
    spriteHtml, cssExtra: src.cssExtra || '', wrap: src.wrap || null,
    mount: src.mount || null,
  };
}
