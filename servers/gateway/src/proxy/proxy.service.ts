import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, Options, fixRequestBody } from 'http-proxy-middleware';
import type { IncomingMessage, ServerResponse } from 'http';
import { API_TIMEOUT, SERVICE_URL_DEFAULTS } from '@web-system/shared';

@Injectable()
export class ProxyService implements OnModuleInit {
  private readonly logger = new Logger(ProxyService.name);

  private readonly authServiceUrl: string;
  private readonly userServiceUrl: string;
  private readonly aiServiceUrl: string;
  private readonly aiAgentServiceUrl: string;
  private readonly systemServiceUrl: string;
  private readonly todoServiceUrl: string;
  private readonly uploadServiceUrl: string;
  private readonly mcpGatewayUrl: string;
  private readonly contentHubServiceUrl: string;
  private readonly knowledgeServiceUrl: string;

  // 缓存 proxy 实例，避免每个请求都创建新实例
  private userProxy!: ReturnType<typeof createProxyMiddleware>;
  private authProxy!: ReturnType<typeof createProxyMiddleware>;
  private aiProxy!: ReturnType<typeof createProxyMiddleware>;
  private aiAgentProxy!: ReturnType<typeof createProxyMiddleware>;
  private systemProxy!: ReturnType<typeof createProxyMiddleware>;
  private bianbianProxy!: ReturnType<typeof createProxyMiddleware>;
  private todoProxy!: ReturnType<typeof createProxyMiddleware>;
  private uploadProxy!: ReturnType<typeof createProxyMiddleware>;
  private uploadStaticProxy!: ReturnType<typeof createProxyMiddleware>;
  private bianbianStaticProxy!: ReturnType<typeof createProxyMiddleware>;
  private bianbianLegacyStaticProxy!: ReturnType<typeof createProxyMiddleware>;
  private mcpProxy!: ReturnType<typeof createProxyMiddleware>;
  private contentProxy!: ReturnType<typeof createProxyMiddleware>;
  private agentRunsProxy!: ReturnType<typeof createProxyMiddleware>;
  private agentDefsProxy!: ReturnType<typeof createProxyMiddleware>;
  private knowledgeProxy!: ReturnType<typeof createProxyMiddleware>;

  // 绑定 this，避免传递给 on.error 时丢失上下文
  private readonly boundErrorHandler: (err: Error, req: any, res: any) => void;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', SERVICE_URL_DEFAULTS.auth);
    this.userServiceUrl = this.configService.get('USER_SERVICE_URL', SERVICE_URL_DEFAULTS.user);
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', SERVICE_URL_DEFAULTS.ai);
    this.aiAgentServiceUrl = this.configService.get('AI_AGENT_SERVICE_URL', SERVICE_URL_DEFAULTS.aiAgent);
    this.systemServiceUrl = this.configService.get('SYSTEM_SERVICE_URL', SERVICE_URL_DEFAULTS.system);
    this.todoServiceUrl = this.configService.get('TODO_SERVICE_URL', SERVICE_URL_DEFAULTS.todo);
    // 上传回落 upload-service（6008）：A4 起 /api/upload* 与 /api/uploads/* 都指向它 ——
    // 上传收口后 user-service 不再持有 uploads/（见 specs/backend-consolidation §1.6）。
    // 注：此前默认值是 userServiceUrl（历史行为），显式配了 UPLOAD_SERVICE_URL 的部署不受影响。
    this.uploadServiceUrl = this.configService.get('UPLOAD_SERVICE_URL', SERVICE_URL_DEFAULTS.upload);
    this.mcpGatewayUrl = this.configService.get('MCP_GATEWAY_URL', SERVICE_URL_DEFAULTS.mcpGateway);
    this.contentHubServiceUrl = this.configService.get('CONTENT_HUB_SERVICE_URL', SERVICE_URL_DEFAULTS.contentHub);
    this.knowledgeServiceUrl = this.configService.get('KNOWLEDGE_SERVICE_URL', SERVICE_URL_DEFAULTS.knowledge);

