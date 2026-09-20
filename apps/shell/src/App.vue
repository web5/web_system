<template>
  <a-config-provider :locale="zhCN" :theme="antdThemeLight">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
// 基座根组件：不做业务布局（布局由各模块自带），只承载 router-view。
// 登录页走 /login；模块挂载走 /:module/*（ModuleContainer 占满页面）。
// 2026-09-03 shell 视觉统一：antd 主题走 @web-system/ui antdThemeLight（品牌橙，浅色 canonical）
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { antdThemeLight } from '@web-system/ui';
</script>
