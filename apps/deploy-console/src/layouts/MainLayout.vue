<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  DashboardOutlined,
  MonitorOutlined,
  AuditOutlined,
  LogoutOutlined,
  UserOutlined,
  AppstoreOutlined,
  DeploymentUnitOutlined,
  SettingOutlined,
  BellOutlined,
  ExperimentOutlined,
  ToolOutlined,
  BuildOutlined,
  ControlOutlined,
  GlobalOutlined,
  ApiOutlined,
  ClusterOutlined,
  RocketOutlined,
} from '@ant-design/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { message, Modal } from 'ant-design-vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

// 头像用用户名首字母，便于辨识
const avatarLetter = computed(() =>
  (authStore.user?.username || 'U').slice(0, 1).toUpperCase(),
)

/**
 * 导航结构（双域重构，2026-09-18 用户确认）：
 * **顶部一级菜单 + 左侧二级菜单**（点击一级后，左侧切换为该域的子项）。
 *  - 微前端：应用管理 + 环境管理（环境 = 微前端加载维度，按 envId 加载产物目录）
 *  - API 网关：服务管理（后端服务 + 接口清单）
 *  - 流水线：发布流水线 + 灰度 / 诊断 / 工具（本次不动）
 *  - 基础设施：服务监控 + 审计 / 通知 / 配置中心 / 设置
 * 仪表盘无二级，点击直达。
 */
interface NavItem {
  key: string
  label: string
  icon: unknown
}
interface Domain {
  key: string
  label: string
  icon: unknown
  children: NavItem[]
}

const DOMAINS: Domain[] = [
  { key: 'dashboard', label: '仪表盘', icon: DashboardOutlined, children: [] },
  {
    key: 'micro',
    label: '微前端',
    icon: AppstoreOutlined,
    children: [
      { key: '/apps', label: '应用管理', icon: AppstoreOutlined },
      { key: '/environments', label: '环境管理', icon: GlobalOutlined },
      { key: '/deploys/micro', label: '版本部署', icon: RocketOutlined },
    ],
  },
  {
    key: 'gateway',
    label: 'API 网关',
    icon: ApiOutlined,
    children: [
      { key: '/services', label: '服务管理', icon: ApiOutlined },
    ],
  },
  {
    key: 'pipeline',
    label: '流水线',
    icon: DeploymentUnitOutlined,
    children: [
      { key: '/pipelines', label: '流水线列表', icon: DeploymentUnitOutlined },
      { key: '/canary', label: '灰度管理', icon: ExperimentOutlined },
      { key: '/diagnose', label: '自助诊断', icon: ToolOutlined },
      { key: '/tools', label: '工具目录', icon: BuildOutlined },
    ],
  },
  {
    key: 'infra',
    label: '基础设施',
    icon: SettingOutlined,
    children: [
      { key: '/hosts', label: '主机管理', icon: ClusterOutlined },
      { key: '/monitor', label: '服务监控', icon: MonitorOutlined },
      { key: '/audit', label: '审计日志', icon: AuditOutlined },
      { key: '/notifications', label: '通知中心', icon: BellOutlined },
      { key: '/config', label: '配置中心', icon: ControlOutlined },
      { key: '/settings', label: '系统设置', icon: SettingOutlined },
    ],
  },
]

const allNavItems = computed<NavItem[]>(() => DOMAINS.flatMap((d) => d.children))

/** 当前路由归属的二级项（详情页取最长前缀，如 /apps/admin → /apps） */
const selectedKeys = computed<string[]>(() => {
  const p = route.path
  const items = allNavItems.value
  if (items.some((i) => i.key === p)) return [p]
  const hit = items
    .filter((i) => p.startsWith(`${i.key}/`))
    .sort((a, b) => b.key.length - a.key.length)[0]
  return [hit?.key ?? p]
})

/** 当前一级域：由二级项反推；无匹配时回到仪表盘 */
const activeDomain = computed<Domain>(() => {
  const selected = selectedKeys.value[0]
  const hit = DOMAINS.find((d) => d.children.some((c) => c.key === selected))
  if (hit) return hit
  return DOMAINS[0]
})

