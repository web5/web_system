import { BrushType, BrushConfig, getBrushConfig } from './Brush';
import { LayerData, createLayer, compositeLayers } from './Layer';
import { HistoryManager } from './History';
import { type ShapeType, SHAPE_DRAWERS } from './shapes';
import { type Point } from './catmullRom';
import * as Vp from './CanvasEngine.viewport';
import { drawShapeOnContext } from './CanvasEngine.shapes';
import * as Path from './CanvasEngine.path';

export interface EngineOptions {
  width: number;
  height: number;
  dpr: number;
  mainCtx: any;
  mainCanvas: any;
  /** 画布内容发生变化时的回调 */
  onContentChange?: () => void;
}

export class CanvasEngine {
  width: number;
  height: number;
  dpr: number;
  mainCtx: any;
  mainCanvas: any;

  // 图层
  layers: LayerData[] = [];
  activeLayerIndex = 0;

  // 笔刷
  currentBrush: BrushConfig;
  currentColor = '#000000';
  currentSize: number;

  // 背景色
  backgroundColor = '#ffffff';

  // 历史
  history: HistoryManager;

  // 画布视口变换（双指拖动）
  panX = 0;
  panY = 0;
  scale = 1;

  // 网格
  showGrid = false;
  gridSize = 40;

  // 路径缓冲（由 CanvasEngine.path 模块使用，需为 public）
  pointBuffer: Point[] = [];
  lastDrawnPoint: Point | null = null;
  // 是否有绘制内容（用于素材栏显示判断）
  private _hasContent = false;

  // undo/redo 后保存的基层图片（解决 undo 后图层数据丢失问题）
    undoBaseImage: any = null;
    // 内容变化回调
    onContentChange?: () => void;

  constructor(options: EngineOptions) {
    this.width = options.width;
    this.height = options.height;
    this.dpr = options.dpr;
    this.mainCtx = options.mainCtx;
    this.mainCanvas = options.mainCanvas;
    this.onContentChange = options.onContentChange;
    this.history = new HistoryManager(30, options.width, options.height);
    this.currentBrush = getBrushConfig('pencil');
    this.currentSize = this.currentBrush.size;
    this.currentColor = this.currentBrush.color;
  }

  /** 初始化 */
  init() {
    const bg = createLayer(this);
    bg.name = '背景层';
    this.layers.push(bg);
    this.activeLayerIndex = 0;

    // 填充背景色
    this.mainCtx.fillStyle = this.backgroundColor;
    this.mainCtx.fillRect(0, 0, this.width, this.height);

    this.compositeToMain();
    this.saveSnapshot();
  }

  /** 切换笔刷 */
  setBrush(type: BrushType) {
    this.currentBrush = getBrushConfig(type);
    this.currentSize = this.currentBrush.size;
    if (type !== 'eraser' && type !== 'highlighter') {
      this.currentBrush.color = this.currentColor;
    }
  }

  /** 切换颜色 */
  setColor(color: string) {
    this.currentColor = color;
    this.currentBrush.color = color;
  }

  /** 设置笔刷大小 */
  setSize(size: number) {
    this.currentSize = Math.max(
      this.currentBrush.minSize,
      Math.min(this.currentBrush.maxSize, size)
    );
  }

  /** 设置背景色（空字符串 = 透明） */
  setBackgroundColor(color: string) {
    this.backgroundColor = color;
    this.compositeToMain();
    this.saveSnapshot();
  }

  // ===== 画布视口变换 =====

