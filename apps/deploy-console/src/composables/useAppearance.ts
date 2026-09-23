import { ref } from 'vue'
import type { UiRadiusStyle } from '@web-system/ui'

/**
 * 界面偏好（deploy-console）。
 *
 * 当前只有「圆角风格」三档（柔和 / 清爽 / 直角）。
 * deploy-console 没有 pinia 偏好 store（theme 也只是组件内 ref、被动读 `data-theme`），
 * 故用 module-level 单例 ref + localStorage + 根属性承载。
 * key 与 admin 的 `theme-store` 同源：同一 origin 下复用同一份偏好（口径 specs/radius-style-dual §4.4）。
 */
const PREF_KEY = 'theme-store'

export const RADIUS_OPTIONS: Array<{ value: UiRadiusStyle; label: string; desc: string }> = [
  { value: 'soft', label: '柔和', desc: '圆角更大更圆润（默认）' },
  { value: 'crisp', label: '清爽', desc: '圆角更小更利落' },
  { value: 'sharp', label: '直角', desc: '无圆角，硬朗利落' },
]

export const radiusStyle = ref<UiRadiusStyle>('soft')

function isRadius(v: unknown): v is UiRadiusStyle {
  return v === 'soft' || v === 'crisp' || v === 'sharp'
}

/** 从 localStorage 恢复偏好（App 挂载时调用；首次访问即默认柔和） */
export function loadAppearance(): void {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    const s = raw ? JSON.parse(raw) : {}
    if (isRadius(s.radiusStyle)) radiusStyle.value = s.radiusStyle
  } catch {
    /* 默认柔和 */
  }
}

/** 切换圆角风格：写根属性（驱动 tokens.css 覆盖块）+ 落 localStorage（与 admin 同 key 时字段合并） */
export function setRadiusStyle(v: UiRadiusStyle): void {
  radiusStyle.value = v
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-radius', v)
  try {
    const raw = localStorage.getItem(PREF_KEY)
    const s = raw ? JSON.parse(raw) : {}
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...s, radiusStyle: v }))
  } catch {
    /* 忽略存储失败 */
  }
}
