<template>
  <a-config-provider :locale="zhCN" :theme="antdThemeLight">
    <router-view />
    <!-- 环境切换挂件：基座职责，渲染在 portal / admin 等模块之上（prod 站点不渲染） -->
    <EnvSwitcher />
    <!-- 全站备案条：基座职责 —— 一次挂载覆盖所有路由，子模块无需各自实现 -->
    <SiteBeianBar />
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
// 全站备案信息（ICP + 公安）：法定要求所有页面可及，由基座统一提供
import SiteBeianBar from './components/SiteBeianBar.vue';
</script>

<style>
/*
 * 备案条高度：基座对外公开的**唯一避让变量**。
 *
 * fixed 贴底条必然压住模块底部（portal 左栏底部能力区 / admin sider 底部都会被压 30px），
 * 所以模块根容器高度要写成 calc(100vh - var(--site-beian-bar-h, 0px))。
 * 带 fallback 0：模块单独运行（不经基座、变量不存在）时布局与改造前完全一致，
 * 避免模块被基座反向绑死。高度改这里即可，条与让位同步生效。
 */
:root {
  --site-beian-bar-h: 30px;
}
</style>
