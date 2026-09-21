import {
  buildTranslateCardView,
  inferTranslateDirection,
  looksLikeTranslateReply,
  parseSections,
  splitSpeakChunks,
} from '../utils/translate-parse';

describe('buildTranslateCardView', () => {
  it('命中段落标题：推荐译文为主文，其余合并为注解', () => {
    const raw =
      '【推荐译文】Thank you for your help.\n【直译对照】谢谢你的帮助\n【语气要点】for your help 点明感谢对象';
    const v = buildTranslateCardView(raw);
    expect(v.main).toBe('Thank you for your help.');
    expect(v.note).toContain('谢谢你的帮助');
    expect(v.note).toContain('for your help 点明感谢对象');
    expect(v.text).not.toContain('【');
  });

  it('无段落标题：首个中文字符前为英文主句，其后为注解', () => {
    const v = buildTranslateCardView('Thank you. 更正式用 Thank you，口语随意用 Thanks。');
    expect(v.main).toBe('Thank you.');
    expect(v.note).toBe('更正式用 Thank you，口语随意用 Thanks。');
  });

  it('句首不是英文：整段进主文，不做切分', () => {
    const v = buildTranslateCardView('更正式的说法是 Thank you very much。');
    expect(v.main).toBe('更正式的说法是 Thank you very much。');
    expect(v.note).toBe('');
  });

  it('流式半成品：标题未凑齐也能给出主文', () => {
    const v = buildTranslateCardView('【推荐译文】Thank you');
    expect(v.main).toBe('Thank you');
    expect(v.note).toBe('');
  });
});

describe('parseSections', () => {
  it('一个标题都没命中时返回空对象', () => {
    expect(parseSections('Thank you.')).toEqual({});
  });
});

describe('inferTranslateDirection', () => {
  it('提问含「英语」→ 中文 → 英语', () => {
    expect(inferTranslateDirection('谢谢你的帮助，英语怎么说')).toBe('中文 → 英语');
  });

  it('目标语是中文 → 英语 → 中文', () => {
    expect(inferTranslateDirection('把这段英文翻译成中文')).toBe('英语 → 中文');
  });

  it('推断不出语种返回空串（不留空白 meta）', () => {
    expect(inferTranslateDirection('帮我润色一下这句话')).toBe('');
  });
});

describe('splitSpeakChunks（流式朗读切块）', () => {
  it('多句文本：首句单独成块（最快出声），其余合并到上限内', () => {
    const chunks = splitSpeakChunks('Thank you very much. It is my pleasure to help you today.');
    expect(chunks[0]).toBe('Thank you very much.');
    // 所有块都在上限内
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(110);
    // 拼回原文（空格归一后）
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(
      'Thank you very much. It is my pleasure to help you today.',
    );
  });

  it('单句短文本 → 一块', () => {
    expect(splitSpeakChunks('Thank you.')).toEqual(['Thank you.']);
  });

  it('超长单句在空格处硬切，不切碎单词', () => {
    const long = 'word '.repeat(60).trim(); // 300 字符无句读
    const chunks = splitSpeakChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(110);
      // 不出现半个单词（首尾都不是把 word 切成两半）
      expect(c.startsWith('word')).toBe(true);
      expect(c.endsWith('word') || c.endsWith(' ')).toBe(true);
    }
  });

  it('空文本 → 空数组', () => {
    expect(splitSpeakChunks('  ')).toEqual([]);
  });
});

describe('looksLikeTranslateReply（历史消息启发式）', () => {
  it('含【推荐译文】标记 → 命中', () => {
    expect(looksLikeTranslateReply('【推荐译文】Thank you.\n【语气要点】…')).toBe(true);
  });

  it('英文开头 + 中文说明 → 命中（翻译官典型形态）', () => {
    expect(looksLikeTranslateReply('Thank you. 更正式用 Thank you。')).toBe(true);
  });

  it('纯中文回复 → 不命中（普通 agent 回答）', () => {
    expect(looksLikeTranslateReply('这句话的意思是谢谢你。')).toBe(false);
  });

  it('纯英文 → 不命中（闲聊/代码形态，不做卡片）', () => {
    expect(looksLikeTranslateReply('Nice to meet you. Have a good day!')).toBe(false);
  });

  it('空串 → 不命中', () => {
    expect(looksLikeTranslateReply('')).toBe(false);
  });
});
