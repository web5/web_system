<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  DashboardOutlined,
  CloudUploadOutlined,
  MonitorOutlined,
  AuditOutlined,
  LogoutOutlined,
  UserOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  DeploymentUnitOutlined,
  SettingOutlined,
  BellOutlined,
  ExperimentOutlined,
  ToolOutlined,
  BuildOutlined,
} from '@ant-design/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { message, Modal } from 'ant-design-vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const collapsed = ref(false)

// 头像用用户名首字母，便于辨识
const avatarLetter = computed(() =>
  (authStore.user?.username || 'U').slice(0, 1).toUpperCase(),
)

// 菜单项
const menuItems = [
  { key: '/dashboard', label: '仪表盘', icon: DashboardOutlined },
  { key: '/deploy', label: '发布中心', icon: CloudUploadOutlined },
  { key: '/pipelines', label: '流水线', icon: DeploymentUnitOutlined },
  { key: '/modules', label: '模块管理', icon: AppstoreOutlined },
  { key: '/environments', label: '环境管理', icon: ApartmentOutlined },
  { key: '/monitor', label: '服务监控', icon: MonitorOutlined },
  { key: '/audit', label: '审计日志', icon: AuditOutlined },
  { key: '/config', label: '配置中心', icon: SettingOutlined },
  { key: '/notifications', label: '通知中心', icon: BellOutlined },
  { key: '/canary', label: '灰度管理', icon: ExperimentOutlined },
  { key: '/diagnose', label: '自助诊断', icon: ToolOutlined },
  { key: '/tools', label: '工具目录', icon: BuildOutlined },
  { key: '/settings', label: '系统设置', icon: SettingOutlined },
]

// 当前选中的菜单项
const selectedKeys = computed(() => [route.path])

// 菜单点击跳转
function onMenuClick({ key }: { key: string }) {
  router.push(key)
}

// 退出登录
function handleLogout() {
  Modal.confirm({
    title: '确认退出',
    content: '确定要退出登录吗？',
    okText: '退出',
    cancelText: '取消',
    onOk: () => {
      authStore.logout()
      message.success('已退出登录')
      router.push('/login')
    },
  })
}
</script>

<template>
  <a-layout class="app-layout">
    <!-- 左侧深色侧边栏 -->
    <a-layout-sider
      v-model:collapsed="collapsed"
      collapsible
      class="app-sider"
      theme="dark"
      :trigger="null"
    >
      <div class="logo">
        <svg
          class="logo-icon"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <!-- 与 favicon 同款：深底 + 金色蜂巢 cell（融入侧栏深色背景，外深内亮层次清晰） -->
          <rect x="1" y="1" width="30" height="30" rx="7" fill="#001529" />
          <path
            d="M16 6 L25 11 V21 L16 26 L7 21 V11 Z"
            stroke="#F5A623"
            stroke-width="1.8"
            stroke-linejoin="round"
            fill="none"
          />
          <path
            d="M16 10.6 L21.6 13.8 V20.2 L16 23.4 L10.4 20.2 V13.8 Z"
            fill="#F5A623"
          />
        </svg>
        <span v-if="!collapsed" class="logo-text">Beehive</span>
      </div>
      <a-menu
        theme="dark"
        mode="inline"
        :selected-keys="selectedKeys"
        @click="onMenuClick"
      >
        <a-menu-item v-for="item in menuItems" :key="item.key">
          <component :is="item.icon" />
          <span>{{ item.label }}</span>
        </a-menu-item>
      </a-menu>
    </a-layout-sider>

    <a-layout>
      <!-- 顶部 Header -->
      <a-layout-header class="app-header">
        <div style="display: flex; align-items: center; gap: 16px;">
          <span style="font-size: 16px; font-weight: 600;">
            {{ route.meta.title || 'Beehive' }}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <a-dropdown trigger="['click']">
            <span class="user-trigger">
              <div class="user-avatar">{{ avatarLetter }}</div>
              <span class="user-info">
                <span class="user-name">{{ authStore.user?.username || '用户' }}</span>
                <span v-if="authStore.user?.role" class="user-role">{{ authStore.user.role }}</span>
              </span>
              <svg class="user-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 4 L5 7 L8 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <template #overlay>
              <a-menu @click="({ key }: any) => key === 'logout' && handleLogout()">
                <a-menu-item key="profile" disabled>
                  <UserOutlined />个人信息
                </a-menu-item>
                <a-menu-divider />
                <a-menu-item key="logout">
                  <LogoutOutlined />退出登录
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </div>
      </a-layout-header>

      <!-- 内容区域 -->
      <a-layout-content class="app-content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
/* 侧栏容器固定深色（例外：反白面板，不随 data-theme）
 * antd 4.2.6 Layout 无 siderBg token → scoped :deep 提特异 (0,3,0) 替代原 style.scss !important（R4）
 * 色值引用 app 局部 --dc-panel-*（style.scss :root 定义，R4 升变量） */
:deep(.ant-layout-sider.app-sider) {
  background-color: var(--dc-panel-sider-bg);
  color: #fff;
}

:deep(.ant-menu-dark) {
  background: transparent;
}

:deep(.ant-menu-dark .ant-menu-item) {
  color: var(--dc-panel-menu-text);
}

:deep(.ant-menu-dark .ant-menu-item:hover) {
  background-color: var(--dc-panel-menu-hover);
  color: var(--dc-panel-menu-text-hover);
}

:deep(.ant-menu-dark .ant-menu-item-selected) {
  background-color: var(--dc-panel-menu-selected);
  color: var(--dc-panel-menu-text-selected);
}

.logo-text-block {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  margin-left: 8px;
}
.logo-title {
  font-size: 16px;
  font-weight: var(--ws-font-weight-semibold);
  color: #fff;
  letter-spacing: 0.5px;
}
.logo-sub {
  font-size: 11px;
  color: var(--ws-text-tertiary);
  margin-top: 2px;
}
/* 悬浮触发器（深色 header 内）：hover 用白 6% 透明底 = 深壳语言（同侧栏菜单 hover，
 * --dc-panel-menu-hover），文字 tertiary → header 亮色；禁用 var(--ws-bg-hover) 浅灰底
 * （浅灰 #F2F2F2 在深底上突兀——R3 用户反馈；规则见 color-reference §3/§2） */
.user-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 6px;
  border-radius: var(--ws-radius-lg);
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.user-trigger:hover {
  background-color: var(--dc-panel-menu-hover);
}
.user-trigger:hover .user-name,
.user-trigger:hover .user-role,
.user-trigger:hover .user-caret {
  color: var(--dc-panel-header-text);
}
.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--ws-brand-500) 0%, var(--ws-brand-accent) 100%);
  color: #fff;
  font-weight: var(--ws-font-weight-semibold);
  font-size: 15px;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(249, 115, 22, 0.25);
}
.user-info {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.user-name {
  font-size: 14px;
  font-weight: var(--ws-font-weight-semibold);
  /* 与 .user-role 同色系（tertiary 中灰）—— 避免被全局 .app-header .user-name 覆盖（scoped 选择器特异性等同但后置胜出） */
  color: var(--ws-text-tertiary);
}
.user-role {
  font-size: 11px;
  color: var(--ws-text-tertiary);
  margin-top: 2px;
}
.user-caret {
  color: var(--ws-text-tertiary);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
</style>
