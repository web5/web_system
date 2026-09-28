import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { join, normalize, extname, resolve, sep } from 'path';
import { readFileSync, existsSync, statSync } from 'fs';
import { DeployDeploymentEntity } from './deploy-deployment.entity';
import { DeployModuleEntity } from './deploy-module.entity';
import { DeployCanaryRuleEntity } from './deploy-canary-rule.entity';
import { IsNull } from 'typeorm';
import {
  DeployAppEntity,
  DeployAppEnvVersionEntity,
  DeployEnvEntity,
  DeploySiteEntity,
} from '../dynamic-route/entities';
// P2（2026-09-20）：静态根改为可配（STATIC_PUBLIC_ROOT），不配时与历史行为一致
import { PUBLIC_ROOT } from '../static/public-root';

interface VersionCache {
  value: string | undefined;
  at: number;
}

interface ModuleManifestEntry {
  name: string;
  version: string;
  entry: string;
  css: string | null;
  assetsBase: string;
}

interface ModulesManifest {
  env: string;
  modules: ModuleManifestEntry[];
  canary: { module: string; version: string } | null;
}

/**
 * 版本化 index.html 服务（微前端模式）：
 * - 基座 shell index.html：向 <head> 注入 window.__MODULES_MANIFEST__（当前环境所有微前端模块的版本清单）
 * - deploy-console index.html：走旧 SPA 模式（不微前端化，独立应用）
 * - 模块 js/css 不由 gateway serve，由 nginx /static/modules/ 直出
 *
 * **读取源（2026-09-28 停用 legacy）**：前端清单（含基座 shell 的版本目录）一律读 NEW 域
 * —— `deploy_apps` + `deploy_app_env_versions`（TTL 10s 缓存）。
 * `deploy_deployments` / `deploy_modules` **不再参与前端清单**，只保留
 * 「后端微服务版本指针」一个职责（见 `DeployDeploymentEntity` 注释）。
 * 唯一例外是应急开关 `DEPLOY_LEGACY_READ=1`（见 `legacyRead`）。
 *
 * 未来灰度：在 resolveCanary() 中按用户规则返回 canary 版本即可。
 */
@Injectable()
export class IndexHtmlService {
  private readonly logger = new Logger(IndexHtmlService.name);
  private htmlCache = new Map<string, { mtime: number; content: string }>();
  private versionCache = new Map<string, VersionCache>();
  /** shell 版本目录缺失的告警只打一次（静态资源每次请求都会解析，避免刷日志） */
  private shellDirWarned = false;
  private readonly versionTtl = 10_000;

  constructor(
    private configService: ConfigService,
    @InjectRepository(DeployDeploymentEntity, 'deploy')
    private deployRepo: Repository<DeployDeploymentEntity>,
    @InjectRepository(DeployModuleEntity, 'deploy')
    private moduleRepo: Repository<DeployModuleEntity>,
    @InjectRepository(DeployCanaryRuleEntity, 'deploy')
    private canaryRepo: Repository<DeployCanaryRuleEntity>,
    // 双域重构 P3：manifest 的站点 / 环境 / 应用 / 版本指针维度（只读）
    @InjectRepository(DeploySiteEntity, 'deploy')
    private siteRepo: Repository<DeploySiteEntity>,
    @InjectRepository(DeployEnvEntity, 'deploy')
    private envRepo: Repository<DeployEnvEntity>,
    @InjectRepository(DeployAppEntity, 'deploy')
    private appRepo: Repository<DeployAppEntity>,
    @InjectRepository(DeployAppEnvVersionEntity, 'deploy')
    private appVersionRepo: Repository<DeployAppEnvVersionEntity>,
  ) {}

  /** 当前环境 ID（来自配置 DEPLOY_ENV_ID，缺省 dev） */
  private get envId(): string {
    return this.configService.get('DEPLOY_ENV_ID') || 'dev';
  }

  /** 是否已打印过读取源（启动后只记一次，避免刷日志） */
  private loggedReadSource = false;

