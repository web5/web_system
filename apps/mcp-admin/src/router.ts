import { createRouter, createWebHistory } from 'vue-router';
import AdminPanel from './views/AdminPanel.vue';

const router = createRouter({
  history: createWebHistory('/'),
  routes: [
    { path: '/', redirect: '/mcp-admin' },
    // 内部管理后台（Key 运营 / 模块管理）
    { path: '/mcp-admin', name: 'admin', component: AdminPanel },
    { path: '/:pathMatch(.*)*', redirect: '/mcp-admin' },
  ],
});

export default router;
