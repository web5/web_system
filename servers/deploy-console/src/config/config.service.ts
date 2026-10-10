import { createHash } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConfigItemEntity,
  CONFIG_SCOPES,
  ConfigScope,
  CONFIG_LAYERS,
  CONFIG_VALUE_TYPES,
  CONFIG_APPLY_MODES,
} from '../entities/config-item.entity';
import { ConfigSnapshotEntity } from '../entities/config-snapshot.entity';
import { ConfigRevisionEntity } from '../entities/config-revision.entity';
import { ConfigDeliveryEntity } from '../entities/config-delivery.entity';
import { decryptSecret, encryptSecret, SECRET_MASK } from './config-crypto';

export type ResolvedConfig = Record<string, string>;

/** 下发项：带来源作用域，供 `.env.generated` 写来源注释（排障时看清「这个值从哪来」） */
export interface DispatchItem {
  key: string;
  value: string;
  /** 来源作用域：`global` / `env:<id>` / `module:<env>/<mod>` */
  scope: string;
}

export interface UpsertConfigDto {
  scope: ConfigScope;
  envId?: string;
  moduleKey?: string;
  key: string;
  value: string;
  isSecret?: boolean;
  description?: string;
  /** 层（见 CONFIG_LAYERS）；不传时保留既有值，新行默认 `app` */
  layer?: string;
  /** 值类型；不传保留既有值，新行默认 `string` */
  valueType?: string;
  /** 生效方式；不传保留既有值，新行默认 `restart` */
  applyMode?: string;
  /** 是否可下发；不传保留既有值，新行默认 `true` */
  deliverable?: boolean;
  /** 校验规则；传 null 表示清空 */
  validators?: {
    pattern?: string;
    enum?: string[];
    min?: number;
    max?: number;
  } | null;
  /** 变更原因（进 config_revisions，便于事后复盘；prod 密钥建议必填） */
  reason?: string;
}

/** 配置校验规则（UpsertConfigDto.validators 的具名形式） */
export interface ConfigValidators {
  pattern?: string;
  enum?: string[];
  min?: number;
  max?: number;
}

/** 作用域优先级：数字越大越优先（后者覆盖前者） */
const SCOPE_PRIORITY: Record<string, number> = { global: 0, env: 1, module: 2 };

/**
 * **永不写入 `.env.generated`** 的保留键（引导 / 基础设施 / 平台注入）。
 *
 * 判据（`specs/service-config-delivery/design.md` §2「什么配置该放哪」）：
 * - `CONFIG_MASTER_KEY`：引导凭据，鸡生蛋 —— 读配置中心本身要先有它，必须留在 `.env`；
 * - `INTERNAL_API_KEY`：**已改为可下发**（2026-09-24 拍板，见
 *   `specs/service-config-delivery/internal-key-delivery-design.md`）。
 *   理由：下发走「部署时推送 / 流水线脚本拉取」，**不是服务进程自拉**，
 *   `design.md:83` 已判定此路径「鸡生蛋：不涉及」。脚本凭据由平台注入（`CONSOLE_TOKEN`）。
 *   唯一例外：**deploy-console 自身仍留 `.env`** —— 它是下发链的根凭据持有者，
 *   且给自己写 `.env.generated` 会触发自杀式重启（`design.md` §4.0）。
 * - `MYSQL_*` / `REDIS_*`：基础设施连接，启动必需，且平台自己也在连同一库，下发易成单点；
 * - `PATH` / `HOME`：平台注入键（进程环境只保留这几个），下发进服务 `.env` 只会误导；
 * - `PM2_*`：平台推导的进程信息（名称/入口/工作目录），由 pm2 决定，不由服务 `.env` 决定；
 * - `CONSOLE_*`：平台自身接口地址与凭据，仅供动作脚本使用，不属于服务进程配置。
 *
 * 支持 `PREFIX_*` 通配（前缀匹配）。
 */
export const RESERVED_LOCAL_KEYS: readonly string[] = [
  'CONFIG_MASTER_KEY',
  // 注：`INTERNAL_API_KEY` 已不在本列表 —— 可走配置中心下发（见上方注释与
  // specs/service-config-delivery/internal-key-delivery-design.md）
  'PATH',
  'HOME',
  'CONSOLE_API',
  'CONSOLE_TOKEN',
  'MYSQL_*',
  'REDIS_*',
  'PM2_*',
];

