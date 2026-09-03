import { createApp, type App as VueApp } from 'vue';
import * as VueNS from 'vue';
import { createPinia } from 'pinia';
import * as PiniaNS from 'pinia';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import * as VueRouterNS from 'vue-router';
import axios from 'axios';
import dayjs from 'dayjs';
import * as AntdNS from 'ant-design-vue';
import * as AntdIconsNS from '@ant-design/icons-vue';
import App from './App.vue';
import { MicroFrontendLoader } from '@web-system/shell-loader';
import type { ModuleContext } from '@web-system/shared';
import { setupAntdAll } from './antd-all';
import { saveAuth, clearAuth } from './auth-storage';
// UI 规范：语义 token + 全局基础样式（2026-09-03 shell 视觉统一；css 子路径直指 ui src）
import '@web-system/ui/tokens.css';
import '@web-system/ui/theme.css';

// ============================================================
// 基座启动入口（微前端基座 Shell）
// 职责：登录页 + 登录校验 + 全局上下文 + 模块加载。不做业务布局（布局由各模块自带）。
// - vue/vue-router/pinia/antd/axios/dayjs 打包进 shell.js，挂 window.__SHARED__（模块 external 后从这里取）
// - window.__MODULES_MANIFEST__：gateway 注入的模块清单
// - 路由：/login 登录；/ → redirect /portal/；/:module/* 挂载对应模块
// ============================================================

// 全局共享上下文：模块 external 的依赖统一从这里取（同一份实例）
// ⚠️ key 用 camelCase（vueRouter / antDesignVue），与 vite-micro-frontend.mjs 的 globals 点链访问对应
(window as any).__SHARED__ = {
  vue: VueNS,
  vueRouter: VueRouterNS,
  pinia: PiniaNS,
  axios,
  dayjs,
  antDesignVue: AntdNS,
  antDesignIconsVue: AntdIconsNS,  // 单独挂 icons-vue（不是 antd 包的子集，是独立包）
};
(window as any).__MODULES__ = (window as any).__MODULES__ || {};

// pinia + router
const pinia = createPinia();
const router: Router = createRouter({
  history: createWebHistory('/'),
  routes: [
    { path: '/login', name: 'Login', component: () => import('./views/Login.vue') },
    { path: '/403', name: 'Forbidden', component: () => import('./views/Forbidden.vue') },
    { path: '/404', name: 'NotFound', component: () => import('./views/NotFound.vue') },
    // 默认进入 portal
    { path: '/', redirect: '/portal/' },
    // 模块挂载 catch-all：/portal/xxx → module=portal，挂载对应微前端模块
    {
      path: '/:module/:pathMatch(.*)*',
      name: 'module-route',
      component: () => import('./views/ModuleContainer.vue'),
    },
  ],
});

// axios 实例（预配 baseURL + token 拦截器，作为 ModuleContext.axios 传给模块）
const http = axios.create({ baseURL: '/api', timeout: 30000 });
http.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ---- 登录过期弹窗（复用单例，避免重复弹出） ----
function showLoginExpiredModal() {
  if ((window as any).__loginExpiredShowing__) return;
  (window as any).__loginExpiredShowing__ = true;
  AntdNS.Modal.warning({
    title: '登录已过期',
    content: '为保障账号安全，请重新登录',
    okText: '重新登录',
    onOk: () => {
      (window as any).__loginExpiredShowing__ = false;
      clearAuth();
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?redirect=${redirect}`;
    },
  });
}

// ---- token 自动续期（401 → refreshToken 换新 accessToken；失败弹过期弹窗） ----
let isRefreshing = false;
let pendingQueue: Array<{ resolve: (t: string) => void; reject: (e: any) => void }> = [];

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) throw new Error('no refreshToken');
  const res: any = await axios.post('/api/auth/refresh', { refreshToken });
  const data = res?.data || res || {};
  const newToken = data?.accessToken || data?.token;
  if (!newToken) throw new Error('refresh failed');
  // 续期成功：同步更新两套存储（保留原 user 信息）
  const userInfo = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  })();
  saveAuth(newToken, data.refreshToken || refreshToken, userInfo);
  return newToken;
}

http.interceptors.response.use(
  (res) => (res.data?.data !== undefined ? res.data : res),
  async (err) => {
    const { response, config } = err;

    // 网络错误 / 超时（无 response）
    if (!response) {
      AntdNS.message.error('网络异常或请求超时，请稍后重试');
      return Promise.reject(err);
    }

    // 401：token 过期 → 自动续期，续期失败弹登录过期
    if (response.status === 401 && config && !config._retry) {
      config._retry = true;

      // 并发请求共享同一次续期
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve, reject });
        }).then((token) => {
          config.headers.Authorization = `Bearer ${token}`;
          return http(config);
        });
      }

      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();
        pendingQueue.forEach(({ resolve }) => resolve(newToken));
        pendingQueue = [];
        config.headers.Authorization = `Bearer ${newToken}`;
        return http(config);
      } catch (refreshErr) {
        pendingQueue.forEach(({ reject }) => reject(refreshErr));
        pendingQueue = [];
        showLoginExpiredModal();
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    // 401 且已重试过 → refreshToken 也失效
    if (response.status === 401) {
      showLoginExpiredModal();
      return Promise.reject(err);
    }

    // 403：无权限
    if (response.status === 403) {
      AntdNS.message.error('没有权限访问该资源');
      return Promise.reject(err);
    }

    return Promise.reject(err);
  },
);

// eventBus（模块间通信）
const eventBus = new EventTarget();
(eventBus as any).emit = (type: string, detail?: any) => eventBus.dispatchEvent(new CustomEvent(type, { detail }));
(eventBus as any).on = (type: string, cb: (e: any) => void) => eventBus.addEventListener(type, cb as any);

// 当前用户（localStorage 恢复，登录后由 Login.vue 写入）
const user = (() => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
})();

// ModuleContext：传给各微前端模块
const ctx: ModuleContext = {
  name: '',  // 模块名，loader 挂载时注入
  router,
  pinia,
  axios: http,
  eventBus,
  env: (window as any).__MODULES_MANIFEST__?.env || 'dev',
  user,
  container: document.body,
};

// loader 实例（提前挂到 window，供 ModuleContainer 组件在 onMounted 里调用 mount）
const loader = new MicroFrontendLoader(ctx);
(window as any).__LOADER__ = loader;
const manifest = (window as any).__MODULES_MANIFEST__;
console.log('[shell] manifest:', manifest);
if (manifest?.modules?.length) {
  loader.register(manifest.modules);
  console.log('[shell] registered modules:', manifest.modules.map((m: any) => m.name));
} else {
  console.warn('[shell] manifest 为空，检查 gateway 是否注入 __MODULES_MANIFEST__');
}

// 登录校验守卫：未登录跳 /login
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('token');
  if (to.name !== 'Login' && !token) {
    return next({ path: '/login', query: { redirect: to.fullPath } });
  }
  next();
});

// 启动基座
const app: VueApp = createApp(App);
app.use(pinia);
app.use(router);

// 全量注册 antd（显式 import 每个组件，见 antd-all.ts）。
// 不能用 app.use(AntdNS.default)：其 install 内部 Object.keys 动态遍历，rollup tree-shaking
// 追踪不到，会删掉模块用到的 Table/Tabs/Select 等组件的 cssinjs 样式模板。
setupAntdAll(app);
app.config.globalProperties.$message = AntdNS.message;
AntdNS.message.config({ maxCount: 3 });
import 'ant-design-vue/dist/reset.css';

app.mount('#app');
