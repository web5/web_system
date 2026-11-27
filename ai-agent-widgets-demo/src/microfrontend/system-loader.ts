// ----------------------------------------------------------------------------
// 精简但真实的 System.register 运行时（不引 systemjs npm 包，零新增依赖）
// ----------------------------------------------------------------------------
// 支持 rollup / Vite `formats: ['system']` 产出的标准格式：
//
//   System.register(['vue', 'agui-bus'], function (exports, module) {
//     return {
//       setters: [function (m) { createApp = m.createApp; }, ...],
//       execute: function () { exports('mount', mount); ... }
//     };
//   });
//
// 关键点：
//   * System.set('vue', Vue) —— 基座把**自己的** vue 命名空间注册成 System 模块，
//     子应用 external:['vue'] 后通过 setter 拿到同一份，绝不打包第二份 Vue。
//   * System.set('agui-bus', { aguiBus }) —— 同一招透传全局 EventTarget 单例。
//   * System.import('mf-widgets/poll') —— 按 app 名**运行时按需** fetch + eval + 实例化，
//     而不是编译期静态 import 一个本地组件。
//   * 模块实例按 URL 缓存，重复挂载同一 app 不会重复下载 / 重复执行 execute。
// ----------------------------------------------------------------------------

import { WIDGET_NAMESPACE } from '../lib/widget-protocol';

/**
 * widget 产物的 URL base（真实 fetch 路径前缀）。
 * 默认 `/${WIDGET_NAMESPACE}`（= `/mf-widgets`，与白名单逻辑命名空间同源），
 * 可用 VITE_WIDGET_BASE 覆写：里程碑二把产物挂到 gateway / CDN 时只改这一处。
 * 去掉尾部斜杠，保证 `${WIDGET_BASE}/${app}.system.js` 不出现双斜杠。
 */
export const WIDGET_BASE = (import.meta.env.VITE_WIDGET_BASE || `/${WIDGET_NAMESPACE}`).replace(
  /\/+$/,
  '',
);

export type SystemModule = Record<string, unknown>;

export type ExportFn = (name: string, value: unknown) => void;

export interface Declaration {
  setters?: Array<((module: SystemModule) => void) | undefined>;
  execute?: () => void;
}

export type Declare = (
  exportFn: ExportFn,
  context: { id: string; import: (id: string) => Promise<SystemModule> },
) => Declaration | void;

export interface Registration {
  deps: string[];
  declare: Declare;
}

const seeds = new Map<string, SystemModule>();
const definitions = new Map<string, Registration>();
const instances = new Map<string, SystemModule>();
const inflight = new Map<string, Promise<SystemModule>>();
let pendingRegistration: Registration | null = null;

/** 取出并清空最近一次 System.register 调用（函数返回，避免 TS 控制流把它窄化成 null）。 */
function consumeRegistration(): Registration | null {
  const r = pendingRegistration;
  pendingRegistration = null;
  return r;
}

/** 白名单 module id 匹配式：与 widget-protocol.ts 的 WIDGET_NAMESPACE 同源。 */
const WIDGET_ID_RE = new RegExp(`^${WIDGET_NAMESPACE}/([A-Za-z0-9_-]+)$`);

/** 把 app 名解析为可 fetch 的 URL；禁止从 markdown 传入任意 URL。 */
function resolve(id: string): string {
  if (/^https?:\/\//.test(id)) return id; // 仅基座内部可用；widget 声明永远不传 URL
  if (id.startsWith('/') || id.startsWith('./') || id.startsWith('../')) return id;
  const m = WIDGET_ID_RE.exec(id);
  if (m) return `${WIDGET_BASE}/${m[1]}.system.js`;
  return id; // 'vue' / 'agui-bus' 等种子名
}

async function instantiate(url: string): Promise<SystemModule> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`System.import('${url}') 失败：HTTP ${res.status}`);
  const code = await res.text();

  // 以参数形式把 System 注入 eval 作用域，不污染 window，也不需要全局 <script>。
  consumeRegistration(); // 清空上一次残留
  // eslint-disable-next-line no-new-func
  new Function('System', `"use strict";\n${code}`)(System);
  const reg = consumeRegistration();
  if (!reg) throw new Error(`${url} 不是 System.register 模块（未捕获 register 调用）`);
  definitions.set(url, reg);

  const depNamespaces = await Promise.all(reg.deps.map((dep) => System.import(dep)));

  const exports: SystemModule = {};
  const exportFn: ExportFn = (name, value) => {
    exports[name] = value;
  };
  const declared = reg.declare(exportFn, { id: url, import: System.import });
  if (declared?.setters) {
    declared.setters.forEach((setter, i) => {
      if (setter) setter(depNamespaces[i] ?? {});
    });
  }
  declared?.execute?.();
  return exports;
}

export const System = {
  /** 供 eval 出来的产物调用。 */
  register(deps: string[], declare: Declare): void {
    pendingRegistration = { deps, declare };
  },

  /** 基座种子：注册共享单例（vue / agui-bus）。 */
  set(id: string, namespace: SystemModule): void {
    seeds.set(id, namespace);
    instances.set(id, namespace);
  },

  hasSeed(id: string): boolean {
    return seeds.has(id);
  },

  resolve,

  /** 已捕获的 System.register 定义（供 LoadTrace 展示真实的 deps 列表）。 */
  definitionOf(id: string): Registration | undefined {
    return definitions.get(resolve(id));
  },

  async import(id: string): Promise<SystemModule> {
    if (seeds.has(id)) return seeds.get(id)!;
    const url = resolve(id);
    if (instances.has(url)) return instances.get(url)!;
    if (inflight.has(url)) return inflight.get(url)!;

    const task = instantiate(url)
      .then((ns) => {
        instances.set(url, ns);
        return ns;
      })
      .finally(() => inflight.delete(url));
    inflight.set(url, task);
    return task;
  },
};

/** 便于调试：挂到 window，控制台可直接 System.import('mf-widgets/poll')。 */
export function installSystemGlobal(): void {
  (window as unknown as { System: typeof System }).System = System;
}
