import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import Antd from 'ant-design-vue'
import App from './App.vue'
import router from './router'
// @web-system/ui：语义 token + 全局样式（先于业务 style.scss 加载）
import '@web-system/ui/tokens.css'
import '@web-system/ui/theme.css'
import './style.scss'

const app = createApp(App)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)
app.use(Antd)

app.mount('#app')
