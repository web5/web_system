import { theme } from 'ant-design-vue';
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context';

/** AntD 主题（科豆 AI 品牌规范）
 * - 默认深色算法：与 tokens.css 的 :root（深色）一致
 * - 品牌色 #F97316：主按钮 / 链接 / 选中态
 */
export const antdTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#F97316',
    colorInfo: '#F97316',
    colorLink: '#F97316',
    borderRadius: 6,
  },
};
