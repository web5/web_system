import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Request, Response } from 'express';
import { createProxyMiddleware, fixRequestBody, type RequestHandler } from 'http-proxy-middleware';
import {
  DeployEndpointEntity,
  DeployEnvEntity,
  DeployHostEntity,
  DeployServiceEntity,
  DeployServiceEnvEntity,
  DeployServiceRouteEntity,
  DeploySiteEntity,
} from './entities';
import {
  endpointMatches,
  pickRoute,
  resolveEnvId,
  resolveUpstream,
  rewritePath,
  type EndpointRule,
  type RouteRule,
} from './route-match';

/** 规则缓存 TTL：改动后最多 60s 生效（V9 判据；手动 reload 立即生效） */
export const ROUTE_CACHE_TTL_MS = 60_000;

/** 环境请求头（前端切换环境后随请求携带） */
export const ENV_HEADER = 'x-env-id';

interface CacheShape {
  loadedAt: number;
  routes: RouteRule[];
  /** serviceKey → { unknownPolicy, defaultPort } */
  services: Map<string, { unknownPolicy: string; defaultPort: number | null }>;
  /** `${serviceKey}@${envId}` → 指向 */
  bindings: Map<string, DeployServiceEnvEntity>;
  /** serviceKey → 接口清单 */
  endpoints: Map<string, EndpointRule[]>;
  /** 主机组名 → 可解析地址（Q17 方案 D：地址只在 deploy_hosts 维护） */
  hostAddressByName: Map<string, string>;
  sites: { host: string; defaultEnvId: string }[];
  envIds: Set<string>;
}

export type Resolution =
  | { kind: 'nomatch' }
  | { kind: 'deny'; status: number; reason: string }
  | { kind: 'error'; status: number; reason: string }
  | {
      kind: 'proxy';
      upstream: string;
      rewrittenPath: string;
      rule: RouteRule;
      timeoutMs: number;
      envId: string;
    };

/**
 * DB 驱动路由（双域重构 P2，**默认关闭**）
 *
 * 行为：命中 `deploy_service_routes` 的请求由本服务转发（上游按 `deploy_service_envs` 的
 * 「指向」解析，环境由请求头/Host 决定）；未命中则返回 nomatch ——
 * 调用方（catch-all 控制器）与既有硬编码路由/404 行为保持一致（FR-10.2 双轨零破坏）。
 *
 * 安全：`/api/*` 的鉴权惯例是「下沉到各微服务」（ProxyController 为 @Public），
 * 故 passthrough 不做网关校验；`jwt` / `service_key` 为**可选**的网关级加固。
 */
@Injectable()
export class DynamicRouteService implements OnModuleInit {
  private readonly logger = new Logger(DynamicRouteService.name);
  private cache: CacheShape | null = null;
  /** 按超时值缓存 proxy 实例（超时是实例级选项，无法逐请求变化） */
  private readonly proxyByTimeout = new Map<number, RequestHandler>();

  readonly enabled: boolean;

