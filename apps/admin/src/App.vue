<template>
  <a-config-provider :locale="zhCN" :theme="themeConfig">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { shallowRef, watch, onMounted } from 'vue';
import zhCN from 'ant-design-vue/es/locale/zh_CN';
import { theme } from 'ant-design-vue';
import { useThemeStore } from '@/stores/theme';

const themeStore = useThemeStore();

onMounted(() => {
  themeStore.initTheme();
});

// 注意：这里必须用普通对象（shallowRef），不能用 computed。
// antd 内部会再包一层 computed(() => props.theme)，若这里也是响应式 Proxy，
// 双层响应式会导致 Input 等组件的 component token（inputPaddingVerticalLG/fontSizeLG 等）
// 派生失败，size="large" 的 padding/fontSize 不生效（高度塌成 24px）。
const makeTheme = () => ({
  algorithm: themeStore.isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  token: {
    colorPrimary: '#FF8C42',
    colorLink: '#FF8C42',
    colorSuccess: '#7ED957',
    borderRadius: 4,
  },
});
const themeConfig = shallowRef(makeTheme());

watch(() => themeStore.isDark, () => {
  themeConfig.value = makeTheme();
});
</script>

<style>
#app {
  width: 100%;
  height: 100vh;
}
</style>
