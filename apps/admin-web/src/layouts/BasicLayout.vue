<template>
  <a-layout class="layout">
    <!-- 左侧菜单 -->
    <a-layout-sider v-model:collapsed="collapsed" collapsible class="sider" width="220">
      <div class="sider-logo" @click="router.push('/dashboard')">
        <img src="/logo.svg" alt="科豆 AI" class="sider-logo-img" width="28" height="15" />
        <span v-if="!collapsed" class="logo-text">科豆 AI</span>
      </div>
      <a-menu v-model:selectedKeys="selectedKeys" theme="dark" mode="inline" @click="handleMenuClick">
        <a-menu-item key="dashboard">
          <template #icon><DashboardOutlined /></template>
          <span>工作台</span>
        </a-menu-item>
        <a-menu-item v-if="userStore.hasPermission('bianbian:view')" key="bianbian">
          <template #icon><ThunderboltOutlined /></template>
          <span>变变管理</span>
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
            <a-breadcrumb-item>
              <HomeOutlined />
            </a-breadcrumb-item>
            <a-breadcrumb-item>{{ currentTitle }}</a-breadcrumb-item>
          </a-breadcrumb>
        </div>
        <div class="header-right">
          <a-dropdown>
            <span class="user-name">
              <a-avatar :size="30" :src="userAvatar" class="user-avatar" />
              <span class="username-text">{{ userStore.userInfo?.username }}</span>
              <DownOutlined class="user-arrow" />
            </span>
            <template #overlay>
              <a-menu>
                <a-menu-item key="profile" @click="router.push('/users')">
                  <UserOutlined /> 个人中心
                </a-menu-item>
                <a-menu-divider />
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
        <div class="footer-inner">
          <div class="footer-brand">
            <img src="/logo.svg" alt="科豆 AI" width="20" height="10" />
            <span class="footer-brand-text">科豆 AI</span>
          </div>
          <div class="footer-links">
            <a href="https://github.com" target="_blank">GitHub</a>
            <span class="footer-divider">·</span>
            <span>帮助文档</span>
            <span class="footer-divider">·</span>
            <span>问题反馈</span>
          </div>
          <div class="footer-copy">©2026 科豆 AI · 少儿教育平台 管理后台</div>
        </div>
      </a-layout-footer>
    </a-layout>
  </a-layout>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { DashboardOutlined, ThunderboltOutlined, TeamOutlined, SettingOutlined, LogoutOutlined, DownOutlined, UserOutlined, HomeOutlined } from '@ant-design/icons-vue';
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
    '/dashboard': '工作台', '/bianbian': '变变管理', '/users': '用户管理', '/settings': '系统设置',
  };
  const matched = route.matched.find((r) => r.meta.title);
  return (matched?.meta.title as string) || '工作台';
});

watch(() => route.path, (path) => {
  if (path.includes('/users')) selectedKeys.value = ['users'];
  else if (path.includes('/settings')) selectedKeys.value = ['settings'];
  else if (path.includes('/bianbian')) selectedKeys.value = ['bianbian'];
  else selectedKeys.value = ['dashboard'];
}, { immediate: true });

const handleMenuClick = ({ key }: { key: string }) => {
  const routes: Record<string, string> = { dashboard: '/dashboard', bianbian: '/bianbian', users: '/users', settings: '/settings' };
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
  cursor: pointer; border-bottom: 1px solid rgba(255,140,66,.15);
}
.sider-logo:hover { background: rgba(255,140,66,.06); }
.sider-logo-img { border-radius: 6px; flex-shrink: 0; }
.logo-text { color: #FF8C42; font-size: 16px; font-weight: 700; white-space: nowrap; }

.sider :deep(.ant-menu-item-selected) {
  background: linear-gradient(90deg, rgba(255,140,66,.15) 0%, rgba(255,140,66,.04) 100%) !important;
}
.sider :deep(.ant-menu-item-selected::after) {
  border-right-color: #FF8C42 !important;
}
.sider :deep(.ant-menu-item:hover) {
  background: rgba(255,140,66,.06) !important;
}

.top-header {
  background: rgba(10,10,13,.95) !important; padding: 0 24px; display: flex; align-items: center;
  justify-content: space-between; z-index: 9;
  position: sticky; top: 0; height: 56px; line-height: 56px;
  margin-left: 200px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255,140,66,.1);
}
.header-left { flex: 1; }
.header-left :deep(.ant-breadcrumb) { font-size: 13px; }
.header-left :deep(.ant-breadcrumb a) { color: #94A3B8; transition: color .2s; }
.header-left :deep(.ant-breadcrumb a:hover) { color: #FF8C42; }
.header-left :deep(.ant-breadcrumb-separator) { color: #475569; }
.header-left :deep(.ant-breadcrumb li:last-child a),
.header-left :deep(.ant-breadcrumb li:last-child span) { color: #E2E8F0; }
.header-right { display: flex; align-items: center; }
.user-name {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 4px 12px 4px 4px; border-radius: 20px;
  transition: background .2s;
}
.user-name:hover { background: rgba(255,140,66,.12); }
.user-avatar {
  border: 2px solid rgba(255,140,66,.4);
  transition: border-color .2s;
}
.user-name:hover .user-avatar { border-color: #FF8C42; }
.username-text { font-size: 14px; color: #E2E8F0; font-weight: 500; }
.user-arrow { font-size: 10px; color: #64748B; margin-left: -2px; }

.content {
  margin: 16px 16px 0; margin-left: 216px; padding: 0;
  background: transparent; min-height: calc(100vh - 56px - 100px);
}
.footer {
  margin-left: 200px; padding: 0 24px 24px;
  background: transparent !important;
}
.footer-inner {
  border-top: 1px solid rgba(255,140,66,.08);
  padding-top: 16px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.footer-brand {
  display: flex; align-items: center; gap: 6px; opacity: .6;
}
.footer-brand-text { color: #FF8C42; font-size: 13px; font-weight: 600; }
.footer-links { font-size: 12px; color: #64748B; display: flex; align-items: center; gap: 8px; }
.footer-links a { color: #64748B; text-decoration: none; transition: color .2s; }
.footer-links a:hover { color: #FF8C42; }
.footer-links span { cursor: pointer; transition: color .2s; }
.footer-links span:hover { color: #FF8C42; }
.footer-divider { color: rgba(255,140,66,.2); margin: 0 2px; cursor: default !important; }
.footer-copy { font-size: 12px; color: #475569; }
</style>
