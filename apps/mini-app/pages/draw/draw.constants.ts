import { BrushType } from '../../utils/Brush';

// ===================== SVG 图标库 =====================
const RAW_ICONS: Record<string, string> = {
  back:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M19 12H5M12 19l-7-7 7-7"/%3E%3C/svg%3E',
  undo:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="1 4 1 10 7 10"/%3E%3Cpath d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/%3E%3C/svg%3E',
  redo:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="23 4 23 10 17 10"/%3E%3Cpath d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/%3E%3C/svg%3E',
  layers:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolygon points="12 2 22 8.5 12 15 2 8.5 12 2"/%3E%3Cpolyline points="2 15.5 12 22 22 15.5"/%3E%3C/svg%3E',
  close:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Cline x1="18" y1="6" x2="6" y2="18"/%3E%3Cline x1="6" y1="6" x2="18" y2="18"/%3E%3C/svg%3E',
  pencil:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/%3E%3C/svg%3E',
  marker:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m12 19 7-7 3 3-7 7-3-3z"/%3E%3Cpath d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/%3E%3Cpath d="m2 2 7.586 7.586"/%3E%3Ccircle cx="11" cy="11" r="2"/%3E%3C/svg%3E',
  highlighter: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m9 11-6 6v3h9l3-3"/%3E%3Cpath d="m22 12-4-4-4 4 4 4 4-4z"/%3E%3Cpath d="M14 10V3l-4 4h1"/%3E%3C/svg%3E',
  eraser:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10.4-10.4a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/%3E%3Cpath d="M7 21h8"/%3E%3Cpath d="M17 13.8V21"/%3E%3C/svg%3E',
  palette:  '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="13.5" cy="6.5" r="2"/%3E%3Ccircle cx="17.5" cy="10.5" r="2"/%3E%3Ccircle cx="8.5" cy="7.5" r="2"/%3E%3Ccircle cx="6.5" cy="12.5" r="2"/%3E%3Cpath d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.5-4.5-10-10-10z"/%3E%3C/svg%3E',
  image:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"/%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"/%3E%3Cpolyline points="21 15 16 10 5 21"/%3E%3C/svg%3E',
  trash:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="3 6 5 6 21 6"/%3E%3Cpath d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/%3E%3Cpath d="M10 11v6"/%3E%3Cpath d="M14 11v6"/%3E%3Cpath d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/%3E%3C/svg%3E',
  download: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/%3E%3Cpolyline points="7 10 12 15 17 10"/%3E%3Cline x1="12" y1="15" x2="12" y2="3"/%3E%3C/svg%3E',
  eyedropper: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m2 22 1-1h3l9-9"/%3E%3Cpath d="M3 21 12 12"/%3E%3Cpath d="M13.5 3.5a2.12 2.12 0 0 1 3 3L11 13l-4 1 1-4 5.5-5.5z"/%3E%3C/svg%3E',
  plus:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Cline x1="12" y1="5" x2="12" y2="19"/%3E%3Cline x1="5" y1="12" x2="19" y2="12"/%3E%3C/svg%3E',
  eye:      '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3C/svg%3E',
  eyeOff:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/%3E%3Cpath d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/%3E%3Cpath d="m14.12 14.12a3 3 0 1 1-4.24-4.24"/%3E%3Cline x1="1" y1="1" x2="23" y2="23"/%3E%3C/svg%3E',
  merge:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Cpath d="M8 6h10"/%3E%3Cpath d="M6 12h12"/%3E%3Cpath d="M8 18h8"/%3E%3C/svg%3E',
  size:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Ccircle cx="12" cy="12" r="2"/%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3C/svg%3E',
  gear:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3Cpath d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/%3E%3C/svg%3E',
  tool:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/%3E%3C/svg%3E',
  // 预设图形
  shape:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="7" height="7"/%3E%3Ccircle cx="17.5" cy="6.5" r="3.5"/%3E%3Cpolygon points="12 21 5 8 19 8"/%3E%3C/svg%3E',
};

/** 生成带颜色的 data URI */
function svgDataUri(svg: string, color: string): string {
  return `data:image/svg+xml,${svg.replace('COLOR', color)}`;
}