  /**
   * **M8 双读开关**（回退能力，R7）。
   *
   * `DEPLOY_LEGACY_READ=1`（或 `true`）时 manifest **只从旧表** `deploy_modules` +
   * `deploy_deployments` 组装 —— 双域新表（sites/envs/apps/app_env_versions）即使损坏、
   * 未迁移或被 DROP，外壳仍能照旧加载。
   * **默认关闭**（`0`/未设置）→ 走新表。
   */
  private get legacyRead(): boolean {
    const raw = String(this.configService.get('DEPLOY_LEGACY_READ') ?? '')
      .trim()
      .toLowerCase();
    const on = raw === '1' || raw === 'true';
    if (!this.loggedReadSource) {
      this.loggedReadSource = true;
      this.logger.log(
        on
          ? 'manifest 读取源 = LEGACY（DEPLOY_LEGACY_READ=1：只读 deploy_modules / deploy_deployments）'
          : 'manifest 读取源 = NEW（deploy_sites / deploy_envs / deploy_apps / deploy_app_env_versions）',
      );
    }
    return on;
  }

  /**
   * 渲染 index.html。
   * pub === 'shell'：注入模块清单（微前端基座）
   * pub === 'console'：deploy-console 独立 SPA，不注入清单
   */
  async render(pub: string, req?: any): Promise<string> {
    const html = await this.readHtml(pub);
    if (pub !== 'shell') {
      // deploy-console 等非微前端应用，只注入环境标识
      const meta = `<script>window.__DEPLOY_ENV__=${JSON.stringify(this.envId)};</script>`;
      return this.injectHead(html, meta);
    }

    // 基座：注入模块清单（新结构 envs/byEnv；与 /__manifest__ 端点同一来源）
    const manifest = await this.buildManifest(req);
    const meta = `<script id="__MODULES_MANIFEST__">window.__MODULES_MANIFEST__=${JSON.stringify(manifest)};</script>`;
    return this.injectHead(html, meta);
  }

  /**
   * 组装模块清单（**唯一来源**：注入 shell 的 HTML 与 /__manifest__ 端点都走这里）。
   *
   * **2026-09-28 停用 legacy**：默认读取源是 NEW 域（`deploy_apps` +
   * `deploy_app_env_versions`），`deploy_deployments` / `deploy_modules`
   * **不再参与前端清单** —— 旧表只保留「后端服务版本指针」一个职责。
   * 这样做的原因：控制台的版本切换（`AppsService.switchVersion`）早已只写新表，
   * 而 gateway 还从旧表读 → 两轨漂移（dev 曾出现「切了版本页面不变」）。
   *
   * 输出结构（双域重构 P3）：
   * - `site` / `defaultEnv` / `switchable`：由请求 Host 匹配 `deploy_sites`
   * - `envs`：站点下可切换的环境；未匹配站点（IP / localhost 直连）退化为 `DEPLOY_ENV_ID` 单环境
   * - `byEnv`：**每个环境 → 各应用的固定入口** `/static/modules/<appKey>/<envId>/index.js`
   *   （入口不含版本 → 切换版本只改磁盘指针，manifest 无需变化，R5）
   * - 兼容字段 `env` / `modules` / `canary`：**同样由 NEW 域合成**
   *   （`modules[].version` 取自 `deploy_app_env_versions`，路径为整包目录
   *   `<appKey>/<envId>/<version>/`），供尚未刷新的旧 shell bundle 使用。
   *
   * `source` 仅为排障标注（`new` / `new:nosite` / `new:error` / `legacy`），前端不依赖。
   * 唯一仍走 legacy 的通道是应急开关 `DEPLOY_LEGACY_READ=1`（见 `legacyRead`）。
   */
  async buildManifest(req?: any): Promise<Record<string, any>> {
    const envId = this.envId;

    // M8 应急回退：旧表为唯一读取源（默认关闭）
    if (this.legacyRead) {
      const legacy = await this.resolveModulesManifest(envId, req);
      return this.buildLegacyManifest(envId, legacy);
    }

    try {
      const site = await this.resolveSite(req);
      return await this.buildNewManifest(envId, site ?? null, req);
    } catch (e) {
      // 不再回落旧表：旧表数据可能已漂移，回落只会掩盖问题（且会让两轨再次分叉）
      this.logger.error(`manifest 组装失败（NEW 域读取源）：${(e as Error).message}`);
      return this.emptyManifest(envId, 'new:error');
    }
  }

