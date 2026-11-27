/**
 * 功能注册表 + 常用功能收藏（纯本地存储，零后端）。
 *
 * 整改背景（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §4.4）：
 * 小程序只剩两项纯学习能力「新概念英语（NCE）」与「收藏」，首页渲染「常用功能」
 * （pinned 项），发现页渲染「全部功能」+「添加常用」开关。此前的 feature-flags
 * （对话/翻译开关）已随能力下线一并删除，本文件是它的替代——语义从「开关」变成
 * 「是否常驻首页」。
 *
 * 存储口径：
 * - key = feature_pinned，值 = JSON 数组（常用功能 id 列表）；
 * - 无值（新装 / 清除缓存后）回退 defaultPinned 集合（仅 nce 默认常驻）；
 * - 变更后经 app.eventBus 广播 `features:updated`，首页/发现页订阅即时刷新。
 */
export interface FeatureDef {
  /** 功能唯一 id（'nce' | 'glossary'） */
  id: string;
  /** 展示名 */
  title: string;
  /** 短描述 */
  desc: string;
  /** 单字图标 */
  icon: string;
  /** 配色 class（.ic.n / .ic.g） */
  iconClass: string;
  /** navigateTo 目标 url */
  path: string;
  /** 是否需登录才可进 */
  needLogin: boolean;
  /** 默认是否常驻首页 */
  defaultPinned: boolean;
}

/** 全部功能注册表（顺序即发现页渲染顺序） */
export const FEATURES: FeatureDef[] = [
  {
    id: 'nce',
    title: '新概念英语',
    desc: 'NCE 逐句精读 · 点句朗读',
    icon: '英',
    iconClass: 'n',
    path: '/pages/nce/index/index',
    needLogin: false,
    defaultPinned: true,
  },
  {
    id: 'glossary',
    title: '收藏',
    desc: '收藏的句子，随时回看',
    icon: '藏',
    iconClass: 'g',
    path: '/pages/mine/glossary/index',
    needLogin: true,
    defaultPinned: false,
  },
];

/** 常用功能存储 key（JSON 数组） */
const PINNED_KEY = 'feature_pinned';

/** 常用功能变更广播事件名（app.eventBus 承载） */
export const FEATURES_UPDATED_EVENT = 'features:updated';

/** 默认常用集合：defaultPinned=true 的功能 id */
function defaultPinnedIds(): string[] {
  return FEATURES.filter((f) => f.defaultPinned).map((f) => f.id);
}

/** 校验并归一化 storage 读出的值：合法 string 数组则返回（过滤空串），否则 null（走回退） */
function parsePinned(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  // 元素含非字符串 → 结构损坏，回退默认；空数组是合法态（用户把常用全取消了），不能回退
  for (const it of raw) {
    if (typeof it !== 'string') return null;
  }
  return raw.filter((it) => !!it);
}

/** 读当前常用功能 id 列表：无值 / 非法值 / 读异常一律回退默认集合 */
export function getPinned(): string[] {
  try {
    const raw = wx.getStorageSync(PINNED_KEY);
    // wx.getStorageSync 无值时返回 ''（空串），不是 null/undefined
    if (raw === '' || raw === null || raw === undefined) return defaultPinnedIds();
    const parsed = parsePinned(raw);
    return parsed ?? defaultPinnedIds();
  } catch {
    return defaultPinnedIds();
  }
}

/** 指定功能是否常驻首页 */
export function isPinned(id: string): boolean {
  return getPinned().includes(id);
}

/** 变更广播：getApp 不可用（极早期时序）时仅写存储、跳过广播，不阻断收藏本身 */
function broadcast(): void {
  try {
    const app = getApp<IAppOption>();
    if (app && app.eventBus && typeof app.eventBus.emit === 'function') {
      app.eventBus.emit(FEATURES_UPDATED_EVENT, getPinned());
    }
  } catch {
    /* 广播失败不影响收藏落盘 */
  }
}

/**
 * 切换「常驻首页」：已常驻则移除，未常驻则加入。
 * 写 storage + 广播，返回切换后的完整列表。
 */
export function togglePinned(id: string): string[] {
  const cur = getPinned();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  try {
    wx.setStorageSync(PINNED_KEY, next);
  } catch {
    /* 写失败保持当前内存态，不阻断 */
  }
  broadcast();
  return next;
}
