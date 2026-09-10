/**
 * 变变 — 设计常量与素材库
 * 设计基准 375x812 (iPhone X), 750rpx
 */

// ========== 设计令牌 ==========
export const TOKENS = {
  /** 主色-魔法橙 */
  brand: '#FF8C42',
  /** 辅色-天空蓝 */
  accent: '#4ECDC4',
  /** 背景-暖白 */
  bg: '#FFF8F0',
  /** 成功-薄荷绿 */
  success: '#7ED957',
  /** 文字-深灰 */
  text: '#333333',
  /** 文字-中灰 */
  textSecondary: '#888888',
  /** 卡片/按钮圆角 */
  radiusCard: '24rpx',
  radiusBtn: '16rpx',
  /** 最小触控热区 */
  touchMin: '88rpx',
  /** 按钮最小高度 */
  btnMinH: '96rpx',
  /** 标题 */
  h1Size: '28pt',
  /** 正文 */
  bodySize: '16pt',
} as const;

// ========== 素材分类 ==========
export interface MaterialCategory {
  id: string;
  name: string;
  icon: string;
}

/** 白色图标用于深色背景（橙色 tab 激活态） */
const WHITE_ICONS = {
  palette: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGOEYwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTMuNSIgY3k9IjYuNSIgcj0iMS41Ii8+PGNpcmNsZSBjeD0iMTcuNSIgY3k9IjEwLjUiIHI9IjEuNSIvPjxjaXJjbGUgY3g9IjguNSIgY3k9IjcuNSIgcj0iMS41Ii8+PGNpcmNsZSBjeD0iNi41IiBjeT0iMTIuNSIgcj0iMS41Ii8+PHBhdGggZD0iTTEyIDJDNi41IDIgMiA2LjUgMiAxMnM0LjUgMTAgMTAgMTBjLjkzIDAgMS41LS42NyAxLjUtMS41IDAtLjM5LS4xNS0uNzQtLjM5LTEuMDEtLjIzLS4yNi0uMzgtLjYxLS4zOC0xIDAtLjgzLjY3LTEuNSAxLjUtMS41SDE2YzMuMzEgMCA2LTIuNjkgNi02IDAtNS41LTQuNS0xMC0xMC0xMHoiLz48L3N2Zz4=',
  star: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGOEYwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlnb24gcG9pbnRzPSIxMiAyIDE1LjA5IDguMjYgMjIgOS4yNyAxNyAxNC4xNCAxOC4xOCAyMS4wMiAxMiAxNy43NyA1LjgyIDIxLjAyIDcgMTQuMTQgMiA5LjI3IDguOTEgOC4yNiAxMiAyIi8+PC9zdmc+',
  diamond: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGOEYwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDJMMiA3bDEwIDUgMTAtNS0xMC01ek0yIDE3bDEwIDUgMTAtNU0yIDEybDEwIDUgMTAtNSIvPjwvc3ZnPg==',
  animal: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGOEYwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDVjLjY3IDAgMS4zNS4wOSAyIC4yNiAxLjc4LTIgNS4wMy0yLjg0IDYuNDItMi4yNi41NC4yMy44NS42MyAxIDEuMTYiLz48cGF0aCBkPSJNMjAuODEgOS4wOEE0LjUgNC41IDAgMDAxOC41IDUuNSIvPjxwYXRoIGQ9Ik0zLjUgNS41YTQuNSA0LjUgMCAwMC0yLjMxIDMuNTgiLz48cGF0aCBkPSJNOCAxNHMxLjUgMiA0IDIgNC0yIDQtMiIvPjxsaW5lIHgxPSI5IiB5MT0iOSIgeDI9IjkuMDEiIHkyPSI5Ii8+PGxpbmUgeDE9IjE1IiB5MT0iOSIgeDI9IjE1LjAxIiB5Mj0iOSIvPjxwYXRoIGQ9Ik0xMiAxN3YtMiIvPjwvc3ZnPg==',
  leaf: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGOEYwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTExIDIwQTcgNyAwIDAgMSA5LjggNi45QzE1LjUgNC45IDE3IDMuNSAxOSAyYzEgMiAyIDQuNSAyIDggMCA1LjUtNC43OCAxMC0xMCAxMFoiLz48cGF0aCBkPSJNMiAyMWMwLTMgMS44NS01LjM2IDUuMDgtNkM5LjUgMTQuNTIgMTIgMTMgMTMgMTIiLz48L3N2Zz4=',
  smile: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGOEYwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNOCAxNHMxLjUgMiA0IDIgNC0yIDQtMiIvPjxsaW5lIHgxPSI5IiB5MT0iOSIgeDI9IjkuMDEiIHkyPSI5Ii8+PGxpbmUgeDE9IjE1IiB5MT0iOSIgeDI9IjE1LjAxIiB5Mj0iOSIvPjwvc3ZnPg==',
  image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGOEYwIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE4IiByeD0iMiIgcnk9IjIiLz48Y2lyY2xlIGN4PSI4LjUiIGN5PSI4LjUiIHI9IjEuNSIvPjxwb2x5bGluZSBwb2ludHM9IjIxIDE1IDE2IDEwIDUgMjEiLz48L3N2Zz4=',
};

