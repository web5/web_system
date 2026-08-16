import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ThemeMode = 'dark' | 'light';

export const useThemeStore = defineStore(
  'theme',
  () => {
    // 默认 dark：与 style.css 的 :root（"Dark default + Light"）保持一致
    const mode = ref<ThemeMode>('dark');

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
