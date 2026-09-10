import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DictType } from './dict-type.entity';
import { DictField, DICT_FIELD_MAX_LENGTH } from './dict-field.entity';
import { DictAttrValue, DictItem } from './dict-item.entity';
import {
  CreateDictItemDto,
  CreateDictTypeDto,
  DictFieldDto,
  ListDictItemsDto,
  ListDictTypesDto,
  UpdateDictItemDto,
  UpdateDictTypeDto,
} from './dict.dto';

/**
 * 内置字典：模块启动时幂等补齐 type + fields。
 * 只补「结构」，不塞数据行 —— TOKENHUB_MODELS 的教训：代码里的默认值会与
 * 运维实际配置打架，所以 item 一律由人在页面维护。
 */
interface BuiltinDict {
  code: string;
  name: string;
  description: string;
  sort: number;
  fields: DictFieldDto[];
}

const BUILTIN_DICTS: readonly BuiltinDict[] = [
  {
    code: 'llm_models',
    name: '大模型清单',
    description: 'AI Agent 可用模型。value = 网关 model id（如 hy4-preview），label = 页面展示名',
    sort: 10,
    fields: [
      { name: 'provider', label: '提供方', type: 'enum', required: true, defaultValue: 'tokenhub', options: ['tokenhub', 'hy3', 'other'], sort: 10 },
      { name: 'context_window', label: '上下文窗口(token)', type: 'number', length: 12, sort: 20 },
      { name: 'supports_vision', label: '支持视觉', type: 'boolean', sort: 30 },
      { name: 'note', label: '备注', type: 'text', length: 200, sort: 40 },
    ],
  },
];

export interface DictTypeWithCount extends DictType {
  itemsCount: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class DictService implements OnModuleInit {
  private readonly logger = new Logger(DictService.name);

  constructor(
    @InjectRepository(DictType)
    private readonly typeRepo: Repository<DictType>,
    @InjectRepository(DictField)
    private readonly fieldRepo: Repository<DictField>,
    @InjectRepository(DictItem)
    private readonly itemRepo: Repository<DictItem>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureBuiltin();
  }

  /** 补齐内置字典结构与字段（幂等；字段仅在字典「还没有任何字段」时补齐，避免覆盖人工改动） */
  async ensureBuiltin(): Promise<void> {
    for (const d of BUILTIN_DICTS) {
      let type = await this.typeRepo.findOne({ where: { code: d.code } });
      if (!type) {
        type = await this.typeRepo.save(
          this.typeRepo.create({ code: d.code, name: d.name, description: d.description, sort: d.sort, builtin: true, enabled: true }),
        );
        this.logger.log(`补齐内置字典: ${d.code}`);
      } else if (!type.builtin) {
        type.builtin = true;
        await this.typeRepo.save(type);
      }
      const existing = await this.fieldRepo.count({ where: { typeCode: d.code } });
      if (existing === 0) {
        await this.fieldRepo.save(d.fields.map((f) => this.fieldRepo.create({ ...f, typeCode: d.code })));
        this.logger.log(`补齐内置字典字段: ${d.code} (${d.fields.length})`);
      }
    }
  }

  // ===== 字典类型 =====

  async listTypes(query: ListDictTypesDto): Promise<DictTypeWithCount[]> {
    const keyword = query.keyword?.trim();
    const qb = this.typeRepo.createQueryBuilder('t');
    if (keyword) {
      qb.andWhere('(t.code LIKE :kw OR t.name LIKE :kw)', { kw: `%${keyword}%` });
    }
    const types = await qb.orderBy('t.sort', 'ASC').addOrderBy('t.code', 'ASC').getMany();

    // 一次聚合取各字典的明细数，避免 N+1
    const counts = await this.itemRepo
      .createQueryBuilder('i')
      .select('i.typeCode', 'typeCode')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('i.typeCode')
      .getRawMany<{ typeCode: string; cnt: string }>();
    const countMap = new Map(counts.map((c) => [c.typeCode, Number(c.cnt) || 0]));
    return types.map((t) => ({ ...t, itemsCount: countMap.get(t.code) ?? 0 }));
  }

  async createType(dto: CreateDictTypeDto): Promise<DictType> {
    if (await this.typeRepo.findOne({ where: { code: dto.code } })) {
      throw new BadRequestException(`字典已存在: ${dto.code}`);
    }
    return this.typeRepo.save(this.typeRepo.create(dto));
  }

  async updateType(id: string, dto: UpdateDictTypeDto): Promise<DictType> {
    const row = await this.typeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`字典不存在: ${id}`);
    Object.assign(row, dto);
    return this.typeRepo.save(row);
  }

