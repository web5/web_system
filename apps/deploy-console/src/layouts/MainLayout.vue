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
  ClusterOutlined,
  DeploymentUnitOutlined,
  SettingOutlined,
  BellOutlined,
  ExperimentOutlined,
  ToolOutlined,
} from '@ant-design/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { message, Modal } from 'ant-design-vue'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const collapsed = ref(false)

// 菜单项
const menuItems = [
  { key: '/dashboard', label: '仪表盘', icon: DashboardOutlined },
  { key: '/deploy', label: '发布中心', icon: CloudUploadOutlined },
  { key: '/pipelines', label: '发布流水线', icon: DeploymentUnitOutlined },
  { key: '/modules', label: '模块管理', icon: AppstoreOutlined },
  { key: '/services', label: '服务管理', icon: ClusterOutlined },
  { key: '/environments', label: '环境管理', icon: ApartmentOutlined },
  { key: '/monitor', label: '服务监控', icon: MonitorOutlined },
  { key: '/audit', label: '审计日志', icon: AuditOutlined },
  { key: '/config', label: '配置中心', icon: SettingOutlined },
  { key: '/notifications', label: '通知中心', icon: BellOutlined },
  { key: '/canary', label: '灰度管理', icon: ExperimentOutlined },
  { key: '/diagnose', label: '自助诊断', icon: ToolOutlined },
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
        {{ collapsed ? 'DC' : '发布管理控制台' }}
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
            {{ route.meta.title || '发布管理控制台' }}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <a-avatar size="small" style="background-color: #001529;">
            <template #icon><UserOutlined /></template>
          </a-avatar>
          <span style="font-size: 14px;">
            {{ authStore.user?.username || '用户' }}
          </span>
          <a-tag v-if="authStore.user?.role" color="blue">
            {{ authStore.user.role }}
          </a-tag>
          <a-button
            type="text"
            size="small"
            @click="handleLogout"
          >
            <template #icon><LogoutOutlined /></template>
            退出
          </a-button>
        </div>
      </a-layout-header>

      <!-- 内容区域 -->
      <a-layout-content class="app-content">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>
