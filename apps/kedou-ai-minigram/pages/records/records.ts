// pages/records/records.ts
import { DrawingRecord, getRecords, updateRecord, deleteRecord } from '../../services/drawing-records';

Page({
  data: {
    records: [] as (DrawingRecord & { timeText: string })[],
    isIPad: false,
    isLandscape: false,
    /** 正在编辑的记录 ID，空表示未编辑 */
    editingId: '',
    /** 编辑框中的值 */
    editName: '',
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '我的画作' });
    this.detectDevice();
  },

  onShow() {
    this.loadRecords();
  },

  onResize() {
    this.detectDevice();
  },

  detectDevice() {
    try {
      const info = wx.getSystemInfoSync();
      const isIPad = info.model?.indexOf('iPad') >= 0 || info.windowWidth >= 768;
      const isLandscape = info.windowWidth > info.windowHeight;
      this.setData({ isIPad, isLandscape });
    } catch (_) { /* ignore */ }
  },

  /** 加载记录列表 */
  loadRecords() {
    const records = getRecords().map(r => ({
      ...r,
      timeText: this.formatTime(r.updatedAt),
    }));
    this.setData({ records } as any);
  },

  /** 点击记录进入画板 */
  goToDraw() {
    wx.navigateTo({ url: '/pages/draw/draw' });
  },

  /** 跳转到画板，携带记录 ID */
  onTapRecord(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/draw/draw?recordId=${id}` });
  },

  /** 长按编辑名称 */
  onLongPressRecord(e: any) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    this.setData({ editingId: id, editName: name });
  },

  /** 输入框内容变化 */
  onEditInput(e: any) {
    this.setData({ editName: e.detail.value });
  },

  /** 确认编辑 */
  onEditConfirm() {
    const { editingId, editName } = this.data;
    if (!editingId || !editName.trim()) {
      this.setData({ editingId: '', editName: '' });
      return;
    }
    updateRecord(editingId, { name: editName.trim() });
    this.setData({ editingId: '', editName: '' });
    this.loadRecords();
  },

  /** 取消编辑 */
  onEditCancel() {
    this.setData({ editingId: '', editName: '' });
  },

  /** 删除记录 */
  onDeleteRecord(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定删除这条记录吗？',
      success: (res: any) => {
        if (res.confirm) {
          deleteRecord(id);
          this.loadRecords();
        }
      },
    });
  },

  /** 格式化时间 */
  formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },
});