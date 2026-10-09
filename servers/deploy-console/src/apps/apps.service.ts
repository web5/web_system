import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, Repository } from 'typeorm';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployAppRouteEntity } from '../entities/deploy-app-route.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
// 历史模块注册表（仅用于把前端类模块种子进应用域；P4 退役后解耦）
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { EnvsService } from '../envs/envs.service';
import { EnvSplitWriterService } from '../cloud-db/env-split-writer.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';
import { defaultReleaseWorkspace } from '../pipeline/release-paths';
import {
  APP_KINDS,
  AppRouteDto,
  CreateAppDto,
  UpdateAppDto,
} from './dto';
import { envEntryUrl } from './entry-pointer';
import { EnvArtifactService } from './env-artifact.service';
import { GatewayCacheService } from '../common/gateway-cache.service';

/**
 * 应用域（UI 操作）的锁 owner：带来源前缀，排障时一眼看出「谁在发」。
 * 同一 operator 在同一「模块 × 环境」上重入 → 补偿写指针时不会提前放锁。
 */
export function lockOwnerFor(operator?: string): string {
  const who = operator && operator.trim() ? operator.trim() : 'anonymous';
  return `ui:${who}`;
}

/**
 * 解析本次指针写入实际使用的锁 owner。
 *
 * **为什么需要显式 `lockOwner`**（2026-10-09 回归）：
 * 流水线自身在 `moduleKey × env` 上持有一把锁，owner = 流水线 run id；
 * 而发布节点的「激活指针」动作脚本调 `internal/release/pointer`，若按默认规则
 * 派生成 `ui:pipeline-script`，**与流水线那把锁不是同一个 owner** → 被自己持有的锁
 * 判定为并发 → 409 → 脚本 exit 1 → dev 发布恒失败。
 * 因此脚本必须能把 run id 原样透传进来（同 owner = 重入，不会提前释放外层锁）。
 */
export function resolveLockOwner(operator?: string, lockOwner?: string): string {
  const explicit = lockOwner?.trim();
  return explicit ? explicit : lockOwnerFor(operator);
}

/**
 * 应用域服务（微前端）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2.2 / §4.2
 * - `key` 创建后不可改；`kind=shell` 固定 `deployMode=site-version`（Q107，不纳入 env 切换）
 * - 挂载路由保存**只改配置不发布**（FR-2.3）；同挂载路径冲突需阻断并指出占用者（FR-2.2）
 * - 切换版本 / 回滚 = **只改写入口指针 + 指针表**，不重新构建（FR-4.4 / Q105-B）
 */
@Injectable()
export class AppsService implements OnModuleInit {
  private readonly logger = new Logger(AppsService.name);

  constructor(
    @InjectRepository(DeployAppEntity)
    private readonly appRepo: Repository<DeployAppEntity>,
    @InjectRepository(DeployAppRouteEntity)
    private readonly routeRepo: Repository<DeployAppRouteEntity>,
    @InjectRepository(DeployAppEnvVersionEntity)
    private readonly versionRepo: Repository<DeployAppEnvVersionEntity>,
    @InjectRepository(DeployModuleEntity)
    private readonly legacyModuleRepo: Repository<DeployModuleEntity>,
    private readonly envsService: EnvsService,
    private readonly configService: ConfigService,
    // 配置镜像双写（M4，design §5 #6）
    private readonly mirror: EnvSplitWriterService,
    /**
     * 版本指针写入的**唯一入口**（2026-10-09 收敛，诊断 #1）。
     * 原先这里自己 `versionRepo.save()` → 只写本地库，prod 云库拿不到新指针，
     * 表现为「切换/回滚成功但 prod 线上没变」且不报错。
     */
    private readonly registry: ReleaseRegistryService,
    /**
     * 磁盘产物的**唯一读写口**（2026-10-09 新增，诊断 #3）。
     * 它按环境解析落点（prod 的静态根外置在 prod 机），禁止再直接调 entry-pointer 的
     * 本机函数 —— 那会把 prod 的指针写到 console 本机，线上永远读不到。
     */
    private readonly artifacts: EnvArtifactService,
    /**
     * gateway 版本缓存失效通知（诊断 #16）：此前只有 deploy.service 那条路径会通知，
     * UI 切换/回滚与 internal/release/pointer 改了指针却不通知 → 页面最多 10s 后才变。
     */
    private readonly gatewayCache: GatewayCacheService,
  ) {}