  /** 屏幕坐标 → 世界坐标 */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return Vp.screenToWorld(this, sx, sy);
  }

  /** 位移画布 */
  pan(dx: number, dy: number) {
    Vp.applyPan(this, dx, dy);
    this.compositeToMain();
  }

  /** 设置缩放（以任意点为中心，不触发 compositeToMain） */
  zoomAt(scaleFactor: number, cx: number, cy: number) {
    Vp.applyZoomAt(this, scaleFactor, cx, cy);
  }

  /** 放大（以画布中心） */
  zoomIn() {
    this.zoomAt(1.25, this.width / 2, this.height / 2);
    this.compositeToMain();
  }

  /** 缩小（以画布中心） */
  zoomOut() {
    this.zoomAt(0.8, this.width / 2, this.height / 2);
    this.compositeToMain();
  }

  /** 重置视口 */
  resetTransform() {
    Vp.resetTransform(this);
    this.compositeToMain();
  }

  /** 获取当前活动图层的 context */
  getActiveCtx() {
    if (this.layers.length === 0) return null;
    return this.layers[this.activeLayerIndex].ctx;
  }

  /** 是否有绘制内容 */
  get hasContent(): boolean { return this._hasContent; }

  /** 标记画布有内容（素材插入等场景） */
  markContent() {
    this._hasContent = true;
  }

  /** 采样检测画布是否为空（undo/redo 后回退使用，仅检测 alpha 通道） */
  isCanvasBlank(): boolean {
    const sampleStep = 8; // 每8px采样一次
    for (const layer of this.layers) {
      try {
        const w = this.width * this.dpr;
        const h = this.height * this.dpr;
        const imageData = layer.ctx.getImageData(0, 0, w, h);
        const pixels = imageData.data;
        for (let y = 0; y < h; y += sampleStep) {
          for (let x = 0; x < w; x += sampleStep) {
            if (pixels[(y * w + x) * 4 + 3] !== 0) {
              return false;
            }
          }
        }
      } catch (_) { /* ignore */ }
    }
    return true;
  }

  /** 开始绘制 */
  beginPath(x: number, y: number) {
    Path.beginPath(this, x, y);
  }

  /** 绘制线段（Catmull-Rom 样条插值） */
  drawSegment(x: number, y: number, _lastX: number, _lastY: number) {
    Path.drawSegment(this, x, y);
  }

  /** 结束绘制 */
  endPath(x: number, y: number) {
    Path.endPath(this, x, y);
  }

  /** 合成所有图层到主 canvas（缩放/平移只作用于活动图层） */
  compositeToMain() {
    compositeLayers(this.layers, this.mainCtx, this.width, this.height, this.backgroundColor, this.panX, this.panY, this.scale, this.undoBaseImage, this.activeLayerIndex);
  }

  /** 保存历史快照 */
  saveSnapshot() {
    this.history.push(this.mainCtx, this.backgroundColor, this.width * this.dpr, this.height * this.dpr);
    // 注意：不清除 undoBaseImage，因为图层上的新笔触是累积的，
    // compositeToMain 需要 undoBaseImage 作为基层叠加新笔触；
    // 下次 undo/redo 会通过 captureUndoBase 覆盖为新的状态。
    this.onContentChange?.();
  }

  /** 撤销 */
  undo() {
    const snapshot = this.history.undo();
    if (!snapshot) return;
    const bg = this.history.restore(this.mainCtx);
    if (bg !== undefined) this.backgroundColor = bg;
    this.clearAllLayerCanvases();
    // 保存恢复后的画面作为基层，后续 compositeToMain 时置于图层之下
    this.captureUndoBase();
    // 撤回后重新检测是否为空
    this._hasContent = !this.isCanvasBlank();
    this.onContentChange?.();
  }

  /** 重做 */
  redo() {
    const snapshot = this.history.redo();
    if (!snapshot) return;
    const bg = this.history.restore(this.mainCtx);
    if (bg !== undefined) this.backgroundColor = bg;
    this.clearAllLayerCanvases();
    this.captureUndoBase();
    this._hasContent = !this.isCanvasBlank();
    this.onContentChange?.();
  }

  /** 从主画布捕获当前画面作为 undo 基层 */
  private captureUndoBase() {
    try {
      const w = this.width * this.dpr;
      const h = this.height * this.dpr;
      this.undoBaseImage = this.mainCtx.getImageData(0, 0, w, h);
    } catch (_) {
      this.undoBaseImage = null;
    }
  }

  /** 清空所有图层 canvas（撤销/重做后调用，避免旧图层数据覆盖恢复后的主画布）*/
  private clearAllLayerCanvases() {
    for (const layer of this.layers) {
      const ctx = layer.ctx;
      ctx.clearRect(0, 0, this.width * this.dpr, this.height * this.dpr);
    }
  }

  // ========== 预设图形 ==========

  /** 在指定位置绘制预设图形 */
  drawShape(type: ShapeType, cx: number, cy: number, size: number) {
    const ctx = this.getActiveCtx();
    if (!ctx) return;

    drawShapeOnContext(ctx, type, cx, cy, size, this.currentColor, this.currentSize);

    this.compositeToMain();
    this.saveSnapshot();
    if (!this._hasContent) this._hasContent = true;
  }

  canUndo(): boolean { return this.history.canUndo(); }
  canRedo(): boolean { return this.history.canRedo(); }

  /**
   * 调整画布尺寸（设备旋转时调用）
   * 由 Page 层负责保存/恢复主画布内容，此方法仅更新引擎内部状态并重建图层。
   * Page 层调用顺序：
   *   1. engine.compositeToMain()
   *   2. 保存主画布内容到临时 canvas
   *   3. 重新设置 mainCanvas.width/height
   *   4. 重新应用 ctx.scale(dpr, dpr)
   *   5. 从临时 canvas 恢复内容到主画布
   *   6. 调用此方法（newWidth/newHeight/newDpr 已更新）
   */
  resize(newWidth: number, newHeight: number, newDpr: number) {
    // 1. 更新内部状态
    this.width = newWidth;
    this.height = newHeight;
    this.dpr = newDpr;

    // 2. 重建图层（OffscreenCanvas 尺寸需要随引擎尺寸更新）
    const oldLayerStates = this.layers.map(l => ({
      visible: l.visible,
      opacity: l.opacity,
      name: l.name,
      offsetX: l.offsetX || 0,
      offsetY: l.offsetY || 0,
    }));
    this.layers = [];
    for (const state of oldLayerStates) {
      const layer = createLayer(this);
      layer.name = state.name;
      layer.visible = state.visible;
      layer.opacity = state.opacity;
      layer.offsetX = state.offsetX;
      layer.offsetY = state.offsetY;
      this.layers.push(layer);
    }

    // 3. 将主画布当前内容绘制到活动图层（保持图层系统可正常工作）
    const activeCtx = this.getActiveCtx();
    if (activeCtx) {
      activeCtx.drawImage(this.mainCanvas, 0, 0, newWidth, newHeight);
    }

    // 4. 重新合成
    this.compositeToMain();

    // 5. 保存快照
    this.saveSnapshot();
  }

  // ========== 图层操作 ==========

  addLayer() {
    const layer = createLayer(this);
    layer.name = `图层 ${this.layers.length + 1}`;
    this.layers.push(layer);
    this.activeLayerIndex = this.layers.length - 1;
    this.compositeToMain();
    this.saveSnapshot();
    return this.layers.length;
  }

  /** 移动指定图层（世界坐标增量 dx/dy） */
  moveLayer(index: number, dx: number, dy: number) {
    const layer = this.layers[index];
    if (!layer) return;
    layer.offsetX = (layer.offsetX || 0) + dx;
    layer.offsetY = (layer.offsetY || 0) + dy;
    this.compositeToMain();
  }

  /** 确认图层移动结束（保存快照，使移动可撤销） */
  commitLayerMove(index: number) {
    // 图层偏移量不重置，仅在此处保存快照以便 undo
    this.saveSnapshot();
    if (!this._hasContent) this._hasContent = true;
  }

  removeLayer(index?: number) {
    const idx = index ?? this.activeLayerIndex;
    if (this.layers.length <= 1) return;
    this.layers.splice(idx, 1);
    this.activeLayerIndex = Math.max(0, this.activeLayerIndex - 1);
    this.compositeToMain();
    this.saveSnapshot();
  }

  setLayerVisible(index: number, visible: boolean) {
    if (this.layers[index]) {
      this.layers[index].visible = visible;
      this.compositeToMain();
    }
  }

  setActiveLayer(index: number) {
    if (index >= 0 && index < this.layers.length) {
      this.activeLayerIndex = index;
    }
  }

  mergeDown() {
    const idx = this.activeLayerIndex;
    if (idx <= 0 || idx >= this.layers.length) return;

    const lower = this.layers[idx - 1];
    const upper = this.layers[idx];
    
    // 将上层 canvas 内容绘制到下层 context
    // 注意：两个 canvas 都是物理像素尺寸（width*dpr × height*dpr）
    // 但 context 已经应用了 scale(dpr, dpr)，所以使用逻辑坐标
    lower.ctx.drawImage(
      upper.canvas,
      0, 0, this.width * this.dpr, this.height * this.dpr,  // 源矩形（物理像素）
      0, 0, this.width, this.height  // 目标矩形（逻辑坐标）
    );
    
    this.layers.splice(idx, 1);
    this.activeLayerIndex = Math.max(0, idx - 1);
    this.compositeToMain();
    this.saveSnapshot();
    
    // 标记有内容（如果上层有内容的话）
    if (!this._hasContent) this._hasContent = true;
  }

  /** 拖动图层到新位置（重新排序） */
  reorderLayer(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.layers.length) return;
    if (toIndex < 0 || toIndex >= this.layers.length) return;
    const [layer] = this.layers.splice(fromIndex, 1);
    this.layers.splice(toIndex, 0, layer);
    this.activeLayerIndex = toIndex;
    this.compositeToMain();
  }

  // ========== 画布操作 ==========

  /** 清空画布 */
  clear() {
    for (const layer of this.layers) {
      layer.ctx.clearRect(0, 0, this.width, this.height);
    }
    this.mainCtx.clearRect(0, 0, this.width * this.dpr, this.height * this.dpr);
    this.mainCtx.fillStyle = this.backgroundColor;
    this.mainCtx.fillRect(0, 0, this.width, this.height);
    this._hasContent = false;
    this.saveSnapshot();
  }

  /** 导入图片 */
  async importImage(path: string) {
    const ctx = this.getActiveCtx();
    if (!ctx) return;

    const img = this.mainCanvas.createImage();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = path;
    });

    const ratio = Math.min(
      this.width / img.width,
      this.height / img.height,
      1
    );
    const w = img.width * ratio;
    const h = img.height * ratio;
    const x = (this.width - w) / 2;
    const y = (this.height - h) / 2;

    ctx.drawImage(img, x, y, w, h);
    if (!this._hasContent) this._hasContent = true;
    this.compositeToMain();
    this.saveSnapshot();
  }

  /** 取色 */
  pickColor(x: number, y: number): string | null {
    try {
      // 屏幕坐标转世界坐标，再乘 dpr 映射到主 canvas 像素
      const world = this.screenToWorld(x, y);
      const px = Math.round(world.x * this.dpr);
      const py = Math.round(world.y * this.dpr);
      const pixel = this.mainCtx.getImageData(px, py, 1, 1);
      const [r, g, b] = pixel.data;
      return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    } catch (e) {
      return null;
    }
  }

  /** 从图片 data URL 恢复画布内容（用于加载历史记录） */
  restoreFromImage(dataUrl: string) {
    const img = this.mainCanvas.createImage();
    img.onload = () => {
      // 将历史图片绘制到活动图层上，这样后续继续绘制时新笔触和历史内容在同一图层共存
      const layerCtx = this.getActiveCtx();
      if (layerCtx) {
        layerCtx.clearRect(0, 0, this.width, this.height);
        layerCtx.drawImage(img, 0, 0, this.width, this.height);
      }
      this._hasContent = true;
      this.compositeToMain();
      this.saveSnapshot();
      this.onContentChange?.();
    };
    img.src = dataUrl;
  }

  /** 切换网格 */
  toggleGrid() {
    this.showGrid = !this.showGrid;
    this.compositeToMain();
    if (this.showGrid) this.drawGridOverlay();
  }

  private drawGridOverlay() {
    const ctx = this.mainCtx;
    ctx.save();
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.3;
    for (let x = 0; x <= this.width; x += this.gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }
    for (let y = 0; y <= this.height; y += this.gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

}
