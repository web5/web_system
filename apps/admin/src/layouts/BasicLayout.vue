<template>
  <a-layout class="layout">
    <!-- 左侧菜单 -->
    <a-layout-sider v-model:collapsed="collapsed" :collapsedWidth="80" class="sider" width="220">
      <div class="sider-header">
        <div class="sider-logo" @click="router.push('/dashboard')">
          <img src="/logo.svg" alt="科豆 AI" class="sider-logo-img" width="28" height="15" />
          <span v-if="!collapsed" class="logo-text">科豆 AI</span>
        </div>
        <button class="collapse-toggle" :title="collapsed ? '展开菜单' : '收起菜单'" @click="collapsed = !collapsed">
          <MenuFoldOutlined v-if="!collapsed" />
          <MenuUnfoldOutlined v-else />
        </button>
      </div>
      <a-menu v-model:selectedKeys="selectedKeys" :theme="themeStore.isDark ? 'dark' : 'light'" mode="inline" @click="handleMenuClick">
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
        <a-menu-item v-if="userStore.hasPermission('roles:manage')" key="roles">
          <template #icon><SafetyCertificateOutlined /></template>
          <span>角色权限</span>
        </a-menu-item>
        <a-menu-item v-if="userStore.hasPermission('mcp:view')" key="mcp">
          <template #icon><ApiOutlined /></template>
          <span>MCP 管理</span>
        </a-menu-item>
        <a-sub-menu v-if="userStore.hasPermission('agents:view')" key="agents">
          <template #icon><RobotOutlined /></template>
          <template #title>Agents</template>
          <a-menu-item key="agents-runs">
            <span>运行记录</span>
          </a-menu-item>
          <a-menu-item v-if="userStore.hasPermission('agents:manage')" key="agents-defs">
            <span>定义管理</span>
          </a-menu-item>
          <a-menu-item v-if="userStore.hasPermission('skills:view')" key="agents-skills">
            <span>技能库</span>
          </a-menu-item>
          <a-menu-item v-if="userStore.hasPermission('agents:debug')" key="agents-playground">
            <span>对话调试</span>
          </a-menu-item>
        </a-sub-menu>
      </a-menu>
    </a-layout-sider>

    <a-layout>
      <!-- 顶栏 -->
      <a-layout-header class="top-header" :style="{ marginLeft: collapsed ? '104px' : '244px' }">
        <div class="header-left">
          <a-breadcrumb>
            <a-breadcrumb-item>
              <HomeOutlined />
            </a-breadcrumb-item>
            <a-breadcrumb-item>{{ currentTitle }}</a-breadcrumb-item>
          </a-breadcrumb>
        </div>
        <div class="header-right">
          <button class="theme-toggle" @click="themeStore.toggleTheme" :title="themeStore.isDark ? '切换亮色' : '切换暗色'">
            <svg v-if="themeStore.isDark" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/>
              <line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </button>
          <a-dropdown>
            <span class="user-name">
              <a-avatar :size="30" :src="userAvatar" class="user-avatar">
                <template #icon><UserOutlined /></template>
              </a-avatar>
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
      <a-layout-content class="content" :style="{ marginLeft: collapsed ? '104px' : '244px' }">
        <router-view />
      </a-layout-content>

      <a-layout-footer class="footer" :style="{ marginLeft: collapsed ? '104px' : '244px' }">
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
import { DashboardOutlined, ThunderboltOutlined, TeamOutlined, SettingOutlined, ApiOutlined, LogoutOutlined, DownOutlined, UserOutlined, HomeOutlined, MenuFoldOutlined, MenuUnfoldOutlined, RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons-vue';
import { useUserStore } from '@/stores/user';
import { useThemeStore } from '@/stores/theme';
import { logout as logoutApi } from '@/api/auth';
import { message } from 'ant-design-vue';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const themeStore = useThemeStore();
const collapsed = ref(false);
const selectedKeys = ref<string[]>(['dashboard']);
const DEFAULT_AVATAR_MALE = '/avatars/default-male.png';
const DEFAULT_AVATAR_FEMALE = '/avatars/default-female.png';

const userAvatar = computed(() => {
  const info = userStore.userInfo;
  if (info?.avatar) return info.avatar;
  return info?.gender === 'female' ? DEFAULT_AVATAR_FEMALE : DEFAULT_AVATAR_MALE;
});

const currentTitle = computed(() => {
  const titles: Record<string, string> = {
    '/dashboard': '工作台', '/bianbian': '变变管理', '/users': '用户管理', '/settings': '系统设置',
    '/agents': 'Agents',
  };
  const matched = route.matched.find((r) => r.meta.title);
  return (matched?.meta.title as string) || '工作台';
});

watch(() => route.path, (path) => {
  if (path.includes('/users')) selectedKeys.value = ['users'];
  else if (path.includes('/settings/roles')) selectedKeys.value = ['roles'];
  else if (path.includes('/settings')) selectedKeys.value = ['settings'];
  else if (path.includes('/mcp')) selectedKeys.value = ['mcp'];
  else if (path.includes('/bianbian')) selectedKeys.value = ['bianbian'];
  else if (path.includes('/agents/definitions')) selectedKeys.value = ['agents-defs'];
  else if (path.includes('/agents/skills')) selectedKeys.value = ['agents-skills'];
  else if (path.includes('/agents/playground')) selectedKeys.value = ['agents-playground'];
  else if (path.includes('/agents')) selectedKeys.value = ['agents-runs'];
  else selectedKeys.value = ['dashboard'];
}, { immediate: true });

const handleMenuClick = ({ key }: { key: string }) => {
  const routes: Record<string, string> = {
    dashboard: '/dashboard', bianbian: '/bianbian', users: '/users', settings: '/settings', mcp: '/mcp',
    roles: '/settings/roles',
    'agents-runs': '/agents', 'agents-defs': '/agents/definitions', 'agents-skills': '/agents/skills',
    'agents-playground': '/agents/playground',
  };
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
.sider-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px;
  height: 56px;
  background: var(--header-bg);
  border-bottom: none;
}
.sider-logo {
  display: flex; align-items: center; gap: 10px;
  cursor: pointer;
}
.sider-logo:hover { opacity: .85; }
.sider-logo-img { border-radius: 4px; flex-shrink: 0; }
.logo-text { color: #FF8C42; font-size: 16px; font-weight: 700; white-space: nowrap; }

.collapse-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 4px;
  border: 1px solid var(--border-light); background: var(--input-bg);
  color: var(--text-tertiary); cursor: pointer; font-size: 12px;
  transition: all .2s; padding: 0; flex-shrink: 0;
}
.collapse-toggle:hover {
  color: #FF8C42; border-color: rgba(255,140,66,.4);
  background: rgba(255,140,66,.08);
}

.sider :deep(.ant-menu) {
  background: transparent !important;
  border-right: none !important;
}
.sider :deep(.ant-menu-item) {
  color: var(--text-secondary) !important;
}
.sider :deep(.ant-menu-item-selected) {
  background: linear-gradient(90deg, rgba(255,140,66,.15) 0%, rgba(255,140,66,.04) 100%) !important;
  color: #FF8C42 !important;
}
.sider :deep(.ant-menu-item-selected::after) {
  border-right-color: #FF8C42 !important;
}
.sider :deep(.ant-menu-item:hover) {
  background: rgba(255,140,66,.06) !important;
  color: #FF8C42 !important;
}

.top-header {
  background: var(--header-bg) !important; padding: 0 24px; display: flex; align-items: center;
  justify-content: space-between; z-index: 9;
  position: sticky; top: 0; height: 56px; line-height: 56px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--header-border);
}
.header-left { flex: 1; }
.header-left :deep(.ant-breadcrumb) { font-size: 13px; }
.header-left :deep(.ant-breadcrumb a) { color: var(--text-tertiary); transition: color .2s; }
.header-left :deep(.ant-breadcrumb a:hover) { color: #FF8C42; }
.header-left :deep(.ant-breadcrumb-separator) { color: var(--text-faint); }
.header-left :deep(.ant-breadcrumb li:last-child a),
.header-left :deep(.ant-breadcrumb li:last-child span) { color: var(--text-body); }
.header-right { display: flex; align-items: center; gap: 12px; }

.theme-toggle {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 4px;
  border: 1px solid var(--border-light); background: var(--input-bg);
  color: var(--text-tertiary); cursor: pointer;
  transition: all .2s; padding: 0; flex-shrink: 0;
}
.theme-toggle:hover {
  color: #FF8C42; border-color: rgba(255,140,66,.4);
  background: rgba(255,140,66,.08);
}

.user-name {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 4px 12px 4px 4px; border-radius: 4px;
  transition: background .2s;
}
.user-name:hover { background: rgba(255,140,66,.12); }
.user-avatar {
  border: 2px solid rgba(255,140,66,.4);
  transition: border-color .2s;
}
.user-name:hover .user-avatar { border-color: #FF8C42; }
.username-text { font-size: 14px; color: var(--text-body); font-weight: 500; }
.user-arrow { font-size: 10px; color: var(--text-muted); margin-left: -2px; }

.content {
  margin: 16px auto 0; padding: 0;
  max-width: 1440px;
  background: transparent; min-height: calc(100vh - 56px - 92px);
}
.footer {
  padding: 0 16px 24px;
  background: transparent !important;
}
.footer-inner {
  border-top: 1px solid var(--border-divider);
  padding-top: 16px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.footer-brand {
  display: flex; align-items: center; gap: 6px; opacity: .6;
}
.footer-brand-text { color: #FF8C42; font-size: 13px; font-weight: 600; }
.footer-links { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; }
.footer-links a { color: var(--text-muted); text-decoration: none; transition: color .2s; }
.footer-links a:hover { color: #FF8C42; }
.footer-links span { cursor: pointer; transition: color .2s; }
.footer-links span:hover { color: #FF8C42; }
.footer-divider { color: rgba(255,140,66,.2); margin: 0 2px; cursor: default !important; }
.footer-copy { font-size: 12px; color: var(--text-faint); }
</style>