/** 是否为「永不下发」的保留键（见 {@link RESERVED_LOCAL_KEYS}） */
export function isReservedLocalKey(key: string): boolean {
  return RESERVED_LOCAL_KEYS.some((p) =>
    p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p,
  );
}

/**
 * 该行能否下发到服务进程（2026-10-10：layer 数据判定 + 保留键名单**双保险**）。
 *
 * 为什么留双保险：`synchronize` 加 `layer` 列时**存量行一律填默认值 `app`**，
 * 而存量里混着 `MYSQL_*`、`CONSOLE_TOKEN` 这些必须永不下发的键。若只认 layer，
 * 在迁移脚本回填之前（或有人手工插行忘写 layer 时），DB 密码就会被写进服务的
 * `.env.generated`。保留键名单作为兜底，保证"没回填也安全"，layer 则负责向前扩展——
 * 将来新增平台能力只要落 `layer='platform'` 的行即可，**不必再改这段代码**。
 */
export function isRowDeliverable(row: {
  key: string;
  layer?: string;
  deliverable?: boolean;
}): boolean {
  if (row.deliverable === false) return false;
  const layer = (row.layer ?? '').trim();
  if (layer === 'bootstrap' || layer === 'platform') return false;
  return !isReservedLocalKey(row.key);
}

/**
 * 值指纹：sha256 前 12 位 hex。
 *
 * 密钥与非密钥**口径一致**（都对待存的那个值做 hash：密钥用密文），
 * 故页面/diff 可安全展示"变没变"，不必触碰明文。
 */
export function valueFingerprint(value: string): string {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

/**
 * 按 `valueType` + `validators` 校验配置值（纯函数，便于单测）。
 *
 * 为什么要在写入时就卡：配置项错值（如 `PORT` 写成 `8080端口`）在下发时看不出来，
 * 要到服务启动失败才暴露，而那时链路已经跑了一半。返回错误列表而非抛错，
 * 便于一次把多条问题都报出来。
 */
export function validateConfigValue(
  value: string,
  opts: { valueType?: string; validators?: ConfigValidators | null } = {},
): string[] {
  const errs: string[] = [];
  const raw = String(value ?? '');
  switch (opts.valueType) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(raw)) errs.push('应为数字');
      break;
    case 'bool':
      if (!['true', 'false'].includes(raw)) errs.push('应为 true / false');
      break;
    case 'json':
      try {
        JSON.parse(raw);
      } catch {
        errs.push('应为合法 JSON');
      }
      break;
    case 'port': {
      if (!/^\d+$/.test(raw)) errs.push('端口应为正整数');
      else {
        const n = Number(raw);
        if (n < 1 || n > 65535) errs.push('端口应在 1–65535 之间');
      }
      break;
    }
    case 'path':
      if (!raw.trim()) errs.push('路径不能为空');
      else if (/[\r\n]/.test(raw)) errs.push('路径不能包含换行');
      break;
    default:
      break;
  }

  const v = opts.validators;
  if (v) {
    if (v.enum?.length && !v.enum.includes(raw)) {
      errs.push(`取值必须是 ${v.enum.join(' / ')} 之一`);
    }
    if (v.pattern) {
      try {
        if (!new RegExp(v.pattern).test(raw)) errs.push(`不匹配规则 ${v.pattern}`);
      } catch {
        errs.push(`校验规则的正则非法：${v.pattern}`);
      }
    }
    if (v.min !== undefined && Number(raw) < v.min) errs.push(`不能小于 ${v.min}`);
    if (v.max !== undefined && Number(raw) > v.max) errs.push(`不能大于 ${v.max}`);
  }
  return errs;
}

/** 作用域标签：写进下发文件的来源注释 */
function scopeLabel(row: { scope: string; envId?: string; moduleKey?: string }): string {
  if (row.scope === 'global') return 'global';
  if (row.scope === 'env') return `env:${row.envId}`;
  return `module:${row.envId}/${row.moduleKey}`;
}

/**
 * dotenv 值转义：安全字符原样输出，其余用双引号包裹并转义。
 *
 * 为什么必须转义：密钥里可能出现引号、空格、换行、`#`，
 * 直接拼接会把 `.env.generated` 写坏（值被截断或被当成注释），而且**静默**。
 */
