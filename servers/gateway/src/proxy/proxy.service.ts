import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, Options, fixRequestBody } from 'http-proxy-middleware';
import { API_TIMEOUT } from '@web-system/shared';

@Injectable()
export class ProxyService implements OnModuleInit {
  private readonly logger = new Logger(ProxyService.name);

  private readonly authServiceUrl: string;
  private readonly userServiceUrl: string;
  private readonly aiServiceUrl: string;
  private readonly systemServiceUrl: string;
  private readonly todoServiceUrl: string;
  private readonly uploadServiceUrl: string;
  private readonly mcpGatewayUrl: string;
  private readonly finnewsServiceUrl: string;

  // 缓存 proxy 实例，避免每个请求都创建新实例
  private userProxy!: ReturnType<typeof createProxyMiddleware>;
  private authProxy!: ReturnType<typeof createProxyMiddleware>;
  private aiProxy!: ReturnType<typeof createProxyMiddleware>;
  private systemProxy!: ReturnType<typeof createProxyMiddleware>;
  private bianbianProxy!: ReturnType<typeof createProxyMiddleware>;
  private todoProxy!: ReturnType<typeof createProxyMiddleware>;
  private uploadProxy!: ReturnType<typeof createProxyMiddleware>;
  private uploadStaticProxy!: ReturnType<typeof createProxyMiddleware>;
  private bianbianStaticProxy!: ReturnType<typeof createProxyMiddleware>;
  private mcpProxy!: ReturnType<typeof createProxyMiddleware>;
  private finnewsProxy!: ReturnType<typeof createProxyMiddleware>;

  // 绑定 this，避免传递给 on.error 时丢失上下文
  private readonly boundErrorHandler: (err: Error, req: any, res: any) => void;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:6001');
    this.userServiceUrl = this.configService.get('USER_SERVICE_URL', 'http://localhost:6002');
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', 'http://localhost:6003');
    this.systemServiceUrl = this.configService.get('SYSTEM_SERVICE_URL', 'http://localhost:6004');
    this.todoServiceUrl = this.configService.get('TODO_SERVICE_URL', 'http://localhost:6005');
    this.uploadServiceUrl = this.configService.get('UPLOAD_SERVICE_URL', this.userServiceUrl);
    this.mcpGatewayUrl = this.configService.get('MCP_GATEWAY_URL', 'http://localhost:6006');
    this.finnewsServiceUrl = this.configService.get('FINNEWS_SERVICE_URL', 'http://localhost:6007');

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

    // 变变产品实际上属于 ai-service（servers/ai-service/src/bianbian/）
    // 不要指到 user-service，那边没有 bianbian controller
    this.bianbianProxy = this.createProxy(this.aiServiceUrl, '^/api', API_TIMEOUT.GATEWAY.AI_TASK);

    // TODO 服务（统一 pathRewrite 模式，只剥 /api）
    this.todoProxy = this.createProxy(this.todoServiceUrl, '^/api');

    // 上传（API 操作，非文件访问）— 统一 pathRewrite 模式
    this.uploadProxy = this.createProxy(this.userServiceUrl, '^/api');

    // 上传文件静态访问（/api/uploads/* → user-service / upload-service）
    // 需要剥掉 /api 前缀，因为后端静态文件挂载在 /uploads 而非 /api/uploads
    // 指向 user-service：用户头像通过 user-service 上传并保存到 user-service 的 uploads/ 目录
    // 即使 upload-service 未运行，单个微服务也可托管所有 /api/uploads/* 静态文件
    this.uploadStaticProxy = createProxyMiddleware({
      target: this.userServiceUrl,
      changeOrigin: true,
      timeout: 10_000,
      pathRewrite: { '^/api': '' },
      on: { error: this.boundErrorHandler },
    });

    // AI 生成图片静态访问（/api/uploads/bianbian/* → ai-service）
    // 先于通用 /api/uploads/* 匹配，将变变图片请求路由到 ai-service
    this.bianbianStaticProxy = createProxyMiddleware({
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

    // 财经资讯微服务（/api/finnews/* → finnews:6007）
    // pathRewrite：/api/finnews/api/market-pulse → /api/market-pulse（finnews controller 是 @Controller('api')）
    // 鉴权在 proxy.controller.ts 的路由方法里手动验证 Bearer token
    this.finnewsProxy = createProxyMiddleware({
      target: this.finnewsServiceUrl,
      changeOrigin: true,
      timeout: 30_000,
      pathRewrite: { '^/api/finnews': '' },
      on: {
        proxyReq: fixRequestBody as NonNullable<Options['on']>['proxyReq'],
        error: this.boundErrorHandler,
      },
    });

    this.logger.log('所有 Proxy 实例初始化完成');
  }

  getUserProxy() { return this.userProxy; }
  getAuthProxy() { return this.authProxy; }
  getAiProxy() { return this.aiProxy; }
  getSystemProxy() { return this.systemProxy; }
  getBianbianProxy() { return this.bianbianProxy; }
  getTodoProxy() { return this.todoProxy; }
  getUploadProxy() { return this.uploadProxy; }
  getUploadStaticProxy() { return this.uploadStaticProxy; }
  getBianbianStaticProxy() { return this.bianbianStaticProxy; }
  getMcpProxy() { return this.mcpProxy; }
  getFinnewsProxy() { return this.finnewsProxy; }
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
