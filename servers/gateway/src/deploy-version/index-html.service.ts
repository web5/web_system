import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { join, normalize, extname } from 'path';
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
 * 版本查询：deploy_deployments 表（envId, moduleKey）→ currentVersion，TTL 10s 缓存。
 * 未来灰度：在 resolveCanary() 中按用户规则返回 canary 版本即可。
 */
@Injectable()
export class IndexHtmlService {
  private readonly logger = new Logger(IndexHtmlService.name);
  private htmlCache = new Map<string, { mtime: number; content: string }>();
  private versionCache = new Map<string, VersionCache>();
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
   * 新结构（双域重构 P3）：
   * - `site` / `defaultEnv` / `switchable`：由请求 Host 匹配 `deploy_sites`
   * - `envs`：该站点下可切换的环境（挂件列表）
   * - `byEnv`：**每个环境 → 各应用的固定入口** `/static/modules/<appKey>/<envId>/index.js`
   *   （入口不含版本 → 切换版本只改磁盘指针，manifest 无需变化，R5）
   * - 兼容期字段 `env` / `modules` / `canary` 始终保留，供未升级客户端回落
   *
   * 未匹配到站点（localhost / IP 直连）→ 只返回旧结构，行为与改造前一致。
   *
   * **M8**：`DEPLOY_LEGACY_READ=1` 时短路到旧表读取源（见 `legacyRead`），新表完全不参与。
   * `source` 字段仅为排障标注（`new` / `legacy` / `new:nosite`），前端不依赖。
   */
  async buildManifest(req?: any): Promise<Record<string, any>> {
    const legacyEnv = this.envId;
    const legacy = await this.resolveModulesManifest(legacyEnv, req);

    // M8 回退：旧表为唯一读取源
    if (this.legacyRead) return this.buildLegacyManifest(legacyEnv, legacy);

    try {
      const site = await this.resolveSite(req);
      if (!site) {
        return {
          ...legacy,
          site: null,
          defaultEnv: legacyEnv,
          switchable: false,
          envs: [],
          byEnv: {},
          source: 'new:nosite',
        };
      }

      const [envs, apps, versions] = await Promise.all([
        this.envRepo.find({
          where: { siteKey: site.key, enabled: true },
          order: { sort: 'ASC', envId: 'ASC' },
        }),
        this.appRepo.find({ where: { deletedAt: IsNull(), enabled: true } }),
        this.appVersionRepo.find(),
      ]);

      const currentOf = new Map<string, string | null>();
      for (const v of versions) currentOf.set(`${v.appKey}@${v.envId}`, v.currentVersion);

      const byEnv: Record<string, Record<string, { entry: string; css: string | null }>> = {};
      for (const e of envs) {
        const entries: Record<string, { entry: string; css: string | null }> = {};
        for (const app of apps) {
          // 基座（site-version）不纳入 env 切换（Q107）
          if (app.deployMode !== 'env-dir') continue;
          if (!currentOf.get(`${app.key}@${e.envId}`)) continue;
          const cssRel = `/static/modules/${app.key}/${e.envId}/index.css`;
          entries[app.key] = {
            entry: `/static/modules/${app.key}/${e.envId}/index.js`,
            // 样式指针只在产物含 index.css 时被写入，按磁盘存在性给出（避免前端引 404）
            css: existsSync(join(PUBLIC_ROOT, 'static/modules', app.key, e.envId, 'index.css'))
              ? cssRel
              : null,
          };
        }
        byEnv[e.envId] = entries;
      }

      return {
        site: site.key,
        defaultEnv: site.defaultEnvId || legacyEnv,
        switchable: !!site.switchable,
        envs: envs.map((e) => ({ id: e.envId, name: e.name, isProd: e.isProd })),
        byEnv,
        // 兼容期字段（未升级客户端回落）
        env: legacyEnv,
        modules: legacy.modules,
        canary: legacy.canary,
        source: 'new',
      };
    } catch (e) {
      this.logger.warn(`manifest 新结构组装失败，回落旧结构：${(e as Error).message}`);
      return { ...legacy, site: null, defaultEnv: legacyEnv, switchable: false, envs: [], byEnv: {}, source: 'new:error' };
    }
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

  /** 基座 html 路径：优先版本目录（static/modules/shell/<版本>/），否则旧固定目录 */
  private async resolveShellHtmlFile(): Promise<string> {
    const legacy = join(PUBLIC_ROOT, 'shell', 'index.html');
    try {
      const version = await this.getCurrentVersion(this.envId, 'shell');
      if (!version) return legacy;
      const versioned = join(PUBLIC_ROOT, 'static/modules/shell', version, 'index.html');
      return existsSync(versioned) ? versioned : legacy;
    } catch {
      return legacy;
    }
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
