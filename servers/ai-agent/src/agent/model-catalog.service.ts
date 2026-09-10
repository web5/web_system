import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientRegistry, Hy3Client, TokenHubClient } from '@kedouai/agent-core';

/**
 * 内置模型清单（三级回落的最后一级）。
 *
 * 注意：这里是**兜底**，不是真相源——真相源是 DB 字典 `llm_models`（运维在
 * admin「字典管理」维护），其次是 `TOKENHUB_MODELS` 环境变量。
 * 代码默认值与 .env 打架曾导致 hy4-preview 从下拉里消失，所以各级只在
 * 上一级不可用时生效，且每次回落都打 WARN。
 */
export const BUILTIN_TOKENHUB_MODELS = [
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'deepseek-v4-pro-0813',
  'hy4-preview',
  'glm-5.3',
  'kimi-k3',
  'qwen3.5-plus',
  'minimax-m3',
].join(',');

export type ModelSource = 'db' | 'env' | 'builtin';

export interface ModelCatalogState {
  /** 当前生效来源 */
  source: ModelSource;
  /** 当前生效的模型 id 清单（不含 hy3） */
  models: string[];
  /** 最近一次成功同步时间 */
  lastSyncAt: string | null;
}

/** 把逗号分隔的模型配置解析成去重后的数组 */
function parseModelList(raw: string | undefined): string[] {
  const seen = new Set<string>();
  for (const item of (raw || '').split(',')) {
    const v = item.trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

/**
 * 模型目录：维护 ClientRegistry 里的可用模型清单。
 *
 * 优先级 `DB 字典 → TOKENHUB_MODELS → 代码内置`（可用 MODEL_SOURCE 强制指定某一级）。
 * 启动时立即同步一次（避免空窗），之后按 MODEL_POLL_MS 轮询刷新；
 * 拉取失败只 WARN、保留当前清单，绝不因字典不可用导致 Agent 起不来。
 */
@Injectable()
export class ModelCatalogService {
  private readonly logger = new Logger(ModelCatalogService.name);
  private readonly systemServiceUrl: string;
  private readonly internalKey: string;
  private readonly dictCode: string;
  private readonly forcedSource: string;
  private readonly pollMs: number;

  private timer?: ReturnType<typeof setInterval>;
  private started = false;
  private state: ModelCatalogState = { source: 'builtin', models: [], lastSyncAt: null };

  constructor(
    private readonly configService: ConfigService,
    private readonly registry: ClientRegistry,
  ) {
    this.systemServiceUrl = (
      this.configService.get<string>('SYSTEM_SERVICE_URL', 'http://127.0.0.1:6004') || ''
    ).replace(/\/+$/, '');
    this.internalKey = this.configService.get<string>('INTERNAL_API_KEY', '') || '';
    this.dictCode = this.configService.get<string>('MODEL_DICT_CODE', 'llm_models') || 'llm_models';
    this.forcedSource = (this.configService.get<string>('MODEL_SOURCE', 'db') || 'db').toLowerCase();
    this.pollMs = Number(this.configService.get('MODEL_POLL_MS', '60000')) || 60000;
  }

  /** 由 AgentModule 在 onModuleInit 调用：首次同步 + 启动轮询 */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.sync();
    this.timer = setInterval(() => {
      if (this.started) void this.sync();
    }, this.pollMs);
    this.logger.log(
      `模型目录已启动：source=${this.forcedSource}、字典=${this.dictCode}、轮询 ${this.pollMs}ms`,
    );
  }

  stop(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getState(): ModelCatalogState {
    return { ...this.state };
  }

  async sync(): Promise<void> {
    if (this.forcedSource === 'builtin') {
      this.apply(parseModelList(BUILTIN_TOKENHUB_MODELS), 'builtin');
      return;
    }
    if (this.forcedSource === 'env') {
      const envModels = parseModelList(this.configService.get<string>('TOKENHUB_MODELS'));
      this.apply(envModels.length ? envModels : parseModelList(BUILTIN_TOKENHUB_MODELS), envModels.length ? 'env' : 'builtin');
      return;
    }

    // 默认：DB 字典优先
    try {
      const dbModels = await this.fetchFromDict();
      if (dbModels.length) {
        this.apply(dbModels, 'db');
        return;
      }
      this.logger.warn(`字典 ${this.dictCode} 无启用项，回落至 TOKENHUB_MODELS`);
    } catch (e) {
      this.logger.warn(`字典拉取失败（${(e as Error).message}），回落至 TOKENHUB_MODELS`);
    }

    const envModels = parseModelList(this.configService.get<string>('TOKENHUB_MODELS'));
    if (envModels.length) {
      this.apply(envModels, 'env');
      return;
    }
    this.logger.warn('TOKENHUB_MODELS 未配置，回落至代码内置模型清单');
    this.apply(parseModelList(BUILTIN_TOKENHUB_MODELS), 'builtin');
  }

  /** 拉取字典启用项（服务间接口，需 x-internal-key） */
  private async fetchFromDict(): Promise<string[]> {
    const url = `${this.systemServiceUrl}/internal/dict/${this.dictCode}`;
    const res = await fetch(url, {
      headers: { 'x-internal-key': this.internalKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`status=${res.status}`);
    const body = (await res.json()) as { data?: Array<{ value?: string }> };
    const rows = Array.isArray(body?.data) ? body.data : [];
    const seen = new Set<string>();
    for (const row of rows) {
      const v = String(row?.value ?? '').trim();
      if (v) seen.add(v);
    }
    return [...seen];
  }

  /**
   * 用最新清单重建注册表。
   * 刻意 clear 后回填而非换实例：ClientRegistry 被 AgentEngine 等按引用注入。
   * hy3 由 Hy3Client 单独承载，不参与字典清单，每轮都要补回。
   */
  private apply(models: string[], source: ModelSource): void {
    this.registry.clear();
    this.registry.register(new Hy3Client());
    for (const m of models) {
      this.registry.register(new TokenHubClient(m));
    }
    const changed =
      this.state.source !== source || this.state.models.join(',') !== models.join(',');
    this.state = { source, models, lastSyncAt: new Date().toISOString() };
    if (changed) {
      this.logger.log(
        `模型清单已更新：来源=${source}、共 ${models.length} 个（hy3 + ${models.join(', ') || '无'}）`,
      );
    }
  }
}
