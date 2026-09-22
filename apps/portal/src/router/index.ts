import { createRouter, createWebHistory } from 'vue-router';
import { getStoredToken } from '@/stores/user';
import { installChunkLoadErrorGuard, isChunkLoadError, showModuleLoadError } from '@/utils/module-load-error';

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
  // ===== 工作台（三栏外壳）：欢迎页为公开页，互动时弹登录/注册（page-spec §0） =====
  {
    path: '/',
    name: 'Welcome',
    component: () => import('../views/Welcome.vue'),
  },
  {
    path: '/chat',
    name: 'AiChat',
    component: () => import('../views/AiChat.vue'),
    meta: { requiresAuth: true },
  },
  // P1 占位态：顶栏可达、不留死链，页面内容在 P2 / P3 填充
  {
    path: '/discover',
    name: 'Discover',
    component: () => import('../views/Discover.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/translate',
    name: 'Translate',
    component: () => import('../views/Translate.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/contract',
    name: 'Contract',
    component: () => import('../views/Contract.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lab',
    name: 'Lab',
    component: () => import('../views/Lab.vue'),
    meta: { requiresAuth: true },
  },
  // 实验室入口（design §2.2）：原路由保留可用，实验室页内以卡片列出
  {
    path: '/lab/bianbian',
    name: 'LabBianbian',
    component: () => import('../views/Create.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lab/draw',
    name: 'LabDraw',
    component: () => import('../views/Draw.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lab/album',
    name: 'LabAlbum',
    component: () => import('../views/Album.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lab/todo',
    name: 'LabTodo',
    component: () => import('../views/Todo.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/lab/tools',
    name: 'LabTools',
    component: () => import('../views/tools/ToolsHome.vue'),
    meta: { requiresAuth: true },
  },
  // ===== 旧路由（变变 / 画板 / Todo / 工具箱）：降级但保留，兼容外链与流程内跳转 =====
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
  // 保留旧页面兼容（/chat 已上移到工作台路由段）
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
  // 我的 · AI 记忆 / 生词本 二级页
  {
    path: '/profile/glossary',
    name: 'Glossary',
    component: () => import('../views/Glossary.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/profile/memory',
    name: 'Memory',
    component: () => import('../views/Memory.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/profile/taste',
    name: 'Taste',
    component: () => import('../views/Taste.vue'),
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
router.beforeEach((to, _from, next) => {
  if (to.meta?.requiresAuth) {
    const token = getStoredToken();
    if (!token || isTokenExpired(token)) {
      next({ path: '/login', query: { redirect: to.fullPath } });
      return;
    }
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
    showModuleLoadError(err, { moduleName: 'portal', source: 'router' });
  }
});

// 组件内 defineAsyncComponent / 手动 import() 的失败不走 router.onError，这里兜底
installChunkLoadErrorGuard('portal');

export default router;
