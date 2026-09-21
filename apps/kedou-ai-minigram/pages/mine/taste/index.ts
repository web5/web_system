/**
 * 音乐口味页（方案 B · 扁平列表）
 *
 * 入口：我的 → AI 记忆 → 音乐口味。
 * 展示的是「用户级、跨会话」的口味档案：由 AI 在对话中自动积累，也可在此手动增删。
 * 后端存的是三类（风格/歌手/场景），这里**不分组展示**——按拍板的扁平方案：
 * 喜欢类橙 chip，不想听类红 chip 带前缀，删改更轻。
 */
import {
  getMusicTaste,
  addMusicTaste,
  removeMusicTaste,
  clearMusicTaste,
  TasteData,
} from '../../../services/user-taste';

interface TagItem {
  label: string;
  /** likes / dislikes */
  group: 'likes' | 'dislikes';
  /** genres / artists / moods */
  field: 'genres' | 'artists' | 'moods';
  dislike: boolean;
}

const TAG_MAX = 12;

Page({
  data: {
    loading: true,
    tags: [] as TagItem[],
    inputVal: '',
    err: '',
    empty: false,
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true });
    const taste = await getMusicTaste();
    this.apply(taste);
  },

  apply(taste: TasteData) {
    const tags: TagItem[] = [];
    const push = (group: 'likes' | 'dislikes', field: TagItem['field']) => {
      const list = (taste?.[group]?.[field] || []) as string[];
      for (const label of list) {
        tags.push({ label, group, field, dislike: group === 'dislikes' });
      }
    };
    // 喜欢在前、不想听在后（与原型一致）
    push('likes', 'genres');
    push('likes', 'artists');
    push('likes', 'moods');
    push('dislikes', 'genres');
    push('dislikes', 'artists');

    this.setData({ tags, empty: tags.length === 0, loading: false });
  },

  onInput(e: any) {
    this.setData({ inputVal: e.detail.value, err: '' });
  },

  /** 手动补充：一期归到「场景/情绪」池，后续由 AI 归类 */
  async onAdd() {
    const v = String(this.data.inputVal || '').trim();
    if (!v || v.length > TAG_MAX) {
      this.setData({ err: `请输入口味关键词，不超过 ${TAG_MAX} 个字` });
      return;
    }
    wx.showLoading({ title: '保存中…', mask: false });
    try {
      const taste = await addMusicTaste({ likes: { moods: [v], genres: [], artists: [] } } as never);
      this.setData({ inputVal: '', err: '' });
      this.apply(taste);
      wx.showToast({ title: '已添加', icon: 'none' });
    } catch {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /** 删除单个标签 */
  async onRemove(e: any) {
    const idx = Number(e.currentTarget.dataset.idx);
    const tag = this.data.tags[idx];
    if (!tag) return;
    const patch = { [tag.group]: { [tag.field]: [tag.label] } } as never;
    wx.showLoading({ title: '移除中…', mask: false });
    try {
      const taste = await removeMusicTaste(patch);
      this.apply(taste);
      wx.showToast({ title: `已移除：${tag.label}`, icon: 'none' });
    } catch {
      wx.showToast({ title: '移除失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  /** 清空：破坏性操作，二次确认并写明后果 */
  onClear() {
    wx.showModal({
      title: '清空口味记忆',
      content: 'AI 将不再按你的口味推荐，可随时重新积累。',
      confirmText: '清空',
      confirmColor: '#E5484D',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清空中…', mask: false });
        try {
          const taste = await clearMusicTaste();
          this.apply(taste);
          wx.showToast({ title: '已清空', icon: 'none' });
        } catch {
          wx.showToast({ title: '清空失败，请重试', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  /** 空态唯一恢复入口：去对话里告诉 AI */
  goChat() {
    wx.switchTab({ url: '/pages/chat/index/index' });
  },
});
