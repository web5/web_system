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
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2NjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTE3IDNhMi44MyAyLjgzIDAgMSAxIDQgNEw3LjUgMjAuNSAyIDIybDEuNS01LjVaIi8+PHBhdGggZD0ibTE1IDUgNCA0Ii8+PC9zdmc+',
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
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2NjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0ibTEyIDE5IDctNyAzIDMtNyA3LTMtM3oiLz48cGF0aCBkPSJtMTggMTMtMS41LTcuNUwyIDJsMy41IDE0LjVMMTMgMThsNS01eiIvPjxwYXRoIGQ9Im0yIDIgNy41ODYgNy41ODYiLz48Y2lyY2xlIGN4PSIxMSIgY3k9IjExIiByPSIyIi8+PC9zdmc+',
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
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2NjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0ibTkgMTEtNiA2djNoOWwzLTMiLz48cGF0aCBkPSJtMjIgMTItNC00LTQgNCA0IDQgNC00eiIvPjxwYXRoIGQ9Ik0xNCAxMFYzbC00IDRoMSIvPjwvc3ZnPg==',
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
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjY2NjY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0ibTcgMjEtNC4zLTQuM2ExIDEgMCAwIDEgMC0xLjRsMTAuNC0xMC40YTEgMSAwIDAgMSAxLjQgMGw1LjYgNS42YTEgMSAwIDAgMSAwIDEuNEwxMyAxOSIvPjxwYXRoIGQ9Ik03IDIxaDgiLz48cGF0aCBkPSJNMTcgMTMuOFYyMSIvPjwvc3ZnPg==',
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
