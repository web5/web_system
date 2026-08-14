import { createApp } from 'vue';
import { setupAntd } from '@web-system/ui';
import '@web-system/ui/tokens.css';
import '@web-system/ui/theme.css';
import App from './App.vue';
const app = createApp(App);
setupAntd(app);
app.mount('#app');
