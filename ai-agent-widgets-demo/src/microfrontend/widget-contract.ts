// 基座 <-> System.register 子应用 之间的挂载契约（纯类型，构建期被擦除，不产生额外依赖）
import type { AguiEventBus } from '@/lib/agui-event-bus';
import type { WidgetProps } from '@/lib/widget-protocol';

export interface WidgetMountContext {
  /** 基座同一个 EventTarget 实例（不是子应用自己 new 的第二份） */
  bus: AguiEventBus;
  /** 本 slot 的全局唯一 id，回写事件时带上，便于基座定位 */
  slotId: string;
  /** 基座注入的时序日志函数，子应用也能往 LoadTrace 里写步骤 */
  trace: (phase: string, label: string, status?: 'ok' | 'pending' | 'error') => void;
}

export interface WidgetModuleHandle {
  unmount: () => void;
}

export interface WidgetModule {
  /** System.register 产物导出的唯一入口 */
  mount: (
    container: HTMLElement,
    props: WidgetProps,
    ctx: WidgetMountContext,
  ) => WidgetModuleHandle;
}
