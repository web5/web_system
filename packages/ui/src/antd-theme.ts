import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context';
import { uiTokens, type UiThemeMode } from './tokens';

/**
 * AntD 主题适配层（ant-design-vue 4.2.x / antd v5 token）
 * - 该版本多数组件样式收敛到全局 AliasToken（表头=colorFillAlter、容器=colorBgContainer、
 *   Card 边框=colorBorderSecondary、Modal 浮层=colorBgElevated），故以全局 token 为主。
 * - 组件级 token 仅类型支持的写 components（Layout/Menu）。
 * - dark = antdTheme('dark')，App 侧按 data-theme 调用。
 * - DR：主色 #F97316；圆角保持 4。
 */
const t = uiTokens;
const SIDER_BG = '#171717';
const BRAND_BG_SOFT = 'rgba(249, 115, 22, 0.12)';

export function antdTheme(mode: UiThemeMode = 'light'): ThemeConfig {
  const isDark = mode === 'dark';
  const gray = t.colors.gray[mode];
  const roles = t.roles[mode];
  const brand = t.colors.brand;

  return {
    token: {
      colorPrimary: brand[500],
      colorInfo: t.colors.info[mode][500],
      colorSuccess: t.colors.success[mode][500],
      colorWarning: t.colors.warning[mode][500],
      colorError: t.colors.error[mode][500],
      colorLink: brand[500],
      colorLinkHover: brand[400],
      colorLinkActive: brand[600],
      colorTextBase: gray[1000],
      colorText: roles.textPrimary,
      colorTextHeading: roles.textPrimary,
      colorTextSecondary: roles.textSecondary,
      colorTextDescription: roles.textTertiary,
      colorTextLabel: roles.textSecondary,
      colorTextTertiary: roles.textTertiary,
      colorTextQuaternary: roles.textDisabled,
      colorTextPlaceholder: roles.inputPlaceholder,
      colorTextDisabled: roles.textDisabled,
      colorIcon: roles.textTertiary,
      colorIconHover: roles.textSecondary,
      colorPrimaryHover: brand[400],
      colorPrimaryActive: brand[600],
      colorPrimaryText: brand[500],
      colorPrimaryTextHover: brand[400],
      colorPrimaryTextActive: brand[600],
      colorPrimaryBg: BRAND_BG_SOFT,
      colorPrimaryBgHover: 'rgba(249, 115, 22, 0.16)',
      colorPrimaryBorder: brand[500],
      colorPrimaryBorderHover: brand[400],
      colorBgLayout: roles.bgPage,
      colorBgContainer: roles.bgSurface,
      colorBgElevated: roles.bgElevated,
      colorBgSpotlight: isDark ? '#333333' : '#171717',
      colorBgMask: roles.overlay,
      colorBorder: roles.border,
      colorBorderSecondary: roles.borderSubtle,
      colorSplit: roles.borderSubtle,
      colorFillAlter: roles.bgSubtle,
      colorFillContent: roles.bgSubtle,
      colorFillContentHover: roles.bgHover,
      colorFillSecondary: roles.bgSubtle,
      colorFillTertiary: roles.bgHover,
      colorFillQuaternary: roles.bgSubtle,
      controlItemBgHover: roles.bgHover,
      controlItemBgActive: BRAND_BG_SOFT,
      boxShadow: t.shadow.card[mode],
      boxShadowSecondary: t.shadow.popover[mode],
      borderRadius: t.radius.sm,
      controlHeight: 32,
      fontFamily: t.font.sans,
      fontSize: t.font.size.base,
      fontWeightStrong: t.font.weight.semibold,
      wireframe: false,
    },
    components: {
      Layout: {
        colorBgBody: roles.bgPage,
        colorBgHeader: roles.bgSurface,
        colorBgTrigger: SIDER_BG,
      },
      Menu: {
        colorItemBg: 'transparent',
        colorItemText: roles.textSecondary,
        colorItemTextHover: roles.textPrimary,
        colorItemTextSelected: brand[600],
        colorItemBgHover: roles.bgSubtle,
        colorItemBgActive: BRAND_BG_SOFT,
        colorItemBgSelected: BRAND_BG_SOFT,
      },
    },
  };
}

/** Light 主题便捷引用 */
export const antdThemeLight: ThemeConfig = antdTheme('light');
