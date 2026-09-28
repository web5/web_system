<template>
  <!-- width/height 是**内建尺寸**（不是视觉规格）：CSS 未就位时 svg 会撑到浏览器默认
       的 300×150，加载期出现「巨大橙色图标」一闪。CSS 里 .app-icon=16px/.is-lg=20px
       优先级高于属性，稳态取值不变。 -->
  <svg
    class="app-icon"
    :class="{ 'is-lg': size === 'lg' }"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ICONS, type IconName } from '@/config/icons';

const props = withDefaults(defineProps<{ name: IconName; size?: 'md' | 'lg' }>(), {
  size: 'md',
});

const paths = computed<string[]>(() => [...(ICONS[props.name] || [])]);
</script>

<style scoped>
.app-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.app-icon.is-lg {
  width: 20px;
  height: 20px;
}
</style>
