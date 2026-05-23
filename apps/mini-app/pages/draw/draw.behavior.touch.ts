// pages/draw/draw.behavior.touch.ts
// 触摸事件 & 画布交互模块

import { ShapeType } from './draw.constants';

interface PanState {
  midX: number; midY: number; dist: number;
  offsetX: number; offsetY: number; scale: number;
}

interface TouchBehaviorData {
  isDrawing: boolean;
  isPickingColor: boolean;
  isZoomMode: boolean;
  addingShape: string;
  brushSize: number;
  showColorPanel: boolean;
  showActionPanel: boolean;
  showBrushPanel: boolean;
  toolbarHidden: boolean;
  showMaterialBar: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoomLevel: number;
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

  // 需要引用的外部方法（由 Page 或其它 behavior 提供）
  checkCanvasBlank(): void;
  doPickColor(sx: number, sy: number): void;
  setData(data: any): void;
}

export const TouchBehavior = Behavior({
  methods: {
    // ==================== 工具栏自动显隐 ====================

    hideToolbarForDrawing() {
      const self = this as unknown as TouchBehaviorInstance;
      if (!self.data.toolbarHidden) {
        self.setData({ toolbarHidden: true });
      }
    },

    showToolbarAfterDrawing() {
      const self = this as unknown as TouchBehaviorInstance;
      if (self.data.toolbarHidden) {
        self.setData({ toolbarHidden: false });
      }
    },

    // ==================== 坐标转换 ====================

    getCanvasPos(e: any): Promise<{ x: number; y: number }> {
      const self = this as unknown as TouchBehaviorInstance;
      return new Promise((resolve) => {
        if (self.rectInfo) {
          const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
          resolve({ x: touch.clientX - self.rectInfo.left, y: touch.clientY - self.rectInfo.top });
          return;
        }
        wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res: any) => {
          if (res?.[0]) {
            const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
            resolve({ x: touch.clientX - res[0].left, y: touch.clientY - res[0].top });
          } else {
            resolve({ x: 0, y: 0 });
          }
        });
      });
    },

    // ==================== 触摸事件 ====================

    async onTouchStart(e: any) {
      const self = this as unknown as TouchBehaviorInstance;
      if (!self.engine) return;
      if (self._ignoreCanvasTouch) return;
      const touches = e.touches;

      if (touches.length >= 2) {
        self.beginTwoFingerPan(touches);
        return;
      }

      if (self.data.showColorPanel || self.data.showActionPanel || self.data.showBrushPanel) return;

      if (self.data.isZoomMode) {
        self.beginZoomPan(e);
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
      if (self.data.showMaterialBar) {
        self.setData({ showMaterialBar: false });
      }
      self.hideToolbarForDrawing();
      const pos = await self.getCanvasPos(e);
      const worldPos = self.engine!.screenToWorld(pos.x, pos.y);
      self.isTouching = true;
      self.lastX = worldPos.x;
      self.lastY = worldPos.y;
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

      if (self.isPanning && self.data.isZoomMode) {
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
      self.showToolbarAfterDrawing();
      self.checkCanvasBlank();
    },
  },
});
