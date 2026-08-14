import { createApp } from 'vue';
import { setupAntd } from '@web-system/ui';
import '@web-system/ui/tokens.css';
import '@web-system/ui/theme.css';
import App from './App.vue';
// mcp-admin 使用浅色主题（不强制深色/黑底），启用 tokens.css 已定义的 [data-theme=light]
document.documentElement.setAttribute('data-theme', 'light');
const app = createApp(App);
setupAntd(app);
app.mount('#app');