    this.boundErrorHandler = (err, _req, res) => {
      this.logger.error(`代理请求失败: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 502, message: '上游服务不可用' }));
      }
    };
  }

  onModuleInit() {
    this.logger.log('初始化所有 Proxy 实例...');

    // 预创建所有 proxy 中间件（去掉 /api 前缀，转给对应服务自己的路由）
    // 注意：后端服务 controller 是 @Controller('auth' | 'users' | 'ai' | 'admin/...')，
    //       不是 @Controller('api/auth')，所以只剥 /api 这一层，保留 /auth /users /ai 等
    this.authProxy = this.createProxy(this.authServiceUrl, '^/api');
    this.userProxy = this.createProxy(this.userServiceUrl, '^/api');
    // AI 任务（对话 / 生图）链路较长，给 120s
    this.aiProxy = this.createProxy(this.aiServiceUrl, '^/api', API_TIMEOUT.GATEWAY.AI_TASK);
    this.systemProxy = this.createProxy(this.systemServiceUrl, '^/api');

    // AI Agent 服务（agent 编排，SSE 长链路，AI_TASK 超时）
    // pathRewrite：/api/ai-agent/agent/run → /agent/run（ai-agent 的 controller 是 agent/ocr，不带 /ai-agent 前缀）
    this.aiAgentProxy = this.createProxy(this.aiAgentServiceUrl, '^/api/ai-agent', API_TIMEOUT.GATEWAY.AI_TASK);

    // 变变产品实际上属于 ai-service（servers/ai-service/src/bianbian/）
    // 不要指到 user-service，那边没有 bianbian controller
    this.bianbianProxy = this.createProxy(this.aiServiceUrl, '^/api', API_TIMEOUT.GATEWAY.AI_TASK);

    // TODO 服务（统一 pathRewrite 模式，只剥 /api）
    this.todoProxy = this.createProxy(this.todoServiceUrl, '^/api');

    // 上传（API 操作，非文件访问）— 统一 pathRewrite 模式
    this.uploadProxy = this.createProxy(this.uploadServiceUrl, '^/api');

    // 上传文件静态访问（/api/uploads/* → upload-service）
    // 需要剥掉 /api 前缀，因为后端静态文件挂载在 /uploads 而非 /api/uploads。
    // 指向 upload-service 是 A4 的核心：文件写在它的统一上传根（默认 ~/web_system/uploads），
    // 静态服务也由它提供 —— 不再依赖 user-service 的同名目录。
    this.uploadStaticProxy = createProxyMiddleware({
      target: this.uploadServiceUrl,
      changeOrigin: true,
      timeout: 10_000,
      pathRewrite: { '^/api': '' },
      on: { error: this.boundErrorHandler },
    });

    // 变变图片（/api/uploads/bianbian/*）：**先 upload-service（新文件），404 再回落 ai-service（历史文件）**
    //
    // 为什么需要这条链：A3 之后新生成的变变图片落在统一上传根（upload-service 出静态），
    // 而历史文件只存在于 ai-service 本机 —— 两者 URL 形状完全一样（`/api/uploads/bianbian/<file>`），
    // 只能靠「先新后旧」的顺序区分。这条兜底路由按设计长期保留（design §1.6），
    // 不随 A7 删除；等将来单独一轮「变变历史文件迁移」才可能退役。
    //
    // 实现要点：selfHandleResponse=true（否则中间件会把上游 404 直接写给客户端，
    // 就没机会回落了），因此非 404 的响应由下面的 proxyRes 手动回写。
    this.bianbianStaticProxy = createProxyMiddleware({
      target: this.uploadServiceUrl,
      changeOrigin: true,
      timeout: 10_000,
      pathRewrite: { '^/api': '' },
      selfHandleResponse: true,
      on: {
        // http-proxy-middleware v3 把 on.* 的参数声明成 unknown，这里显式收窄（不做类型体操，直接用 node 类型）
        proxyRes: (proxyResRaw, reqRaw, resRaw) => {
          const proxyRes = proxyResRaw as IncomingMessage;
          const req = reqRaw as IncomingMessage;
          const res = resRaw as ServerResponse;
          if (proxyRes.statusCode === 404) {
            proxyRes.resume(); // 丢弃上游 404（别把它写出去），改问历史文件服务
            this.fallbackBianbianToLegacy(req, res);
            return;
          }
          // 正常响应：selfHandleResponse 下中间件不再代劳，这里手动回写
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
        error: (err, reqRaw, resRaw) => {
          this.logger.warn(`[bianbian] 主目标（upload-service）代理失败: ${err.message}`);
          this.fallbackBianbianToLegacy(reqRaw as IncomingMessage, resRaw as ServerResponse);
        },
      },
    });

    // 变变历史文件（只在 ai-service 本机，A8 之前它自己也仍往本地落盘）
    this.bianbianLegacyStaticProxy = createProxyMiddleware({
      target: this.aiServiceUrl,
      changeOrigin: true,
      timeout: 10_000,
      pathRewrite: { '^/api': '' },
      on: { error: this.boundErrorHandler },
    });

    // MCP 网关（mcp-admin 管理接口 /api/mcp/* → mcp-gateway）
    // pathRewrite：/api/mcp/modules → /api/modules（mcp-gateway 自身是 /api 前缀）
    this.mcpProxy = createProxyMiddleware({
      target: this.mcpGatewayUrl,
      changeOrigin: true,
      timeout: 30_000,
      pathRewrite: { '^/api/mcp': '/api' },
      on: {
        proxyReq: fixRequestBody as NonNullable<Options['on']>['proxyReq'],
        error: this.boundErrorHandler,
      },
    });

    // 内容中枢通道（/api/content-hub/* → content-hub:6007）—— 唯一入口
    // 财经资讯与内容管道共用：剥掉 /api/content-hub 后即为 content-hub 的真实路由
    //   - /api/content-hub/api/papers          → /api/papers（财经资讯，@Controller('api')）
    //   - /api/content-hub/api/content/sources → /api/content/sources（内容管道，@Controller('api/content')）
    // 历史上另有 /api/finnews/* 通道（同样指向 content-hub），已统一到本通道。
    // 鉴权在 proxy.controller.ts 的路由方法里手动验证 Bearer token
    this.contentProxy = createProxyMiddleware({
      target: this.contentHubServiceUrl,
      changeOrigin: true,
      timeout: 30_000,
      pathRewrite: { '^/api/content-hub': '' },
      on: {
        proxyReq: fixRequestBody as NonNullable<Options['on']>['proxyReq'],
        error: this.boundErrorHandler,
      },
    });

    // Agent 运行记录（/api/agent-runs/* → ai-service）
    // 与其它服务一致：只剥 /api，ai-service controller 是 @Controller('agent-runs')
    this.agentRunsProxy = this.createProxy(this.aiServiceUrl, '^/api');

    // Agent 定义管理（/api/agent-defs/* → ai-service）
    // pathRewrite：/api/agent-defs/admin/agent-defs → /admin/agent-defs（ai-service controller 是 @Controller('admin/agent-defs')）
    this.agentDefsProxy = createProxyMiddleware({
      target: this.aiServiceUrl,
      changeOrigin: true,
      timeout: 30_000,
      pathRewrite: { '^/api/agent-defs': '/admin/agent-defs' },
      on: {
        proxyReq: fixRequestBody as NonNullable<Options['on']>['proxyReq'],
        error: this.boundErrorHandler,
      },
    });

    // RAG 知识服务（/api/knowledge/* → knowledge-service）
    // 只剥 /api，knowledge-service controller 是 @Controller('knowledge')
    this.knowledgeProxy = this.createProxy(this.knowledgeServiceUrl, '^/api');

    this.logger.log('所有 Proxy 实例初始化完成');
  }

  getUserProxy() { return this.userProxy; }
  getAuthProxy() { return this.authProxy; }
  getAiProxy() { return this.aiProxy; }
  getAiAgentProxy() { return this.aiAgentProxy; }
  getAiAgentServiceUrl() { return this.aiAgentServiceUrl; }
  getSystemProxy() { return this.systemProxy; }
  getBianbianProxy() { return this.bianbianProxy; }
  getTodoProxy() { return this.todoProxy; }
  getUploadProxy() { return this.uploadProxy; }
  getUploadStaticProxy() { return this.uploadStaticProxy; }

  /**
   * 变变图片：**先问 upload-service（新文件），仅在 404 时回落 ai-service（历史文件）**。
   *
   * 典型 404 由 `on.proxyRes` 捕获（`selfHandleResponse` 下才能拦下来），
   * 连接层错误由 `on.error` 捕获；两者都走同一条回落路径（每个请求只回落一次）。
   */
  proxyBianbianStatic(
    req: IncomingMessage,
    res: ServerResponse,
    next?: (e?: Error) => void,
  ): void {
    this.bianbianStaticProxy(req, res, (e?: Error) => {
      this.fallbackBianbianToLegacy(req, res, next, e ? `主目标错误：${e.message}` : '主目标未处理');
    });
  }

  /**
   * 回落到 ai-service 的历史变变文件服务。
   *
   * `req` 上打标记而不是用实例状态：proxy 是单例、请求是并发的，
   * 落一次就够 —— 否则「两边都 404」会变成两次回落/重复写响应。
   */
  private fallbackBianbianToLegacy(
    req: IncomingMessage,
    res: ServerResponse,
    next?: (e?: Error) => void,
    reason?: string,
  ): void {
    const marked = req as IncomingMessage & { __bianbianFellBack?: boolean };
    if (marked.__bianbianFellBack || res.headersSent) return;
    marked.__bianbianFellBack = true;
    if (reason) this.logger.warn(`[bianbian] 回落历史文件服务（${reason}）`);
    if (next) {
      this.bianbianLegacyStaticProxy(req, res, next);
      return;
    }
    this.bianbianLegacyStaticProxy(req, res);
  }
  getMcpProxy() { return this.mcpProxy; }
  getKnowledgeProxy() { return this.knowledgeProxy; }
  getAgentRunsProxy() { return this.agentRunsProxy; }
  getAgentDefsProxy() { return this.agentDefsProxy; }
  getContentProxy() { return this.contentProxy; }
  getAiServiceUrl() { return this.aiServiceUrl; }

  /**
   * 创建通用代理中间件
   * @param timeoutMs 代理超时（毫秒），默认 PROXY_TIMEOUT.DEFAULT (30s)
   */
  private createProxy(
    target: string,
    pathRewritePattern?: string,
    timeoutMs: number = API_TIMEOUT.GATEWAY.DEFAULT,
  ): ReturnType<typeof createProxyMiddleware> {
    const options: Options = {
      target,
      changeOrigin: true,
      on: {
        proxyReq: fixRequestBody as NonNullable<Options['on']>['proxyReq'],
        error: this.boundErrorHandler,
      },
      timeout: timeoutMs,
      proxyTimeout: timeoutMs,
    };

    if (pathRewritePattern) {
      options.pathRewrite = { [pathRewritePattern]: '' };
    }

    return createProxyMiddleware(options);
  }
}
