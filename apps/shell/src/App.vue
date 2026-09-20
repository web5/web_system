<template>
  <a-config-provider :locale="zhCN" :theme="antdThemeLight">
    <router-view />
    <!-- 环境切换挂件：基座职责，渲染在 portal / admin 等模块之上（prod 站点不渲染） -->
    <EnvSwitcher />
  </a-config-provider>
</template>

<script setup lang="ts">
// 基座根组件：不做业务布局（布局由各模块自带），只承载 router-view。
// 登录页走 /login；模块挂载走 /:module/*（ModuleContainer 占满页面）。
// 2026-09-03 shell 视觉统一：antd 主题走 @web-system/ui antdThemeLight（品牌橙，浅色 canonical）
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { antdThemeLight } from '@web-system/ui';
// 环境切换挂件改用共享组件（shell 与 micro-app 共用，见 packages/ui/src/components/EnvSwitcher.vue）
import EnvSwitcher from '@web-system/ui/components/EnvSwitcher.vue';
</script>