export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  { id: 'all', name: '全部', icon: WHITE_ICONS.palette },
  { id: 'sticker', name: '贴纸', icon: WHITE_ICONS.star },
  { id: 'shape', name: '形状', icon: WHITE_ICONS.diamond },
  { id: 'animal', name: '动物', icon: WHITE_ICONS.animal },
  { id: 'nature', name: '自然', icon: WHITE_ICONS.leaf },
  { id: 'face', name: '表情', icon: WHITE_ICONS.smile },
  { id: 'bg', name: '背景', icon: WHITE_ICONS.image },
];

// ========== 素材项 ==========
export interface MaterialItem {
  id: string;
  category: string;
  /** emoji 或 SVG path */
  content: string;
  /** content 类型 */
  type: 'emoji' | 'svg';
  label: string;
}

export const MATERIAL_LIBRARY: MaterialItem[] = [
  // 贴纸
  { id: 'star', category: 'sticker', content: '⭐', type: 'emoji', label: '星星' },
  { id: 'heart', category: 'sticker', content: '❤️', type: 'emoji', label: '爱心' },
  { id: 'rainbow', category: 'sticker', content: '🌈', type: 'emoji', label: '彩虹' },
  { id: 'sparkle', category: 'sticker', content: '✨', type: 'emoji', label: '闪光' },
  { id: 'crown', category: 'sticker', content: '👑', type: 'emoji', label: '皇冠' },
  { id: 'gift', category: 'sticker', content: '🎁', type: 'emoji', label: '礼物' },
  { id: 'rocket', category: 'sticker', content: '🚀', type: 'emoji', label: '火箭' },
  { id: 'music', category: 'sticker', content: '🎵', type: 'emoji', label: '音符' },

  // 形状
  { id: 'circle', category: 'shape', content: '🔴', type: 'emoji', label: '圆形' },
  { id: 'square', category: 'shape', content: '🟧', type: 'emoji', label: '方形' },
  { id: 'triangle', category: 'shape', content: '🔺', type: 'emoji', label: '三角' },
  { id: 'diamond', category: 'shape', content: '💎', type: 'emoji', label: '钻石' },
  { id: 'pentagon', category: 'shape', content: '🟣', type: 'emoji', label: '紫色' },

  // 动物
  { id: 'cat', category: 'animal', content: '🐱', type: 'emoji', label: '小猫' },
  { id: 'dog', category: 'animal', content: '🐶', type: 'emoji', label: '小狗' },
  { id: 'rabbit', category: 'animal', content: '🐰', type: 'emoji', label: '兔子' },
  { id: 'bear', category: 'animal', content: '🐻', type: 'emoji', label: '小熊' },
  { id: 'panda', category: 'animal', content: '🐼', type: 'emoji', label: '熊猫' },
  { id: 'fox', category: 'animal', content: '🦊', type: 'emoji', label: '狐狸' },
  { id: 'unicorn', category: 'animal', content: '🦄', type: 'emoji', label: '独角兽' },
  { id: 'dinosaur', category: 'animal', content: '🦖', type: 'emoji', label: '恐龙' },

  // 自然
  { id: 'sun', category: 'nature', content: '☀️', type: 'emoji', label: '太阳' },
  { id: 'moon', category: 'nature', content: '🌙', type: 'emoji', label: '月亮' },
  { id: 'cloud', category: 'nature', content: '☁️', type: 'emoji', label: '云朵' },
  { id: 'flower', category: 'nature', content: '🌸', type: 'emoji', label: '花朵' },
  { id: 'tree', category: 'nature', content: '🌳', type: 'emoji', label: '大树' },
  { id: 'mushroom', category: 'nature', content: '🍄', type: 'emoji', label: '蘑菇' },

  // 表情
  { id: 'happy', category: 'face', content: '😊', type: 'emoji', label: '开心' },
  { id: 'cool', category: 'face', content: '😎', type: 'emoji', label: '酷' },
  { id: 'wink', category: 'face', content: '😉', type: 'emoji', label: '眨眼' },
  { id: 'love', category: 'face', content: '🥰', type: 'emoji', label: '喜欢' },
  { id: 'laugh', category: 'face', content: '😂', type: 'emoji', label: '大笑' },
  { id: 'surprised', category: 'face', content: '😲', type: 'emoji', label: '惊讶' },

  // 背景
  { id: 'bg-white', category: 'bg', content: '#FFFFFF', type: 'svg', label: '白色' },
  { id: 'bg-sky', category: 'bg', content: '#87CEEB', type: 'svg', label: '天空蓝' },
  { id: 'bg-grass', category: 'bg', content: '#7ED957', type: 'svg', label: '草地绿' },
  { id: 'bg-pink', category: 'bg', content: '#FFB6C1', type: 'svg', label: '粉色' },
  { id: 'bg-yellow', category: 'bg', content: '#FFE4B5', type: 'svg', label: '暖黄' },
];

