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
    renderMountError(containerRef.value, name, e);
  }
}

/**
 * 挂载失败时给出可见反馈。
 * 此前只 console.error：容器里什么都没有，用户看到的就是"一片空白 + 一直 loading"，
 * 且不打开控制台就完全无从判断。这里把失败原因直接渲染到容器里。
 */
function renderMountError(container: HTMLElement, name: string, err: unknown) {
  const msg = (err as Error)?.message || String(err);
  const box = document.createElement('div');
  box.className = 'module-error';

  const title = document.createElement('p');
  title.className = 'module-error__title';
  title.textContent = `模块「${name}」加载失败`;

  const detail = document.createElement('p');
  detail.className = 'module-error__detail';
  detail.textContent = msg;

  const action = document.createElement('p');
  action.className = 'module-error__action';
  action.textContent = '请刷新页面重试；若持续失败，请打开浏览器控制台与 Network 面板查看具体资源。';

  box.appendChild(title);
  box.appendChild(detail);
  box.appendChild(action);
  container.innerHTML = '';
  container.appendChild(box);
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
.module-error {
  max-width: 640px;
  margin: 15vh auto 0;
  padding: 20px 24px;
  border: 1px solid #ffccc7;
  border-radius: 8px;
  background: #fff2f0;
  color: #cf1322;
  line-height: 1.7;
}
.module-error__title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
}
.module-error__detail {
  margin: 0 0 8px;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.module-error__action {
  margin: 0;
  color: #8c8c8c;
  font-size: 12px;
}
</style>