/** 全部图标名 */
type IconName = keyof typeof RAW_ICONS;

/** 亮色图标（stroke=#333） */
export const ICONS = Object.fromEntries(
  Object.entries(RAW_ICONS).map(([k, v]) => [k, svgDataUri(v, '%23333')])
) as Record<IconName, string>;

/** 暗色图标（stroke=#fff）—— 用于深色背景 */
export const ICONS_WHITE = Object.fromEntries(
  Object.entries(RAW_ICONS).map(([k, v]) => [k, svgDataUri(v, '%23fff')])
) as Record<IconName, string>;

// ===================== 颜色配置 =====================
export const COLORS = [
  '#000000', '#595959', '#8c8c8c', '#bfbfbf',
  '#f5222d', '#fa541c', '#fa8c16', '#fadb14',
  '#52c41a', '#13c2c2', '#1677ff', '#2f54eb',
  '#722ed1', '#eb2f96', '#ffffff',
];

export const BG_COLORS = [
  '#ffffff', '#f5f5f5', '#e8e8e8', '#d9d9d9',
  '#000000', '#595959', '#f5222d', '#fa8c16',
  '#fadb14', '#52c41a', '#1677ff', '#722ed1',
  '#eb2f96', 'transparent',
];

// ===================== 笔刷配置 =====================
export interface BrushItem {
  type: BrushType;
  name: string;
  icon: string;
}

export const BRUSHES: BrushItem[] = [
  { type: 'pencil',      name: '铅笔',   icon: ICONS.pencil },
  { type: 'marker',      name: '马克笔', icon: ICONS.marker },
  { type: 'highlighter', name: '荧光笔', icon: ICONS.highlighter },
  { type: 'eraser',      name: '橡皮',   icon: ICONS.eraser },
];

/** 笔刷类型 → 暗色图标映射 */
export const BRUSH_WHITE_ICONS: Record<BrushType, string> = {
  pencil:      ICONS_WHITE.pencil,
  marker:      ICONS_WHITE.marker,
  highlighter: ICONS_WHITE.highlighter,
  eraser:      ICONS_WHITE.eraser,
};

// ===================== 预设图形 =====================
export type ShapeType = 'circle' | 'rect' | 'triangle' | 'star5' | 'heart';

export interface ShapeItem {
  type: ShapeType;
  name: string;
  icon: string;
}

export const SHAPES: ShapeItem[] = [
  { type: 'circle',   name: '圆形',   icon: '●' },
  { type: 'rect',     name: '矩形',   icon: '■' },
  { type: 'triangle', name: '三角形', icon: '▲' },
  { type: 'star5',    name: '五角星', icon: '★' },
  { type: 'heart',    name: '心形',   icon: '♥' },
];

// ===================== 素材库 =====================

/** 素材分类 */
export type MaterialCategory = 'all' | 'shape' | 'sticker' | 'background';

/** 素材项 */
export interface MaterialItem {
  id: string;
  category: MaterialCategory;
  name: string;
  icon: string;
  type: 'svg_path' | 'emoji' | 'image_url';
  data: {
    paths?: string[];
    text?: string;
    url?: string;
  };
  defaultScale?: number;
  defaultColor?: string;
}

