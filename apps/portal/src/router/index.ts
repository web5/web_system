import { createRouter, createWebHistory } from 'vue-router';
import { getStoredToken } from '@/stores/user';

/**
 * 解析 JWT token，检查是否过期
 * 不做签名验证（那是后端的事），只检查 exp 字段
 */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('../views/Home.vue'),
  },
  {
    path: '/bianbian',
    name: 'Create',
    component: () => import('../views/Create.vue'),
  },
  {
    path: '/bianbian/transform',
    name: 'Transform',
    component: () => import('../views/Transform.vue'),
  },
  {
    path: '/bianbian/result',
    name: 'Result',
    component: () => import('../views/Result.vue'),
  },
  {
    path: '/bianbian/history',
    name: 'History',
    component: () => import('../views/History.vue'),
  },
  // 保留旧页面兼容
  {
    path: '/chat',
    name: 'AiChat',
    component: () => import('../views/AiChat.vue'),
  },
  {
    path: '/draw',
    name: 'Draw',
    component: () => import('../views/Draw.vue'),
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('../views/Profile.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/album',
    name: 'Album',
    component: () => import('../views/Album.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/todo',
    name: 'Todo',
    component: () => import('../views/Todo.vue'),
    meta: { requiresAuth: true },
  },
  // ========== 在线工具 ==========
  {
    path: '/tools',
    name: 'Tools',
    component: () => import('../views/tools/ToolsHome.vue'),
  },
  {
    path: '/tools/json',
    name: 'ToolJson',
    component: () => import('../views/tools/JsonFormatter.vue'),
  },
  {
    path: '/tools/sql',
    name: 'ToolSql',
    component: () => import('../views/tools/SqlFormatter.vue'),
  },
  {
    path: '/tools/uglify',
    name: 'ToolUglify',
    component: () => import('../views/tools/Uglify.vue'),
  },
  {
    path: '/tools/diff',
    name: 'ToolDiff',
    component: () => import('../views/tools/CodeDiff.vue'),
  },
  // ========== Admin 重定向（/admin → /admin/）==========
  {
    path: '/admin',
    redirect: '/admin/',
  },
  // ========== 404 兜底 ==========
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/NotFound.vue'),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 路由守卫：需要认证的页面跳转到登录页
router.beforeEach((to, from, next) => {
  if (to.meta?.requiresAuth) {
    const token = getStoredToken();
    if (!token || isTokenExpired(token)) {
      next({ path: '/login', query: { redirect: to.fullPath } });
      return;
    }
  }
  next();
});

export default router;
