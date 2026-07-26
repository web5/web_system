import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

@Injectable()
export class ProxyService implements OnModuleInit {
  private readonly logger = new Logger(ProxyService.name);

  private readonly authServiceUrl: string;
  private readonly userServiceUrl: string;
  private readonly aiServiceUrl: string;
  private readonly systemServiceUrl: string;
  private readonly todoServiceUrl: string;
  private readonly uploadServiceUrl: string;

  // 缓存 proxy 实例，避免每个请求都创建新实例
  private userProxy!: ReturnType<typeof createProxyMiddleware>;
  private authProxy!: ReturnType<typeof createProxyMiddleware>;
  private aiProxy!: ReturnType<typeof createProxyMiddleware>;
  private systemProxy!: ReturnType<typeof createProxyMiddleware>;
  private bianbianProxy!: ReturnType<typeof createProxyMiddleware>;
  private todoProxy!: ReturnType<typeof createProxyMiddleware>;
  private uploadProxy!: ReturnType<typeof createProxyMiddleware>;
  private uploadStaticProxy!: ReturnType<typeof createProxyMiddleware>;

  // 绑定 this，避免传递给 on.error 时丢失上下文
  private readonly boundErrorHandler: (err: Error, req: any, res: any) => void;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:3001');
    this.userServiceUrl = this.configService.get('USER_SERVICE_URL', 'http://localhost:3002');
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', 'http://localhost:3003');
    this.systemServiceUrl = this.configService.get('SYSTEM_SERVICE_URL', 'http://localhost:3004');
    this.todoServiceUrl = this.configService.get('TODO_SERVICE_URL', 'http://localhost:3005');
    this.uploadServiceUrl = this.configService.get('UPLOAD_SERVICE_URL', this.userServiceUrl);

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

    // 预创建所有 proxy 中间件（带 pathRewrite 去掉 /api/ 前缀）
    this.authProxy = this.createProxy(this.authServiceUrl, '^/api/auth');
    this.userProxy = this.createProxy(this.userServiceUrl, '^/api/users');
    // ai 路径有特殊 SSE/TTS 处理，不对通用路由做 pathRewrite
    this.aiProxy = this.createProxy(this.aiServiceUrl);
    this.systemProxy = this.createProxy(this.systemServiceUrl, '^/api/admin');

    // 变变产品代理到 user 服务
    this.bianbianProxy = this.createProxy(this.userServiceUrl, '^/api/bianbian');

    // TODO 服务
    this.todoProxy = this.createProxy(this.todoServiceUrl, '^/api/todos');

    // 上传（API 操作，非文件访问）
    this.uploadProxy = this.createProxy(this.userServiceUrl, '^/api/upload');

    // 上传文件静态访问（/api/uploads/* → user-service）
    this.uploadStaticProxy = createProxyMiddleware({
      target: this.uploadServiceUrl,
      changeOrigin: true,
      timeout: 10_000,
      on: { error: this.boundErrorHandler },
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
  getAiServiceUrl() { return this.aiServiceUrl; }

  /**
   * 创建通用代理中间件
   */
  private createProxy(target: string, pathRewritePattern?: string): ReturnType<typeof createProxyMiddleware> {
    const options: Options = {
      target,
      changeOrigin: true,
      on: { error: this.boundErrorHandler },
      timeout: 30_000,
      proxyTimeout: 30_000,
    };

    if (pathRewritePattern) {
      options.pathRewrite = { [pathRewritePattern]: '' };
    }

    return createProxyMiddleware(options);
  }
}
