import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import {
  buildServer,
  createHttpModule,
  HttpModuleConfig,
  HttpToolDef,
} from '@web-system/mcp-core';
import { McpModuleEntity } from './entities/mcp-module.entity';
import { McpToolEntity } from './entities/mcp-tool.entity';

/** 财经资讯微服务的 REST 接口声明（seed 到 mcp_modules） */
const FINNEWS_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'get_latest_topics',
    description: '获取最新财经话题列表，包含摘要、来源和情感倾向',
    method: 'GET',
    path: '/api/topics',
    params: [
      { name: 'limit', type: 'integer', required: false, description: '数量（默认10，最大50）' },
      { name: 'category', type: 'string', required: false, description: '分类（默认全部）' },
    ],
  },
  {
    name: 'search_news',
    description: '搜索财经资讯，支持关键词、时间范围和情感过滤',
    method: 'GET',
    path: '/api/search',
    params: [
      { name: 'query', type: 'string', required: true, description: '搜索关键词' },
      { name: 'date_range', type: 'string', required: false, description: '时间范围（今天/本周）' },
      { name: 'sentiment', type: 'string', required: false, description: '情感过滤（利好/利空/中性）' },
      { name: 'limit', type: 'integer', required: false, description: '数量' },
    ],
  },
  {
    name: 'get_stock_news',
    description: '获取某只股票的相关资讯（按关键词搜索）',
    method: 'GET',
    path: '/api/stock-news',
    params: [
      { name: 'stock_code', type: 'string', required: true, description: '股票名称或代码' },
      { name: 'limit', type: 'integer', required: false, description: '数量' },
    ],
  },
  {
    name: 'get_sector_hot',
    description: '获取某板块一周内的热门话题',
    method: 'GET',
    path: '/api/sector-hot',
    params: [
      { name: 'sector', type: 'string', required: true, description: '板块名（如半导体）' },
      { name: 'limit', type: 'integer', required: false, description: '数量' },
    ],
  },
  {
    name: 'get_sector_library',
    description: '获取板块实体库：当前数据库所有「板块」类型实体及其 7日/30日 提及热度，用于枚举可查询的板块名称（配合 get_sector_hot 使用）',
    method: 'GET',
    path: '/api/sectors',
    params: [],
  },
  {
    name: 'get_market_pulse',
    description: '获取市场情绪脉搏：情绪指数、热门板块、24小时资讯量',
    method: 'GET',
    path: '/api/market-pulse',
    params: [],
  },
];

/** 公众号发布通道的 REST 接口声明（seed 到 mcp_modules，code_key=wechat_mp） */
const WECHAT_MP_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'create_wechat_draft',
    description:
      '发布文章到微信公众号前，先创建图文草稿（不发布）。返回 media_id，可在公众号后台确认排版后再发布',
    method: 'POST',
    path: '/api/content/wechat/draft',
    params: [
      { name: 'title', type: 'string', required: true, description: '文章标题' },
      { name: 'html', type: 'string', required: true, description: '文章正文 HTML（富文本，图片自动转微信 CDN）' },
      { name: 'thumb_media_id', type: 'string', required: false, description: '封面素材 media_id（不传则用正文首图作封面）' },
      { name: 'digest', type: 'string', required: false, description: '摘要（选填，默认取正文开头）' },
      { name: 'source_url', type: 'string', required: false, description: '原文链接（选填）' },
    ],
  },
  {
    name: 'publish_to_wechat',
    description:
      '一键发布文章到微信公众号：HTML 富文本 → 建草稿 → freepublish 提交发布。返回 publish_id 用于查询发布状态',
    method: 'POST',
    path: '/api/content/wechat/publish',
    params: [
      { name: 'title', type: 'string', required: true, description: '文章标题' },
      { name: 'html', type: 'string', required: true, description: '文章正文 HTML（富文本，图片自动转微信 CDN）' },
      { name: 'thumb_media_id', type: 'string', required: false, description: '封面素材 media_id（不传则用正文首图作封面）' },
      { name: 'digest', type: 'string', required: false, description: '摘要（选填）' },
      { name: 'source_url', type: 'string', required: false, description: '原文链接（选填）' },
      { name: 'item_id', type: 'integer', required: false, description: '关联内容条目 ID（写发布记录用，选填）' },
    ],
  },
];

