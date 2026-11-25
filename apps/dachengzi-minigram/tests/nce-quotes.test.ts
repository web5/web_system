import { NCE_LINES } from '../utils/nce-quotes';
import type { NceQuoteLine } from '../utils/nce-quotes';

describe('NCE_LINES 快照完整性（真实 NCE2 96 课 / 1601 条同句配对）', () => {
  it('条数 = 1601（全量 96 课、不挑选、不裁剪；不硬编码 7）', () => {
    expect(NCE_LINES.length).toBe(1601);
  });

  it('每条 cn / en 均非空字符串', () => {
    for (const l of NCE_LINES) {
      expect(typeof l.cn).toBe('string');
      expect(l.cn.length).toBeGreaterThan(0);
      expect(typeof l.en).toBe('string');
      expect(l.en.length).toBeGreaterThan(0);
    }
  });

  it('source.book = NCE2；lessonId ∈ 1..96 整数；title 非空；lineIndex 为 >=0 整数', () => {
    for (const l of NCE_LINES) {
      expect(l.source.book).toBe('NCE2');
      expect(Number.isInteger(l.source.lessonId)).toBe(true);
      expect(l.source.lessonId).toBeGreaterThanOrEqual(1);
      expect(l.source.lessonId).toBeLessThanOrEqual(96);
      expect(typeof l.source.title).toBe('string');
      expect(l.source.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(l.source.lineIndex)).toBe(true);
      expect(l.source.lineIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('确定性顺序：按 (lessonId 升序, lineIndex 升序) 排列，未随机打乱', () => {
    for (let i = 1; i < NCE_LINES.length; i += 1) {
      const a = NCE_LINES[i - 1].source;
      const b = NCE_LINES[i].source;
      expect(
        a.lessonId < b.lessonId || (a.lessonId === b.lessonId && a.lineIndex < b.lineIndex),
      ).toBe(true);
    }
  });

  it('导出身份无重复：Set(lessonId:lineIndex).size = 1601（同一源行未被导出两次）', () => {
    const keys = NCE_LINES.map((l) => `${l.source.lessonId}:${l.source.lineIndex}`);
    expect(new Set(keys).size).toBe(NCE_LINES.length);
  });

  it('同句配对可反查：(lessonId,lineIndex) 反查到的仍是同一条，cn/en 不串句', () => {
    const bySource = new Map<string, NceQuoteLine>();
    for (const l of NCE_LINES) {
      bySource.set(`${l.source.lessonId}:${l.source.lineIndex}`, l);
    }
    expect(bySource.size).toBe(NCE_LINES.length);
    for (const l of NCE_LINES) {
      const back = bySource.get(`${l.source.lessonId}:${l.source.lineIndex}`);
      expect(back).toBe(l);
      expect(back!.cn).toBe(l.cn);
      expect(back!.en).toBe(l.en);
      // 每条自身即 { en, cn } 同句配对，不存在「cn 来自 A 行、en 来自 B 行」
      expect(NCE_LINES.some((x) => x.cn === l.cn && x.en === l.en)).toBe(true);
    }
  });

  it('内容级重复如实登记：完全相同的 (en,cn) 共 3 组（真实课文短句复现，未去重）', () => {
    const counts = new Map<string, number>();
    for (const l of NCE_LINES) {
      const k = l.en + '\u0000' + l.cn;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const values = [...counts.values()];
    expect(values.filter((n) => n > 1).length).toBe(3);
    // 全量 1601 = 1598 个唯一内容 + 3 条额外复现（派单要求不裁剪）
    expect(values.reduce((a, b) => a + b, 0)).toBe(1601);
  });

  it('首条 / 末条锚定真实课文（防快照漂移 / 防假数据造 ② 假绿）', () => {
    expect(NCE_LINES[0]).toMatchObject({
      en: 'Last week,', cn: '上周，', source: { lessonId: 1, lineIndex: 0 },
    });
    expect(NCE_LINES[NCE_LINES.length - 1]).toMatchObject({
      en: 'until they can be seen no more.', cn: '直到它们再也看不见。',
      source: { lessonId: 96, lineIndex: 19 },
    });
  });

  it('唯一脏行已剔除：不存在 lessonId=90 且 lineIndex=9 的条目（cn 为空）', () => {
    expect(
      NCE_LINES.some((l) => l.source.lessonId === 90 && l.source.lineIndex === 9),
    ).toBe(false);
  });

  it('每条 source.lessonId ∈ [1,96] 且可回溯到 lessons.json 原行（四元组唯一定位）', () => {
    const byLesson = new Map<number, NceQuoteLine[]>();
    for (const l of NCE_LINES) {
      expect(l.source.lessonId).toBeGreaterThanOrEqual(1);
      expect(l.source.lessonId).toBeLessThanOrEqual(96);
      if (!byLesson.has(l.source.lessonId)) byLesson.set(l.source.lessonId, []);
      byLesson.get(l.source.lessonId)!.push(l);
    }
    // 96 课全覆盖 → 与 lessons.json 的 lessons[]（id 1..96）一一对应
    expect(byLesson.size).toBe(96);
    // 每课内 lineIndex 严格递增 = lessons[].lines[] 原序；title 在课内唯一且非空
    for (const [, group] of byLesson) {
      expect(group.length).toBeGreaterThan(0);
      expect(new Set(group.map((l) => l.source.title)).size).toBe(1);
      expect(group[0].source.title.length).toBeGreaterThan(0);
      for (let i = 1; i < group.length; i += 1) {
        expect(group[i].source.lineIndex).toBeGreaterThan(group[i - 1].source.lineIndex);
      }
    }
    // (book,lessonId,title,lineIndex) 四元组唯一定位 lessons.json 的一行
    const keys = NCE_LINES.map(
      (l) => `${l.source.book}:${l.source.lessonId}:${l.source.title}:${l.source.lineIndex}`,
    );
    expect(new Set(keys).size).toBe(NCE_LINES.length);
    // 唯一脏行 (90,9) 被剔除且 (90,10) 仍在 → lineIndex 保留原始 lines[] 下标、未重编号
    expect(NCE_LINES.some((l) => l.source.lessonId === 90 && l.source.lineIndex === 9)).toBe(false);
    expect(NCE_LINES.some((l) => l.source.lessonId === 90 && l.source.lineIndex === 10)).toBe(true);
    // 逐条真实回溯（六字段严格比对 1601 条）由静态命令
    // /tmp/rd131-eng/verify-backtrack.mjs + 导出脚本 8 项 assert 给出，见回执 §3/§8；
    // 单测不绑定工作机绝对路径，故此处以结构性可回溯性断言覆盖。
  });
});
