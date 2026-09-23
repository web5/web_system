import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { UiRadiusStyle } from '@web-system/ui';

export type ThemeMode = 'dark' | 'light';

/** 圆角风格三档（与 packages/ui 的 radiusStyle 同源；口径 specs/radius-style-dual §4.3） */
export const RADIUS_OPTIONS: Array<{ value: UiRadiusStyle; label: string; desc: string }> = [
  { value: 'soft', label: '柔和', desc: '圆角更大更圆润（默认）' },
  { value: 'crisp', label: '清爽', desc: '圆角更小更利落' },
  { value: 'sharp', label: '直角', desc: '无圆角，硬朗利落' },
];

export const useThemeStore = defineStore(
  'theme',
  () => {
    // 默认 light：2026-09-03 D 裁决（负责人要求 admin 默认亮色），
    // 与 @web-system/ui light canonical 同极性（:root=light + [data-theme=dark]）
    const mode = ref<ThemeMode>('light');
    /** 圆角风格（用户偏好）：柔和 / 清爽 / 直角 —— 写到根元素 data-radius，由 tokens.css 覆盖块驱动 */
    const radiusStyle = ref<UiRadiusStyle>('soft');

    const isDark = computed(() => mode.value === 'dark');

    /** 主题 + 圆角偏好一起落到根元素（antd 侧由 App.vue 的 themeConfig 同步，见该文件注释） */
    function applyTheme() {
      document.documentElement.setAttribute('data-theme', mode.value);
      document.documentElement.setAttribute('data-radius', radiusStyle.value);
    }

    function toggleTheme() {
      mode.value = mode.value === 'dark' ? 'light' : 'dark';
      applyTheme();
    }

    function setRadiusStyle(next: UiRadiusStyle) {
      radiusStyle.value = next;
      applyTheme();
    }

    function initTheme() {
      applyTheme();
    }

    return { mode, isDark, radiusStyle, toggleTheme, setRadiusStyle, initTheme };
  },
  {
    persist: {
      key: 'theme-store',
      storage: localStorage,
    },
  }
);
