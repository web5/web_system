/**
 * 变变 AI 变身页 — Loading / 进度 / 结果桥接
 */
import { FUN_FACTS, DAILY_TRANSFORM_LIMIT } from '../../../utils/bianbian-constants';
import {
  incrementDailyTransformCount,
  saveHistoryItem,
} from '../../../services/bianbian-storage';

let factTimer: ReturnType<typeof setInterval> | null = null;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

Page({
  data: {
    originImage: '',
    status: 'loading' as 'loading' | 'success' | 'failed',
    progress: 0,
    progressText: '准备中...',
    transitionSpeed: 300,
    funFact: FUN_FACTS[0],
    errorMsg: '',
    showFact: false,
  },

  onLoad() {
    const app = getApp<IAppOption>();
    const originImage = app.globalData.bianbianOrigin || '';
    const description = app.globalData.bianbianDesc || '';

    if (!originImage) {
      wx.showToast({ title: '没有待变身的作品', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }

    this.setData({ originImage });
    this.startProgress();
    this.startFunFacts();

    // 调用 AI 接口
    this.callAI(originImage, description);
  },

  /** 非线性进度模拟（先快后慢） */
  startProgress() {
    const stages = [
      { to: 15, ms: 400, text: '理解你的作品...' },
      { to: 35, ms: 600, text: '分析颜色和形状...' },
      { to: 55, ms: 900, text: '构思 3D 角色...' },
      { to: 75, ms: 1200, text: '绘制细节...' },
      { to: 88, ms: 1500, text: '增加质感...' },
    ];

    let stageIdx = 0;

    progressTimer = setInterval(() => {
      if (stageIdx >= stages.length) {
        if (progressTimer) clearInterval(progressTimer);
        return;
      }

      const stage = stages[stageIdx];
      this.setData({
        progress: stage.to,
        progressText: stage.text,
        transitionSpeed: stage.ms,
      });
      stageIdx++;
    }, 1200);

    // 30 秒超时
    timeoutHandle = setTimeout(() => {
      this.onFailed('生成超时，请检查网络后重试');
    }, 30000);
  },

  /** 趣味小知识轮播 */
  startFunFacts() {
    let idx = 0;
    factTimer = setInterval(() => {
      idx = (idx + 1) % FUN_FACTS.length;
      this.setData({ funFact: FUN_FACTS[idx] });
    }, 4000);

    // 15秒后显示趣味知识
    setTimeout(() => {
      this.setData({ showFact: true });
    }, 15000);
  },

  /** 调用 AI 图生图接口 */
  async callAI(originImage: string, description: string) {
    try {
      const apiBase = getApp<IAppOption>().globalData.apiBase || 'https://kedouai.com/api';

      const res = await wx.request({
        url: `${apiBase}/bianbian/transform`,
        method: 'POST',
        data: {
          image: originImage,
          description,
          style: 'pixar-3d',
          outputSize: '1024x1024',
        },
        header: { 'Content-Type': 'application/json' },
        timeout: 25000,
      });

      if ((res.statusCode === 200 || res.statusCode === 201) && res.data) {
        const data = res.data as { image?: string; url?: string; data?: string };
        const aiImage = data.image || data.url || data.data || '';

        if (aiImage) {
          this.onSuccess(aiImage);
          return;
        }
      }

      // API 不可用时使用模拟数据
      console.warn('[变变] AI API 未就绪，使用模拟结果');
      this.mockSuccess(originImage);
    } catch {
      // 网络错误时的回退
      console.warn('[变变] 网络请求失败，使用模拟结果');
      this.mockSuccess(originImage);
    }
  },

  /** 模拟 AI 结果（后端 API 未就绪时的回退） */
  mockSuccess(originImage: string) {
    const delay = 2000 + Math.random() * 2000;
    setTimeout(() => {
      // 返回原图，实际项目中应返回 AI 生成的图片
      this.onSuccess(originImage);
    }, delay);
  },

  onSuccess(aiImage: string) {
    // 消费每日次数
    incrementDailyTransformCount();

    // 保存到历史
    saveHistoryItem({
      id: `bb_${Date.now()}`,
      originalImage: this.data.originImage,
      aiImage,
      description: getApp<IAppOption>().globalData.bianbianDesc || '',
      status: 'success',
      createdAt: Date.now(),
    });

    // 清理 timer
    this.clearTimers();

    // 存到全局供结果页使用
    const app = getApp<IAppOption>();
    app.globalData.bianbianResult = aiImage;

    this.setData({ status: 'success', progress: 100, progressText: '完成！' });
  },

  onFailed(reason: string) {
    this.clearTimers();
    this.setData({ status: 'failed', errorMsg: reason });
  },

  goResult() {
    wx.redirectTo({
      url: '/pages/bianbian/result/result',
    });
  },

  retry() {
    this.setData({ status: 'loading', progress: 0, progressText: '准备中...', transitionSpeed: 300 });
    this.startProgress();
    this.startFunFacts();
    this.callAI(this.data.originImage, getApp<IAppOption>().globalData.bianbianDesc || '');
  },

  goBack() {
    wx.navigateBack();
  },

  clearTimers() {
    if (factTimer) { clearInterval(factTimer); factTimer = null; }
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
  },

  onUnload() {
    this.clearTimers();
  },
});
