import { createRouter, createWebHistory } from 'vue-router';
import Home from '../views/Home.vue';
import Draw from '../views/Draw.vue';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home,
  },
  {
    path: '/draw',
    name: 'Draw',
    component: Draw,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
