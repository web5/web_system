import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CapabilityRef, SkillRef } from '@kedouai/agent-core';
import { AgentDefinitionEntity } from './entities/agent-definition.entity';
import { AgentDefinitionVersionEntity } from './entities/agent-definition-version.entity';
import { SkillService } from '../skill/skill.service';

/** Agent 定义的可编辑字段（对应 AgentDefinition） */
export interface AgentDefinitionPayload {
  name: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  /** 能力数组（tool/mcp/skill）。可选：不传时后端从 tools 派生 */
  capabilities?: CapabilityRef[];
  maxSteps: number;
  temperature?: number | null;
  memory: { compactionThreshold: number; keepRecent: number; enabled: boolean };
  /** 是否流式输出（默认 true） */
  streaming?: boolean;
}

/** admin 操作用户信息（来自 req.user） */
export interface OperatorInfo {
  id?: string | number;
  username?: string;
  [key: string]: unknown;
}

/**
 * Agent 定义配置化服务（一期）
 *
 * 职责：把 agent 定义从代码迁移到数据库，支持 CRUD / 发布 / 启停 / 版本回滚，
 * 并对外暴露"published 且 enabled"的定义供各服务（ai-agent / ai-service）启动 + 轮询拉取。
 *
 * 约束：本服务在 ai-service（Nest 服务层）内，持有数据库访问；不涉及 agent-core。
 */
@Injectable()
export class AgentDefService {
  private readonly logger = new Logger(AgentDefService.name);

  constructor(
    @InjectRepository(AgentDefinitionEntity)
    private readonly defRepo: Repository<AgentDefinitionEntity>,
    @InjectRepository(AgentDefinitionVersionEntity)
    private readonly verRepo: Repository<AgentDefinitionVersionEntity>,
    private readonly skillService: SkillService,
    private readonly configService: ConfigService,
  ) {}

  /** 列表（全部定义，含状态/版本/启用） */
  async list() {
    const rows = await this.defRepo.find({ order: { createdAt: 'DESC' } });
    return rows.map((r) => this.toView(r));
  }

