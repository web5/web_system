/**
 * @web-system/ui — 语义设计 Token（唯一事实源，单份定义）
 *
 * ⚠️ 铁律：packages/ui/src/tokens.css 的 CSS 变量数值必须与本文件一致。
 * 当前为人工同步（自动生成 tokens.css 留 TODO）。
 *
 * 主题裁决（DR 表，见 docs/ui/geist-token-需求文档.md §9）：
 * - DR-3：品牌主橙 = #F97316（antd 现行 / tokens.css 现行）；#FF8C42 降级为暖橙强调
 *   accent，仅用于 hover / 图表 / 装饰强调，不参与主交互。
 * - DR-4：light 为 canonical（:root），dark 由 [data-theme='dark'] 全量镜像，开关即可用。
 *
 * 范式（Geist 语义 scale）：颜色每一步数字编码 intent——
 *   100 默认背景 / 200 hover / 400 边框 / 700 实心 / 900 次文本 / 1000 主文本；
 * dark 下"同数字、镜像深浅"，不新增命名。
 */

export const uiTokens = {
  colors: {
    /** 品牌橙 scale：沿用仓库既有 Tailwind orange 系值，补齐 300/800/900 */
    brand: {
      50: '#FFF7ED',
      100: '#FFEDD5',
      200: '#FED7AA',
      300: '#FDBA74',
      400: '#FB923C',
      500: '#F97316',
      600: '#EA580C',
      700: '#C2410C',
      800: '#9A3412',
      900: '#7C2D12',
    },
    /** 暖橙强调（DR-3：accent 角色，hover/图表等装饰强调） */
    accent: '#FF8C42',
    /** 中性灰 scale（Geist 纯净灰阶，弃用 Element Plus 蓝调灰）。
     *  light 数字越大越深；dark 同数字镜像深浅（100 最暗 ↔ 1000 最亮）。 */
    gray: {
      light: {
        100: '#FAFAFA',
        200: '#F2F2F2',
        300: '#EBEBEB',
        400: '#E5E5E5',
        500: '#D4D4D4',
        600: '#A3A3A3',
        700: '#737373',
        800: '#525252',
        900: '#262626',
        1000: '#171717',
      },
      dark: {
        100: '#0A0A0A',
        200: '#111111',
        300: '#1A1A1A',
        400: '#2A2A2A',
        500: '#333333',
        600: '#525252',
        700: '#737373',
        800: '#A3A3A3',
        900: '#D4D4D4',
        1000: '#EDEDED',
      },
    },
    /** 语义色（antd 对齐）：100 = 底色 / 500 = 主色；dark 下底色深调、主色略亮 */
    success: {
      light: { 100: '#EAF6EC', 500: '#398E4A' },
      dark: { 100: '#16301C', 500: '#4CAA5E' },
    },
    /** warning 用 Geist amber 系（#F5A623 / #BA7517 区间），弃 antd 默认 */
    warning: {
      light: { 100: '#FEF3DC', 500: '#F5A623' },
      dark: { 100: '#332A14', 500: '#F5A623' },
    },
    error: {
      light: { 100: '#FCEBEC', 500: '#E5484D' },
      dark: { 100: '#3A1F21', 500: '#F2555A' },
    },
    /** 信息色沿用品牌橙（Geist 用蓝做交互，本项目 DR：交互点缀 = 橙，蓝仅预留第三方链接） */
    info: {
      light: { 100: '#FFF7ED', 500: '#F97316' },
      dark: { 100: '#33220F', 500: '#FB923C' },
    },
  },
  /** 语义角色层：业务优先引用这层，别直接抓 scale */
  roles: {
    light: {
      bgPage: '#FAFAFA', // gray-100 页面底
      bgSurface: '#FFFFFF', // 卡片 / 容器面
      bgElevated: '#FFFFFF', // 弹层 / 下拉
      bgSubtle: '#F2F2F2', // gray-200 表头 / hover / 次级填充
      bgHover: '#F2F2F2',
      bgActive: '#EBEBEB', // gray-300 按压高亮（R3 补：hover→active 阶梯）
      textPrimary: '#171717', // gray-1000
      textSecondary: '#525252', // gray-800
      textTertiary: '#A3A3A3', // gray-600
      textDisabled: '#D4D4D4', // gray-500
      border: '#E5E5E5', // gray-400 默认边框
      borderSubtle: '#EBEBEB', // gray-300 分隔 / 表行边框
      inputBg: '#FFFFFF',
      inputBorder: '#E5E5E5',
      inputPlaceholder: '#A3A3A3',
      overlay: 'rgba(0, 0, 0, 0.5)',
      loginGradient: 'linear-gradient(135deg, #FAFAFA 0%, #FFFFFF 100%)',
      loginBoxBg: '#FFFFFF',
      loginTitle: '#171717',
    },
    dark: {
      bgPage: '#0A0A0A',
      bgSurface: '#1A1A1A',
      bgElevated: '#242424',
      bgSubtle: '#111111',
      bgHover: '#2A2A2A',
      bgActive: '#333333', // 按压微亮（初值，dark 阶梯待评审微调）
      textPrimary: '#EDEDED',
      textSecondary: '#A3A3A3',
      textTertiary: '#737373',
      textDisabled: '#525252',
      border: '#2A2A2A',
      borderSubtle: '#333333',
      inputBg: '#1A1A1A',
      inputBorder: '#2A2A2A',
      inputPlaceholder: '#737373',
      overlay: 'rgba(0, 0, 0, 0.6)',
      loginGradient: 'linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)',
      loginBoxBg: '#1A1A1A',
      loginTitle: '#EDEDED',
    },
  },
  /** 圆角：antd 全局 borderRadius 保持 4（裁决：不动 4→6）；md/lg 供卡片/大面可选 */
  radius: { sm: 4, md: 6, lg: 8, pill: 9999 },
  /** 间距（antd 惯例 4 的倍数） */
  space: { 4: 4, 8: 8, 12: 12, 16: 16, 24: 24, 32: 32, 48: 48 },
  /** 阴影：双层柔和；暗色下以边框为主、阴影加深为辅 */
  shadow: {
    card: {
      light: '0 1px 2px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04)',
      dark: '0 1px 2px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)',
    },
    popover: {
      light: '0 2px 8px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.08)',
      dark: '0 2px 8px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(0, 0, 0, 0.45)',
    },
  },
  /** Typography：不引 Geist 字体（P2-2），西文 Inter + 中文系统回退 */
  font: {
    sans: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`,
    mono: `'Geist Mono', 'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace`,
    /** 标题梯度对齐 antd fontSize 体系（h1 32 / h2 24 / h3 18 / h4 16 / 正文 14 / caption 12） */
    size: { h1: 32, h2: 24, h3: 18, h4: 16, base: 14, caption: 12 },
    /** 字重哲学：只用 400/500/600 */
    weight: { regular: 400, medium: 500, semibold: 600 },
  },
} as const;

export type UiTokens = typeof uiTokens;
/** light | dark 双主题模式 */
export type UiThemeMode = keyof (typeof uiTokens)['colors']['gray'];
