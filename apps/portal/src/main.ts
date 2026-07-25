import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { setupAntd } from '@/plugins/antd';
import { useUserStore } from '@/stores/user';
import './styles/global.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);

// 从 localStorage 恢复用户登录状态
const userStore = useUserStore(pinia);
userStore.initFromStorage();

app.use(router);
setupAntd(app);

app.mount('#app');
