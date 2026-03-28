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
            <a-avatar :size="24" :src="userAvatar" />
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
import { ref, watch, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { logout as logoutApi } from '@/api/auth';
import { message } from 'ant-design-vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const selectedKeys = ref(['dashboard']);

// 默认头像
const DEFAULT_AVATAR = '/avatars/default-avatar.png';

const userAvatar = computed(() => {
  return userStore.userInfo?.avatar || DEFAULT_AVATAR;
});

watch(
  () => route.path,
  (path) => {
    if (path.includes('/users')) {
      selectedKeys.value = ['users'];
    } else if (path.includes('/dashboard')) {
      selectedKeys.value = ['dashboard'];
    } else if (path.includes('/settings')) {
      selectedKeys.value = ['settings'];
    }
  },
  { immediate: true }
);

const handleLogout = async () => {
  try {
    await logoutApi();
    message.success('已退出登录');
  } catch (error) {
    // 即使接口失败也要退出
    console.error('Logout API error:', error);
  } finally {
    userStore.logout();
    router.push('/login');
  }
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
