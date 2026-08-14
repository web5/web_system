import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context';

/** AntD 主题（科豆 AI 品牌规范）
 * - 仅定义品牌色 token；算法由各业务 app 自行决定（mcp-admin 用浅色、admin-web 用主题切换）
 * - 品牌色 #F97316：主按钮 / 链接 / 选中态
 */
export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: '#F97316',
    colorInfo: '#F97316',
    colorLink: '#F97316',
    borderRadius: 6,
  },
};
