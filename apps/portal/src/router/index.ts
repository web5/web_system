import { createRouter, createWebHistory } from 'vue-router';
import { getStoredToken } from '@/stores/user';

/**
 * 解析 JWT token，检查是否过期
 * 不做签名验证（那是后端的事），只检查 exp 字段
 *
 * 注意：解析失败时返回 false（不假设过期）。这种情况可能是 token 格式异常或
 * 字段被 base64url 编码（atob 对 url-safe base64 兼容性差），让 token 继续
 * 带到请求中，由后端 401 兜底处理，避免误把有效 token 判过期踢到登录页。
 */
function isTokenExpired(token: string): boolean {
  try {
    // JWT 标准是 base64url，部分签发方会用 url-safe 字符（-/_），先归一化
    const normalized = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch (err) {
    console.warn('[router] token 解析失败，跳过本地过期检查:', err);
    return false;
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
    meta: { requiresAuth: true },
  },
  {
    path: '/bianbian/transform',
    name: 'Transform',
    component: () => import('../views/Transform.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/bianbian/result',
    name: 'Result',
    component: () => import('../views/Result.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/bianbian/history',
    name: 'History',
    component: () => import('../views/History.vue'),
    meta: { requiresAuth: true },
  },
  // 保留旧页面兼容
  {
    path: '/chat',
    name: 'AiChat',
    component: () => import('../views/AiChat.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/draw',
    name: 'Draw',
    component: () => import('../views/Draw.vue'),
    meta: { requiresAuth: true },
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
  // ========== 404 兜底 ==========
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/NotFound.vue'),
  },
];

const router = createRouter({
  history: createWebHistory('/portal/'),
  routes,
});

// 路由守卫：需要认证的页面跳转到登录页
// 注意：必须与 request.ts 的 getStoredToken() 保持同一事实源（localStorage），
// 否则 refreshToken 后 store 和 localStorage 不一致会导致 guard 误判。
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
