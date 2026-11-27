// System.register 子应用入口：poll
// 构建：node scripts/build-widgets.mjs → public/mf-widgets/poll.system.js
// 依赖：vue / agui-bus 均为 external，由基座 System.set() 注入单例。
import { createApp } from 'vue';
import { aguiBus } from 'agui-bus';
import PollWidget from './PollWidget.vue';
import type { WidgetProps } from '@/lib/widget-protocol';
import type { WidgetMountContext, WidgetModuleHandle } from '@/microfrontend/widget-contract';

export function mount(
  container: HTMLElement,
  props: WidgetProps,
  ctx: WidgetMountContext,
): WidgetModuleHandle {
  const app = createApp(PollWidget, {
    data: props,
    ctx: { ...ctx, bus: ctx.bus ?? aguiBus },
  });
  app.mount(container);
  return { unmount: () => app.unmount() };
}
