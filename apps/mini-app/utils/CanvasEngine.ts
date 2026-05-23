import { BrushType, BrushConfig, getBrushConfig } from './Brush';
import { LayerData, createLayer, compositeLayers } from './Layer';
import { HistoryManager } from './History';

export interface EngineOptions {
  width: number;
  height: number;
  dpr: number;
  mainCtx: any;
  mainCanvas: any;
}

interface Point {
  x: number;
  y: number;
}

/** Catmull-Rom 样条曲线插值 */
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    ),
  };
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

  // 路径缓冲
  private pointBuffer: Point[] = [];
  // 上次实际绘制到的点（避免重复绘制路径累积）
  private lastDrawnPoint: Point | null = null;

  constructor(options: EngineOptions) {
    this.width = options.width;
    this.height = options.height;
    this.dpr = options.dpr;
    this.mainCtx = options.mainCtx;
    this.mainCanvas = options.mainCanvas;
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
    return {
      x: (sx - this.panX) / this.scale,
      y: (sy - this.panY) / this.scale,
    };
  }

  /** 位移画布 */
  pan(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    this.compositeToMain();
  }

  /** 设置缩放（以任意点为中心，不触发 compositeToMain） */
  zoomAt(scaleFactor: number, cx: number, cy: number) {
    const newScale = Math.max(0.3, Math.min(5, this.scale * scaleFactor));
    this.panX = cx - (cx - this.panX) * (newScale / this.scale);
    this.panY = cy - (cy - this.panY) * (newScale / this.scale);
    this.scale = newScale;
  }

  /** 放大（以画布中心） */
  zoomIn() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    this.zoomAt(1.25, cx, cy);
    this.compositeToMain();
  }

  /** 缩小（以画布中心） */
  zoomOut() {
    const cx = this.width / 2;
    const cy = this.height / 2;
    this.zoomAt(0.8, cx, cy);
    this.compositeToMain();
  }

  /** 重置视口 */
  resetTransform() {
    this.panX = 0;
    this.panY = 0;
    this.scale = 1;
    this.compositeToMain();
  }

  /** 获取当前活动图层的 context */
  getActiveCtx() {
    if (this.layers.length === 0) return null;
    return this.layers[this.activeLayerIndex].ctx;
  }

  /** 开始绘制 */
  beginPath(x: number, y: number) {
    const ctx = this.getActiveCtx();
    if (!ctx) return;

    ctx.save();
    ctx.lineWidth = this.currentSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.currentBrush.color;
    ctx.globalAlpha = this.currentBrush.opacity;

    if (this.currentBrush.type === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else if (this.currentBrush.type === 'highlighter') {
      ctx.globalCompositeOperation = 'multiply';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    // 初始化点缓冲
    this.pointBuffer = [{ x, y }];
    this.lastDrawnPoint = null;

    // 先画一个点（避免起笔处只有一个点时什么都看不到）
    ctx.beginPath();
    ctx.arc(x, y, this.currentSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = this.currentBrush.color;
    ctx.fill();
  }

  /** Catmull-Rom 曲线步数 */
  private splineSteps = 16;

  /** 绘制线段（Catmull-Rom 样条插值） */
  drawSegment(x: number, y: number, _lastX: number, _lastY: number) {
    const ctx = this.getActiveCtx();
    if (!ctx) return;

    // 加入到缓冲
    this.pointBuffer.push({ x, y });
    const pts = this.pointBuffer;
    const n = pts.length;

    if (n < 2) return;

    // 确定从哪个点之后开始画（跳过已经画过的段）
    let drawFrom = 0;
    if (this.lastDrawnPoint) {
      for (let i = 0; i < n; i++) {
        if (
          Math.abs(pts[i].x - this.lastDrawnPoint!.x) < 0.01 &&
          Math.abs(pts[i].y - this.lastDrawnPoint!.y) < 0.01
        ) {
          drawFrom = i;
          break;
        }
      }
    }

    if (n === 2 && drawFrom === 0) {
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.5) return;
      this.drawLineSegment(ctx, pts[0], pts[1]);
      this.lastDrawnPoint = pts[1];
      // 实时合成到主 canvas，让用户看到绘制过程
      this.compositeToMain();
      return;
    }

    // 绘制从 drawFrom 开始的未绘制段
    for (let i = drawFrom; i < n - 1; i++) {
      const p0 = i - 1 >= 0 ? pts[i - 1] : pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = i + 2 < n ? pts[i + 2] : pts[i + 1];

      this.drawSplineSegment(ctx, p0, p1, p2, p3);
      this.lastDrawnPoint = p2;
    }

    // 实时合成到主 canvas
    this.compositeToMain();
  }

  /** 绘制一段 Catmull-Rom 样条：从 p1 到 p2 */
  private drawSplineSegment(ctx: any, p0: Point, p1: Point, p2: Point, p3: Point) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    if (Math.sqrt(dx * dx + dy * dy) < 0.5) return;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);

    for (let i = 1; i <= this.splineSteps; i++) {
      const t = i / this.splineSteps;
      const pt = catmullRom(p0, p1, p2, p3, t);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }

  /** 简单画直线 */
  private drawLineSegment(ctx: any, from: Point, to: Point) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.sqrt(dx * dx + dy * dy) < 0.5) return;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  /** 结束绘制 */
  endPath(x: number, y: number) {
    const ctx = this.getActiveCtx();
    if (!ctx) return;

    const pts = this.pointBuffer;
    // 画最后一个点到终点之间的部分
    if (pts.length > 0 && this.lastDrawnPoint) {
      const lastPt = pts[pts.length - 1];
      this.drawLineSegment(ctx, lastPt, { x, y });
    }

    ctx.restore();

    // 合成到主 canvas
    this.compositeToMain();
    // 保存快照
    this.saveSnapshot();

    // 清理
    this.pointBuffer = [];
    this.lastDrawnPoint = null;
  }

  /** 合成所有图层到主 canvas */
  compositeToMain() {
    compositeLayers(this.layers, this.mainCtx, this.width, this.height, this.backgroundColor, this.panX, this.panY, this.scale);
  }

  /** 保存历史快照 */
  saveSnapshot() {
    this.history.push(this.mainCtx, this.backgroundColor, this.width * this.dpr, this.height * this.dpr);
  }

  /** 撤销 */
  undo() {
    const snapshot = this.history.undo();
    if (!snapshot) return;
    const bg = this.history.restore(this.mainCtx);
    if (bg !== undefined) this.backgroundColor = bg;
  }

  /** 重做 */
  redo() {
    const snapshot = this.history.redo();
    if (!snapshot) return;
    const bg = this.history.restore(this.mainCtx);
    if (bg !== undefined) this.backgroundColor = bg;
  }

  canUndo(): boolean { return this.history.canUndo(); }
  canRedo(): boolean { return this.history.canRedo(); }

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
    lower.ctx.drawImage(upper.canvas, 0, 0);
    this.layers.splice(idx, 1);
    this.activeLayerIndex = Math.max(0, idx - 1);
    this.compositeToMain();
    this.saveSnapshot();
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
