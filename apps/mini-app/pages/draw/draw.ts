// pages/draw/draw.ts
import { CanvasEngine } from '../../utils/CanvasEngine';
import { BrushType } from '../../utils/Brush';

/** SVG 图标集合（data URI） */
const ICONS = {
  back: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M19 12H5M12 19l-7-7 7-7"/%3E%3C/svg%3E',
  undo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="1 4 1 10 7 10"/%3E%3Cpath d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/%3E%3C/svg%3E',
  redo: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="23 4 23 10 17 10"/%3E%3Cpath d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/%3E%3C/svg%3E',
  layers: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolygon points="12 2 22 8.5 12 15 2 8.5 12 2"/%3E%3Cpolyline points="2 15.5 12 22 22 15.5"/%3E%3C/svg%3E',
  close: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="2" stroke-linecap="round"%3E%3Cline x1="18" y1="6" x2="6" y2="18"/%3E%3Cline x1="6" y1="6" x2="18" y2="18"/%3E%3C/svg%3E',
  pencil: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/%3E%3C/svg%3E',
  marker: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m12 19 7-7 3 3-7 7-3-3z"/%3E%3Cpath d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/%3E%3Cpath d="m2 2 7.586 7.586"/%3E%3Ccircle cx="11" cy="11" r="2"/%3E%3C/svg%3E',
  highlighter: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m9 11-6 6v3h9l3-3"/%3E%3Cpath d="m22 12-4-4-4 4 4 4 4-4z"/%3E%3Cpath d="M14 10V3l-4 4h1"/%3E%3C/svg%3E',
  eraser: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10.4-10.4a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/%3E%3Cpath d="M7 21h8"/%3E%3Cpath d="M17 13.8V21"/%3E%3C/svg%3E',
  palette: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="13.5" cy="6.5" r="2"/%3E%3Ccircle cx="17.5" cy="10.5" r="2"/%3E%3Ccircle cx="8.5" cy="7.5" r="2"/%3E%3Ccircle cx="6.5" cy="12.5" r="2"/%3E%3Cpath d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.5-4.5-10-10-10z"/%3E%3C/svg%3E',
  image: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"/%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"/%3E%3Cpolyline points="21 15 16 10 5 21"/%3E%3C/svg%3E',
  trash: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="3 6 5 6 21 6"/%3E%3Cpath d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/%3E%3Cpath d="M10 11v6"/%3E%3Cpath d="M14 11v6"/%3E%3Cpath d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/%3E%3C/svg%3E',
  download: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/%3E%3Cpolyline points="7 10 12 15 17 10"/%3E%3Cline x1="12" y1="15" x2="12" y2="3"/%3E%3C/svg%3E',
  eyedropper: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m2 22 1-1h3l9-9"/%3E%3Cpath d="M3 21 12 12"/%3E%3Cpath d="M13.5 3.5a2.12 2.12 0 0 1 3 3L11 13l-4 1 1-4 5.5-5.5z"/%3E%3C/svg%3E',
  plus: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round"%3E%3Cline x1="12" y1="5" x2="12" y2="19"/%3E%3Cline x1="5" y1="12" x2="19" y2="12"/%3E%3C/svg%3E',
  eye: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3C/svg%3E',
  eyeOff: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/%3E%3Cpath d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/%3E%3Cpath d="m14.12 14.12a3 3 0 1 1-4.24-4.24"/%3E%3Cline x1="1" y1="1" x2="23" y2="23"/%3E%3C/svg%3E',
  merge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M8 6h10"/%3E%3Cpath d="M6 12h12"/%3E%3Cpath d="M8 18h8"/%3E%3C/svg%3E',
  size: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round"%3E%3Ccircle cx="12" cy="12" r="2"/%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3C/svg%3E',
  gear: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23333" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3Cpath d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/%3E%3C/svg%3E',
};

// 暗色版图标（用于顶部栏和浮动工具栏）
const ICONS_WHITE = {
  back: ICONS.back.replace(/%23333/g, '%23fff'),
  undo: ICONS.undo.replace(/%23333/g, '%23fff'),
  redo: ICONS.redo.replace(/%23333/g, '%23fff'),
  layers: ICONS.layers.replace(/%23333/g, '%23fff'),
  pencil: ICONS.pencil.replace(/%23333/g, '%23fff'),
  marker: ICONS.marker.replace(/%23333/g, '%23fff'),
  highlighter: ICONS.highlighter.replace(/%23333/g, '%23fff'),
  eraser: ICONS.eraser.replace(/%23333/g, '%23fff'),
  plus: ICONS.plus.replace(/%23333/g, '%23fff'),
  trash: ICONS.trash.replace(/%23333/g, '%23fff'),
  download: ICONS.download.replace(/%23333/g, '%23fff'),
  image: ICONS.image.replace(/%23333/g, '%23fff'),
  eyedropper: ICONS.eyedropper.replace(/%23333/g, '%23fff'),
  palette: ICONS.palette.replace(/%23333/g, '%23fff'),
  gear: ICONS.gear.replace(/%23333/g, '%23fff'),
};

