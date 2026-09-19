import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployServiceEntity } from '../entities/deploy-service.entity';

/**
 * 模块注册表服务（**双域适配层**）。
 *
 * ## 语义
 * 运行期流水线 / 发布链路一律通过本服务按 key 取「模块」元数据
 * （`dir` 决定构建产物路径、`type` 决定 front/back 分流、`pm2` 决定重启进程名）。
 *
 * ## 读取源（M9 前置，2026-09-19 切换）
 * - **主源 = 双域新表**：`deploy_services`（后端）+ `deploy_apps`（前端），
 *   由 M4-lite / ServicesService 的幂等种子保证与旧 `deploy_modules` 同 key、同目录。
 * - **兜底 = 旧表**：新表未涵盖的 key 仍回落到 `deploy_modules`，
 *   保证**未迁移/临时新增**的模块零遗漏。旧表 DROP 后本兜底自然空转。
 *
 * 这样 `deploy_modules` 由「唯一真相源」降级为「兼容兜底」，为 M9 drop 解锁。
 */
@Injectable()
export class ModuleRegistryService {
  private readonly logger = new Logger(ModuleRegistryService.name);

  constructor(
    @InjectRepository(DeployModuleEntity)
    private readonly moduleRepo: Repository<DeployModuleEntity>,
    @InjectRepository(DeployAppEntity)
    private readonly appRepo: Repository<DeployAppEntity>,
    @InjectRepository(DeployServiceEntity)
    private readonly serviceRepo: Repository<DeployServiceEntity>,
  ) {}

  /** 全部模块：新表（服务 + 应用）优先，旧表补漏，按 key 排序（旧行为一致） */
  async list(): Promise<DeployModuleEntity[]> {
    const [services, apps, legacy] = await Promise.all([
      this.serviceRepo.find({ where: { deletedAt: IsNull() } }),
      this.appRepo.find({ where: { deletedAt: IsNull() } }),
      this.legacyFind(),
    ]);

    const rows: DeployModuleEntity[] = [
      ...services.map((s) => fromService(s)),
      ...apps.map((a) => fromApp(a)),
    ];
    const seen = new Set(rows.map((r) => r.key));
    for (const m of legacy) if (!seen.has(m.key)) rows.push(m);

    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * 按 key 取模块：新表优先，旧表兜底，都没有才抛错。
   *
   * ⚠️ 错误文案 `模块不存在: <key>` 被下游识别（`.message.includes('模块不存在')`），不可改。
   */
  async get(key: string): Promise<DeployModuleEntity> {
    const svc = await this.serviceRepo.findOne({ where: { key, deletedAt: IsNull() } });
    if (svc) return fromService(svc);

    const app = await this.appRepo.findOne({ where: { key, deletedAt: IsNull() } });
    if (app) return fromApp(app);

    const legacy = await this.moduleRepo.findOne({ where: { key } });
    if (legacy) {
      this.logger.debug(`模块 ${key} 命中旧表兜底（尚未迁入双域新表）`);
      return legacy;
    }

    throw new Error(`模块不存在: ${key}`);
  }

  /** 旧表兜底读取（旧表 DROP 后返回空数组，不抛错 —— 见 list 中的同样处理） */
  private async legacyFind(): Promise<DeployModuleEntity[]> {
    try {
      return await this.moduleRepo.find({ order: { key: 'ASC' } });
    } catch (e) {
      // 旧表已 DROP（M9 完成态）：兜底自然空转，主源独立可用
      this.logger.debug(`旧表兜底读取跳过：${(e as Error).message}`);
      return [];
    }
  }
}

/**
 * `deploy_apps.kind` → 旧 `deploy_modules.type` 值域。
 *
 * ⚠️ 值域必须落在 `backend` / `frontend` / `micro-frontend` 三者内 ——
 * 下游按这三个值分支（`BUILD_OUTPUT_DIR` 取 servers/app、微前端分流判断等）。
 * 依据 `scripts/modules.json`：`shell` 与 `mini-contract` 旧 type 均为 `frontend`。
 */
function appKindToType(kind: string): 'frontend' | 'micro-frontend' {
  return kind === 'micro-frontend' ? 'micro-frontend' : 'frontend';
}

/** 应用（微前端域）→ 旧模块形态（无 pm2：前端由 nginx 静态伺服，不跑进程） */
function fromApp(a: DeployAppEntity): DeployModuleEntity {
  // `as unknown as` 是刻意的：新表是 key 主键、无自增 id，这里产出的是**兼容 shape**，
  // 仅供流水线取元数据（dir/type/pm2/…）使用，不会作为实体回写。
  return {
    key: a.key,
    name: a.name,
    type: appKindToType(a.kind),
    dir: a.repoDir,
    pm2: null,
    publicPath: a.publicPath ?? null,
    buildCmd: null,
    builtin: !!a.builtin,
    enabled: !!a.enabled,
  } as unknown as DeployModuleEntity;
}

/** 服务（网关域）→ 旧模块形态（type 恒为 backend，pm2 进程名来自 pm2Name） */
function fromService(s: DeployServiceEntity): DeployModuleEntity {
  return {
    key: s.key,
    name: s.name,
    type: 'backend',
    dir: s.repoDir,
    pm2: s.pm2Name ?? null,
    publicPath: null,
    buildCmd: null,
    builtin: !!s.builtin,
    enabled: !!s.enabled,
  } as unknown as DeployModuleEntity;
}