  /** 单条详情 */
  async get(id: string) {
    const row = await this.defRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Agent ${id} 不存在`);
    return this.toView(row);
  }

  /** 新建（创建为草稿，不发布） */
  async create(id: string, payload: AgentDefinitionPayload) {
    const exists = await this.defRepo.findOne({ where: { id } });
    if (exists) throw new BadRequestException(`Agent ${id} 已存在，请改用编辑`);
    const { capabilities, tools } = this.normalizeCapabilities(payload);
    const skills = await this.resolveSkills(capabilities);
    const row = this.defRepo.create({
      id,
      name: payload.name,
      systemPrompt: payload.systemPrompt,
      model: payload.model,
      tools,
      capabilities,
      skills,
      maxSteps: payload.maxSteps,
      temperature: payload.temperature ?? null,
      memory: payload.memory,
      streaming: payload.streaming ?? true,
      version: 0,
      status: 'draft',
      enabled: true,
      publishedAt: null,
      updatedBy: null,
    });
    const saved = await this.defRepo.save(row);
    return this.toView(saved);
  }

  /** 保存草稿（不发布，不生成新版本；已发布的可编辑生成新草稿，等下次 publish） */
  async update(id: string, payload: AgentDefinitionPayload, operator?: OperatorInfo) {
    const row = await this.defRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Agent ${id} 不存在`);
    const { capabilities, tools } = this.normalizeCapabilities(payload);
    const skills = await this.resolveSkills(capabilities);
    row.name = payload.name;
    row.systemPrompt = payload.systemPrompt;
    row.model = payload.model;
    row.tools = tools;
    row.capabilities = capabilities;
    row.skills = skills;
    row.maxSteps = payload.maxSteps;
    row.temperature = payload.temperature ?? null;
    row.memory = payload.memory;
    row.streaming = payload.streaming ?? true;
    // 已发布的定义被编辑后，标记为 draft，等重新 publish 生效（保留原版本号）
    if (row.status === 'published') {
      row.status = 'draft';
      row.publishedAt = null;
    }
    row.updatedBy = operator?.username ?? operator?.id?.toString() ?? null;
    const saved = await this.defRepo.save(row);
    return this.toView(saved);
  }

  /**
   * 发布：把当前内容写入历史版本表（version+1），并标记为 published。
   * 发布后，各服务轮询即可拉到新定义（运行时生效）。
   */
  async publish(id: string, operator?: OperatorInfo, changeNote?: string) {
    const row = await this.defRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Agent ${id} 不存在`);

    const nextVersion = row.version + 1;
    const { capabilities, skills } = await this.ensureCapabilities(row);
    await this.verRepo.save(
      this.verRepo.create({
        agentId: row.id,
        version: nextVersion,
        name: row.name,
        systemPrompt: row.systemPrompt,
        model: row.model,
        tools: row.tools,
        capabilities,
        skills,
        maxSteps: row.maxSteps,
        temperature: row.temperature,
        memory: row.memory,
        streaming: row.streaming,
        changeNote: changeNote ?? null,
        createdBy: operator?.username ?? operator?.id?.toString() ?? null,
      }),
    );

    row.version = nextVersion;
    row.status = 'published';
    row.publishedAt = new Date();
    row.updatedBy = operator?.username ?? operator?.id?.toString() ?? null;
    const saved = await this.defRepo.save(row);
    this.logger.log(`Agent ${id} 发布 v${nextVersion}`);
    return this.toView(saved);
  }

  /** 启用/停用 */
  async setEnabled(id: string, enabled: boolean, operator?: OperatorInfo) {
    const row = await this.defRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Agent ${id} 不存在`);
    row.enabled = enabled;
    row.updatedBy = operator?.username ?? operator?.id?.toString() ?? null;
    const saved = await this.defRepo.save(row);
    this.logger.log(`Agent ${id} enabled=${enabled}`);
    return this.toView(saved);
  }

  /** 历史版本列表 */
  async listVersions(id: string) {
    const rows = await this.verRepo.find({
      where: { agentId: id },
      order: { version: 'DESC' },
    });
    return rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      version: r.version,
      changeNote: r.changeNote,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  }

  /** 回滚到指定版本：把该版本内容写回当前定义（作为新草稿），并发布为新版本 */
  async rollback(id: string, versionId: string, operator?: OperatorInfo) {
    const row = await this.defRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Agent ${id} 不存在`);
    const ver = await this.verRepo.findOne({ where: { id: versionId, agentId: id } });
    if (!ver) throw new NotFoundException(`版本 ${versionId} 不存在`);

    // 用历史版本内容覆盖当前定义
    row.name = ver.name;
    row.systemPrompt = ver.systemPrompt;
    row.model = ver.model;
    row.tools = ver.tools;
    row.capabilities = ver.capabilities ?? this.deriveFromTools(ver.tools);
    row.skills = ver.skills ?? null;
    row.maxSteps = ver.maxSteps;
    row.temperature = ver.temperature;
    row.memory = ver.memory;
    row.streaming = ver.streaming ?? true;

    // 发布为下一个版本
    const nextVersion = row.version + 1;
    await this.verRepo.save(
      this.verRepo.create({
        agentId: row.id,
        version: nextVersion,
        name: row.name,
        systemPrompt: row.systemPrompt,
        model: row.model,
        tools: row.tools,
        capabilities: row.capabilities,
        skills: row.skills,
        maxSteps: row.maxSteps,
        temperature: row.temperature,
        memory: row.memory,
        streaming: row.streaming,
        changeNote: `回滚自 v${ver.version}`,
        createdBy: operator?.username ?? operator?.id?.toString() ?? null,
      }),
    );
    row.version = nextVersion;
    row.status = 'published';
    row.publishedAt = new Date();
    row.updatedBy = operator?.username ?? operator?.id?.toString() ?? null;
    const saved = await this.defRepo.save(row);
    this.logger.log(`Agent ${id} 回滚到 v${ver.version} 并发布 v${nextVersion}`);
    return this.toView(saved);
  }

  /** 删除定义（谨慎使用） */
  async remove(id: string) {
    const row = await this.defRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`Agent ${id} 不存在`);
    await this.defRepo.remove(row);
    this.logger.log(`Agent ${id} 已删除`);
    return { ok: true };
  }

  /**
   * 供各服务拉取：返回所有 published 且 enabled 的定义（不含草稿/停用）
   */
  async getPublished(): Promise<AgentDefinitionEntity[]> {
    return this.defRepo.find({ where: { status: 'published', enabled: true } });
  }

  /**
   * 能力资产总览（Phase2.9 / D6.6，Phase3.9 补知识集合）：按 agent 聚合本地工具 / MCP 远程 /
   * 技能 / 知识集合。本地三类来自 DB 定义快照；知识集合 = 定义中 type:'mcp' 且 ref
   * 'knowledge/*' + config.collectionId 的绑定集（开放决策 7 = C），元数据拉 knowledge-service。
   */
  async capabilitiesOverview(agentId?: string) {
    const defs = await this.getPublished();
    const targets = agentId ? defs.filter((d) => d.id === agentId) : defs;
    // 预拉一次 knowledge-service 集合元数据；不可达则绑定集仍按 id 展示并标 unavailable
    const kMap = await this.fetchKnowledgeCollections();
    return targets.map((d) => {
      const caps: CapabilityRef[] = (d.capabilities ?? []).filter((c) => c.enabled !== false);
      const declared = Array.isArray(d.capabilities) && d.capabilities.length > 0;
      const tools = declared
        ? caps
            .filter((c) => c.type === 'tool')
            .map((c) => ({ type: 'tool' as const, name: c.ref, source: '代码注册' }))
        : (d.tools ?? []).map((t) => ({ type: 'tool' as const, name: t, source: '代码注册' }));
      const mcp = caps
        .filter((c) => c.type === 'mcp')
        .map((c) => ({
          type: 'mcp' as const,
          ref: c.ref,
          module: c.ref.split('/')[0] ?? '',
          name: c.ref.split('/').pop() ?? c.ref,
          source: 'mcp-gateway',
          longRunning: !!(c.config as { longRunning?: boolean } | undefined)?.longRunning,
        }));
      const skills: SkillRef[] = (d.skills ?? []) as SkillRef[];
      // 知识集合绑定（决策 7 = C：config.collectionId 显式引用即授权）
      const boundIds = [
        ...new Set(
          caps
            .filter((c) => c.type === 'mcp' && c.ref.startsWith('knowledge/'))
            .map((c) => (c.config as { collectionId?: string } | undefined)?.collectionId)
            .filter((id): id is string => !!id),
        ),
      ];
      const knowledge = boundIds.map((id) => {
        const meta = kMap.get(id);
        return {
          type: 'knowledge' as const,
          collectionId: id,
          name: meta?.name ?? id,
          source: 'knowledge-service',
          enabled: meta?.enabled ?? false,
          docCount: meta?.docCount ?? 0,
          available: !!meta,
          kServiceError: kMap.error ?? null,
        };
      });
      return {
        agentId: d.id,
        name: d.name,
        model: d.model,
        version: d.version,
        tools,
        mcp,
        skills: skills.map((s) => ({
          type: 'skill' as const,
          code: s.code,
          name: s.name,
          description: s.description,
          source: 'ai-service 技能库',
        })),
        knowledge,
        stats: { tools: tools.length, mcp: mcp.length, skills: skills.length, knowledge: knowledge.length },
      };
    });
  }

  /** 拉 knowledge-service 全部集合（id→元数据），不可达返回空 Map + error（分区降级，不整批失败） */
  private async fetchKnowledgeCollections(): Promise<
    Map<string, { name: string; enabled: boolean; docCount: number }> & { error?: string | null }
  > {
    const map = new Map() as Map<string, { name: string; enabled: boolean; docCount: number }> & {
      error?: string | null;
    };
    map.error = null;
    const url = this.configService.get<string>('KNOWLEDGE_SERVICE_URL', '');
    if (!url) return map;
    try {
      const key = this.configService.get<string>('INTERNAL_API_KEY', '');
      const res = await fetch(`${url.replace(/\/+$/, '')}/knowledge/mcp/list`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`knowledge-service HTTP ${res.status}`);
      const json = (await res.json()) as { data?: unknown } | unknown;
      const list = (Array.isArray(json) ? json : (json as { data?: unknown }).data ?? []) as Array<{
        id: string;
        name: string;
        enabled: boolean;
        docCount: number;
      }>;
      for (const c of list) {
        map.set(c.id, { name: c.name, enabled: c.enabled, docCount: c.docCount });
      }
    } catch (e) {
      map.error = e instanceof Error ? e.message : 'knowledge-service 不可达';
      this.logger.warn(`能力资产聚合: knowledge-service 拉取失败 - ${map.error}`);
    }
    return map;
  }

  /**
   * seed：确保内置 agent 定义在 DB 中存在（缺 id 则补录为 published v1）。
   *
   * DB 是 Agent 定义的唯一事实源（代码里的 *.agent.ts 已删除）。这里只做
   * “缺失补录”，不覆盖运营在 admin 编辑过的定义。部署升级时新增的内置定义
   * （如 deploy）会在此被补录，无需手动清库。
   */
  async seed() {
    const builtins = this.builtinSeeds();
    let seeded = 0;
    for (const b of builtins) {
      const existing = await this.defRepo.findOne({ where: { id: b.id } });
      if (existing) continue;
      const capabilities = b.capabilities ?? this.deriveFromTools(b.tools);
      await this.defRepo.save(
        this.defRepo.create({
          id: b.id,
          name: b.name,
          systemPrompt: b.systemPrompt,
          model: b.model,
          tools: b.tools,
          capabilities,
          skills: null,
          maxSteps: b.maxSteps,
          temperature: b.temperature ?? null,
          memory: b.memory,
          version: 1,
          status: 'published',
          enabled: true,
          publishedAt: new Date(),
          updatedBy: 'seed',
        }),
      );
      await this.verRepo.save(
        this.verRepo.create({
          agentId: b.id,
          version: 1,
          name: b.name,
          systemPrompt: b.systemPrompt,
          model: b.model,
          tools: b.tools,
          capabilities,
          skills: null,
          maxSteps: b.maxSteps,
          temperature: b.temperature ?? null,
          memory: b.memory,
          changeNote: '初始 seed',
          createdBy: 'seed',
        }),
      );
      seeded++;
    }
    if (seeded > 0) {
      this.logger.log(`agent_definitions seed 补录完成，写入 ${seeded} 个内置 agent`);
    }
    return { seeded };
  }

  /** 内置 agent 定义快照（一期 seed 数据源，迁移完成后可删） */
  private builtinSeeds(): Array<AgentDefinitionPayload & { id: string }> {
    return [
      {
        id: 'contract-risk',
        name: '合同翻译官',
        systemPrompt:
          '你是"合同翻译官"，帮助中国普通消费者识别合同中的风险与可主张权益。你的工作方式：\n' +
          '1. 若用户提供的合同文本来自 OCR，先调用 contract-cleaner 工具清洗成纯净的合同条款。\n' +
          '2. 调用 contract-rule 工具，用法定标准库扫描合同文本，识别风险信号。\n' +
          '3. 当涉及贷款分期、需要测算真实利率时，调用 contract-irr 工具精确计算真实年化利率（IRR/APR）、总利息、有效本金。\n' +
          '4. 把工具结果整合为结构化报告，严格按下文格式输出。\n' +
          '【输出语言与格式（硬性要求）】\n' +
          '- 所有展示给用户的文字必须用简体中文。\n' +
          '- 最终回答只输出一个 JSON 对象。不要输出任何思考、英文分析、markdown 标题、代码块围栏、前缀说明。\n' +
          '- JSON 以 { 开头、} 结尾，包含字段：scene、conclusion、keyNumbers、signals、rights、disclaimer。\n' +
          '【结论要求】必须给明确判断（风险等级 + 能否直接签）+ 带真实数字的 1-3 个致命风险 + 1-2 个签字前可执行动作 + 引导追问。\n' +
          '【合规红线】只解读不推荐；附带声明"以上内容由 AI 生成，仅用于理解合同，不构成法律/理财/投资建议。重大决策请咨询持牌专业人士。"；测算基于工具真实数值，不得臆造。',
        model: 'hy3',
        tools: ['contract-cleaner', 'contract-rule', 'contract-irr'],
        maxSteps: 12,
        temperature: 0.3,
        memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
      },
      {
        id: 'study-assistant',
        name: '科豆学习助手',
        systemPrompt:
          '你是科豆 AI 学习助手，面向少儿用户，用简单、友好、鼓励的语言回答。' +
          '可以使用生图工具把想法画出来。不知道答案时坦诚说明，不要编造。',
        model: 'hy3',
        tools: ['image-gen'],
        maxSteps: 8,
        temperature: 0.7,
        memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
      },
      {
        id: 'bianbian',
        name: '变变创作助手',
        systemPrompt:
          '你是变变创作助手，帮助小朋友把脑海中的角色和场景变成图画。' +
          '当用户描述想要的形象、场景或变身效果时，使用生图工具生成图片。' +
          '用童趣、鼓励的语言引导创作。',
        model: 'hy3',
        tools: ['image-gen'],
        maxSteps: 6,
        temperature: 0.8,
        memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
      },
      {
        id: 'deploy',
        name: '发布助手',
        systemPrompt:
          '你是「发布助手」，负责把代码发布到指定环境。你可以发布微前端模块（admin / portal），' +
          '支持全量发布、灰度发布、灰度转全量、按版本回滚。\n\n' +
          '【能力边界】\n' +
          '- 可发布模块：admin（管理后台）、portal（门户）。用 list_modules 确认，不要凭空猜测模块标识。\n' +
          '- 环境：local（本机，本地开发发布专用，**不污染远程 dev**）、dev（开发）、staging（预发）、prod（生产）。\n' +
          '  用户说"发布到本地""本机发布"时用 local；本地开发场景未明确环境时优先 local。\n\n' +
          '【参数收集：环境 + 模块 + 分支 + commit】\n' +
          '1. 用户说"发布 admin 到 dev" 这类完整指令时，直接执行，不要反复追问。\n' +
          '2. 缺环境：结合语境判断，无法判断时**必须询问**（默认 dev，但要向用户确认）。\n' +
          '3. 缺模块：调 list_modules 列出可发布模块，让用户选择。\n' +
          '4. **发布基于远程仓库的分支 + commit**，不是本地工作区：\n' +
          '   - branch 目标分支（默认 master）；commitId 目标 commit（默认该分支最新）。\n' +
          '   - 用户没提分支/commit 时，默认 branch=master + 最新 commit 即可，不要追问。\n' +
          '   - 用户说"发布我最新提交的""发布 feature 分支"时，用对应分支 + 最新 commit。\n' +
          '   - **本地改完代码必须先 commit & push 到仓库再发布**，否则拉不到新代码——发现用户要发布的代码不在仓库，如实提示。\n' +
          '5. 发布前用 get_current_versions 告知用户当前线上版本，让用户知道将要发生什么变化。\n\n' +
          '【发布流程】\n' +
          '1. 调 publish_pipeline 提交流水线（env + moduleKey + branch + commitId），拿到 jobId。\n' +
          '2. 流水线的完整阶段：check（校验）→ pull（发布目录 git 拉取分支/commit）→ build（构建）' +
          '→ upload（投递产物）/ restart（后端重启）→ version（写版本表）→ pointer（切指针）' +
          '→ verify（验证）→ cleanup（清理旧版本）。\n' +
          '3. 提交后必须调 get_job_status 轮询到终态（succeeded / failed），**不能提交完就告诉用户"已发布"**。\n' +
          '4. 轮询过程中简要汇报进度（当前阶段即可），不要刷屏输出完整日志。\n' +
          '5. 终态 succeeded：报告发布版本、环境、耗时，并提醒"gateway 版本缓存约 10s 生效"。\n\n' +
          '【灰度发布】\n' +
          '- 用户说"灰度""先放 10%""小流量"时，用 mode=grayscale + grayscaleRule。\n' +
          '- 灰度规则三种：{type:"percent",value:10}（10% 用户）、{type:"user-list",userIds:["u1","u2"]}、' +
          '{type:"header",key:"x-canary",values:["on"]}。\n' +
          '- 灰度**不会**切换全量指针，验证通过后用 promote_release 转全量（入参是灰度流水线的 jobId）。\n\n' +
          '【失败处理】\n' +
          '- 终态 failed：报告失败阶段（stage）与日志尾部要点，给出可操作建议，**不要无限重试**（最多重试 1 次）。\n' +
          '- 常见失败：构建失败（代码问题，非发布系统问题）、验证失败（产物未生效，检查 gateway 缓存）。\n' +
          '- 失败后主动提示：如需回退，用 list_releases（传 env 与 component）取上一版本，' +
          '再用 publish_version 切回（秒级生效）。**publish_version 必须同时传 component**，' +
          '否则历史版本（未登记版本表）会因查不到记录而切换失败。\n\n' +
          '【安全红线（硬性要求）】\n' +
          '- **发布 prod 前必须向用户二次确认**，说明环境与影响面；用户未确认前不得调用任何发布工具。\n' +
          '- prod 发布必须带 confirm=true（后端会校验，缺参直接拒绝）。\n' +
          '- 非 master 分支的版本禁止发 prod（后端会校验）。\n' +
          '- 绝不自行决定回滚生产环境；回滚前必须告知用户并取得同意。\n' +
          '- 不编造版本号：版本标签必须来自工具返回（get_current_versions / list_releases）。\n\n' +
          '【输出要求】\n' +
          '- 全程简体中文，简洁。不要输出工具原始 JSON，只讲结论与关键信息。\n' +
          '- 发布中给出进度，发布后给出结果；失败时给出原因与下一步建议。',
        // 官方直连 deepseek-chat 已下线，统一走 TokenHub 托管模型（deepseek-v4-flash）
        model: 'deepseek-v4-flash',
        tools: [
          'list_modules',
          'get_current_versions',
          'list_releases',
          'publish_pipeline',
          'get_job_status',
          'cancel_job',
          'publish_version',
          'rollback',
          'promote_release',
        ],
        capabilities: [
          { type: 'mcp', ref: 'deploy/list_modules', enabled: true },
          { type: 'mcp', ref: 'deploy/get_current_versions', enabled: true },
          { type: 'mcp', ref: 'deploy/list_releases', enabled: true },
          {
            type: 'mcp',
            ref: 'deploy/publish_pipeline',
            enabled: true,
            config: { longRunning: true, maxWaitMs: 600_000, intervalMs: 3000, requiresConfirm: true },
          },
          { type: 'mcp', ref: 'deploy/get_job_status', enabled: true },
          { type: 'mcp', ref: 'deploy/cancel_job', enabled: true, config: { requiresConfirm: true } },
          { type: 'mcp', ref: 'deploy/publish_version', enabled: true, config: { requiresConfirm: true } },
          { type: 'mcp', ref: 'deploy/rollback', enabled: true, config: { requiresConfirm: true } },
          { type: 'mcp', ref: 'deploy/promote_release', enabled: true, config: { requiresConfirm: true } },
        ],
        maxSteps: 12,
        temperature: 0.2,
        memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
      },
      {
        id: 'web-system-dev',
        name: 'web_system 研发助手',
        systemPrompt:
          '你是「web_system 研发助手」，一个能检索本仓库工程知识来帮助研发与自我迭代的助手。\n\n' +
          '【工作方式】\n' +
          '- 面对本仓库相关的架构/模块/接口/部署/Agent 平台问题时，**先检索知识集合再作答**，不要凭记忆编造结构。\n' +
          '- 集合含义：ws-arch（工程架构/服务/路由/表）、ws-agent-platform（Agent 平台玩法与契约）、ws-dev-guide（UI/部署/评测规范）。不确定问题该查哪个集合时，可先 knowledge_list 再决定，或三个都查。\n' +
          '- 检索出的内容带着来源（docTitle），回答时如引用请注明来源，帮助用户核对。\n\n' +
          '【边界】\n' +
          '- 知识库未覆盖的内容，如实说"知识库没有"，并建议查阅对应源码路径，不要用通用猜测填充。\n' +
          '- 涉及代码发布、流水线操作，请引导用户使用「发布助手」agent 或按其发布工具流程执行；本助手不做发布动作。\n' +
          '- 需要把新知识沉淀入库时，提示用户运行 scripts/self-knowledge/corpgen.mjs 重新生成语料后入库。\n\n' +
          '【输出】全程简体中文，简洁，结论优先。',
        model: 'deepseek-v4-flash',
        tools: [],
        capabilities: [
          { type: 'mcp', ref: 'knowledge/knowledge_list', enabled: true },
          {
            type: 'mcp',
            ref: 'knowledge/knowledge_search',
            enabled: true,
            config: { collectionId: 'ws-arch' },
          },
          {
            type: 'mcp',
            ref: 'knowledge/knowledge_search',
            enabled: true,
            config: { collectionId: 'ws-agent-platform' },
          },
          {
            type: 'mcp',
            ref: 'knowledge/knowledge_search',
            enabled: true,
            config: { collectionId: 'ws-dev-guide' },
          },
        ],
        maxSteps: 8,
        temperature: 0.2,
        memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
      },
    ];
  }

  /** 转展示视图 */
  private toView(r: AgentDefinitionEntity) {
    return {
      id: r.id,
      name: r.name,
      systemPrompt: r.systemPrompt,
      model: r.model,
      tools: r.tools,
      capabilities: r.capabilities,
      skills: r.skills,
      maxSteps: r.maxSteps,
      temperature: r.temperature,
      memory: r.memory,
      streaming: r.streaming,
      version: r.version,
      status: r.status,
      enabled: r.enabled,
      publishedAt: r.publishedAt,
      updatedBy: r.updatedBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  // ── capabilities 辅助 ──

  /** 从工具名数组派生 capabilities（老数据兼容） */
  private deriveFromTools(tools: string[]): CapabilityRef[] {
    return (tools || []).map((t) => ({ type: 'tool' as const, ref: t, enabled: true }));
  }

  /** 归一化 capabilities：不传则从 tools 派生；tools 列只保留本地工具名 */
  private normalizeCapabilities(payload: AgentDefinitionPayload): {
    capabilities: CapabilityRef[];
    tools: string[];
  } {
    const caps = payload.capabilities?.length
      ? payload.capabilities
      : this.deriveFromTools(payload.tools);
    const tools = caps
      .filter((c) => c.type === 'tool' && c.enabled !== false)
      .map((c) => c.ref);
    return { capabilities: caps, tools };
  }

  /** 从 capabilities 解析技能摘要目录（查技能表补 name/description） */
  private async resolveSkills(capabilities: CapabilityRef[]): Promise<SkillRef[] | null> {
    const codes = (capabilities || [])
      .filter((c) => c.type === 'skill' && c.enabled !== false)
      .map((c) => c.ref);
    if (!codes.length) return null;
    const rows = await this.skillService.findByCodes(codes);
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      requiredTools: r.requiredTools ?? undefined,
      enabled: true,
    }));
  }

  /** publish 兜底：行内 capabilities/skills 为空时从 tools 派生并落库 */
  private async ensureCapabilities(row: AgentDefinitionEntity): Promise<{
    capabilities: CapabilityRef[];
    skills: SkillRef[] | null;
  }> {
    let capabilities = row.capabilities;
    let skills = row.skills;
    if (!capabilities?.length) {
      capabilities = this.deriveFromTools(row.tools || []);
      skills = null;
      row.capabilities = capabilities;
      row.skills = null;
      await this.defRepo.save(row);
    }
    return { capabilities, skills };
  }
}