  /** NEW 域清单组装（站点可空：未匹配时退化为单环境） */
  private async buildNewManifest(
    envId: string,
    site: DeploySiteEntity | null,
    req?: any,
  ): Promise<Record<string, any>> {
    const defaultEnv = site?.defaultEnvId || envId;

    const envRows = site
      ? await this.envRepo.find({
          where: { siteKey: site.key, enabled: true },
          order: { sort: 'ASC', envId: 'ASC' },
        })
      : [];
    const envList = envRows.length
      ? envRows.map((e) => ({ id: e.envId, name: e.name, isProd: e.isProd }))
      : [{ id: envId, name: envId, isProd: envId === 'prod' }];
    const envIds = envList.map((e) => e.id);

    const [apps, versions] = await Promise.all([
      this.appRepo.find({ where: { deletedAt: IsNull(), enabled: true } }),
      this.appVersionRepo.find(),
    ]);
    const currentOf = new Map<string, string | null>();
    for (const v of versions) currentOf.set(`${v.appKey}@${v.envId}`, v.currentVersion);

    // 基座（site-version）不纳入 env 切换（Q107）
    const envDirApps = apps.filter((a) => a.deployMode === 'env-dir');

    const byEnv: Record<string, Record<string, { entry: string; css: string | null }>> = {};
    for (const e of envIds) {
      const entries: Record<string, { entry: string; css: string | null }> = {};
      for (const app of envDirApps) {
        if (!currentOf.get(`${app.key}@${e}`)) continue;
        const cssRel = `/static/modules/${app.key}/${e}/index.css`;
        entries[app.key] = {
          entry: `/static/modules/${app.key}/${e}/index.js`,
          // 样式指针只在产物含 index.css 时被写入，按磁盘存在性给出（避免前端引 404）
          css: this.diskHas(`static/modules/${app.key}/${e}/index.css`) ? cssRel : null,
        };
      }
      byEnv[e] = entries;
    }

    // 兼容期字段：旧 shell 只认 modules[]（整包版本目录），版本与 byEnv 同源取自新表
    const modules: ModuleManifestEntry[] = [];
    for (const app of envDirApps) {
      const version = currentOf.get(`${app.key}@${defaultEnv}`);
      if (!version) continue;
      const base = `/static/modules/${app.key}/${defaultEnv}/${version}/`;
      modules.push({
        name: app.key,
        version,
        entry: `${base}index.js`,
        css: this.diskHas(`static/modules/${app.key}/${defaultEnv}/${version}/index.css`)
          ? `${base}index.css`
          : null,
        assetsBase: base,
      });
    }

    return {
      site: site?.key ?? null,
      defaultEnv,
      switchable: !!site?.switchable,
      envs: envList,
      byEnv,
      env: envId,
      modules,
      canary: await this.resolveCanaryAny(defaultEnv, envDirApps, currentOf, req),
      source: site ? 'new' : 'new:nosite',
    };
  }

  /** 组装失败 / 无数据时的空清单（结构完整，避免前端 undefined 崩溃） */
  private emptyManifest(envId: string, source: string): Record<string, any> {
    return {
      site: null,
      defaultEnv: envId,
      switchable: false,
      envs: [{ id: envId, name: envId, isProd: envId === 'prod' }],
      byEnv: {},
      env: envId,
      modules: [],
      canary: null,
      source,
    };
  }

  /** 磁盘存在性判定（路径相对 PUBLIC_ROOT） */
  private diskHas(relPath: string): boolean {
    return existsSync(join(PUBLIC_ROOT, relPath));
  }

  /**
   * 灰度命中（NEW 域版）：按 `deploy_canary_rules` 逐个 env-dir 应用比对，
   * 首个命中即返回；未命中返回 null。
   */
  private async resolveCanaryAny(
    envId: string,
    apps: DeployAppEntity[],
    currentOf: Map<string, string | null>,
    req?: any,
  ): Promise<{ module: string; version: string } | null> {
    for (const app of apps) {
      const stable = currentOf.get(`${app.key}@${envId}`);
      if (!stable) continue;
      const hit = await this.resolveCanary(envId, app.key, stable, req);
      if (hit !== stable) return { module: app.key, version: hit };
    }
    return null;
  }

  /**
   * **旧表读取源**（M8 回退路径，`DEPLOY_LEGACY_READ=1` 时使用）。
   *
   * 只读 `deploy_modules` + `deploy_deployments`，但**输出与新格式同构**
   * （`site`/`defaultEnv`/`switchable`/`envs`/`byEnv` + 兼容字段）——
   * 这样 shell 与 EnvSwitcher 无需分支，改一个环境变量即可整体回退。
   *
   * 差异：旧模型没有站点/多环境概念，故 `envs` 只有当前环境、`switchable=false`；
   * 入口是**版本目录**（`/static/modules/<key>/<version>/index.js`），不是 envId 指针层级。
   */
  private buildLegacyManifest(envId: string, legacy: ModulesManifest): Record<string, any> {
    const byEnv: Record<string, Record<string, { entry: string; css: string | null }>> = {
      [envId]: {},
    };
    for (const m of legacy.modules) {
      byEnv[envId][m.name] = { entry: m.entry, css: m.css };
    }
    return {
      site: null,
      defaultEnv: envId,
      switchable: false,
      envs: [{ id: envId, name: envId, isProd: envId === 'prod' }],
      byEnv,
      // 兼容期字段
      env: envId,
      modules: legacy.modules,
      canary: legacy.canary,
      source: 'legacy',
    };
  }