Page({
  data: {
    icons: ICONS,
    iconsWhite: ICONS_WHITE,

    // 颜色
    colors: [
      '#000000', '#595959', '#8c8c8c', '#bfbfbf',
      '#f5222d', '#fa541c', '#fa8c16', '#fadb14',
      '#52c41a', '#13c2c2', '#1677ff', '#2f54eb',
      '#722ed1', '#eb2f96', '#ffffff',
    ],
    bgColors: [
      '#ffffff', '#f5f5f5', '#e8e8e8', '#d9d9d9',
      '#000000', '#595959', '#f5222d', '#fa8c16',
      '#fadb14', '#52c41a', '#1677ff', '#722ed1',
      '#eb2f96', 'transparent',
    ],
    showBgColors: false, // 是否正在选择背景色（独立色板）
    currentColor: '#000000',

    // 笔刷
    brushes: [
      { type: 'pencil' as BrushType, name: '铅笔', icon: ICONS.pencil },
      { type: 'marker' as BrushType, name: '马克笔', icon: ICONS.marker },
      { type: 'highlighter' as BrushType, name: '荧光笔', icon: ICONS.highlighter },
      { type: 'eraser' as BrushType, name: '橡皮', icon: ICONS.eraser },
    ] as { type: BrushType; name: string; icon: string }[],
    currentBrush: 'pencil' as BrushType,
    currentBrushName: '铅笔',
    currentBrushIcon: ICONS_WHITE.pencil,
    brushSize: 3,

    // 绘制状态
    isDrawing: false,

    // 图层
    layers: [] as { id: string; name: string; visible: boolean; active: boolean }[],
    showLayers: false,
    showLayerButton: false,  // 默认不显示，在设置中开启

    // 撤销/重做
    canUndo: false,
    canRedo: false,

    // 面板
    showBrushPanel: false,
    showColorPanel: false,
    showActionPanel: false,
    showBrushMenu: false,
    showSettings: false,
    isPickingBackground: false,
    backgroundColor: '#ffffff',

    // 缩放
    zoomLevel: 100,
    isZoomMode: false,  // 缩放模式锁定：开启后单指拖动画布，不绘制

    // 画布
    canvasWidth: 0,
    canvasHeight: 0,
  },

  engine: null as CanvasEngine | null,
  rectInfo: null as { left: number; top: number } | null,
  lastX: 0,
  lastY: 0,
  isTouching: false,
  isPanning: false,
  // 双指拖动初始状态
  panStartMid: { x: 0, y: 0 },
  panStartDist: 0,
  panStartOffset: { x: 0, y: 0 },
  panStartScale: 1,

  onLoad() {
    wx.setNavigationBarTitle({ title: '画板' });
    // 读取持久化设置
    try {
      const setting = wx.getStorageSync('drawShowLayerButton');
      if (setting === true) {
        this.setData({ showLayerButton: true });
      }
    } catch (e) { /* ignore */ }
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').fields({ node: true, size: true }).exec((res) => {
      if (res && res[0] && res[0].node) {
        const canvas = res[0].node as any;
        const ctx = canvas.getContext('2d', { webkitRerender: true });

        const sysInfo = wx.getSystemInfoSync();
        const dpr = sysInfo.pixelRatio || 1;

        const canvasWidth = res[0].width;
        const canvasHeight = res[0].height;

        canvas.width = canvasWidth * dpr;
        canvas.height = canvasHeight * dpr;
        ctx.scale(dpr, dpr);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const engine = new CanvasEngine({
          width: canvasWidth,
          height: canvasHeight,
          dpr,
          mainCtx: ctx,
          mainCanvas: canvas,
        });
        engine.init();

        this.engine = engine;
        this.setData({ canvasWidth, canvasHeight });
        this.updateLayers();
      }
    });

    wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res) => {
      if (res && res[0]) {
        this.rectInfo = res[0] as { left: number; top: number };
      }
    });
  },

  // ===== 坐标转换 =====

  getCanvasPos(e: any) {
    return new Promise<{ x: number; y: number }>((resolve) => {
      if (this.rectInfo) {
        const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
        resolve({ x: touch.clientX - this.rectInfo.left, y: touch.clientY - this.rectInfo.top });
        return;
      }
      wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res) => {
        if (res && res[0]) {
          const rect = res[0] as { left: number; top: number };
          const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
          resolve({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
        } else {
          resolve({ x: 0, y: 0 });
        }
      });
    });
  },

  // ===== 触摸事件 =====

  async onTouchStart(e: any) {
    if (!this.engine) return;

    const touches = e.touches;

    // 双指 → 拖动/缩放
    if (touches.length >= 2) {
      this.isPanning = true;
      this.isTouching = false;

      const rect = this.rectInfo || { left: 0, top: 0 };
      const t0 = touches[0];
      const t1 = touches[1];
      const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
      const my = (t0.clientY + t1.clientY) / 2 - rect.top;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      this.panStartMid = { x: mx, y: my };
      this.panStartDist = Math.sqrt(dx * dx + dy * dy);
      this.panStartOffset = { x: this.engine.panX, y: this.engine.panY };
      this.panStartScale = this.engine.scale;
      return;
    }

    // 单指 → 缩放模式下拖动，否则绘制
    if (this.data.showColorPanel || this.data.showActionPanel) return;
    this.isPanning = false;

    // 缩放锁定模式：单指拖动画布
    if (this.data.isZoomMode) {
      this.isPanning = true;
      this.isTouching = false;
      const pos = await this.getCanvasPos(e);
      this.panStartMid = { x: pos.x, y: pos.y };
      this.panStartOffset = { x: this.engine.panX, y: this.engine.panY };
      this.panStartScale = this.engine.scale;
      return;
    }

    const pos = await this.getCanvasPos(e);
    const worldPos = this.engine.screenToWorld(pos.x, pos.y);

    this.isTouching = true;
    this.lastX = worldPos.x;
    this.lastY = worldPos.y;

    this.engine.beginPath(worldPos.x, worldPos.y);
    this.setData({ isDrawing: true });
  },

  async onTouchMove(e: any) {
    if (!this.engine) return;

    const touches = e.touches;

    // 双指拖动/缩放
    if (this.isPanning && touches.length >= 2) {
      const rect = this.rectInfo || { left: 0, top: 0 };
      const t0 = touches[0];
      const t1 = touches[1];
      const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
      const my = (t0.clientY + t1.clientY) / 2 - rect.top;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 基于初始状态计算目标缩放
      const scaleFactor = this.panStartDist > 0 ? dist / this.panStartDist : 1;
      const newScale = Math.max(0.3, Math.min(5, this.panStartScale * scaleFactor));

      // 以初始双指中点为中心缩放
      this.engine.panX = this.panStartMid.x - (this.panStartMid.x - this.panStartOffset.x) * (newScale / this.panStartScale);
      this.engine.panY = this.panStartMid.y - (this.panStartMid.y - this.panStartOffset.y) * (newScale / this.panStartScale);
      this.engine.scale = newScale;

      // 叠加中点平移
      this.engine.panX += mx - this.panStartMid.x;
      this.engine.panY += my - this.panStartMid.y;
      this.engine.compositeToMain();
      return;
    }

    // 单指拖动（缩放锁定模式）
    if (this.isPanning && this.data.isZoomMode) {
      const pos = await this.getCanvasPos(e);
      const dx = pos.x - this.panStartMid.x;
      const dy = pos.y - this.panStartMid.y;
      this.engine.panX = this.panStartOffset.x + dx;
      this.engine.panY = this.panStartOffset.y + dy;
      this.engine.compositeToMain();
      return;
    }

    // 单指绘制
    if (this.data.showColorPanel || this.data.showActionPanel || !this.isTouching) return;
    const pos = await this.getCanvasPos(e);
    const worldPos = this.engine.screenToWorld(pos.x, pos.y);

    this.engine.drawSegment(worldPos.x, worldPos.y, this.lastX, this.lastY);
    this.lastX = worldPos.x;
    this.lastY = worldPos.y;
  },

  async onTouchEnd(e: any) {
    if (!this.engine) return;

    // 双指结束
    if (this.isPanning) {
      this.isPanning = false;
      this.setData({ zoomLevel: Math.round(this.engine.scale * 100) });
      // 保存快照（拖动不改变内容，但缩放后需要记录当前状态）
      this.engine.saveSnapshot();
      return;
    }

    // 单指绘制结束
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

  // ===== 笔刷 =====

  selectBrush(e: any) {
    const type = e.currentTarget.dataset.type as BrushType;
    this.engine?.setBrush(type);
    const brushInfo = this.data.brushes.find(b => b.type === type);
    const whiteIcon = (ICONS_WHITE as any)[type] || ICONS_WHITE.pencil;
    this.setData({
      currentBrush: type,
      currentBrushName: brushInfo?.name || '铅笔',
      currentBrushIcon: whiteIcon,
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

  // ===== 颜色 =====

  selectColor(e: any) {
    const color = e.currentTarget.dataset.color;
    if (this.data.isPickingBackground || this.data.showBgColors) {
      // 设为背景色：transparent 传空字符串
      const bgColor = color === 'transparent' ? '' : color;
      this.engine?.setBackgroundColor(bgColor);
      this.setData({
        backgroundColor: color === 'transparent' ? '' : color,
        showColorPanel: false,
        isPickingBackground: false,
        showBgColors: false,
      });
      wx.showToast({ title: color === 'transparent' ? '背景已设为透明' : '背景色已更新', icon: 'success', duration: 1000 });
      return;
    }
    this.engine?.setColor(color);
    this.setData({ currentColor: color, showColorPanel: false });
  },

  // ===== 撤销/重做 =====

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

  // ===== 清空 =====

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

  // ===== 保存 =====

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

  // ===== 图片导入 =====

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
        }).catch(() => {
          wx.showToast({ title: '导入失败', icon: 'none' });
        });
      },
    });
  },

  // ===== 取色器 =====

  onPickColor() {
    wx.showToast({ title: '点击画布取色', icon: 'none', duration: 1500 });
    this.setData({ showColorPanel: true });
  },

  async onCanvasTapForPick(e: any) {
    if (!this.engine || !this.data.showColorPanel) return;
    const pos = await this.getCanvasPos(e);
    const color = this.engine.pickColor(pos.x, pos.y);
    if (color) {
      this.engine.setColor(color);
      this.setData({ currentColor: color, showColorPanel: false });
      wx.showToast({ title: '已取色', icon: 'success' });
    }
  },

  // ===== 图层 =====

  toggleLayers() {
    this.setData({ showLayers: !this.data.showLayers, showActionPanel: false });
    if (!this.data.showLayers) return;
    this.updateLayers();
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
    const index = e.currentTarget.dataset.index;
    this.engine?.setActiveLayer(index);
    this.updateLayers();
  },

  toggleLayerVisible(e: any) {
    const index = e.currentTarget.dataset.index;
    const layer = this.engine?.layers[index];
    if (layer) {
      this.engine?.setLayerVisible(index, !layer.visible);
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
        id: l.id,
        name: l.name,
        visible: l.visible,
        active: i === activeIdx,
      })),
    });
  },

  // ===== 面板切换 =====

  toggleBrushPanel() {
    this.setData({
      showBrushPanel: !this.data.showBrushPanel,
      showColorPanel: false,
      showActionPanel: false,
    });
  },

  toggleActionPanel() {
    this.setData({
      showActionPanel: !this.data.showActionPanel,
      showBrushPanel: false,
      showColorPanel: false,
    });
  },

  openColorPanel() {
    this.setData({
      showColorPanel: true,
      showBrushPanel: false,
      showActionPanel: false,
    });
  },

  closeColorPanel() {
    this.setData({ showColorPanel: false });
  },

  closeAllPanels() {
    this.setData({
      showBrushPanel: false,
      showColorPanel: false,
      showActionPanel: false,
      showLayers: false,
      showBrushMenu: false,
      showSettings: false,
      isPickingBackground: false,
      showBgColors: false,
    });
  },

  // ===== 设置 =====

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings });
  },

  toggleLayerButton() {
    const next = !this.data.showLayerButton;
    this.setData({ showLayerButton: next });
    try {
      wx.setStorageSync('drawShowLayerButton', next);
    } catch (e) { /* ignore */ }
    if (next) {
      wx.showToast({ title: '图层按钮已显示', icon: 'success', duration: 1200 });
    }
  },

  onResetView() {
    this.engine?.resetTransform();
    this.setData({ showSettings: false, zoomLevel: 100 });
    wx.showToast({ title: '视角已重置', icon: 'success', duration: 1000 });
  },

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

  /** 缩放模式锁定/解锁：锁定后单指拖动不绘制 */
  toggleZoomMode() {
    const next = !this.data.isZoomMode;
    this.setData({ isZoomMode: next });
    wx.showToast({ title: next ? '缩放模式：可拖动/缩放' : '绘制模式', icon: 'none', duration: 1000 });
  },

  /** 快速回到 100% */
  onZoomReset() {
    if (!this.engine) return;
    this.engine.resetTransform();
    this.setData({ zoomLevel: 100 });
    wx.vibrateShort({ type: 'light' });
  },

  // ===== 长按颜色 → 笔刷+粗细 =====

  onColorLongPress() {
    this.setData({ showBrushMenu: !this.data.showBrushMenu });
  },

  // ===== 高级功能（图片/取色/背景） =====

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
