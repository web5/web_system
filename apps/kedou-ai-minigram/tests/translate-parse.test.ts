import {
  buildTranslateCardView,
  inferTranslateDirection,
  parseSections,
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
