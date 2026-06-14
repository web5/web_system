import { createRouter, createWebHistory } from 'vue-router';

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
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
