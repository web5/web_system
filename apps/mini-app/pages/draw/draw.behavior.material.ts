// pages/draw/draw.behavior.material.ts
// 素材栏与素材插入模块

import {
  MATERIAL_LIBRARY, SHAPE_DRAWERS,
  MaterialItem, MaterialCategory,
} from './draw.constants';

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
      const opening = !this.data.showMaterialBar;
      this.setData({
        showMaterialBar: opening,
        showBrushMenu: false,
      });
    },

    // ==================== 素材选择 & 插入 ====================

    onSelectMaterial(e: any) {
      const item = e.currentTarget.dataset.material as MaterialItem;
      if (!item || !this.engine) return;

      this.setData({ showMaterialBar: false });

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
      const ctx = this.engine!.getActiveCtx();
      if (!ctx) return;

      const scale = item.defaultScale || 0.5;
      const cx = this.engine!.width / 2;
      const cy = this.engine!.height / 2;
      const size = Math.min(this.engine!.width, this.engine!.height) * scale;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.translate(cx, cy);
      ctx.fillStyle = item.defaultColor || this.data.currentColor;
      ctx.strokeStyle = item.defaultColor || this.data.currentColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (item.data.paths) {
        for (const pathKey of item.data.paths) {
          const drawer = SHAPE_DRAWERS[pathKey];
          if (drawer) drawer(ctx, size);
        }
      }

      ctx.restore();
      this.engine!.markContent();
      this.engine!.compositeToMain();
      this.engine!.saveSnapshot();
    },

    insertEmoji(item: MaterialItem) {
      const ctx = this.engine!.getActiveCtx();
      if (!ctx) return;

      const scale = item.defaultScale || 0.4;
      const fontSize = Math.min(this.engine!.width, this.engine!.height) * scale * 0.3;

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.data.currentColor;
      ctx.fillText(item.data.text || '', this.engine!.width / 2, this.engine!.height / 2);
      ctx.restore();

      this.engine!.markContent();
      this.engine!.compositeToMain();
      this.engine!.saveSnapshot();
    },

    insertImageMaterial(item: MaterialItem) {
      if (item.id === 'bg_grid') {
        this.engine?.toggleGrid();
        wx.showToast({ title: '已切换网格背景', icon: 'success', duration: 1000 });
      }
    },
  },
});
