/**
 * admin 原型「框架壳（sider + 顶栏 + 页脚）」单一真相源
 *
 *   import { shellSider, shellFooter, shellCss, shellJs } from './lib/proto-shell.mjs';
 *
 * 为什么抽出来（2026-10-11，产品意见「菜单的结构最好跟 admin 的样式保持一致」）：
 *   此前三份稿各写一套壳 —— `admin-agents.html` / `admin-agent-def-detail.html` 是「分组小标题
 *   + 平铺项、无图标、无折叠、logo 写「科豆管理」」，整合稿是另一套，而真实 admin 的壳
 *   （`apps/admin/src/layouts/BasicLayout.vue` + antd Menu）又是第三种。三处不一致 = 必漂移。
 *   现在**壳与菜单只在这里定义一次**，三份稿都从这里生成（定稿用 sync-prototype-shell.mjs 注入，
 *   整合稿由 build-agents-hub.mjs 内联），由 verify-proto-shell.mjs 三稿对拍守。
 *
 * 对齐对象（逐项来自 BasicLayout.vue，改这里前先改那边对账）：
 *   · a-layout-sider width=220 / collapsedWidth=80；sider-header 56（logo + 折叠按钮）
 *   · a-menu inline：一级 a-menu-item = 图标 + 文案；Agents 为 a-sub-menu（图标 + 标题 + 箭头）
 *   · 选中 = 橙渐变 + 右侧 3px 竖条（ant-menu-item-selected / ::after）；
 *     子菜单被选中时父标题高亮（ant-menu-submenu-selected）
 *   · hover = 橙 6%（rgba(255,140,66,.06)）；
 *   · 顶栏 56（Home 图标 + 面包屑 + 主题切换 + 用户）；页脚（品牌 + 链接 + ©2026）
 * 色值一律走 token（--ws-accent = #FF8C42，与 admin 主色同值），不写裸 hex。
 */

/** 一级菜单（顺序 / 文案 / 图标 = BasicLayout.vue 逐项对齐；icon 对应 @ant-design/icons-vue） */
export const SHELL_TOP = [
  { label: '工作台',   screen: 'dashboard',  route: '#/dashboard',      icon: 'dashboard' },
  { label: '变变管理', screen: 'bianbian',   route: '#/bianbian',       icon: 'bolt' },
  { label: '用户管理', screen: 'users',      route: '#/users',          icon: 'team' },
  { label: '系统设置', screen: 'settings',   route: '#/settings',       icon: 'setting' },
  { label: '角色权限', screen: 'roles',      route: '#/settings/roles', icon: 'shield' },
  { label: '字典管理', screen: 'dicts',      route: '#/settings/dicts', icon: 'database' },
  { label: 'MCP 管理', screen: 'mcp',        route: '#/mcp',            icon: 'api' },
  { label: '数据浏览', screen: 'database',   route: '#/database',       icon: 'database' },
];

/**
 * 子菜单（a-sub-menu）**列表**。为什么从单个 SHELL_SUB 改成数组：
 * 真实 admin 的 a-menu 里 a-sub-menu 不止一个（Agents 是一组，内容中心也是一组二级页），
 * 而壳只能有一份定义 —— 之前硬编码「只有一个 sub」导致内容中心无处可放，只能另起一份稿
 * （2026-10-15 admin-console.html 事故：壳被复制成第二真相源）。现在按**组**声明，
 * `key` 用于生成 .ad-sub 的 data-sub（切屏时按它判定哪个父级标题高亮）。
 */
/**
 * 自媒体运营（content:view / content:manage）。
 * 逐项对齐 apps/admin/src/layouts/BasicLayout.vue 的 `a-sub-menu key="content"`，
 * route 与 apps/admin/src/router/index.ts 的 content 子路由 path 同构。
 * ⚠️ 2026-10-22 替换掉旧的「内容中心」5 屏（采集总览 / 内容条目 / 条目详情 / 龙虎榜 / 席位库）：
 *    真实代码已把该模块重构为功能组，旧的采集总览 / 龙虎榜 / 席位库三个路由**已不存在**，
 *    原型侧再留着就是第二真相源。原型稿见 docs/ui/prototypes/admin-media-ops.html。
 */
