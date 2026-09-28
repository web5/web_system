#!/usr/bin/env node
/**
 * CDN 按需子集的**运行时**校验（不是体积检查）。
 *
 * 为什么需要它：antd/icons 改成「扫描源码生成子集」后，漏掉一个组件/图标不会构建报错，
 * 只会在浏览器里表现为「组件渲染不出来 / 图标空白」——纯静态检查抓不到。
 * 这里在 jsdom 里真的加载 UMD、挂载一个 Vue app 渲染各类 antd 组件，验证：
 *   ① 必需导出齐全  ② message/Modal 等静态方法可用  ③ 模块 import 的图标存在
 *   ④ 组件能渲染出 ant-* 类名  ⑤ cssinjs 注入了 style 标签  ⑥ 无 "Failed to resolve component"
 *
 * 用法（cwd = 仓库根）：
 *   node scripts/verify-cdn-subsets.cjs
 *   node scripts/verify-cdn-subsets.cjs /path/to/cdn
 *
 * 前置：先 `node scripts/build-externals.mjs` 产出 CDN 目录。
 */
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const REPO_ROOT = process.cwd();
const CDN = process.argv[2] || path.join(REPO_ROOT, 'servers/gateway/public/static/cdn');

// 从 workspace 子应用解析（pnpm 只在声明方下软链）
const adminReq = createRequire(path.join(REPO_ROOT, 'apps/admin/package.json'));
const rootReq = createRequire(path.join(REPO_ROOT, 'package.json'));
function req(mod) {
  try { return adminReq(mod); } catch { return rootReq(mod); }
}

const { JSDOM } = req('jsdom');

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.HTMLElement = window.HTMLElement;
global.Element = window.Element;
global.Node = window.Node;
global.SVGElement = window.SVGElement;
global.ShadowRoot = window.ShadowRoot || function ShadowRoot() {};
global.getComputedStyle = window.getComputedStyle.bind(window);
global.MutationObserver = window.MutationObserver;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = clearTimeout;
global.matchMedia = window.matchMedia = () => ({
  matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
});
// ⚠️ vue 必须在 jsdom 全局注入**之后**才 require：runtime-dom 在模块初始化时快照 document，
//    顺序反了会拿到 null，挂载时报 "Cannot read properties of null (reading 'createTextNode')"。
const Vue = adminReq('vue');
const dayjs = adminReq('dayjs');
window.Vue = Vue;
window.dayjs = dayjs;

// 依赖顺序与 apps/shell/index.html 一致：vue → dayjs → antd → icons
function loadScript(file) {
  const file_ = path.join(CDN, file);
  if (!fs.existsSync(file_)) fail.push(`CDN 缺文件: ${file}`);
  const code = fs.readFileSync(file_, 'utf-8');
  // UMD 在 CJS 环境会走 exports 分支；这里强制走浏览器分支（注入 window 全局）
  const fn = new Function('window', 'document', 'self', 'globalThis', 'Vue', 'dayjs', `${code}\n;return window;`);
  return fn(window, window.document, window, window, Vue, dayjs);
}

const ok = [];
const fail = [];

/** 源码实际用到的顶层组件（与 scripts/build-subset-externals.mjs 的扫描结果对齐） */
const REQUIRED_COMPONENTS = [
  'Button', 'Card', 'ConfigProvider', 'Form', 'Input', 'Table', 'Select', 'Modal', 'Menu', 'Layout',
  'Tabs', 'Tag', 'Alert', 'Avatar', 'Badge', 'Breadcrumb', 'Checkbox', 'Col', 'Row', 'DatePicker',
  'Descriptions', 'Divider', 'Drawer', 'Dropdown', 'Empty', 'InputNumber', 'PageHeader', 'Popconfirm',
  'Radio', 'Result', 'Slider', 'Space', 'Spin', 'Statistic', 'Switch', 'Timeline', 'Tooltip',
  'Typography', 'Upload', 'App', 'message', 'theme',
];

/** 模块 import 的图标（子集漏一个就是运行时空白） */
const REQUIRED_ICONS = [
  'ApiOutlined', 'DashboardOutlined', 'SettingOutlined', 'UserOutlined', 'LockOutlined', 'PlusOutlined',
  'DeleteOutlined', 'EditOutlined', 'SearchOutlined', 'ReloadOutlined', 'MenuFoldOutlined',
  'MenuUnfoldOutlined', 'WechatOutlined', 'ThunderboltOutlined', 'RobotOutlined', 'HomeOutlined',
];

loadScript('antd.js');
loadScript('icons.js');

const antd = window.antd;
const icons = window.antdIcons;

if (!antd) fail.push('window.antd 未挂载');
if (!icons) fail.push('window.antdIcons 未挂载');