/** 素材库 */
export const MATERIAL_LIBRARY: MaterialItem[] = [
  // === 形状类 ===
  { id: 'shape_circle',    category: 'shape', name: '圆',    icon: '⭕', type: 'svg_path', data: { paths: ['circle'] },    defaultScale: 0.5 },
  { id: 'shape_rect',      category: 'shape', name: '矩形',  icon: '▬',  type: 'svg_path', data: { paths: ['rect'] },      defaultScale: 0.5 },
  { id: 'shape_triangle',  category: 'shape', name: '三角',  icon: '△',  type: 'svg_path', data: { paths: ['triangle'] },  defaultScale: 0.5 },
  { id: 'shape_star',      category: 'shape', name: '五角星',icon: '⭐', type: 'svg_path', data: { paths: ['star5'] },    defaultScale: 0.5 },
  { id: 'shape_heart',     category: 'shape', name: '心形',  icon: '❤️', type: 'svg_path', data: { paths: ['heart'] },     defaultScale: 0.5 },

  // === 贴纸类（emoji） ===
  { id: 'sticker_smile',   category: 'sticker', name: '笑脸',  icon: '😊', type: 'emoji', data: { text: '😊' },   defaultScale: 0.4 },
  { id: 'sticker_flower',  category: 'sticker', name: '花',    icon: '🌸', type: 'emoji', data: { text: '🌸' },   defaultScale: 0.4 },
  { id: 'sticker_star2',   category: 'sticker', name: '星星',  icon: '🌟', type: 'emoji', data: { text: '🌟' },   defaultScale: 0.4 },
  { id: 'sticker_fire',    category: 'sticker', name: '火焰',  icon: '🔥', type: 'emoji', data: { text: '🔥' },   defaultScale: 0.4 },
  { id: 'sticker_rainbow', category: 'sticker', name: '彩虹',  icon: '🌈', type: 'emoji', data: { text: '🌈' },   defaultScale: 0.45 },
  { id: 'sticker_moon',    category: 'sticker', name: '月亮',  icon: '🌙', type: 'emoji', data: { text: '🌙' },   defaultScale: 0.4 },

  // === 动物 & 植物（SVG 路径） ===
  { id: 'sticker_cat',     category: 'sticker', name: '猫',    icon: '🐱', type: 'svg_path', data: { paths: ['cat'] },     defaultScale: 0.45, defaultColor: '#FF8C00' },
  { id: 'sticker_dog',     category: 'sticker', name: '狗',    icon: '🐶', type: 'svg_path', data: { paths: ['dog'] },     defaultScale: 0.45, defaultColor: '#8B5E3C' },
  { id: 'sticker_fish',    category: 'sticker', name: '鱼',    icon: '🐟', type: 'svg_path', data: { paths: ['fish'] },    defaultScale: 0.4,  defaultColor: '#4A90D9' },
  { id: 'sticker_tree',    category: 'sticker', name: '树',    icon: '🌳', type: 'svg_path', data: { paths: ['tree'] },    defaultScale: 0.5,  defaultColor: '#2D8B4E' },

  // === 背景类 ===
  { id: 'bg_grid',         category: 'background', name: '网格', icon: '📐', type: 'image_url', data: { url: '/assets/bg_grid.png' }, defaultScale: 1.0 },
];

export const MATERIAL_CATEGORIES = [
  { key: 'all', name: '全部' },
  { key: 'shape', name: '形状' },
  { key: 'sticker', name: '贴纸' },
  { key: 'background', name: '背景' },
];

