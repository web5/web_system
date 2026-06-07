// pages/draw/draw.behavior.touch.ts
// 触摸事件 & 画布交互模块

import { ShapeType } from './draw.constants';

interface PanState {
  midX: number; midY: number; dist: number;
  offsetX: number; offsetY: number; scale: number;
}

interface TouchBehaviorInstance {
  engine: any;
  rectInfo: { left: number; top: number } | null;
  lastX: number; lastY: number;
  isTouching: boolean;
  isPanning: boolean;
  pan: PanState;
  shapeWorldPos: { x: number; y: number };
  _ignoreCanvasTouch: boolean;
  // 面板正在关闭标志（避免 setData 异步导致的延迟感）
  _colorPanelClosing: boolean;

  // 需要引用的外部方法（由 Page 或其它 behavior 提供）
  checkCanvasBlank(): void;
  doPickColor(sx: number, sy: number): void;
  setData(data: any): void;

  // 张小龙：引导文字（绘制前隐藏）
  data: {
    showGuide: boolean;
    [key: string]: any;
  };
}

export const TouchBehavior = Behavior({
  lifetimes: {
    attached() {
      (this as any)._colorPanelClosing = false;
    },
  },
  methods: {
    // ==================== 坐标转换 ====================

    getCanvasPos(e: any): Promise<{ x: number; y: number }> {
      const self = this as unknown as TouchBehaviorInstance;
      return new Promise((resolve) => {
        // 张小龙：每次都重新查询，避免使用过时的 rectInfo 导致坐标偏移
        const query = wx.createSelectorQuery().in(self);
        query.select('#drawCanvas').boundingClientRect().exec((res: any) => {
          if (res?.[0]) {
            self.rectInfo = res[0]; // 同步更新缓存
            // 张小龙：兼容 Apple Pencil (stylus) 和手指触摸
            // 优先从 touches 中取，其次 changedTouches，最后 detail
            let touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
            // 如果上述都为空，但事件是 stylus 类型，尝试从 touches[0] 取
            if (!touch && e.touches?.[0]?.touchType === 'stylus') {
              touch = e.touches[0];
            }
            if (touch) {
              const x = touch.clientX - res[0].left;
              const y = touch.clientY - res[0].top;
              resolve({ x, y });
            } else {
              console.warn('[getCanvasPos] 无法获取触摸点', e);
              resolve({ x: 0, y: 0 });
            }
          } else if (self.rectInfo) {
            // 查询失败时降级使用缓存
            const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
            if (touch) {
              resolve({ x: touch.clientX - self.rectInfo.left, y: touch.clientY - self.rectInfo.top });
            } else {
              resolve({ x: 0, y: 0 });
            }
          } else {
            console.warn('[getCanvasPos] 无法获取 canvas 位置，也没有缓存', e);
            resolve({ x: 0, y: 0 });
          }
        });
      });
    },

    // ==================== 触摸事件 ====================

    async onTouchStart(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      
      // 张小龙：隐藏引导文字（如果显示）
      if (self.data.showGuide) {
        self.setData({ showGuide: false });
      }
      
      if (!self.engine) return;
      if (self._ignoreCanvasTouch) return;

      const touches = e.touches;

      if (touches.length >= 2) {
        self.beginTwoFingerPan(touches);
        return;
      }

      // 张小龙：面板打开时，点空白处关闭，不开始绘制
      // 优化：使用实例变量快速检查，避免 setData 异步延迟
      if (self._colorPanelClosing) {
        self._colorPanelClosing = false;
        // 面板正在关闭，不拦截绘制
      } else if (self.data.showColorPanel || self.data.showActionPanel || self.data.showBrushPanel) {
        self.closeAllPanels();
        return;
      }

      // 张小龙：合并拖动/缩放为一个画布操作模式
      if (self.data.isCanvasMode) {
        await self.beginZoomPan(e);
        return;
      }

      if (self.data.isPickingColor) return;

      if (self.data.addingShape) {
        const pos = await self.getCanvasPos(e);
        self.shapeWorldPos = self.engine.screenToWorld(pos.x, pos.y);
        return;
      }

      await self.beginDraw(e);
    },

    beginTwoFingerPan(touches: any[]) {
      const self = this as unknown as TouchBehaviorInstance;
      self.isPanning = true;
      self.isTouching = false;
      const rect = self.rectInfo || { left: 0, top: 0 };
      const t0 = touches[0], t1 = touches[1];
      const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
      const my = (t0.clientY + t1.clientY) / 2 - rect.top;
      const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
      self.pan = {
        midX: mx, midY: my,
        dist: Math.sqrt(dx * dx + dy * dy),
        offsetX: self.engine!.panX, offsetY: self.engine!.panY,
        scale: self.engine!.scale,
      };
    },

    async beginZoomPan(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      self.isPanning = true;
      self.isTouching = false;
      const pos = await self.getCanvasPos(e);
      self.pan = {
        midX: pos.x, midY: pos.y,
        dist: 0, offsetX: self.engine!.panX, offsetY: self.engine!.panY,
        scale: self.engine!.scale,
      };
    },

    async beginDraw(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      const pos = await self.getCanvasPos(e);
      const worldPos = self.engine!.screenToWorld(pos.x, pos.y);
      self.isTouching = true;
      self.lastX = worldPos.x;
      self.lastY = worldPos.y;
      // 张小龙：确保颜色已同步到引擎，避免选择颜色后第一次绘制延迟
      self.engine!.setColor(self.data.currentColor);
      self.engine!.beginPath(worldPos.x, worldPos.y);
      self.setData({ isDrawing: true });
    },

    async onTouchMove(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      if (!self.engine) return;
      if (self._ignoreCanvasTouch) return;
      const touches = e.touches;

      if (self.isPanning && touches.length >= 2) {
        self.updateTwoFingerPan(touches);
        return;
      }

      if (self.isPanning && self.data.isCanvasMode) {
        await self.updateZoomPan(e);
        return;
      }

      if (self.data.showBrushPanel || self.data.showColorPanel || self.data.showActionPanel || !self.isTouching) return;
      if (self.data.isPickingColor) return;

      await self.updateDraw(e);
    },

    updateTwoFingerPan(touches: any[]) {
      const self = this as unknown as TouchBehaviorInstance;
      const rect = self.rectInfo || { left: 0, top: 0 };
      const t0 = touches[0], t1 = touches[1];
      const mx = (t0.clientX + t1.clientX) / 2 - rect.left;
      const my = (t0.clientY + t1.clientY) / 2 - rect.top;
      const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const factor = self.pan.dist > 0 ? dist / self.pan.dist : 1;
      const newScale = Math.max(0.3, Math.min(5, self.pan.scale * factor));

      self.engine!.panX = self.pan.midX - (self.pan.midX - self.pan.offsetX) * (newScale / self.pan.scale);
      self.engine!.panY = self.pan.midY - (self.pan.midY - self.pan.offsetY) * (newScale / self.pan.scale);
      self.engine!.scale = newScale;

      self.engine!.panX += mx - self.pan.midX;
      self.engine!.panY += my - self.pan.midY;
      self.engine!.compositeToMain();

      // 实时更新缩放百分比，让用户看到变化
      const zoomLevel = Math.round(newScale * 100);
      if (zoomLevel !== self.data.zoomLevel) {
        self.setData({ zoomLevel });
      }
    },

    async updateZoomPan(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      const pos = await self.getCanvasPos(e);
      self.engine!.panX = self.pan.offsetX + pos.x - self.pan.midX;
      self.engine!.panY = self.pan.offsetY + pos.y - self.pan.midY;
      self.engine!.compositeToMain();
    },

    async updateDraw(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      const pos = await self.getCanvasPos(e);
      const worldPos = self.engine!.screenToWorld(pos.x, pos.y);
      self.engine!.drawSegment(worldPos.x, worldPos.y, self.lastX, self.lastY);
      self.lastX = worldPos.x;
      self.lastY = worldPos.y;
    },

    async onTouchEnd(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      if (!self.engine) return;

      try {
        if (self._ignoreCanvasTouch) {
          self._ignoreCanvasTouch = false;
          return;
        }

        if (self.isPanning) {
          self.isPanning = false;
          self.setData({ zoomLevel: Math.round(self.engine.scale * 100) });
          self.engine.saveSnapshot();
          return;
        }

        if (self.data.isPickingColor) {
          const touch = e.changedTouches?.[0];
          const pos = touch
            ? await self.getCanvasPos(e)
            : (e.detail ? { x: e.detail.x - (self.rectInfo?.left || 0), y: e.detail.y - (self.rectInfo?.top || 0) } : null);
          if (pos) self.doPickColor(pos.x, pos.y);
          return;
        }

        if (self.data.addingShape) {
          const worldPos = self.shapeWorldPos;
          if (worldPos) {
            const shapeSize = Math.max(24, self.data.brushSize * 12);
            self.engine.drawShape(self.data.addingShape as ShapeType, worldPos.x, worldPos.y, shapeSize);
            wx.vibrateShort({ type: 'light' });
          }
          self.setData({ addingShape: '' });
          return;
        }

        if (!self.isTouching) return;
        self.isTouching = false;
        const pos = e.changedTouches?.[0]
          ? await self.getCanvasPos(e)
          : { x: self.lastX, y: self.lastY };
        const worldPos = self.engine.screenToWorld(pos.x, pos.y);
        self.engine.endPath(worldPos.x, worldPos.y);
        self.setData({
          isDrawing: false,
          canUndo: self.engine.canUndo(),
          canRedo: self.engine.canRedo(),
        });
        self.checkCanvasBlank();
      } finally {
      }
    },
  },
});
