Page({
  data: {
    courses: [
      { id: 1, title: 'AI 绘画启蒙', description: '让孩子用 AI 创作艺术作品' },
      { id: 2, title: '编程思维训练', description: '培养逻辑思维' },
      { id: 3, title: '创意写作', description: '激发想象力' },
    ],
  },
  goToDraw() {
    wx.navigateTo({
      url: '/pages/draw/draw',
    });
  },
});
