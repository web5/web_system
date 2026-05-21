// pages/draw/draw.ts
Page({
  data: {
    colors: ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#43e97b', '#000000', '#ffffff'],
    currentColor: '#667eea',
    isDrawing: false,
  },

  ctx: null as any,
  canvas: null as any,
  currentPoints: [] as { x: number; y: number }[],
  rectInfo: null as { left: number; top: number } | null,
  lastDrawTime: 0,
  hasDrawnThisStroke: false, // 当前笔触是否已在主canvas绘制过

  onLoad() {
    wx.setNavigationBarTitle({ title: '画板' });
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#drawCanvas').node().exec((res) => {
      if (res && res[0]) {
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        
        const sysInfo = wx.getSystemInfoSync();
        const screenWidth = sysInfo.screenWidth;
        const toolbarHeight = 120;
        const canvasHeight = sysInfo.screenHeight - toolbarHeight - 44;
        
        canvas.width = screenWidth;
        canvas.height = canvasHeight;
        
        this.canvas = canvas;
        this.ctx = ctx;
        
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    });
    
    wx.createSelectorQuery().select('#drawCanvas').boundingClientRect().exec((res) => {
      if (res && res[0]) {
        this.rectInfo = res[0] as { left: number; top: number };
      }
    });
  },

  getCanvasPos(e: any) {
    return new Promise<{ x: number; y: number }>((resolve) => {
      if (this.rectInfo) {
        const touch = e.touches?.[0] || e.changedTouches?.[0] || e.detail;
        resolve({
          x: touch.clientX - this.rectInfo.left,
          y: touch.clientY - this.rectInfo.top,
        });
        return;
      }
      
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

  // 绘制曲线
  drawCurve(ctx: any, points: { x: number; y: number }[], color: string) {
    if (points.length < 2) return;
    
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 10;
    
    const tension = 0.25;
    
    ctx.moveTo(points[0].x, points[0].y);
    
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i === 0 ? i : i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[i + 2 >= points.length ? i + 1 : i + 2];
        
        const cp1x = p1.x + (p2.x - p0.x) * tension;
        const cp1y = p1.y + (p2.y - p0.y) * tension;
        const cp2x = p2.x - (p3.x - p1.x) * tension;
        const cp2y = p2.y - (p3.y - p1.y) * tension;
        
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    }
    
    ctx.stroke();
    ctx.restore();
  },

  // 节流绘制到主canvas
  scheduleDraw() {
    const now = Date.now();
    if (now - this.lastDrawTime < 16) return; // ~60fps 节流
    
    if (this.currentPoints.length >= 2) {
      this.drawCurve(this.ctx, this.currentPoints, this.data.currentColor);
      this.ctx.draw(true);
      this.lastDrawTime = now;
    }
  },

  async onTouchStart(e: any) {
    if (!this.ctx) return;
    
    const pos = await this.getCanvasPos(e);
    this.currentPoints = [pos];
    this.hasDrawnThisStroke = false;
    this.lastDrawTime = 0;
    this.setData({ isDrawing: true });
  },

  async onTouchMove(e: any) {
    if (!this.ctx || !this.data.isDrawing) return;
    
    const pos = await this.getCanvasPos(e);
    this.currentPoints.push(pos);
    
    // 节流绘制
    this.scheduleDraw();
  },

  onTouchEnd() {
    if (this.ctx && this.currentPoints.length > 0) {
      // 最终绘制（确保完整）
      this.drawCurve(this.ctx, this.currentPoints, this.data.currentColor);
      this.ctx.draw(true);
    }
    
    this.currentPoints = [];
    this.setData({ isDrawing: false });
  },

  selectColor(e: WechatMiniprogram.TouchEvent) {
    this.setData({ currentColor: e.currentTarget.dataset.color });
  },

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.draw();
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