  constructor(
    @InjectDataSource('deploy')
    private readonly deployDataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.enabled = this.configService.get<string>('GATEWAY_DB_ROUTES') === '1';
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.logger.log(
        `DB 路由已启用（GATEWAY_DB_ROUTES=1，TTL=${ROUTE_CACHE_TTL_MS / 1000}s）`,
      );
    } else {
      this.logger.log('DB 路由未启用（GATEWAY_DB_ROUTES≠1），全部走既有硬编码路由');
    }
  }

  /** 手动失效缓存（供 /api/internal/gateway/reload） */
  reload(): void {
    this.cache = null;
    this.logger.log('DB 路由缓存已手动失效');
  }

  private async load(force = false): Promise<CacheShape> {
    if (!force && this.cache && Date.now() - this.cache.loadedAt < ROUTE_CACHE_TTL_MS) {
      return this.cache;
    }
    const [routes, services, bindings, endpoints, sites, hosts] = await Promise.all([
      this.deployDataSource.getRepository(DeployServiceRouteEntity).find({ where: { enabled: true } }),
      this.deployDataSource.getRepository(DeployServiceEntity).find(),
      this.deployDataSource.getRepository(DeployServiceEnvEntity).find(),
      this.deployDataSource.getRepository(DeployEndpointEntity).find({ where: { enabled: true } }),
      this.deployDataSource.getRepository(DeploySiteEntity).find(),
      this.deployDataSource.getRepository(DeployHostEntity).find({ where: { enabled: true } }),
    ]);

    const serviceMap = new Map<string, { unknownPolicy: string; defaultPort: number | null }>();
    for (const s of services) {
      serviceMap.set(s.key, { unknownPolicy: s.unknownPolicy, defaultPort: s.defaultPort });
    }
    const bindingMap = new Map<string, DeployServiceEnvEntity>();
    for (const b of bindings) bindingMap.set(`${b.serviceKey}@${b.envId}`, b);
    const endpointMap = new Map<string, EndpointRule[]>();
    for (const e of endpoints) {
      const list = endpointMap.get(e.serviceKey) || [];
      if (!e.deprecated) list.push({ method: e.method, pathPattern: e.pathPattern });
      endpointMap.set(e.serviceKey, list);
    }

    this.cache = {
      loadedAt: Date.now(),
      routes: routes.map((r) => ({
        serviceKey: r.serviceKey,
        envId: r.envId,
        pathPrefix: r.pathPrefix,
        stripPrefix: r.stripPrefix,
        rewriteTo: r.rewriteTo,
        upstreamOverride: r.upstreamOverride,
        timeoutMs: r.timeoutMs,
        authMode: r.authMode,
        priority: r.priority,
      })),
      services: serviceMap,
      bindings: bindingMap,
      endpoints: endpointMap,
      hostAddressByName: new Map(hosts.map((h) => [h.name, h.host])),
      sites: sites.map((s) => ({ host: s.host, defaultEnvId: s.defaultEnvId })),
      envIds: new Set<string>(),
    };
    return this.cache;
  }

  /**
   * 解析一个请求：命中规则 → proxy；未命中 → nomatch；配置缺失 → error（fail-fast，不回落本机）。
   */
  async resolve(
    method: string,
    reqPath: string,
    host: string | undefined,
    headerEnvId: string | undefined,
  ): Promise<Resolution> {
    if (!this.enabled) return { kind: 'nomatch' };
    const c = await this.load();
    const envId = resolveEnvId(headerEnvId, host, c.sites);
    const rule = pickRoute(c.routes, reqPath, envId);
    if (!rule) return { kind: 'nomatch' };

    // 未登记接口策略（V10）：仅当该服务显式配置 deny 时才拦截
    const svc = c.services.get(rule.serviceKey);
    if (svc?.unknownPolicy === 'deny') {
      const eps = c.endpoints.get(rule.serviceKey) || [];
      if (!endpointMatches(method, reqPath, eps)) {
        return {
          kind: 'deny',
          status: 403,
          reason: `接口未登记且服务 ${rule.serviceKey} 的 unknownPolicy=deny：${method} ${reqPath}`,
        };
      }
    }

    const binding = c.bindings.get(`${rule.serviceKey}@${envId}`) || null;
    const upstream = resolveUpstream(rule, binding, c.hostAddressByName);
    if (!upstream) {
      const reason = !binding?.hostName
        ? `服务 ${rule.serviceKey} 在环境 ${envId} 未配置主机组指向`
        : !c.hostAddressByName.has(binding.hostName)
          ? `主机组 ${binding.hostName} 未在主机管理登记或已停用（服务 ${rule.serviceKey} @ ${envId}）`
          : `服务 ${rule.serviceKey} 在环境 ${envId} 未配置端口`;
      return {
        kind: 'error',
        status: 502,
        reason: `${reason}，拒绝回落本机`,
      };
    }

    return {
      kind: 'proxy',
      upstream,
      rewrittenPath: rewritePath(reqPath, rule),
      rule,
      timeoutMs: rule.timeoutMs > 0 ? rule.timeoutMs : 30000,
      envId,
    };
  }

  /**
   * 兜底入口：由 `ProxyController` 的最终 404 分支调用。
   *
   * @returns true = 已由 DB 路由处理（响应已写出）；false = 未命中，调用方保持原有 404 行为不变。
   */
  async tryHandle(req: Request, res: Response): Promise<boolean> {
    if (!this.enabled) return false;

    let resolution: Resolution;
    try {
      resolution = await this.resolve(
        req.method,
        req.path,
        req.headers.host,
        req.headers[ENV_HEADER] as string | undefined,
      );
    } catch (e) {
      this.logger.error(`DB 路由解析失败: ${(e as Error).message}`);
      this.sendJson(res, 502, 502, '路由配置读取失败');
      return true;
    }

    if (resolution.kind === 'nomatch') return false;

    if (resolution.kind === 'deny' || resolution.kind === 'error') {
      this.logger.warn(`DB 路由拒绝 ${req.method} ${req.path}: ${resolution.reason}`);
      this.sendJson(res, resolution.status, resolution.status, resolution.reason);
      return true;
    }

    // 规则级加严校验（passthrough 不做网关校验，与 ProxyController 的既有语义一致）
    if (resolution.rule.authMode === 'jwt') {
      const token = (req.headers.authorization || '').split(' ')[1];
      if (!token) {
        this.sendJson(res, 401, 401, '缺少 Authorization 头');
        return true;
      }
      try {
        await this.jwtService.verifyAsync(token);
      } catch {
        this.sendJson(res, 401, 401, 'Token 无效或已过期');
        return true;
      }
    } else if (resolution.rule.authMode === 'service_key') {
      const expected =
        this.configService.get<string>('GATEWAY_SERVICE_KEY') ||
        this.configService.get<string>('CONTENT_HUB_SERVICE_KEY') ||
        this.configService.get<string>('FINNEWS_SERVICE_KEY') ||
        '';
      if (!expected || req.headers['x-service-key'] !== expected) {
        this.sendJson(res, 403, 403, 'service_key 校验失败');
        return true;
      }
    }

    (req as any).__wsRoute = {
      upstream: resolution.upstream,
      rewrittenPath: resolution.rewrittenPath,
    };
    this.logger.debug(
      `DB 路由转发 ${req.method} ${req.path} → ${resolution.upstream}${resolution.rewrittenPath}（env=${resolution.envId}, service=${resolution.rule.serviceKey}）`,
    );
    this.dispatch(resolution)(req, res, () => {
      /* 已代理，无需 next */
    });
    return true;
  }

  private sendJson(res: Response, status: number, code: number, message: string): void {
    if (res.headersSent) return;
    res.status(status).json({ code, message });
  }

  /** 执行转发（按超时值复用 proxy 实例） */
  dispatch(resolution: Extract<Resolution, { kind: 'proxy' }>): RequestHandler {
    const { timeoutMs } = resolution;
    let proxy = this.proxyByTimeout.get(timeoutMs);
    if (!proxy) {
      proxy = createProxyMiddleware({
        // 占位：真实上游由 router 按请求决定（http-proxy-middleware 要求 target 必填）
        target: 'http://127.0.0.1:1',
        changeOrigin: true,
        timeout: timeoutMs,
        proxyTimeout: timeoutMs,
        router: (req) => (req as any).__wsRoute?.upstream as string,
        pathRewrite: (path, req) => ((req as any).__wsRoute?.rewrittenPath as string) ?? path,
        on: {
          proxyReq: fixRequestBody,
          error: (err, _req, res: any) => {
            this.logger.error(`DB 路由转发失败: ${err.message}`);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ code: 502, message: '上游服务不可用' }));
            }
          },
        },
      }) as unknown as RequestHandler;
      this.proxyByTimeout.set(timeoutMs, proxy);
      this.logger.log(`已创建 DB 路由 proxy 实例（timeout=${timeoutMs}ms）`);
    }
    return proxy;
  }
}
