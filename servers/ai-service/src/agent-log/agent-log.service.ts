import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, Like, MoreThanOrEqual, LessThanOrEqual, Between } from 'typeorm';
import { AgentRun } from './entities/agent-run.entity';
import { RunMetrics } from './entities/run-metrics.entity';
import { DictPricingProvider } from './dict-pricing.provider';

export interface RecordRunInput {
  agentId: string;
  agentName?: string | null;
  userId: string;
  conversationId?: string | null;
  userInput: string;
  systemPrompt: string;
  tools?: string[] | null;
  model?: string | null;
  steps: Array<{
    type: string;
    name?: string;
    content?: string;
    args?: unknown;
    step?: number;
    ts: number;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  }>;
  finalAnswer?: string | null;
  error?: string | null;
  status: 'ok' | 'error';
  durationMs?: number | null;
  source?: string;
  /** Agent 定义版本快照（Phase2.3；ai-agent 推送时填充） */
  agentVersion?: number | null;
}

/** Agent 运行记录查询参数（admin 列表用） */
export interface ListRunsQuery {
  agentId?: string;
  userId?: string;
  status?: 'ok' | 'error';
  conversationId?: string;
  keyword?: string;
  startAt?: Date;
  endAt?: Date;
  page?: number;
  pageSize?: number;
}

/**
 * Agent 运行记录服务（admin debug 用）
 *
 * 职责：
 *  - recordRun：写入一次 run 记录（由 controller / 内部 HTTP 调用）
 *  - listRuns：分页查询（按 agentId/userId/状态/关键字/时间过滤）
 *  - getRun：详情（包含完整 steps JSON）
 *  - getAgents：聚合"agentId → 最近一次 run / 总数"用于左侧列表
 */
@Injectable()
export class AgentLogService {
  private readonly logger = new Logger(AgentLogService.name);

  constructor(
    @InjectRepository(AgentRun)
    private readonly repo: Repository<AgentRun>,
    @InjectRepository(RunMetrics)
    private readonly metricsRepo: Repository<RunMetrics>,
    private readonly dictPricing: DictPricingProvider,
  ) {}

  /** 写入一次 run（失败不抛错，run 记录是辅助功能，不能影响主链路） */
  async recordRun(input: RecordRunInput): Promise<AgentRun | null> {
    try {
      // Phase2.3/2.4：从 steps 提取 usage、按单价核算成本，并同步增量日指标
      const usage = this.extractUsage(input.steps);
      const cost = this.computeCost(input.model ?? '', usage.prompt, usage.completion);
      const row = this.repo.create({
        agentId: input.agentId,
        agentName: input.agentName ?? null,
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        userInput: input.userInput,
        systemPrompt: input.systemPrompt,
        tools: input.tools ?? null,
        model: input.model ?? null,
        steps: input.steps,
        finalAnswer: input.finalAnswer ?? null,
        error: input.error ?? null,
        status: input.status,
        durationMs: input.durationMs ?? null,
        source: input.source ?? 'ai-service',
        agentVersion: input.agentVersion ?? null,
        promptTokens: usage.prompt || null,
        completionTokens: usage.completion || null,
        totalTokens: usage.total || null,
        cost: cost.toFixed(6),
      });
      const saved = await this.repo.save(row);
      await this.upsertDailyMetric(saved);
      return saved;
    } catch (err) {
      this.logger.error(`记录 agent run 失败: ${(err as Error).message}`);
      return null;
    }
  }

