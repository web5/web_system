import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentRegistry, AgentDefinition, CapabilityRef, SkillRef, ToolRegistry, McpToolMeta } from '@kedouai/agent-core';
import { McpService } from '../mcp/mcp.service';

/**
 * 需要 collectionId 入参的 knowledge 工具（按集合操作 → 必须显式绑定集合）。
 *
 * 其余 knowledge 工具（knowledge_list / knowledge_status）是**集合无关**的：
 * 它们的可见性取决于「该 agent 是否绑定了至少一个集合」，而不是它自己带 collectionId
 * （开放决策 7 = C 的原意：不绑定任何集合的 agent 无知识工具可调）。
 * 早期实现对本集合外的工具也强制要求 config.collectionId，导致 knowledge_list 被跳过注册。
 */
export const KNOWLEDGE_COLLECTION_SCOPED_TOOLS = new Set([
  'knowledge_search',
  'knowledge_ingest',
  'knowledge_delete',
]);

/**
 * Agent 定义同步器（一期）
 *
 * 从 ai-service `GET /internal/agent-definitions` 拉取 published 且 enabled 的定义，
 * 转成 AgentDefinition 后 `AgentRegistry.upsert()` 覆盖本地注册表。
 *
 * 生命周期由宿主 AgentModule 控制：先注册代码内置定义（upsert 兜底），再调用
 * `start()` 做首次同步 + 定时轮询，保证 DB 定义优先于代码定义。
 *
 * 额外职责：对定义中的 mcp 能力做懒加载注册（幂等），让 capabilities 里的
 * mcp:module/tool 变成可被 Agent 引擎调用的远程工具。
 *
 * 分层约束：本服务在 Nest 服务层，只通过 HTTP 拉取 ai-service；不直接碰数据库。
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
    private readonly toolRegistry: ToolRegistry,
    private readonly mcpService: McpService,
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
        this.registerMcpCapabilities(def);
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

    const capabilities = Array.isArray(row.capabilities)
      ? (row.capabilities as CapabilityRef[])
      : undefined;
    const skills = Array.isArray(row.skills) ? (row.skills as SkillRef[]) : undefined;

    // 本地工具 + MCP 工具名（mcp 用短名，注册/调用都走短名）
    const localTools = capabilities
      ? capabilities.filter((c) => c.type === 'tool' && c.enabled !== false).map((c) => c.ref)
      : Array.isArray(row.tools)
        ? (row.tools as string[])
        : [];
    const mcpTools = capabilities
      ? capabilities
          .filter((c) => c.type === 'mcp' && c.enabled !== false)
          .map((c) => c.ref.split('/').pop() || c.ref)
      : [];

    return {
      id,
      name,
      systemPrompt,
      model,
      // 版本快照（Phase2.3：随定义下发，供回放/遥测/成本统计区分版本）
      version: row.version != null ? Number(row.version) : undefined,
      tools: [...localTools, ...mcpTools],
      capabilities,
      skills,
      maxSteps: Number(row.maxSteps) || 10,
      temperature: typeof row.temperature === 'number' ? row.temperature : undefined,
      streaming: row.streaming === false ? false : true,
      memory: {
        compactionThreshold: Number(memory.compactionThreshold) || 20,
        keepRecent: Number(memory.keepRecent) || 6,
        enabled: memory.enabled !== false,
      },
    };
  }

  /**
   * 按定义中的 mcp 能力注册懒加载远程工具（幂等）。
   * 注册名 = mcp:module/tool 的 tool 短名；schema 宽松（MCP 网关侧校验参数）。
   */
  private registerMcpCapabilities(def: AgentDefinition): void {
    if (!this.mcpService.isAvailable()) return;
    const mcpCaps = (def.capabilities ?? []).filter((c) => c.type === 'mcp' && c.enabled !== false);

    // 知识集合绑定（开放决策 7 = C）：按集合操作的知识工具（search/ingest/delete）调用时
    // collectionId 必须 ∈ 本定义 capabilities 里显式绑定的集合集（config.collectionId）。
    // 缺 collectionId 的**按集合操作**能力视为装配错误 → 跳过注册（宁可明确错误，不静默放行全部集合）。
    const boundCollectionsByTool = new Map<string, string[]>();
    for (const cap of mcpCaps) {
      const [module, tool] = cap.ref.split('/');
      if (module !== 'knowledge' || !tool) continue;
      if (!KNOWLEDGE_COLLECTION_SCOPED_TOOLS.has(tool)) continue;
      const raw = (cap.config ?? {}) as { collectionId?: unknown };
      if (typeof raw.collectionId !== 'string' || !raw.collectionId) {
        this.logger.warn(`knowledge 能力缺少 config.collectionId，跳过注册: ${cap.ref}`);
        continue;
      }
      const arr = boundCollectionsByTool.get(tool) ?? [];
      arr.push(raw.collectionId);
      boundCollectionsByTool.set(tool, arr);
    }
    // 是否绑定了至少一个集合 —— 集合无关的知识工具（knowledge_list/status）的注册前提
    const hasKnowledgeBinding = boundCollectionsByTool.size > 0;

    for (const cap of mcpCaps) {
      const [module, tool] = cap.ref.split('/');
      if (!module || !tool) continue;
      if (module === 'knowledge') {
        const scoped = KNOWLEDGE_COLLECTION_SCOPED_TOOLS.has(tool);
        // 按集合操作但未绑定集合（收集阶段已 WARN）：不注册，避免"注册了却必然被拒"
        if (scoped && !boundCollectionsByTool.has(tool)) continue;
        // 集合无关的知识工具：agent 未绑定任何集合则不注册（决策 7 = C：无绑定即无知识工具）
        if (!scoped && !hasKnowledgeBinding) {
          this.logger.warn(`agent 未绑定任何知识集合，跳过注册集合无关知识工具: ${cap.ref}`);
          continue;
        }
      }
      if (this.toolRegistry.has(tool)) continue;
      const meta: McpToolMeta = {
        name: tool,
        module,
        description: `MCP 远程工具 ${cap.ref}`,
        inputSchema: { type: 'object', properties: {} },
      };
      // 能力级运行时配置：longRunning 时自动轮询长任务到终态
      const runtime = (cap.config ?? {}) as {
        longRunning?: boolean;
        maxWaitMs?: number;
        timeoutMs?: number;
        intervalMs?: number;
      };
      try {
        const binding = module === 'knowledge'
          ? { allowedCollections: boundCollectionsByTool.get(tool) }
          : undefined;
        this.mcpService.registerMcpTool(this.toolRegistry, meta, runtime, binding);
        this.logger.log(
          `已注册 MCP 能力（懒加载）: ${cap.ref}${runtime.longRunning ? ' [长任务]' : ''}`,
        );
      } catch (err) {
        this.logger.warn(`MCP 能力注册跳过（可能冲突）: ${cap.ref} - ${(err as Error).message}`);
      }
    }
  }
}
