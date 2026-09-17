// 合同评估主页（tab）
// TODO: 上传走 services/ocr-api.ts，评估走 services/contract-api.ts
Page({
  data: {
    types: ['采购', '劳动', '租赁', '服务', '保密', '借款'],
    contractType: '采购',
    risks: [
      { name: '付款条件', on: true },
      { name: '违约责任', on: true },
      { name: '知识产权', on: false },
      { name: '保密', on: false },
      { name: '争议解决', on: false },
      { name: '不可抗力', on: false },
    ],
  },

  pickType(e: any) {
    this.setData({ contractType: e.currentTarget.dataset.v });
  },

  toggleRisk(e: any) {
    const { i } = e.currentTarget.dataset;
    const key = 'risks[' + i + '].on';
    this.setData({ [key]: !this.data.risks[i].on } as any);
  },

  takePhoto() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera'], success: () => this.start() });
  },

  chooseAlbum() {
    wx.chooseMedia({ count: 9, mediaType: ['image'], sourceType: ['album'], success: () => this.start() });
  },

  chooseFile() {
    // @ts-ignore 基础库 2.15+ 支持
    wx.chooseMessageFile({ count: 1, type: 'file', success: () => this.start() });
  },

  start() {
    wx.showLoading({ title: '识别与评估中…' });
    setTimeout(() => {
      wx.hideLoading();
      wx.navigateTo({ url: '/pages/assess/result/result' });
    }, 800);
  },

  openResult() {
    wx.navigateTo({ url: '/pages/assess/result/result' });
  },
});