  /**
   * 单个模块的当前线上版本（`/__version__` 端点用；与 manifest 同一读取源）。
   *
   * **NEW 域（默认）**：`deploy_app_env_versions` → 整包目录
   * `/static/modules/<key>/<envId>/<version>/`。未登记 / 无指针 → `version: undefined`
   * （后端服务的版本指针只在 `deploy_deployments`，**不再**从这里对外暴露）。
   * **应急通道**（`DEPLOY_LEGACY_READ=1`）：旧扁平布局 + `deploy_deployments`。
   */
  async resolveModuleVersion(moduleKey: string, req?: any): Promise<Record<string, any>> {
    const envId = this.envId;
    const module = await this.moduleRepo.findOne({ where: { key: moduleKey } });

    let version: string | undefined;
    let base: string | null = null;
    if (this.legacyRead) {
      version = await this.getCurrentVersion(envId, moduleKey);
      if (version) base = `/static/modules/${moduleKey}/${version}/`;
    } else {
      version = await this.getCurrentAppVersion(moduleKey, envId);
      if (version) base = `/static/modules/${moduleKey}/${envId}/${version}/`;
    }

    // 样式指针按磁盘存在性给出（避免前端引 404）
    const cssRel = this.legacyRead
      ? `static/modules/${moduleKey}/${version}/index.css`
      : `static/modules/${moduleKey}/${envId}/${version}/index.css`;

    return {
      env: envId,
      module: moduleKey,
      name: module?.name || moduleKey,
      type: module?.type || 'unknown',
      version,
      entry: base ? `${base}index.js` : null,
      css: base && version && this.diskHas(cssRel) ? `${base}index.css` : null,
      assetsBase: base,
      source: this.legacyRead ? 'legacy' : 'new',
    };
  }

  /** 站点解析：显式 `?site=` 优先，其次按 Host 匹配（忽略端口、大小写不敏感） */
  private async resolveSite(req?: any): Promise<DeploySiteEntity | null> {
    const siteKey = req?.query?.site;
    if (siteKey) return this.siteRepo.findOne({ where: { key: String(siteKey) } });
    const host = String(req?.headers?.host || '')
      .split(':')[0]
      .trim()
      .toLowerCase();
    if (!host) return null;
    const all = await this.siteRepo.find();
    return all.find((s) => s.host.toLowerCase() === host) || null;
  }

  /** 查所有 enabled micro-frontend 模块的当前版本，拼成 manifest（供 /__manifest__ 端点直返） */
  async resolveModulesManifest(envId: string, req?: any): Promise<ModulesManifest> {
    const modules = await this.moduleRepo.find({ where: { type: 'micro-frontend', enabled: true } });
    const entries: ModuleManifestEntry[] = [];
    let canary: { module: string; version: string } | null = null;

    for (const m of modules) {
      const stable = await this.getCurrentVersion(envId, m.key);
      if (!stable) continue;
      const version = await this.resolveCanary(envId, m.key, stable, req);
      if (version !== stable && !canary) {
        canary = { module: m.key, version };
      }
      const base = `/static/modules/${m.key}/${version}/`;
      entries.push({
        name: m.key,
        version,
        entry: `${base}index.js`,
        css: `${base}index.css`,
        assetsBase: base,
      });
    }
    return { env: envId, modules: entries, canary };
  }

  /**
   * 读取 index.html，带 mtime 缓存。
   *
   * **基座 shell 按版本加载**（用户 2026-09-15：不做覆盖式发布）：
   * 先查 `deploy_deployments`（当前环境 + shell）拿版本，再从
   * `public/static/modules/shell/<版本>/index.html` 读；取不到版本或文件不存在时
   * 退回历史固定路径 `public/shell/index.html`（保证老部署仍可启动）。
   */
  private async readHtml(pub: string): Promise<string> {
    const file = pub === 'shell' ? await this.resolveShellHtmlFile() : join(PUBLIC_ROOT, pub, 'index.html');
    try {
      const mtime = statSync(file).mtimeMs;
      const cached = this.htmlCache.get(pub);
      if (cached && cached.mtime === mtime) return cached.content;
      const content = readFileSync(file, 'utf-8');
      this.htmlCache.set(pub, { mtime, content });
      return content;
    } catch {
      return '<html><head></head><body>index.html not found for ' + pub + '</body></html>';
    }
  }

