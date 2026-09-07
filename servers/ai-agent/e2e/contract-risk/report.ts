/**
 * 合同翻译官 E2E 评测 · 报告生成。
 *
 * 职责：把 EvalRoundResult 渲染为 Markdown，落盘到
 * .codebuddy/evals/reports/contract-risk/<YYYY-MM-DD>/<roundDir>.md。
 * 模板语义对齐 .codebuddy/evals/reports/TEMPLATE.md 的对比栏 + 回归判定。
 *
 * 使用红线安全写法：无 console / 无裸 any / 无占位标记字面。
 */

import { EvalRoundResult } from './types';

const PASS = 'PASS';
const FAIL = 'FAIL';

/** 渲染一轮评测为 Markdown 文本 */
export function renderReport(round: EvalRoundResult): string {
  const lines: string[] = [];
  lines.push(`# 合同翻译官 E2E 评测 · 轮次 ${round.roundDir}`);
  lines.push('');
  lines.push(`- 被测模型：${round.model}`);
  lines.push(`- 样本数：${round.runs.length}`);
  lines.push(`- 通过率：${(round.passRate * 100).toFixed(0)}%`);
  lines.push('');
  lines.push('| 样本 | scene | G1 字段 | G2 数值 | G3 红线 | G4 工具 | 通过 |');
  lines.push('|------|-------|---------|---------|---------|---------|------|');
  for (const r of round.runs) {
    lines.push(
      [
        `| ${r.sampleId}`,
        r.scene,
        everyPass(r.fieldChecks) ? PASS : FAIL,
        everyPass(r.numberChecks) ? PASS : FAIL,
        everyPass(r.redlineChecks) ? PASS : FAIL,
        everyPass(r.toolChecks) ? PASS : FAIL,
        r.passed ? '通过' : '不通过',
        '|',
      ].join(' | '),
    );
  }
  lines.push('');
  // 逐样本失败详情（error + final 预览，前 400 字，便于人工定位格式漂移/截断）
  const failed = round.runs.filter((r) => !r.passed);
  if (failed.length) {
    lines.push('## 失败样本详情');
    lines.push('');
    for (const r of failed) {
      lines.push(`### ${r.sampleId}`);
      lines.push('');
      if (r.error) lines.push(`- error：${r.error}`);
      const failedChecks = (
        group: string,
        checks: ReadonlyArray<{ name: string; detail?: string; pass: boolean }>,
      ) => {
        const bad = checks.filter((c) => !c.pass);
        return bad.length
          ? `- ${group} 失败项：${bad.map((c) => `${c.name}${c.detail ? `（${c.detail}）` : ''}`).join('；')}`
          : '';
      };
      const failLines = [
        failedChecks('G1', r.fieldChecks),
        failedChecks('G2', r.numberChecks),
        failedChecks('G3', r.redlineChecks),
        failedChecks('G4', r.toolChecks),
      ].filter((s) => s.length > 0);
      for (const fl of failLines) lines.push(fl);
      if (r.toolTrace.calls.length) lines.push(`- 工具链：${r.toolTrace.calls.join(' → ')}`);
      if (r.toolTrace.finalContent) {
        const preview = r.toolTrace.finalContent.replace(/\s+/g, ' ').trim();
        lines.push(`- final 预览：\`${preview.slice(0, 400)}${preview.length > 400 ? '…' : ''}\``);
      }
      lines.push('');
    }
  }
  lines.push(`- 字段全通过率：${(round.fieldPassRate * 100).toFixed(0)}%`);
  lines.push(`- 数值准通过率：${(round.numberPassRate * 100).toFixed(0)}%`);
  lines.push(`- 红线净通过率：${(round.redlinePassRate * 100).toFixed(0)}%`);
  lines.push(`- 总 token：${round.totalTokens}`);
  lines.push('');
  return lines.join('\n');
}

/** 汇总一次多轮结果（单轮则 rounds=1） */
export function aggregate(runs: EvalRoundResult['runs'], model: string, roundDir: string): EvalRoundResult {
  const passRate = runs.length ? runs.filter((r) => r.passed).length / runs.length : 0;
  const rate = (pred: (r: EvalRoundResult['runs'][number]) => boolean): number =>
    runs.length ? runs.filter(pred).length / runs.length : 0;
  return {
    roundDir,
    model,
    runs,
    passRate,
    fieldPassRate: rate((r) => everyPass(r.fieldChecks)),
    numberPassRate: rate((r) => everyPass(r.numberChecks)),
    redlinePassRate: rate((r) => everyPass(r.redlineChecks)),
    totalTokens: runs.reduce((s, r) => s + (r.costTokens ?? 0), 0),
  };
}

function everyPass(checks: ReadonlyArray<{ pass: boolean }>): boolean {
  return checks.every((c) => c.pass);
}
