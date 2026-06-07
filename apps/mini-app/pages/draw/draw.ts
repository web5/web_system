// pages/draw/draw.ts
import { CanvasEngine } from '../../utils/CanvasEngine';
import { BrushType } from '../../utils/Brush';
import { detectDevice } from '../../utils/device';
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
import { RecordsBehavior } from './draw.behavior.records';
import { getRecord } from '../../services/drawing-records';

interface PanState {
  midX: number; midY: number; dist: number;
  offsetX: number; offsetY: number; scale: number;
}

Page({
  behaviors: [TouchBehavior, ToolsBehavior, LayersBehavior, MaterialBehavior, RecordsBehavior],

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
    showLayerButton: true,  // 张小龙：图层按钮默认显示，让用户自然发现

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

    // 画布操作模式（合并拖动/缩放）
    zoomLevel: 100,
    isCanvasMode: false,

    // 画布
    canvasWidth: 0,
    canvasHeight: 0,

    // iPad 适配
    isIPad: false,
    isLandscape: false,

    // 素材栏
    showMaterialBar: false,
    materialCategories: MATERIAL_CATEGORIES,
    activeMaterialCategory: 'all' as MaterialCategory,
    materials: MATERIAL_LIBRARY as MaterialItem[],
    filteredMaterials: MATERIAL_LIBRARY as MaterialItem[],

    // 张小龙：功能极简，图形选择面板
    showShapePanel: false,

    // 张小龙：空白画布引导
    showGuide: true,
  },

  // ==================== 实例属性 ====================
  engine: null as CanvasEngine | null,
  canvas: null as any,
  ctx: null as any,
  rectInfo: null as { left: number; top: number } | null,
  lastX: 0,
  lastY: 0,
  isTouching: false,
  isPanning: false,
  isMovingLayer: false,
  pan: { midX: 0, midY: 0, dist: 0, offsetX: 0, offsetY: 0, scale: 1 } as PanState,
  shapeWorldPos: { x: 0, y: 0 } as { x: number; y: number },
  _ignoreCanvasTouch: false,
  _resizeTimer: null as number | null,
  /** 记录更新防抖定时器 */
  _recordUpdateTimer: null as number | null,

  // ==================== 生命周期 ====================

  onLoad(options: { recordId?: string }) {
    wx.setNavigationBarTitle({ title: '画板' });
    try {
      const setting = wx.getStorageSync('drawShowLayerButton');
      if (setting === true) this.setData({ showLayerButton: true });
    } catch (_) { /* ignore */ }
    // 如果从记录页跳转过来，直接复用已有记录
    if (options.recordId) {
      this.setData({ currentRecordId: options.recordId });
    }
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
      this.resizeCanvas();
    }, 200) as unknown as number;
  },

  /** 检测设备类型 & 屏幕方向（委托纯函数） */
  detectDevice() {
    const { isIPad, isLandscape } = detectDevice();
    this.setData({ isIPad, isLandscape });
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
        onContentChange: () => this.onContentChange(),
      });
      engine.init();
      engine.setColor(this.data.currentColor);

      // 保存引用，供 resizeCanvas 使用
      this.canvas = canvas;
      this.ctx = ctx;
      this.engine = engine;
      this.setData({ canvasWidth: w, canvasHeight: h });
      this.updateLayers();

      // 如果从历史记录进入，恢复画布内容
      if (this.data.currentRecordId) {
        const record = getRecord(this.data.currentRecordId);
        if (record?.canvasData) {
          engine.restoreFromImage(record.canvasData);
          this.setData({ showMaterialBar: false });
        }
      }

      this.checkCanvasBlank();

      // 不在这里创建记录，等用户真正绘制内容时才创建
    });
  },

  /** 查询 canvas 屏幕位置 */
  queryCanvasRect() {
    wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res: any) => {
      if (res?.[0]) this.rectInfo = res[0];
    });
  },

  /** 检测画布是否为空，空白时自动显示素材栏和引导 */
  checkCanvasBlank() {
    if (!this.engine) return;
    const hasAnyPanelOpen = this.data.showColorPanel || this.data.showActionPanel
      || this.data.showBrushPanel || this.data.showLayers
      || this.data.showBrushMenu || this.data.showSettings;
    if (hasAnyPanelOpen) {
      this.setData({ showMaterialBar: false, showGuide: false });
      return;
    }
    const blank = !this.engine.hasContent;
    // 只在画布空白时自动显示素材栏，不为空时不自动关闭（让 !isDrawing 和关闭按钮控制）
    if (blank && !this.data.showMaterialBar) {
      this.setData({ showMaterialBar: true, showGuide: true });
      this._ignoreCanvasTouch = true;
    }
    // 引导文字随画布状态
    if (this.data.showGuide !== blank) {
      this.setData({ showGuide: blank });
    }
  },

  /** 设备旋转时重新调整画布物理尺寸，保持内容不失真 */
  resizeCanvas() {
    if (!this.canvas || !this.ctx || !this.engine) return;

    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').fields({ size: true }).exec((res: any) => {
      if (!res?.[0]) return;

      const newW = res[0].width;
      const newH = res[0].height;
      const sysInfo = wx.getSystemInfoSync();
      const newDpr = sysInfo.pixelRatio || 1;

      // 尺寸未变化时不处理
      if (
        newW === this.data.canvasWidth &&
        newH === this.data.canvasHeight &&
        newDpr === this.engine!.dpr
      ) {
        return;
      }

      const engine = this.engine!;
      const oldW = engine.width;
      const oldH = engine.height;
      const oldDpr = engine.dpr;

      // 1. 先合成到主画布，确保内容是最新的
      engine.compositeToMain();

      // 2. 创建临时 OffscreenCanvas 保存旧内容
      const tempCanvas = wx.createOffscreenCanvas({
        type: '2d',
        width: oldW * oldDpr,
        height: oldH * oldDpr,
      });
      const tempCtx = tempCanvas.getContext('2d');
      const imageData = this.ctx.getImageData(0, 0, oldW * oldDpr, oldH * oldDpr);

      // 3. 重新设置主画布物理尺寸（会清除内容并重置 ctx 状态）
      this.canvas.width = newW * newDpr;
      this.canvas.height = newH * newDpr;

      // 4. 重新应用 scale
      this.ctx.scale(newDpr, newDpr);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';

      // 5. 将临时 canvas 内容绘制到新画布（保持宽高比，等比缩放居中）
      //     先计算等比缩放后的绘制区域，其余部分填充背景色
      const oldPxW = oldW * oldDpr;
      const oldPxH = oldH * oldDpr;
      const newPxW = newW * newDpr;
      const newPxH = newH * newDpr;
      const scale = Math.min(newPxW / oldPxW, newPxH / oldPxH);
      const drawPxW = Math.round(oldPxW * scale);
      const drawPxH = Math.round(oldPxH * scale);
      const offsetPxX = Math.round((newPxW - drawPxW) / 2);
      const offsetPxY = Math.round((newPxH - drawPxH) / 2);

      // 5a. 填充背景色（先重置变换，使用物理像素坐标）
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.fillStyle = engine.backgroundColor || '#ffffff';
      this.ctx.fillRect(0, 0, newPxW, newPxH);
      this.ctx.restore();

      // 5b. 将临时 canvas 内容等比绘制到新画布
      this.ctx.drawImage(
        tempCanvas,
        0, 0, oldPxW, oldPxH,
        offsetPxX / newDpr, offsetPxY / newDpr, drawPxW / newDpr, drawPxH / newDpr,
      );

      // 6. 通知引擎更新状态并重建图层
      engine.resize(newW, newH, newDpr);

      this.setData({ canvasWidth: newW, canvasHeight: newH });
      this.queryCanvasRect();
      this.updateLayers();
    });
  },

  // ==================== 张小龙理念：用完即走 ====================
  // 右上角「完成」按钮：保存 + 分享
  async onDone() {
    wx.showLoading({ title: '保存中...' });
    try {
      // 1. 先保存当前记录
      if ((this as any).saveCurrentRecord) {
        await (this as any).saveCurrentRecord();
      }

      // 2. 同时保存到相册
      await new Promise<void>((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: (this.engine as any)?.mainCanvas,
          success: (res: any) => {
            (this as any)._tempFilePath = res.tempFilePath;
            wx.hideLoading();
            this.showShareCard(res.tempFilePath);
            resolve();
          },
          fail: () => {
            wx.hideLoading();
            // 保存失败也显示分享卡片（用画布快照）
            this.showShareCard('');
            resolve();
          },
        });
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // 显示分享卡片（保存成功后的自然延伸）
  showShareCard(tempFilePath: string) {
    wx.vibrateShort({ type: 'medium' });
    if (tempFilePath) {
      // 有临时文件：可以先保存到相册，再提示分享
      wx.showModal({
        title: '作品已保存',
        content: '是否保存到相册并分享给朋友？',
        confirmText: '分享',
        confirmColor: '#4f46e5',
        success: (res: any) => {
          if (res.confirm) {
            // 先保存到相册
            wx.saveImageToPhotosAlbum({
              filePath: tempFilePath,
              success: () => {
                wx.showToast({ title: '已保存到相册', icon: 'success' });
                // 触发微信分享（需要用户手动点右上角）
                wx.showToast({ title: '请点右上角分享', icon: 'none', duration: 2000 });
              },
              fail: () => {
                wx.showToast({ title: '请授权相册权限', icon: 'none' });
              },
            });
          }
        },
      });
    } else {
      wx.showToast({ title: '请点右上角分享', icon: 'none', duration: 2000 });
    }
  },
});
