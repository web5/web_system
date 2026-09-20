// 合同评估结果页
Page({
  data: {
    score: 62,
    level: '中等风险',
    summary: '共识别 7 处风险点：2 高 · 3 中 · 2 低，建议重点处理付款与违约条款',
    items: [
      {
        level: '高', levelClass: 'high', title: '付款条件：验收后 90 天付款',
        detail: '账期明显长于行业惯例（30–60 天），占用资金压力大，且未约定逾期利息。',
        advice: '改为 30 天，并加「逾期按日万分之五支付违约金」',
      },
      {
        level: '高', levelClass: 'high', title: '违约责任：仅单方约定',
        detail: '第 8 条只约定了乙方违约责任，甲方逾期付款无对应责任，权利义务不对等。',
        advice: '补充甲方逾期付款的对称责任条款',
      },
      {
        level: '中', levelClass: 'mid', title: '知识产权：成果归属含糊',
        detail: '未明确交付成果的知识产权归属与授权范围，后续二次开发可能受限。',
        advice: '明确「交付即转移」或「授权使用」二选一',
      },
      {
        level: '低', levelClass: 'low', title: '争议解决：管辖法院',
        detail: '约定在甲方所在地法院，异地诉讼成本较高。',
        advice: '争取改为仲裁或己方所在地',
      },
    ],
  },

  exportReport() {
    wx.showToast({ title: '报告生成中', icon: 'none' });
  },

  askMore() {
    wx.navigateTo({ url: '/pages/contract/chat/chat' });
  },
});
