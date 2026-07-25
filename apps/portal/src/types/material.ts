/** 素材类型 */
export type MaterialType = 'emoji' | 'svg' | 'color';

/** 单个素材项 */
export interface MaterialItem {
  id: string;
  name: string;
  category: string;
  type: MaterialType;
  /** emoji 字符 / SVG URL / 颜色值 */
  content: string;
  /** SVG 素材的主色 */
  color?: string;
}

/** 素材分类 Tab */
export interface MaterialTab {
  key: string;
  label: string;
  icon: string;
  order: number;
  count?: number;
}

/** 画布上的元素 */
export interface CanvasElement {
  id: string;
  content: string;
  type: MaterialType;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  fontSize: number;
}
