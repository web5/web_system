// ----------------------------------------------------------------------------
// 真实微前端加载器：把 markdown 里的 widget 声明，变成运行时按需加载的可交互子应用
// ----------------------------------------------------------------------------
import * as Vue from 'vue';
import { aguiBus } from '@/lib/agui-event-bus';
import {
  isAllowedApp,
  widgetLabelOf,
  widgetModuleOf,
  type WidgetSpec,
} from '@/lib/widget-protocol';
import { System, installSystemGlobal, WIDGET_BASE, type SystemModule } from './system-loader';
import { trace, traceUnmount } from './load-trace';
import type { WidgetModule, WidgetModuleHandle } from './widget-contract';

// 样式沙箱：Shadow DOM 下全局样式无法穿透，用 ?inline 把主题 + widget CSS 注入 shadow root。
import globalCss from '@/styles/global.css?inline';
import markdownCss from '@/styles/markdown.css?inline';
import widgetCss from '@/styles/widgets.css?inline';

// —— 基座种子：vue / aguiBus 都由基座提供，子应用 external 后拿到的就是这一份 ——
System.set('vue', Vue as unknown as SystemModule);
System.set('agui-bus', { aguiBus } as unknown as SystemModule);
installSystemGlobal();

export interface WidgetHandle {
  slotId: string;
  spec: WidgetSpec;
  container: HTMLElement;
  module: WidgetModule;
  child: WidgetModuleHandle;
  /** 幂等销毁：可被 WidgetSlot.onUnmounted 与 unmountAllWidgets 重复调用 */
  dispose: () => void;
}

/** slotId -> handle，防重复挂载，也是「无泄漏」的清点依据。 */
const handles = new Map<string, WidgetHandle>();

/** Shadow DOM 样式注入（?inline 文本，不依赖外部 CSS 文件，沙箱内样式不丢）。 */
function injectSandboxStyles(container: HTMLElement): void {
  const root = container.getRootNode();
  if (root instanceof ShadowRoot) {
    const style = document.createElement('style');
    style.setAttribute('data-mf-style', 'widget-theme');
    style.textContent = globalCss + '\n' + markdownCss + '\n' + widgetCss;
    root.appendChild(style);
  }
}

/**
 * 挂载一个 widget。
 * 完整时序（每一步都写进 LoadTrace）：
 *   检测 widget 声明 → 白名单校验 → System.import → register → 共享 vue 注入 → mount → ready
 */
export async function mountWidget(
  container: HTMLElement,
  spec: WidgetSpec,
  slotId: string,
): Promise<WidgetHandle> {
  // 防重复挂载：同一 slotId 已有 handle 就直接复用
  const existing = handles.get(slotId);
  if (existing) return existing;

  trace(slotId, spec.app, 'detect', `检测到 \`\`\`widget 声明：${widgetLabelOf(spec.app)}`);

  // 二次白名单校验（parseWidgetSpec 已校验过一次；这里是加载前的最终防线）
  if (!isAllowedApp(spec.app)) {
    trace(slotId, spec.app, 'whitelist', 'app 不在白名单，拒绝动态 import', 'error');
    throw new Error(`widget app 不在白名单：${spec.app}`);
  }
  const moduleId = widgetModuleOf(spec.app);
  trace(slotId, spec.app, 'whitelist', `白名单通过 → ${moduleId}（拒绝任意 URL import）`);

  trace(slotId, spec.app, 'import', `System.import('${moduleId}') → fetch ${WIDGET_BASE}/${spec.app}.system.js`, 'pending');
  const ns = await System.import(moduleId);
  const def = System.definitionOf(moduleId);
  trace(slotId, spec.app, 'import', '产物已 fetch 并求值', 'ok');
  trace(
    slotId,
    spec.app,
    'register',
    `System.register 已捕获，deps = [${(def?.deps ?? []).join(', ')}]`,
  );
  trace(
    slotId,
    spec.app,
    'vue',
    "setters 命中基座 System.set('vue') / System.set('agui-bus') 单例（未打包第二份 vue）",
  );

  const module = ns as unknown as WidgetModule;
  if (typeof module.mount !== 'function') {
    throw new Error(`${moduleId} 未导出 mount()`);
  }

  injectSandboxStyles(container);
  trace(slotId, spec.app, 'mount', 'Shadow DOM 样式注入 + 调用 module.mount(container, props, ctx)', 'pending');
  const child = module.mount(container, spec.props, {
    bus: aguiBus,
    slotId,
    trace: (phase, label, status) => trace(slotId, spec.app, phase, label, status),
  });

  const handle: WidgetHandle = {
    slotId,
    spec,
    container,
    module,
    child,
    dispose: () => {
      // 幂等：先从 Map 删除，再执行真正的销毁
      if (!handles.has(slotId)) return;
      handles.delete(slotId);
      try {
        child.unmount?.();
      } catch (e) {
        trace(slotId, spec.app, 'unmount', `子应用 unmount 异常：${String(e)}`, 'error');
      }
      traceUnmount(slotId, spec.app);
      container.replaceChildren();
    },
  };
  handles.set(slotId, handle);
  trace(slotId, spec.app, 'ready', '✅ 子应用已挂载，可点击交互');
  return handle;
}

export function unmountWidget(handleOrSlotId: WidgetHandle | string): void {
  const slotId = typeof handleOrSlotId === 'string' ? handleOrSlotId : handleOrSlotId.slotId;
  const handle = handles.get(slotId);
  if (!handle) return; // 幂等：Vue onUnmounted 与显式清理可能先后触发
  handle.dispose();
}

/** 基座级清理：切换 / 组件卸载时调用，确保无残留 handle。 */
export function unmountAllWidgets(): void {
  for (const slotId of Array.from(handles.keys())) unmountWidget(slotId);
}

/**
 * 清理「孤儿 handle」：DOM 节点已不在 document 上但 handle 仍在 Map 里。
 * 每轮 start() 调一次，作为 Vue 生命周期之外的兜底，保证重跑无泄漏。
 */
export function releaseDisconnectedHandles(): void {
  for (const [slotId, handle] of Array.from(handles.entries())) {
    if (!handle.container.isConnected) unmountWidget(slotId);
  }
}

export function activeWidgetCount(): number {
  return handles.size;
}
