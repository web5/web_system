/**
 * 语言判定——翻译流程的「要不要翻」这道闸。
 *
 * 这里钉的是**真实出现过的标题样本**，不是构造出来的边界值：
 * 判错的代价不对称——把英文判成中文 = 漏翻（用户可见的 bug）；
 * 把中文判成英文 = 多花一次调用（钱，但用户无感）。
 * 所以阈值宁低勿高，0.2 就是按这个原则定的。
 */
import { countCjk, detectLang, looksChinese } from './lang';

describe('countCjk', () => {
  it('只数汉字，不数全角标点', () => {
    expect(countCjk('你好，世界')).toBe(4);
    expect(countCjk('你好，世界！')).toBe(4);
    expect(countCjk('hello world')).toBe(0);
    expect(countCjk('')).toBe(0);
  });
});

describe('looksChinese', () => {
  it('纯英文标题判为非中文（这是翻译流程要抓的那种）', () => {
    expect(looksChinese("Torvalds: AI is fine for competent devs, but spare us the 'drive-by'")).toBe(false);
    expect(looksChinese('In the biotech world, you can\'t see everything')).toBe(false);
  });

  it('纯中文标题判为中文', () => {
    expect(looksChinese('百度世界2026前瞻')).toBe(true);
    expect(looksChinese('中国船舶三季度业绩超预期')).toBe(true);
  });

  it('中英混排按占比判，不按「含不含中文」判', () => {
    // 中文为主夹英文术语 —— 不该翻
    expect(looksChinese('iPhone 17 发布，售价上调')).toBe(true);
    expect(looksChinese('AI 时代，谁来定义个人空间')).toBe(true);
    // 英文为主夹中文词 —— 该翻（含中文≠是中文，这是阈值存在的理由）
    expect(looksChinese('Anthropic 发布 Claude 3')).toBe(false);
  });

  it('空串按中文处理：没有内容就不该触发翻译调用', () => {
    expect(looksChinese('')).toBe(true);
    expect(looksChinese('   ')).toBe(true);
  });

  it('可以按需调阈值', () => {
    const title = 'Anthropic 发布 Claude 3'; // CJK 占比 2/18 ≈ 0.11
    expect(looksChinese(title, 0.08)).toBe(true);
    expect(looksChinese(title, 0.3)).toBe(false);
  });
});

describe('detectLang', () => {
  it('中文 → zh', () => {
    expect(detectLang('百度世界2026前瞻')).toBe('zh');
  });

  it('拉丁字母为主 → en', () => {
    expect(detectLang('Torvalds: AI is fine for competent devs')).toBe('en');
  });

  it('韩文这类既非中文也非英文 → other（不臆造语种）', () => {
    expect(detectLang('한국어 제목입니다')).toBe('other');
    expect(detectLang('')).toBe('other');
  });

  it('纯数字标题不硬判成中文', () => {
    expect(detectLang('2026-10-26')).toBe('other');
  });
});
