/**
 * 变变创作页 — 素材拼贴画布
 * 支持多指触控、拖拽、缩放、旋转、删除
 */
import {
  MATERIAL_CATEGORIES,
  MATERIAL_LIBRARY,
  FUN_FACTS,
  STORAGE_KEYS,
} from '../../../utils/bianbian-constants';
import type { CanvasElement, MaterialItem } from '../../../utils/bianbian-constants';
import {
  saveDraft,
  loadDraft,
  clearDraft,
  canTransformToday,
  incrementDailyTransformCount,
  saveHistoryItem,
  getDailyTransformCount,
} from '../../../services/bianbian-storage';

/** 生成唯一 ID */
function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface TouchPoint {
  id: number;
  x: number;
  y: number;
}

Page({
  data: {
    categories: MATERIAL_CATEGORIES as Array<{ id: string; name: string; icon: string }>,
    activeCategory: 'all',
    filteredMaterials: [] as MaterialItem[],
    elements: [] as CanvasElement[],
    selectedIdx: -1,
    description: '',
    canvasWidth: 0,
    canvasHeight: 0,
    canvasBg: '#FFFFFF',
    /** 画布左上角在页面中的偏移 */
    canvasLeft: 0,
    canvasTop: 0,
  },

  /** 拖拽状态 */
  dragging: false,
  dragElementIdx: -1,
  dragStartX: 0,
  dragStartY: 0,
  dragStartElX: 0,
  dragStartElY: 0,
  lastTapTime: 0,
  /** 双指变换状态 */
  pinching: false,
  pinchStartDist: 0,
  pinchStartScale: 1,
  pinchStartRotation: 0,
  pinchStartAngle: 0,

  onLoad(options: { resume?: string }) {
    const sysInfo = wx.getWindowInfo();
    // 画布宽度占屏幕 90%，正方形
    const canvasWidth = Math.floor(sysInfo.windowWidth * 0.9);
    const canvasHeight = canvasWidth;

    // 筛选初始素材
    const filtered = this.filterMaterials('all');

    // 恢复草稿
    let elements: CanvasElement[] = [];
    let description = '';
    let canvasBg = '#FFFFFF';

    if (options.resume === '1') {
      const draft = loadDraft();
      if (draft) {
        elements = draft.elements;
        description = draft.description;
        canvasBg = draft.backgroundColor || '#FFFFFF';
      }
    }

    this.setData({
      filteredMaterials: filtered,
      canvasWidth,
      canvasHeight,
      canvasBg,
      elements,
      description,
    });

    // 计算画布偏移
    this.calcCanvasOffset();

    // 初始化 canvas（在 calcCanvasOffset 回调完成后执行）
    this.calcCanvasOffset(() => {
      this.initCanvas();
      if (elements.length > 0) {
        this.renderCanvas();
      }
    });
  },

  /** 计算画布页面偏移，支持回调 */
  calcCanvasOffset(callback?: () => void) {
    const query = wx.createSelectorQuery();
    query.select('.canvas-area').boundingClientRect();
    query.exec((res) => {
      if (res[0]) {
        this.setData({
          canvasLeft: res[0].left,
          canvasTop: res[0].top,
        });
      }
      if (callback) callback();
    });
  },

  /** 按分类筛选素材 */
  filterMaterials(catId: string): MaterialItem[] {
    if (catId === 'all') return [...MATERIAL_LIBRARY];
    return MATERIAL_LIBRARY.filter((m) => m.category === catId);
  },

  /** 切换分类 */
  switchCategory(e: WechatMiniprogram.BaseEvent) {
    const catId = e.currentTarget.dataset.id as string;
    this.setData({
      activeCategory: catId,
      filteredMaterials: this.filterMaterials(catId),
    });
  },

  /** 随机素材 */
  randomMaterial() {
    const randomItem = MATERIAL_LIBRARY[Math.floor(Math.random() * MATERIAL_LIBRARY.length)];
    this.addElement(randomItem);
  },

  /** 添加素材到画布 */
  addMaterialToCanvas(e: WechatMiniprogram.BaseEvent) {
    const materialId = e.currentTarget.dataset.id as string;
    const item = MATERIAL_LIBRARY.find((m) => m.id === materialId);
    if (!item) return;
    this.addElement(item);
  },

  /** 添加元素 */
  addElement(item: MaterialItem) {
    const { canvasWidth, canvasHeight, elements } = this.data;

    // 随机起始位置（画布中央区域波动）
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const spreadX = canvasWidth * 0.2;
    const spreadY = canvasHeight * 0.2;

    const el: CanvasElement = {
      id: uid(),
      materialId: item.id,
      content: item.content,
      type: item.type,
      x: cx + (Math.random() - 0.5) * spreadX,
      y: cy + (Math.random() - 0.5) * spreadY,
      scale: 1,
      rotation: 0,
      zIndex: elements.length,
    };

    const newElements = [...elements, el];
    this.setData({ elements: newElements, selectedIdx: newElements.length - 1 });
    this.renderCanvas();
    this.autoSave();
  },

  /** 描述输入 */
  onDescInput(e: WechatMiniprogram.Input) {
    this.setData({ description: e.detail.value });
    this.autoSave();
  },

  // ========== Canvas 交互 ==========

  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#bianbianCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res[0]) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo().pixelRatio;
      canvas.width = this.data.canvasWidth * dpr;
      canvas.height = this.data.canvasHeight * dpr;
      ctx.scale(dpr, dpr);
      (this as Record<string, unknown>).canvasCtx = ctx;
      (this as Record<string, unknown>).canvasNode = canvas;

      if (this.data.elements.length > 0) {
        this.renderCanvas();
      }
    });
  },

  /** 渲染画布 */
  renderCanvas() {
    const ctx = (this as Record<string, unknown>).canvasCtx as CanvasRenderingContext2D;
    if (!ctx) return;

    const { canvasWidth, canvasHeight, canvasBg, elements, selectedIdx } = this.data;

    // 清空
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // 背景
    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 按 zIndex 排序后绘制
    const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);

    sorted.forEach((el, idx) => {
      const globalIdx = elements.findIndex((e) => e.id === el.id);
      ctx.save();
      ctx.translate(el.x, el.y);
      ctx.rotate((el.rotation * Math.PI) / 180);
      ctx.scale(el.scale, el.scale);

      if (el.type === 'emoji') {
        const fontSize = 60;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.content, 0, 0);
      } else {
        // svg/颜色
        ctx.fillStyle = el.content;
        ctx.fillRect(-30, -30, 60, 60);
      }

      ctx.restore();

      // 选中高亮
      if (globalIdx === selectedIdx) {
        ctx.save();
        ctx.translate(el.x, el.y);
        ctx.beginPath();
        ctx.arc(0, 0, 40 * el.scale, 0, 2 * Math.PI);
        ctx.strokeStyle = '#FF8C42';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    });
  },

  /** 命中测试 */
  hitTest(touchX: number, touchY: number): number {
    const { elements } = this.data;
    // 从上到下（zIndex 高的在上）倒序检测
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      const size = 40 * el.scale;
      const dx = touchX - el.x;
      const dy = touchY - el.y;
      if (dx * dx + dy * dy <= size * size) {
        return i;
      }
    }
    return -1;
  },

  onCanvasTouchStart(e: WechatMiniprogram.TouchEvent) {
    const touches = e.touches;

    if (touches.length === 2) {
      // 双指：pinch 开始
      const tp1 = touches[0];
      const tp2 = touches[1];
      const dx = tp2.x - tp1.x;
      const dy = tp2.y - tp1.y;
      this.pinching = true;
      this.pinchStartDist = Math.sqrt(dx * dx + dy * dy);
      this.pinchStartAngle = Math.atan2(dy, dx);
      // 如果是缩放已有元素
      if (this.data.selectedIdx >= 0) {
        this.pinchStartScale = this.data.elements[this.data.selectedIdx].scale;
        this.pinchStartRotation = this.data.elements[this.data.selectedIdx].rotation;
      }
      return;
    }

    if (touches.length === 1) {
      const touch = touches[0];
      const tx = touch.x - this.data.canvasLeft;
      const ty = touch.y - this.data.canvasTop;
      const hitIdx = this.hitTest(tx, ty);

      // 双击删除
      const now = Date.now();
      if (hitIdx !== -1 && now - this.lastTapTime < 300) {
        this.deleteElement();
        this.lastTapTime = 0;
        return;
      }
      this.lastTapTime = now;

      if (hitIdx !== -1) {
        this.dragging = true;
        this.dragElementIdx = hitIdx;
        this.dragStartX = tx;
        this.dragStartY = ty;
        this.dragStartElX = this.data.elements[hitIdx].x;
        this.dragStartElY = this.data.elements[hitIdx].y;
        this.setData({ selectedIdx: hitIdx });
        this.renderCanvas();
      } else {
        this.setData({ selectedIdx: -1 });
        this.renderCanvas();
      }
    }
  },

  onCanvasTouchMove(e: WechatMiniprogram.TouchEvent) {
    const touches = e.touches;

    if (this.pinching && touches.length >= 2) {
      // 双指缩放+旋转
      const tp1 = touches[0];
      const tp2 = touches[1];
      const dx = tp2.x - tp1.x;
      const dy = tp2.y - tp1.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      if (this.data.selectedIdx >= 0) {
        const scaleRatio = dist / this.pinchStartDist;
        const newScale = Math.max(0.3, Math.min(3, this.pinchStartScale * scaleRatio));
        const angleDelta = ((angle - this.pinchStartAngle) * 180) / Math.PI;

        const elements = [...this.data.elements];
        elements[this.data.selectedIdx] = {
          ...elements[this.data.selectedIdx],
          scale: parseFloat(newScale.toFixed(2)),
          rotation: parseFloat((this.pinchStartRotation + angleDelta).toFixed(1)),
        };
        this.setData({ elements });
        this.renderCanvas();
      }
      return;
    }

    if (this.dragging && touches.length >= 1) {
      const touch = touches[0];
      const tx = touch.x - this.data.canvasLeft;
      const ty = touch.y - this.data.canvasTop;
      const dx = tx - this.dragStartX;
      const dy = ty - this.dragStartY;

      const elements = [...this.data.elements];
      elements[this.dragElementIdx] = {
        ...elements[this.dragElementIdx],
        x: this.dragStartElX + dx,
        y: this.dragStartElY + dy,
      };
      this.setData({ elements });
      this.renderCanvas();
    }
  },

  onCanvasTouchEnd() {
    if (this.dragging) {
      this.dragging = false;
      this.dragElementIdx = -1;
      this.autoSave();
    }
    if (this.pinching) {
      this.pinching = false;
      this.autoSave();
    }
  },

  // ========== 元素操作 ==========

  scaleUp() {
    this.adjustScale(0.15);
  },
  scaleDown() {
    this.adjustScale(-0.15);
  },
  adjustScale(delta: number) {
    const { elements, selectedIdx } = this.data;
    if (selectedIdx < 0) return;
    const elementsCp = [...elements];
    const newScale = Math.max(0.3, Math.min(3, elementsCp[selectedIdx].scale + delta));
    elementsCp[selectedIdx] = { ...elementsCp[selectedIdx], scale: parseFloat(newScale.toFixed(2)) };
    this.setData({ elements: elementsCp });
    this.renderCanvas();
    this.autoSave();
  },
  rotateLeft() {
    this.adjustRotation(-15);
  },
  rotateRight() {
    this.adjustRotation(15);
  },
  adjustRotation(delta: number) {
    const { elements, selectedIdx } = this.data;
    if (selectedIdx < 0) return;
    const elementsCp = [...elements];
    elementsCp[selectedIdx] = {
      ...elementsCp[selectedIdx],
      rotation: parseFloat(((elementsCp[selectedIdx].rotation + delta) % 360).toFixed(1)),
    };
    this.setData({ elements: elementsCp });
    this.renderCanvas();
    this.autoSave();
  },
  deleteElement() {
    const { elements, selectedIdx } = this.data;
    if (selectedIdx < 0) return;
    const filtered = elements.filter((_, i) => i !== selectedIdx);
    this.setData({ elements: filtered, selectedIdx: -1 });
    this.renderCanvas();
    this.autoSave();
  },

  // ========== 草稿保存 ==========
  autoSaveTimer: null as ReturnType<typeof setTimeout> | null,

  autoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      saveDraft({
        elements: this.data.elements,
        backgroundColor: this.data.canvasBg,
        description: this.data.description,
        updatedAt: Date.now(),
      });
    }, 500);
  },

  // ========== 变变 ==========

  async doTransform() {
    const { elements, description } = this.data;
    if (elements.length === 0) {
      wx.showToast({ title: '先拼点素材吧～', icon: 'none' });
      return;
    }

    if (!canTransformToday()) {
      wx.showToast({ title: '今日变变次数已用完，明天再来吧～', icon: 'none' });
      return;
    }

    // 导出画布图
    const imageData = await this.exportCanvas();
    if (!imageData) {
      wx.showToast({ title: '画布导出失败', icon: 'none' });
      return;
    }

    // 保存到全局，供 transform 页使用
    const app = getApp<IAppOption>();
    app.globalData.bianbianOrigin = imageData;
    app.globalData.bianbianDesc = description;

    wx.navigateTo({
      url: '/pages/bianbian/transform/transform',
    });
  },

  /** 导出画布为图片 base64（确保最小 1024x1024） */
  exportCanvas(): Promise<string> {
    return new Promise((resolve) => {
      if (!(this as any).canvasCtx || !(this as any).canvasNode) {
        resolve('');
        return;
      }

      const { canvasWidth, canvasHeight, canvasBg, elements } = this.data;
      const minSize = 1024;
      const scale = Math.max(1, minSize / Math.max(canvasWidth, canvasHeight));
      const exportW = Math.round(canvasWidth * scale);
      const exportH = Math.round(canvasHeight * scale);

      // 使用主画布调整尺寸后导出
      const canvas = (this as any).canvasNode;
      const dpr = wx.getWindowInfo().pixelRatio;
      const origW = canvas.width;
      const origH = canvas.height;

      // 临时调整画布大小
      canvas.width = exportW;
      canvas.height = exportH;
      const ctx = (this as any).canvasCtx;
      ctx.scale(1 / dpr * scale, 1 / dpr * scale);

      // 绘制背景
      ctx.fillStyle = canvasBg;
      ctx.fillRect(0, 0, exportW, exportH);

      // 按 zIndex 排序绘制元素
      const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);
      sorted.forEach((el) => {
        ctx.save();
        ctx.translate(el.x * scale, el.y * scale);
        ctx.rotate((el.rotation * Math.PI) / 180);
        ctx.scale(el.scale * scale, el.scale * scale);

        if (el.type === 'emoji') {
          const fontSize = 60;
          ctx.font = `${fontSize}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(el.content, 0, 0);
        } else {
          ctx.fillStyle = el.content;
          ctx.fillRect(-30, -30, 60, 60);
        }
        ctx.restore();
      });

      // 导出为 base64
      canvas.toDataURL({ type: 'image/jpeg', quality: 0.9 })
        .then((res: { data: string }) => {
          // 恢复原始尺寸
          canvas.width = origW;
          canvas.height = origH;
          ctx.scale(dpr, dpr);
          resolve(res.data);
        })
        .catch(() => {
          canvas.width = origW;
          canvas.height = origH;
          ctx.scale(dpr, dpr);
          resolve('');
        });
    });
  },

  goBack() {
    wx.navigateBack();
  },

  onUnload() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
  },
});
