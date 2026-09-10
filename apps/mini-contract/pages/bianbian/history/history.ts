/**
 * 变变历史页 — 3列网格 / 大图预览 / 批量管理
 */
import {
  getHistory,
  deleteHistoryItem,
  deleteHistoryBatch,
} from '../../../services/bianbian-storage';
import type { TransformResult } from '../../../utils/bianbian-constants';

interface HistoryItemDisplay extends TransformResult {
  timeLabel: string;
  checked: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  const padM = (n: number) => String(n + 1).padStart(2, '0');
  return `${d.getFullYear()}/${padM(d.getMonth())}/${String(d.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    list: [] as HistoryItemDisplay[],
    multiSelectMode: false,
    selectedIds: [] as string[],
    previewVisible: false,
    previewImage: '',
    previewId: '',
  },

  onShow() {
    this.loadHistory();
  },

  loadHistory() {
    const raw = getHistory();
    const list: HistoryItemDisplay[] = raw
      .filter((item) => item.status === 'success')
      .map((item) => ({
        ...item,
        timeLabel: formatTime(item.createdAt),
        checked: false,
      }));
    this.setData({ list });
  },

  // 点击 — 预览 / 多选
  onItemTap(e: WechatMiniprogram.BaseEvent) {
    const idx = e.currentTarget.dataset.index as number;
    const item = this.data.list[idx];

    if (this.data.multiSelectMode) {
      // 切换勾选
      const list = [...this.data.list];
      list[idx] = { ...list[idx], checked: !list[idx].checked };
      const selectedIds = list.filter((i) => i.checked).map((i) => i.id);
      this.setData({ list, selectedIds });
    } else {
      // 预览
      this.setData({
        previewVisible: true,
        previewImage: item.aiImage,
        previewId: item.id,
      });
    }
  },

  // 长按 — 进入多选
  onItemLongPress(e: WechatMiniprogram.BaseEvent) {
    wx.vibrateShort({ type: 'medium' });
    const idx = e.currentTarget.dataset.index as number;
    this.setData({ multiSelectMode: true });
    // 选中当前项
    const list = [...this.data.list];
    list[idx] = { ...list[idx], checked: true };
    this.setData({ list, selectedIds: [list[idx].id] });
  },

  enterMultiSelect() {
    this.setData({ multiSelectMode: true, selectedIds: [] });
  },

  cancelMultiSelect() {
    const list = this.data.list.map((i) => ({ ...i, checked: false }));
    this.setData({ multiSelectMode: false, selectedIds: [], list });
  },

  batchDelete() {
    const { selectedIds } = this.data;
    if (selectedIds.length === 0) return;

    wx.showModal({
      title: '确认删除',
      content: `确定删除 ${selectedIds.length} 个作品吗？`,
      confirmColor: '#FF3B30',
      success: (res) => {
        if (res.confirm) {
          deleteHistoryBatch(selectedIds);
          this.setData({ multiSelectMode: false, selectedIds: [] });
          this.loadHistory();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  },

  // 预览操作
  closePreview() {
    this.setData({ previewVisible: false, previewImage: '', previewId: '' });
  },

  savePreview() {
    wx.showLoading({ title: '保存中...' });
    wx.saveImageToPhotosAlbum({
      filePath: this.data.previewImage,
      success: () => {
        wx.hideLoading();
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      },
      fail: (err) => {
        wx.hideLoading();
        if ((err as { errMsg?: string }).errMsg?.includes('auth deny')) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中允许保存到相册',
            confirmText: '去设置',
            success: (mRes) => {
              if (mRes.confirm) wx.openSetting();
            },
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      },
    });
  },

  deletePreview() {
    wx.showModal({
      title: '确认删除',
      content: '删除后不可恢复',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (res.confirm) {
          deleteHistoryItem(this.data.previewId);
          this.closePreview();
          this.loadHistory();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  },

  goCreate() {
    wx.navigateTo({
      url: '/pages/bianbian/create/create',
    });
  },

  goBack() {
    wx.navigateBack();
  },
});
