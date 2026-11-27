// 「本地 CDN 种子」的 TS 侧真身：子应用以 external 名 'agui-bus' 引用，
// 构建产物里变成 System.register(['vue','agui-bus'], ...)，运行时由基座
// System.set('agui-bus', { aguiBus }) 注入同一个 EventTarget 实例。
export { aguiBus } from '@/lib/agui-event-bus';
export type { AguiEventBus } from '@/lib/agui-event-bus';
