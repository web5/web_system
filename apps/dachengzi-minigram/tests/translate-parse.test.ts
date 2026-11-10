import {
  buildTranslateCardView,
  buildTranslateInput,
  buildTranslateMeta,
  inferTranslateDirection,
  looksLikeTranslateReply,
  parseSections,
  parseTranslateInput,
  parseTranslateTaskText,
  splitSpeakParts,
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

describe('splitSpeakParts（流式朗读切块）', () => {
  it('多句文本：首句单独成块（最快出声），其余整段作为一块（服务端一次合成）', () => {
    const parts = splitSpeakParts('Thank you very much. It is my pleasure to help you today.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('Thank you very much.');
    // 拼回原文（空格归一后）
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(
      'Thank you very much. It is my pleasure to help you today.',
    );
  });

  it('单句短文本 → 一块', () => {
    expect(splitSpeakParts('Thank you.')).toEqual(['Thank you.']);
  });

  it('超长无句读文本：首块在空格处截（不切碎单词），剩余整段交给服务端', () => {
    const long = 'word '.repeat(60).trim(); // 299 字符无句读
    const parts = splitSpeakParts(long);
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeLessThanOrEqual(110);
    expect(parts[0].startsWith('word')).toBe(true);
    expect(parts[0].endsWith('word')).toBe(true); // 不出现半个单词
    expect(parts[1].length).toBeGreaterThan(0);
    expect(`${parts[0]} ${parts[1]}`).toBe(long);
  });

  it('空文本 → 空数组', () => {
    expect(splitSpeakParts('  ')).toEqual([]);
  });
});

describe('buildTranslateCardView · detail 三段明细', () => {
  it('命中段落标题：detail 切出直译对照/委婉版/语气要点，缺段不返回该字段', () => {
    const v = buildTranslateCardView(
      '【推荐译文】Thank you.\n【直译对照】谢谢\n【语气要点】更正式',
    );
    expect(v.detail.literal).toBe('谢谢');
    expect(v.detail.notes).toBe('更正式');
    expect(v.detail.polite).toBeUndefined();
  });

  it('无段落标题：detail 为空对象（启发式路径不产明细）', () => {
    const v = buildTranslateCardView('Thank you. 更正式用 Thank you。');
    expect(v.detail).toEqual({});
  });
});

describe('buildTranslateInput / buildTranslateMeta（首问入参构造）', () => {
  it('结构化入参按契约拼接五段', () => {
    const input = buildTranslateInput('中文', '英语', '正式', '完整', '这个报价再商量');
    expect(input).toBe('【源语言】中文\n【目标语言】英语\n【语气】正式\n【风格】完整\n【原文】这个报价再商量');
  });

  it('meta 拼接方向 + 语气风格', () => {
    expect(buildTranslateMeta('中文', '英语', '正式', '完整')).toBe('中文 → 英语 · 正式 · 完整');
  });

  it('缺段自动省略（缺目标语言时不硬拼箭头）', () => {
    expect(buildTranslateMeta('中文', '', '正式', '')).toBe('中文 · 正式');
  });
});

describe('parseTranslateInput / parseTranslateTaskText（历史 user 消息还原）', () => {
  const structured = '【源语言】中文\n【目标语言】英语\n【语气】正式\n【风格】完整\n【原文】这个报价再商量';

  it('结构化文本还原出原文 + meta', () => {
    expect(parseTranslateTaskText(structured)).toEqual({
      text: '这个报价再商量',
      meta: '中文 → 英语 · 正式 · 完整',
    });
  });

  it('parseTranslateInput 返回五个字段', () => {
    expect(parseTranslateInput(structured)).toEqual({
      srcLang: '中文',
      tgtLang: '英语',
      register: '正式',
      style: '完整',
      text: '这个报价再商量',
    });
  });

  it('普通追问（无【原文】）→ 原样返回、meta 空', () => {
    expect(parseTranslateTaskText('再把这句话翻得口语化一点')).toEqual({
      text: '再把这句话翻得口语化一点',
      meta: '',
    });
    expect(parseTranslateInput('再把这句话翻得口语化一点')).toBeNull();
  });

  it('【原文】为空 → null / 原样返回', () => {
    expect(parseTranslateInput('【源语言】中文\n【原文】  ')).toBeNull();
    expect(parseTranslateTaskText('【源语言】中文\n【原文】  ')).toEqual({
      text: '【源语言】中文\n【原文】  ',
      meta: '',
    });
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
