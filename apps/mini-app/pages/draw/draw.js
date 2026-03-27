Page({
  data: {
    colors: ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#43e97b', '#000000', '#ffffff'],
    currentColor: '#667eea',
    ctx: null,
    isDrawing: false,
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').fields({ node: true, size: true }).exec((res) => {
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      
      const dpr = wx.getSystemInfoSync().pixelRatio;
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      
      this.setData({ ctx });
    });
  },

  onTouchStart(e) {
    const { ctx } = this.data;
    if (!ctx) return;
    
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    this.setData({ isDrawing: true });
  },

  onTouchMove(e) {
    const { ctx, isDrawing, currentColor } = this.data;
    if (!ctx || !isDrawing) return;
    
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    
    ctx.lineTo(x, y);
    ctx.strokeStyle = currentColor;
    ctx.stroke();
  },

  onTouchEnd() {
    this.setData({ isDrawing: false });
  },

  selectColor(e) {
    this.setData({ currentColor: e.currentTarget.dataset.color });
  },

  clearCanvas() {
    const { ctx } = this.data;
    if (!ctx) return;
    
    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').fields({ size: true }).exec((res) => {
      ctx.clearRect(0, 0, res[0].width, res[0].height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, res[0].width, res[0].height);
    });
  },

  saveCanvas() {
    wx.showToast({ title: '保存功能开发中', icon: 'none' });
  },

  goBack() {
    wx.navigateBack();
  },
});
