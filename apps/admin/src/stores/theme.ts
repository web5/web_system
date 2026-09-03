import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ThemeMode = 'dark' | 'light';

export const useThemeStore = defineStore(
  'theme',
  () => {
    // 默认 light：2026-09-03 D 裁决（负责人要求 admin 默认亮色），
    // 与 @web-system/ui light canonical 同极性（:root=light + [data-theme=dark]）
    const mode = ref<ThemeMode>('light');

    const isDark = computed(() => mode.value === 'dark');

    function applyTheme() {
      document.documentElement.setAttribute('data-theme', mode.value);
    }

    function toggleTheme() {
      mode.value = mode.value === 'dark' ? 'light' : 'dark';
      applyTheme();
    }

    function initTheme() {
      applyTheme();
    }

    return { mode, isDark, toggleTheme, initTheme };
  },
  {
    persist: {
      key: 'theme-store',
      storage: localStorage,
    },
  }
);
