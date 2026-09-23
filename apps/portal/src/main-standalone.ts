import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { setupAntd } from '@/plugins/antd';
import { useUserStore } from '@/stores/user';
import { useUiPrefsStore, bindUserPrefsSync } from '@/stores/ui-prefs';
// 与 lifecycle.ts 同序：ui token → ui 基础样式 → portal 自有样式
import '@web-system/ui/tokens.css';
import '@web-system/ui/theme.css';
import './styles/global.css';

const app = createApp(App);
const pinia = createPinia();

// 注册持久化插件，自动从 localStorage 恢复状态
pinia.use(piniaPluginPersistedstate);

app.use(pinia);

// pinia persist 插件已自动从 localStorage 恢复状态，无需手动 initFromStorage
const userStore = useUserStore(pinia);
// 圆角风格偏好：与 lifecycle.ts 一致，挂载前写到根元素属性（减少首屏跳变）
const uiPrefs = useUiPrefsStore(pinia);
uiPrefs.init();

app.use(router);
setupAntd(app);

// 全局错误兜底
app.config.errorHandler = (err, _instance, info) => {
  console.error('[全局错误]', err, info);
};

app.mount('#app');

// 界面偏好跟账号走：绑定 userInfo.preferences → uiPrefs 的收敛。
// vite dev 等「不走 module mount」的入口必须显式注册，否则 AC2（换设备登录收敛）会失效。
// 口径：specs/radius-style-dual/page-spec-pref-sync.md §4.1
bindUserPrefsSync(userStore, uiPrefs);
