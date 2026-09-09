import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeSearchService } from './search.service';
import { LlmChatService } from './llm.service';

/**
 * Ragas 三指标评测（D4.3 口径 → R3.2）。
 *
 * 口径：
 * - context_relevance  ：检索上下文与问题的相关性（judge 0~1）
 * - answer_relevance   ：生成的答案与问题的相关性（judge 0~1）
 * - faithfulness       ：答案中可由上下文支撑的断言占比（judge 拆断言 + 逐条判定）
 *
 * 用法：POST /knowledge/mcp/eval { collectionId, cases:[{question}] }，
 * 逐 case：检索 topK 上下文 → LLM(被测集合同 prompt 口径) 基于上下文作答 → judge 三指标。
 * 结果可纳入 Phase4 eval_cases 数据集继续做产品化评测。
 */
export interface EvalCaseResult {
  question: string;
  contextRelevance: number | null;
  answerRelevance: number | null;
  faithfulness: number | null;
  answer: string | null;
  error?: string;
}
export interface EvalReport {
  collectionId: string;
  caseCount: number;
  metrics: { contextRelevance: number | null; answerRelevance: number | null; faithfulness: number | null };
  cases: EvalCaseResult[];
}

@Injectable()
export class RagEvaluationService {
  private readonly logger = new Logger(RagEvaluationService.name);

  constructor(
    private readonly search: KnowledgeSearchService,
    private readonly llm: LlmChatService,
  ) {}

  async evaluate(collectionId: string, questions: string[], topK = 5): Promise<EvalReport> {
    const results: EvalCaseResult[] = [];
    for (const question of questions) {
      try {
        results.push(await this.evalCase(collectionId, question, topK));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`eval case 失败: ${msg}`);
        results.push({ question, contextRelevance: null, answerRelevance: null, faithfulness: null, answer: null, error: msg });
      }
    }
    const avg = (pick: (r: EvalCaseResult) => number | null): number | null => {
      const vals = results.map(pick).filter((v): v is number => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return {
      collectionId,
      caseCount: questions.length,
      metrics: {
        contextRelevance: avg((r) => r.contextRelevance),
        answerRelevance: avg((r) => r.answerRelevance),
        faithfulness: avg((r) => r.faithfulness),
      },
      cases: results,
    };
  }

  private async evalCase(collectionId: string, question: string, topK: number): Promise<EvalCaseResult> {
    // 1) 检索上下文（真实 knowledge-service 检索引擎，非存根）
    const hits = await this.search.search(collectionId, question, topK);
    const context = hits
      .map((h, i) => `[${i + 1}] ${h.content}\n(来源: ${h.docTitle})`)
      .join('\n\n');
    if (!context.trim()) {
      return { question, contextRelevance: 0, answerRelevance: null, faithfulness: null, answer: null };
    }

    // 2) 基于上下文生成答案
    const answer = await this.llm.chat(
      '你是知识问答助手，仅依据提供的上下文作答；若上下文不足以回答请明说。',
      `上下文:\n${context}\n\n问题: ${question}\n\n请给出简洁答案。`,
      500,
    );

    // 3) Ragas 三指标 judge
    const ctxScore = await this.judgeContextRelevance(question, context);
    const ansScore = await this.judgeAnswerRelevance(question, answer);
    const faithful = await this.judgeFaithfulness(answer, context);

    return { question, contextRelevance: ctxScore, answerRelevance: ansScore, faithfulness: faithful, answer };
  }

  private async judgeContextRelevance(question: string, context: string): Promise<number | null> {
    return this.scoreJson(
      '你是 RAG 检索评测员。判断「检索上下文」对回答该问题有多大帮助（相关性），不看是否充分。',
      `<问题>${question}</问题>\n\n<上下文>${context}\n\n输出 JSON {"score": 0~1 小数, "reason": "一句话说明"}`,
    );
  }

  private async judgeAnswerRelevance(question: string, answer: string): Promise<number | null> {
    return this.scoreJson(
      '你是 RAG 问答评测员。判断「答案」是否切题（与问题相关），不评判对错与是否充分。',
      `<问题>${question}</问题>\n\n<答案>${answer}</答案>\n\n输出 JSON {"score": 0~1 小数, "reason": "一句话说明"}`,
    );
  }

  /** faithfulness = 答案中可由上下文支撑的断言占比 */
  private async judgeFaithfulness(answer: string, context: string): Promise<number | null> {
    const system = '你是 RAG 忠实度评测员。把「答案」拆成可验证断言，逐条判断是否能由「上下文」支撑（或可由其合理推断）。';
    const user = `<答案>${answer}</答案>\n\n<上下文>${context}\n\n输出 JSON {"supported": <被支撑断言数>, "total": <总断言数>, "score": <supported/total>, "reason": "一句话"}`;
    try {
      const raw = await this.llm.chat(system, user, 800);
      const parsed = this.extractJson(raw);
      const supported = Number(parsed.supported);
      const total = Number(parsed.total);
      if (!Number.isFinite(total) || total <= 0) return null;
      return Math.min(Math.max(Number.isFinite(supported) ? supported / total : 0, 0), 1);
    } catch (e) {
      this.logger.warn(`faithfulness judge 失败: ${(e as Error).message}`);
      return null;
    }
  }

  private async scoreJson(system: string, user: string): Promise<number | null> {
    try {
      const raw = await this.llm.chat(system, user, 400);
      const parsed = this.extractJson(raw);
      const score = Number(parsed.score);
      if (!Number.isFinite(score)) return null;
      return Math.min(Math.max(score, 0), 1);
    } catch (e) {
      this.logger.warn(`judge 调用失败: ${(e as Error).message}`);
      return null;
    }
  }

  /** 提取响应中最后一个 JSON 对象（容错 markdown/文字包裹） */
  private extractJson(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error(`judge 响应无 JSON: ${raw.slice(0, 120)}`);
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
  }
}