  /**
   * 基座 html 路径。
   *
   * **NEW 域（默认）**：`deploy_app_env_versions(appKey='shell', envId)` →
   * `static/modules/shell/<envId>/<版本>/index.html`（与产物投递布局一致）。
   * 取不到版本或目录缺失 → 退回固定路径 `shell/index.html`（保证老部署仍可启动）。
   *
   * **应急通道**（`DEPLOY_LEGACY_READ=1`）：按旧扁平布局
   * `static/modules/shell/<版本>/index.html` + `deploy_deployments` 指针。
   */
  private async resolveShellHtmlFile(): Promise<string> {
    return join(await this.resolveShellDir(), 'index.html');
  }

  /**
   * 基座**目录**（html 与静态资源同源）。
   *
   * **NEW 域（默认）**：`static/modules/shell/<envId>/<版本>/`（与产物投递布局一致）。
   * 取不到版本或目录缺失 → 退回固定目录 `shell/`（保证老部署仍可启动）。
   *
   * **应急通道**（`DEPLOY_LEGACY_READ=1`）：按旧扁平布局 `static/modules/shell/<版本>/`。
   *
   * 抽成目录（而不是直接给 html 路径）是为了让 `/shell/*` 静态资源走同一份解析
   * —— 见 `resolveShellAssetPath`。
   */
  private async resolveShellDir(): Promise<string> {
    const envId = this.envId;
    const fixed = join(PUBLIC_ROOT, 'shell');
    if (this.legacyRead) {
      try {
        const version = await this.getCurrentVersion(envId, 'shell');
        if (!version) return fixed;
        const flat = join(PUBLIC_ROOT, 'static/modules/shell', version);
        return existsSync(flat) ? flat : fixed;
      } catch {
        return fixed;
      }
    }
    try {
      const version = await this.getCurrentAppVersion('shell', envId);
      if (!version) return fixed;
      const versioned = join(PUBLIC_ROOT, 'static/modules/shell', envId, version);
      if (existsSync(versioned)) return versioned;
      // 静态资源请求也会走这里，只告警一次，避免刷日志
      if (!this.shellDirWarned) {
        this.shellDirWarned = true;
        this.logger.warn(`shell 版本目录不存在，回落固定路径：${versioned}`);
      }
    } catch {
      /* 查表失败 → 固定目录 */
    }
    return fixed;
  }

  /**
   * 基座静态资源 `/shell/*` 的物理路径 —— 与 html **同源**解析。
   *
   * 背景（wb-issues rtqmct）：基座的 html 走版本目录，而 html 里引用的
   * `/shell/assets/<hash>.js` 走 ServeStatic 的固定目录 `public/shell/`。
   * 两者不同源 → 只投版本目录时，新 html 引用新 hash、固定目录还是旧文件 → 404，
   * 基座 JS 加载失败（且 html 本身 200，排障极迷惑），只能靠「两处同时更新」人工规避。
   *
   * 这里统一按版本目录解析；解析不到（老部署无指针 / 文件缺失）返回 `null`，
   * 由调用方回落固定目录 —— 老部署不受影响。
   *
   * @param urlPath 形如 `/shell/assets/index.<hash>.js`（也接受相对路径 `assets/...`）
   * @returns 绝对路径；不可用（非法 / 穿越 / 不存在）返回 `null`
   */
  async resolveShellAssetPath(urlPath: string): Promise<string | null> {
    const rel = urlPath.startsWith('/shell/') ? urlPath.slice('/shell/'.length) : urlPath;
    // 目录穿越防护：禁用 `..`、`\0`、绝对路径形态
    if (!rel || rel.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(rel) || rel.startsWith('/')) {
      return null;
    }
    const dir = await this.resolveShellDir();
    const file = resolve(dir, rel);
    // 归一化后必须仍在基座目录内（二次兜底）
    if (file !== resolve(dir) && !file.startsWith(resolve(dir) + sep)) return null;
    return existsSync(file) ? file : null;
  }

