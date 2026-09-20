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
        path: 'pipelines',
        name: 'PipelineCenter',
        component: () => import('@/views/PipelineCenter.vue'),
        meta: { title: '发布流水线' },
      },
      {
        // 新建态必须排在 pipelines/:id 之前（否则 'new' 会被当成 id）
        path: 'pipelines/new/edit',
        name: 'PipelineEditCreate',
        component: () => import('@/views/PipelineEdit.vue'),
        meta: { title: '新建流水线' },
      },
      {
        path: 'pipelines/:id',
        name: 'PipelineDetail',
        component: () => import('@/views/PipelineDetail.vue'),        meta: { title: '流水线详情' },
      },
      {
        path: 'pipelines/:id/edit',
        name: 'PipelineEdit',
        component: () => import('@/views/PipelineEdit.vue'),
        meta: { title: '编辑流水线' },
      },
      // ---- 微前端域 ----
      {
        path: 'apps',
        name: 'AppManager',
        component: () => import('@/views/AppManager.vue'),
        meta: { title: '应用管理' },
      },
      {
        path: 'apps/:key',
        name: 'AppDetail',
        component: () => import('@/views/AppDetail.vue'),
        meta: { title: '应用详情' },
      },
      {
        path: 'environments',
        name: 'EnvironmentManager',
        component: () => import('@/views/EnvironmentManager.vue'),
        meta: { title: '环境管理' },
      },
      {
        path: 'environments/:envId',
        name: 'EnvironmentDetail',
        component: () => import('@/views/EnvironmentDetail.vue'),
        meta: { title: '环境详情' },
      },
      // ---- API 网关域 ----
      {
        path: 'services',
        name: 'ServiceManager',
        component: () => import('@/views/ServiceManager.vue'),
        meta: { title: '服务管理' },
      },
      {
        path: 'services/:key',
        name: 'ServiceDetail',
        component: () => import('@/views/ServiceDetail.vue'),
        meta: { title: '服务详情' },
      },
      // ---- 基础设施 ----
      {
        path: 'hosts',
        name: 'HostManager',
        component: () => import('@/views/HostManager.vue'),
        meta: { title: '主机管理' },
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
      {
        path: 'config',
        name: 'ConfigCenter',
        component: () => import('@/views/ConfigCenter.vue'),
        meta: { title: '配置中心' },
      },
      {
        path: 'notifications',
        name: 'NotificationCenter',
        component: () => import('@/views/NotificationCenter.vue'),
        meta: { title: '通知中心' },
      },
      {
        path: 'settings',
        name: 'SystemSettings',
        component: () => import('@/views/SystemSettings.vue'),
        meta: { title: '系统设置' },
      },
      {
        path: 'canary',
        name: 'CanaryCenter',
        component: () => import('@/views/CanaryCenter.vue'),
        meta: { title: '灰度管理' },
      },
      {
        path: 'diagnose',
        name: 'DiagnoseCenter',
        component: () => import('@/views/DiagnoseCenter.vue'),
        meta: { title: '自助诊断' },
      },
      {
        path: 'tools',
        name: 'ToolCatalog',
        component: () => import('@/views/ToolCatalog.vue'),
        meta: { title: '工具目录' },
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
