import type { ModuleContext, ModuleLifecycle } from '@web-system/shared';
import { createApp, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { setupAntd } from '@/plugins/antd';
import App from './App.vue';
import router from './router';
import { vHasPerm } from './directives/v-has-perm';
// UI 规范：语义 token + antd 兜底（2026-09-03 D 接入，替代原 style.css）
// mf cssScope 豁免 :root/[data-theme]/html/body，变量在 html 全局生效
import '@web-system/ui/tokens.css';
import '@web-system/ui/theme.css';

/** Admin 后台微前端模块生命周期。用自带 router（base /admin/）。 */
let app: VueApp | null = null;

export const bootstrap: ModuleLifecycle['bootstrap'] = async (_ctx: ModuleContext) => {
  // admin 用自带 router，无需向基座注册子路由
};

export const mount: ModuleLifecycle['mount'] = async (ctx: ModuleContext, container: any) => {
  app = createApp(App);
  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);
  app.use(pinia);
  app.use(router);  // admin 自己的 router（base /admin/）
  app.directive('has-perm', vHasPerm);
  setupAntd(app);
  app.provide('moduleContext', ctx);
  app.config.errorHandler = (err, _i, info) => console.error('[admin 模块错误]', err, info);
  app.mount(container);
};

export const unmount: ModuleLifecycle['unmount'] = async () => {
  app?.unmount();
  app = null;
};

export default { bootstrap, mount, unmount };
