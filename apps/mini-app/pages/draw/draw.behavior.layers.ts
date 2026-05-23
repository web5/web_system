// pages/draw/draw.behavior.layers.ts
// 图层管理模块

export const LayersBehavior = Behavior({
  methods: {
    toggleLayers() {
      this.setData({ showLayers: !this.data.showLayers, showActionPanel: false, showBrushMenu: false });
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
        layers: this.engine.layers.map((l: any, i: number) => ({
          id: l.id, name: l.name, visible: l.visible, active: i === activeIdx,
        })),
      });
    },
  },
});
