import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import AdmZip from 'adm-zip';
import { AgentSkillEntity } from './entities/agent-skill.entity';
import { AgentDefinitionEntity } from '../agent-def/entities/agent-definition.entity';
import { SaveSkillDto, ParsedSkillFile } from './dto/skill.dto';

/** 当前用户（来自 req.user） */
export interface OperatorInfo {
  id?: string | number;
  username?: string;
  [key: string]: unknown;
}

/**
 * 技能库服务（SKILL.md）
 *
 * 职责：技能 CRUD + zip 技能包一键导入（解析 frontmatter + 正文入库）。
 * on-demand 挂载时：ai-agent 从 ai-service 拉取技能的 name/description 注入
 * system，模型需要时调 load_skill 拉取 content 全文。
 */
@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    @InjectRepository(AgentSkillEntity)
    private readonly repo: Repository<AgentSkillEntity>,
    @InjectRepository(AgentDefinitionEntity)
    private readonly defRepo: Repository<AgentDefinitionEntity>,
  ) {}

  /** 列表（不含 content 大字段） */
  async list() {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    return rows.map((r) => this.toView(r, false));
  }

  /** 详情（含正文） */
  async get(code: string) {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`技能 ${code} 不存在`);
    return this.toView(row, true);
  }

  /** 按 code 批量查询（AgentDef 发布时解析技能目录用；不存在/停用的跳过） */
  async findByCodes(codes: string[]): Promise<AgentSkillEntity[]> {
    if (!codes?.length) return [];
    return this.repo.find({ where: codes.map((c) => ({ code: c, enabled: true })) });
  }

  /** 新建 */
  async create(dto: SaveSkillDto, operator?: OperatorInfo) {
    const code = dto.code.trim();
    const exists = await this.repo.findOne({ where: { code } });
    if (exists) throw new BadRequestException(`技能 ${code} 已存在，请改用编辑`);
    const saved = await this.repo.save(
      this.repo.create({
        code,
        name: dto.name,
        description: dto.description,
        version: dto.version || '1.0.0',
        content: dto.content,
        requiredTools: dto.requiredTools ?? null,
        enabled: dto.enabled ?? true,
        createdBy: operator?.username ?? operator?.id?.toString() ?? null,
      }),
    );
    this.logger.log(`技能 ${code} 已创建`);
    return this.toView(saved, true);
  }

  /** 编辑（全量覆盖） */
  async update(code: string, dto: SaveSkillDto, operator?: OperatorInfo) {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`技能 ${code} 不存在`);
    row.name = dto.name;
    row.description = dto.description;
    row.version = dto.version || row.version;
    row.content = dto.content;
    row.requiredTools = dto.requiredTools ?? null;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    row.createdBy = operator?.username ?? operator?.id?.toString() ?? null;
    const saved = await this.repo.save(row);
    this.logger.log(`技能 ${code} 已更新`);
    return this.toView(saved, true);
  }

  /** 删除（被 Agent 的 capabilities 引用时拒绝，防止 Agent 配置悬空） */
  async remove(code: string) {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`技能 ${code} 不存在`);

    // 检查是否有 Agent 引用该技能
    const defs = await this.defRepo.find();
    const users = defs.filter((d) =>
      (d.capabilities ?? []).some((c) => c.type === 'skill' && c.ref === code),
    );
    if (users.length > 0) {
      const names = users.map((u) => `${u.name || u.id}`).join('、');
      throw new BadRequestException(`技能 ${code} 正被 Agent 引用（${names}），请先在对应 Agent 中移除该技能后再删除`);
    }

    await this.repo.remove(row);
    this.logger.log(`技能 ${code} 已删除`);
    return { ok: true };
  }

  /**
   * zip 技能包一键导入：
   * 解压 → 递归找 SKILL.md → 解析 frontmatter + 正文 → 入库
   * 规则：包内多个 SKILL.md 取第一个；code 已存在则拒绝（改走编辑）。
   */
  async importZip(buffer: Buffer, operator?: OperatorInfo): Promise<unknown> {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new BadRequestException('无法解析 zip 包（请上传标准 zip 技能包）');
    }

    const entries = zip.getEntries();
    const skillEntry = entries.find((e) => !e.isDirectory && /SKILL\.md$/i.test(e.entryName));
    if (!skillEntry) {
      throw new BadRequestException('zip 包内未找到 SKILL.md');
    }

    const parsed = this.parseSkillFile(skillEntry.getData().toString('utf8'));
    const exists = await this.repo.findOne({ where: { code: parsed.code } });
    if (exists) throw new BadRequestException(`技能 ${parsed.code} 已存在，请改用编辑`);

    const saved = await this.repo.save(
      this.repo.create({
        ...parsed,
        requiredTools: null,
        enabled: true,
        createdBy: operator?.username ?? operator?.id?.toString() ?? null,
      }),
    );
    this.logger.log(`技能 ${parsed.code} 已从 zip 导入`);
    return this.toView(saved, true);
  }

  /** 解析 SKILL.md：YAML frontmatter（--- 包裹）+ Markdown 正文 */
  private parseSkillFile(raw: string): ParsedSkillFile {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) throw new BadRequestException('SKILL.md 缺少 YAML frontmatter（--- 包裹）');

    const meta: Record<string, string> = {};
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && val) meta[key] = val;
    }

    const name = meta['name'] || '';
    const description = meta['description'] || '';
    if (!name) throw new BadRequestException('SKILL.md frontmatter 缺少 name');
    if (!description) throw new BadRequestException('SKILL.md frontmatter 缺少 description');

    return {
      code: name,
      name,
      description,
      version: meta['version'] || '1.0.0',
      content: (m[2] || '').trim(),
    };
  }

  /** 展示视图（list 不带 content，详情带） */
  private toView(r: AgentSkillEntity, withContent: boolean) {
    const base = {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      version: r.version,
      requiredTools: r.requiredTools,
      enabled: r.enabled,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
    if (!withContent) return base;
    return { ...base, content: r.content };
  }
}
