// pages/draw/draw.ts

// TODO: iPad 适配 — 支持竖屏 (portrait) 和横屏 (landscape) 两种模式
// 1. 布局响应式：工具栏、画布、颜色面板需根据屏幕尺寸和方向自适应排列
// 2. 横屏模式下考虑将工具栏移至侧边栏布局，充分利用横向空间
// 3. 画布尺寸使用动态计算（systemInfo.screenWidth/Height），避免硬编码
// 4. 弹窗/设置面板在 iPad 上适当放大，避免按钮过小难以点击
// 5. 适配 iPad 特有的分屏 / Slide Over 场景下的窗口尺寸变化

// TODO: iOS 端绘制异常修复 — 工具栏自动显隐方案
// 问题：iOS 端目前仍无法正常绘制
// 方案：用户开始绘制（touchstart）时工具栏自动隐藏，停止绘制 1s 后自动出现
// 1. touchstart 时隐藏顶部工具栏、底部颜色栏等浮层 UI，释放触摸区域
// 2. touchend 时启动 1s 延时定时器，超时后恢复显示工具栏
// 3. 若在 1s 内再次 touchstart，取消定时器并保持隐藏
// 4. 注意兼容 CanvasEngine 的触摸事件处理，避免工具栏显隐干扰绘制逻辑
import { CanvasEngine } from '../../utils/CanvasEngine';
import { BrushType } from '../../utils/Brush';
import {
  ICONS, ICONS_WHITE,
  COLORS, BG_COLORS,
  BRUSHES,
  BrushItem,
} from './draw.constants';

interface PanState {
  midX: number;
  midY: number;
  dist: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

Page({
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
  },

  // ==================== 实例属性 ====================
  engine: null as CanvasEngine | null,
  rectInfo: null as { left: number; top: number } | null,
  lastX: 0,
  lastY: 0,
  isTouching: false,
  isPanning: false,
  pan: { midX: 0, midY: 0, dist: 0, offsetX: 0, offsetY: 0, scale: 1 } as PanState,

  // ==================== 生命周期 ====================

  onLoad() {
    wx.setNavigationBarTitle({ title: '画板' });
    try {
      const setting = wx.getStorageSync('drawShowLayerButton');
      if (setting === true) this.setData({ showLayerButton: true });
    } catch (_) { /* ignore */ }
  },

  onReady() {
    this.initCanvas();
    this.queryCanvasRect();
  },

  /** 初始化画布 & 引擎 */
  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res?.[0]?.node) return;

      const canvas = res[0].node as any;
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

