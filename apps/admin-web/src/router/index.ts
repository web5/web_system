import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { ROLE_PERMISSIONS } from '@web-system/types';
import { useUserStore } from '@/stores/user';

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

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    name: 'Layout',
    component: () => import('@/layouts/BasicLayout.vue'),
    redirect: '/dashboard',
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '工作台', permission: 'dashboard:view' },
      },
      {
        path: 'settings',
        name: 'Settings',
        component: () => import('@/views/Settings.vue'),
        meta: { title: '系统设置', permission: 'settings:view' },
      },
      {
        path: 'bianbian',
        name: 'BianbianManage',
        component: () => import('@/views/BianbianManage.vue'),
        meta: { title: '变变管理', permission: 'bianbian:view' },
      },
      {
        path: 'users',
        name: 'Users',
        meta: { title: '用户管理', permission: 'users:view' },
        children: [
          {
            path: '',
            name: 'UserList',
            component: () => import('@/views/UserList.vue'),
            meta: { title: '用户列表', permission: 'users:view' },
          },
          {
            path: ':id',
            name: 'UserDetail',
            component: () => import('@/views/UserDetail.vue'),
            meta: { title: '用户详情', permission: 'users:view' },
          },
        ],
      },
    ],
  },
  // 403 无权限页面
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/views/Forbidden.vue'),
    meta: { requiresAuth: false },
  },
  // 404 兜底路由
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
  },
];

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
});

router.beforeEach((to, _from, next) => {
  // 从 Pinia store 读取状态，而非裸解析 localStorage JSON
  const userStore = useUserStore();
  const token = userStore.token;
  const userRoles = userStore.userInfo?.roles || [];

  if (to.meta.requiresAuth && (!token || isTokenExpired(token))) {
    next('/login');
    return;
  }
  if (to.path === '/login' && token) {
    next('/');
    return;
  }

  // 权限检查
  const perm = to.meta.permission as string | undefined;
  if (perm) {
    const allowedPerms = userRoles.flatMap((r: string) => (ROLE_PERMISSIONS as Record<string, string[]>)[r] || []);
    if (!allowedPerms.includes(perm)) {
      next('/403');
      return;
    }
  }
  next();
});

export default router;
