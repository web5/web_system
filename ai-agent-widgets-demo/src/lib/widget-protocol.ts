// ----------------------------------------------------------------------------
// markdown 内嵌可交互微前端：协议层（纯函数，无 DOM / 无 Vue，可单测）
// ----------------------------------------------------------------------------
//
// 语法（流式友好：一个自定义 fence 就是一个完整的 widget 声明）：
//
//   ```widget
//   {"app":"poll","props":{"question":"选一个实现方案","options":["自研","引库","换SDK"]}}
//   ```
//
// 安全约定：
//   1) app 必须命中白名单，markdown 里禁止出现任意 URL 被动态 import（防 prompt injection）；
//   2) props 绝不直接拼进 innerHTML，统一 base64(UTF-8) 编码后放进 data-props 属性；
//   3) props 只允许 JSON 原始值 / 数组 / 纯对象，剔除原型污染键。
// ----------------------------------------------------------------------------

/**
 * widget 逻辑模块命名空间（白名单 module id 前缀）。
 * 这些 id 是**逻辑名**，经 system-loader 的 resolve() 映射到真实 URL
 * `<WIDGET_BASE>/<app>.system.js`；WIDGET_BASE 默认 `/${WIDGET_NAMESPACE}`，
 * 可由 VITE_WIDGET_BASE 覆写（里程碑二接入外部子应用 / CDN），见 system-loader.ts。
 * 逻辑名与 URL 解耦：改 VITE_WIDGET_BASE 不需要动白名单，markdown 里也不出现任意 URL。
 */
export const WIDGET_NAMESPACE = 'mf-widgets';

/** 已注册的子应用白名单：app 名 -> System 模块 id + 展示名。 */
export const WIDGET_REGISTRY = {
  poll: { module: `${WIDGET_NAMESPACE}/poll`, label: '投票组件' },
  chart: { module: `${WIDGET_NAMESPACE}/chart`, label: '柱状图组件' },
  form: { module: `${WIDGET_NAMESPACE}/form`, label: '表单组件' },
} as const;

export type WidgetApp = keyof typeof WIDGET_REGISTRY;

export type WidgetProps = Record<string, unknown>;

/** 一个已校验通过的 widget 声明。raw 保留原始 JSON 文本，便于日志/复现。 */
export interface WidgetSpec {
  app: WidgetApp;
  props: WidgetProps;
  raw: string;
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 只允许 JSON 数据形状，函数 / undefined / Symbol 一律剔除。 */
function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value as number) ? value : null;
  }
  if (typeof value === 'string') return value;
  if (depth > 6) return null; // 防超深结构
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      const clean = sanitizeValue(v, depth + 1);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return null;
}

export function isAllowedApp(app: unknown): app is WidgetApp {
  return typeof app === 'string' && Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, app);
}

/**
 * 解析一段 widget fence 的 JSON。
 * 内容不完整 / JSON 非法 / app 不在白名单 / props 不是对象 -> 返回 null（绝不抛错）。
 * 流式过程中半截 JSON 会走到这里，调用方据此渲染「⏳ 组件加载中…」占位。
 */
export function parseWidgetSpec(raw: string): WidgetSpec | null {
  if (!raw || typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (!isAllowedApp(obj.app)) return null;
  let props: WidgetProps = {};
  if (obj.props !== undefined) {
    if (!obj.props || typeof obj.props !== 'object' || Array.isArray(obj.props)) return null;
    props = sanitizeValue(obj.props) as WidgetProps;
  }
  return { app: obj.app, props, raw };
}

export function widgetModuleOf(app: WidgetApp): string {
  return WIDGET_REGISTRY[app].module;
}

export function widgetLabelOf(app: WidgetApp): string {
  return WIDGET_REGISTRY[app].label;
}

// ----------------------------------------------------------------------------
// 属性编码：props -> base64(UTF-8 JSON)，app -> HTML 转义
// ----------------------------------------------------------------------------

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** base64 编码（浏览器 + Node 双端可用，支持中文 UTF-8）。 */
export function encodeProps(props: WidgetProps): string {
  const json = JSON.stringify(props);
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  // Node（vitest）环境
  return Buffer.from(json, 'utf8').toString('base64');
}

export function decodeProps(encoded: string): WidgetProps {
  try {
    let json: string;
    if (typeof atob === 'function') {
      const bin = atob(encoded);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      json = new TextDecoder().decode(bytes);
    } else {
      json = Buffer.from(encoded, 'base64').toString('utf8');
    }
    const parsed = JSON.parse(json) as unknown;
    return (sanitizeValue(parsed) ?? {}) as WidgetProps;
  } catch {
    return {};
  }
}

/** markdown-it 插件与 Vue 组件共用同一套挂载点属性，保证协议一致。 */
export function slotAttributes(spec: WidgetSpec): { app: string; props: string } {
  return { app: escapeHtmlAttr(spec.app), props: escapeHtmlAttr(encodeProps(spec.props)) };
}

/** 占位 HTML：widget 内容不完整 / JSON 解析失败 / 白名单不通过时输出，绝不抛错。 */
export const WIDGET_PENDING_HTML =
  '<div class="mf-slot mf-slot--pending">⏳ 组件加载中…</div>';

/** 完整 widget 挂载点 HTML（静态渲染路径，例如 markdown-it 直接渲染整篇文档）。 */
export function slotHtml(spec: WidgetSpec, slotId = ''): string {
  const { app, props } = slotAttributes(spec);
  const id = escapeHtmlAttr(slotId);
  return `<div class="mf-slot" data-app="${app}" data-props="${props}" data-slot-id="${id}"></div>`;
}
