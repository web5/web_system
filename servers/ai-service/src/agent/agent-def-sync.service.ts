import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentRegistry, AgentDefinition, ThinkingOption } from '@kedouai/agent-core';

/**
 * Agent 定义同步器（一期，ai-service 自身）
 *
 * 从本服务 `GET /internal/agent-definitions` 拉取 published 且 enabled 的定义，
 * 转成 AgentDefinition 后 `AgentRegistry.upsert()` 覆盖本地注册表。
 *
 * 生命周期由宿主 AgentModule 控制：先注册代码内置定义（upsert 兜底），再调用
 * `start()` 做首次同步 + 定时轮询，保证 DB 定义优先于代码定义。
 */
@Injectable()
export class AgentDefSyncService {
  private readonly logger = new Logger(AgentDefSyncService.name);
  private readonly endpoint: string;
  private readonly pollMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private started = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly agentRegistry: AgentRegistry,
  ) {
    const base = this.configService.get<string>('AI_SERVICE_URL', 'http://localhost:6003');
    this.endpoint = `${base.replace(/\/$/, '')}/internal/agent-definitions`;
    this.pollMs = Number(this.configService.get('AGENT_DEF_POLL_MS', '30000')) || 30000;
  }

  /** 由宿主模块在注册内置定义后调用：首次同步 + 启动轮询 */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.sync();
    this.timer = setInterval(() => {
      if (this.started) void this.sync();
    }, this.pollMs);
    this.logger.log(`Agent 定义同步已启动：${this.endpoint}（每 ${this.pollMs}ms 轮询）`);
  }

  /** 由宿主模块在销毁时调用：停止轮询 */
  stop(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async sync(): Promise<void> {
    try {
      const res = await fetch(this.endpoint, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        this.logger.warn(`拉取 Agent 定义失败: status=${res.status}`);
        return;
      }
      const rows = (await res.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows)) {
        this.logger.warn('Agent 定义响应格式异常（非数组）');
        return;
      }
      let updated = 0;
      for (const row of rows) {
        const def = this.toAgentDefinition(row);
        if (!def) continue;
        this.agentRegistry.upsert(def);
        updated++;
      }
      if (updated > 0) {
        this.logger.log(`Agent 定义同步完成，覆盖 ${updated} 个`);
      }
    } catch (e) {
      this.logger.warn(`Agent 定义同步异常: ${(e as Error).message}`);
    }
  }

  private toAgentDefinition(row: Record<string, unknown>): AgentDefinition | null {
    const id = String(row.id ?? '');
    const name = String(row.name ?? '');
    const systemPrompt = String(row.systemPrompt ?? '');
    const model = String(row.model ?? '');
    if (!id || !name || !systemPrompt || !model) {
      this.logger.warn(`Agent 定义缺必要字段，跳过: id=${id || 'unknown'}`);
      return null;
    }
    const memory = (row.memory as { compactionThreshold?: number; keepRecent?: number; enabled?: boolean }) ?? {};
    return {
      id,
      name,
      systemPrompt,
      model,
      tools: Array.isArray(row.tools) ? (row.tools as string[]) : [],
      maxSteps: Number(row.maxSteps) || 10,
      // C7 生成参数：一律 null 兜底（null = 沿用客户端默认，行为与未配置一致）
      temperature: typeof row.temperature === 'number' ? row.temperature : null,
      maxTokens: typeof row.maxTokens === 'number' ? row.maxTokens : null,
      topP: typeof row.topP === 'number' ? row.topP : null,
      thinking: this.parseThinking(row.thinking),
      memory: {
        compactionThreshold: Number(memory.compactionThreshold) || 20,
        keepRecent: Number(memory.keepRecent) || 6,
        enabled: memory.enabled !== false,
      },
    };
  }

  /**
   * 解析思考预算覆盖（C7）。形状不对一律当「未配置」返回 null（语义 = 沿用客户端默认，
   * 与旧行为一致），避免脏数据把调用打挂。
   */
  private parseThinking(raw: unknown): ThinkingOption | null {
    if (!raw || typeof raw !== 'object') return null;
    const t = raw as { type?: unknown; budget_tokens?: unknown };
    if (t.type !== 'enabled' && t.type !== 'disabled') return null;
    const opt: ThinkingOption = { type: t.type };
    if (typeof t.budget_tokens === 'number' && Number.isFinite(t.budget_tokens)) {
      opt.budget_tokens = t.budget_tokens;
    }
    return opt;
  }
}
