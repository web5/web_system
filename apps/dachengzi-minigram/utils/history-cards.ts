/**
 * 历史会话卡片归属判定（翻译卡）
 *
 * ## 为什么要有这个模块（2026-10-15）
 * 后端 `GET agent/conversations/:id` 原先不回传 intent，前端只能靠文本形态猜
 * 「这条是不是翻译官答的」（`looksLikeTranslateReply`：含【推荐译文】或「英文开头 + 中文说明」）。
 * 但第二条规则**极其宽泛** —— 任何以英文单词开头的解释型回答都会命中，
 * 而它被拿去判**所有**历史 assistant 消息 → 普通回复被错套成翻译卡。
 *
 * 更糟的是**两套判定标准并存**：实时态用权威 `agentId`，历史态用文本启发式，
 * 必然漂移，表现为「实时出卡片、刷新历史卡片没了」。
 *
 * ## 现在的口径
 * 权威判据 = 后端透出的 `intentHistory`（`agent_conversations.intent_history`，
 * 逐轮 append-only）。以 **user 消息为轮次锚点**，不用下标硬对齐。
 *
 * ⚠️ **流水可能比可见消息多**：`intent_history` 是全量 append-only（不会被前端截断），
 *   而 msgs 可能被 `RECENT_MSG_LIMIT` 截掉开头若干轮。
 *   → **从 hist 尾部对齐**：最新的那条流水对应「倒数第 2 个 user 轮次」
 *   （最后一个 user 轮次可能仍在进行中、尚未写入 intent）。
 *   ⚠️ 别从 hist **头部**对齐 —— hist 比 msgs 多时会把该消费的尾部条目当越界丢弃，
 *   卡片集体错位。（本仓 `tests/history-cards.test.ts` 的「流水比 user 消息多」用例
 *   正是这么抓出初版 bug 的。）
 *
 * ⚠️ **一轮可能多条 assistant**：ReAct 会落库「过渡语 + 工具后正文」两条
 *   （调用方会先 `mergeConsecutiveAi`）。所以归属按「轮次区间」预计算，
 *   挂在某条 user 消息上传给下一条 AI 是错的。
 *
 * ⚠️ **时间戳不可用于对齐**：`intent_history.ts` 是 MySQL `NOW()` 字符串，
 *   `messages.ts` 是 `Date.now()` 毫秒数，格式不同且无共同基准 → 只按顺序对齐。
 *
 * ## 降级
 * `intentHistory` 缺失（老会话 / `INTENT_ROUTING_ENABLED` 未开）→ 退回文本启发式，
 * 行为与改动前完全一致，零回归。
 */

import { buildTranslateCardView, inferTranslateDirection, looksLikeTranslateReply } from './translate-parse';

/** 意图判定流水一项（与 agent-stream 的 IntentHistoryItem 同构，此处独立声明避免跨层依赖） */
export interface IntentHistoryItem {
  agentId: string;
  /** 归因：rule / llm / locked / explicit / fallback */
  via?: string;
  ts?: string;
}

/** 卡片承载的 agent（与 SSE intent 的 agentId、实时态 CARD_AGENT_IDS 同一份口径） */
export const CARD_AGENT_IDS = ['translate'];

/** 判定所需的最小消息形状（页面里的 ChatMsg 结构更宽，此处只约束用到的字段） */
export interface HistoryMsg {
  role: 'user' | 'ai';
  text: string;
  /** 已打好卡片标记（新缓存 / 已判定过）—— 幂等：命中不再重算 */
  card?: boolean;
  enMain?: string;
  note?: string;
  meta?: string;
}

/**
 * 给历史消息补翻译卡（幂等：已打 card 标记的不重算）。
 *
 * @param msgs 历史消息（调用方需先合并连续 assistant）
 * @param intentHistory 后端透出的逐轮意图流水；缺失时降级到文本启发式
 */
export function decorateHistoryCards<T extends HistoryMsg>(
  msgs: T[],
  intentHistory?: IntentHistoryItem[] | null,
): T[] {
  const hist = Array.isArray(intentHistory) ? intentHistory : [];

  // 轮次归属表：轮次序号（0 起）→ 该轮权威 agentId
  const roundAgent = new Map<number, string>();
  const userCount = msgs.reduce((n, m) => (m.role === 'user' ? n + 1 : n), 0);

  // ⭐ 水位线对齐（2026-10-15 修正，由测试先发现）：缺流水**不只发生在会话第 1 轮** ——
  // 长会话会被 RECENT_MSG_LIMIT 截掉前若干轮，此时缺流水的轮次是「开头那一条」，
  // 后面每条 user 消息都能对上 hist 里的记录。
  // 若按绝对轮次号「第 2 轮起才消费」，截断场景下会把整段历史卡片全部错位，
  // 且开头那条仍走启发式 → 误判照旧。
  //
  // 正确口径：**hist 末尾对齐到最后一条完整轮次** ——
  //   · hist 是全量 append-only，不会被前端截断；msgs 可能被截。
  //   · 所以「最新的那条流水」对应的必然是「倒数第 2 个 user 轮次」
  //     （最后一个 user 轮次可能仍在进行中、尚未写入 intent）。
  //   · hist 比 msgs 多时（异常数据/多设备写入），**必须从 hist 尾部取**，
  //     否则会消费掉最旧的几条却把最新的丢掉 → 卡片集体错位。
  //
  // ⭐ 踩坑记录：初版写成 `hist[i] → lastRound - hist.length + i`（从 hist 头部对齐），
  //   在「hist 比消息多」时把该消费的尾部条目全判为越界丢弃 —— 单测直接抓出。
  const lastRound = userCount - 1; // 最后一个 user 轮次（通常无流水）
  const usable = Math.min(hist.length, Math.max(0, lastRound)); // 能消费的轮次数
  for (let k = 0; k < usable; k += 1) {
    const round = lastRound - 1 - k; // 倒数第 2 轮起往前
    const item = hist[hist.length - 1 - k]; // 从 hist 尾部取
    if (round >= 0 && item && item.agentId) roundAgent.set(round, item.agentId);
  }

  let lastUserText = '';
  let round = -1; // 当前轮次（每遇一条 user 消息 +1）
  return msgs.map((m) => {
    if (m.role === 'user') {
      lastUserText = m.text;
      round += 1;
      return m;
    }
    // 已是卡片（新缓存）→ 原样返回
    if (m.card) return m;

    // 本条所属轮次有权威 agentId → 用 CARD_AGENT_IDS 判定（与实时态同一份常量）
    const authoritativeId = roundAgent.get(round);
    if (authoritativeId) {
      // 权威判定为非翻译官 → 明确不套卡片，不再问启发式（这是误判的根治点）
      if (CARD_AGENT_IDS.indexOf(authoritativeId) < 0) return m;
      return toCard(m, lastUserText);
    }

    // 无权威判据（首轮 / 老会话 / 路由开关未开）→ 降级到文本启发式
    if (!looksLikeTranslateReply(m.text)) return m;
    return toCard(m, lastUserText);
  });
}

/** 把一条 AI 消息转成翻译卡视图 */
function toCard<T extends HistoryMsg>(m: T, lastUserText: string): T {
  const view = buildTranslateCardView(m.text);
  return {
    ...m,
    card: true,
    text: view.text,
    enMain: view.main,
    note: view.note,
    // 方向由本轮提问推断；推断不出为空 → 只留 tag，不留空白
    meta: inferTranslateDirection(lastUserText),
  };
}