export const SUB_CONTENT = {
  key: 'content', title: '自媒体运营', icon: 'clouddownload',
  screens: ['content-sources', 'content-items', 'content-publications', 'content-pipelines',
    'content-monitor', 'content-accounts'],
  items: [
    { label: '采集源管理', screen: 'content-sources',      route: '#/content',              icon: null },
    { label: '采集明细',   screen: 'content-items',        route: '#/content/items',        icon: null },
    { label: '公众号成文', screen: 'content-publications', route: '#/content/publications', icon: null },
    { label: '发布管线',   screen: 'content-pipelines',    route: '#/content/pipelines',    icon: null },
    { label: '采集监控',   screen: 'content-monitor',      route: '#/content/monitor',      icon: null },
    /* 账号管理：2026-10-23 落地（router /content/accounts + BasicLayout 菜单 + 骨架页），
       原型侧模块稿 admin-media-ops.html 第 6 个菜单页（section: accounts / account-edit）。 */
    { label: '账号管理',   screen: 'content-accounts',     route: '#/content/accounts',     icon: null },
  ],
};
/** Agents 子菜单（a-sub-menu）。`Agent 概览` = router 的 /agents index 页，BasicLayout 未挂菜单项（已知增量） */
export const SUB_AGENTS = {
  key: 'agents', title: 'Agents', icon: 'robot',
  screens: ['overview', 'observe', 'records', 'capabilities', 'knowledge', 'retrieval', 'list', 'skills', 'pg'],
  items: [
    { label: 'Agent 概览', screen: 'overview',     route: '#/agents',              icon: null },
    { label: 'Agent 观测', screen: 'observe',      route: '#/agents/metrics',      icon: null },
    { label: '运行记录',   screen: 'records',      route: '#/agents/runs',         icon: null },
    { label: '能力资产',   screen: 'capabilities', route: '#/agents/capabilities', icon: null },
    { label: '知识集合',   screen: 'knowledge',    route: '#/agents/knowledge',    icon: null },
    { label: '检索调试',   screen: 'retrieval',    route: '#/agents/retrieval',    icon: null },
    { label: '定义管理',   screen: 'list',         route: '#/agents/definitions',  icon: null },
    { label: '技能库',     screen: 'skills',       route: '#/agents/skills',       icon: null },
    { label: '对话调试',   screen: 'pg',           route: '#/agents/playground',   icon: null },
  ],
};
export const SHELL_SUBS = [SUB_CONTENT, SUB_AGENTS];
/** 兼容旧引用（= Agents 组）；新代码请用 SHELL_SUBS */
export const SHELL_SUB = SUB_AGENTS;

/** 菜单项文案序列（BasicLayout 对账 & 生成自检用） */
export const SHELL_LABELS = [
  ...SHELL_TOP.map((m) => m.label),
  ...SHELL_SUBS.flatMap((s) => s.items.map((m) => m.label)),
];

