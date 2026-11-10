// 翻译历史
//
// 数据源：kd_tr_history（写入方 = result 页 saveHistory，翻译成功后落一条；上限 50 条）。
// 点击某条 → 把该记录写回 kd_translate_params，带 ?fromHistory=1 跳结果页回看（不重新请求）。
// 存储 key 与 TrHistoryItem 结构统一从 utils/translate-keys 导入（单点真源，避免复制字面量）。
import { TRANSLATE_HISTORY_KEY, TRANSLATE_PARAMS_KEY, TrHistoryItem } from '../../../../utils/translate-keys';

/** 渲染用行（时间已格式化为相对时间） */
interface HistoryRow {
  id: string;
  title: string;
  sub: string;
  time: string;
}

/** 列表点击事件（只用到 currentTarget.dataset.id，用最小结构替代 any） */
interface RowTapEvent {
  currentTarget: { dataset: { id?: string } };
}

const TITLE_MAX = 40;

/** 原文截断：超出 40 字加省略号 */
function truncate(s: string, max: number): string {
  const chars = Array.from(String(s || '').trim());
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, max).join('') + '…';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 相对时间：今天 HH:mm / 昨天 / N 天前 / 超过 7 天 YYYY-MM-DD */
function relTime(ts: number): string {
  const t = Number(ts);
  if (!t || Number.isNaN(t)) return '';
  const d = new Date(t);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const dayMs = 86400000;
  if (t >= todayStart) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (t >= todayStart - dayMs) return '昨天';
  const days = Math.floor((todayStart - t) / dayMs) + 1;
  if (days <= 7) return `${days} 天前`;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function readHistory(): TrHistoryItem[] {
  try {
    const raw = wx.getStorageSync(TRANSLATE_HISTORY_KEY);
    if (!Array.isArray(raw)) return [];
    return (raw as TrHistoryItem[]).filter((it) => !!it && !!it.id);
  } catch {
    return [];
  }
}

Page({
  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : "";
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });
    this.refresh();
  },

  data: {
    radiusClass: "",
    list: [] as HistoryRow[],
  },

  /** 从 storage 重建列表（空数组时页面自动落到空态） */
  refresh() {
    const rows = readHistory().map((it) => ({
      id: String(it.id),
      title: truncate(it.text || it.natural || '', TITLE_MAX),
      sub: `${it.srcLang || '中文'} → ${it.tgtLang || '英语'}`,
      time: relTime(it.ts),
    }));
    this.setData({ list: rows });
  },

  /** 回看：把该条记录写回参数 storage（含 conversationId，回看后还能继续追问） */
  open(e: RowTapEvent) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    const hit = readHistory().find((it) => String(it.id) === id);
    if (!hit) {
      wx.showToast({ title: '这条记录已不存在', icon: 'none' });
      this.refresh();
      return;
    }
    wx.setStorageSync(TRANSLATE_PARAMS_KEY, {
      srcLang: hit.srcLang || '',
      tgtLang: hit.tgtLang || '',
      register: hit.register || '',
      style: hit.style || '',
      text: hit.text || '',
      natural: hit.natural || '',
      conversationId: hit.conversationId || '',
      __historyId: String(hit.id),
    });
    wx.navigateTo({ url: '/packageTranslate/pages/translate/result/result?fromHistory=1' });
  },

  /** 清空历史：二次确认后清 storage 并刷新 */
  clearAll() {
    wx.showModal({
      title: '清空翻译记录',
      content: '清空后无法恢复，译文也不会保留。',
      confirmText: '清空',
      confirmColor: '#E5484D',
      success: (r) => {
        if (!r.confirm) return;
        try {
          wx.setStorageSync(TRANSLATE_HISTORY_KEY, []);
        } catch {
          /* 清空失败交给下一次刷新兜底 */
        }
        this.refresh();
        wx.showToast({ title: '已清空', icon: 'none' });
      },
    });
  },

  goTranslate() {
    wx.navigateTo({ url: '/packageTranslate/pages/translate/index/index' });
  },
});