      this.engine = engine;
      this.setData({ canvasWidth: w, canvasHeight: h });
      this.updateLayers();
    });
  },

  /** 查询 canvas 屏幕位置 */
  queryCanvasRect() {
    wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res) => {
      if (res?.[0]) this.rectInfo = res[0] as { left: number; top: number };
    });
  },

  // ==================== 坐标转换 ====================

  /** 获取触摸点相对 canvas 的坐标 */
  getCanvasPos(e: any): Promise<{ x: number; y: number }> {
    return new Promise((resolve) => {
      if (this.rectInfo) {
        const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
        resolve({ x: touch.clientX - this.rectInfo.left, y: touch.clientY - this.rectInfo.top });
        return;
      }
      wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res) => {
        if (res?.[0]) {
          const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
          resolve({ x: touch.clientX - (res[0] as any).left, y: touch.clientY - (res[0] as any).top });
        } else {
          resolve({ x: 0, y: 0 });
        }
      });
    });
  },

  // ==================== 触摸事件 ====================

  async onTouchStart(e: any) {
    if (!this.engine) return;
    const touches = e.touches;

    // 双指 → 拖动/缩放
    if (touches.length >= 2) {
      this.beginTwoFingerPan(touches);
      return;
    }

    // 面板打开时忽略单指操作
    if (this.data.showColorPanel || this.data.showActionPanel || this.data.showBrushPanel) return;

    // 缩放模式 → 单指拖动
    if (this.data.isZoomMode) {
      this.beginZoomPan(e);
      return;
    }

    // 取色模式 → 不绘制
    if (this.data.isPickingColor) return;

    // 普通绘制
    await this.beginDraw(e);
  },

  /** 双指拖动/缩放开始 */
  beginTwoFingerPan(touches: any[]) {
    this.isPanning = true;
    this.isTouching = false;
    const rect = this.rectInfo || { left: 0, top: 0 };
    const t0 = touches[0], t1 = touches[1];
    const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
    const my = (t0.clientY + t1.clientY) / 2 - rect.top;
    const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    this.pan = {
      midX: mx, midY: my,
      dist: Math.sqrt(dx * dx + dy * dy),
      offsetX: this.engine!.panX, offsetY: this.engine!.panY,
      scale: this.engine!.scale,
    };
  },

  /** 缩放模式单指拖动开始 */
  async beginZoomPan(e: any) {
    this.isPanning = true;
    this.isTouching = false;
    const pos = await this.getCanvasPos(e);
    this.pan = {
      midX: pos.x, midY: pos.y,
      dist: 0, offsetX: this.engine!.panX, offsetY: this.engine!.panY,
      scale: this.engine!.scale,
    };
  },

  /** 普通绘制开始 */
  async beginDraw(e: any) {
    const pos = await this.getCanvasPos(e);
    const worldPos = this.engine!.screenToWorld(pos.x, pos.y);
    this.isTouching = true;
    this.lastX = worldPos.x;
    this.lastY = worldPos.y;
    this.engine!.beginPath(worldPos.x, worldPos.y);
    this.setData({ isDrawing: true });
  },

  async onTouchMove(e: any) {
    if (!this.engine) return;
    const touches = e.touches;

    // 双指拖动/缩放
    if (this.isPanning && touches.length >= 2) {
      this.updateTwoFingerPan(touches);
      return;
    }

    // 单指拖动（缩放模式）
    if (this.isPanning && this.data.isZoomMode) {
      await this.updateZoomPan(e);
      return;
    }

    // 面板打开时忽略移动
    if (this.data.showBrushPanel || this.data.showColorPanel || this.data.showActionPanel || !this.isTouching) return;
    if (this.data.isPickingColor) return;
    await this.updateDraw(e);
  },

  /** 双指拖动/缩放更新 */
  updateTwoFingerPan(touches: any[]) {
    const rect = this.rectInfo || { left: 0, top: 0 };
    const t0 = touches[0], t1 = touches[1];
    const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
    const my = (t0.clientY + t1.clientY) / 2 - rect.top;
    const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const factor = this.pan.dist > 0 ? dist / this.pan.dist : 1;
    const newScale = Math.max(0.3, Math.min(5, this.pan.scale * factor));

    // 以双指中点为中心缩放
    this.engine!.panX = this.pan.midX - (this.pan.midX - this.pan.offsetX) * (newScale / this.pan.scale);
    this.engine!.panY = this.pan.midY - (this.pan.midY - this.pan.offsetY) * (newScale / this.pan.scale);
    this.engine!.scale = newScale;

    // 叠加中点平移
    this.engine!.panX += mx - this.pan.midX;
    this.engine!.panY += my - this.pan.midY;
    this.engine!.compositeToMain();
  },

  /** 缩放模式单指拖动更新 */
  async updateZoomPan(e: any) {
    const pos = await this.getCanvasPos(e);
    this.engine!.panX = this.pan.offsetX + pos.x - this.pan.midX;
    this.engine!.panY = this.pan.offsetY + pos.y - this.pan.midY;
    this.engine!.compositeToMain();
  },

  /** 绘制更新 */
  async updateDraw(e: any) {
    const pos = await this.getCanvasPos(e);
    const worldPos = this.engine!.screenToWorld(pos.x, pos.y);
    this.engine!.drawSegment(worldPos.x, worldPos.y, this.lastX, this.lastY);
    this.lastX = worldPos.x;
    this.lastY = worldPos.y;
  },

  async onTouchEnd(e: any) {
    if (!this.engine) return;

    // 拖动结束
    if (this.isPanning) {
      this.isPanning = false;
      this.setData({ zoomLevel: Math.round(this.engine.scale * 100) });
      this.engine.saveSnapshot();
      return;
    }

    // 取色模式 → 点击取色（兼容 changedTouches 为空的情况）
    if (this.data.isPickingColor) {
      const touch = e.changedTouches?.[0];
      const pos = touch
        ? await this.getCanvasPos(e)
        : (e.detail ? { x: e.detail.x - (this.rectInfo?.left || 0), y: e.detail.y - (this.rectInfo?.top || 0) } : null);
      if (pos) this.doPickColor(pos.x, pos.y);
      return;
    }

    // 绘制结束
    if (!this.isTouching) return;
    this.isTouching = false;
    const pos = e.changedTouches?.[0]
      ? await this.getCanvasPos(e)
      : { x: this.lastX, y: this.lastY };
    const worldPos = this.engine.screenToWorld(pos.x, pos.y);
    this.engine.endPath(worldPos.x, worldPos.y);
    this.setData({
      isDrawing: false,
      canUndo: this.engine.canUndo(),
      canRedo: this.engine.canRedo(),
    });
  },

  // ==================== 笔刷 ====================

  selectBrush(e: any) {
    const type = e.currentTarget.dataset.type as BrushType;
    this.engine?.setBrush(type);
    this.setData({
      currentBrush: type,
      brushSize: this.engine?.currentBrush.size || 3,
      showBrushPanel: false,
      showBrushMenu: false,
    });
  },

  onBrushSizeChange(e: any) {
    const size = e.detail.value;
    this.engine?.setSize(size);
    this.setData({ brushSize: size });
  },

  // ==================== 颜色 ====================

  selectColor(e: any) {
    const color = e.currentTarget.dataset.color;
    if (this.data.isPickingBackground || this.data.showBgColors) {
      const bg = color === 'transparent' ? '' : color;
      this.engine?.setBackgroundColor(bg);
      this.setData({
        backgroundColor: bg,
        showColorPanel: false,
        isPickingBackground: false,
        showBgColors: false,
      });
      wx.showToast({ title: bg === '' ? '背景已设为透明' : '背景色已更新', icon: 'success', duration: 1000 });
      return;
    }
    this.engine?.setColor(color);
    this.setData({ currentColor: color, showColorPanel: false });
  },

  // ==================== 撤销 / 重做 ====================

  onUndo() {
    if (!this.engine?.canUndo()) {
      wx.showToast({ title: '没有可撤销的内容', icon: 'none', duration: 1000 });
      return;
    }
    this.engine?.undo();
    wx.vibrateShort({ type: 'light' });
    this.setData({
      canUndo: this.engine?.canUndo() || false,
      canRedo: this.engine?.canRedo() || false,
    });
  },

  onRedo() {
    this.engine?.redo();
    this.setData({
      canUndo: this.engine?.canUndo() || false,
      canRedo: this.engine?.canRedo() || false,
    });
  },

  // ==================== 清空 ====================

  onClear() {
    wx.showModal({
      title: '确认清空',
      content: '将清空当前画布内容，确定吗？',
      success: (res) => {
        if (res.confirm) {
          this.engine?.clear();
          this.setData({ canUndo: false, canRedo: false });
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      },
    });
  },

  // ==================== 保存 ====================

  onSave() {
    wx.canvasToTempFilePath({
      canvas: (this.engine as any)?.mainCanvas,
      success: (res: any) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => wx.showToast({ title: '请授权相册权限', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
    });
  },

  // ==================== 图片导入 ====================

  onImportImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.engine?.importImage(res.tempFilePaths[0]).then(() => {
          this.setData({
            canUndo: this.engine?.canUndo() || false,
            canRedo: this.engine?.canRedo() || false,
          });
          wx.showToast({ title: '导入成功', icon: 'success' });
        }).catch(() => wx.showToast({ title: '导入失败', icon: 'none' }));
      },
    });
  },

  // ==================== 取色器 ====================

  /** 进入取色模式 */
  onPickColor() {
    this.closeAllPanels();
    this.setData({ isPickingColor: true });
    wx.showToast({ title: '点击画布取色·再次点击取消', icon: 'none', duration: 1500 });
  },

  /** 执行取色 */
  doPickColor(sx: number, sy: number) {
    const color = this.engine?.pickColor(sx, sy);
    if (color) {
      this.engine?.setColor(color);
      this.setData({ currentColor: color, isPickingColor: false });
      wx.showToast({ title: '已取色', icon: 'success' });
    }
  },

  /** 取消取色 */
  cancelPickColor() {
    this.setData({ isPickingColor: false });
  },

  // ==================== 图层 ====================

  toggleLayers() {
    this.setData({ showLayers: !this.data.showLayers, showActionPanel: false });
    if (this.data.showLayers) this.updateLayers();
  },

  addLayer() {
    const count = this.engine?.addLayer() || 0;
    wx.showToast({ title: `新建图层 ${count}`, icon: 'success' });
    this.updateLayers();
    this.engine?.compositeToMain();
  },

  deleteLayer() {
    const idx = this.engine?.activeLayerIndex ?? 0;
    if (this.engine && this.engine.layers.length > 1) {
      this.engine.removeLayer(idx);
      this.updateLayers();
    } else {
      wx.showToast({ title: '至少保留一个图层', icon: 'none' });
    }
  },

  selectLayer(e: any) {
    this.engine?.setActiveLayer(e.currentTarget.dataset.index);
    this.updateLayers();
  },

  toggleLayerVisible(e: any) {
    const idx = e.currentTarget.dataset.index;
    const layer = this.engine?.layers[idx];
    if (layer) {
      this.engine?.setLayerVisible(idx, !layer.visible);
      this.updateLayers();
    }
  },

  mergeDown() {
    this.engine?.mergeDown();
    this.updateLayers();
    wx.showToast({ title: '已合并', icon: 'success' });
  },

  updateLayers() {
    if (!this.engine) return;
    const activeIdx = this.engine.activeLayerIndex;
    this.setData({
      layers: this.engine.layers.map((l, i) => ({
        id: l.id, name: l.name, visible: l.visible, active: i === activeIdx,
      })),
    });
  },

  // ==================== 面板切换 ====================

  toggleBrushPanel() {
    this.setData({
      showBrushPanel: !this.data.showBrushPanel,
      showColorPanel: false, showActionPanel: false,
    });
  },

  toggleActionPanel() {
    this.setData({
      showActionPanel: !this.data.showActionPanel,
      showBrushPanel: false, showColorPanel: false,
    });
  },

  openColorPanel() {
    this.setData({
      showColorPanel: true,
      showBrushPanel: false, showActionPanel: false,
    });
  },

  closeAllPanels() {
    this.setData({
      showBrushPanel: false, showColorPanel: false, showActionPanel: false,
      showLayers: false, showBrushMenu: false, showSettings: false,
      isPickingBackground: false, showBgColors: false,
      isPickingColor: false,
    });
  },

  // ==================== 设置 ====================

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings });
  },

  toggleLayerButton() {
    const next = !this.data.showLayerButton;
    this.setData({ showLayerButton: next });
    try { wx.setStorageSync('drawShowLayerButton', next); } catch (_) { /* ignore */ }
    if (next) wx.showToast({ title: '图层按钮已显示', icon: 'success', duration: 1200 });
  },

  onResetView() {
    this.engine?.resetTransform();
    this.setData({ showSettings: false, zoomLevel: 100 });
    wx.showToast({ title: '视角已重置', icon: 'success', duration: 1000 });
  },

  // ==================== 缩放 ====================

  onZoomIn() {
    if (!this.engine) return;
    this.engine.zoomIn();
    this.setData({ zoomLevel: Math.round(this.engine.scale * 100) });
  },

  onZoomOut() {
    if (!this.engine) return;
    this.engine.zoomOut();
    this.setData({ zoomLevel: Math.round(this.engine.scale * 100) });
  },

  toggleZoomMode() {
    const next = !this.data.isZoomMode;
    this.setData({ isZoomMode: next });
    wx.showToast({ title: next ? '缩放模式：可拖动/缩放' : '绘制模式', icon: 'none', duration: 1000 });
  },

  onZoomReset() {
    if (!this.engine) return;
    this.engine.resetTransform();
    this.setData({ zoomLevel: 100 });
    wx.vibrateShort({ type: 'light' });
  },

  // ==================== 笔刷菜单 ====================

  onColorLongPress() {
    this.setData({ showBrushMenu: !this.data.showBrushMenu });
  },

  // ==================== 高级功能（笔刷菜单内） ====================

  onAdvancedImage() {
    this.setData({ showBrushMenu: false });
    this.onImportImage();
  },

  onAdvancedPickColor() {
    this.setData({ showBrushMenu: false });
    this.onPickColor();
  },

  onAdvancedBackground() {
    this.setData({ showBrushMenu: false, showBgColors: true });
    this.openColorPanel();
  },
});
