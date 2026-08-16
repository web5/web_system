import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { join, normalize, extname } from 'path';
import { readFileSync, existsSync, statSync } from 'fs';
import { DeployDeploymentEntity } from './deploy-deployment.entity';
import { DeployModuleEntity } from './deploy-module.entity';
import { DeployCanaryRuleEntity } from './deploy-canary-rule.entity';

/** gateway 托管前端静态文件的根目录 */
const PUBLIC_ROOT = join(__dirname, '..', '..', 'public');

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
  ) {}

  /** 当前环境 ID（来自配置 DEPLOY_ENV_ID，缺省 dev） */
  private get envId(): string {
    return this.configService.get('DEPLOY_ENV_ID') || 'dev';
  }

  /**
   * 渲染 index.html。
   * pub === 'shell'：注入模块清单（微前端基座）
   * pub === 'console'：deploy-console 独立 SPA，不注入清单
   */
  async render(pub: string, req?: any): Promise<string> {
    const html = this.readHtml(pub);
    if (pub !== 'shell') {
      // deploy-console 等非微前端应用，只注入环境标识
      const meta = `<script>window.__DEPLOY_ENV__=${JSON.stringify(this.envId)};</script>`;
      return this.injectHead(html, meta);
    }

    // 基座：注入模块清单
    const manifest = await this.resolveModulesManifest(this.envId, req);
    const meta = `<script id="__MODULES_MANIFEST__">window.__MODULES_MANIFEST__=${JSON.stringify(manifest)};</script>`;
    return this.injectHead(html, meta);
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

  /** 读取 index.html，带 mtime 缓存 */
  private readHtml(pub: string): string {
    const file = join(PUBLIC_ROOT, pub, 'index.html');
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
