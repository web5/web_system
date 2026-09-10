/**
 * 合同翻译官 - 上传页
 * 支持拍照/相册 OCR 识别 + 文本粘贴 + 示例样本（按 v5 原型稿界面）
 */
import { chooseAndRecognize } from '../../../services/ocr-api';

// 示例样本（演示用，点一下自动填入并切好场景）
const SAMPLES: Record<string, string> = {
  loan:
    '本合同项下借款金额为人民币100000元，借款期限12个月。借款人需一次性支付服务费5000元。\n' +
    '借款利率按月费率1.5%计算，借款人每月偿还本息共9168元。\n' +
    '借款人提前还款的，需支付剩余本金的3%作为违约金，且前12期不得提前还款。\n' +
    '借款人同意开通"尊享会员"服务，每月自动扣费30元。',
  car:
    '车辆融资租赁合同：车辆含税价120000元，承租人首付12000元，出租人出资108000元购车后回租。\n' +
    '租期36个月，每期租金3480元；放款前另付融资服务费6000元。\n' +
    '承租人逾期一期租金的，出租人有权取回车辆并要求全部剩余租金加速到期。\n' +
    '车辆保险须在出租人指定保险公司投保；期满支付留购价1元过户。',
  insurance:
    '本保险合同等待期为180天。被保险人因既往症导致的医疗费用，本公司不承担保险责任。\n' +
    '每次医疗费用超过免赔额10000元的部分，本公司按80%比例报销。\n' +
    '本公司对以下情形免责：任何原因导致的意外伤害、未告知的既往症。\n' +
    '本合同自动续费，每期保费从指定账户自动扣除。',
};

// 示例 key → scene key（scene 为空表示自动识别）
const SAMPLE_SCENE: Record<string, string> = {
  loan: 'consumer-loan',
  car: 'car-finance',
  insurance: 'medical-insurance',
};

Page({
  data: {
    contractText: '',
    analyzing: false,
    scene: '',
    ocring: false,
    /** 输入来源：paste=粘贴/示例（无需清洗），ocr=拍照/相册识别 */
    source: 'paste' as 'paste' | 'ocr',
  },

  onInput(e: any) {
    this.setData({ contractText: e.detail.value, source: 'paste' });
  },

  onSceneChange(e: any) {
    this.setData({ scene: e.currentTarget.dataset.scene || '' });
  },

  useSample(e: any) {
    const key = e.currentTarget.dataset.key as string;
    const text = SAMPLES[key];
    if (!text) return;
    this.setData({ contractText: text, scene: SAMPLE_SCENE[key] || '', source: 'paste' });
  },

  /** 拍照识别 */
  takePhoto() {
    this.doOcr('camera');
  },

  /** 相册识别 */
  chooseAlbum() {
    this.doOcr('album');
  },

  /** OCR 识别合同图片 */
  doOcr(sourceType: 'camera' | 'album') {
    chooseAndRecognize(sourceType, {
      onUploadStart: () => {
        this.setData({ ocring: true });
        wx.showLoading({ title: '识别图片中...' });
      },
    })
      .then((res) => {
        wx.hideLoading();
        this.setData({ ocring: false });
        if (res.text) {
          this.setData({ contractText: res.text, source: 'ocr' });
          wx.showToast({ title: `识别到 ${res.blockCount} 段文字`, icon: 'success' });
        } else {
          wx.showToast({ title: '未识别到文字', icon: 'none' });
        }
      })
      .catch((err: any) => {
        wx.hideLoading();
        this.setData({ ocring: false });
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

  startAnalyze() {
    const text = this.data.contractText.trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴合同内容、识别图片或选择示例', icon: 'none' });
      return;
    }
    this.setData({ analyzing: true });
    wx.setStorageSync('contract_pending', { text, scene: this.data.scene, source: this.data.source });
    wx.redirectTo({ url: '/pages/contract/analyzing/analyzing' });
  },
});
