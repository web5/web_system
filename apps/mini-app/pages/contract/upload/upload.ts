/**
 * 合同翻译官 - 上传页
 * 支持拍照/相册 OCR 识别 + 文本粘贴 + 示例样本
 */
import { analyzeContract } from '../../../services/contract-api';
import { chooseAndRecognize } from '../../../services/ocr-api';

// 示例样本（演示用）
const SAMPLES = {
  loan: '本合同项下借款金额为人民币100000元，借款期限12个月。借款人需一次性支付服务费5000元。\n' +
    '借款利率按月费率1.5%计算，借款人每月偿还本息共9168元。\n' +
    '借款人提前还款的，需支付剩余本金的3%作为违约金，且前12期不得提前还款。\n' +
    '借款人同意开通"尊享会员"服务，每月自动扣费30元。',
  insurance: '本保险合同等待期为180天。被保险人因既往症导致的医疗费用，本公司不承担保险责任。\n' +
    '每次医疗费用超过免赔额10000元的部分，本公司按80%比例报销。\n' +
    '本公司对以下情形免责：任何原因导致的意外伤害、未告知的既往症。\n' +
    '本合同自动续费，每期保费从指定账户自动扣除。',
};

Page({
  data: {
    contractText: '',
    analyzing: false,
    scene: '',
    ocring: false,
  },

  onInput(e: any) {
    this.setData({ contractText: e.detail.value });
  },

  onSceneChange(e: any) {
    this.setData({ scene: e.currentTarget.dataset.scene || '' });
  },

  useSample(e: any) {
    const key = e.currentTarget.dataset.key;
    const text = SAMPLES[key as keyof typeof SAMPLES];
    const sceneMap: Record<string, string> = { loan: 'consumer-loan', insurance: 'medical-insurance' };
    if (text) {
      this.setData({ contractText: text, scene: sceneMap[key] || '' });
    }
  },

  /** 拍照识别 */
  takePhoto() {
    this.doOcr('camera');
  },

  /** 相册识别 */
  chooseAlbum() {
    this.doOcr('album');
  },

  /** 文件上传（MVP：暂用相册） */
  chooseFile() {
    wx.showToast({ title: '文件上传开发中，请先使用相册', icon: 'none' });
  },

  /** OCR 识别合同图片 */
  doOcr(sourceType: 'camera' | 'album') {
    this.setData({ ocring: true });
    wx.showLoading({ title: '识别图片中...' });
    chooseAndRecognize(sourceType)
      .then((res) => {
        wx.hideLoading();
        this.setData({ ocring: false });
        if (res.text) {
          this.setData({ contractText: res.text });
          wx.showToast({ title: `识别到 ${res.blockCount} 段文字`, icon: 'success' });
        } else {
          wx.showToast({ title: '未识别到文字', icon: 'none' });
        }
      })
      .catch((err: any) => {
        wx.hideLoading();
        this.setData({ ocring: false });
        // 用户取消选择不提示
        if (err?.errMsg && String(err.errMsg).includes('cancel')) return;
        const msg = err?.message || 'OCR 识别失败';
        wx.showModal({
          title: '识别失败',
          content: `${msg}。可改用粘贴合同文本。`,
          showCancel: false,
          confirmText: '知道了',
        });
      });
  },

  async startAnalyze() {
    const text = this.data.contractText.trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴合同内容、识别图片或选择示例', icon: 'none' });
      return;
    }

    this.setData({ analyzing: true });
    wx.navigateTo({
      url: '/pages/contract/analyzing/analyzing',
    });

    try {
      const report = await analyzeContract(text, this.data.scene);
      const storage = wx.getStorageSync('contract_report') || {};
      storage.latest = { ...report, createdAt: Date.now() };
      wx.setStorageSync('contract_report', storage);

      wx.redirectTo({
        url: '/pages/contract/result/result',
      });
    } catch (err: any) {
      this.setData({ analyzing: false });
      wx.showToast({ title: err?.message || '分析失败，请重试', icon: 'none' });
    }
  },
});
