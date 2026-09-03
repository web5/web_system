<template>
  <a-config-provider :locale="zhCN" :theme="themeConfig">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { shallowRef, watch, onMounted } from 'vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { antdTheme } from '@web-system/ui';
import { useThemeStore } from '@/stores/theme';

const themeStore = useThemeStore();

onMounted(() => {
  themeStore.initTheme();
});

// 注意：这里必须用普通对象（shallowRef），不能用 computed。
// antd 内部会再包一层 computed(() => props.theme)，若这里也是响应式 Proxy，
// 双层响应式会导致 Input 等组件的 component token（inputPaddingVerticalLG/fontSizeLG 等）
// 派生失败，size="large" 的 padding/fontSize 不生效（高度塌成 24px）。
// 2026-09-03 D 接入：使用 @web-system/ui 语义 antd 主题（uiTokens 全量组件 token）
const themeConfig = shallowRef(antdTheme(themeStore.isDark ? 'dark' : 'light'));

watch(() => themeStore.isDark, () => {
  themeConfig.value = antdTheme(themeStore.isDark ? 'dark' : 'light');
});
</script>

<style>
#app {
  width: 100%;
  height: 100vh;
}
</style>