const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  team: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  setting: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>',
  api: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9.5 13h.01M14.5 13h.01"/><path d="M9.5 17h5"/>',
  news: '<path d="M4 4h13a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z"/><path d="M19 7h1v13"/><path d="M7 8h7M7 12h7M7 16h4"/>',
  /* 自媒体运营 = BasicLayout 的 CloudDownloadOutlined */
  clouddownload: '<path d="M12 13v8"/><path d="m9 18 3 3 3-3"/><path d="M20 16.6A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/>',
  home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  caret: '<path d="M6 9l6 6 6-6"/>',
  fold: '<path d="M3 6h18M3 12h18M3 18h18"/><path d="M8 9l-3 3 3 3"/>',
  unfold: '<path d="M3 6h18M3 12h18M3 18h18"/><path d="M16 9l3 3-3 3"/>',
};
export const shellIcon = (name, cls) => `<svg class="${cls || 'ad-ic-svg'}" viewBox="0 0 24 24" width="16" height="16"`
  + ` fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
  + ICON_PATHS[name] + '</svg>';

/* ---------------- DOM ---------------- */

const menuItem = (m, { sub, interactive, active }) => `\n        <div class="ad-item${sub ? ' ad-item-sub' : ''}${active === m.screen ? ' active' : ''}"`
  + ` data-screen="${m.screen}"${interactive ? ` data-route="${m.route}"` : ''}`
  + ` title="${m.label}">`
  + `${sub ? '' : `<span class="ad-ic">${shellIcon(m.icon)}</span>`}<span class="ad-t">${m.label}</span></div>`;

/** 一个 a-sub-menu（标题 + 子项容器）；data-screens 供切屏时判定「哪个父级标题该高亮」 */
const subBlock = (s, { interactive, active }) => `
      <div class="ad-sub open${s.screens.includes(active) ? ' selected' : ''}" data-sub="${s.key}" data-screens="${s.screens.join(',')}">
        <div class="ad-sub-t" role="button" tabindex="0" aria-expanded="true"><span class="ad-ic">${shellIcon(s.icon)}</span><span class="ad-t">${s.title}</span><span class="ad-arrow">${shellIcon('caret', 'ad-arrow-ic')}</span></div>
        <div class="ad-sub-bd">${s.items.map((m) => menuItem(m, { sub: true, interactive, active })).join('')}
        </div>
      </div>`;

/**
 * 侧栏（sider-header + a-menu 结构）：一级项 + **任意组** a-sub-menu
 * @param {{interactive?: boolean, active?: string|null}} o
 *   interactive=true  → 菜单项带 data-route，由页内 hash 路由驱动（整合稿）
 *   interactive=false → 静态示意（定稿单页稿），active 由参数指定
 */
export const shellSider = ({ interactive = false, active = null } = {}) => `<aside class="ad-sider" id="sider">
      <div class="ad-sider-head">
        <div class="ad-logo"><span class="ad-logo-dot"></span><span class="ad-logo-t">科豆 AI</span></div>
        <button class="ad-collapse" id="btn-collapse" type="button" title="收起菜单" aria-label="收起菜单">${shellIcon('fold', 'ad-collapse-ic')}</button>
      </div>
      <nav class="ad-menu">${SHELL_TOP.map((m) => menuItem(m, { sub: false, interactive, active })).join('')}${SHELL_SUBS.map((s) => subBlock(s, { interactive, active })).join('')}
      </nav>
    </aside>`;

/** 页脚（对齐 BasicLayout footer：品牌 + 链接 + 版权） */
export const shellFooter = () => `<footer class="ad-footer">
      <div class="ad-footer-inner">
        <div class="ad-footer-brand"><span class="ad-logo-dot" style="flex:0 0 18px;width:18px;height:18px"></span><span>科豆 AI</span></div>
        <div class="ad-footer-links"><span>GitHub</span><span class="dot">·</span><span>帮助文档</span><span class="dot">·</span><span>问题反馈</span></div>
        <div class="ad-footer-copy">©2026 科豆 AI · 少儿教育平台 管理后台</div>
      </div>
    </footer>`;

/** 顶栏左侧（Home 图标 + 面包屑）—— 面包屑内容各稿不同，由调用方给 inner */
export const shellHeaderLeft = (inner) => `<div class="ad-hl"><span class="ad-home">${shellIcon('home', 'ad-home-ic')}</span>${inner}</div>`;
/** 顶栏右侧（主题切换 + 用户） */
export const shellHeaderRight = () => `<div class="ad-hr">
        <button class="ad-theme" type="button" title="切换暗色" aria-label="主题切换">${shellIcon('moon', 'ad-theme-ic')}</button>
        <span class="ad-user"><span class="ad-avatar">${shellIcon('user', 'ad-avatar-ic')}</span><span class="ad-username">admin</span></span>
      </div>`;

/* ---------------- CSS ---------------- */
/** 壳与菜单样式（注入到 `<style>` 末尾；同特异性靠后序覆盖各稿旧壳规则） */
export const shellCss = () => `
  /* ===== 框架壳与菜单：对齐 apps/admin/src/layouts/BasicLayout.vue（scripts/lib/proto-shell.mjs 单源，勿手改） =====
     sider 220 / 收起 80 / 头部 56 / 菜单项高 40 / 图标 16 /
     选中 = 橙渐变 + 右侧 3px 竖条（ant-menu-item-selected::after）/ hover = 橙 6% /
     子菜单选中时父标题高亮（ant-menu-submenu-selected） */
  :root{--ws-accent-hover:rgba(255,140,66,.06);--ws-menu-w:220px;--ws-menu-w-collapsed:80px;}
  .ad-sider{width:var(--ws-menu-w);background:var(--ws-bg-surface);
    transition:width var(--ws-duration-fast) var(--ws-ease-out);}
  .ad-sider.collapsed{width:var(--ws-menu-w-collapsed);}
  .ad-sider-head{height:56px;display:flex;align-items:center;justify-content:space-between;
    gap:8px;padding:0 16px;flex-shrink:0;}
  .ad-logo{display:flex;align-items:center;gap:10px;cursor:pointer;min-width:0;}
  .ad-logo-dot{flex:0 0 22px;}   /* 不加会被 flex 压扁（折叠态曾挤成 11px 宽的细条） */
  .ad-logo-t{color:var(--ws-accent);font-size:16px;font-weight:700;white-space:nowrap;}
  .ad-collapse{display:grid;place-items:center;width:28px;height:28px;flex:0 0 28px;padding:0;
    border-radius:var(--ws-radius-md);border:1px solid var(--ws-border);background:var(--ws-bg-surface);
    color:var(--ws-text-tertiary);cursor:pointer;transition:all var(--ws-duration-fast) var(--ws-ease-out);}
  .ad-collapse:hover{color:var(--ws-accent);border-color:var(--ws-accent-soft);background:var(--ws-accent-hover);}
  .ad-menu{padding:4px 8px;overflow:auto;flex:1;}
  .ad-item{height:40px;padding:0 12px;border-radius:var(--ws-radius-lg);color:var(--ws-text-secondary);
    font-size:13px;cursor:pointer;margin-bottom:2px;display:flex;align-items:center;gap:10px;flex-shrink:0;
    transition:background var(--ws-duration-fast) var(--ws-ease-out),color var(--ws-duration-fast) var(--ws-ease-out);}
  .ad-item .ad-ic{display:flex;align-items:center;justify-content:center;width:16px;height:16px;
    flex:0 0 16px;color:var(--ws-text-tertiary);}
  .ad-item svg{width:16px;height:16px;flex:0 0 16px;}   /* 防 SVG 无尺寸约束撑爆（曾 1026px） */
  .ad-item:hover{background:var(--ws-accent-hover);color:var(--ws-accent);}
  .ad-item.active{background:linear-gradient(90deg,var(--ws-accent-soft) 0%,var(--ws-accent-soft-2) 100%);
    color:var(--ws-accent);font-weight:600;position:relative;}
  .ad-item.active::after{content:'';position:absolute;right:0;top:0;bottom:0;width:3px;
    background:var(--ws-accent);border-radius:0 2px 2px 0;}   /* ant-menu-item-selected::after */
  .ad-sub{padding-left:0;font-size:13px;}   /* 覆写旧稿把 .ad-sub 当「子项缩进」用的规则 */
  .ad-sub-t{height:40px;padding:0 12px;border-radius:var(--ws-radius-lg);color:var(--ws-text-secondary);
    font-size:13px;cursor:pointer;margin-bottom:2px;display:flex;align-items:center;gap:10px;
    transition:background var(--ws-duration-fast) var(--ws-ease-out),color var(--ws-duration-fast) var(--ws-ease-out);}
  .ad-sub-t:hover{background:var(--ws-accent-hover);color:var(--ws-accent);}
  .ad-sub-t .ad-ic{display:flex;align-items:center;justify-content:center;width:16px;height:16px;
    flex:0 0 16px;color:var(--ws-text-tertiary);}
  .ad-arrow{margin-left:auto;display:flex;align-items:center;color:var(--ws-text-tertiary);
    transition:transform var(--ws-duration-fast) var(--ws-ease-out);}
  .ad-sub.open .ad-arrow{transform:rotate(180deg);}
  .ad-sub.selected .ad-sub-t{color:var(--ws-accent);font-weight:600;}
  .ad-sub.selected .ad-sub-t .ad-ic{color:var(--ws-accent);}
  .ad-sub-bd{display:none;}
  .ad-sub.open .ad-sub-bd{display:block;}
  .ad-item-sub{padding-left:46px;}   /* a-sub-menu 内缩进（一级 12 + 图标 16 + gap 10 + indent 8） */
  .ad-header{height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;
    gap:8px;flex-shrink:0;border-bottom:1px solid var(--ws-border);}
  .ad-hl{display:flex;align-items:center;gap:8px;min-width:0;}
  .ad-home{display:flex;align-items:center;color:var(--ws-text-tertiary);}
  .ad-hr{display:flex;align-items:center;gap:12px;flex:0 0 auto;}
  .ad-theme{display:grid;place-items:center;width:34px;height:34px;padding:0;
    border-radius:var(--ws-radius-md);border:1px solid var(--ws-border);background:var(--ws-bg-surface);
    color:var(--ws-text-tertiary);cursor:pointer;transition:all var(--ws-duration-fast) var(--ws-ease-out);}
  .ad-theme:hover{color:var(--ws-accent);border-color:var(--ws-accent-soft);background:var(--ws-accent-hover);}
  .ad-user{display:flex;align-items:center;gap:8px;padding:4px 12px 4px 4px;border-radius:999px;cursor:pointer;}
  .ad-user:hover{background:var(--ws-accent-hover);}
  .ad-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:999px;
    border:2px solid var(--ws-accent-soft);background:var(--ws-bg-subtle);color:var(--ws-text-secondary);}
  .ad-username{font-size:14px;font-weight:500;color:var(--ws-text-primary);}
  .ad-footer{flex-shrink:0;background:var(--ws-bg-surface);}
  .ad-footer-inner{padding:14px 16px 18px;border-top:1px solid var(--ws-border);
    display:flex;flex-direction:column;align-items:center;gap:6px;}
  .ad-footer-brand{display:flex;align-items:center;gap:6px;opacity:.6;font-size:13px;font-weight:600;color:var(--ws-accent);}
  .ad-footer-links{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ws-text-tertiary);}
  .ad-footer-links .dot{color:var(--ws-accent-soft);}
  .ad-footer-copy{font-size:12px;color:var(--ws-text-tertiary);}
  /* 折叠态：只留图标（必须写在菜单展开规则之后 —— 与 .ad-sub.open .ad-sub-bd 同特异性，靠后序胜出；
     2026-10-11 实测：写在前面会让折叠态子项漏出来 + 子菜单标题文字外溢） */
  .ad-sider.collapsed .ad-logo-t,
  .ad-sider.collapsed .ad-item .ad-t,
  .ad-sider.collapsed .ad-sub-t .ad-t,
  .ad-sider.collapsed .ad-arrow{display:none;}
  .ad-sider.collapsed .ad-sub .ad-sub-bd{display:none;}   /* 覆写 .ad-sub.open .ad-sub-bd{display:block} */
  .ad-sider.collapsed .ad-item,.ad-sider.collapsed .ad-sub-t{justify-content:center;padding-left:0;padding-right:0;}
  /* 折叠态头部：80px 宽容不下「logo + 按钮」（padding 16×2 后仅剩 48px）→ 收窄内边距，别挤压 logo */
  .ad-sider.collapsed .ad-sider-head{padding:0 10px;gap:6px;}