/** 论文学习数据通道的 REST 接口声明（seed 到 mcp_modules，code_key=paper） */
const PAPER_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'fetch_papers',
    description:
      '从 arXiv 拉取最新论文列表（仅查询不发布）。返回论文标题/摘要/arxiv id/链接/作者/分类，按提交时间倒序。用于论文学习、生成论文日报',
    method: 'GET',
    path: '/api/papers',
    params: [
      { name: 'categories', type: 'string', required: false, description: 'arXiv 分类（默认 cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG）' },
      { name: 'max_results', type: 'integer', required: false, description: '返回论文数（默认 10，最大 20）' },
    ],
  },
];

@Injectable()
export class McpService implements OnModuleInit {
  private readonly logger = new Logger(McpService.name);
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(
    @InjectRepository(McpModuleEntity)
    private readonly moduleRepo: Repository<McpModuleEntity>,
    @InjectRepository(McpToolEntity)
    private readonly toolRepo: Repository<McpToolEntity>,
  ) {}

  /** 启动时 seed 财经资讯 + 公众号发布 + 论文学习 HTTP 模块（自动注册后台微服务 REST 接口） */
  async onModuleInit(): Promise<void> {
    await this.seedFinnewsHttpModule();
    await this.seedWechatMpModule();
    await this.seedPaperModule();
  }