  /**
   * 读取应用 × 环境指针（**NEW 域** `deploy_app_env_versions`，TTL 缓存）。
   * 停用 legacy 后，前端侧（含基座 shell）的版本唯一来源是这里。
   */
  private async getCurrentAppVersion(appKey: string, envId: string): Promise<string | undefined> {
    const key = `app:${appKey}@${envId}`;
    const cached = this.versionCache.get(key);
    if (cached && Date.now() - cached.at < this.versionTtl) return cached.value;

    let version: string | undefined;
    try {
      const row = await this.appVersionRepo.findOne({ where: { appKey, envId } });
      version = row?.currentVersion ?? undefined;
    } catch (e) {
      this.logger.warn(`查询应用版本失败(${key}): ${e.message}`);
    }

    this.versionCache.set(key, { value: version, at: Date.now() });
    return version;
  }

  /**
   * 立即失效模块版本缓存（部署/切换后由写入方调用，避免等 TTL 自然过期）。
   *
   * 为什么需要显式通知：`versionCache` 服务的两类读取都由**外部写入**的
   * `deploy_deployments` 指针决定 —— ① 基座（shell）加载哪个版本目录的 `index.html`
   * （`getCurrentVersion(envId,'shell')`）；② 未匹配站点回落的 legacy `modules` 字段。
   * 指针由控制台「部署」或流水线写入，gateway 感知不到，只能由写入方通知。
   * 不通知的后果：最多 `versionTtl`（10s）内仍加载旧版本 —— 表现为「部署了但页面没变」。
   *
   * @returns 被清掉的缓存条目数（便于调用方/日志确认真的清了）
   */
  clearVersionCache(): number {
    const n = this.versionCache.size;
    this.versionCache.clear();
    if (n) this.logger.log(`版本缓存已失效：${n} 条`);
    return n;
  }

  /** 查询部署库当前版本（TTL 缓存） */
  private async getCurrentVersion(envId: string, moduleKey: string): Promise<string | undefined> {
    const key = `${envId}:${moduleKey}`;
    const cached = this.versionCache.get(key);
    if (cached && Date.now() - cached.at < this.versionTtl) return cached.value;

    let version: string | undefined;
    try {
      const row = await this.deployRepo.findOne({
        where: { envId, moduleKey },
        order: { deployedAt: 'DESC' },
      });
      version = row?.currentVersion;
    } catch (e) {
      this.logger.warn(`查询部署版本失败(${key}): ${e.message}`);
    }

    this.versionCache.set(key, { value: version, at: Date.now() });
    return version;
  }

  /**
   * 灰度命中：按 req 中的用户/header 查 deploy_canary_rules。
   * 命中返回 canaryVersion，未命中返回 stable。
   */
  private async resolveCanary(
    envId: string,
    moduleKey: string,
    stable: string,
    req?: any,
  ): Promise<string> {
    try {
      const rules = await this.canaryRepo.find({
        where: { envId, moduleKey, enabled: true },
        order: { createdAt: 'ASC' },
      });
      for (const rule of rules) {
        if (this.matchRule(rule.matchRule, this.extractUserId(req), req, rule.id)) {
          return rule.canaryVersion;
        }
      }
    } catch (e) {
      this.logger.warn(`查询灰度规则失败(${envId}:${moduleKey}): ${e.message}`);
    }
    return stable;
  }

  /** 从请求提取用户 ID：优先 req.user.id，其次 x-user-id 头 */
  private extractUserId(req?: any): string {
    return req?.user?.id || req?.headers?.['x-user-id'] || '';
  }

  /** 灰度规则匹配（与 deploy-console CanaryService 保持一致） */
  private matchRule(matchRule: any, userId: string, req: any, ruleId: string): boolean {
    if (!matchRule || typeof matchRule !== 'object') return false;
    switch (matchRule.type) {
      case 'user-list':
        return Array.isArray(matchRule.userIds) && matchRule.userIds.includes(userId);
      case 'percent':
        if (!userId) return false;
        return this.hashUserId(userId + ':' + ruleId) % 100 < Number(matchRule.value || 0);
      case 'header':
        return Array.isArray(matchRule.values) && matchRule.values.includes(req?.headers?.[matchRule.key?.toLowerCase()]);
      default:
        return false;
    }
  }

  /** FNV-1a 稳定 hash（同一输入永远同一数值） */
  private hashUserId(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h >>> 0);
  }

  private injectHead(html: string, meta: string): string {
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
    if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1>${meta}`);
    return meta + html;
  }
}
