import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

@Injectable()
export class SwaggerDocsService {
  private authServiceUrl: string;
  private userServiceUrl: string;
  private aiServiceUrl: string;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:3001');
    this.userServiceUrl = this.configService.get('USER_SERVICE_URL', 'http://localhost:3002');
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', 'http://localhost:3003');
  }

  /** 代理 Auth 服务的 Swagger (docs → /swagger/auth) */
  createAuthDocsProxy() {
    return createProxyMiddleware({
      target: this.authServiceUrl,
      changeOrigin: true,
      pathRewrite: { '^/swagger/auth': '/docs' },
      on: { proxyReq: fixRequestBody },
    });
  }

  /** 代理 AI 服务的 Swagger (api-docs → /swagger/ai) */
  createAiDocsProxy() {
    return createProxyMiddleware({
      target: this.aiServiceUrl,
      changeOrigin: true,
      pathRewrite: { '^/swagger/ai': '/api-docs' },
      on: { proxyReq: fixRequestBody },
    });
  }

  /** 代理 User 服务的 Swagger (docs → /swagger/user) */
  createUserDocsProxy() {
    return createProxyMiddleware({
      target: this.userServiceUrl,
      changeOrigin: true,
      pathRewrite: { '^/swagger/user': '/docs' },
      on: { proxyReq: fixRequestBody },
    });
  }
}
