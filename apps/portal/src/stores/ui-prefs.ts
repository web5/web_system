import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * 界面偏好（用户级）。
 *
 * 当前只含「圆角风格」：柔和 / 清爽 / 直角 —— 与 packages/ui 的三档语义档一致。
 * 实现方式：把偏好写到根元素 `<html data-radius="...">`，由
 * `@web-system/ui/tokens.css` 的 `[data-radius]` 覆盖块驱动全站圆角。
 *
 * 口径来源：specs/radius-style-dual/page-spec.md §3；原型 docs/ui/prototypes/radius-style-dual.html
 * 注意：尺寸档与语义档的覆盖必须落在**同一元素**（html）上，故组件内不得再挂 data-radius。
 */
export type RadiusStyle = 'soft' | 'crisp' | 'sharp';

export const DEFAULT_RADIUS_STYLE: RadiusStyle = 'soft';

/** 设置项文案（与原型四端设置形态一致） */
export const RADIUS_STYLE_OPTIONS: Array<{ value: RadiusStyle; label: string; desc: string }> = [
  { value: 'soft', label: '柔和', desc: '圆角更大更圆润（默认）' },
  { value: 'crisp', label: '清爽', desc: '圆角更小更利落' },
  { value: 'sharp', label: '直角', desc: '无圆角，硬朗利落' },
];

/** 把偏好写到根元素（portal 原本没有任何主题层，这里自建写入器） */
export function applyRadiusStyle(style: RadiusStyle): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-radius', style);
}

export const useUiPrefsStore = defineStore(
  'ui-prefs',
  () => {
    const radiusStyle = ref<RadiusStyle>(DEFAULT_RADIUS_STYLE);

    function setRadiusStyle(next: RadiusStyle) {
      radiusStyle.value = next;
      applyRadiusStyle(next);
    }

    /** 挂载时把持久化的偏好刷到根元素（首次访问即默认「柔和」） */
    function init() {
      applyRadiusStyle(radiusStyle.value);
    }

    return { radiusStyle, setRadiusStyle, init };
  },
  {
    persist: {
      key: 'ui-prefs',
      storage: localStorage,
    },
  },
);
