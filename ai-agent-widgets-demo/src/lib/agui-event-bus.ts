import type { AguiEventMap } from './agui-types';

type Listener<T> = (detail: T) => void;

/**
 * 跨模块事件桥：基于原生 EventTarget 的全局单例。
 * - 不依赖 qiankun / single-spa，System.register 裸跑也通用；
 * - 基座与子应用都订阅同一个实例，跨模块通信不碰 Vue 响应式；
 * - on() 返回 unsubscribe，便于子应用卸载时精确解绑，避免泄漏。
 */
export class AguiEventBus {
  private target = new EventTarget();
  private registry = new WeakMap<Listener<unknown>, EventListener>();

  emit<K extends keyof AguiEventMap>(type: K, detail: AguiEventMap[K]): void {
    this.target.dispatchEvent(new CustomEvent(String(type), { detail }));
  }

  on<K extends keyof AguiEventMap>(
    type: K,
    fn: Listener<AguiEventMap[K]>,
  ): () => void {
    const handler: EventListener = (e: Event) => {
      fn((e as CustomEvent<AguiEventMap[K]>).detail);
    };
    this.target.addEventListener(String(type), handler);
    this.registry.set(fn as Listener<unknown>, handler);
    return () => this.off(type, fn);
  }

  off<K extends keyof AguiEventMap>(type: K, fn: Listener<AguiEventMap[K]>): void {
    const handler = this.registry.get(fn as Listener<unknown>);
    if (handler) {
      this.target.removeEventListener(String(type), handler);
      this.registry.delete(fn as Listener<unknown>);
    }
  }

  /** 仅供「整个总线生命周期结束」时调用（如基座卸载全部子应用）。
   *  子应用卸载请用各自 on() 返回的 unsubscribe，避免误伤其它模块。 */
  reset(): void {
    this.target = new EventTarget();
    this.registry = new WeakMap();
  }
}

export const aguiBus = new AguiEventBus();
