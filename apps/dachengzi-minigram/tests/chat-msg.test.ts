/**
 * 主对话页共享纯函数（utils/chat-msg.ts）单元测试
 *
 * 覆盖施工图 §12.1 列出的三组纯函数口径：
 *   ① mergeConsecutiveAi：连续 assistant 合并、user 断点不合并、空数组。
 *   ② agentId/source 解析：'translate' → translate+tool；缺省/非法 → auto+不传 source。
 *   ③ kd_chat_seed 解析：正常/缺失/异常 的降级。
 * 另补翻译卡判定与种子气泡化（实时态与历史态共用一套渲染字段）。
 */
import {
  buildAiReplyBubble,
  buildSeedBubbles,
  isTranslateCardReply,
  mergeConsecutiveAi,
  parseChatSeed,
  parseTranslateTask,
  resolveAgentId,
  resolveSource,
  type ChatMsg,
} from '../utils/chat-msg';

const u = (text: string): ChatMsg => ({ id: '1', role: 'user', text });
const a = (text: string): ChatMsg => ({ id: '2', role: 'ai', text });

describe('resolveAgentId / resolveSource', () => {
  it("'translate' → translate", () => {
    expect(resolveAgentId('translate')).toBe('translate');
  });

  it('缺省 / 非法 → auto', () => {
    expect(resolveAgentId(undefined)).toBe('auto');
    expect(resolveAgentId(null)).toBe('auto');
    expect(resolveAgentId('auto')).toBe('auto');
    expect(resolveAgentId('chat')).toBe('auto');
    expect(resolveAgentId(123)).toBe('auto');
  });

  it('source 派生：translate → tool；auto → 不传（undefined）', () => {
    expect(resolveSource('translate')).toBe('tool');
    expect(resolveSource('auto')).toBeUndefined();
  });
});

describe('mergeConsecutiveAi', () => {
  it('连续 assistant 合并为一条（\n 分隔正文）', () => {
    const out = mergeConsecutiveAi([u('q1'), a('过渡语'), a('正文')]);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('user');
    expect(out[1].role).toBe('ai');
    expect(out[1].text).toBe('过渡语\n正文');
  });

  it('user 消息是断点：跨 user 不合并', () => {
    const out = mergeConsecutiveAi([a('a1'), u('q2'), a('a2')]);
    expect(out).toHaveLength(3);
    expect(out[0].text).toBe('a1');
    expect(out[2].text).toBe('a2');
  });

  it('空数组 → 空数组', () => {
    expect(mergeConsecutiveAi([])).toEqual([]);
  });

  it('单条 assistant 原样返回', () => {
    const out = mergeConsecutiveAi([a('only')]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('only');
  });
});

describe('parseChatSeed（kd_chat_seed）', () => {
  it('正常：返回 { user, reply }（trim）', () => {
    expect(parseChatSeed({ user: ' 感谢支持 ', reply: ' Thank you. ' })).toEqual({
      user: '感谢支持',
      reply: 'Thank you.',
    });
  });

  it('缺失 → null', () => {
    expect(parseChatSeed(undefined)).toBeNull();
    expect(parseChatSeed(null)).toBeNull();
    expect(parseChatSeed('')).toBeNull();
    expect(parseChatSeed(42)).toBeNull();
  });

  it('缺 user / reply 任一 → null', () => {
    expect(parseChatSeed({ user: '', reply: 'x' })).toBeNull();
    expect(parseChatSeed({ user: 'x', reply: '' })).toBeNull();
    expect(parseChatSeed({})).toBeNull();
  });
});

describe('parseTranslateTask（kd_translate_task）', () => {
  it('正常：返回五项字段（trim 原文）', () => {
    expect(parseTranslateTask({ srcLang: '中文', tgtLang: '英语', register: '正式', style: '完整', text: ' 你好 ' })).toEqual({
      srcLang: '中文',
      tgtLang: '英语',
      register: '正式',
      style: '完整',
      text: '你好',
    });
  });

  it('异常 / 缺失 / 原文为空 → null', () => {
    expect(parseTranslateTask(undefined)).toBeNull();
    expect(parseTranslateTask(null)).toBeNull();
    expect(parseTranslateTask('')).toBeNull();
    expect(parseTranslateTask(42)).toBeNull();
    expect(parseTranslateTask({})).toBeNull();
    expect(parseTranslateTask({ text: '   ' })).toBeNull();
  });

  it('缺字段回落输入页默认值', () => {
    expect(parseTranslateTask({ text: '你好' })).toEqual({
      srcLang: '中文',
      tgtLang: '英语',
      register: '正式',
      style: '完整',
      text: '你好',
    });
  });
});

describe('buildSeedBubbles（种子 → 首两条气泡）', () => {
  it('原文成用户气泡，译文强制套翻译卡', () => {
    const bubbles = buildSeedBubbles({ user: '感谢支持', reply: 'Thank you for your support.' }, () => 'seed');
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].role).toBe('user');
    expect(bubbles[0].text).toBe('感谢支持');
    expect(bubbles[1].role).toBe('ai');
    expect(bubbles[1].card).toBe(true);
    expect(bubbles[1].enMain).toBe('Thank you for your support.');
  });
});

describe('翻译卡判定与气泡化', () => {
  it('含【推荐译文】→ 卡', () => {
    expect(isTranslateCardReply('【推荐译文】Thank you.\n【直译对照】谢谢')).toBe(true);
  });

  it('英文开头 + 中文说明 → 卡', () => {
    expect(isTranslateCardReply('Thank you. 更正式用 Thank you。')).toBe(true);
  });

  it('纯中文收尾性追问 → 普通气泡', () => {
    expect(isTranslateCardReply('需要我把这句再调整得更口语化吗？')).toBe(false);
  });

  it('translate 会话命中卡时返回 { card, enMain, note }', () => {
    const bubble = buildAiReplyBubble(
      '9',
      '【推荐译文】Thank you.\n【语气要点】正式',
      '英语怎么说谢谢',
      'translate',
    );
    expect(bubble.card).toBe(true);
    expect(bubble.enMain).toBe('Thank you.');
    expect(bubble.note).toContain('正式');
    expect(bubble.meta).toBe('中文 → 英语');
  });

  it('auto 会话永不套卡（即使形态像翻译）', () => {
    const bubble = buildAiReplyBubble('9', '【推荐译文】Thank you.', 'hi', 'auto');
    expect(bubble.card).toBeUndefined();
    expect(bubble.text).toBe('【推荐译文】Thank you.');
  });

  it('显式 meta 覆盖推断（首问/重新翻译场景），并产出 detail 三段', () => {
    const bubble = buildAiReplyBubble(
      '9',
      '【推荐译文】Thank you.\n【直译对照】谢谢\n【委婉版】感谢您',
      '【源语言】中文\n【目标语言】英语\n【原文】谢谢',
      'translate',
      '中文 → 英语 · 正式 · 完整',
    );
    expect(bubble.card).toBe(true);
    expect(bubble.meta).toBe('中文 → 英语 · 正式 · 完整');
    expect(bubble.detail).toEqual({ literal: '谢谢', polite: '感谢您' });
  });
});
