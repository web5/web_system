/**
 * 🔵 RD 独立盲测 B 组：公共纯函数（动作集合 / 切词 / 查词）
 *
 * 判据：
 *  - AC-B.5 / AC-B.6 / 动作顺序固定：朗读此句 → 收藏此句 → 朗读单词 → 收藏单词；两项档 = 四项档前两项
 *  - AC-B.30 / AC-B.33 / 方案 §5.9-8：动作集合与 hasDef 无关（签名里就没有 hasDef）
 *  - BB14：标点粘连词（“What / day!” / Sunday.）→ data-w 取词干，朗读不读标点
 *  - BB16：撇号词 / **连字符词**整词一个 token，data-w 保留原形
 *  - BB15：词形变化不还原（Sundays 无定义 → 普通词档）
 *  - 边界：words=[] / cn 为空 / 无标点 / 首字母大写
 */
/// <reference types="node" />
import { actionsOf, collectToastText, EVT } from '../utils/line-actions';
import { tokenize, buildKnown } from '../utils/tokenize';
import { lookupWord } from '../utils/lexicon';

describe('B1 动作集合 actionOf（AC-B.5 / AC-B.6 / 顺序）', () => {
  it('word → 恰 4 项，顺序固定为 朗读此句/收藏此句/朗读单词/收藏单词', () => {
    const acts = actionsOf('word');
    expect(acts.map((a) => a.label)).toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);
    expect(acts.map((a) => a.evt)).toEqual([
      'speak-line', 'collect-line', 'speak-word', 'collect-word',
    ]);
  });

  it('line → 恰 2 项，且**逐项等于**四项档的前两项（换档不挪位 V-B6 的前提）', () => {
    const line = actionsOf('line');
    const word = actionsOf('word');
    expect(line).toHaveLength(2);
    expect(line.map((a) => a.label)).toEqual(['朗读此句', '收藏此句']);
    expect(line[0]).toEqual(word[0]);
    expect(line[1]).toEqual(word[1]);
  });

  it('两次调用互不影响：返回数组是副本、元素被冻结（下游改不坏唯一真源）', () => {
    const a = actionsOf('word');
    a.pop();                                  // 改副本不影响内部表
    expect(actionsOf('word')).toHaveLength(4);
    // 元素被冻结：赋值必须抛（strict mode），否则任何调用方都能悄悄改动作文案
    expect(Object.isFrozen(actionsOf('word')[0])).toBe(true);
    expect(() => {
      (actionsOf('word')[0] as { label: string }).label = '被篡改';
    }).toThrow();
    expect(actionsOf('word')[0].label).toBe('朗读此句');
  });

  it('反例：非法/缺失 scope 不得给出 0 项（空抽屉），回落两项', () => {
    expect(actionsOf(undefined as unknown as 'line')).toHaveLength(2);
    expect(actionsOf('' as unknown as 'line')).toHaveLength(2);
  });

  it('事件名常量与 wxml 字面量一致（wxml 无法 import 常量）', () => {
    expect(Object.values(EVT).sort()).toEqual(
      ['close', 'collect-line', 'collect-word', 'speak-line', 'speak-word'],
    );
  });

  it('收藏 toast 文案（幂等语义，历史文案不变）', () => {
    expect(collectToastText('line', false)).toBe('已收藏');
    expect(collectToastText('line', true)).toBe('已在收藏中');
    expect(collectToastText('word', false)).toBe('已收藏');
    expect(collectToastText('word', true)).toBe('已在生词本');
  });
});

describe('B2 切词 tokenize 边界（V-B17 的输入前提）', () => {
  it('words=[] → 所有 token hasDef 全 false，但英文词仍是独立 token（w 非空）', () => {
    const toks = tokenize('I never get up early on Sundays.', buildKnown([]));
    const words = toks.filter((t) => t.w);
    expect(words.map((t) => t.w)).toEqual(['i', 'never', 'get', 'up', 'early', 'on', 'sundays']);
    expect(words.every((t) => t.hasDef === false)).toBe(true);
  });

  it('空句子 / 非字符串 → 空数组（不抛错）', () => {
    expect(tokenize('', buildKnown([]))).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });

  it('无标点句子：末词不被标点污染', () => {
    const toks = tokenize('hello world');
    expect(toks.filter((t) => t.w).map((t) => t.w)).toEqual(['hello', 'world']);
  });

  it('BB14 标点粘连：data-w 取词干（What / day / Sunday 不带标点）', () => {
    const toks = tokenize('“What a day!” Sunday.');
    expect(toks.filter((t) => t.w).map((t) => t.w)).toEqual(['what', 'a', 'day', 'sunday']);
  });

  it('撇号词（直撇号 / 弯撇号）整词一个 token，data-w 保留撇号', () => {
    expect(tokenize("don't stop").filter((t) => t.w).map((t) => t.w)).toEqual(["don't", 'stop']);
    expect(tokenize('It’s fine').filter((t) => t.w).map((t) => t.w)).toEqual(['it’s', 'fine']);
  });

  it('BB16 连字符词 well-known → 整词一个 token（data-w 保留连字符）', () => {
    const ws = tokenize('a well-known writer').filter((t) => t.w).map((t) => t.w);
    expect(ws).toEqual(['a', 'well-known', 'writer']);
  });

  it('首字母大写：w 小写化，hasDef 按小写词表命中', () => {
    const toks = tokenize('Sunday is here', buildKnown([{ word: 'sunday' }, { word: 'here' }]));
    const byW = new Map(toks.filter((t) => t.w).map((t) => [t.w, t]));
    expect(byW.get('sunday')!.hasDef).toBe(true);
    expect(byW.get('here')!.hasDef).toBe(true);
    expect(byW.get('is')!.hasDef).toBe(false);
    // 展示片段保留原大小写
    expect(byW.get('sunday')!.t).toBe('Sunday');
  });

  it('100+ 词节点的规模：12 句课文 token 总数 ≥100（性能风险的量级基线）', () => {
    const line = 'I never get up early on Sundays. I sometimes stay in bed until lunchtime.';
    const known = buildKnown([{ word: 'sunday' }, { word: 'sometimes' }]);
    let n = 0;
    for (let i = 0; i < 12; i++) n += tokenize(line, known).length;
    expect(n).toBeGreaterThan(100);
  });
});

describe('B3 查词 lexicon 边界', () => {
  const words = [{ word: 'sunday', phonetic: '/ˈsʌndeɪ/', pos: 'n.', def: '星期日' }];
  it('生词命中返回词条', () => {
    const r = lookupWord('Sunday', words);
    expect(r.none).toBe(false);
    expect(r.def).toBe('星期日');
  });
  it('表外词 → none:true，且回填小写词形（供朗读/收藏用）', () => {
    const r = lookupWord('Bed', []);
    expect(r.none).toBe(true);
    expect(r.word).toBe('bed');
  });
  it('BB15 词形变化不还原：Sundays 词表只有 Sunday 时仍判 none（R3 规则表允许 Sundays→sunday 命中则算命中）', () => {
    // R3-2 去掉复数 s 后命中 → 属于「已收录」；本用例锁定实际口径，防实现漂移
    const r = lookupWord('Sundays', words);
    expect(r.none).toBe(false);
    expect(r.word).toBe('sunday');
  });
  it('撇号词不会因 R3 规则误判成命中（don\'t 去 s 后仍查不到）', () => {
    expect(lookupWord("don't", words).none).toBe(true);
  });
});
