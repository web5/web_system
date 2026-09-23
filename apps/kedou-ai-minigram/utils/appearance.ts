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

/** 写入偏好（页面切换后由调用方自行刷新 class） */
export function setStyle(style: RadiusStyle): void {
  wx.setStorageSync(STORAGE_KEY, style);
}
