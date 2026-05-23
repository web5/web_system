/**
 * 笔刷类型定义
 */
export type BrushType = 'pencil' | 'marker' | 'highlighter' | 'eraser';

export interface BrushConfig {
  type: BrushType;
  name: string;
  icon: string;        // emoji 图标
  size: number;        // 默认粗细
  minSize: number;
  maxSize: number;
  opacity: number;     // 透明度 0-1
  blur: number;        // 模糊值（荧光笔用）
  composite: GlobalCompositeOperation;
  color: string;       // 仅铅笔/马克笔用
}

/**
 * 笔刷预设
 */
export const BRUSH_PRESETS: Record<BrushType, BrushConfig> = {
  pencil: {
    type: 'pencil',
    name: '铅笔',
    icon: '✏️',
    size: 3,
    minSize: 1,
    maxSize: 10,
    opacity: 1,
    blur: 0,
    composite: 'source-over',
    color: '#000000',
  },
  marker: {
    type: 'marker',
    name: '马克笔',
    icon: '🖊️',
    size: 6,
    minSize: 2,
    maxSize: 20,
    opacity: 0.85,
    blur: 0,
    composite: 'source-over',
    color: '#000000',
  },
  highlighter: {
    type: 'highlighter',
    name: '荧光笔',
    icon: '🖍️',
    size: 20,
    minSize: 10,
    maxSize: 40,
    opacity: 0.3,
    blur: 0,
    composite: 'multiply',
    color: '#FFFF00',
  },
  eraser: {
    type: 'eraser',
    name: '橡皮擦',
    icon: '🧹',
    size: 15,
    minSize: 5,
    maxSize: 40,
    opacity: 1,
    blur: 0,
    composite: 'destination-out',
    color: '#000000',
  },
};

export function getBrushConfig(type: BrushType): BrushConfig {
  return BRUSH_PRESETS[type];
}
