import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { setupAntd } from '@/plugins/antd';
import App from './App.vue';
import router from './router';
// UI 规范：语义 token + antd 兜底（2026-09-03 D 接入，替代已删除的 ./style.css）
import '@web-system/ui/tokens.css';
import '@web-system/ui/theme.css';

const app = createApp(App);
const pinia = createPinia();

pinia.use(piniaPluginPersistedstate);

app.use(pinia);
app.use(router);
setupAntd(app);

// 全局错误兜底
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Admin 全局错误]', err, info);
};

app.mount('#app');
