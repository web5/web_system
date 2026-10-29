#!/usr/bin/env node
/**
 * 构建 admin 管理后台「菜单级整合交互稿」（Agents 模块为内容主体）
 *
 *   node scripts/build-agents-hub.mjs
 *
 * 背景（三轮产品意见累积）：
 *   ①「原型稿菜单里的页面还没整合进来，确认复用的组件模块是否一样」；
 *   ②「不是导航入口，是 admin 框架页面，点击进入对应模块页面」；
 *   ③「红框标注的菜单还没合入」—— 此前 工作台 / 用户管理 / 系统设置 / MCP 管理 是 `.nolink`
 *     死项，且菜单缺 变变管理 / 角色权限 / 字典管理 / 数据浏览，与真实 admin 菜单不一致。
 *
 * 本脚本 = **同源抽取**（定稿 DOM/CSS 不手抄）+ **菜单逐项对齐真实 admin** 后拼装：
 *   · 左侧菜单 = `apps/admin/src/layouts/BasicLayout.vue` 的菜单项（文案 / 顺序逐项对齐，无死项），
 *     由 verify-agents-hub.mjs ⑧ 段读该 .vue 源对账；
 *   · **每屏装什么内容 = scripts/lib/proto-registry.mjs 单一真相源**（v6 起）：
 *     写了 `source` 的屏 → 从原型稿同源抽取真实内容（DOM 剥壳 / CSS 作用域隔离 /
 *     id 加前缀 / IIFE + inline handler 命名空间改写）；
 *     没写的屏 → 占位（只登记「菜单位置 / 路由 / 复用口径」+ 归属批次，**不伪造业务数据**，
 *     批次可在 specs/admin-prototype-coverage/tasks.md 里查到出处）；
 *   · 已同源抽取的真实屏：对话调试（admin-agents.html）/ 定义管理 + 定义详情·调试台
 *     （admin-agent-def-detail.html）/ 系统设置（admin-settings.html）/
 *     字典管理（dict-module.html，裸通用类名 → CSS 作用域隔离）；
 *     Agents 组内其余页面为同构占位（带示意数据）；
 *   · 页面底部「组件复用地图」：Turn / Bubble / AnswerBlocks / ProcCard 四件套 + 表单侧复用件；
 *   · 路由：hash 路由（与 apps/admin/src/router/index.ts 的真实 path 同构），点击菜单即
 *     「进入」对应模块页面，浏览器前进后退可用 —— 对齐真实 admin 框架页行为，不是页内 tab。
 *
 * 为什么用脚本拼而不用手抄：
 *   ① 页面 DOM 与 CSS 从各定稿**原样抽取**，不手抄 → 不引入人为漂移，
 *      parity 机检（verify-playground-parity.mjs）对拍的是同一份源码；
 *   ② 原型后续修订后重跑本脚本即可再生成，整合稿不成为第三个真相源；
 *   ③ v6：连「哪一屏用哪份稿」也交给注册表 —— **以后补稿不用再"整合"**，注册表加一行即可。
 *
 * 对新稿 script 仅做三处**机械改写**（切屏从「文件内两 section」升级为「hub 多屏 + hash 路由」）：
 *  · openDef(): screen-list/screen-detail 显隐 → location.hash = '#/agents/definitions/' + id
 *  · goList():  屏幕显隐 → location.hash = '#/agents/definitions'
 *  · crumb-main 绑定删除（hub 的 crumb 由 showHub 统一渲染，返回入口用详情屏内「返回列表」）
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/* 「壳与菜单」单一真相源（三份原型稿共用；见该文件头注释） */
import { SHELL_TOP, SHELL_SUBS, SHELL_NAV, shellSider, shellFooter, shellHeaderLeft, shellHeaderRight, shellIcon, shellCss, shellJs } from './lib/proto-shell.mjs';
/* 「每屏装什么内容」单一真相源：登记了 source 的屏从原型稿同源抽取，没登记的走占位（见该文件头注释） */
import { REGISTRY, BY_SCREEN, BATCHES, SOURCE_DEFS, loadSource } from './lib/proto-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PG_FILE = path.join(ROOT, 'docs/ui/prototypes/admin-agents.html');
const DT_FILE = path.join(ROOT, 'docs/ui/prototypes/admin-agent-def-detail.html');
const OUT_FILE = path.join(ROOT, 'docs/ui/prototypes/admin-agents-hub.html');

const pg = fs.readFileSync(PG_FILE, 'utf8');
const dt = fs.readFileSync(DT_FILE, 'utf8');

const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error('找不到起点：' + a.slice(0, 40));
  const j = s.indexOf(b, i);
  if (j < 0) throw new Error('找不到终点：' + b.slice(0, 40));
  return s.slice(i, j);
};

/** 剥掉最外层开标签及其匹配闭合，只取内部（按 div 深度扫描） */
const stripWrapper = (s, openTag) => {
  const i = s.indexOf(openTag);
  if (i < 0) throw new Error('找不到开标签：' + openTag);
  let p = i + openTag.length, depth = 1;
  while (p < s.length && depth > 0) {
    if (s.startsWith('<div', p)) { depth++; p += 4; }
    else if (s.startsWith('</div>', p)) { depth--; p += 6; }
    else p++;
  }
  if (depth !== 0) throw new Error('括号不配对：' + openTag);
  return s.slice(i + openTag.length, p - 6).trim();
};

/* ---------- 1. CSS：新稿整块保真 + Playground 专属规则合入 ---------- */
/* ⚠️ between() 的切片含 '<style>' 开标签，必须剥掉：字面 '<style>' 混进 CSS 流会让
   解析器把它连到 :root 选择器上、整条 token 规则被丢（2026-10-11 实测：全站 var() 失效） */
/**
 * 取「内容 CSS」= 稿内所有 <style> 块 **减去** sync-prototype-shell 注入的壳块。
 * 2026-10-28 事故：原实现 between() 只取**第一段** style，而 B3 五控件 CSS 误挂在第二段
 * （壳块）尾部 → 整段被丢，hub 屏② 五个 .only-* 数据态同显 + .warn-tool SVG 撑爆。
 * 现在按块收集、跳过壳标记块（hub 的 shellCss() 单源自带，重复合入=双份壳规则），
 * 其余每一段（含未来新增的第三段）一律进 hub。
 */
const SHELL_CSS_MARK = '/* ===== PROTO-SHELL-CSS (auto, single source) ===== */';
const styleBlocksOf = (html) => [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
const contentCssOf = (html) => styleBlocksOf(html)
  .filter((b) => !b.includes(SHELL_CSS_MARK))
  .join('\n');
const dtStyleInner = contentCssOf(dt);
const dtScript = between(dt, '<script>', '</script>');

/**
 * Playground 屏 DOM 同源抽取自 admin-agents.html，其专属样式（.pg-toolbar / .pg-agent /
 * .pg-run / .pg-dbg …）不在新稿 CSS 中。缺失时无尺寸约束的 SVG 会撑成 1026px 方块、
 * 把整屏布局顶翻（2026-10-11 实测事故）→ 必须合入。
 *
 * 合并口径：**按规则块粒度**，同名选择器以新稿（AA 修正版）为准，仅合入新稿没有的块；
 * :root 变量做并集（新稿优先，仅补新稿缺失的 token）。
 */
const stripCssComments = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '');
const cssBlocks = (css) => {
  const out = [];
  let depth = 0, start = 0, blockStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) start = blockStart; depth++; }
    else if (css[i] === '}') { depth--; if (depth === 0) { out.push(css.slice(start, i + 1)); blockStart = i + 1; } }
  }
  return out;
};
const selOf = (b) => b.slice(0, b.indexOf('{')).trim().replace(/\s+/g, ' ');

