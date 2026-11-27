// System.register 子应用入口：chart
import { createApp } from 'vue';
import { aguiBus } from 'agui-bus';
import ChartWidget from './ChartWidget.vue';
import type { WidgetProps } from '@/lib/widget-protocol';
import type { WidgetMountContext, WidgetModuleHandle } from '@/microfrontend/widget-contract';

export function mount(
  container: HTMLElement,
  props: WidgetProps,
  ctx: WidgetMountContext,
): WidgetModuleHandle {
  const app = createApp(ChartWidget, {
    data: props,
    ctx: { ...ctx, bus: ctx.bus ?? aguiBus },
  });
  app.mount(container);
  return { unmount: () => app.unmount() };
}
