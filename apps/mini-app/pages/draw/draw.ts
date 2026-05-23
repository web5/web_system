// pages/draw/draw.ts
import { CanvasEngine } from '../../utils/CanvasEngine';
import { BrushType } from '../../utils/Brush';
import {
  ICONS, ICONS_WHITE,
  COLORS, BG_COLORS,
  BRUSHES, BrushItem,
  SHAPES, ShapeItem, ShapeType,
  MATERIAL_LIBRARY, MATERIAL_CATEGORIES,
  MaterialItem, MaterialCategory,
} from './draw.constants';
import { TouchBehavior } from './draw.behavior.touch';
import { ToolsBehavior } from './draw.behavior.tools';
import { LayersBehavior } from './draw.behavior.layers';
import { MaterialBehavior } from './draw.behavior.material';

interface PanState {
  midX: number; midY: number; dist: number;
  offsetX: number; offsetY: number; scale: number;
}

Page({
  behaviors: [TouchBehavior, ToolsBehavior, LayersBehavior, MaterialBehavior],

  // ==================== data 数据 ====================
  data: {
    icons: ICONS,
    iconsWhite: ICONS_WHITE,
    colors: COLORS,
    bgColors: BG_COLORS,

    // 颜色
    showBgColors: false,
    currentColor: '#FF8C00',

    // 笔刷
    brushes: BRUSHES as BrushItem[],
    currentBrush: 'pencil' as BrushType,
    brushSize: 3,

    // 预设图形
    shapes: SHAPES as ShapeItem[],
    addingShape: '' as ShapeType | '',
    currentShapeIcon: '●',

    // 绘制状态
    isDrawing: false,

    // 图层
    layers: [] as { id: string; name: string; visible: boolean; active: boolean }[],
    showLayers: false,
    showLayerButton: false,

    // 撤销/重做
    canUndo: false,
    canRedo: false,

    // 面板开关
    showBrushPanel: false,
    showColorPanel: false,
    showActionPanel: false,
    showBrushMenu: false,
    showSettings: false,

    // 背景
    isPickingBackground: false,
    backgroundColor: '#ffffff',

    // 取色器
    isPickingColor: false,

    // 缩放
    zoomLevel: 100,
    isZoomMode: false,

    // 画布
    canvasWidth: 0,
    canvasHeight: 0,

    // 工具栏自动显隐
    toolbarHidden: false,

    // iPad 适配
    isIPad: false,
    isLandscape: false,

    // 素材栏
    showMaterialBar: false,
    materialCategories: MATERIAL_CATEGORIES,
    activeMaterialCategory: 'all' as MaterialCategory,
    materials: MATERIAL_LIBRARY as MaterialItem[],
    filteredMaterials: MATERIAL_LIBRARY as MaterialItem[],
  },

  // ==================== 实例属性 ====================
  engine: null as CanvasEngine | null,
  rectInfo: null as { left: number; top: number } | null,
  lastX: 0,
  lastY: 0,
  isTouching: false,
  isPanning: false,
  pan: { midX: 0, midY: 0, dist: 0, offsetX: 0, offsetY: 0, scale: 1 } as PanState,
  shapeWorldPos: { x: 0, y: 0 } as { x: number; y: number },
  _ignoreCanvasTouch: false,
  _resizeTimer: null as number | null,

  // ==================== 生命周期 ====================

  onLoad() {
    wx.setNavigationBarTitle({ title: '画板' });
    try {
      const setting = wx.getStorageSync('drawShowLayerButton');
      if (setting === true) this.setData({ showLayerButton: true });
    } catch (_) { /* ignore */ }
    this.detectDevice();
  },

  onReady() {
    this.initCanvas();
    this.queryCanvasRect();
  },

  onShow() {
    this.detectDevice();
  },

  onResize() {
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => {
      this._resizeTimer = null;
      this.detectDevice();
      this.queryCanvasRect();
    }, 200) as unknown as number;
  },

  /** 检测设备类型 & 屏幕方向 */
  detectDevice() {
    try {
      const info = wx.getSystemInfoSync();
      const isIPad = info.model?.indexOf('iPad') >= 0 || info.windowWidth >= 768;
      const isLandscape = info.windowWidth > info.windowHeight;
      this.setData({ isIPad, isLandscape });
    } catch (_) { /* ignore */ }
  },

  /** 初始化画布 & 引擎 */
  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').fields({ node: true, size: true }).exec((res: any) => {
      if (!res?.[0]?.node) return;

      const canvas = res[0].node;
      const ctx = canvas.getContext('2d', { webkitRerender: true });
      const sysInfo = wx.getSystemInfoSync();
      const dpr = sysInfo.pixelRatio || 1;
      const w = res[0].width;
      const h = res[0].height;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const engine = new CanvasEngine({
        width: w, height: h, dpr, mainCtx: ctx, mainCanvas: canvas,
      });
      engine.init();
      engine.setColor(this.data.currentColor);

      this.engine = engine;
      this.setData({ canvasWidth: w, canvasHeight: h });
      this.updateLayers();
      this.checkCanvasBlank();
    });
  },

  /** 查询 canvas 屏幕位置 */
  queryCanvasRect() {
    wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res: any) => {
      if (res?.[0]) this.rectInfo = res[0];
    });
  },

  /** 检测画布是否为空，空白时自动显示素材栏 */
  checkCanvasBlank() {
    if (!this.engine) return;
    const hasAnyPanelOpen = this.data.showColorPanel || this.data.showActionPanel
      || this.data.showBrushPanel || this.data.showLayers
      || this.data.showBrushMenu || this.data.showSettings;
    if (hasAnyPanelOpen) {
      this.setData({ showMaterialBar: false });
      return;
    }
    const blank = !this.engine.hasContent;
    if (blank !== this.data.showMaterialBar) {
      this.setData({ showMaterialBar: blank });
    }
  },
});
