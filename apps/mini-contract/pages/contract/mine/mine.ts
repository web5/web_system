/**
 * 合同翻译官 - 我的
 */
Page({
  data: {},

  goHome() {
    wx.reLaunch({ url: '/pages/contract/index/index' });
  },

  showDisclaimer() {
    wx.showModal({
      title: '免责声明',
      content: '合同翻译官仅用于理解合同与风险识别，不提供法律/理财/投资建议，不做产品比较与购买推荐。您的合同数据加密存储，仅用于本次解读，可随时删除，不用于模型训练。重大决策请咨询持牌专业人士。',
      showCancel: false,
      confirmText: '我知道了',
    });
  },

  showPrivacy() {
    wx.showModal({
      title: '隐私与数据安全',
      content: '合同文件加密存储，数据仅用于本次解读，可随时删除，不用于模型训练。',
      showCancel: false,
      confirmText: '我知道了',
    });
  },
});
