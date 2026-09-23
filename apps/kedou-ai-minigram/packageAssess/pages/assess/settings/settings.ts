// 合同评估业务设置（只影响合同评估功能）
Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
  },

  data: {
    radiusClass: "",
    contractType: '采购',
    strict: '标准',
    riskCount: 2,
    law: '中国大陆',
    autoSave: true,
    format: 'PDF',
    keep: '180 天',
  },

  pick(key: string, list: string[]) {
    wx.showActionSheet({
      itemList: list,
      success: (res: any) => {
        this.setData({ [key]: list[res.tapIndex] } as any);
      },
      fail: () => undefined,
    });
  },

  pickType() { this.pick('contractType', ['采购', '劳动', '租赁', '服务', '保密', '借款']); },
  pickStrict() { this.pick('strict', ['宽松', '标准', '严格']); },
  pickLaw() { this.pick('law', ['中国大陆', '中国香港', '新加坡']); },
  pickFormat() { this.pick('format', ['PDF', 'Word', '图片']); },
  pickKeep() { this.pick('keep', ['30 天', '90 天', '180 天', '永久']); },

  pickRisks() {
    wx.showToast({ title: '风险点配置开发中', icon: 'none' });
  },

  toggleAutoSave() {
    this.setData({ autoSave: !this.data.autoSave });
  },

  deleteAll() {
    wx.showModal({
      title: '删除全部合同数据',
      content: '将永久删除已上传的合同与评估报告，且不可恢复。',
      success: (res: any) => {
        if (res.confirm) wx.showToast({ title: '已删除' });
      },
    });
  },
});
