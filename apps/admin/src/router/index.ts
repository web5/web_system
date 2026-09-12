import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { installChunkLoadErrorGuard, isChunkLoadError, showModuleLoadError } from '@/utils/module-load-error';
// Login 静态引入，避免未登录跳转登录页时需等待懒加载 chunk 造成白屏
import LoginView from '@/views/Login.vue';

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
    component: LoginView,
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
        path: 'settings/roles',
        name: 'RoleManagement',
        component: () => import('@/views/Settings/RoleManagement.vue'),
        meta: { title: '角色权限', permission: 'roles:manage' },
      },
      {
        path: 'settings/dicts',
        name: 'DictManage',
        component: () => import('@/views/Settings/DictManagePage.vue'),
        meta: { title: '字典管理', permission: 'system:dict:view' },
      },
      {
        path: 'settings/dicts/:code',
        name: 'DictEdit',
        component: () => import('@/views/Settings/DictEditPage.vue'),
        meta: { title: '字典编辑', permission: 'system:dict:manage' },
      },
      {
        path: 'mcp',
        name: 'McpAdmin',
        component: () => import('@/views/McpAdminPanel.vue'),
        meta: { title: 'MCP 管理', permission: 'mcp:view' },
      },
      {
        path: 'bianbian',
        name: 'BianbianManage',
        component: () => import('@/views/BianbianManage.vue'),
        meta: { title: '变变管理', permission: 'bianbian:view' },
      },
      {
        path: 'agents',
        name: 'Agents',
        meta: { title: 'Agents', permission: 'agents:view' },
        children: [
          {
            path: '',
            name: 'AgentOverview',
            component: () => import('@/views/Agents/AgentOverview.vue'),
            meta: { title: 'Agent 概览', permission: 'agents:view' },
          },
          {
            path: 'metrics',
            name: 'AgentMetrics',
            component: () => import('@/views/Agents/MetricsPage.vue'),
            meta: { title: 'Agent 观测', permission: 'agents:view' },
          },
          {
            path: 'capabilities',
            name: 'AgentCapabilities',
            component: () => import('@/views/Agents/CapabilitiesPage.vue'),
            meta: { title: '能力资产', permission: 'agents:view' },
          },
          {
            path: 'knowledge',
            name: 'KnowledgeCollections',
            component: () => import('@/views/Agents/KnowledgeCollectionsPage.vue'),
            meta: { title: '知识集合', permission: 'knowledge:view' },
          },
          {
            path: 'retrieval',
            name: 'RetrievalDebugger',
            component: () => import('@/views/Agents/RetrievalDebuggerPage.vue'),
            meta: { title: '检索调试', permission: 'agents:debug' },
          },
          {
            path: 'runs/:agentId',
            name: 'AgentRuns',
            component: () => import('@/views/Agents/AgentRuns.vue'),
            meta: { title: 'Agent 对话记录', permission: 'agents:view' },
          },
          {
            path: 'runs/:agentId/run/:id',
            name: 'AgentRunDetail',
            component: () => import('@/views/Agents/AgentRunDetail.vue'),
            meta: { title: 'Run 详情', permission: 'agents:view' },
          },
          {
            path: 'definitions',
            name: 'AgentDefList',
            component: () => import('@/views/Agents/AgentDefList.vue'),
            meta: { title: 'Agent 定义管理', permission: 'agents:manage' },
          },
          {
            path: 'skills',
            name: 'SkillList',
            component: () => import('@/views/Agents/SkillList.vue'),
            meta: { title: '技能库', permission: 'skills:view' },
          },
          {
            path: 'playground',
            name: 'AgentPlayground',
            component: () => import('@/views/Agents/AgentPlayground.vue'),
            meta: { title: '对话调试', permission: 'agents:debug' },
          },
        ],
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
      {
        path: 'database',
        name: 'Database',
        component: () => import('@/views/Database/DataBrowser.vue'),
        meta: { title: '数据浏览', permission: 'database:view' },
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

/**
 * 本次页面加载是否已拉取过权限。
 * 模块级变量：刷新页面即重置，**不能**用持久化的 permissionsReady 代替 ——
 * 那个标记一旦被写脏（例如某次拉取异常写入了空数组），后续每次加载都不会再拉，
 * 菜单会一直按空权限渲染成只剩「工作台」。
 */
let permissionsFetched = false;

router.beforeEach(async (to, _from, next) => {
  // 从 Pinia store 读取状态，而非裸解析 localStorage JSON
  const userStore = useUserStore();
  const token = userStore.token;

  if (to.meta.requiresAuth && (!token || isTokenExpired(token))) {
    next('/login');
    return;
  }
  if (to.path === '/login' && token) {
    next('/');
    return;
  }

  // 每次页面加载都重新拉取一次权限（模块级标记，刷新即重置）。
  // 不能只看持久化的 permissionsReady，否则权限一旦被写脏就永久生效：
  // 表现为菜单塌陷成只剩「工作台」，而守卫（按角色映射）却放行页面，非常迷惑。
  if (token && !permissionsFetched) {
    try {
      await userStore.fetchPermissions();
    } catch {
      /* fetchPermissions 内部已 fallback，这里仅兜底 */
    }
    permissionsFetched = true;
  }

  // 权限检查：与侧边栏菜单同源（store.permissions；后端不可用时 store 内部已回退本地角色常量）。
  // 早期这里用 userInfo.roles 直接映射 ROLE_PERMISSIONS，与菜单判定不同源，
  // 会出现"菜单看得见、点进去 403"的不一致。
  const perm = to.meta.permission as string | undefined;
  if (perm && !userStore.hasPermission(perm)) {
    next('/403');
    return;
  }
  next();
});

/**
 * 懒加载 chunk 失败兜底（2026-09-11 事故）。
 * 模块产物被服务端清理/覆盖后，路由动态 import 会 404；而 vue-router 在生产构建里
 * 静默吞掉这类导航错误 —— 页面全白且控制台零日志。这里给出可见提示与刷新入口。
 */
router.onError((err) => {
  if (isChunkLoadError(err)) {
    showModuleLoadError(err, { moduleName: 'admin', source: 'router' });
  }
});

// 组件内 defineAsyncComponent / 手动 import() 的失败不走 router.onError，这里兜底
installChunkLoadErrorGuard('admin');

export default router;
