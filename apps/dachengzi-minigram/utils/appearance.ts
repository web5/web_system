import { get, request } from './request';

/**
 * 圆角风格偏好（品牌端小程序）。
 *
 * 与 portal 的 `stores/ui-prefs.ts` 同口径：soft 柔和（默认）/ crisp 清爽 / sharp 直角，
 * 三档取值见 `packages/ui/src/tokens.ts` 的 radiusStyle（落地按 1px ≈ 2rpx）。
 *
 * 小程序没有 DOM，无法像 Web 那样改 `documentElement`：
 * 圆角变量定义在 `app.wxss` 的 `page` 选择器上（全局继承），
 * 切换靠各页根节点 `<view class="page {{radiusClass}}">` 叠加
 * `.radius-crisp` / `.radius-sharp` 覆盖类。
 *
 * 口径：specs/radius-style-dual/page-spec.md §4.2；原型 docs/ui/prototypes/radius-style-dual.html
 */
export type RadiusStyle = 'soft' | 'crisp' | 'sharp';

/** 本地存储 key（与 portal 的 `ui-prefs` 各端独立，不做跨端同步） */
export const STORAGE_KEY = 'appearance_radius';

export const DEFAULT_STYLE: RadiusStyle = 'soft';

export const STYLE_OPTIONS: Array<{ value: RadiusStyle; label: string }> = [
  { value: 'soft', label: '柔和' },
  { value: 'crisp', label: '清爽' },
  { value: 'sharp', label: '直角' },
];

/** 读取当前风格（非法值一律回退柔和） */
export function currentStyle(): RadiusStyle {
  const v = wx.getStorageSync(STORAGE_KEY);
  return v === 'crisp' || v === 'sharp' ? v : DEFAULT_STYLE;
}

/** 当前应叠加在页面根节点上的 class（柔和 = 空串，即走 page 上的默认变量） */
export function currentClass(): string {
  const s = currentStyle();
  return s === DEFAULT_STYLE ? '' : `radius-${s}`;
}

export function labelOf(style: RadiusStyle = currentStyle()): string {
  const hit = STYLE_OPTIONS.find((o) => o.value === style);
  return hit ? hit.label : '柔和';
}

/** 写入偏好（页面切换后由调用方自行刷新 class）；默认同时上报服务端 */
export function setStyle(style: RadiusStyle, options?: { silent?: boolean }): void {
  wx.setStorageSync(STORAGE_KEY, style);
  if (!options?.silent) pushToServer(style);
}

/** 服务端响应对齐 user-service 的 TransformInterceptor：{ code, data, message } */
interface WrappedMe {
  data?: { preferences?: { radiusStyle?: string } | null } | null;
}

/** 服务端返回值校验（非法值一律忽略，保持本地） */
function isRadius(v: unknown): v is RadiusStyle {
  return v === 'soft' || v === 'crisp' || v === 'sharp';
}

/**
 * 上报到服务端（跟账号同步）。
 * 失败只记日志：**不回滚已应用的本地值、不打扰用户**，下次启动以服务端为准收敛。
 * 口径：specs/radius-style-dual/page-spec-pref-sync.md §4.2 / §5
 */
function pushToServer(style: RadiusStyle): void {
  // silent：本地乐观应用 + 后台同步，失败只记日志、不弹 toast、不回滚（规格 §5 / AC7）
  request<WrappedMe>({
    url: '/users/me',
    method: 'PUT',
    data: { preferences: { radiusStyle: style } },
    silent: true,
  }).catch((err: unknown) => {
    console.warn('[appearance] 界面偏好上报失败，已保留本地值', err);
  });
}

/**
 * 跟账号同步：以**服务端为准**收敛本地（登录后由 app.ts 调用）。
 * 服务端为空（用户从未设置过）⇒ 保持本地值，不覆盖；未登录 / 断网 ⇒ 保持本地值。
 */
export async function applyFromServer(): Promise<void> {
  try {
    const res = await get<WrappedMe>('/users/me');
    const server = res?.data?.preferences?.radiusStyle;
    if (!isRadius(server) || server === currentStyle()) return;
    setStyle(server, { silent: true });
  } catch (err) {
    console.warn('[appearance] 界面偏好同步失败，已保留本地值', err);
  }
}
