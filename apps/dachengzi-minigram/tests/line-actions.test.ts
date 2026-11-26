/// <reference types="node" />
/**
 * utils/line-actions.ts 纯函数单测（零 wx / 零 services 依赖，可直接 require）
 *
 * 为什么单独测这一层：动作集合与 toast 文案是「详情页 / 首页 / 将来的听力页」三处共用、
 * 且最容易各自漂移的两项（方案 §1 R5/R6：同一份三元表达式已经写过两遍）。
 * 把这层钉死，页面迁移就只剩「组装 payload」这一件真正与页面有关的事。
 */
import { EVT, actionsOf, collectToastText } from '../utils/line-actions';

describe('EVT 事件常量（wxml 只能写字面量，值必须逐字稳定）', () => {
  it('5 个事件名与设计契约完全一致', () => {
    expect(EVT.SPEAK_LINE).toBe('speak-line');
    expect(EVT.SPEAK_WORD).toBe('speak-word');
    expect(EVT.COLLECT_LINE).toBe('collect-line');
    expect(EVT.COLLECT_WORD).toBe('collect-word');
    expect(EVT.CLOSE).toBe('close');
    expect(Object.keys(EVT)).toHaveLength(5);
  });
});

describe('actionsOf：句档 2 项 / 词档 4 项，顺序固定', () => {
  it('句档 = 朗读此句 / 收藏此句（恰为四项的前两项 → 换档不挪位，AC-B.6 / V-B6）', () => {
    const line = actionsOf('line');
    expect(line.map((a) => a.label)).toEqual(['朗读此句', '收藏此句']);
    expect(line.map((a) => a.evt)).toEqual([EVT.SPEAK_LINE, EVT.COLLECT_LINE]);
    expect(actionsOf('word').slice(0, 2)).toEqual(line);
  });

  it('词档 = 朗读此句 / 收藏此句 / 朗读单词 / 收藏单词（2×2 行优先：行=对象，列=动词）', () => {
    const word = actionsOf('word');
    expect(word).toHaveLength(4);
    expect(word.map((a) => a.label)).toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);
    expect(word.map((a) => a.evt)).toEqual([
      EVT.SPEAK_LINE, EVT.COLLECT_LINE, EVT.SPEAK_WORD, EVT.COLLECT_WORD,
    ]);
  });

  it('key 与 evt 同值（组件 data-key 直接分流，不需要二次映射）', () => {
    for (const a of actionsOf('word')) expect(a.key).toBe(a.evt);
  });

  it('返回新数组 + 元素被冻结：调用方改不动公共常量', () => {
    const a = actionsOf('word');
    a.pop();
    expect(actionsOf('word')).toHaveLength(4);   // 数组是副本
    // 元素本身 Object.freeze → 严格模式下赋值抛错（不会静默污染别处渲染）
    expect(() => {
      (a[0] as { label: string }).label = '被改了';
    }).toThrow(TypeError);
    expect(actionsOf('line')[0].label).toBe('朗读此句');
  });

  it('签名不接受 hasDef —— 普通词与生词的动作集合不可能不同（口径 §5.9-8 防回归）', () => {
    // actionsOf.length 固定 1：若有人加第二个参数做 hasDef 分流，这条会红
    expect(actionsOf.length).toBe(1);
    expect(actionsOf('word')).toHaveLength(4);
  });
});

describe('collectToastText：幂等语义的文案（对齐迁移前 detail.ts 既有文案）', () => {
  it('句：已收藏 / 已在收藏中', () => {
    expect(collectToastText('line', false)).toBe('已收藏');
    expect(collectToastText('line', true)).toBe('已在收藏中');
  });

  it('词：已收藏 / 已在生词本', () => {
    expect(collectToastText('word', false)).toBe('已收藏');
    expect(collectToastText('word', true)).toBe('已在生词本');
  });
});
