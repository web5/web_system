/**
 * 历史会话卡片归属判定（utils/history-cards.ts）回归测试
 *
 * 守住三条最容易回归的口径：
 *  ① 首轮偏移：intentHistory 缺第 1 轮（IntentService.lock 首轮拿不到 conversationId），
 *     故 hist[0] 对应第 2 个 user 消息；错对齐会让整段历史卡片集体错位。
 *  ② 一轮多 assistant：ReAct 落库「过渡语 + 工具后正文」两条，归属必须按轮次区间算。
 *  ③ 误判根治：权威 agentId 判定为非翻译官时**不再问启发式** ——
 *     「英文开头 + 中文说明」这种形态的普通回答曾被错套成翻译卡。
 *  ④ 降级：intentHistory 缺失（老会话 / 路由开关未开）→ 退回启发式，行为与改动前一致。
 */
import { decorateHistoryCards, CARD_AGENT_IDS } from '../utils/history-cards';
import { looksLikeTranslateReply } from '../utils/translate-parse';

type M = { role: 'user' | 'ai'; text: string; card?: boolean; enMain?: string; note?: string; meta?: string };

/** 契约出参形态（含【推荐译文】） */
const TRANSLATE_REPLY = '【推荐译文】Hello there.\n【直译对照】你好\n【语气要点】更正式';

/** ⭐ 误判素材：普通解释型回答，以英文开头 + 中文说明 —— 正是被错套成翻译卡的形态 */
const NORMAL_ENGLISH_REPLY = 'React is a JavaScript library. 它主要用于构建用户界面。';

const u = (text: string): M => ({ role: 'user', text });
const a = (text: string): M => ({ role: 'ai', text });

describe('decorateHistoryCards · 权威判据（intentHistory）', () => {
  /**
   * 对齐语义（水位线）：`hist[i]` 对应倒数第 `hist.length - i` 个 user 轮次。
   * 也就是 —— **最后一个 user 轮次没有流水**（那一轮可能仍在进行中、intent 还没写）。
   * 例：2 轮 1 条流水 → hist[0] 落在第 1 轮；3 轮 2 条 → hist[0]/hist[1] 落在第 1/2 轮。
   */
  it('水位线对齐：hist[i] 对应倒数第 (len - i) 轮，末轮无流水', () => {
    const msgs: M[] = [
      u('英语怎么说谢谢'), // 第 1 轮
      a(TRANSLATE_REPLY),
      u('再聊聊'), // 第 2 轮（末轮，无流水）
      a(NORMAL_ENGLISH_REPLY),
    ];
    const out = decorateHistoryCards(msgs, [{ agentId: 'translate', via: 'rule' }]);
    // hist[0] → 第 1 轮 → translate → 套卡
    expect(out[1].card).toBe(true);
    // 末轮无权威判据 → 降级启发式；该素材形似翻译 → 会套卡（此用例只验证对齐，不验证末轮）
    expect(out[3].card).toBe(true);
  });

  it('⭐ 误判根治：权威为非翻译官时，即使形态像翻译也不套卡', () => {
    const msgs: M[] = [
      u('第一个问题'), // 第 1 轮 ← hist[0]
      a(NORMAL_ENGLISH_REPLY),
      u('第二个问题'), // 第 2 轮（末轮，无流水）
      a(NORMAL_ENGLISH_REPLY),
    ];
    // hist[0] 落在第 1 轮，权威 agentId = chat（非翻译官）→ 明确不套卡
    const out = decorateHistoryCards(msgs, [{ agentId: 'chat', via: 'llm' }]);
    // ⭐ 这条若走启发式必被误判（英文开头 + 中文说明）—— 正是要根治的病
    expect(out[1].card).toBeUndefined();

    // 对照证明：同样的素材，**没有**权威判据时启发式确实会误判 → 说明上面的
    // toBeUndefined 是「根治」而非「素材本来就不像翻译」
    expect(looksLikeTranslateReply(NORMAL_ENGLISH_REPLY)).toBe(true);
    const degraded = decorateHistoryCards(msgs, undefined);
    expect(degraded[1].card).toBe(true);
  });

  it('同一会话中途从翻译切走：按轮次逐条独立判定', () => {
    const msgs: M[] = [
      u('q1'), // 第 1 轮 ← hist[0]
      a(NORMAL_ENGLISH_REPLY),
      u('英语怎么说谢谢'), // 第 2 轮 ← hist[1]
      a(TRANSLATE_REPLY),
      u('那再聊聊天气'), // 第 3 轮 ← hist[2]
      a(NORMAL_ENGLISH_REPLY),
      u('继续'), // 第 4 轮（末轮，无流水）
      a(NORMAL_ENGLISH_REPLY),
    ];
    const out = decorateHistoryCards(msgs, [
      { agentId: 'chat', via: 'llm' },
      { agentId: 'translate', via: 'rule' },
      { agentId: 'chat', via: 'llm' },
    ]);
    expect(out[1].card).toBeUndefined(); // 第 1 轮 = chat
    expect(out[3].card).toBe(true); // 第 2 轮 = translate
    expect(out[5].card).toBeUndefined(); // 第 3 轮 = chat
  });

  it('⭐ 一轮多条 assistant（ReAct 两段式）都归属同一轮', () => {
    const msgs: M[] = [
      u('q1'),
      a('a1'),
      u('翻译：你好'), // 第 2 轮 ← hist[0]
      a('让我想想'), // 同轮第一条
      a(TRANSLATE_REPLY), // 同轮第二条
      u('q3'), // 第 3 轮（末轮）
      a('a3'),
    ];
    const out = decorateHistoryCards(msgs, [{ agentId: 'translate', via: 'rule' }]);
    // 第 2 轮两条 assistant 同属一轮 → 都是翻译官 → 都套卡（不能只给第一条）
    expect(out[3].card).toBe(true);
    expect(out[4].card).toBe(true);
  });

  it('流水比 user 消息多时不越界取值（且必须从尾部取）', () => {
    const msgs: M[] = [u('q1'), a(NORMAL_ENGLISH_REPLY), u('q2'), a(NORMAL_ENGLISH_REPLY)];
    // 5 条流水 vs 2 轮：多余的旧流水必须丢弃，且要取**最新**的那条（hist[4]）
    const out = decorateHistoryCards(msgs, [
      { agentId: 'translate' },
      { agentId: 'translate' },
      { agentId: 'translate' },
      { agentId: 'translate' },
      { agentId: 'chat' }, // ← 最新一条，对应第 1 轮（末轮无流水）
    ]);
    expect(out).toHaveLength(4);
    // 第 1 轮 = chat（非翻译官）→ 不套卡。若从 hist 头部取会拿到 translate 而误套卡
    expect(out[1].card).toBeUndefined();
    // 第 2 轮是末轮、无权威判据 → 降级启发式；该素材形似翻译 → 会套卡
    expect(out[3].card).toBe(true);
  });

  it('⭐ 长会话被截断：缺流水的轮次是「开头那条」，不是会话第 1 轮', () => {
    // 模拟 RECENT_MSG_LIMIT 截断后剩下的 3 轮；hist 只有 2 条（第 3 轮是末轮、无流水）
    const msgs: M[] = [
      u('q1'), // 第 1 轮 ← hist[0]
      a(NORMAL_ENGLISH_REPLY),
      u('q2'), // 第 2 轮 ← hist[1]
      a(NORMAL_ENGLISH_REPLY),
      u('英语怎么说谢谢'), // 第 3 轮（末轮，无流水）
      a(TRANSLATE_REPLY),
    ];
    const out = decorateHistoryCards(msgs, [{ agentId: 'chat' }, { agentId: 'translate' }]);
    // 水位线：3 轮 + 2 条流水 → hist[0]→第1轮、hist[1]→第2轮、末轮无判据
    expect(out[1].card).toBeUndefined(); // 第 1 轮 = chat（非翻译官）→ 不套卡
    expect(out[3].card).toBe(true); // 第 2 轮 = translate → 套卡
    // 末轮走启发式；素材含【推荐译文】→ 套卡
    expect(out[5].card).toBe(true);
  });

  it('已打好 card 标记的条目幂等（不重算）', () => {
    const msgs: M[] = [u('q1'), a('a1'), { ...a(TRANSLATE_REPLY), card: true, enMain: 'KEEP' }];
    const out = decorateHistoryCards(msgs, [{ agentId: 'chat' }]);
    expect(out[2].enMain).toBe('KEEP');
  });
});