  /**
   * 启动时幂等种子：把**历史前端类模块**补进应用域（迁移 M4-lite）。
   * 只补 key 不存在的行，绝不覆盖已有数据；后端服务不进应用域（属服务域）。
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSeededApps();
    } catch (e) {
      this.logger.error(`应用种子导入失败（忽略，不影响启动）：${(e as Error).message}`);
    }
  }

  private async ensureSeededApps(): Promise<void> {
    const legacy = await this.legacyModuleRepo.find();
    let added = 0;
    for (const m of legacy) {
      const kind = this.mapLegacyAppKind(m);
      if (!kind) continue; // 后端服务 → 服务域，跳过
      const exists = await this.appRepo.findOne({ where: { key: m.key } });
      if (exists) continue;
      this.mirror.mirrorRow(
        'deploy_apps',
        await this.appRepo.save(
          this.appRepo.create({
            key: m.key,
            name: m.name,
            kind,
            parentKey: null,
            repoDir: m.dir,
            entry: m.entry ?? 'index.js',
            publicPath: m.publicPath ?? m.key,
            externals: null,
            // 基座与小程序都不纳入 envId 目录（Q107）
            deployMode: kind === 'shell' || kind === 'mini-app' ? 'site-version' : 'env-dir',
            builtin: true,
            enabled: true,
          }),
        ),
      );
      added++;
    }
    if (added) this.logger.log(`应用种子导入完成（历史前端模块）：${added} 个`);
  }

  /** 历史模块类型 → 应用 kind；返回 null = 不属于应用域 */
  private mapLegacyAppKind(m: DeployModuleEntity): 'shell' | 'micro-frontend' | 'spa' | 'mini-app' | null {
    if (m.type === 'backend') return null;
    if (m.isShell) return 'shell';
    if (m.type === 'mini-app' || m.key.startsWith('mini-') || m.publicPath === 'mini') return 'mini-app';
    if (m.type === 'micro-frontend') return 'micro-frontend';
    if (m.type === 'frontend') return 'spa';
    return null;
  }

  /** 发布目录（与流水线同配置源） */
  private get workspace(): string {
    return (
      this.configService.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace()
    );
  }

  // ==================== 应用 ====================

