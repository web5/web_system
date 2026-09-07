import { parseContractReport } from './contract-report.parser';

const REPORT_JSON =
  '{"scene":"消费贷款","conclusion":"结论一句话","signals":[{"id":"usury","name":"利率","level":"danger","plainText":"年化偏高"}],"rights":[],"disclaimer":"不构成建议"}';

describe('parseContractReport', () => {
  it('整体 JSON 报告 → 解析成功', () => {
    const r = parseContractReport(REPORT_JSON);
    expect(r).not.toBeNull();
    expect(r!.scene).toBe('消费贷款');
    expect(r!.signals).toHaveLength(1);
  });

  it('```json 代码块包裹 → 解析成功', () => {
    const r = parseContractReport(`分析结果如下：\n\`\`\`json\n${REPORT_JSON}\n\`\`\`\n以上。`);
    expect(r).not.toBeNull();
    expect(r!.scene).toBe('消费贷款');
  });

  it('思考文本 + 无代码块的裸 JSON 混杂 → 扫描最右完整对象成功', () => {
    const content = `基于条款，我的判断是：\n${REPORT_JSON}\n这就是最终报告。`;
    const r = parseContractReport(content);
    expect(r).not.toBeNull();
    expect(r!.signals).toHaveLength(1);
  });

  it('LLM 截断输出（结构可截断为合法 JSON）→ 容错解析', () => {
    const r = parseContractReport(
      '{"scene":"租房","conclusion":"判断已给出","signals":[],"keyNumbers":[{"label":"押金"}]}',
    );
    expect(r).not.toBeNull();
    expect(r!.scene).toBe('租房');
  });

  it('普通追问回答文本 → null（不覆盖快照）', () => {
    expect(parseContractReport('违约金一般是合同金额的 3%，建议与对方协商处理。')).toBeNull();
  });

  it('无 scene 且无 signals 的 JSON（普通结构化回答）→ null', () => {
    expect(parseContractReport('{"answer":"可以主张违约金"}')).toBeNull();
  });

  it('空串 / null / 纯 markdown → null', () => {
    expect(parseContractReport('')).toBeNull();
    expect(parseContractReport('   ')).toBeNull();
    expect(parseContractReport('# 标题\n正文')).toBeNull();
  });

  it('残缺不可解析 JSON → null', () => {
    expect(parseContractReport('{"scene":"消费贷款","signals":[]')).toBeNull();
  });
});