export function escapeEnvValue(value: string): string {
  if (value !== '' && /^[A-Za-z0-9_./:@+,=-]+$/.test(value)) return value;
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`;
}

/**
 * 把下发项渲染成 `.env.generated` 内容（纯函数，便于单测）。
 *
 * - 头部注释写清来源服务/环境/时间与回退方式；
 * - 每个键上方标一行来源作用域 —— 排障时一眼看清「这个值从哪来」；
 * - 值经 {@link escapeEnvValue} 转义，含引号/换行的密钥不会写坏文件。
 */
export function renderGeneratedEnvFile(
  items: DispatchItem[],
  meta: { envId: string; serviceKey: string; generatedAt?: Date },
): string {
  const ts = (meta.generatedAt ?? new Date()).toISOString();
  const lines = [
    '# ── 平台下发（自动生成，请勿手工编辑）─────────────────────────',
    `# 服务: ${meta.serviceKey}    环境: ${meta.envId}`,
    `# 生成时间: ${ts}`,
    '# 来源: 配置中心 config_items（global → env → module 逐级覆盖）',
    '# 优先级: 本文件 > .env（在 ConfigModule.envFilePath 里排在前）',
    '# 回退: 删除本文件 + 重启服务，即回到纯 .env',
    '# ──────────────────────────────────────────────────────────',
  ];
  for (const it of items) {
    lines.push(`# [${it.scope}]`);
    lines.push(`${it.key}=${escapeEnvValue(it.value)}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 配置中心服务。
 *
 * 三级作用域：全局默认 → 环境级 → 模块级，后者覆盖前者；
 * 密钥以 AES-256-GCM 加密落库，页面只回显掩码；
 * 配置与发布版本快照关联，回滚版本时配置同步回退。
 */
@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  constructor(
    @InjectRepository(ConfigItemEntity)
    private readonly repo: Repository<ConfigItemEntity>,
    @InjectRepository(ConfigSnapshotEntity)
    private readonly snapshotRepo: Repository<ConfigSnapshotEntity>,
    @InjectRepository(ConfigRevisionEntity)
    private readonly revisionRepo: Repository<ConfigRevisionEntity>,
    @InjectRepository(ConfigDeliveryEntity)
    private readonly deliveryRepo: Repository<ConfigDeliveryEntity>,
  ) {}

  /** 列出配置项：密钥自动掩码，不给前端明文 */
  async list(scope?: ConfigScope, envId?: string, moduleKey?: string) {
    const where: Record<string, unknown> = {};
    if (scope) where.scope = scope;
    if (envId !== undefined) where.envId = envId;
    if (moduleKey !== undefined) where.moduleKey = moduleKey;

    const rows = await this.repo.find({ where, order: { scope: 'ASC', key: 'ASC' } });
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      envId: r.envId,
      moduleKey: r.moduleKey,
      key: r.key,
      value: r.isSecret ? SECRET_MASK : r.value,
      isSecret: r.isSecret,
      enabled: r.enabled,
      layer: r.layer,
      valueType: r.valueType,
      applyMode: r.applyMode,
      deliverable: r.deliverable,
      validators: r.validators ?? null,
      keyVersion: r.keyVersion,
      description: r.description,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    }));
  }

  /** 读取某「环境 × 模块」的三级作用域行，并按优先级升序排列（后者覆盖前者） */
  private async loadRows(envId: string, moduleKey: string): Promise<ConfigItemEntity[]> {
    const rows = await this.repo.find({
      where: [
        { scope: 'global', enabled: true },
        { scope: 'env', envId, enabled: true },
        { scope: 'module', envId, moduleKey, enabled: true },
      ],
    });
    rows.sort((a, b) => (SCOPE_PRIORITY[a.scope] ?? 0) - (SCOPE_PRIORITY[b.scope] ?? 0));
    return rows;
  }

  /**
   * 把行合并成键值对，并回报其中的密钥键。
   *
   * `includeSecrets=false` 时**跳过 `is_secret=1` 的行** —— 这是密钥隔离的关键：
   * 密钥一旦进配置中心，若仍全量注入流水线脚本 env，等于把「一处加密存储」
   * 换成「每次执行都摊在环境变量里」，是净负收益（design §4.4）。
   */
  private buildConfig(
    rows: ConfigItemEntity[],
    includeSecrets: boolean,
  ): { config: ResolvedConfig; secretKeys: string[] } {
    const config: ResolvedConfig = {};
    const secrets = new Set<string>();
    for (const r of rows) {
      if (r.isSecret) {
        secrets.add(r.key);
        if (!includeSecrets) continue;
      }
      config[r.key] = r.isSecret ? decryptSecret(r.value) : r.value;
    }
    return { config, secretKeys: [...secrets] };
  }

  /**
   * 解析某「环境 × 模块」的生效配置：global → env → module 依次覆盖。
   *
   * ⚠️ 返回的密钥是**明文**，仅供发布/重启时注入进程，**严禁返回给前端或写进日志**。
   */
  async resolve(envId: string, moduleKey: string): Promise<ResolvedConfig> {
    const rows = await this.loadRows(envId, moduleKey);
    return this.buildConfig(rows, true).config;
  }

  /**
   * 按用途解析：**下发给服务进程**（含明文密钥，供写 `.env.generated`）。
   *
   * 与 {@link resolveForScripts} 相对 —— 两者分开是为了让「密钥进不进脚本 env」
   * 成为**调用点的显式选择**，而不是靠调用方自觉过滤（design §4.4）。
   */
  async resolveForProcess(envId: string, serviceKey: string): Promise<ResolvedConfig> {
    return this.resolve(envId, serviceKey);
  }

  /**
   * 按用途解析：**注入流水线脚本 env**（**不含密钥**）。
   *
   * 只看键值对的调用方用这个；需要「排除了几个密钥项」的日志说明时用
   * {@link resolveForScriptsDetailed}。
   */
  async resolveForScripts(envId: string, moduleKey: string): Promise<ResolvedConfig> {
    return (await this.resolveForScriptsDetailed(envId, moduleKey)).config;
  }

  /** 脚本注入用解析 + 被排除的密钥键（供发布日志注明「已排除 N 个密钥项」） */
  async resolveForScriptsDetailed(
    envId: string,
    moduleKey: string,
  ): Promise<{ config: ResolvedConfig; excludedSecrets: string[] }> {
    const rows = await this.loadRows(envId, moduleKey);
    const { config, secretKeys } = this.buildConfig(rows, false);
    return { config, excludedSecrets: secretKeys };
  }

  /**
   * 解析「要下发给服务进程」的条目（**带来源作用域**），供写 `.env.generated`。
   *
   * 与 {@link resolveForProcess} 的区别：
   * ① 带来源作用域（写文件注释，排障看清值从哪来）；
   * ② 跳过 {@link RESERVED_LOCAL_KEYS}（引导/基础设施/平台键永不下发）。
   */
  async dispatchPayload(envId: string, serviceKey: string): Promise<DispatchItem[]> {
    const rows = await this.loadRows(envId, serviceKey);
    const out: DispatchItem[] = [];
    for (const r of rows) {
      // layer 数据判定 + 保留键名单兜底（见 isRowDeliverable 的双保险说明）
      if (!isRowDeliverable(r)) continue;
      out.push({
        key: r.key,
        value: r.isSecret ? decryptSecret(r.value) : r.value,
        scope: scopeLabel(r),
      });
    }
    return out;
  }

  /**
   * 该「环境 × 服务」在配置中心是否有 **module 级**条目 —— 按需下发的判据（design Q1）。
   *
   * 为什么按需：不下发就没有落盘、没有备份、没有「下发文件悄悄改掉人工配置」的风险；
   * 只有声明了自己需要配置的服务（有 module 级条目）才值得落盘。
   */
  async hasModuleScope(envId: string, serviceKey: string): Promise<boolean> {
    const n = await this.repo.count({
      where: { scope: 'module', envId, moduleKey: serviceKey, enabled: true },
    });
    return n > 0;
  }

  /** 新增或更新配置项（密钥加密存储） */
  async upsert(dto: UpsertConfigDto, updatedBy?: string): Promise<ConfigItemEntity> {
    if (!CONFIG_SCOPES.includes(dto.scope)) {
      throw new BadRequestException(`作用域必须是 ${CONFIG_SCOPES.join(' / ')} 之一`);
    }
    if (!dto.key?.trim()) throw new BadRequestException('配置键不能为空');
    if (dto.value === undefined || dto.value === null) {
      throw new BadRequestException('配置值不能为空');
    }
    // 防止把页面回显的掩码当成真实值写回
    if (dto.isSecret && dto.value === SECRET_MASK) {
      throw new BadRequestException('密钥值不能是掩码，请重新输入真实值');
    }

    const envId = dto.scope === 'global' ? '' : (dto.envId ?? '');
    const moduleKey = dto.scope === 'module' ? (dto.moduleKey ?? '') : '';
    if (dto.scope === 'env' && !envId) {
      throw new BadRequestException('环境级配置必须指定 envId');
    }
    if (dto.scope === 'module' && (!envId || !moduleKey)) {
      throw new BadRequestException('模块级配置必须同时指定 envId 与 moduleKey');
    }

    let row = await this.repo.findOne({
      where: { scope: dto.scope, envId, moduleKey, key: dto.key },
    });
    if (!row) {
      row = this.repo.create({ scope: dto.scope, envId, moduleKey, key: dto.key });
    }
    // 层 / 类型 / 生效方式：非法即 400 —— 与 key/value 同一口径（"配了就知道行不行"，
    // 不让非法值等到下发或启动才发现）
    const finalLayer = (dto.layer ?? row.layer ?? 'app').trim();
    if (finalLayer && !CONFIG_LAYERS.includes(finalLayer as never)) {
      throw new BadRequestException(`层必须是 ${CONFIG_LAYERS.join(' / ')} 之一`);
    }
    const finalType = (dto.valueType ?? row.valueType ?? 'string').trim();
    if (finalType && !CONFIG_VALUE_TYPES.includes(finalType as never)) {
      throw new BadRequestException(`值类型必须是 ${CONFIG_VALUE_TYPES.join(' / ')} 之一`);
    }
    const finalMode = (dto.applyMode ?? row.applyMode ?? 'restart').trim();
    if (finalMode && !CONFIG_APPLY_MODES.includes(finalMode as never)) {
      throw new BadRequestException(`生效方式必须是 ${CONFIG_APPLY_MODES.join(' / ')} 之一`);
    }
    const finalValidators = dto.validators !== undefined ? dto.validators : (row.validators ?? null);
    if (dto.validators !== undefined && dto.validators !== null) {
      // 规则本身先自检：正则非法要即时报错，而不是等写值的时候才发现配了个坏规则
      if (dto.validators.pattern) {
        try {
          new RegExp(dto.validators.pattern);
        } catch {
          throw new BadRequestException(`校验规则的正则非法：${dto.validators.pattern}`);
        }
      }
    }
    const typeErrs = validateConfigValue(dto.value, {
      valueType: finalType,
      validators: finalValidators,
    });
    if (typeErrs.length) {
      throw new BadRequestException(`配置值不合法：${typeErrs.join('；')}`);
    }

    const beforeValue = row.value ?? null;
    const existed = !!row.id;

    row.value = dto.isSecret ? encryptSecret(dto.value) : dto.value;
    row.isSecret = !!dto.isSecret;
    row.enabled = true;
    row.layer = finalLayer || 'app';
    row.valueType = finalType || 'string';
    row.applyMode = finalMode || 'restart';
    row.deliverable = dto.deliverable !== undefined ? dto.deliverable !== false : (row.deliverable !== false);
    row.validators = finalValidators ?? null;
    row.keyVersion = 1;
    row.description = dto.description;
    row.updatedBy = updatedBy;

    const saved = await this.repo.save(row);
    await this.writeRevision({
      row: saved,
      action: existed ? 'update' : 'create',
      beforeValue: existed ? beforeValue : null,
      afterValue: saved.value,
      changedBy: updatedBy,
      reason: dto.reason,
    });
    return saved;
  }

  /**
   * 写一条变更历史（内部用）。
   *
   * 失败只告警不阻断：revisions 是**追溯性质**的数据，入库失败不该让配置变更本身失败
   * （否则"审计挂了 → 业务改不了配置"，是把可观测性债务变成了可用性债务）。
   */
  private async writeRevision(args: {
    row: Pick<
      ConfigItemEntity,
      'id' | 'scope' | 'envId' | 'moduleKey' | 'key' | 'isSecret'
    >;
    action: 'create' | 'update' | 'delete';
    beforeValue: string | null;
    afterValue: string | null;
    changedBy?: string;
    reason?: string;
  }): Promise<void> {
    try {
      await this.revisionRepo.save(
        this.revisionRepo.create({
          itemId: args.row.id,
          scope: args.row.scope,
          envId: args.row.envId ?? '',
          moduleKey: args.row.moduleKey ?? '',
          key: args.row.key,
          action: args.action,
          // 密钥存的是密文，回滚时原样写回，全程不需要解密
          beforeValue: args.beforeValue,
          afterValue: args.afterValue,
          isSecret: !!args.row.isSecret,
          beforeFingerprint: args.beforeValue === null ? null : valueFingerprint(args.beforeValue),
          afterFingerprint: args.afterValue === null ? null : valueFingerprint(args.afterValue),
          reason: args.reason ?? null,
          changedBy: args.changedBy,
        }),
      );
    } catch (e) {
      this.logger.warn(
        `配置变更历史写入失败（不影响本次变更）: ${args.row.scope}/${args.row.key} — ${(e as Error).message}`,
      );
    }
  }

  /** 变更历史列表（按时间倒序）；可选按 scope/env/module/key 过滤 */
  async listRevisions(opts: {
    scope?: string;
    envId?: string;
    moduleKey?: string;
    key?: string;
    limit?: number;
  } = {}): Promise<ConfigRevisionEntity[]> {
    const where: Record<string, unknown> = {};
    if (opts.scope) where.scope = opts.scope;
    if (opts.envId !== undefined) where.envId = opts.envId;
    if (opts.moduleKey !== undefined) where.moduleKey = opts.moduleKey;
    if (opts.key) where.key = opts.key;
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
    return this.revisionRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 单键回滚：把某条 revision 记录的 `afterValue` 原样写回配置项。
   *
   * 为什么能直接写回：revision 里存的就是 `config_items.value` **当时的原值**
   * —— 密钥是密文、非密钥是明文，写回即还原，**不需要也不应该解密**。
   *
   * @returns 回滚后的配置项；revision 不存在或对应项已删除时抛错
   */
  async rollbackToRevision(revisionId: string, operator?: string): Promise<ConfigItemEntity> {
    const rev = await this.revisionRepo.findOne({ where: { id: revisionId } });
    if (!rev) throw new BadRequestException(`变更记录不存在：${revisionId}`);

    let row = await this.repo.findOne({
      where: { scope: rev.scope as ConfigScope, envId: rev.envId, moduleKey: rev.moduleKey, key: rev.key },
    });
    if (!row) {
      // 项被删了：按 revision 的元数据重建（action='delete' 的记录此时 afterValue 为 null，
      // 用 beforeValue 还原才是有意义的回滚）
      if (rev.afterValue === null && rev.beforeValue === null) {
        throw new BadRequestException('该变更记录没有可回滚的值');
      }
      row = this.repo.create({
        scope: rev.scope,
        envId: rev.envId,
        moduleKey: rev.moduleKey,
        key: rev.key,
      });
    }
    const before = row.value ?? null;
    row.value = rev.afterValue ?? rev.beforeValue ?? '';
    row.isSecret = rev.isSecret;
    row.enabled = true;
    row.updatedBy = operator;
    const saved = await this.repo.save(row);

    await this.writeRevision({
      row: saved,
      action: 'update',
      beforeValue: before,
      afterValue: saved.value,
      changedBy: operator,
      reason: `回滚到变更记录 ${revisionId}`,
    });
    return saved;
  }

  /**
   * 记录一次下发（内部用）。
   *
   * 只记**元数据**（数量 / hash / 来源），键名与值一律不入库 —— 本表的存在意义是对账，
   * 一旦开始存内容就变成第二个明文配置仓库，风险大于收益。
   */
  async recordDelivery(args: {
    envId: string;
    moduleKey: string;
    keyCount: number;
    contentHash: string | null;
    result: 'delivered' | 'empty';
    host?: string | null;
    runId?: string | null;
    dispatchedBy?: string | null;
    /** `result='empty'` 时的原因（见 ConfigDeliveryEntity.emptyReason） */
    emptyReason?: string | null;
  }): Promise<void> {
    try {
      await this.deliveryRepo.save(
        this.deliveryRepo.create({
          envId: args.envId,
          moduleKey: args.moduleKey,
          host: args.host ?? null,
          keyCount: args.keyCount,
          contentHash: args.contentHash,
          result: args.result,
          runId: args.runId ?? null,
          dispatchedBy: args.dispatchedBy ?? null,
          emptyReason: args.emptyReason ?? null,
        }),
      );
    } catch (e) {
      // 同 [writeRevision] 的取舍：记录失败不阻断下发
      this.logger.warn(
        `下发记录写入失败（不影响本次下发）: ${args.envId}/${args.moduleKey} — ${(e as Error).message}`,
      );
    }
  }

  /** 下发记录列表（按时间倒序） */
  async listDeliveries(opts: { envId?: string; moduleKey?: string; limit?: number } = {}) {
    const where: Record<string, unknown> = {};
    if (opts.envId) where.envId = opts.envId;
    if (opts.moduleKey) where.moduleKey = opts.moduleKey;
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
    return this.deliveryRepo.find({ where, order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * 目标机上报实际生效的 hash（2026-10-10：漂移检测的实际态来源）。
   *
   * 语义：找该「环境 × 模块」**最近一次下发**，把回执写在同一行上并算出 drift。
   * 找不到对应下发记录时返回 `null`（调用方可据此知道"这台机器取过配置吗都没记录"）。
   */
  async reportDelivery(args: {
    envId: string;
    moduleKey: string;
    reportedHash: string;
    host?: string | null;
  }): Promise<{ drift: boolean; deliveryId: string | null; expectedHash: string | null }> {
    const row = await this.deliveryRepo.findOne({
      where: { envId: args.envId, moduleKey: args.moduleKey },
      order: { createdAt: 'DESC' },
    });
    if (!row) {
      return { drift: false, deliveryId: null, expectedHash: null };
    }
    const drift = !!row.contentHash && row.contentHash !== args.reportedHash;
    row.reportedHash = args.reportedHash;
    row.reportedAt = new Date();
    row.drift = drift;
    try {
      await this.deliveryRepo.save(row);
    } catch (e) {
      this.logger.warn(`下发回执写入失败: ${args.envId}/${args.moduleKey} — ${(e as Error).message}`);
    }
    return { drift, deliveryId: row.id, expectedHash: row.contentHash ?? null };
  }

  /**
   * 按 id 查配置项（**不含值**，供删除前审计留痕使用）。
   * 刻意不返回 value：删除审计只需记录"删了哪个键"，无需触碰值（更不碰密钥明文）。
   */
  async findById(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      scope: row.scope,
      envId: row.envId,
      moduleKey: row.moduleKey,
      key: row.key,
      isSecret: row.isSecret,
    };
  }

  async remove(id: string, operator?: string, reason?: string): Promise<void> {
    // 删除前把原值取出来写进历史：否则"删了什么、删之前是多少"永远查不到
    const row = await this.repo.findOne({ where: { id } });
    if (row) {
      await this.writeRevision({
        row,
        action: 'delete',
        beforeValue: row.value ?? null,
        afterValue: null,
        changedBy: operator,
        reason,
      });
    }
    await this.repo.delete(id);
  }

  /** 生成配置快照（与发布版本关联，供回滚时同步回退） */
  async snapshot(
    envId: string,
    moduleKey: string,
    versionTag: string,
    createdBy?: string,
  ): Promise<ConfigSnapshotEntity> {
    const rows = await this.repo.find({
      where: [
        { scope: 'global', enabled: true },
        { scope: 'env', envId, enabled: true },
        { scope: 'module', envId, moduleKey, enabled: true },
      ],
    });
    rows.sort((a, b) => (SCOPE_PRIORITY[a.scope] ?? 0) - (SCOPE_PRIORITY[b.scope] ?? 0));

    const payload: ConfigSnapshotEntity['payload'] = {};
    for (const r of rows) {
      // 密钥在此仍是密文，快照不落明文
      payload[r.key] = { value: r.value, isSecret: r.isSecret, source: r.scope };
    }
    return this.snapshotRepo.save(
      this.snapshotRepo.create({ envId, moduleKey, versionTag, payload, createdBy }),
    );
  }

  /** 回滚配置：把快照内容写回模块级配置（覆盖当前值） */
  async restore(
    envId: string,
    moduleKey: string,
    versionTag: string,
    updatedBy?: string,
  ): Promise<number> {
    const snap = await this.snapshotRepo.findOne({ where: { envId, moduleKey, versionTag } });
    if (!snap) {
      this.logger.warn(`无配置快照可回滚: ${envId}/${moduleKey}@${versionTag}`);
      return 0;
    }
    let n = 0;
    for (const [key, item] of Object.entries(snap.payload ?? {})) {
      let row = await this.repo.findOne({ where: { scope: 'module', envId, moduleKey, key } });
      if (!row) row = this.repo.create({ scope: 'module', envId, moduleKey, key });
      row.value = item.value;
      row.isSecret = item.isSecret;
      row.enabled = true;
      row.updatedBy = updatedBy;
      await this.repo.save(row);
      n++;
    }
    return n;
  }
}
