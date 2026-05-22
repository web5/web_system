// pages/draw/draw.ts
Page({
  data: {
    colors: ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#43e97b', '#000000', '#ffffff'],
    currentColor: '#667eea',
    isDrawing: false,
  },

  ctx: null as any,
  canvas: null as any,
  dpr: 1,
  lastX: 0,
  lastY: 0,

  onLoad() {
    wx.setNavigationBarTitle({ title: '画板' });
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').fields({ node: true, size: true }).exec((res) => {
      if (res && res[0] && res[0].node) {
        const canvas = res[0].node as any;
        const ctx = canvas.getContext('2d', { webkitRerender: true });
        
        const sysInfo = wx.getSystemInfoSync();
        this.dpr = sysInfo.pixelRatio || wx.getSystemInfoSync().windowWidth / sysInfo.screenWidth;
        
        const canvasWidth = res[0].width;
        const canvasHeight = res[0].height;
        
        // 设置高清屏适配 - 关键步骤！
        canvas.width = canvasWidth * this.dpr;
        canvas.height = canvasHeight * this.dpr;
        
        // 缩放上下文
        ctx.scale(this.dpr, this.dpr);
        
        // 开启抗锯齿
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        this.canvas = canvas;
        this.ctx = ctx;
        
        // 填充白色背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        console.log('Canvas initialized:', { canvasWidth, canvasHeight, dpr: this.dpr });
      }
    });
  },

  getCanvasPos(e: any) {
    return new Promise<{ x: number; y: number }>((resolve) => {
      wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res) => {
        if (res && res[0]) {
          const rect = res[0] as { left: number; top: number };
          const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
          resolve({
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
          });
        } else {
          resolve({ x: 0, y: 0 });
        }
      });
    });
  },

  async onTouchStart(e: any) {
    if (!this.ctx) return;
    
    const pos = await this.getCanvasPos(e);
    
    this.lastX = pos.x;
    this.lastY = pos.y;
    
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    this.ctx.lineWidth = 4;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = this.data.currentColor;
    
    this.setData({ isDrawing: true });
  },

  async onTouchMove(e: any) {
    if (!this.ctx || !this.data.isDrawing) return;
    
    const pos = await this.getCanvasPos(e);
    
    // 使用贝塞尔曲线使线条更平滑
    const midX = (this.lastX + pos.x) / 2;
    const midY = (this.lastY + pos.y) / 2;
    
    this.ctx.quadraticCurveTo(this.lastX, this.lastY, midX, midY);
    this.ctx.stroke();
    
    this.lastX = pos.x;
    this.lastY = pos.y;
  },

  onTouchEnd() {
    if (this.ctx) {
      // 绘制到终点
      this.ctx.lineTo(this.lastX, this.lastY);
      this.ctx.stroke();
    }
    this.setData({ isDrawing: false });
  },

  selectColor(e: WechatMiniprogram.TouchEvent) {
    this.setData({ currentColor: e.currentTarget.dataset.color });
  },

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, rect.width, rect.height);
  },

  saveCanvas() {
    if (!this.canvas) return;
    
    wx.canvasToTempFilePath({
      canvas: this.canvas,
      success: (res: any) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => wx.showToast({ title: '保存成功', icon: 'success' }),
          fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
    });
  },

  goBack() {
    wx.navigateBack();
  },
});
