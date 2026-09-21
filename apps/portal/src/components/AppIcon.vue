<template>
  <svg
    class="app-icon"
    :class="{ 'is-lg': size === 'lg' }"
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
