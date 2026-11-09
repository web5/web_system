/**
 * 翻译功能的存储 key 与共享类型 —— 单点真源。
 *
 * 为什么抽到这里而不是各页各留一份字面量：
 * 「清空翻译历史」的删除 key 必须与「写入方」的 key 同源，否则会清错数据、
 * 或清完发现历史页还能读到。放主包 utils/（分包可引用主包，反向不行），
 * 翻译分包（packageTranslate）与「我的」页（pages/mine）共用同一份常量。
 */

/** 翻译历史存储 key（写入方 = result 页 saveHistory；读取方 = history 页 / 我的页条数 / 翻译设置页清空） */
export const TRANSLATE_HISTORY_KEY = 'kd_tr_history';

/** 翻译结果回看入参 key（写入方 = index / history 页；读取方 = result 页 onLoad） */
export const TRANSLATE_PARAMS_KEY = 'kd_translate_params';

/** 翻译默认偏好 key（写入方 = 翻译设置页 savePrefs；读取方 = 翻译首页 onShow） */
export const TRANSLATE_SETTINGS_KEY = 'kd_tr_settings';

/** 一条翻译历史（各页读写同一份 storage，字段结构固定，新增字段须各消费方同步） */
export interface TrHistoryItem {
  id: string;
  text: string;
  natural: string;
  srcLang: string;
  tgtLang: string;
  register: string;
  style: string;
  conversationId: string;
  ts: number;
}
