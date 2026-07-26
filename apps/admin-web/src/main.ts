import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { setupAntd } from '@/plugins/antd';
import App from './App.vue';
import router from './router';
import './style.css';

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
