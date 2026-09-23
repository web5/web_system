<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { antdTheme } from '@web-system/ui'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { radiusStyle, loadAppearance } from '@/composables/useAppearance'

dayjs.locale('zh-cn')

// 跟随 <html data-theme="dark"> 切换 antd 主题（P0-5：改 html 属性即可验证 dark）
const themeMode = ref<'light' | 'dark'>('light')

// deploy-console 外壳固定深色（sider/header 反白面板，不随 data-theme）：
// - Header 背景 → antd Layout 有 colorBgHeader token，在此覆盖（共享 antdTheme 保持中性，避免污染未来 admin）
// - Sider 背景 → Layout 无 siderBg token，由 MainLayout.vue scoped :deep 高特异提供（R4，禁 !important）
// 值须与 style.scss :root 的 --dc-panel-header-bg 同源（R4，防双份漂移）
const SHELL_HEADER_BG = '#161618'
// 圆角风格来自 composables/useAppearance（用户偏好三档；口径 specs/radius-style-dual §4.4）
const theme = computed(() => {
  const base = antdTheme(themeMode.value, radiusStyle.value)
  return {
    ...base,
    components: {
      ...base.components,
      Layout: { ...base.components?.Layout, colorBgHeader: SHELL_HEADER_BG },
    },
  }
})
let themeObserver: MutationObserver | null = null

function syncThemeFromDom() {
  const m = document.documentElement.getAttribute('data-theme')
  themeMode.value = m === 'dark' ? 'dark' : 'light'
  // 圆角偏好同样写在这个根元素上，外部（内联预置/其他模块）改动也需同步
  const r = document.documentElement.getAttribute('data-radius')
  if (r === 'crisp' || r === 'sharp' || r === 'soft') radiusStyle.value = r
}

onMounted(() => {
  loadAppearance()
  syncThemeFromDom()
  themeObserver = new MutationObserver(syncThemeFromDom)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    // 圆角偏好与主题同挂根元素，一并监听（否则属性变更不触发同步）
    attributeFilter: ['data-theme', 'data-radius'],
  })
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
})
</script>

<template>
  <ConfigProvider :locale="zhCN" :theme="theme">
    <router-view />
  </ConfigProvider>
</template>