  /** 列表（分页，按创建时间倒序） */
  async listRuns(query: ListRunsQuery) {
    const where: FindOptionsWhere<AgentRun> = {};
    if (query.agentId) where.agentId = query.agentId;
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.conversationId) where.conversationId = query.conversationId;
    if (query.startAt) where.createdAt = MoreThanOrEqual(query.startAt);
    if (query.endAt) {
      // 终止日期包含当天 → +1 day 的 0 点（避免漏掉当天的记录）
      const end = new Date(query.endAt);
      end.setHours(23, 59, 59, 999);
      where.createdAt = LessThanOrEqual(end);
    }
    // 关键字查 userInput / finalAnswer（LIKE 搜索）
    if (query.keyword) {
      where.userInput = Like(`%${query.keyword}%`);
    }

    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: items.map((r) => this.toListItem(r)),
      total,
      page,
      pageSize,
    };
  }

  /** 详情（返回完整 raw 数据，含 steps、prompt 等） */
  async getRun(id: string): Promise<AgentRun | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * 聚合 agent 列表：每个 agentId 的最近一次 run + 总数
   * 用于 admin "Agents" 侧栏
   */
  async getAgents() {
    const rows = await this.repo
      .createQueryBuilder('r')
      .select('r.agent_id', 'agentId')
      .addSelect('MAX(r.agent_name)', 'agentName')
      .addSelect('COUNT(*)', 'total')
      .addSelect('MAX(r.created_at)', 'lastRunAt')
      .addSelect('SUM(CASE WHEN r.status = "error" THEN 1 ELSE 0 END)', 'errorCount')
      .groupBy('r.agent_id')
      .orderBy('lastRunAt', 'DESC')
      .getRawMany<{
        agentId: string;
        agentName: string | null;
        total: string;
        lastRunAt: Date;
        errorCount: string;
      }>();

    return rows.map((r) => ({
      agentId: r.agentId,
      agentName: r.agentName,
      total: Number(r.total),
      errorCount: Number(r.errorCount),
      lastRunAt: r.lastRunAt,
    }));
  }

  /** 列表展示用：把原始行转成不包含超大字段的精简对象 */
  private toListItem(r: AgentRun) {
    return {
      id: r.id,
      agentId: r.agentId,
      agentName: r.agentName,
      userId: r.userId,
      conversationId: r.conversationId,
      status: r.status,
      error: r.error,
      durationMs: r.durationMs,
      model: r.model,
      // userInput / finalAnswer 在列表里只截前 200 字符预览，详情里取完整
      userInputPreview: (r.userInput || '').slice(0, 200),
      finalAnswerPreview: r.finalAnswer ? r.finalAnswer.slice(0, 200) : null,
      stepCount: r.steps?.length ?? 0,
      source: r.source,
      createdAt: r.createdAt,
    };
  }

  // ── Phase2.4：成本核算 + 每日指标聚合 ──

  /** 从 steps 提取最后出现的 usage（final/summary/error 事件携带，Phase1.6 起随步骤落库） */
  private extractUsage(
    steps: Array<{
      usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    }>,
  ): { prompt: number; completion: number; total: number } {
    let prompt = 0;
    let completion = 0;
    let total = 0;
    for (const s of steps) {
      if (!s.usage) continue;
      prompt = s.usage.promptTokens ?? prompt;
      completion = s.usage.completionTokens ?? completion;
      total = s.usage.totalTokens ?? total;
    }
    return { prompt, completion, total };
  }

  /**
   * 按字典 `llm_models` 维护的单价核算成本（CNY；未定价按 0，不发明数值）。
   * 单价由 DictPricingProvider 定时同步进内存，这里只做一次 Map 查询（热路径不做 HTTP）。
   */
  private computeCost(model: string, prompt: number, completion: number): number {
    const price = this.dictPricing.getPrice(model);
    if (!price) return 0;
    return (prompt * price.inPrice + completion * price.outPrice) / 1000;
  }

  /** 增量聚合当日指标（agentId+model+source+date 行；run 记录即更新，供观测台趋势） */
  private async upsertDailyMetric(run: AgentRun): Promise<void> {
    try {
      const date = new Date().toISOString().slice(0, 10);
      const key = {
        agentId: run.agentId,
        model: run.model ?? 'unknown',
        source: run.source ?? 'ai-service',
        date,
      };
      const found = await this.metricsRepo.findOne({ where: key });
      const inc = {
        runCount: (found?.runCount ?? 0) + 1,
        okCount: (found?.okCount ?? 0) + (run.status === 'ok' ? 1 : 0),
        errorCount: (found?.errorCount ?? 0) + (run.status === 'error' ? 1 : 0),
        totalTokens: String(Number(found?.totalTokens ?? 0) + (run.totalTokens ?? 0)),
        totalCost: (Number(found?.totalCost ?? 0) + Number(run.cost ?? 0)).toFixed(6),
        totalDurationMs: (found?.totalDurationMs ?? 0) + (run.durationMs ?? 0),
      };
      if (found) {
        await this.metricsRepo.update(found.id, inc);
      } else {
        await this.metricsRepo.save(this.metricsRepo.create({ ...key, ...inc } as Partial<RunMetrics>));
      }
    } catch (err) {
      this.logger.warn(`更新 run_metrics 失败: ${(err as Error).message}`);
    }
  }

  /** 查询日指标（观测台数据源） */
  async listMetrics(q: { agentId?: string; startDate?: string; endDate?: string }): Promise<RunMetrics[]> {
    const where: FindOptionsWhere<RunMetrics> = {};
    if (q.agentId) where.agentId = q.agentId;
    if (q.startDate || q.endDate) {
      where.date = Between(q.startDate ?? '1970-01-01', q.endDate ?? '2999-12-31') as never;
    }
    return this.metricsRepo.find({ where, order: { date: 'ASC' } });
  }
}
