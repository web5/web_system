import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigItemEntity, CONFIG_SCOPES, ConfigScope } from '../entities/config-item.entity';
import { ConfigSnapshotEntity } from '../entities/config-snapshot.entity';
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
}

/** 作用域优先级：数字越大越优先（后者覆盖前者） */
const SCOPE_PRIORITY: Record<string, number> = { global: 0, env: 1, module: 2 };

/**
 * **永不写入 `.env.generated`** 的保留键（引导 / 基础设施 / 平台注入）。
 *
 * 判据（`specs/service-config-delivery/design.md` §2「什么配置该放哪」）：
 * - `CONFIG_MASTER_KEY` / `INTERNAL_API_KEY`：引导凭据，鸡生蛋 —— 读配置中心本身要先有它，必须留在 `.env`；
 * - `MYSQL_*` / `REDIS_*`：基础设施连接，启动必需，且平台自己也在连同一库，下发易成单点；
 * - `PATH` / `HOME`：平台注入键（进程环境只保留这几个），下发进服务 `.env` 只会误导；
 * - `PM2_*`：平台推导的进程信息（名称/入口/工作目录），由 pm2 决定，不由服务 `.env` 决定；
 * - `CONSOLE_*`：平台自身接口地址与凭据，仅供动作脚本使用，不属于服务进程配置。
 *
 * 支持 `PREFIX_*` 通配（前缀匹配）。
 */
export const RESERVED_LOCAL_KEYS: readonly string[] = [
  'CONFIG_MASTER_KEY',
  'INTERNAL_API_KEY',
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
      if (isReservedLocalKey(r.key)) continue;
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
    row.value = dto.isSecret ? encryptSecret(dto.value) : dto.value;
    row.isSecret = !!dto.isSecret;
    row.enabled = true;
    row.description = dto.description;
    row.updatedBy = updatedBy;
    return this.repo.save(row);
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

  async remove(id: string): Promise<void> {
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
