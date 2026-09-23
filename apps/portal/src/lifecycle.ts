import type { ModuleContext, ModuleLifecycle } from '@web-system/shared';
import { createApp, watch, type App as VueApp, type WatchStopHandle } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { setupAntd } from '@/plugins/antd';
import { useUserStore } from '@/stores/user';
import { useUiPrefsStore } from '@/stores/ui-prefs';
// UI 规范：语义 token + 全局基础样式（@web-system/ui 的 tokens/theme 直指 src，不走 dist）
// 顺序要求：先 token 与基础样式，再 portal 自有 global.css
import '@web-system/ui/tokens.css';
import '@web-system/ui/theme.css';
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
/** 界面偏好同步监听句柄（卸载时停止，避免模块卸载后仍写宿主根属性） */
let stopPrefSync: WatchStopHandle | null = null;

export const bootstrap: ModuleLifecycle['bootstrap'] = async (_ctx: ModuleContext) => {
  // portal 用自己的 router，无需向基座注册子路由
};

export const mount: ModuleLifecycle['mount'] = async (ctx: ModuleContext, container: any) => {
  app = createApp(App);
  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);
  app.use(pinia);
  // 圆角风格偏好：尽早写入根属性（驱动 tokens.css 的 [data-radius] 覆盖块），减少首屏跳变
  const uiPrefs = useUiPrefsStore(pinia);
  uiPrefs.init();
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
    // 界面偏好跟账号走：userInfo 到位后以**服务端为准**收敛本地（含「挂载之后才登录」的场景）。
    // 未登录（userInfo 为空）与请求失败一律保持本地值，不打扰用户。
    // 口径：specs/radius-style-dual/page-spec-pref-sync.md §4.1
    stopPrefSync = watch(
      () => userStore.userInfo?.preferences,
      (prefs) => uiPrefs.syncFromServer(prefs),
      { immediate: true },
    );
    void userStore.fetchUserInfo?.().catch(() => undefined);
  } catch { /* ignore */ }
};

export const unmount: ModuleLifecycle['unmount'] = async (_ctx: ModuleContext) => {
  stopPrefSync?.();
  stopPrefSync = null;
  app?.unmount();
  app = null;
  // 复位圆角偏好属性：卸载后不把偏好残留在宿主 <html> 上（多模块共存时不做仲裁，末次写入生效）
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-radius');
};

export default { bootstrap, mount, unmount };
