/**
 * 合同翻译官 - 上传页
 * MVP：支持粘贴合同文本 + 示例样本，后续接入 OCR 拍照识别
 */
import { analyzeContract } from '../../../services/contract-api';

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

  async startAnalyze() {
    const text = this.data.contractText.trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴合同内容或选择示例', icon: 'none' });
      return;
    }

    this.setData({ analyzing: true });
    wx.navigateTo({
      url: '/pages/contract/analyzing/analyzing',
    });

    try {
      const report = await analyzeContract(text, this.data.scene);
      // 存储报告供结果页读取
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
