import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type ThemeMode = 'dark' | 'light';

export const useThemeStore = defineStore(
  'theme',
  () => {
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
