<template>
  <a-config-provider :locale="zhCN" :theme="themeConfig">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context';

const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#FF8C42',
    colorLink: '#FF8C42',
    colorSuccess: '#7ED957',
    borderRadius: 12,
  },
};
</script>

<style>
#app {
  width: 100%;
  height: 100vh;
}
</style>