  async listApps(query: {
    kind?: string;
    q?: string;
    parentKey?: string;
    page?: number;
    pageSize?: number;
    includeDeleted?: boolean;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const kw = (query.q || '').trim().toLowerCase();

    const qb = this.appRepo.createQueryBuilder('a');
    if (!query.includeDeleted) qb.andWhere('a.deletedAt IS NULL');
    if (query.kind && query.kind !== 'all') qb.andWhere('a.kind = :kind', { kind: query.kind });
    if (query.parentKey) qb.andWhere('a.parentKey = :pk', { pk: query.parentKey });
    if (kw) {
      qb.andWhere('(LOWER(a.key) LIKE :kw OR LOWER(a.name) LIKE :kw)', { kw: `%${kw}%` });
    }
    qb.orderBy('a.parentKey', 'ASC').addOrderBy('a.key', 'ASC');

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const versions = items.length
      ? await this.versionRepo.find({
          where: items.map((a) => ({ appKey: a.key })),
          order: { envId: 'ASC' },
        })
      : [];
    const byApp = new Map<string, DeployAppEnvVersionEntity[]>();
    for (const v of versions) {
      const list = byApp.get(v.appKey) || [];
      list.push(v);
      byApp.set(v.appKey, list);
    }

    return {
      items: items.map((a) => ({ ...a, envVersions: this.toEnvVersionView(byApp.get(a.key) || []) })),
      total,
      page,
      pageSize,
    };
  }

  private toEnvVersionView(rows: DeployAppEnvVersionEntity[]) {
    return rows.map((r) => ({
      envId: r.envId,
      currentVersion: r.currentVersion ?? null,
      previousVersion: r.previousVersion ?? null,
      status: r.status,
      deployedAt: r.deployedAt ?? null,
      deployedBy: r.deployedBy ?? null,
    }));
  }

  async getApp(key: string): Promise<DeployAppEntity> {
    const app = await this.appRepo.findOne({ where: { key, deletedAt: IsNull() } });
    if (!app) throw new NotFoundException(`应用不存在或已删除：${key}`);
    return app;
  }

  /**
   * 容忍缺失的查询（返回 null）。
   * 用途：内部发布接口要判断「这个 moduleKey 是否属应用域（env-dir）」——
   * 后端服务不在应用域，不能因为查不到就抛错。
   */
  async findAppOrNull(key: string): Promise<DeployAppEntity | null> {
    return this.appRepo.findOne({ where: { key, deletedAt: IsNull() } });
  }

  /** 应用详情（含挂载路由 + 各环境版本） */
  async getAppDetail(key: string) {
    const app = await this.getApp(key);
    const [routes, versions] = await Promise.all([
      this.routeRepo.find({ where: { appKey: key }, order: { sort: 'ASC', mountPath: 'ASC' } }),
      this.versionRepo.find({ where: { appKey: key }, order: { envId: 'ASC' } }),
    ]);
    return {
      ...app,
      routes,
      envVersions: this.toEnvVersionView(versions),
    };
  }

  async createApp(dto: CreateAppDto): Promise<DeployAppEntity> {
    const exists = await this.appRepo.findOne({ where: { key: dto.key } });
    if (exists) {
      throw new ConflictException(`应用 key 已存在：${dto.key}（key 创建后不可修改）`);
    }
    if (dto.parentKey) {
      const parent = await this.appRepo.findOne({ where: { key: dto.parentKey } });
      if (!parent) throw new BadRequestException(`父应用不存在：${dto.parentKey}`);
    }

    const kind = dto.kind ?? 'micro-frontend';
    // shell 基座不走 envId 目录（Q107），强制 site-version，避免误配成 env 切换
    const deployMode = kind === 'shell' ? 'site-version' : (dto.deployMode ?? 'env-dir');

    const saved = await this.appRepo.save(
      this.appRepo.create({
        key: dto.key,
        name: dto.name.trim(),
        kind,
        parentKey: dto.parentKey ?? null,
        repoDir: dto.repoDir.trim(),
        entry: dto.entry ?? 'index.js',
        publicPath: dto.publicPath ?? null,
        externals: dto.externals ?? null,
        deployMode,
        description: dto.description ?? null,
        builtin: false,
        enabled: true,
      }),
    );
    this.logger.log(`应用已创建：${saved.key}（kind=${saved.kind} mode=${saved.deployMode}）`);
    this.mirror.mirrorRow('deploy_apps', saved);
    return saved;
  }

  async updateApp(key: string, dto: UpdateAppDto): Promise<DeployAppEntity> {
    const app = await this.getApp(key);
    if (dto.name !== undefined) app.name = dto.name.trim();
    if (dto.repoDir !== undefined) app.repoDir = dto.repoDir.trim();
    if (dto.entry !== undefined) app.entry = dto.entry;
    if (dto.publicPath !== undefined) app.publicPath = dto.publicPath || null;
    if (dto.externals !== undefined) app.externals = dto.externals;
    if (dto.description !== undefined) app.description = dto.description || null;
    if (dto.enabled !== undefined) app.enabled = dto.enabled;
    if (dto.deployMode !== undefined) {
      if (app.kind === 'shell' && dto.deployMode !== 'site-version') {
        throw new BadRequestException('shell 基座固定为 site-version（不纳入 env 切换）');
      }
      app.deployMode = dto.deployMode;
    }
    const saved = await this.appRepo.save(app);
    this.mirror.mirrorRow('deploy_apps', saved);
    return saved;
  }

  /**
   * 软删除应用（可恢复）。返回仍在各环境生效的环境清单，供前端提示。
   */
  async removeApp(key: string) {
    const app = await this.getApp(key);
    const active = await this.versionRepo.find({
      where: { appKey: key },
      order: { envId: 'ASC' },
    });
    const activeEnvs = active.filter((v) => !!v.currentVersion).map((v) => v.envId);
    // 软删除 = UPDATE（deleted_at + enabled=false），不做删除补偿
    app.deletedAt = new Date();
    app.enabled = false;
    const saved = await this.appRepo.save(app);
    this.mirror.mirrorRow('deploy_apps', saved);
    await this.routeRepo.delete({ appKey: key });
    this.logger.warn(`应用已软删除：${key}（生效环境：${activeEnvs.join('、') || '无'}）`);
    return { removed: true, activeEnvs };
  }

  // ==================== 挂载路由 ====================

  listRoutes(appKey: string) {
    return this.getApp(appKey).then(() =>
      this.routeRepo.find({ where: { appKey }, order: { sort: 'ASC', mountPath: 'ASC' } }),
    );
  }

  /** 冲突检测：同挂载路径被别的应用占用时阻断（FR-2.2 数据层兜底） */
  private async assertMountPathFree(mountPath: string, appKey: string, exceptId?: string) {
    const rows = await this.routeRepo.find({ where: { mountPath } });
    const conflict = rows.find((r) => r.appKey !== appKey && r.id !== exceptId);
    if (conflict) {
      throw new ConflictException(
        `挂载路径 ${mountPath} 已被应用 ${conflict.appKey} 占用，请先解除其挂载`,
      );
    }
  }

  async createRoute(appKey: string, dto: AppRouteDto) {
    await this.getApp(appKey);
    const mountPath = dto.mountPath.trim();
    await this.assertMountPathFree(mountPath, appKey);
    const saved = await this.routeRepo.save(
      this.routeRepo.create({
        appKey,
        mountPath,
        activeRule: dto.activeRule ?? mountPath,
        requireAuth: dto.requireAuth ?? true,
        sort: dto.sort ?? 0,
        enabled: dto.enabled ?? true,
      }),
    );
    this.logger.log(`挂载路由已新增：${appKey} → ${mountPath}`);
    return saved;
  }

  async updateRoute(appKey: string, id: string, dto: AppRouteDto) {
    await this.getApp(appKey);
    const route = await this.routeRepo.findOne({ where: { id, appKey } });
    if (!route) throw new NotFoundException(`挂载路由不存在：${id}`);
    if (dto.mountPath !== undefined && dto.mountPath.trim() !== route.mountPath) {
      const mountPath = dto.mountPath.trim();
      await this.assertMountPathFree(mountPath, appKey, id);
      route.mountPath = mountPath;
      if (dto.activeRule === undefined) route.activeRule = mountPath;
    }
    if (dto.activeRule !== undefined) route.activeRule = dto.activeRule;
    if (dto.requireAuth !== undefined) route.requireAuth = dto.requireAuth;
    if (dto.sort !== undefined) route.sort = dto.sort;
    if (dto.enabled !== undefined) route.enabled = dto.enabled;
    return this.routeRepo.save(route);
  }

  async removeRoute(appKey: string, id: string) {
    await this.getApp(appKey);
    const res = await this.routeRepo.delete({ id, appKey });
    if (!res.affected) throw new NotFoundException(`挂载路由不存在：${id}`);
    return { removed: true };
  }

  // ==================== 环境版本（部署矩阵 / 切换 / 回滚） ====================

  /** 各环境逐行：环境 × 版本指针（含磁盘可用版本） */
  async listAppEnvs(appKey: string) {
    const app = await this.getApp(appKey);
    const [envs, rows] = await Promise.all([
      this.envsService.listEnvEntries(),
      this.versionRepo.find({ where: { appKey }, order: { envId: 'ASC' } }),
    ]);
    const byEnv = new Map(rows.map((r) => [r.envId, r]));

    // 磁盘侧（版本列表 / 指针）按环境落点读取：prod 在远端机器上，可能有网络耗时
    const items = await Promise.all(
      envs.map(async (e) => {
        const r = byEnv.get(e.envId);
        const [versions, pointerVersion] =
          app.deployMode === 'env-dir'
            ? await Promise.all([
                this.artifacts.listVersions(e.envId, appKey),
                this.artifacts.readPointer(e.envId, appKey),
              ])
            : [[] as string[], null];
        return {
          envId: e.envId,
          envName: e.name,
          siteKey: e.siteKey,
          isProd: e.isProd,
          currentVersion: r?.currentVersion ?? null,
          previousVersion: r?.previousVersion ?? null,
          status: r?.status ?? 'unknown',
          deployedAt: r?.deployedAt ?? null,
          deployedBy: r?.deployedBy ?? null,
          /** 磁盘上真实指向（与 DB 指针不一致时可用于排查） */
          pointerVersion,
          availableVersions: versions,
          entryUrl: this.entryUrlFor(app, e.envId, r?.currentVersion ?? null),
        };
      }),
    );

    return { app, items };
  }

  private entryUrlFor(app: DeployAppEntity, envId: string, version: string | null): string {
    if (app.deployMode === 'site-version') {
      // 基座：按版本目录直出（无指针，Q107）
      return version ? `/static/modules/${app.key}/${version}/index.js` : '';
    }
    return envEntryUrl(app.key, envId);
  }

  /** 该环境的可选版本（切换弹窗用，FR-4.2） */
  async listVersions(appKey: string, envId: string) {
    const app = await this.getApp(appKey);
    await this.envsService.getEnv(envId);
    const row = await this.versionRepo.findOne({ where: { appKey, envId } });
    const available =
      app.deployMode === 'env-dir' ? await this.artifacts.listVersions(envId, appKey) : [];
    return {
      appKey,
      envId,
      currentVersion: row?.currentVersion ?? null,
      previousVersion: row?.previousVersion ?? null,
      availableVersions: available.map((v) => ({
        ref: v,
        isCurrent: v === row?.currentVersion,
        isPrevious: v === row?.previousVersion,
      })),
    };
  }

  /**
   * 切换版本：只改写入口指针 + 指针表（不重新构建）。
   *
   * **写入顺序（2026-10-09 修正，诊断 #1/#5）**：
   * 1. 先提交指针表（`registry.setAppEnvPointer`）—— 它同时承担云库镜像与 strict 抛错，
   *    是 gateway 的**唯一真相源**，必须最先落地
   * 2. 再写磁盘入口指针 —— 它只是次级加载路径（gateway 的 manifest 由 DB 生成），
   *    写失败时**回滚第 1 步**，避免「DB 说新版本、磁盘还指旧版本」的撕裂态
   *
   * 原实现是「先盘后库」且库写失败无补偿，盘写成功/库写失败即静默双轨不一致。
   *
   * 产物校验也在**该环境的静态根所在机器**上做：prod 产物只存在于 prod 机，
   * 在 console 本机校验会把「机器上没有」误判成「版本不存在」（诊断 #3 的切不回现象）。
   *
   * @returns 切换前后版本
   */
  async switchVersion(
    appKey: string,
    envId: string,
    version: string,
    operator?: string,
    lockOwner?: string,
  ) {
    const app = await this.getApp(appKey);
    await this.envsService.getEnv(envId);
    // 显式 lockOwner（流水线 run id）优先：与外层流水线锁同源才算重入
    const owner = resolveLockOwner(operator, lockOwner);

    if (app.deployMode === 'env-dir') {
      let exists = false;
      try {
        exists = await this.artifacts.hasVersion(envId, appKey, version);
      } catch (e) {
        throw new BadRequestException(
          `产物校验失败（无法访问 ${this.artifacts.describeTarget(envId)}）：${(e as Error).message}`,
        );
      }
      if (!exists) {
        throw new BadRequestException(
          `版本产物不存在，无法切换：${appKey}/${envId}/${version}（${this.artifacts.describeTarget(
            envId,
          )} 下缺 index.js）`,
        );
      }
    }

    // 1) 指针表（含 prod 云库镜像，strict 失败即抛 → 不会留下「以为切了其实没切」）
    // lock（诊断 #6）：UI 连点两次会交叉覆盖，previousVersion 被写成错值 → 回滚目标丢失
    const { from, previous, unchanged } = await this.registry.setAppEnvPointer({
      env: envId,
      moduleKey: appKey,
      currentVersion: version,
      deployedBy: operator,
      lock: { owner },
    });
    if (unchanged) {
      return { appKey, envId, from, to: version, pointer: null, unchanged: true };
    }

    // 2) 磁盘入口指针（env-dir 专用）；失败则回滚指针表
    let pointer: { js: string; css: string | null } | null = null;
    if (app.deployMode === 'env-dir') {
      try {
        pointer = await this.artifacts.writePointer(envId, appKey, version);
      } catch (e) {
        await this.revertAppEnvPointer(appKey, envId, from, previous, operator, owner);
        throw new BadRequestException(
          `写入口指针失败，已回滚版本指针：${appKey}/${envId} → ${version}（${(e as Error).message}）`,
        );
      }
    }

    this.logger.log(`切换版本指针：${appKey}/${envId} ${from ?? '-'} → ${version}`);

    // 通知 gateway 失效版本缓存（best-effort，失败不影响发布结果）
    // 只 env-dir 需要：微前端的入口由 gateway 按指针拼出，缓存住了就是「切了但页面没变」
    if (app.deployMode === 'env-dir') {
      try {
        await this.gatewayCache.notifyVersionChange({
          env: envId,
          moduleKey: appKey,
          version,
          reason: `应用域切换版本 ${from ?? '-'} → ${version}`,
        });
      } catch (e) {
        // 指针已经写成功了，通知失败最多是缓存晚 10s 失效 —— 绝不能把成功判成失败
        this.logger.warn(
          `gateway 缓存刷新失败（${appKey}/${envId} → ${version}）：${(e as Error).message}（最多 10s 后自然生效）`,
        );
      }
    }

    return { appKey, envId, from, to: version, pointer };
  }

  /**
   * 回滚 `switchVersion` 已经提交的指针表变更（磁盘入口指针写失败的补偿）。
   * `from` 为空表示本次是首次写入，直接删行而不是写空指针。
   */
  private async revertAppEnvPointer(
    appKey: string,
    envId: string,
    from: string | null,
    previous: string | null,
    operator?: string,
    lockOwner?: string,
  ): Promise<void> {
    try {
      if (!from) {
        await this.registry.clearAppEnvPointer(appKey, envId);
        return;
      }
      await this.registry.setAppEnvPointer({
        env: envId,
        moduleKey: appKey,
        currentVersion: from,
        // 把变更前的值原样带回来，否则 previous 会指向那个没生效的失败目标
        previousVersion: previous,
        deployedBy: operator,
        // 与 switchVersion 同一 owner → 重入，不会提前释放外层还在用的锁
        lock: { owner: lockOwner ?? lockOwnerFor(operator) },
      });
    } catch (e) {
      this.logger.error(
        `指针表回滚失败（${appKey}/${envId}），需人工介入比对两库：${(e as Error).message}`,
      );
    }
  }

  /** 回滚：默认回到 previousVersion（可显式指定目标版本） */
  async rollback(appKey: string, envId: string, version: string | undefined, operator?: string) {
    const row = await this.versionRepo.findOne({ where: { appKey, envId } });
    const target = version || row?.previousVersion;
    if (!target) {
      throw new BadRequestException('没有可回滚的上一版本，请显式指定版本');
    }
    return this.switchVersion(appKey, envId, target, operator);
  }

  /** 内置应用类型与部署模式（供前端下拉） */
  getKinds() {
    return {
      kinds: APP_KINDS,
      deployModes: ['env-dir', 'site-version'],
    };
  }
}
