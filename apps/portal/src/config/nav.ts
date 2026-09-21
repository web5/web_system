/**
 * 一级导航配置（顶栏横向 tab）。
 *
 * 来源：specs/portal-redesign/page-spec.md §1 —— 菜单由 `AppNavbar.vue` 硬编码改为配置化；
 * 「我的」不上顶栏，收进右上角头像下拉菜单。
 *
 * 两个开关决定三栏外壳的左右两栏：
 * - `sideList`：左栏只在**有记录 / 信息语义**的视图显示；入口网格视图（发现 / 实验室）整体隐藏。
 * - `context`：右栏仅合翻报告（合同原文）与翻译（术语库）渲染；未启用时整体不占位（非留白）。
 */
import type { IconName } from './icons';

export type NavKey = 'welcome' | 'chat' | 'discover' | 'translate' | 'contract' | 'lab';

export interface NavItem {
  key: NavKey;
  label: string;
  /** 路由地址 */
  to: string;
  icon: IconName;
  /** 左栏：是否显示记录列表 */
  sideList: boolean;
  /** 左栏标题（sideList 为 true 时生效） */
  listTitle: string;
  /** 右栏：是否渲染上下文面板 */
  context: boolean;
  /** 建设中：跳转后页面为占位态 */
  soon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'welcome',
    label: '开始',
    to: '/',
    icon: 'home',
    sideList: true,
    listTitle: '最近对话',
    context: false,
  },
  {
    key: 'chat',
    label: '对话',
    to: '/chat',
    icon: 'chat',
    sideList: true,
    listTitle: '会话',
    context: false,
  },
  {
    key: 'discover',
    label: '发现',
    to: '/discover',
    icon: 'grid',
    // 入口网格视图：左栏与中栏卡片语义重复，整体隐藏左栏
    sideList: false,
    listTitle: '能力',
    context: false,
    soon: true,
  },
  {
    key: 'translate',
    label: '翻译',
    to: '/translate',
    icon: 'lang',
    sideList: true,
    listTitle: '会话',
    // P2 翻译工作台启用术语库面板后打开
    context: false,
    soon: true,
  },
  {
    key: 'contract',
    label: '合翻',
    to: '/contract',
    icon: 'doc',
    sideList: true,
    listTitle: '会话',
    // P3 合翻报告启用原文对照面板后打开
    context: false,
    soon: true,
  },
  {
    key: 'lab',
    label: '实验室',
    to: '/lab',
    icon: 'flask',
    sideList: false,
    listTitle: '实验功能',
    context: false,
  },
];

/**
 * 按当前路径匹配一级导航项。
 * `/lab/*` 归入「实验室」；未命中（如 `/login`、`/profile`）返回 null，外壳据此收起左右两栏。
 */
export function matchNavItem(path: string): NavItem | null {
  const normalized = path.replace(/\/+$/, '') || '/';
  if (normalized.startsWith('/lab')) return NAV_ITEMS.find((i) => i.key === 'lab') ?? null;
  const hit = NAV_ITEMS.find((i) => i.to === normalized);
  return hit ?? null;
}

export function findNavItem(key: NavKey): NavItem | null {
  return NAV_ITEMS.find((i) => i.key === key) ?? null;
}