  /** seed 论文学习模块（code_key=paper，直连本机 content-hub 的 /api/papers 接口） */
  private async seedPaperModule(): Promise<void> {
    // paper 数据源在 content-hub，与 finnews 同机部署；优先直连本机，避免跨机
    const baseUrl = process.env.CONTENT_HUB_SERVICE_URL ?? 'http://127.0.0.1:6007';
    const authType = '';
    const authConfig: Record<string, any> | null = null;

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'paper' } });
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(`已同步论文学习 base_url=${baseUrl} auth_type=${authType || '(无)'}`);
      }
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '论文学习',
        description: '论文学习微服务：arXiv 最新论文拉取（cs.AI/CL/CV/LG），按提交时间倒序',
        base_url: baseUrl,
        timeout: 30,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'paper',
        enabled: true,
      }),
    );
    const tools = PAPER_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 论文学习 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  private async seedFinnewsHttpModule(): Promise<void> {
    const baseUrl = process.env.FINNEWS_SERVICE_URL ?? 'http://localhost:6007';
    const authType = process.env.FINNEWS_SERVICE_AUTH_TYPE ?? '';
    const authConfigRaw = process.env.FINNEWS_SERVICE_AUTH_CONFIG ?? '';
    let authConfig: Record<string, any> | null = null;
    if (authConfigRaw) {
      try {
        authConfig = JSON.parse(authConfigRaw);
      } catch (e) {
        this.logger.warn(`FINNEWS_SERVICE_AUTH_CONFIG JSON 解析失败: ${authConfigRaw}`);
      }
    }

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'finnews' } });
    // 旧 code 类型记录 → 迁移为 http（删除重建）
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      // 已存在：同步 base_url / auth_type / auth_config（环境变量可能变更）
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        // 用 update 而非 save(entity)：save 会级联 eager 加载的 tools 触发 module_id 置空报错
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(
          `已同步财经资讯 base_url=${baseUrl} auth_type=${authType || '(无)'}`,
        );
      }
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '财经资讯',
        description: '财经资讯微服务：采集新浪/东财快讯，SimHash 去重 + LLM 摘要/情感分析',
        base_url: baseUrl,
        timeout: 30,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'finnews',
        enabled: true,
      }),
    );
    const tools = FINNEWS_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 财经资讯 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  /** seed 公众号发布模块（code_key=wechat_mp，指向 content-hub 的公众号发布接口） */
  private async seedWechatMpModule(): Promise<void> {
    const baseUrl = process.env.CONTENT_HUB_SERVICE_URL ?? 'http://localhost:6007';
    const authType = process.env.CONTENT_HUB_SERVICE_AUTH_TYPE ?? '';
    const authConfigRaw = process.env.CONTENT_HUB_SERVICE_AUTH_CONFIG ?? '';
    let authConfig: Record<string, any> | null = null;
    if (authConfigRaw) {
      try {
        authConfig = JSON.parse(authConfigRaw);
      } catch (e) {
        this.logger.warn(`CONTENT_HUB_SERVICE_AUTH_CONFIG JSON 解析失败: ${authConfigRaw}`);
      }
    }

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'wechat_mp' } });
    if (existing && existing.module_type !== 'http') {
      await this.moduleRepo.delete({ id: existing.id });
      existing = null;
    }
    if (existing) {
      let changed = false;
      if (existing.base_url !== baseUrl) {
        existing.base_url = baseUrl;
        changed = true;
      }
      if (existing.auth_type !== authType) {
        existing.auth_type = authType;
        changed = true;
      }
      if (JSON.stringify(existing.auth_config ?? null) !== JSON.stringify(authConfig)) {
        existing.auth_config = authConfig;
        changed = true;
      }
      if (changed) {
        await this.moduleRepo.update(existing.id, {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: authConfig,
        });
        this.logger.log(`已同步公众号发布 base_url=${baseUrl} auth_type=${authType || '(无)'}`);
      }
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '公众号发布',
        description: '微信公众号内容发布：创建图文草稿 / 一键发布（HTML 富文本，正文图片自动转微信 CDN）',
        base_url: baseUrl,
        timeout: 120,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'wechat_mp',
        enabled: true,
      }),
    );
    const tools = WECHAT_MP_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 公众号发布 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
  }

  /** 从数据库构建 MCP Server（每个 session 独立实例，规避 SDK 单 transport 限制） */
  private async buildServerFromDb(moduleCode?: string): Promise<McpServer> {
    const where: any = { enabled: true };
    if (moduleCode) where.code_key = moduleCode;
    const modules = await this.moduleRepo.find({ where });
    if (moduleCode && modules.length === 0) {
      throw new NotFoundException(`模块 ${moduleCode} 不存在或未启用`);
    }
    const mcpModules = modules.map((m) => createHttpModule(m.name, this.toConfig(m)));
    return buildServer(
      { name: 'mcp-gateway', version: '1.0.0', instructions: '统一 MCP 网关' },
      mcpModules,
    );
  }

  private toConfig(m: McpModuleEntity): HttpModuleConfig {
    return {
      base_url: m.base_url,
      timeout: m.timeout,
      auth: { type: m.auth_type, ...(m.auth_config ?? {}) },
      tools: (m.tools ?? []).map(
        (t) =>
          ({
            name: t.name,
            description: t.description,
            method: t.method as HttpToolDef['method'],
            path: t.path,
            params: t.params ?? [],
          }) as HttpToolDef,
      ),
    };
  }

  // ── 会话管理 ──

  getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    return this.transports.get(sessionId);
  }

  async createTransport(): Promise<StreamableHTTPServerTransport> {
    return this.buildAndConnect();
  }

  /** 按模块 code_key 创建 transport（只暴露该模块工具），如 /mcp/finnews → finnews 的工具 */
  async createModuleTransport(moduleCode: string): Promise<StreamableHTTPServerTransport> {
    return this.buildAndConnect(moduleCode);
  }

  private async buildAndConnect(moduleCode?: string): Promise<StreamableHTTPServerTransport> {
    const server = await this.buildServerFromDb(moduleCode);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        this.transports.set(sid, transport);
      },
    });
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) this.transports.delete(sid);
    };
    await server.connect(transport);
    return transport;
  }

  removeTransport(sessionId: string): void {
    this.transports.delete(sessionId);
  }
}
