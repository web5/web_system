import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import router from './router';
import { setupAntd } from '@/plugins/antd';
import { useUserStore } from '@/stores/user';
import './styles/global.css';

const app = createApp(App);
const pinia = createPinia();

// 注册持久化插件，自动从 localStorage 恢复状态
pinia.use(piniaPluginPersistedstate);

app.use(pinia);

// pinia persist 插件已自动从 localStorage 恢复状态，无需手动 initFromStorage
const userStore = useUserStore(pinia);

app.use(router);
setupAntd(app);

// 全局错误兜底
app.config.errorHandler = (err, _instance, info) => {
  console.error('[全局错误]', err, info);
};

app.mount('#app');

// 挂载后异步获取用户信息（非阻塞）
userStore.fetchUserInfo();
