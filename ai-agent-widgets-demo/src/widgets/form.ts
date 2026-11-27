// System.register 子应用入口：form
import { createApp } from 'vue';
import { aguiBus } from 'agui-bus';
import FormWidget from './FormWidget.vue';
import type { WidgetProps } from '@/lib/widget-protocol';
import type { WidgetMountContext, WidgetModuleHandle } from '@/microfrontend/widget-contract';

export function mount(
  container: HTMLElement,
  props: WidgetProps,
  ctx: WidgetMountContext,
): WidgetModuleHandle {
  const app = createApp(FormWidget, {
    data: props,
    ctx: { ...ctx, bus: ctx.bus ?? aguiBus },
  });
  app.mount(container);
  return { unmount: () => app.unmount() };
}
