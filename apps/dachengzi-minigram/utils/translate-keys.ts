/**
 * 翻译功能的存储 key 与共享类型 —— 单点真源。
 *
 * 为什么抽到这里而不是各页各留一份字面量：
 * 「清空翻译历史」的删除 key 必须与「写入方」的 key 同源，否则会清错数据、
 * 或清完发现历史页还能读到。放主包 utils/（分包可引用主包，反向不行），
 * 翻译分包（packageTranslate）与「我的」页（pages/mine）共用同一份常量。
 */

/** 翻译历史存储 key（写入方 = 主对话页翻译卡完成；读取方 = history 页 / 我的页条数 / 翻译设置页清空） */
export const TRANSLATE_HISTORY_KEY = 'kd_tr_history';

/**
 * 翻译结果回看入参 key（写入方 = index / history 页；读取方 = result 页 onLoad）。
 * 改造后 result 页已废弃，本 key 仅保留在「设置页清理缓存白名单」里（历史遗留数据不再写入）。
 */
export const TRANSLATE_PARAMS_KEY = 'kd_translate_params';

/** 翻译默认偏好 key（写入方 = 翻译设置页 savePrefs；读取方 = 翻译首页 onShow） */
export const TRANSLATE_SETTINGS_KEY = 'kd_tr_settings';

/** 翻译首问种子 key（写入方 = 翻译输入页；读取方 = 主对话页 onLoad，读取后立即 removeStorageSync 清除） */
export const TRANSLATE_TASK_KEY = 'kd_translate_task';

/** 翻译首问任务：一次「输入页 → 对话页」的翻译任务参数（只含原文，无译文） */
export interface TranslateTask {
  srcLang: string;
  tgtLang: string;
  register: string;
  style: string;
  /** 原文 */
  text: string;
}

/**
 * 翻译追问种子 key（改造后新链路不再写入；旧写入方 = 翻译结果页 goFollowUpChat，已废弃）。
 * 读取方 = 主对话页 onLoad，读取后立即 removeStorageSync 清除，避免残留。
 * 保留读取兼容旧版本残留，P1 可清理。
 */
export const CHAT_SEED_KEY = 'kd_chat_seed';

/** 翻译追问种子结构：user=原文，reply=首轮译文（推荐译文，已切好） */
export interface ChatSeed {
  user: string;
  reply: string;
}

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
