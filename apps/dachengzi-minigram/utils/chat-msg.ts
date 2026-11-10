/**
 * 主对话页（pages/chat/index）共享类型与纯函数 —— 无副作用部分。
 *
 * 为什么抽出来：mergeConsecutiveAi / agentId·source 解析 / 种子解析都要被单测覆盖
 * （施工图 §12.1），而 pages/chat/index/index.ts 顶部 Page({}) 有注册副作用，
 * 直接 import 会触发 Page 调用，污染测试。纯函数放 utils/，测试只 import 这里。
 *
 * 本文件不 import wx / services：一切入参显式传入，保持可在 jest 下裸跑。
 */

import {
  buildTranslateCardView,
  inferTranslateDirection,
  looksLikeTranslateReply,
  parseSections,
} from './translate-parse';
import type { ChatSeed } from './translate-keys';

/* ==================== 类型 ==================== */

/**
 * 主对话页本地消息（气泡）。
 *
 * ⚠️ 字段命名对齐 utils/history-cards.ts 的 HistoryMsg 输出 { card, enMain, note, meta }：
 * 历史恢复时 `decorateHistoryCards(msgs, detail.intentHistory)` 直接在其上打标记，
 * 实时流式与历史恢复共用同一套渲染字段，无需二次映射。施工图 §6 建议的
 * isTranslateCard/trMain/trNote/trMeta 与本结构语义等价，此处以「复用不改 history-cards」为准。
 */
export interface ChatMsg {
  /** wx:key（自增序列） */
  id: string;
  role: 'user' | 'ai';
  /** 气泡正文（流式累加；翻译卡时是去掉段落标题后的全文，供复制/失败保留） */
  text: string;
  /** AI 流式中 */
  loading?: boolean;
  /** 失败态（渲染「重试」） */
  error?: boolean;
  /** 翻译卡标记（decorateHistoryCards 与实时态共用） */
  card?: boolean;
  /** 翻译卡主文（推荐译文） */
  enMain?: string;
  /** 翻译卡中文注解（直译对照/委婉版/语气要点合并） */
  note?: string;
  /** 翻译卡方向 meta（如「中文 → 英语」，推断不出为空） */
  meta?: string;
}

/** 会话级锁定 agentId：仅 translate / auto 两种 */
export type ChatAgentId = 'auto' | 'translate';

/* ==================== agentId / source 解析 ==================== */

/** 进入即锁定：'translate' → translate，其余 / 缺省 / 非法 → auto */
export function resolveAgentId(agentId: unknown): ChatAgentId {
  return agentId === 'translate' ? 'translate' : 'auto';
}

/**
 * source 派生：auto → 不传（后端默认 chat，进「对话记录」列表）；
 * translate → 'tool'（不进「对话记录」列表，翻译走自己的历史页）。
 * 返回 undefined 表示「不传 source」。
 */
export function resolveSource(agentId: ChatAgentId): 'tool' | undefined {
  return agentId === 'translate' ? 'tool' : undefined;
}

/* ==================== 历史恢复：合并连续 assistant ==================== */

/**
 * 合并连续 assistant（AI）消息为一条。
 *
 * 背景：ReAct 一轮可能落「过渡语 + 工具后正文」两条 assistant，历史渲染前须合并，
 * 否则气泡里会出现半截过渡语。user 消息是轮次断点，跨 user 不合并。
 *
 * 纯文本拼接（\n 分隔）；翻译卡归属由调用方随后用 decorateHistoryCards 判定，
 * 合并后的正文仍能被 buildTranslateCardView 正确切出「推荐译文」主文。
 */
export function mergeConsecutiveAi(msgs: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (m.role === 'ai' && prev && prev.role === 'ai') {
      // 连续 AI：把本条正文拼到上一条，保留上一条的 id / 其余标记
      prev.text = prev.text ? `${prev.text}\n${m.text}` : m.text;
      // 若上一条已带卡标记、本条无卡，维持上一条标记（卡归属交给 decorateHistoryCards）
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

/* ==================== 种子解析与气泡化 ==================== */

/**
 * 解析翻译追问种子（kd_chat_seed，写入方 = 翻译结果页 goFollowUpChat）。
 * 读取方在 onLoad 里 `wx.getStorageSync` 后把 raw 交到这里；异常 / 缺失一律降级为 null。
 */
export function parseChatSeed(raw: unknown): ChatSeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const seed = raw as Record<string, unknown>;
  const user = String(seed.user || '').trim();
  const reply = String(seed.reply || '').trim();
  if (!user || !reply) return null;
  return { user, reply };
}

/**
 * 把种子转成首两条气泡：原文（用户气泡）+ 译文（翻译卡气泡）。
 * 种子 reply 是结果页已切好的「推荐译文」（干净英文，无段落标题），这里强制套翻译卡。
 */
export function buildSeedBubbles(seed: ChatSeed, nextId: () => string): ChatMsg[] {
  const view = buildTranslateCardView(seed.reply);
  return [
    { id: nextId(), role: 'user', text: seed.user },
    {
      id: nextId(),
      role: 'ai',
      text: view.text,
      card: true,
      enMain: view.main,
      note: view.note,
      meta: inferTranslateDirection(seed.user),
    },
  ];
}

/* ==================== 实时回复：翻译卡判定与气泡化 ==================== */

/**
 * 一轮 AI 回复是否按「翻译卡」渲染（translate 会话专用）。
 *
 * 判据：命中段落标题（【推荐译文】等）→ 一定是卡；否则退回「英文开头 + 中文说明」
 * 启发式。纯英文 / 纯中文的收尾性追问（如「需要我再调整吗」）落普通气泡。
 */
export function isTranslateCardReply(raw: string): boolean {
  const t = String(raw || '');
  return Object.keys(parseSections(t)).length > 0 || looksLikeTranslateReply(t);
}

/**
 * 把一轮 AI 回复整理成最终气泡（实时态与历史态同一套字段）。
 * 翻译卡命中时返回 { card:true, enMain, note, meta }，否则返回普通文本气泡（去标题）。
 */
export function buildAiReplyBubble(id: string, raw: string, userText: string, agentId: ChatAgentId): ChatMsg {
  const final = String(raw || '');
  if (agentId === 'translate' && isTranslateCardReply(final)) {
    const view = buildTranslateCardView(final);
    return {
      id,
      role: 'ai',
      text: view.text,
      card: true,
      enMain: view.main,
      note: view.note,
      meta: inferTranslateDirection(userText),
    };
  }
  // 普通回复：原样展示正文（翻译卡未命中说明没有段落标题，无需 stripTitles）
  return { id, role: 'ai', text: final };
}