/** 预设形状的 Canvas 2D 绘制函数 */
export const SHAPE_DRAWERS: Record<string, (ctx: any, size: number) => void> = {
  circle(ctx, size) {
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
  },
  rect(ctx, size) {
    ctx.fillRect(-size / 2, -size / 2, size, size);
  },
  triangle(ctx, size) {
    const r = size / 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.866, r * 0.5);
    ctx.lineTo(-r * 0.866, r * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  star5(ctx, size) {
    const r = size / 2;
    const innerR = r * 0.38;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outerAngle = (Math.PI / 2 * -1) + (2 * Math.PI * i / 5);
      const innerAngle = outerAngle + (Math.PI / 5);
      if (i === 0) ctx.moveTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      else ctx.lineTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      ctx.lineTo(innerR * Math.cos(innerAngle), innerR * Math.sin(innerAngle));
    }
    ctx.closePath();
    ctx.fill();
  },
  heart(ctx, size) {
    const s = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, s * 1.5);
    ctx.bezierCurveTo(-s * 2, -s * 0.5, -s * 1.5, -s * 2.5, 0, -s * 1.5);
    ctx.bezierCurveTo(s * 1.5, -s * 2.5, s * 2, -s * 0.5, 0, s * 1.5);
    ctx.fill();
  },

  // ===== 动物 & 植物 =====
  cat(ctx, size) {
    const s = size * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 1.6, -s * 0.5);
    ctx.lineTo(-s * 1.1, -s * 3.2);
    ctx.lineTo(-s * 0.3, -s * 0.8);
    ctx.quadraticCurveTo(0, -s * 3.5, s * 0.3, -s * 0.8);
    ctx.lineTo(s * 1.1, -s * 3.2);
    ctx.lineTo(s * 1.6, -s * 0.5);
    ctx.quadraticCurveTo(s * 2.2, s * 0.2, s * 1.8, s * 1.2);
    ctx.quadraticCurveTo(s * 2.4, s * 2.0, s * 2.0, s * 3.5);
    ctx.quadraticCurveTo(s * 1.0, s * 4.0, 0, s * 4.0);
    ctx.quadraticCurveTo(-s * 1.0, s * 4.0, -s * 2.0, s * 3.5);
    ctx.quadraticCurveTo(-s * 2.4, s * 2.0, -s * 1.8, s * 1.2);
    ctx.quadraticCurveTo(-s * 2.2, s * 0.2, -s * 1.6, -s * 0.5);
    ctx.closePath();
    ctx.fill();
    // 尾巴
    ctx.beginPath();
    ctx.moveTo(s * 1.8, s * 2.5);
    ctx.quadraticCurveTo(s * 3.5, s * 1.5, s * 3.0, -s * 0.5);
    ctx.lineWidth = s * 0.6;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  dog(ctx, size) {
    const s = size * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 1.5, -s * 1.0);
    ctx.quadraticCurveTo(-s * 3.0, -s * 0.2, -s * 2.8, s * 1.5);
    ctx.quadraticCurveTo(-s * 2.5, s * 2.0, -s * 1.6, s * 0.8);
    ctx.quadraticCurveTo(-s * 1.8, -s * 3.0, 0, -s * 3.2);
    ctx.quadraticCurveTo(s * 1.8, -s * 3.0, s * 1.6, s * 0.8);
    ctx.quadraticCurveTo(s * 2.5, s * 2.0, s * 2.8, s * 1.5);
    ctx.quadraticCurveTo(s * 3.0, -s * 0.2, s * 1.5, -s * 1.0);
    ctx.quadraticCurveTo(s * 2.2, s * 0.2, s * 1.8, s * 1.5);
    ctx.quadraticCurveTo(s * 2.2, s * 2.5, s * 1.8, s * 3.8);
    ctx.quadraticCurveTo(s * 0.8, s * 4.3, 0, s * 4.3);
    ctx.quadraticCurveTo(-s * 0.8, s * 4.3, -s * 1.8, s * 3.8);
    ctx.quadraticCurveTo(-s * 2.2, s * 2.5, -s * 1.8, s * 1.5);
    ctx.quadraticCurveTo(-s * 2.2, s * 0.2, -s * 1.5, -s * 1.0);
    ctx.closePath();
    ctx.fill();
  },

  fish(ctx, size) {
    const s = size * 0.12;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 2.5, s * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 2.0, s * 0.4);
    ctx.lineTo(s * 4.0, s * 2.0);
    ctx.lineTo(s * 4.0, -s * 2.0);
    ctx.lineTo(s * 2.0, -s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 1.2);
    ctx.lineTo(s * 0.5, -s * 2.5);
    ctx.lineTo(s * 1.2, -s * 1.2);
    ctx.closePath();
    ctx.fill();
  },

  tree(ctx, size) {
    const s = size * 0.1;
    ctx.fillRect(-s * 1.0, s * 1.5, s * 2.0, s * 3.0);
    ctx.beginPath();
    ctx.moveTo(0, -s * 2.0);
    ctx.lineTo(s * 3.5, s * 2.0);
    ctx.lineTo(-s * 3.5, s * 2.0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 3.5);
    ctx.lineTo(s * 2.8, s * 0.5);
    ctx.lineTo(-s * 2.8, s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 5.5);
    ctx.lineTo(s * 2.0, -s * 1.0);
    ctx.lineTo(-s * 2.0, -s * 1.0);
    ctx.closePath();
    ctx.fill();
  },
};
