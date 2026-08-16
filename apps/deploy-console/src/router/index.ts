import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/',
    component: () => import('@/layouts/MainLayout.vue'),
    redirect: '/dashboard',
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '仪表盘' },
      },
      {
        path: 'deploy',
        name: 'DeployCenter',
        component: () => import('@/views/DeployCenter.vue'),
        meta: { title: '发布中心' },
      },
      {
        path: 'environments',
        name: 'EnvironmentManager',
        component: () => import('@/views/EnvironmentManager.vue'),
        meta: { title: '环境管理' },
      },
      {
        path: 'services',
        name: 'ServiceManager',
        component: () => import('@/views/ServiceManager.vue'),
        meta: { title: '服务管理' },
      },
      {
        path: 'monitor',
        name: 'ServiceMonitor',
        component: () => import('@/views/ServiceMonitor.vue'),
        meta: { title: '服务监控' },
      },
      {
        path: 'audit',
        name: 'AuditLog',
        component: () => import('@/views/AuditLog.vue'),
        meta: { title: '审计日志' },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory('/console/'),
  routes,
})

// 路由守卫：检查 token，无则跳 /login
router.beforeEach((to, _from, next) => {
  const authStore = useAuthStore()
  const isLogin = !!authStore.token

  if (to.meta.requiresAuth === false) {
    // 已登录用户访问登录页，直接跳转控制台
    if (to.path === '/login' && isLogin) {
      next('/dashboard')
      return
    }
    next()
    return
  }

  if (!isLogin) {
    next({ path: '/login', query: { redirect: to.fullPath } })
    return
  }

  next()
})

export default router
