import { defineStore } from 'pinia';
import { ref, watch, type WatchStopHandle } from 'vue';
import { updateUiPreferences } from '@/api/user';

/**
 * user-store 的最小接口（避免 ui-prefs 与 user-store 直接 import 形成循环依赖）。
 * main-standalone 与 lifecycle 都注入同一份 useUserStore() 实例。
 */
export interface UserStoreLike {
  readonly userInfo: { preferences?: { radiusStyle?: RadiusStyle } | null } | null;
  fetchUserInfo?: () => Promise<unknown>;
}

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
/**
 * 圆角风格三档：soft 柔和（默认）/ crisp 清爽 / sharp 直角。
 * 与 packages/shared 的 UiRadiusStyle 取值一致（此处本地声明：本包 TS 解析不到 @web-system/types，
 * 见 specs/radius-style-dual/page-spec-pref-sync.md §5.2）。
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

/**
 * 绑定「用户偏好同步」：监听 userInfo.preferences，一旦登录/拉到用户信息就以服务端为准收敛本地 uiPrefs。
 *
 * 同时主动调一次 `userStore.fetchUserInfo()`（已登录就拉一次，未登录直接失败静默），
 * 确保 AC2「换设备登录 → 页面圆角立即随服务端收敛」对**每一种 mount 入口**都成立。
 *
 * 调用方：
 * - `lifecycle.ts`：mount 时调，unmount 时把返回值作为 stopPrefSync 调一下即可清理
 * - `main-standalone.ts`：启动时调，单页应用全程不需要停
 *
 * 为什么不直接 import useUserStore：避免 ui-prefs ↔ user-store 间形成循环依赖（user-store 也不会 import ui-prefs）。
 * 改为 duck-typing 注入：调用方保证传的是 `useUserStore(pinia)` 的返回值。
 *
 * 口径：specs/radius-style-dual/page-spec-pref-sync.md §4.1 / AC2
 */
export function bindUserPrefsSync(
  userStore: UserStoreLike,
  uiPrefs: ReturnType<typeof useUiPrefsStore>,
): WatchStopHandle {
  // 同时监听 userInfo 整个引用变化与 preferences 字段变化——
  // 用户信息和 preferences 是嵌套的，setUserInfo 整体替换 userInfo 也能触发；
  // 已在 login 路径靠 LoginPanel.vue setUserInfo(res.user) 单次拉齐，该 watcher 即覆盖该场景。
  const stop = watch(
    () => (userStore.userInfo as { preferences?: { radiusStyle?: RadiusStyle } | null } | null)?.preferences,
    (prefs) => uiPrefs.syncFromServer(prefs),
    { immediate: true },
  );
  // 已登录就主动拉一次，确保即便 hydrate 时已经把旧 userInfo 持久化了，仍能拉到服务端的最新 preferences。
  void userStore.fetchUserInfo?.().catch(() => undefined);
  return stop;
}
