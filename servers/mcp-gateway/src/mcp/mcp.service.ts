import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import {
  buildServer,
  createHttpModule,
  callApi,
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

/** 机构行为数据通道的 REST 接口声明（seed 到 mcp_modules，code_key=institution） */
const INSTITUTION_HTTP_TOOLS: Array<{
  name: string;
  description: string;
  method: string;
  path: string;
  params: Array<{ name: string; type: string; required: boolean; description?: string }>;
}> = [
  {
    name: 'get_quote',
    description: '实时行情快照（腾讯行情 qt.gtimg.cn 直连）：现价/涨跌幅/最高最低/换手/PE/PB/总市值/量比/均价/涨停跌停。用于机构行为「成本与估值」与实时价格维度',
    method: 'GET',
    path: '/api/institution/quote',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_north_holding',
    description: '北向资金个股持股（沪深港通）：最新日期北向机构数、总持股市值(万)、Top3 机构持仓。用于机构行为「静态仓位」与「北向资金」维度',
    method: 'GET',
    path: '/api/institution/north-holding',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_fund_flow',
    description: '主力资金流（东财 push2delay 直连，当日主力净流入 + 近 N 日 + 腾讯实时价）：每日主力净流入(元)、收盘价、涨跌幅，近5日合计与趋势。用于机构行为「动态行为」维度',
    method: 'GET',
    path: '/api/institution/fund-flow',
    params: [
      { name: 'code', type: 'string', required: true, description: '股票代码，如 600519' },
      { name: 'days', type: 'integer', required: false, description: '回溯天数（默认 10）' },
    ],
  },
  {
    name: 'get_lhb',
    description: '龙虎榜（机构席位买卖）：近期上榜日期、买卖额(万)、机构买卖说明。用于机构行为「动态行为/龙虎榜」维度',
    method: 'GET',
    path: '/api/institution/lhb',
    params: [
      { name: 'code', type: 'string', required: true, description: '股票代码，如 600519' },
      { name: 'limit', type: 'integer', required: false, description: '返回条数（默认 5）' },
    ],
  },
  {
    name: 'get_rating',
    description: '机构评级与盈利预测：评级机构数、买入/增持数、未来3年 EPS 预测。用于机构行为「研报/评级催化」维度',
    method: 'GET',
    path: '/api/institution/rating',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_report',
    description: '研报列表：近期研报标题、机构、日期、评级、次年 EPS/PE 预测。用于机构行为「研报催化」维度',
    method: 'GET',
    path: '/api/institution/report',
    params: [
      { name: 'code', type: 'string', required: true, description: '股票代码，如 600519' },
      { name: 'days', type: 'integer', required: false, description: '回溯天数（默认 180）' },
      { name: 'limit', type: 'integer', required: false, description: '返回条数（默认 10）' },
    ],
  },
  {
    name: 'get_valuation',
    description: '估值（腾讯行情 qt.gtimg.cn 实时）：PE_TTM/PE动/PE静、PB、总市值(亿)、流通市值(亿)、现价/涨跌幅/最高最低/换手/量比。用于机构行为「成本与估值」维度',
    method: 'GET',
    path: '/api/institution/valuation',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_chip',
    description: '筹码分布：东财该报表可能不可用，失败时返回 ok:false 并标注「建议人工核对成本区」。用于机构行为「成本区」维度（降级使用）',
    method: 'GET',
    path: '/api/institution/chip',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
  },
  {
    name: 'get_finance_yoy',
    description: '业绩同比（营收/净利）：东财 F10 报表已下架，失败时返回 ok:false 并建议用 get_valuation(PE) 与 get_rating(EPS预测) 作业绩代理。用于机构行为「5分钟排雷」维度（降级使用）',
    method: 'GET',
    path: '/api/institution/finance-yoy',
    params: [{ name: 'code', type: 'string', required: true, description: '股票代码，如 600519' }],
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
    await this.seedInstitutionModule();
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
      await this.syncModuleTools(existing.id, PAPER_HTTP_TOOLS);
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

  /** seed 机构行为数据模块（code_key=institution，直连本机 content-hub 的 /api/institution/* 接口） */
  private async seedInstitutionModule(): Promise<void> {
    // institution 数据源在 content-hub，与 finnews 同机部署；优先直连本机
    const baseUrl = process.env.INSTITUTION_SERVICE_URL ?? 'http://127.0.0.1:6007';
    const authType = '';
    const authConfig: Record<string, any> | null = null;

    let existing = await this.moduleRepo.findOne({ where: { code_key: 'institution' } });
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
        this.logger.log(`已同步机构行为 base_url=${baseUrl} auth_type=${authType || '(无)'}`);
      }
      await this.syncModuleTools(existing.id, INSTITUTION_HTTP_TOOLS);
      return;
    }

    const mod = await this.moduleRepo.save(
      this.moduleRepo.create({
        name: '机构行为数据',
        description: '机构行为全周期追踪框架数据源：北向持股/主力资金流/龙虎榜/机构评级/研报/估值/筹码/业绩同比（东方财富公开接口）',
        base_url: baseUrl,
        timeout: 30,
        auth_type: authType,
        auth_config: authConfig,
        module_type: 'http',
        code_key: 'institution',
        enabled: true,
      }),
    );
    const tools = INSTITUTION_HTTP_TOOLS.map((t) =>
      this.toolRepo.create({ module_id: mod.id, ...t }),
    );
    await this.toolRepo.save(tools);
    this.logger.log(`已 seed 机构行为 HTTP 模块: ${baseUrl}（${tools.length} 个工具）`);
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
      await this.syncModuleTools(existing.id, FINNEWS_HTTP_TOOLS);
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
      await this.syncModuleTools(existing.id, WECHAT_MP_HTTP_TOOLS);
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

  /**
   * 工具差量同步：比对模块已有工具与代码声明，补插缺失项。
   * 解决"seed 只在模块不存在时创建，历史模块升级后新工具不生效"的问题。
   */
  private async syncModuleTools(
    moduleId: number,
    declared: Array<{ name: string; description: string; method: string; path: string; params: unknown[] }>,
  ): Promise<void> {
    const existing = await this.toolRepo.find({ where: { module_id: moduleId } });
    const existingNames = new Set(existing.map((t) => t.name));
    const missing = declared.filter((t) => !existingNames.has(t.name));
    if (missing.length === 0) return;
    await this.toolRepo.save(
      missing.map((t) => this.toolRepo.create({ module_id: moduleId, ...t })),
    );
    this.logger.log(`模块 #${moduleId} 补插缺失工具: ${missing.map((t) => t.name).join(', ')}`);
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

  /**
   * 直接调用模块下的某个工具（供 ai-agent 等内部调用方经 /mcp/tools/call 使用）。
   * 走与 MCP streamable-http 相同的 HttpModuleConfig + callApi 链路，无状态。
   */
  async callTool(
    moduleCode: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const mod = await this.moduleRepo.findOne({
      where: { code_key: moduleCode, enabled: true },
      relations: ['tools'],
    });
    if (!mod) throw new NotFoundException(`模块 ${moduleCode} 不存在或未启用`);
    const toolDef = (mod.tools ?? []).find((t) => t.name === toolName);
    if (!toolDef) throw new NotFoundException(`工具 ${toolName} 在模块 ${moduleCode} 中不存在`);

    const config = this.toConfig(mod);
    const def: HttpToolDef = {
      name: toolDef.name,
      description: toolDef.description,
      method: toolDef.method as HttpToolDef['method'],
      path: toolDef.path,
      params: toolDef.params ?? [],
    };
    return callApi(config, def, args ?? {});
  }
}
