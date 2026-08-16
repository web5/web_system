import type { ModuleContext, ModuleLifecycle } from '@web-system/shared';
import { createApp, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { setupAntd } from '@/plugins/antd';
import { useUserStore } from '@/stores/user';
// 全局样式（含 CSS 变量），微前端模式也必须引入
import './styles/global.css';

/**
 * Portal 微前端模块生命周期。
 * - bootstrap：空（portal 用自带 router，base=/portal/，不注册到基座 router）
 * - mount：createApp + 用 portal 自己的 router + mount 到容器（CSS scope 隔离）
 * - unmount：app.unmount()，清理
 *
 * 说明：portal 内部路由走自己的 router 实例（createWebHistory('/portal/')），
 * 基座只负责「加载模块 + 提供容器」，不接管模块内部路由。
 */
let app: VueApp | null = null;

export const bootstrap: ModuleLifecycle['bootstrap'] = async (_ctx: ModuleContext) => {
  // portal 用自己的 router，无需向基座注册子路由
};

export const mount: ModuleLifecycle['mount'] = async (ctx: ModuleContext, container: any) => {
  app = createApp(App);
  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);
  app.use(pinia);
  app.use(router);  // portal 自己的 router（base /portal/）
  setupAntd(app);

  // 注入 ModuleContext 到全局 provide，模块内部可用 useModuleContext()
  app.provide('moduleContext', ctx);

  app.config.errorHandler = (err, _instance, info) => {
    console.error('[portal 模块错误]', err, info);
  };

  app.mount(container);

  // 挂载后异步获取用户信息（非阻塞）
  try {
    const userStore = useUserStore(pinia);
    userStore.fetchUserInfo?.();
  } catch { /* ignore */ }
};

export const unmount: ModuleLifecycle['unmount'] = async (_ctx: ModuleContext) => {
  app?.unmount();
  app = null;
};

export default { bootstrap, mount, unmount };