/** 顶部一级菜单点击：无二级直达仪表盘；有二级跳该域第一项 */
function onDomainClick({ key }: { key: string }) {
  const d = DOMAINS.find((x) => x.key === key)
  if (!d) return
  if (!d.children.length) {
    router.push('/dashboard')
    return
  }
  if (activeDomain.value.key === key) return
  router.push(d.children[0].key)
}

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
    <!-- 顶部一级导航（深壳） -->
    <a-layout-header class="app-topnav">
      <div class="brand">
        <svg
          class="brand-logo"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect x="1" y="1" width="30" height="30" rx="7" fill="#001529" />
          <path
            d="M16 6 L25 11 V21 L16 26 L7 21 V11 Z"
            stroke="#F5A623"
            stroke-width="1.8"
            stroke-linejoin="round"
            fill="none"
          />
          <path d="M16 10.6 L21.6 13.8 V20.2 L16 23.4 L10.4 20.2 V13.8 Z" fill="#F5A623" />
        </svg>
        <span class="brand-text">Beehive</span>
      </div>

      <a-menu
        class="top-menu"
        theme="dark"
        mode="horizontal"
        :selected-keys="[activeDomain.key]"
        @click="onDomainClick"
      >
        <a-menu-item v-for="d in DOMAINS" :key="d.key">
          <component :is="d.icon" />
          <span>{{ d.label }}</span>
        </a-menu-item>
      </a-menu>

      <div class="topnav-right">
        <a-dropdown trigger="['click']">
          <span class="user-trigger">
            <div class="user-avatar">{{ avatarLetter }}</div>
            <span class="user-info">
              <span class="user-name">{{ authStore.user?.username || '用户' }}</span>
              <span v-if="authStore.user?.role" class="user-role">{{ authStore.user.role }}</span>
            </span>
            <svg class="user-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M2 4 L5 7 L8 4"
                stroke="currentColor"
                stroke-width="1.4"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
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

    <a-layout class="app-body">
      <!-- 左侧二级菜单（随一级切换；仪表盘无二级则不显示） -->
      <a-layout-sider
        v-if="activeDomain.children.length"
        class="app-sider"
        theme="dark"
        :width="200"
      >
        <div class="sider-title">{{ activeDomain.label }}</div>
        <a-menu
          theme="dark"
          mode="inline"
          :selected-keys="selectedKeys"
          @click="onMenuClick"
        >
          <a-menu-item v-for="c in activeDomain.children" :key="c.key">
            <component :is="c.icon" />
            <span>{{ c.label }}</span>
          </a-menu-item>
        </a-menu>
      </a-layout-sider>

      <!-- 内容区域 -->
      <a-layout-content class="app-content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
}

/* ---------- 顶部一级导航（深壳，反白面板不随 data-theme） ---------- */
:deep(.ant-layout-header.app-topnav) {
  height: 56px;
  line-height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 20px;
  background-color: var(--dc-panel-header-bg);
  border-bottom: 1px solid var(--dc-panel-header-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.brand-logo {
  width: 26px;
  height: 26px;
  display: block;
}
.brand-text {
  color: #f5a623;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.top-menu {
  flex: 1;
  min-width: 0;
  background: transparent;
  border-bottom: none;
}
.topnav-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
:deep(.ant-menu-dark.ant-menu-horizontal) {
  background: transparent;
  border-bottom: none;
  line-height: 55px;
}
:deep(.ant-menu-dark.ant-menu-horizontal > .ant-menu-item) {
  color: var(--dc-panel-menu-text);
  padding: 0 14px;
}
:deep(.ant-menu-dark.ant-menu-horizontal > .ant-menu-item:hover) {
  background-color: var(--dc-panel-menu-hover);
  color: var(--dc-panel-menu-text-hover);
}
:deep(.ant-menu-dark.ant-menu-horizontal > .ant-menu-item-selected) {
  background-color: var(--dc-panel-menu-selected);
  color: var(--dc-panel-menu-text-selected);
}
/* 选中指示条：antd 横向菜单的 ::after 下边框，改为主橙（提特异度而非 !important） */
:deep(.ant-menu-dark.ant-menu-horizontal > .ant-menu-item-selected::after) {
  border-bottom-color: var(--dc-panel-menu-text-selected);
}

/* ---------- 左侧二级菜单 ---------- */
:deep(.ant-layout-sider.app-sider) {
  background-color: var(--dc-panel-sider-bg);
  color: #fff;
}
.sider-title {
  padding: 18px 16px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--dc-panel-menu-text);
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

/* ---------- 悬浮触发器（深色顶栏内） ---------- */
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
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--ws-brand-500) 0%, var(--ws-brand-accent) 100%);
  color: #fff;
  font-weight: var(--ws-font-weight-semibold);
  font-size: 14px;
  flex-shrink: 0;
  box-shadow: var(--ws-shadow-avatar);
}
.user-info {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.user-name {
  font-size: 13px;
  font-weight: var(--ws-font-weight-semibold);
  color: var(--ws-text-tertiary);
}
.user-role {
  font-size: 11px;
  color: var(--ws-text-tertiary);
}
.user-caret {
  color: var(--ws-text-tertiary);
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.app-body {
  min-height: calc(100vh - 56px);
}
</style>
