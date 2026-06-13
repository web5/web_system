<template>
  <a-layout class="layout">
    <!-- 左侧菜单 -->
    <a-layout-sider v-model:collapsed="collapsed" collapsible class="sider" width="220">
      <div class="sider-logo" @click="router.push('/dashboard')">
        <img src="/logo.svg" alt="科豆 AI" class="sider-logo-img" width="28" height="28" />
        <span v-if="!collapsed" class="logo-text">科豆 AI</span>
      </div>
      <a-menu v-model:selectedKeys="selectedKeys" theme="dark" mode="inline" @click="handleMenuClick">
        <a-menu-item key="dashboard">
          <template #icon><DashboardOutlined /></template>
          <span>工作台</span>
        </a-menu-item>
        <a-menu-item v-if="userStore.hasPermission('users:view')" key="users">
          <template #icon><TeamOutlined /></template>
          <span>用户管理</span>
        </a-menu-item>
        <a-menu-item v-if="userStore.hasPermission('settings:view')" key="settings">
          <template #icon><SettingOutlined /></template>
          <span>系统设置</span>
        </a-menu-item>
      </a-menu>
    </a-layout-sider>

    <a-layout>
      <!-- 顶栏 -->
      <a-layout-header class="top-header">
        <div class="header-left">
          <a-breadcrumb>
            <a-breadcrumb-item>首页</a-breadcrumb-item>
            <a-breadcrumb-item>{{ currentTitle }}</a-breadcrumb-item>
          </a-breadcrumb>
        </div>
        <div class="header-right">
          <a-dropdown>
            <span class="user-name">
              <a-avatar :size="28" :src="userAvatar" />
              <span class="username-text">{{ userStore.userInfo?.username }}</span>
            </span>
            <template #overlay>
              <a-menu>
                <a-menu-item key="logout" @click="handleLogout">
                  <LogoutOutlined /> 退出登录
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </div>
      </a-layout-header>

      <!-- 内容区 -->
      <a-layout-content class="content">
        <router-view />
      </a-layout-content>

      <a-layout-footer class="footer">
        ©2026 科豆 AI · 管理后台
      </a-layout-footer>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { DashboardOutlined, TeamOutlined, SettingOutlined, LogoutOutlined } from '@ant-design/icons-vue';
import { useUserStore } from '@/stores/user';
import { logout as logoutApi } from '@/api/auth';
import { message } from 'ant-design-vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const collapsed = ref(false);
const selectedKeys = ref<string[]>(['dashboard']);
const DEFAULT_AVATAR = '/avatars/default-avatar.png';

const userAvatar = computed(() => userStore.userInfo?.avatar || DEFAULT_AVATAR);

const currentTitle = computed(() => {
  const titles: Record<string, string> = {
    '/dashboard': '工作台', '/users': '用户管理', '/settings': '系统设置',
  };
  const matched = route.matched.find((r) => r.meta.title);
  return (matched?.meta.title as string) || '工作台';
});

watch(() => route.path, (path) => {
  if (path.includes('/users')) selectedKeys.value = ['users'];
  else if (path.includes('/settings')) selectedKeys.value = ['settings'];
  else selectedKeys.value = ['dashboard'];
}, { immediate: true });

const handleMenuClick = ({ key }: { key: string }) => {
  const routes: Record<string, string> = { dashboard: '/dashboard', users: '/users', settings: '/settings' };
  router.push(routes[key] || '/dashboard');
};

const handleLogout = async () => {
  try { await logoutApi(); message.success('已退出登录'); } catch { /* ignore */ }
  userStore.logout();
  router.push('/login');
};
</script>

<style scoped>
.layout { min-height: 100vh; }

.sider { overflow: auto; position: fixed; left: 0; top: 0; bottom: 0; z-index: 10; }
.sider-logo {
  display: flex; align-items: center; gap: 10px; padding: 16px 20px;
  cursor: pointer; border-bottom: 1px solid rgba(249,115,22,.15);
}
.sider-logo:hover { background: rgba(249,115,22,.06); }
.sider-logo-img { border-radius: 6px; flex-shrink: 0; }
.logo-text { color: #F97316; font-size: 16px; font-weight: 700; white-space: nowrap; }

.top-header {
  background: rgba(10,10,13,.95) !important; padding: 0 24px; display: flex; align-items: center;
  justify-content: space-between; z-index: 9;
  position: sticky; top: 0; height: 56px; line-height: 56px;
  margin-left: 200px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(249,115,22,.1);
}
.header-left { flex: 1; }
.header-right { display: flex; align-items: center; }
.user-name { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.username-text { font-size: 14px; color: #CBD5E1; }

.content {
  margin: 16px 16px 0; margin-left: 216px; padding: 0;
  background: transparent; min-height: calc(100vh - 56px - 70px);
}
.footer {
  text-align: center; color: #64748B; font-size: 13px;
  margin-left: 200px;
}
</style>