  /** 删除字典类型：连带删除其字段与明细。builtin 拒绝（可能被业务链路依赖） */
  async removeType(id: string): Promise<{ ok: boolean }> {
    const row = await this.typeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`字典不存在: ${id}`);
    if (row.builtin) throw new BadRequestException(`内置字典不可删除: ${row.code}`);
    await this.itemRepo.delete({ typeCode: row.code });
    await this.fieldRepo.delete({ typeCode: row.code });
    await this.typeRepo.remove(row);
    return { ok: true };
  }

  // ===== 字段定义 =====

  listFields(typeCode: string): Promise<DictField[]> {
    return this.fieldRepo.find({ where: { typeCode }, order: { sort: 'ASC', name: 'ASC' } });
  }

  /**
   * 整体覆盖保存字段定义（前端提交最终态）。
   * 已存在的字段保留主键，未出现在列表里的字段被删除 —— 删除只丢这一列的 attrs，
   * 不删数据行，避免"改定义即丢数据"。
   */
  async replaceFields(typeCode: string, dtos: DictFieldDto[]): Promise<DictField[]> {
    const type = await this.typeRepo.findOne({ where: { code: typeCode } });
    if (!type) throw new NotFoundException(`字典不存在: ${typeCode}`);

    const names = dtos.map((d) => d.name);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('字段名不可重复');
    }
    await this.fieldRepo.delete({ typeCode });
    if (dtos.length === 0) return [];
    return this.fieldRepo.save(dtos.map((d) => this.fieldRepo.create({ ...d, typeCode })));
  }

  // ===== 字典项 =====

  async listItems(typeCode: string, query: ListDictItemsDto): Promise<Paged<DictItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.itemRepo.createQueryBuilder('i').where('i.typeCode = :typeCode', { typeCode });
    const keyword = query.keyword?.trim();
    if (keyword) {
      qb.andWhere('(i.value LIKE :kw OR i.label LIKE :kw)', { kw: `%${keyword}%` });
    }
    if (query.enabled !== undefined) {
      qb.andWhere('i.enabled = :enabled', { enabled: query.enabled });
    }
    const [items, total] = await qb
      .orderBy('i.sort', 'ASC')
      .addOrderBy('i.value', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  /** 业务侧消费：某字典的全部启用项（字典本身停用则视为空） */
  async listEnabledItems(typeCode: string): Promise<DictItem[]> {
    const type = await this.typeRepo.findOne({ where: { code: typeCode } });
    if (!type || !type.enabled) return [];
    return this.itemRepo.find({ where: { typeCode, enabled: true }, order: { sort: 'ASC', value: 'ASC' } });
  }

  async createItem(dto: CreateDictItemDto): Promise<DictItem> {
    const type = await this.typeRepo.findOne({ where: { code: dto.typeCode } });
    if (!type) throw new BadRequestException(`字典不存在: ${dto.typeCode}`);
    if (await this.itemRepo.findOne({ where: { typeCode: dto.typeCode, value: dto.value } })) {
      throw new BadRequestException(`字典项已存在: ${dto.typeCode}/${dto.value}`);
    }
    const fields = await this.listFields(dto.typeCode);
    const attrs = this.validateAttrs(fields, dto.attrs ?? {});
    return this.itemRepo.save(this.itemRepo.create({ ...dto, attrs }));
  }

  async updateItem(id: string, dto: UpdateDictItemDto): Promise<DictItem> {
    const row = await this.itemRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`字典项不存在: ${id}`);
    if (dto.attrs !== undefined) {
      const fields = await this.listFields(row.typeCode);
      row.attrs = this.validateAttrs(fields, dto.attrs);
    }
    const { attrs: _attrs, ...rest } = dto;
    Object.assign(row, rest);
    return this.itemRepo.save(row);
  }

  async removeItem(id: string): Promise<{ ok: boolean }> {
    const row = await this.itemRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`字典项不存在: ${id}`);
    await this.itemRepo.remove(row);
    return { ok: true };
  }

  /**
   * 按字段定义校验 attrs，返回**只含已定义字段**的干净对象。
   * 未定义的多余 key 保留在数据里但不再返回（避免"改字段定义即丢数据"），读取时不可见。
   */
  validateAttrs(
    fields: DictField[],
    attrs: Record<string, DictAttrValue>,
  ): Record<string, DictAttrValue> {
    const clean: Record<string, DictAttrValue> = {};
    for (const f of fields) {
      const raw = attrs[f.name];
      if (raw === undefined || raw === null || raw === '') {
        if (f.required) throw new BadRequestException(`字段「${f.label}」必填`);
        if (f.defaultValue !== null && f.defaultValue !== undefined) {
          clean[f.name] = this.castValue(f, f.defaultValue);
        } else {
          clean[f.name] = null;
        }
        continue;
      }
      clean[f.name] = this.castValue(f, raw);
    }
    return clean;
  }

  /** 单值校验：类型 + 长度 + 枚举命中 */
  private castValue(f: DictField, raw: DictAttrValue): DictAttrValue {
    const maxLength = f.length ?? DICT_FIELD_MAX_LENGTH[f.type];
    switch (f.type) {
      case 'boolean':
        return raw === true || raw === 'true' || raw === '1' || raw === 1;
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        if (Number.isNaN(n)) throw new BadRequestException(`字段「${f.label}」需为数字`);
        if (String(Math.trunc(n)).replace('-', '').length > maxLength) {
          throw new BadRequestException(`字段「${f.label}」位数超出上限 ${maxLength}`);
        }
        return n;
      }
      case 'enum': {
        const v = String(raw);
        if (!f.options?.length) throw new BadRequestException(`字段「${f.label}」未配置枚举项`);
        if (!f.options.includes(v)) {
          throw new BadRequestException(`字段「${f.label}」取值必须是: ${f.options.join(' / ')}`);
        }
        return v;
      }
      case 'date': {
        const v = String(raw);
        if (Number.isNaN(Date.parse(v))) throw new BadRequestException(`字段「${f.label}」需为合法日期`);
        return v;
      }
      case 'string':
      case 'text':
      default: {
        const v = String(raw);
        if (v.length > maxLength) {
          throw new BadRequestException(`字段「${f.label}」长度 ${v.length} 超出上限 ${maxLength}`);
        }
        return v;
      }
    }
  }
}
