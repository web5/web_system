<template>
  <div class="login-container">
    <router-link to="/" class="back-home">
      <ArrowLeftOutlined />
      <span>返回首页</span>
    </router-link>
    <LoginPanel @login-success="onLoginSuccess" />
  </div>
</template>

<script setup lang="ts">
import { ArrowLeftOutlined } from '@ant-design/icons-vue';
import { useRouter } from 'vue-router';
import LoginPanel from '@/components/LoginPanel.vue';

const router = useRouter();

function onLoginSuccess() {
  router.push('/');
}
</script>

<style scoped>
.login-container {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh;
  background: #111;
  position: relative; overflow: hidden;
}
.back-home {
  position: absolute; top: 28px; left: 32px;
  color: rgba(255,255,255,0.6); font-size: 14px;
  text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
  transition: color 0.3s; z-index: 10;
}
.back-home:hover { color: rgba(255,255,255,0.95); }
</style>
