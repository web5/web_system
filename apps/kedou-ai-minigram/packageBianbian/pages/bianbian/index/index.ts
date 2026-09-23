/**
 * 变变首页
 */
import { hasRecentDraft, loadDraft, getHistory } from '../../../../services/bianbian-storage';

Page({
  data: {
    radiusClass: "",
    hasDraft: false,
    draftTime: '',
    historyCount: 0,
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    const draft = loadDraft();
    const history = getHistory();

    let draftTime = '';
    if (draft && draft.elements.length > 0) {
      const d = new Date(draft.updatedAt);
      const pad = (n: number) => String(n).padStart(2, '0');
      draftTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    this.setData({
      hasDraft: hasRecentDraft(),
      draftTime,
      historyCount: history.length,
    });
  },

  goCreate() {
    wx.navigateTo({
      url: '/packageBianbian/pages/bianbian/create/create',
    });
  },

  goHistory() {
    wx.navigateTo({
      url: '/packageBianbian/pages/bianbian/history/history',
    });
  },

  resumeDraft() {
    wx.navigateTo({
      url: '/packageBianbian/pages/bianbian/create/create?resume=1',
    });
  },
});
