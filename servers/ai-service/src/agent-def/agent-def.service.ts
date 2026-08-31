import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
   * seed：把内置 agent 定义写入 DB（仅当表里完全没有记录时）。
   * 一期迁移：现有 contract-risk / study-assistant / bianbian 三个定义。
   * 迁移完成后，代码里的 *.agent.ts 将被删除，DB 成为唯一事实源。
   */
  async seed() {
    const count = await this.defRepo.count();
    if (count > 0) {
      this.logger.log(`agent_definitions 已有 ${count} 条，跳过 seed`);
      return { seeded: 0 };
    }
    const builtins = this.builtinSeeds();
    let seeded = 0;
    for (const b of builtins) {
      const capabilities = this.deriveFromTools(b.tools);
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
    this.logger.log(`agent_definitions seed 完成，写入 ${seeded} 个内置 agent`);
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
