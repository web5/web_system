// pages/draw/draw.behavior.material.ts
// 素材栏与素材插入模块

import {
  MATERIAL_LIBRARY,
  MaterialItem, MaterialCategory,
} from './draw.constants';
import { SHAPE_DRAWERS } from '../../utils/shapes';

export const MaterialBehavior = Behavior({
  methods: {
    // ==================== 素材栏 ====================

    onMaterialCategoryChange(e: any) {
      const category = e.currentTarget.dataset.category as MaterialCategory;
      const filtered = category === 'all'
        ? MATERIAL_LIBRARY
        : MATERIAL_LIBRARY.filter(m => m.category === category);
      this.setData({
        activeMaterialCategory: category,
        filteredMaterials: filtered,
      });
    },

    toggleMaterialBar() {
      (this as any)._ignoreCanvasTouch = true;
      this.setData({
        showMaterialBar: false,
        showBrushMenu: false,
      }, () => {
        // 素材栏关闭后恢复画布触摸
        (this as any)._ignoreCanvasTouch = false;
        if (this.resizeCanvas) this.resizeCanvas();
      });
    },

    // ==================== 素材选择 & 插入 ====================

    onSelectMaterial(e: any) {
      const item = e.currentTarget.dataset.material as MaterialItem;
      if (!item || !this.engine) return;

      this.setData({ showMaterialBar: false });
      // 素材栏关闭后恢复画布触摸，防止添加素材后第一次绘制被忽略
      (this as any)._ignoreCanvasTouch = false;

      switch (item.type) {
        case 'svg_path':
          this.insertSvgPaths(item);
          break;
        case 'emoji':
          this.insertEmoji(item);
          break;
        case 'image_url':
          this.insertImageMaterial(item);
          break;
      }

      wx.vibrateShort({ type: 'light' });
      this.setData({
        canUndo: this.engine.canUndo(),
        canRedo: this.engine.canRedo(),
      });
    },

    insertSvgPaths(item: MaterialItem) {
      if (!this.engine) return;

      const scale = item.defaultScale || 0.5;
      const baseSize = Math.min(this.engine.width, this.engine.height);
      const size = Math.max(30, Math.min(baseSize * scale, baseSize * 0.8));
      const color = item.defaultColor || this.data.currentColor;

      // 张小龙：添加素材时自动创建图层，每个素材独立管理
      const count = this.engine.addLayer() || 0;
      const layerIndex = count - 1;
      const layer = this.engine.layers[layerIndex];
      const ctx = layer.ctx;

      // 在图层中心绘制素材
      ctx.save();
      ctx.translate(this.engine.width / 2, this.engine.height / 2);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const key of item.data.paths || []) {
        const drawer = SHAPE_DRAWERS[key];
        if (drawer) {
          ctx.save();
          drawer(ctx, size);
          ctx.restore();
        }
      }
      ctx.restore();

      // 设置图层名称
      layer.name = item.name || '素材';
      // 张小龙：素材像真实贴纸，支持缩放/旋转
      layer.scale = 1;
      layer.rotation = 0;

      this.updateLayers();
      // addLayer 已调用 compositeToMain 和 saveSnapshot
      wx.vibrateShort({ type: 'light' });
      wx.showToast({ title: '素材已添加到新图层', icon: 'none', duration: 1200 });
    },

    insertEmoji(item: MaterialItem) {
      if (!this.engine) return;

      // 张小龙：添加表情时自动创建图层
      const count = this.engine.addLayer() || 0;
      const layerIndex = count - 1;
      const layer = this.engine.layers[layerIndex];
      const ctx = layer.ctx;

      const scale = item.defaultScale || 0.4;
      const fontSize = Math.min(this.engine.width, this.engine.height) * scale * 0.3;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.data.currentColor;
      ctx.fillText(item.data.text || '', this.engine.width / 2, this.engine.height / 2);
      ctx.restore();

      // 设置图层名称
      layer.name = item.name || '表情';
      this.updateLayers();

      wx.vibrateShort({ type: 'light' });
      wx.showToast({ title: '表情已添加到新图层', icon: 'none', duration: 1200 });
    },

    insertImageMaterial(item: MaterialItem) {
      if (item.id === 'bg_grid') {
        this.engine?.toggleGrid();
        wx.showToast({ title: '已切换网格背景', icon: 'success', duration: 1000 });
      }
    },
  },
});
