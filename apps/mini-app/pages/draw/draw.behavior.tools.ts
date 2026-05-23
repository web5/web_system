// pages/draw/draw.behavior.tools.ts
// 画笔 / 形状 / 颜色 / 撤销 / 清空 / 保存 / 导入 / 面板 / 缩放 / 笔刷菜单 / 高级功能

import {
  ICONS, ICONS_WHITE, COLORS, BG_COLORS,
  BRUSHES, BrushItem,
  SHAPES, ShapeItem, ShapeType,
} from './draw.constants';
import { BrushType } from '../../utils/Brush';

export const ToolsBehavior = Behavior({
  methods: {
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

    // ==================== 预设图形 ====================

    selectShape(e: any) {
      const shapeType = e.currentTarget.dataset.shape as ShapeType;
      const shapeItem = SHAPES.find(s => s.type === shapeType);
      if (this.data.addingShape === shapeType) {
        this.setData({ addingShape: '', showBrushMenu: false });
        return;
      }
      this.setData({
        addingShape: shapeType,
        currentShapeIcon: shapeItem?.icon || '●',
        showBrushMenu: false,
      });
    },

    cancelAddShape() {
      this.setData({ addingShape: '' });
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
      this.checkCanvasBlank();
    },

    onRedo() {
      this.engine?.redo();
      this.setData({
        canUndo: this.engine?.canUndo() || false,
        canRedo: this.engine?.canRedo() || false,
      });
      this.checkCanvasBlank();
    },

    // ==================== 清空 ====================

    onClear() {
      wx.showModal({
        title: '确认清空',
        content: '将清空当前画布内容，确定吗？',
        success: (res: any) => {
          if (res.confirm) {
            this.engine?.clear();
            this.setData({ canUndo: false, canRedo: false, showMaterialBar: false });
            wx.showToast({ title: '已清空', icon: 'success' });
            setTimeout(() => this.checkCanvasBlank(), 400);
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
        success: (res: any) => {
          if (this.data.showMaterialBar) {
            this.setData({ showMaterialBar: false });
          }
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

    onPickColor() {
      this.closeAllPanels();
      this.setData({ isPickingColor: true });
      wx.showToast({ title: '点击画布取色·再次点击取消', icon: 'none', duration: 1500 });
    },

    doPickColor(sx: number, sy: number) {
      const color = this.engine?.pickColor(sx, sy);
      if (color) {
        this.engine?.setColor(color);
        this.setData({ currentColor: color, isPickingColor: false });
        wx.showToast({ title: '已取色', icon: 'success' });
      }
    },

    cancelPickColor() {
      this.setData({ isPickingColor: false });
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
      (this as any)._ignoreCanvasTouch = true;
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
      (this as any)._ignoreCanvasTouch = true;
      this.engine?.resetTransform();
      this.setData({ showSettings: false, zoomLevel: 100 });
      wx.showToast({ title: '视角已重置', icon: 'success', duration: 1000 });
    },

    // ==================== 缩放 ====================

    onZoomIn() {
      if (!this.engine) return;
      (this as any)._ignoreCanvasTouch = true;
      this.engine.zoomIn();
      this.setData({ zoomLevel: Math.round(this.engine.scale * 100) });
    },

    onZoomOut() {
      if (!this.engine) return;
      (this as any)._ignoreCanvasTouch = true;
      this.engine.zoomOut();
      this.setData({ zoomLevel: Math.round(this.engine.scale * 100) });
    },

    toggleZoomMode() {
      const next = !this.data.isZoomMode;
      (this as any)._ignoreCanvasTouch = true;
      this.setData({ isZoomMode: next });
      wx.showToast({ title: next ? '缩放模式：可拖动/缩放' : '绘制模式', icon: 'none', duration: 1000 });
    },

    onZoomReset() {
      if (!this.engine) return;
      (this as any)._ignoreCanvasTouch = true;
      this.engine.resetTransform();
      this.setData({ zoomLevel: 100 });
      wx.vibrateShort({ type: 'light' });
    },

    // ==================== 笔刷菜单 ====================

    onToolTap() {
      (this as any)._ignoreCanvasTouch = true;
      this.setData({ showBrushMenu: !this.data.showBrushMenu });
    },

    onToolLongPress() {
      (this as any)._ignoreCanvasTouch = true;
      this.setData({ showBrushMenu: !this.data.showBrushMenu });
    },

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

    onAdvancedSettings() {
      this.setData({ showBrushMenu: false });
      setTimeout(() => this.toggleSettings(), 200);
    },
  },
});