`;

/* ---------------- JS ---------------- */
/** 壳交互：折叠 / 展开菜单 + 子菜单展开收起（三份稿共用） */
export const shellJs = () => `
(function(){
  var qsa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var ICON_FOLD = ${JSON.stringify(shellIcon('fold', 'ad-collapse-ic'))};
  var ICON_UNFOLD = ${JSON.stringify(shellIcon('unfold', 'ad-collapse-ic'))};
  qsa('.ad-sider').forEach(function(sider){
    var btn = sider.querySelector('#btn-collapse') || sider.querySelector('.ad-collapse');
    if (btn) btn.addEventListener('click', function(){
      var c = sider.classList.toggle('collapsed');
      btn.innerHTML = c ? ICON_UNFOLD : ICON_FOLD;
      btn.title = c ? '展开菜单' : '收起菜单';
    });
    /* 折叠态点图标：先恢复展开态（真实 antd 走 popover，原型简化为展开后进入） */
    sider.querySelector('.ad-menu').addEventListener('click', function(e){
      if (!sider.classList.contains('collapsed')) return;
      if (e.target.closest('.ad-item, .ad-sub-t')) {
        sider.classList.remove('collapsed');
        if (btn) { btn.innerHTML = ICON_FOLD; btn.title = '收起菜单'; }
      }
    }, true);
  });
  qsa('.ad-sub-t').forEach(function(t){
    t.addEventListener('click', function(){
      var sub = t.closest('.ad-sub');
      var open = sub.classList.toggle('open');
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  });
})();
`;

/** 供 build 脚本做「菜单 ↔ BasicLayout.vue」对账用的映射（route 末段 / 屏名） */
export const SHELL_NAV = [
  ...SHELL_TOP.map((m) => ({ ...m, group: null })),
  ...SHELL_SUBS.flatMap((s) => s.items.map((m) => ({ ...m, group: s.title }))),
];
