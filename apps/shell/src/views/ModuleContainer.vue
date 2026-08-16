<template>
  <div id="module-container" :data-module="moduleName" class="module-container" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { MicroFrontendLoader } from '@web-system/shell-loader';

const route = useRoute();
const router = useRouter();
const containerRef = ref<HTMLElement | null>(null);
// 当前模块名（/portal/ → portal），作为 CSS scope 前缀 [data-module="portal"] 的锚点
const moduleName = computed(() => (route.params.module as string) || '');

// loader 由 main.ts 提前挂到 window.__LOADER__
const loader = (window as any).__LOADER__ as MicroFrontendLoader;

async function mountModule(name: string) {
  if (!name || !containerRef.value) return;
  // 未知模块 → 404
  if (!loader.has(name)) {
    console.warn(`[shell] 未知模块: ${name}，跳转 404`);
    router.replace({ name: 'NotFound' });
    return;
  }
  containerRef.value.setAttribute('data-module', name);
  try {
    console.log(`[shell] mountModule call: ${name}`);
    await loader.mount(name, containerRef.value);
    console.log(`[shell] mounted module: ${name}`);
  } catch (e) {
    console.error(`[shell] 挂载模块 ${name} 失败:`, e);
  }
}

// 组件渲染完成后（DOM 已存在）挂载模块
onMounted(async () => {
  await mountModule(moduleName.value);
});

// 模块切换：先卸载旧的，再挂载新的
watch(moduleName, async (name, oldName) => {
  if (oldName && oldName !== name) {
    await loader.unmount(oldName);
  }
  await mountModule(name);
});

// 离开模块路由时卸载
onUnmounted(async () => {
  await loader.unmount(moduleName.value);
});
</script>

<style>
.module-container {
  min-height: 100vh;
}
</style>
