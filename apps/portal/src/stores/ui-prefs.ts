import { defineStore } from 'pinia';
import { ref } from 'vue';
import { updateUiPreferences } from '@/api/user';
import type { UiRadiusStyle } from '@web-system/types';

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
/** 圆角风格三档（与 packages/shared 的 UiRadiusStyle 同源，避免各写一份） */
export type RadiusStyle = UiRadiusStyle;

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

    /**
     * 上报到服务端（跟账号同步）。
     * 失败只记日志：**不回滚已应用的本地值、不弹错** —— 下次登录/启动以服务端为准收敛。
     * 口径：specs/radius-style-dual/page-spec-pref-sync.md §5
     */
    function pushToServer(next: RadiusStyle) {
      void updateUiPreferences({ radiusStyle: next }).catch((err: unknown) => {
        console.warn('[ui-prefs] 界面偏好上报失败，已保留本地值', err);
      });
    }

    /** @param options.silent 来自服务端的收敛不再回写，避免无谓请求 */
    function setRadiusStyle(next: RadiusStyle, options?: { silent?: boolean }) {
      radiusStyle.value = next;
      applyRadiusStyle(next);
      if (!options?.silent) pushToServer(next);
    }

    /**
     * 跟账号同步：以**服务端为准**收敛本地（登录/启动后调用）。
     * 服务端为空（用户从未设置过）⇒ 保持本地值，不覆盖。
     */
    function syncFromServer(prefs?: { radiusStyle?: RadiusStyle } | null) {
      const server = prefs?.radiusStyle;
      if (!server || server === radiusStyle.value) return;
      setRadiusStyle(server, { silent: true });
    }

    /** 挂载时把持久化的偏好刷到根元素（首次访问即默认「柔和」） */
    function init() {
      applyRadiusStyle(radiusStyle.value);
    }

    return { radiusStyle, setRadiusStyle, syncFromServer, init };
  },
  {
    persist: {
      key: 'ui-prefs',
      storage: localStorage,
    },
  },
);