describe('decorateHistoryCards · 降级（无 intentHistory）', () => {
  it('undefined → 退回启发式：含【推荐译文】仍能套卡', () => {
    const msgs: M[] = [u('英语怎么说'), a(TRANSLATE_REPLY)];
    const out = decorateHistoryCards(msgs, undefined);
    expect(out[1].card).toBe(true);
  });

  it('null → 退回启发式，行为与改动前一致', () => {
    const msgs: M[] = [u('英语怎么说'), a(TRANSLATE_REPLY)];
    const out = decorateHistoryCards(msgs, null);
    expect(out[1].card).toBe(true);
  });

  it('空数组 → 退回启发式', () => {
    const msgs: M[] = [u('英语怎么说'), a(TRANSLATE_REPLY)];
    const out = decorateHistoryCards(msgs, []);
    expect(out[1].card).toBe(true);
  });

  it('纯中文回复不被误套卡', () => {
    const msgs: M[] = [u('你好'), a('你好，有什么可以帮你？')];
    const out = decorateHistoryCards(msgs, undefined);
    expect(out[1].card).toBeUndefined();
  });


  it('流水项缺 agentId 时该项不生效（不崩）', () => {
    const msgs: M[] = [u('q1'), a('a1'), u('英语怎么说'), a(TRANSLATE_REPLY)];
    const out = decorateHistoryCards(msgs, [{ via: 'rule' } as never]);
    // 该轮无权威 agentId → 降级启发式 → 形态含【推荐译文】→ 仍套卡
    expect(out[3].card).toBe(true);
  });
});

describe('CARD_AGENT_IDS 口径', () => {
  it('实时态与历史态共用同一份常量（防两处漂移）', () => {
    expect(CARD_AGENT_IDS).toContain('translate');
    expect(CARD_AGENT_IDS).not.toContain('chat');
  });
});
