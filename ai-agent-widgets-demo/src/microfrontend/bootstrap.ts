import { createApp, type App } from 'vue';
import AgentPanel from '@/components/AgentPanel.vue';
// 微前端样式穿透：若基座把子应用挂到 Shadow DOM，全局 CSS 无法穿透，
// 这里用 ?inline 把样式以文本注入到 shadow root（见下方 mountAgentPanel）。
import globalCss from '@/styles/global.css?inline';
import markdownCss from '@/styles/markdown.css?inline';

export interface AgentPanelOptions {
  endpoint?: string;
  mcpKey?: string;
  autoConnect?: boolean;
}

export interface AgentPanelHandle {
  app: App;
  /** 卸载子应用：销毁 Vue 实例 + 解绑 bus 监听，做到无泄漏 */
  unmount: () => void;
}

/**
 * 子应用挂载入口（同时供「独立 Demo」与「System.register 微前端」复用）。
 * 基座侧调用方式见 README「移植进 web_system」章节。
 */
export function mountAgentPanel(
  container: HTMLElement,
  options: AgentPanelOptions = {},
): AgentPanelHandle {
  const app = createApp(AgentPanel, {
    endpoint: options.endpoint,
    mcpKey: options.mcpKey,
    autoConnect: options.autoConnect ?? false,
  });

  // 样式穿透：检测容器是否处于 Shadow DOM，若是则把全局主题注入 shadow root，
  // 否则（普通 DOM）由 main.ts 已全局引入的 CSS 负责。这样子应用样式在沙箱下也不丢。
  const root = container.getRootNode();
  if (root instanceof ShadowRoot) {
    const style = document.createElement('style');
    style.textContent = globalCss + '\n' + markdownCss;
    root.appendChild(style);
  }

  app.mount(container);

  return {
    app,
    unmount: () => {
      app.unmount();
      // 子应用内部已在 onUnmounted 精确解绑 bus 监听；
      // 此处不再调用 aguiBus.reset()，避免误伤基座或其它模块的监听。
    },
  };
}

/*
 * ============================================================================
 * 本 demo 的「微前端」不在这一层：这里只是基座 App 的挂载入口。
 * 真正由 System.register 运行时按需加载的，是 **SSE markdown 正文中间** 的
 * widget 子应用（poll / chart / form），加载器见 widget-loader.ts，产物见
 * public/mf-widgets/*.system.js，构建见 vite.widgets.config.ts。
 *
 * 若要把整个 AgentPanel 也作为 web_system 的 System.register 子应用：
 *   1) 打开 vite.config.ts 里注释掉的 build.lib（formats:['system']，external:['vue']）；
 *   2) 基座先 System.set('vue', Vue) 提供同一份 vue 运行时；
 *   3) System.import('agent-panel.system.js').then(m =>
 *        m.mountAgentPanel(document.getElementById('agent-root'), { endpoint:'/agui' }));
 *   4) 卸载 handle.unmount()。
 * 注意：此时基座还需把 widget-loader 依赖的 aguiBus 单例也通过 System.set 注入。
 * 详见 README.md「移植进 web_system」章节。
 * ============================================================================
 */
