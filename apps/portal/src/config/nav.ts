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
  /**
   * 顶栏是否展示（2026-09-23 顶栏收口：翻译 / 合翻收进「发现」，顶栏不占位）。
   * 缺省 = true；false 时顶栏不渲染本项，高亮落到 `parent`。
   */
  topLevel?: boolean;
  /** 顶栏不展示时的高亮归属（进入能力页时顶栏亮「发现」） */
  parent?: NavKey;
  /** 左栏下半区是否展示「能力」（换能力 / 回发现的出口，2026-09-23） */
  caps?: boolean;
  /** 左栏上半记录来源：chat=主对话（默认）/ tool=工具页（2026-09-23） */
  listSource?: 'chat' | 'tool';
  /** 左栏上半记录按能力过滤（translate / contract-risk） */
  listAgentId?: string;
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
    caps: true,
  },
  {
    key: 'chat',
    label: '对话',
    to: '/chat',
    icon: 'chat',
    sideList: true,
    listTitle: '会话',
    context: false,
    caps: true,
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
  },
  {
    key: 'translate',
    label: '翻译',
    to: '/translate',
    icon: 'lang',
    // 翻译工作台（P2 落码）：纯中栏工作台；左栏「翻译记录」2026-09-23 开启（后端已支持 source/agentId 过滤）
    sideList: true,
    listTitle: '翻译记录',
    listSource: 'tool',
    listAgentId: 'translate',
    context: false,
    caps: true,
    // 2026-09-23 顶栏收口：收进「发现」能力卡片，顶栏不占位
    topLevel: false,
    parent: 'discover',
  },
  {
    key: 'contract',
    label: '合翻',
    to: '/contract',
    icon: 'doc',
    // 左栏「体检记录」2026-09-23 开启（source=tool & agentId=contract-risk）
    sideList: true,
    listTitle: '体检记录',
    listSource: 'tool',
    listAgentId: 'contract-risk',
    caps: true,
    // P3：报告步由页面注入「合同原文」面板，非报告步不注入 → 右栏整体不占位
    context: true,
    // 2026-09-23 顶栏收口：收进「发现」能力卡片，顶栏不占位
    topLevel: false,
    parent: 'discover',
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

/** 顶栏渲染项：收进其它入口的能力页（翻译 / 合翻）不在其中 */
export const TOP_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter((i) => i.topLevel !== false);

/**
 * 顶栏高亮项：命中页不在顶栏时（翻译 / 合翻）高亮落回 `parent`（「发现」）。
 * 未命中任何导航项（如 `/login`、`/profile`）返回 null。
 */
export function matchTopNavKey(path: string): NavKey | null {
  const item = matchNavItem(path);
  return item ? item.parent ?? item.key : null;
}

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
