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
  /**
   * 初始数据行：**仅在该字典还没有任何 item 时**插入一次（幂等，不覆盖人工改动）。
   * llm_models 刻意不预置（内容随业务变化，由运维维护）；而
   * contract_scene / contract_risk_level / operation_log_type 是从代码常量迁移过来的，
   * 不预置会让迁移期前端下拉直接空掉。
   */
  seedItems?: ReadonlyArray<{
    value: string;
    label: string;
    attrs?: Record<string, DictAttrValue>;
    sort?: number;
  }>;
}

const BUILTIN_DICTS: readonly BuiltinDict[] = [
  {
    code: 'llm_models',
    name: '大模型清单',
    description: 'AI Agent 可用模型 + 单价（元/1K tokens）。单价用于 run 成本核算，未填按 0 计',
    sort: 10,
    fields: [
      { name: 'provider', label: '提供方', type: 'enum', required: true, defaultValue: 'tokenhub', options: ['tokenhub', 'hy3', 'other'], sort: 10 },
      { name: 'context_window', label: '上下文窗口(token)', type: 'number', length: 12, sort: 20 },
      { name: 'supports_vision', label: '支持视觉', type: 'boolean', sort: 30 },
      { name: 'note', label: '备注', type: 'text', length: 200, sort: 40 },
      // 价格字段：2026-09-11 由旧表 model_pricing 迁入（该表随之退役留档，见 specs/llm-models-unify/design.md）。
      // 口径沿用旧表「每 1K tokens」；**非必填** —— 允许「模型可用但未配价」（成本记 0，页面提示补配）。
      // ⚠️ 字段定义（label/length/defaultValue）与已上线环境 dict_fields 保持一致，避免代码与库漂移。
      { name: 'input_price_per1k', label: '输入价（元/1K）', type: 'number', length: 12, sort: 50 },
      { name: 'output_price_per1k', label: '输出价（元/1K）', type: 'number', length: 12, sort: 60 },
      { name: 'currency', label: '币种', type: 'string', length: 8, defaultValue: 'CNY', sort: 70 },
    ],
  },
  {
    code: 'contract_scene',
    name: '合同场景',
    description: '合同翻译官可选场景。⚠️ 新增场景需同时补法定标准库，否则该场景下判定结果为空',
    sort: 20,
    fields: [
      { name: 'hint', label: '选择提示', type: 'string', length: 64, sort: 10 },
    ],
    seedItems: [
      { value: 'consumer-loan', label: '消费贷', attrs: { hint: '网贷 / 消费分期' }, sort: 10 },
      { value: 'car-loan', label: '车贷', attrs: { hint: '购车分期' }, sort: 20 },
      { value: 'medical-insurance', label: '医疗险', attrs: { hint: '健康 / 医疗类保险' }, sort: 30 },
      { value: 'car-insurance', label: '车险', attrs: { hint: '车辆保险' }, sort: 40 },
      { value: 'rental', label: '租赁', attrs: { hint: '租房 / 设备租赁' }, sort: 50 },
      { value: 'other', label: '其他', attrs: {}, sort: 90 },
    ],
  },
  {
    code: 'contract_risk_level',
    name: '合同风险等级',
    description: '风险信号严重度（展示用：文案、颜色、排序）；判定逻辑与计分公式仍在代码里',
    sort: 30,
    fields: [
      { name: 'color', label: '配色语义', type: 'enum', options: ['danger', 'warn', 'ok'], sort: 10 },
      { name: 'icon', label: '图标名', type: 'string', length: 32, sort: 20 },
      { name: 'weight', label: '计入权重', type: 'number', length: 4, sort: 30 },
    ],
    seedItems: [
      { value: 'danger', label: '高风险', attrs: { color: 'danger', icon: 'alert', weight: 20 }, sort: 10 },
      { value: 'warn', label: '需关注', attrs: { color: 'warn', icon: 'warning', weight: 10 }, sort: 20 },
      { value: 'ok', label: '正常', attrs: { color: 'ok', icon: 'check', weight: 0 }, sort: 30 },
    ],
  },
  {
    code: 'operation_log_type',
    name: '操作日志类型',
    description: 'admin 操作日志的 type 取值（写入端与筛选下拉共用）',
    sort: 40,
    fields: [],
    seedItems: [
      { value: 'login', label: '登录', sort: 10 },
      { value: 'logout', label: '退出', sort: 20 },
      { value: 'update_setting', label: '修改设置', sort: 30 },
      { value: 'create_user', label: '创建用户', sort: 40 },
      { value: 'delete', label: '删除', sort: 50 },
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

  /** 补齐内置字典结构与字段（幂等；字段按「逐个补缺」同步，已存在的一律不动） */
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
      // 字段按「逐个补缺」同步：缺哪个补哪个，已存在的字段一律不动（保护人工改动）。
      // 旧规则是"该字典一个字段都没有时才补"，导致给内置字典新增字段后存量环境永远补不上。
      await this.ensureFields(d.code, d.fields);

      // 初始数据：仅在该字典一条 item 都没有时插入一次（不覆盖人工改动）
      if (d.seedItems?.length) {
        const itemCount = await this.itemRepo.count({ where: { typeCode: d.code } });
        if (itemCount === 0) {
          await this.itemRepo.save(
            d.seedItems.map((it) =>
              this.itemRepo.create({
                typeCode: d.code,
                value: it.value,
                label: it.label,
                attrs: it.attrs ?? null,
                sort: it.sort ?? 0,
                enabled: true,
              }),
            ),
          );
          this.logger.log(`补齐内置字典初始数据: ${d.code} (${d.seedItems.length})`);
        }
      }
    }
  }

  /**
   * 按 `name` 增量补齐内置字段：缺失的插入，已存在的**不覆盖**。
   *
   * 为什么不能沿用「字段数为 0 才补齐」：内置字典会随版本新增字段（如 `llm_models`
   * 新增的三个价格字段），而老环境早已有若干字段，旧写法会让新字段永远建不出来。
   * 不覆盖已存在字段，是为了保护运维改过的 label / 长度上限 / 是否必填。
   */
  private async ensureFields(typeCode: string, defined: DictFieldDto[]): Promise<void> {
    if (!defined.length) return;
    const rows = await this.fieldRepo.find({ where: { typeCode } });
    const have = new Set(rows.map((r) => r.name));
    const missing = defined.filter((f) => !have.has(f.name));
    if (!missing.length) return;
    await this.fieldRepo.save(missing.map((f) => this.fieldRepo.create({ ...f, typeCode })));
    this.logger.log(
      `补齐内置字典字段: ${typeCode}（新增 ${missing.map((f) => f.name).join(', ')}）`,
    );
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
