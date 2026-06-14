import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { ROLE_PERMISSIONS } from '@web-system/types';

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
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('access_token');
  const userRoles = (() => { try { const raw = localStorage.getItem('user-store'); return raw ? JSON.parse(raw)?.userInfo?.roles || [] : []; } catch { return []; } })();
  
  if (to.meta.requiresAuth && !token) {
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
      next('/dashboard');
      return;
    }
  }
  next();
});

export default router;