const pgCssRaw = stripCssComments(contentCssOf(pg));
const dtCssRaw = stripCssComments(contentCssOf(dt));
const pgBlocks = cssBlocks(pgCssRaw);
const dtBlocks = cssBlocks(dtCssRaw);
const dtSels = new Set(dtBlocks.map(selOf));
const pgOnlyBlocks = pgBlocks.filter((b) => !dtSels.has(selOf(b)));

/* :root 变量并集：dt 优先，补 pg 独有的 token */
const rootDecls = (css) => {
  const m = css.match(/:root\{([\s\S]*?)\}/);
  if (!m) return [];
  return m[1].split(';').map((p) => p.trim()).filter((p) => p.startsWith('--'));
};
const pgRoot = rootDecls(pgCssRaw);
const dtRoot = new Set(rootDecls(dtCssRaw));
const pgRootExtra = pgRoot.filter((d) => !dtRoot.has(d));

const pgOnlyCss = pgOnlyBlocks.map((b) => b.trim()).join('\n  ')
  + (pgRootExtra.length ? '\n  :root{' + pgRootExtra.join(';') + '}' : '');
/* ---------- 2. 抽取 Playground 屏 DOM（chatpanel：pg-toolbar + pg-chat + composer，原样） ---------- */
const pgScreen = between(pg, '<div class="chatpanel">', '</main>').trim();
/* Playground 的输入区行为：与 DT 调试台同一套结构与流转，抽过来注进 hub 脚本 */
const pgComposerJs = between(pg, '/* PG-COMPOSER-START', '/* PG-COMPOSER-END */')
  .replace(/^[\s\S]*?\*\//, '');   // 去掉 START 注释行剩余部分

/* ---------- 3. 抽取新稿两屏 DOM（剥掉最外层 screen div，只取内部） ---------- */
const listInner = stripWrapper(dt, '<div id="screen-list" class="screen">');
const detailInner = stripWrapper(dt, '<div id="screen-detail" class="screen hidden" data-demo-state="normal">');
const toastBlock = '<div class="toast hidden" id="toast" role="alert"></div>';

/* ---------- 4. script 机械改写（切屏升级为 hash 路由） ---------- */
let js = dtScript;
const reps = [
  ["    $('screen-list').classList.add('hidden');\n    $('screen-detail').classList.remove('hidden');\n    $('crumb-sub').innerHTML = ' / <b>' + id + '</b>';",
   "    location.hash = '#/agents/definitions/' + id;"],
  ["    $('screen-detail').classList.add('hidden');\n    $('screen-list').classList.remove('hidden');\n    $('crumb-sub').innerHTML = '';",
   "    location.hash = '#/agents/definitions';"],
  ["  $('crumb-main').addEventListener('click', function(){ leaveDetail(this); });\n", ''],
];
for (const [from, to] of reps) {
  if (!js.includes(from)) throw new Error('script 改写锚点未命中：' + from.slice(0, 60));
  js = js.replace(from, to);
}

/* ---------- 5. hub 专属 CSS（页面框架 / 多屏切换 / 占位屏 / 组件地图） ---------- */
const hubCss = `
  /* ===== hub 专属：页面框架（每屏一个「页」：页头 + 内容，点击菜单即进入） ===== */
  .ad-desktop{height:960px;}   /* 整合稿画布高度（壳不写死，各稿自定） */
  .page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;
    padding:2px 2px 14px;border-bottom:1px solid var(--ws-border);margin-bottom:16px;}
  .page-head .pt{font-size:18px;font-weight:600;color:var(--ws-text-strong);}
  .page-head .pd{font-size:12px;color:var(--ws-text-secondary);margin-top:4px;line-height:var(--ws-leading-snug);}
  .page-head .pa{display:flex;gap:8px;flex:0 0 auto;}

  /* 壳与菜单样式 = scripts/lib/proto-shell.mjs 单源（三份原型稿共用，勿在此重写） */

  /* ===== hub 专属：多屏切换（hash 路由驱动） ===== */
  .ad-item[data-screen]{cursor:pointer;}   /* 无 nolink 死项：菜单每一项都可点进模块页面 */
  .screen{min-height:100%;animation:hub-in .18s ease;}
  @keyframes hub-in{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:none;}}

  /* ===== hub 专属：范围外占位屏（P4 后续批次，结构同构、内容待需求） ===== */
  .ph-note{max-width:760px;}
  .ph-grid{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;}
  .ph-kpi{flex:0 0 180px;border:1px solid var(--ws-border);border-radius:var(--ws-radius-lg);
    background:var(--ws-bg-surface);padding:12px 14px;}
  .ph-kpi .v{font-size:24px;font-weight:600;color:var(--ws-text-strong);font-variant-numeric:tabular-nums;}
  .ph-kpi .k{font-size:12px;color:var(--ws-text-secondary);margin-top:2px;}
  .ph-skel{border:1px dashed var(--ws-border);border-radius:var(--ws-radius-lg);padding:14px;
    color:var(--ws-text-secondary);font-size:12px;line-height:var(--ws-leading-snug);margin-top:14px;max-width:760px;}
  .ph-skel b{color:var(--ws-text-primary);}
  .ph-reuse{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px;font-size:12px;
    color:var(--ws-text-secondary);}
  .ph-reuse .chip{background:var(--ws-bg-surface);}

  /* ===== hub 专属：组件复用地图（页面底部，ad-desktop 之外） ===== */
  .reuse-map{width:1280px;}
  .reuse-map .rm-grid{display:flex;gap:12px;flex-wrap:wrap;}
  .rm-card{flex:1;min-width:220px;border:1px solid var(--ws-border);border-radius:var(--ws-radius-lg);
    background:var(--ws-bg-surface);padding:14px;}
  .rm-card .nm{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--ws-text-strong);}
  .rm-card .nm .no{width:20px;height:20px;border-radius:var(--ws-radius-sm);background:var(--ws-brand-soft);
    color:var(--ws-brand-700);font-size:12px;font-weight:600;display:grid;place-items:center;font-family:var(--ws-font-mono);}
  .rm-card .ds{font-size:12px;color:var(--ws-text-secondary);line-height:var(--ws-leading-snug);margin-top:8px;}
  .rm-card .use{margin-top:10px;border-top:1px dashed var(--ws-border);padding-top:10px;
    display:flex;flex-direction:column;gap:6px;font-size:12px;}
  .rm-card .use .u{display:flex;gap:8px;align-items:baseline;color:var(--ws-text-secondary);}
  .rm-card .use .u b{color:var(--ws-text-primary);font-weight:500;flex:0 0 auto;}
  .rm-form{margin-top:12px;border:1px solid var(--ws-border);border-radius:var(--ws-radius-lg);
    background:var(--ws-bg-surface);padding:14px;}
  .rm-form .t{font-size:13px;font-weight:600;color:var(--ws-text-strong);}
  .rm-form .ds{font-size:12px;color:var(--ws-text-secondary);line-height:var(--ws-leading-snug);margin-top:6px;}
  .rm-gate{margin-top:12px;font-size:12px;color:var(--ws-text-secondary);line-height:var(--ws-leading-snug);}
  .rm-gate code{font-family:var(--ws-font-mono);background:var(--ws-bg-subtle);padding:1px 5px;border-radius:3px;}
`;

/* ---------- 6. hub 壳：全量菜单（对齐真实 admin）+ hash 路由 + 页面框架 ---------- */
/**
 * 左侧菜单 = apps/admin/src/layouts/BasicLayout.vue 的菜单项，**文案与顺序逐项对齐**
 * （verify-agents-hub.mjs ⑧ 段直接读该 .vue 源文件对账，防再漂移）。
 *  · route：与 apps/admin/src/router/index.ts 的真实 path 同构（写成 hash 形式）；
 *  · crumb：该屏的面包屑层级（末段加粗）；
 *  · 唯一增量：`Agent 概览` —— 真实 router 的 /agents index 页（AgentOverview.vue），
 *    BasicLayout 未挂菜单项，本稿把它作为 Agents 模块首页入口保留，并在对账段登记理由。
 * 背景（2026-10-11 v4）：产品意见「红框标注的菜单还没合入」——此前工作台 / 用户管理 /
 * 系统设置 / MCP 管理是 `.nolink` 死项、且菜单缺 变变管理 / 角色权限 / 字典管理 / 数据浏览。
 */
/**
 * 菜单结构 = BasicLayout.vue 的 a-menu 结构（不是「分组小标题 + 平铺项」）：
 *   · 一级：a-menu-item → 图标 + 文案（8 项）
 *   · 二级：a-sub-menu（图标 + 标题「Agents」 + 展开箭头）→ 内含 9 个 a-menu-item（无图标）
 * 图标名与 BasicLayout 的 @ant-design/icons-vue 逐项对应（见 ICON_MAP 注释）。
 */
/* 菜单（TOP / SUB）来自 scripts/lib/proto-shell.mjs —— 三份原型稿「壳与菜单」单一真相源；
   这里只补 hub 专属的 crumb（面包屑层级），并断言两侧一致（防 lib 改了这里忘跟） */
const CRUMBS = {
  dashboard: ['工作台'], bianbian: ['变变管理'], users: ['用户管理'], settings: ['系统设置'],
  roles: ['角色权限'], dicts: ['字典管理'], mcp: ['MCP 管理'], database: ['数据浏览'],
  /* 自媒体运营（2026-10-22 起）：与 BasicLayout.vue 的 a-sub-menu key="content" 逐项对齐 */
  'content-sources': ['自媒体运营', '采集源管理'], 'content-items': ['自媒体运营', '采集明细'],
  'content-publications': ['自媒体运营', '公众号成文'], 'content-media': ['自媒体运营', '封面素材'],
  'content-pipelines': ['自媒体运营', '发布管线'],
  'content-monitor': ['自媒体运营', '采集监控'],
  'content-accounts': ['自媒体运营', '账号管理'],
  overview: ['Agents', 'Agent 概览'], observe: ['Agents', 'Agent 观测'], records: ['Agents', '运行记录'],
  capabilities: ['Agents', '能力资产'], knowledge: ['Agents', '知识集合'], retrieval: ['Agents', '检索调试'],
  list: ['Agents', '定义管理'], skills: ['Agents', '技能库'], pg: ['Agents', '对话调试'],
};
const NAV = SHELL_NAV.map((m) => {
  if (!CRUMBS[m.screen]) throw new Error('缺少 crumb 映射：' + m.screen);
  return { ...m, crumb: CRUMBS[m.screen] };
});
const TOP = SHELL_TOP;
const SUBS = SHELL_SUBS;

/** 侧栏 DOM（单源：scripts/lib/proto-shell.mjs；interactive = 菜单项带 data-route 由 hash 路由驱动） */
const MENU = shellSider({ interactive: true });
/** 菜单文案序列（BasicLayout 对账用；verify-agents-hub.mjs ⑧ 段读 .vue 源逐项比） */
const MENU_LABELS = NAV.map((m) => m.label);

/* 每屏页头（list 屏的 toolbar、detail 屏的 dt-head 即页头，不重复加） */
const PAGE_HEADS = {
  pg: { t: '对话调试', d: '选一个定义，直接提问看回答与工具调用过程；调试台在「定义详情 · 高级」内，两处同一套消息组件。', a: '<span class="btn" data-act="go-list">去定义管理</span>' },
};
const pageHead = (key) => {
  const h = PAGE_HEADS[key] || BY_SCREEN[key];
  if (!h) return '';
  return `<div class="page-head" data-page-head="${key}">
      <div><div class="pt">${h.t}</div><div class="pd">${h.d}</div></div>
      <div class="pa">${h.a || ''}</div>
    </div>`;
};

/**
 * 各屏元信息（页头标题/副标题 + 占位屏内容）。
 *  · Agents 组内（P4 后续批次）占位屏带**示意数据**（KPI / .tbl），口径与 Agents 模块一致；
 *  · 非 Agents 模块占位屏**不伪造业务数据**，只登记「菜单位置、路由与复用口径」，并指向
 *    各自的原型补齐批次（specs/admin-prototype-coverage/tasks.md）—— 不与真实实现抢真相源。
 */
/* 各屏内容元信息 + 「有稿者的抽取声明」已迁至 scripts/lib/proto-registry.mjs（单一真相源）：
   新增或迭代一份原型 = 在那里登记一行 source，重跑本脚本即可整合;
   本文件不再手写任何单屏内容，也不再有第二份真相。 */

/* ---------- 7. 注册表抽取：登记了 source 的屏 → 从原型稿同源抽取真实内容 ---------- */
/**
 * 「整合」不再是手工动作：scripts/lib/proto-registry.mjs 里每屏一行，写了 source 的这里自动抽。
 *  · DOM 剥掉源稿自己的壳，只取内容区（+ 源稿挂在壳上的弹层，见 trail 字段）；
 *  · CSS 按规则块筛选：低冲突稿直接合入，裸通用类名的稿（dict）加作用域前缀防止污染其它屏；
 *  · JS 包 IIFE，DOM 有 inline handler 时把顶层函数挂到 window[ns] 并改写调用点。
 * 以后某模块出稿 / 改稿：改注册表一行 → 重跑本脚本，不需要再改这里。
 */
/**
 * 按**源稿**抽取（不是按屏）：共享源被 5 屏引用，但只能抽一次 —— 抽 5 次 = 5 份状态机。
 * 每份产物带 `screens`（这份稿服务哪些屏）与 `hosts`（共享源按 data-cc 拆好的屏容器）。
 */
const SOURCES = SOURCE_DEFS.map((src) => {
  const reg = REGISTRY.filter((r) => r.source === src).map((r) => r.screen);
  return { screens: reg, file: src.file, trace: src.trace, scoped: !!src.scope, shared: !!src.shared, ...loadSource(src) };
});
const SOURCE_CSS = SOURCES.map((s) => `  /* ===== 来自 ${s.file}（${s.scoped ? 'CSS 已作用域隔离：裸通用类名不污染其它屏' : '类名自带前缀，直接合入'}） ===== */\n  ${s.css}${s.cssExtra ? '\n' + s.cssExtra : ''}`).join('\n');
const SOURCE_SCREENS = SOURCES.flatMap((s) => s.screens);
const SOURCE_JS = SOURCES.map((s) => `/* 来自 ${s.file}（IIFE 包裹，符号不泄漏到全局）${s.shared ? ` · 共享源：一份脚本服务 ${s.screens.length} 屏` : ''} */\n${s.js}`).join('\n');
/* rootToGlobal 的源稿：只补整合稿全局 :root 里**缺的** token（同名以整合稿为准） */
const GLOBAL_TOKENS = [...new Map(
  SOURCES.flatMap((s) => (s.rootDecls || []).map((d) => [d.split(':')[0].trim(), d])),
).values()];
/* 共享源的模块级弹层（drawer / mask / modal / toast）：挂到 .ad-desktop 末尾，不进任何一屏
   —— 否则「在席位库开的抽屉，切到龙虎榜就打不开了」 */
const SHARED_TRAILS = SOURCES.filter((s) => s.shared && s.trailHtml)
  .map((s) => `  <!-- ${s.file} 的模块级弹层（不进屏，${s.screens.length} 屏共用） -->\n  <div class="${s.wrap || 'cc-scope'}">\n  ${s.trailHtml}\n  </div>`)
  .join('\n');

/** 占位屏渲染：范围说明 → 示意数据（KPI / 卡片 / .tbl）→ 骨架 → 复用件 */
const placeholder = (key) => {
  const m = BY_SCREEN[key];
  const parts = [];
  if (m.note) {
    const cls = m.note.brand ? 'ph-note note brand' : 'ph-note note';
    parts.push(`        <div class="${cls}"><span class="k">范围说明</span><span>${m.note.html}</span></div>`);
  }
  if (m.kpi) {
    parts.push('        <div class="ph-grid">'
      + m.kpi.map(([v, k]) => `\n          <div class="ph-kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('')
      + '\n        </div>');
  }
  if (m.cards) {
    parts.push('        <div class="ph-grid">'
      + m.cards.map(([t, k]) => `\n          <div class="ph-kpi" style="flex:0 0 320px;"><div class="v" style="font-size:16px;">${t}</div><div class="k">${k}</div></div>`).join('')
      + '\n        </div>');
  }
  if (m.tbl) {
    parts.push('        <div class="tbl">\n          <div class="th">'
      + m.tbl.head.map((h, i) => `<div class="c${i + 1}">${h}</div>`).join('') + '</div>'
      + m.tbl.rows.map((r) => '\n          <div class="tr">' + r.map((c, i) => `<div class="c${i + 1}">${c}</div>`).join('') + '</div>').join('')
      + '\n        </div>');
  }
  if (m.skel) parts.push(`        <div class="ph-skel"><b>骨架</b>：${m.skel}</div>`);
  if (m.reuse) {
    parts.push('        <div class="ph-reuse"><span>复用：</span>' + m.reuse.map((r) => `<span class="chip">${r}</span>`).join('') + '</div>');
  }
  return parts.join('\n');
};

const REUSE_MAP = `
<div class="reuse-map">
<div class="proto-head" style="margin-top:22px">
  <h1>组件复用地图 · 落地时按图施工</h1>
  <div class="sub">
    本稿两处对话区（<b>对话调试 Playground</b> 与 <b>定义详情 · 模型参数调试台</b>）共用同一组消息组件；
    其余 Agents 页面（观测 / 对话记录 / 技能库）的消息渲染按同一口径拼装，不各造一套。
    组件边界与结构口径以 <code>docs/ui/page-specs/agent-def-detail-v2.md</code> §9 为准；
    「是否真的同构」由 <code>scripts/verify-playground-parity.mjs</code> 机检守（A/B 零差异，C/D 差异逐条登记）。
  </div>
</div>
<div class="ad-desktop" style="height:auto;min-height:0;padding:18px 22px;">
  <div class="rm-grid">
    <div class="rm-card">
      <div class="nm"><span class="no">1</span>Turn</div>
      <div class="ds">一问一答组：用户气泡 + 过程卡片 + AI 气泡同组；proc 落 AI 气泡<b>外侧、之前</b>；重试只重跑本轮到答。</div>
      <div class="use">
        <span class="u"><b>Playground</b><span>静态示例轮（代码块轮 / 法条轮）</span></span>
        <span class="u"><b>调试台</b><span>动态渲染（试跑 / 对比运行 / 用例展开）</span></span>
      </div>
    </div>
    <div class="rm-card">
      <div class="nm"><span class="no">2</span>Bubble</div>
      <div class="ds">头像 + 气泡 + 气泡内顶部 meta（来源标签 src-tag + 定义名 + 生效参数 / 耗时）；用户气泡灰底主文本（AA）。</div>
      <div class="use">
        <span class="u"><b>Playground</b><span>「基于工具 / AI 直答」两档</span></span>
        <span class="u"><b>调试台</b><span>同结构 + 失败态（.err）与 loading（typing）槽位</span></span>
      </div>
    </div>
    <div class="rm-card">
      <div class="nm"><span class="no">3</span>AnswerBlocks</div>
      <div class="ds">回答按块渲染：p / p.lead / h4 / ol / codeblk（深色）/ law / think；解析走 @web-system/agent-message 的 parseAnswer，禁止 &lt;br&gt; 拼串。</div>
      <div class="use">
        <span class="u"><b>Playground</b><span>静态 blocks 示例</span></span>
        <span class="u"><b>调试台</b><span>参数驱动的可变 blocks（think / 截断提示 / 越界提示）</span></span>
      </div>
    </div>
    <div class="rm-card">
      <div class="nm"><span class="no">4</span>ProcCard</div>
      <div class="ds">工具调用过程卡片：工具名 + step/耗时 + 请求体；同一轮只保留一个，重跑先移除旧的。</div>
      <div class="use">
        <span class="u"><b>Playground</b><span>web-search 示例卡</span></span>
        <span class="u"><b>调试台</b><span>按定义各自调用的工具（financial-data / doc-search / repo-diff）</span></span>
      </div>
    </div>
  </div>
  <div class="rm-form">
    <div class="t">表单与列表侧复用件</div>
    <div class="ds">
      label 左置栅格 <code>.frow/.fitem/.flb/.fld/.fhint</code>（每字段一行，hint 一行短句）·
      字段级 diff badge（hint 行右侧）· 未保存变更条 + 内联 diff 表（不弹窗）·
      参数摘要 chip（列表列 / 生效参数条同款）· 分段单选 .seg（选中态灰底主文本，不过 AA 不上白字橙）·
      用例双列「基线 vs 当前」+ 差异摘要行。
    </div>
  </div>
  <div class="rm-gate">
    复用门禁：任何一页新对话区必须先用 <code>node scripts/verify-playground-parity.mjs</code> 对拍，
    A（整轮骨架）/ B（block 内部）零差异才允许落码；C（CSS）/ D（类名）差异必须逐条登记理由。
  </div>
</div>
</div>`;

/* hub 路由表 / 面包屑：由 NAV 生成（route 与 router/index.ts 的真实 path 同构） */
const reLit = (r) => r.replace(/[/]/g, '\\/');
const ROUTE_JS = [
  `    { re: /^#\\/agents\\/definitions\\/([\\w-]+)$/, screen: 'detail' },`,
/* 采集明细「明细详情」：真实 router 是 #/content/items/:id，但整合稿里详情是模块内部的子页
   （同一个 hub 屏 content-items 内切换）→ 路由收敛到父屏，由模块自己定位到详情子页 */
`    { re: /^#\\/content\\/items\\/([\\w-]+)$/, screen: 'content-items' },`,
  ...NAV.filter((m) => m.screen).map((m) => `    { re: /^${reLit(m.route)}$/, screen: '${m.screen}' },`),
].join('\n');
const crumbHtml = (parts) => parts.map((p, i) => (i === parts.length - 1 ? `<b>${p}</b>` : p)).join(' / ');
/* ⚠️ key 必须加引号：屏名带连字符（content-overview…），裸写是语法错误 */
const CRUMB_JS = NAV.filter((m) => m.screen)
  .map((m) => `    '${m.screen}': '${crumbHtml(m.crumb)}',`).join('\n');

/* ---------- 8. 拼装 ---------- */
/* 屏顺序 = 菜单顺序（真实屏 pg / list 嵌在其中）；detail 无菜单项，紧跟 list 之后 */
/* 共享源：每屏 = 作用域容器 + 自己那个 host（DOM 由模块稿的 JS 渲染进去） */
const sharedBody = {};
for (const s of SOURCES) {
  if (!s.shared) continue;
  for (const sc of s.screens) {
    sharedBody[sc] = `      <div class="${s.wrap || 'cc-scope'}">\n        ${s.hosts[sc]}\n      </div>`;
  }
}
/**
 * mount 源（自媒体运营）：**一份 DOM 服务多屏**，DOM 不拆。
 *   · 整块（含模块级弹层）挂在**第一屏**里，容器带 data-zm-module；
 *   · 其余屏留空壳 —— 切过去时由 hub 的 showHub 把这个节点 appendChild 搬过去，
 *     再调源稿自己的 go(根键) 切到对应子页。
 * 为什么不做构建期拆分：模块内部的子页之间有跨根键跳转（明细详情 →「去公众号成文」），
 * 拆开后目标 section 在别的屏里、被 hub 隐藏，点了什么也不会发生。
 */
const mountBody = {};
const MOUNT_MAP = {};      // hub 屏 → 模块根键
for (const s of SOURCES) {
  if (!s.mount) continue;
  Object.keys(s.mount.screens).forEach((sc, i) => {
    MOUNT_MAP[sc] = s.mount.screens[sc];
    mountBody[sc] = i === 0
      ? `      <div class="${s.wrap || 'zm-scope'}" data-zm-module data-zm-file="${s.file}">\n${s.html}\n      </div>`
      : '';
  });
}
const MOUNT_SCREENS = Object.keys(MOUNT_MAP);
/* 图标库 sprite（源稿挂在 body 顶层，不抽就是整稿图标全空）；同一份只注入一次 */
const SPRITES = SOURCES.filter((s) => s.spriteHtml);
if (SPRITES.length > 1) throw new Error('多份源稿带 sprite：当前实现只支持一份，需先做 id 前缀合并');
const SPRITE_HTML = SPRITES.length ? SPRITES[0].spriteHtml : '';

const REAL_BODY = {
  pg: pgScreen, list: listInner,
  ...Object.fromEntries(SOURCES.filter((s) => !s.shared && !s.mount).map((s) => [s.screens[0], s.html])),
  ...sharedBody,
  ...mountBody,
};
/** 有 REAL_BODY 的键（值是空串也是真实屏 —— mount 的后续屏就是空壳） */
const hasReal = (k) => Object.prototype.hasOwnProperty.call(REAL_BODY, k);
const screenBlock = (m) => {
  const body = hasReal(m.screen) ? REAL_BODY[m.screen] : placeholder(m.screen);
  const kind = hasReal(m.screen) ? '真实屏（同源抽取）' : '占位屏';
  /* 注册表抽取来的屏自带页头（源稿的 .st-head / .page-head），不能再叠一层 —— 叠了会出现
     「undefined / undefined」这种空标题（BY_SCREEN 里 source 屏没有 t/d 字段） */
  const head = SOURCE_SCREENS.includes(m.screen) ? '' : pageHead(m.screen);
  return `      <!-- ${kind}：${m.label} -->\n`
    + `      <div class="screen${m.screen === 'overview' ? '' : ' hidden'}" data-screen="${m.screen}">`
    + `${head ? head + '\n' : ''}${body}\n      </div>`;
};
const DETAIL_SCREEN = `      <!-- 真实屏（同源抽取自定稿）：定义详情 · 高级 · 模型参数调试台 —— 无菜单项，经列表「编辑」进入（dt-head 即页头） -->\n`
  /* data-demo-state 必须随容器带进 hub：状态矩阵 CSS 靠 `[data-demo-state="x"] .only-x` 选择器
     命中；stripWrapper 会剥掉源稿 wrapper 上的这个属性，不补 = 默认态规则全部落空 */
  + `      <div class="screen hidden" data-screen="detail" data-demo-state="normal">\n${detailInner}\n      </div>`;
const SCREEN_BLOCKS = NAV.filter((m) => m.screen)
  .map((m) => (m.screen === 'list' ? screenBlock(m) + '\n\n' + DETAIL_SCREEN : screenBlock(m)))
  .join('\n\n');

const hub = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>admin 管理后台 · 菜单级整合稿（菜单对齐真实 admin · 自媒体运营 / 对话调试 / 定义管理 / 定义详情 · 组件复用地图）</title>
<!--
  ============================================================
  admin 管理后台 · 菜单级整合交互稿（build-agents-hub.mjs 生成，请勿手改）
  · 生成源（**由 scripts/lib/proto-registry.mjs 驱动**，每屏一行；本文件不含任何单屏内容）：
            docs/ui/prototypes/admin-agents.html（对话调试，含其专属 CSS）
            docs/ui/prototypes/admin-agent-def-detail.html（定义管理 / 定义详情+调试台）
            docs/ui/prototypes/admin-settings.html（系统设置，同源抽取）
            docs/ui/prototypes/dict-module.html（字典管理，CSS 已作用域隔离 + id 加 dm- 前缀）
            docs/ui/prototypes/admin-media-ops.html（自媒体运营 6 页，mount：一份 DOM 10 个 section）
            其余菜单屏暂无稿 → 占位（批次 / 骨架 / 复用件从注册表读，不伪造业务数据）
  · 菜单源：apps/admin/src/layouts/BasicLayout.vue（文案 / 顺序逐项对齐，无死项）
            路由与 apps/admin/src/router/index.ts 的真实 path 同构
  · 目标端：桌面 Web（admin 管理后台，亮色）；零依赖单文件，浏览器双击即开
  · 路由：hash 路由（#/agents/definitions、#/agents/definitions/<id>…），点菜单即「进入」模块页面
  · 本稿解决的四件事：
    ① 菜单里的页面整合进一份稿：菜单**全部可点**，23 项菜单 + 定义详情共 24 屏均可达；
       **有原型稿的模块直接同源抽取真实内容**（自媒体运营 / 系统设置 / 字典管理 / 对话调试 /
       定义管理 / 定义详情），没有稿的走占位（骨架与复用件已标注，批次可在 specs 里查到出处）；
    ② 菜单与真实 admin 一致：文案/顺序对齐 BasicLayout.vue，由 verify-agents-hub.mjs ⑧ 段对账；
    ③ 复用显性化：页面底部「组件复用地图」钉死 Turn / Bubble / AnswerBlocks / ProcCard
       四件套与表单侧复用件，落地按图施工；
    ④ 一致性可验证：两处对话区 DOM/CSS 由构建脚本从定稿**同源抽取**（不手抄），
       scripts/verify-playground-parity.mjs 对整合稿内两处 + 与原两份文件三方对拍。
  · 变更台账
    · 2026-10-11 · 初版（v1）：菜单级整合 + 组件复用地图 + 占位屏。
      背景：产品意见「原型稿菜单里的页面还没整合进来；帮我设计复用，实现时也好复用；
      确认复用的组件模块是否一样」。
    · 2026-10-11 · v2：① 合入 Playground 专属 CSS（此前只合入新稿 CSS，pg 屏 SVG 无尺寸
      约束撑成 1026px、整屏布局顶翻——「样式完全是乱的」根因）；② hash 路由 + 每屏页头，
      点击菜单即进入模块页面（对齐真实 admin 框架页行为，不再是页内 tab）。
      背景：产品意见「不是导航入口，是 admin 框架页面点击进入对应模块页面；样式完全是乱的」。
    · 2026-10-11 · v3：对话面板统一为「.chatpanel」三段（工具栏 + 消息区 + 输入区），
      对话调试与调试台逐节点同构；parity 扩到 31 项（H 段守外围与运行按钮 computed、T1 守 token）。
      背景：产品意见「Playground 对话区域和参数调测的对话那里不一样，运行按钮不一致」。
    · 2026-10-12 · v6：**整合改为注册表驱动**（「后续不用再整合」）：新增
      scripts/lib/proto-registry.mjs 作为「每屏装什么内容」的单一真相源 —— 写了 source 的屏
      由 build 从原型稿同源抽取（DOM 剥壳 / CSS 作用域隔离 / id 加前缀 / IIFE + inline handler
      命名空间改写），没有 source 的走占位渲染。本次把 admin-settings.html 与 dict-module.html
      两稿真实合入（此前它们只是占位），新增 ⑩ 段断言守「登记了=真合进去了 / 隔离不泄漏 /
      批次与 specs 对账」。以后某模块出稿：注册表加一行 → 重跑本脚本，不需再改本文件。
      背景：产品意见「把菜单占位的原型稿也整合进来吧，后续就不用整合了，迭代也会更精准」。
    · 2026-10-22 · v7：**自媒体运营模块并入**。产品意见「设计出来的原型需要统一融合进 admin 的
      原型稿里，目前是散落的」——该模块此前是 apps/admin/prototype/ 下的一份独立单页稿，
      与整合稿互不相通。本次：① 稿归位 docs/ui/prototypes/admin-media-ops.html；
      ② 注册表新增 mount 源（一份 DOM / 8 个 section / 5 个菜单页，切屏时由 hub 把这些块搬过去，
      而不是拆成 5 份）——因为模块内的二级页之间有跨根键跳转（明细详情 →「去公众号成文」），
      拆开就跳不过去；③ 同步替换旧的「内容中心」5 屏（真实 router 已无 采集总览/龙虎榜/席位库
      三个路由，继续留着就是第二真相源）；④ 注册表补 trails / jsDrop / sprite / cssExtra 四个
      字段（多段弹层 / 丢弃源稿评审台 / 图标库 sprite / 作用域内补基准排版）。
    · 2026-10-11 · v4：**菜单全量对齐真实 admin**（工作台 / 变变管理 / 用户管理 / 系统设置 /
      角色权限 / 字典管理 / MCP 管理 / 数据浏览 + Agents 9 项），去掉全部「.nolink」死项，
      每一项都进入对应模块页面；非 Agents 模块为骨架式占位（登记归属批次与复用口径，
      不伪造业务数据）；路由与真实 router path 同构；新增「菜单 ↔ BasicLayout.vue」对账断言。
      背景：产品意见「红框标注的菜单，还没合入」。
  ============================================================
-->
<style>
  /* ===== 来自 admin-agents.html 的专属规则（新稿没有的块；同名以新稿为准） ===== */
  ${pgOnlyCss}
  /* ===== 新稿（admin-agent-def-detail.html）整块规则，AA 修正版为准 ===== */
${dtStyleInner}
${hubCss}${SOURCE_CSS}${shellCss()}
  /* ===== 源稿补进来的设计系统级 token（只补整合稿缺的；同名以整合稿为准） ===== */
  :root{${GLOBAL_TOKENS.join(';')}}</style>
</head>
<body>
${SPRITE_HTML}
<div class="proto-head">
  <h1>admin 管理后台 · 菜单级整合稿 · 复用组件同构</h1>
  <div class="sub">
    左侧菜单对齐 <code>apps/admin/src/layouts/BasicLayout.vue</code>，<b>逐项一致、无死项</b>。
    <b>整合方式 = 注册表驱动</b>：<code>scripts/lib/proto-registry.mjs</code> 里每屏一行，
    写了 <code>source</code> 的屏由构建脚本从原型稿<b>同源抽取</b>（DOM 剥壳 + CSS 作用域隔离
    + id 前缀 + inline handler 命名空间），没写的走占位。<b>已是真实内容的屏</b>：
    对话调试 / 定义管理 / 定义详情 / <b>自媒体运营 6 页</b>（admin-media-ops.html）/
    <b>系统设置</b>（admin-settings.html）/ <b>字典管理</b>（dict-module.html）；
    其余（工作台 / 变变管理 / 用户管理 / 角色权限 / MCP 管理 / 数据浏览 + Agents 组内若干页）
    为占位，各自标注归属批次与复用口径，不伪造业务数据。
    <b>自媒体运营是「一份 DOM 服务 5 屏」</b>（mount 源）：切菜单时整块搬到当前屏，
    模块内的跨页跳转（明细详情 →「去公众号成文」）会带动左侧菜单与地址栏一起走。
    <b>以后补稿不用再整合</b>：在注册表加一行 <code>source</code>，重跑
    <code>node scripts/build-agents-hub.mjs</code> 即可。
    菜单一致性由 <code>scripts/verify-agents-hub.mjs</code> 直接读 .vue 源对账；参数口径取自
    <code>docs/api/contracts.md</code> §7 C7 与 §7.4。<b>对话区两处同构</b>（对话调试 ⇄ 调试台，
    同一套 Turn / Bubble / AnswerBlocks / ProcCard），复用边界见页面底部「组件复用地图」，
    一致性由 <code>scripts/verify-playground-parity.mjs</code> 机检守。
  </div>
</div>

<div class="ad-desktop">
  ${MENU}

  <div class="ad-main">
    <header class="ad-header">
      ${shellHeaderLeft('<span class="ad-crumb" id="crumb">Agents / <b>Agent 概览</b></span>')}
      ${shellHeaderRight()}
    </header>

    <div class="ad-content">
${SCREEN_BLOCKS}
    </div>

    ${shellFooter()}
  </div>

  ${toastBlock}
${SHARED_TRAILS}
</div>

${REUSE_MAP}

<script>
/* ===== 注册表抽取的源稿脚本（每份 IIFE 包裹；先于其它脚本加载） ===== */
${SOURCE_JS}
</script>
<script>
/* hub 路由（hash 驱动；在新稿 script 之前定义：openDef/goList 改写后写 location.hash） */
(function(){
  var ROUTES = [
${ROUTE_JS}
  ];
  /* 面包屑：由 NAV 生成（非 Agents 模块为模块名本身，Agents 模块为「Agents / 页面名」） */
  var CRUMB = {
${CRUMB_JS}
  };
  var qsa = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };

  /* 二级模块的屏（含 detail：它挂在「定义管理」下）—— 命中则父级 sub-menu 标题高亮 */
  var SUB_SCREENS = ${JSON.stringify([...SUBS.flatMap((s) => s.screens), 'detail'])};
  /* mount 源（自媒体运营）：hub 屏 → 模块根键 */
  var MOUNT_MAP = ${JSON.stringify(MOUNT_MAP)};
  /* hub 屏 → hash 路由（模块内跨根键跳转后要把地址栏同步过来，否则后退键会错位） */
  var MOUNT_ROUTE = ${JSON.stringify(Object.fromEntries(
    MOUNT_SCREENS.map((k) => [k, (NAV.find((m) => m.screen === k) || {}).route || '']),
  ))};
  var curScreen = null;      // 当前 hub 屏（供 zmSync 判断"要不要动"）
  var curMountKey = null;    // 当前模块根键

  /** 菜单高亮 + 父级高亮 + 面包屑（showHub 与 zmSync 共用同一套，避免两处各写一份） */
  function paint(name, id){
    qsa('.ad-item[data-screen]').forEach(function(i){
      i.classList.toggle('active', i.dataset.screen === name || (name === 'detail' && i.dataset.screen === 'list'));
    });
    qsa('.ad-sub').forEach(function(s){
      var list = (s.getAttribute('data-screens') || '').split(',');
      s.classList.toggle('selected', list.indexOf(name) >= 0);
    });
    var crumb = document.getElementById('crumb');
    if(crumb){
      crumb.innerHTML = name === 'detail'
        ? 'Agents / 定义管理 / <b>' + id + '</b>'
        : (CRUMB[name] || '');
    }
  }

  window.showHub = function(name, id){
    /* ⚠️ 必须 .screen[data-screen] —— 注册表抽取进来的模块稿自己也用 .screen 做屏容器
       （admin-media-ops.html 的 8 个 <section class="screen">），裸 .screen 会把它们
       一起 hidden 掉，切过去一片空白。data-screen 是 hub 屏的唯一标记。 */
    qsa('.screen[data-screen]').forEach(function(s){ s.classList.toggle('hidden', s.dataset.screen !== name); });
    paint(name, id);
    var c = document.querySelector('.ad-content');
    if(c) c.scrollTop = 0;
    /* 共享源（内容中心）的屏是 JS 渲染的：切过去后让模块稿自己渲染当前 host */
    if (window.CC && window.CC.apply && document.querySelector('.cc-host[data-cc="' + name + '"]')) {
      window.CC.apply();
    }
    /* mount 源：把模块整块搬到当前屏（DOM 只有一份），再让它切到该屏对应的根键。
       curMountKey 相等时不再调 go() —— 否则从播子页返回列表这类操作会被强行重置。 */
    if (Object.prototype.hasOwnProperty.call(MOUNT_MAP, name)) {
      var mod = document.querySelector('[data-zm-module]');
      var host = document.querySelector('.screen[data-screen="' + name + '"]');
      if (mod && host && mod.parentNode !== host) host.appendChild(mod);
      if (window.ZM && window.ZM.go && curMountKey !== MOUNT_MAP[name]) window.ZM.go(MOUNT_MAP[name]);
      curMountKey = MOUNT_MAP[name];
    }
    curScreen = name;
  };

  /**
   * 模块内部跳转的出口（源稿 go() 末尾调用）：把"模块根键"翻译回"hub 屏"，同步菜单高亮 /
   * 面包屑 / 地址栏。子页（source-edit / item-detail / pipeline-edit）映射到父屏，菜单高亮不掉。
   *
   * 为什么**先记账再改 hash**：改 hash 会触发 hashchange → applyHash → showHub，
   * 而 showHub 在 curMountKey 与目标根键不一致时会调 ZM.go() 把子页重置回列表。
   * 先写 curMountKey 就是告诉 showHub「模块已经在这一根键上了，别再重置」——
   * 这样模块内的子页状态能穿过一次 hash 变更活下来。
   */
  var SUB_TO_ROOT = { 'source-edit': 'content-sources', 'item-detail': 'content-items', 'pipeline-edit': 'content-pipelines' };
  var ROOT_TO_SCREEN = {};
  Object.keys(MOUNT_MAP).forEach(function(sc){ ROOT_TO_SCREEN[MOUNT_MAP[sc]] = sc; });
  window.zmSync = function(key){
    var target = ROOT_TO_SCREEN[key] || SUB_TO_ROOT[key];
    if (!target) return;
    curMountKey = MOUNT_MAP[target];
    var r = MOUNT_ROUTE[target];
    if (r && location.hash !== r) { location.hash = r; }     // → hashchange → showHub（不重置子页）
    else if (target !== curScreen) { window.showHub(target); }
  };

  function applyHash(){
    var h = location.hash || '#/agents';
    for (const r of ROUTES){
      const m = h.match(r.re);
      if (m) { window.showHub(r.screen, m[1]); return; }
    }
    window.showHub('overview');
  }
  window.addEventListener('hashchange', applyHash);

  /* 壳交互（折叠/展开 + 子菜单展开收起 + 折叠态点图标恢复展开）= proto-shell.mjs 单源 */
${shellJs()}
  /* hub 专属：点菜单项 = 写 location.hash 进对应模块页面（壳只负责折叠/展开，路由在 hub 层） */
  document.querySelector('.ad-menu').addEventListener('click', function(e){
    var it = e.target.closest('.ad-item[data-screen]');
    if (it) location.hash = it.dataset.route;
  });
  document.querySelector('.ad-content').addEventListener('click', function(e){
    var go = e.target.closest('[data-act="go-list"]');
    if (go) location.hash = '#/agents/definitions';
  });
  applyHash();   // 初始态：读 URL（默认 #/agents = Agent 概览）
})();
/* 屏① Playground 输入区：与 DT 调试台同一套结构与行为，同源抽自 admin-agents.html */
(function(){
  var $ = function (id) { return document.getElementById(id); };
${pgComposerJs}
})();
</script>
<script>
${js.replace('<script>', '').replace(/<\/script>\s*$/, '')}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT_FILE, hub);

/* ---------- 9. 生成自检（这类 bug 必须当场炸，不能靠人眼） ---------- */
const problems = [];
const out = fs.readFileSync(OUT_FILE, 'utf8');
// ① CSS 流里不得再出现字面 <style>（曾把 :root 规则连带 token 全丢 → 全站 var() 失效）
const styleOpen = (out.match(/<style>/g) || []).length;
if (styleOpen !== 1) problems.push(`<style> 开标签 ${styleOpen} 个（应为 1）——CSS 流被字面标签污染`);
// ② token 必须齐（dt :root 变量数 + pg 补齐量）
const tokenCount = (out.match(/--ws-[\w-]+:/g) || []).length;
if (tokenCount < 50) problems.push(`token 定义仅 ${tokenCount} 个（应 ≥ 50）——:root 规则可能被丢`);
// ③ div 配平（**剥掉 <script>**：合入的模块稿在 JS 字符串里拼 HTML，整段计数会被
//   跨行拼接的片段带偏；要守的是「静态结构」配平，运行时正确性由 verify 的可见性断言守）
const htmlOnly = out.replace(/<script>[\s\S]*?<\/script>/g, '');
const divOpen = (htmlOnly.match(/<div[\s>]/g) || []).length;
const divClose = (htmlOnly.match(/<\/div>/g) || []).length;
if (divOpen !== divClose) problems.push(`div 不配平（剥 script 后）：开 ${divOpen} / 闭 ${divClose}`);
// ④ Playground 专属 CSS 必须合入（SVG 无尺寸约束会撑成 1026px 顶翻整屏）
if (!out.includes('.pg-agent svg{width:var(--ws-icon-inline)')) problems.push('缺少 .pg-agent svg 尺寸规则——Playground 屏会布局爆炸');
// ④b detail 屏状态矩阵 / 警示框 CSS 必须合入（2026-10-28：B3 CSS 误挂壳块尾部被 between() 丢掉
//     → 五个 .only-* 数据态同显 + 警告 SVG 撑爆；这类「整块 CSS 静默丢失」必须当场炸）
[['.only-loading,.only-empty,.only-error,.only-forbidden,.only-misconfig{display:none;}', '状态矩阵基础隐藏组'],
 ['.warn-tool svg{width:18px', '.warn-tool svg 尺寸规则'],
 ['[data-demo-state="normal"] .only-normal', '状态切换规则'],
 ['data-screen="detail" data-demo-state="normal"', 'detail 容器 data-demo-state']].forEach(([tok, why]) => {
  if (!out.includes(tok)) problems.push(`缺少 ${why}（${tok.slice(0, 40)}…）——detail 屏会布局爆炸/状态块同显`);
});
// ④c 模块关键 CSS 条目数不为 0（防「整块 CSS 被过滤掉」的静默丢失）
const KEY_CSS = ['.f-tag{', '.warn-tool{', '.budget-ro{', '.strat{', '.audit-item{', '.state-box{', '.role-fallback{'];
const keyHit = KEY_CSS.filter((k) => out.includes(k)).length;
if (keyHit === 0) problems.push('detail 屏关键 CSS 条目 0 命中——v2.4 整块 CSS 疑似被过滤掉');
else if (keyHit < KEY_CSS.length) problems.push(`detail 屏关键 CSS 仅 ${keyHit}/${KEY_CSS.length} 命中：`
  + KEY_CSS.filter((k) => !out.includes(k)).join(' '));
// ⑤ 两处对话面板必须同构：chatpanel ×2 / pg-toolbar ×2 / composer ×2（含 Playground 屏）
[['class="chatpanel"', 2], ['class="pg-toolbar"', 2], ['class="composer"', 2]].forEach(([tok, n]) => {
  const got = out.split(tok).length - 1;
  if (got < n) problems.push(`对话面板结构缺失：${tok} 仅 ${got} 处（应 ${n}）——两屏对话区不再同构`);
});
if (!out.includes('runOnce')) problems.push('Playground 输入区行为未注入（runOnce 缺失）');
// ⑥b 折叠态隐藏规则必须排在菜单展开规则之后（同特异性靠后序胜出；写前面会让折叠态子菜单漏出）
if (out.indexOf('.ad-sider.collapsed .ad-sub .ad-sub-bd{display:none;}') < out.indexOf('.ad-sub.open .ad-sub-bd{display:block;}')) {
  problems.push('折叠态隐藏规则排在 .ad-sub.open 之前——折叠后子项会漏出来');
}
// ⑥ 25 处 build 后的 DOM 抽取要含 composer（否则 Playground 屏没有输入/运行区）
if (!out.includes('id="pg-run-btn"')) problems.push('Playground 运行按钮未抽入');
// ⑦ 菜单：无死项、每项有唯一路由（「红框菜单还没合入」这类问题的结构性防线）
const menuItems = out.match(/<div class="ad-item(?: ad-item-sub)?"[^>]*>/g) || [];
if (out.includes('class="ad-item nolink"')) problems.push('菜单仍有 .nolink 死项——每一项都必须可点进模块页面');
if (menuItems.length !== MENU_LABELS.length) problems.push(`菜单项 ${menuItems.length} 个（应 ${MENU_LABELS.length}）`);
const routes = menuItems.map((s) => (s.match(/data-route="([^"]+)"/) || [])[1]);
if (routes.some((r) => !r)) problems.push('有菜单项缺 data-route');
if (new Set(routes).size !== routes.length) problems.push('菜单路由重复：' + routes.join(' '));
// ⑦b 菜单**结构**对齐真实 admin：8 个一级项（带图标）+ N 个 sub-menu（图标 + 标题 + 子项无图标）
const subItemTotal = SUBS.reduce((n, s) => n + s.items.length, 0);
const topItems = (out.match(/<div class="ad-item" data-screen=/g) || []).length;
const subItems = (out.match(/<div class="ad-item ad-item-sub"/g) || []).length;
if (topItems !== TOP.length) problems.push(`一级菜单项 ${topItems}（应 ${TOP.length}）——结构脱离 BasicLayout`);
if (subItems !== subItemTotal) problems.push(`二级菜单项 ${subItems}（应 ${subItemTotal}）`);
if ((out.match(/class="ad-sub open"/g) || []).length !== SUBS.length) {
  problems.push(`sub-menu ${(out.match(/class="ad-sub open"/g) || []).length} 个（应 ${SUBS.length}：${SUBS.map((s) => s.title).join(' / ')}）`);
}
const iconCount = (out.match(/<span class="ad-ic">/g) || []).length;
if (iconCount !== TOP.length + SUBS.length) problems.push(`菜单图标 ${iconCount} 个（应一级 ${TOP.length} + sub 标题 ${SUBS.length}）`);
// ⑦c 壳对齐：折叠按钮 / 顶栏右侧（主题 + 用户）/ 页脚
['id="btn-collapse"', 'class="ad-theme"', 'class="ad-user"', 'class="ad-footer"'].forEach((tok) => {
  if (!out.includes(tok)) problems.push(`壳缺 ${tok}——与 BasicLayout.vue 的框架不一致`);
});
const screenCount = (out.match(/<div class="screen[ "]/g) || []).length;
if (screenCount !== MENU_LABELS.length + 1) {
  problems.push(`屏 ${screenCount} 个（应 = 菜单 ${MENU_LABELS.length} + detail 1）——菜单项与页面不再一一对应`);
}
// ⑧ 菜单文案序列必须等于 NAV（防「改了 NAV 忘了重建」或手改菜单）
const outLabels = [...out.matchAll(/<span class="ad-t">([^<]+)<\/span>/g)].map((m) => m[1].trim())
  .filter((l) => !SUBS.some((s) => s.title === l));
if (outLabels.join('|') !== MENU_LABELS.join('|')) {
  problems.push('菜单文案序列与 NAV 不一致：' + outLabels.join(' | '));
}
// ⑨ 每个屏都有面包屑映射（漏了会出现「切过去 crumb 空白」）
const missingCrumb = NAV.filter((m) => m.screen && !new RegExp(`^\\s+'${m.screen}': '`, 'm').test(out));
if (missingCrumb.length) problems.push('CRUMB 缺屏：' + missingCrumb.map((m) => m.screen).join(' '));
// ⑩ 占位屏必须带「范围说明」（不许出现无出处的空屏）
const phCount = (out.match(/class="ph-note note/g) || []).length;
const phExpect = NAV.filter((m) => m.screen && !hasReal(m.screen)).length;
if (phCount !== phExpect) problems.push(`范围说明 ${phCount} 处（占位屏 ${phExpect} 个）——占位屏必须标注归属批次`);
// ⑪ mount 源（自媒体运营）：模块 DOM 必须只有一份，屏映射必须齐全
if (MOUNT_SCREENS.length) {
  const modCount = (out.match(/data-zm-module data-zm-file=/g) || []).length;
  if (modCount !== 1) problems.push(`data-zm-module 出现 ${modCount} 处（应 1）——一份 DOM 服务多屏，复制多份=多套状态机`);
  const missing = MOUNT_SCREENS.filter((sc) => !new RegExp(`data-screen="${sc}"`).test(out));
  if (missing.length) problems.push('mount 屏缺 hub 容器：' + missing.join(' '));
  /* sprite 的 symbol id 必须全局唯一（多份稿各自一套 #i-* 会互相抢） */
  const symIds = [...out.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
  const dup = symIds.filter((id, i) => symIds.indexOf(id) !== i);
  if (dup.length) problems.push('sprite symbol id 重复：' + [...new Set(dup)].join(' '));
  if (!/data-zm-module/.test(out) || !out.includes('<symbol id="i-')) {
    problems.push('自媒体运营模块的 sprite 图标库没注入——图标会全空');
  }
}
if (problems.length) {
  process.stderr.write('❌ 生成自检未过：\n' + problems.map((p) => '  · ' + p).join('\n') + '\n');
  process.exit(1);
}

process.stderr.write('已生成 ' + path.relative(ROOT, OUT_FILE) + '（' + hub.split('\n').length + ' 行）\n');
process.stderr.write('  · CSS：新稿 ' + dtBlocks.length + ' 块 + Playground 专属合入 ' + pgOnlyBlocks.length + ' 块（同名以新稿为准）\n');
process.stderr.write('  · Playground 屏 DOM：' + pgScreen.split('\n').length + ' 行（同源抽取）\n');
process.stderr.write('  · 列表屏 DOM：' + listInner.split('\n').length + ' 行（同源抽取）\n');
process.stderr.write('  · 详情屏 DOM：' + detailInner.split('\n').length + ' 行（同源抽取）\n');
process.stderr.write('  · 菜单：' + MENU_LABELS.length + ' 项（对齐 BasicLayout.vue，无死项）→ 屏 '
  + (MENU_LABELS.length + 1) + ' 个；hash 路由 ' + routes.length + ' 条（与 router/index.ts path 同构）\n');
process.stderr.write('  · script 改写 3 处（openDef / goList / crumb-main）\n');
