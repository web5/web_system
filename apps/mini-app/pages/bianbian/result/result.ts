/**
 * 变变结果页 — 原画 vs AI 3D 角色对比
 */
import { getDailyTransformCount } from '../../../services/bianbian-storage';
import { DAILY_TRANSFORM_LIMIT, STORAGE_KEYS } from '../../../utils/bianbian-constants';

Page({
  data: {
    originImage: '',
    aiImage: '',
    canRetry: true,
    retryLeft: 0,
  },

  onLoad() {
    const app = getApp<IAppOption>();
    const originImage = app.globalData.bianbianOrigin || '';
    const aiImage = app.globalData.bianbianResult || '';

    if (!originImage || !aiImage) {
      wx.showToast({ title: '结果获取失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    const count = getDailyTransformCount();
    const left = Math.max(0, DAILY_TRANSFORM_LIMIT - count);

    this.setData({
      originImage,
      aiImage,
      canRetry: left > 0,
      retryLeft: left,
    });
  },

  /** 保存合成图到相册 */
  async saveToAlbum() {
    wx.showLoading({ title: '合成中...' });

    try {
      const compositeData = await this.composeImage();
      if (!compositeData) {
        wx.hideLoading();
        wx.showToast({ title: '合成失败', icon: 'none' });
        return;
      }

      // 保存临时文件
      const fs = wx.getFileSystemManager();
      const tmpPath = `${wx.env.USER_DATA_PATH}/bianbian_${Date.now()}.jpg`;

      const base64Data = compositeData.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(tmpPath, base64Data, 'base64');

      // 请求相册权限并保存
      const authRes = await wx.getSetting();
      if (!authRes.authSetting['scope.writePhotosAlbum']) {
        await wx.authorize({ scope: 'scope.writePhotosAlbum' });
      }

      await wx.saveImageToPhotosAlbum({ filePath: tmpPath });

      wx.hideLoading();
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      const msg = (err as { errMsg?: string }).errMsg || '';
      if (msg.includes('auth deny')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存到相册',
          confirmText: '去设置',
          success: (modalRes) => {
            if (modalRes.confirm) {
              wx.openSetting();
            }
          },
        });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    }
  },

  /** 合成原画+AI角色+水印 */
  composeImage(): Promise<string> {
    return new Promise((resolve) => {
      // 使用离屏 canvas 合成
      const query = wx.createSelectorQuery();
      query
        .select('#composeCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0]) {
            // 无 canvas 节点时直接返回 AI 图
            resolve(this.data.aiImage);
            return;
          }
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const w = 750;
          const h = 1200;
          const dpr = wx.getWindowInfo().pixelRatio;
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          ctx.scale(dpr, dpr);

          // 白色背景
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);

          // 加载并绘制原画
          const img1 = canvas.createImage();
          const img2 = canvas.createImage();

          let loaded = 0;
          const loadHandler = () => {
            loaded++;
            if (loaded < 2) return;

            // 原画左上
            ctx.drawImage(img1, 30, 60, 330, 330);
            // AI 角色右上
            ctx.drawImage(img2, 390, 60, 330, 330);

            // "变变" 标签
            ctx.fillStyle = '#FF8C42';
            ctx.font = 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('✨ 变变 · 把想象变出来', w / 2, 460);

            // 底部水印
            ctx.fillStyle = '#DDD';
            ctx.font = '20px sans-serif';
            ctx.fillText('科豆 AI · 变变', w / 2, h - 40);

            canvas
              .toDataURL({ type: 'image/jpeg', quality: 0.95 })
              .then((dataUrl: { data: string }) => {
                resolve(dataUrl.data);
              })
              .catch(() => {
                resolve(this.data.aiImage);
              });
          };

          img1.onload = loadHandler;
          img2.onload = loadHandler;
          img1.onerror = () => resolve(this.data.aiImage);
          img2.onerror = () => resolve(this.data.aiImage);
          img1.src = this.data.originImage;
          img2.src = this.data.aiImage;
        });
    });
  },

  /** 重新变（用同一张原画） */
  retry() {
    const app = getApp<IAppOption>();
    app.globalData.bianbianResult = undefined;
    wx.redirectTo({
      url: '/pages/bianbian/transform/transform',
    });
  },

  /** 再创一个 — 清除画布回创作页 */
  recreate() {
    const app = getApp<IAppOption>();
    app.globalData.bianbianOrigin = undefined;
    app.globalData.bianbianResult = undefined;
    wx.redirectTo({
      url: '/pages/bianbian/create/create',
    });
  },
});
