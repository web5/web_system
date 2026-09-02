<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ConfigProvider } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { antdTheme } from '@web-system/ui'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

// 跟随 <html data-theme="dark"> 切换 antd 主题（P0-5：改 html 属性即可验证 dark）
const themeMode = ref<'light' | 'dark'>('light')
const theme = computed(() => antdTheme(themeMode.value))
let themeObserver: MutationObserver | null = null

function syncThemeFromDom() {
  const m = document.documentElement.getAttribute('data-theme')
  themeMode.value = m === 'dark' ? 'dark' : 'light'
}

onMounted(() => {
  syncThemeFromDom()
  themeObserver = new MutationObserver(syncThemeFromDom)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
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