// ========== 画布元素 ==========
export interface CanvasElement {
  id: string;
  materialId: string;
  content: string;
  type: 'emoji' | 'svg';
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

// ========== 草稿 ==========
export interface Draft {
  elements: CanvasElement[];
  backgroundColor: string;
  description: string;
  updatedAt: number;
}

// ========== 变变结果 ==========
export interface TransformResult {
  id: string;
  /** 原画 canvas 数据 */
  originalImage: string;
  /** AI 生成的 3D 角色 */
  aiImage: string;
  description: string;
  status: 'success' | 'pending' | 'failed';
  errorMsg?: string;
  createdAt: number;
}

// ========== 趣味小知识（Loading 等待轮播） ==========
export const FUN_FACTS: string[] = [
  '一只猫咪的胡须有24根哦～',
  '彩虹其实有7种颜色！',
  '蜜蜂跳圆圈舞来告诉同伴花在哪里',
  '云朵看起来轻飘飘，但其实很重很重',
  '大象是唯一不会跳的哺乳动物',
  '星星其实不会眨眼睛，是大气层让它们看起来在闪',
  '变色龙变色不一定是为了伪装，有时是因为心情',
  '蝴蝶的翅膀其实是透明的，颜色只是鳞片反光',
];

// ========== 历史页每行列数 ==========
export const HISTORY_COLUMNS = 3;

// ========== 本地存储 key ==========
export const STORAGE_KEYS = {
  draft: 'bianbian_draft',
  history: 'bianbian_history',
  /** 每张画当日变变次数 */
  dailyCount: 'bianbian_daily_count',
} as const;

/** 历史记录上限 */
export const MAX_HISTORY = 20;

/** 每日免费变变次数 */
export const DAILY_TRANSFORM_LIMIT = 3;
