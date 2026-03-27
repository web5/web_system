<template>
  <a-layout class="layout">
    <a-layout-header class="header">
      <div class="logo">管理后台</div>
      <a-menu v-model:selectedKeys="selectedKeys" theme="dark" mode="horizontal" :style="{ lineHeight: '64px' }">
        <a-menu-item key="dashboard">工作台</a-menu-item>
        <a-menu-item key="users">用户管理</a-menu-item>
        <a-menu-item key="settings">系统设置</a-menu-item>
      </a-menu>
      <div class="user-info">
        <a-dropdown>
          <span class="user-name">
            <a-avatar :size="24">{{ userStore.userInfo?.username?.charAt(0).toUpperCase() }}</a-avatar>
            {{ userStore.userInfo?.username }}
          </span>
          <template #overlay>
            <a-menu>
              <a-menu-item key="profile">个人中心</a-menu-item>
              <a-menu-divider />
              <a-menu-item key="logout" @click="handleLogout">退出登录</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </div>
    </a-layout-header>
    <a-layout-content class="content">
      <router-view />
    </a-layout-content>
    <a-layout-footer class="footer">
      ©2026 Web System - Powered by Vue3 + NestJS
    </a-layout-footer>
  </a-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();
const selectedKeys = ref(['dashboard']);

const handleLogout = () => {
  userStore.logout();
  router.push('/login');
};
</script>

<style scoped>
.layout {
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.logo {
  color: #fff;
  font-size: 20px;
  font-weight: bold;
  margin-right: 40px;
}

.user-info {
  margin-left: auto;
}

.user-name {
  color: #fff;
  cursor: pointer;
}

.content {
  padding: 24px;
  background: #f0f2f5;
}

.footer {
  text-align: center;
  color: rgba(0, 0, 0, 0.45);
}
</style>