for (const k of REQUIRED_COMPONENTS) (antd && antd[k] ? ok : fail).push(`antd.${k}`);

// 静态方法 / install：module 用 app.use(comp) 注册，缺 install 就注册不上
const statics = [
  ['message.success', () => typeof antd.message.success === 'function'],
  ['message.error', () => typeof antd.message.error === 'function'],
  ['message.config', () => typeof antd.message.config === 'function'],
  ['Modal.confirm', () => typeof antd.Modal.confirm === 'function'],
  ['Modal.info', () => typeof antd.Modal.info === 'function'],
  ['theme.defaultAlgorithm', () => !!antd.theme.defaultAlgorithm],
  ['theme.darkAlgorithm', () => !!antd.theme.darkAlgorithm],
  ['Button.install', () => typeof antd.Button.install === 'function'],
  ['Table.install', () => typeof antd.Table.install === 'function'],
  ['Form.install', () => typeof antd.Form.install === 'function'],
  ['Layout.install', () => typeof antd.Layout.install === 'function'],
  ['Menu.install', () => typeof antd.Menu.install === 'function'],
  ['Typography.install', () => typeof antd.Typography.install === 'function'],
  ['DatePicker.install', () => typeof antd.DatePicker.install === 'function'],
];
for (const [name, fn] of statics) {
  let pass = false;
  try { pass = fn(); } catch { pass = false; }
  (pass ? ok : fail).push(name);
}

for (const k of REQUIRED_ICONS) (icons && icons[k] ? ok : fail).push(`icon:${k}`);

// 真挂载渲染：验证组件可用 + cssinjs 样式注入
const warnings = [];
const app = Vue.createApp({
  template: `<a-config-provider><div>
    <a-button type="primary">{{ msg }}</a-button>
    <a-table :columns="cols" :data-source="rows" :pagination="false" />
    <a-select :options="[{value:1,label:'a'}]" />
    <a-tag>tag</a-tag><a-alert message="alert" /><a-typography-text>t</a-typography-text>
    <a-input /><a-form><a-form-item><a-input /></a-form-item></a-form>
    <a-menu><a-menu-item key="1">m</a-menu-item></a-menu>
    <a-layout><a-layout-header>h</a-layout-header><a-layout-content>c</a-layout-content></a-layout>
    <a-spin /><a-empty /><a-modal v-model:open="open" title="t" />
    <PlusOutlined />
  </div></a-config-provider>`,
  data: () => ({ msg: 'hello', open: false, cols: [{ title: 'A', dataIndex: 'a' }], rows: [{ a: 1 }] }),
  components: { PlusOutlined: icons.PlusOutlined },
});
Object.values(antd).forEach((c) => { if (c && typeof c.install === 'function') app.use(c); });
app.config.warnHandler = (msg) => warnings.push(msg);
app.mount(document.getElementById('app'));
const html = document.getElementById('app').innerHTML;

const rendered = [
  ['render:button', /ant-btn/.test(html)],
  ['render:table', /ant-table/.test(html)],
  ['render:select', /ant-select/.test(html)],
  ['render:tag', /ant-tag/.test(html)],
  ['render:alert', /ant-alert/.test(html)],
  ['render:typography', /ant-typography/.test(html)],
  ['render:menu', /ant-menu/.test(html)],
  ['render:layout', /ant-layout/.test(html)],
  ['render:icon(svg)', /<svg|anticon/.test(html)],
  ['render:button 文本', /hello/.test(html)],
];
for (const [name, pass] of rendered) (pass ? ok : fail).push(name);

const styleTags = document.querySelectorAll('style').length;
(styleTags > 0 ? ok : fail).push(`cssinjs 注入 style(${styleTags})`);

const resolveWarnings = warnings.filter((w) => /Failed to resolve component/.test(w));
if (resolveWarnings.length) fail.push('未解析组件: ' + resolveWarnings.slice(0, 5).join(' | '));

// 体积账（子集的核心目的）
function gz(f) {
  const { gzipSync } = require('zlib');
  return gzipSync(fs.readFileSync(path.join(CDN, f))).length;
}
console.log(`[verify-cdn-subsets] antd.js gzip=${(gz('antd.js') / 1024).toFixed(0)}KB  icons.js gzip=${(gz('icons.js') / 1024).toFixed(0)}KB`);
console.log(`[verify-cdn-subsets] 通过 ${ok.length} 项`);
if (fail.length) {
  console.error('[verify-cdn-subsets] ❌ 失败项：');
  fail.forEach((f) => console.error('   - ' + f));
  process.exit(1);
}
console.log('[verify-cdn-subsets] ✅ antd/icons 子集运行时校验全部通过');
