import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

@Injectable()
export class ProxyService {
  private authServiceUrl: string;
  private userServiceUrl: string;
  private aiServiceUrl: string;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:3001');
    this.userServiceUrl = this.configService.get('USER_SERVICE_URL', 'http://localhost:3002');
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', 'http://localhost:3003');
  }

  createAuthProxy() {
    return createProxyMiddleware({
      target: this.authServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/auth': '/auth',
      },
      on: {
        proxyReq: fixRequestBody,
      },
    });
  }

  createUserProxy() {
    return createProxyMiddleware({
      target: this.userServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/users': '/users',
      },
      on: {
        proxyReq: fixRequestBody,
      },
    });
  }

  createAiProxy() {
    return createProxyMiddleware({
      target: this.aiServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/ai': '/ai',
      },
      on: {
        proxyReq: fixRequestBody,
      },
    });
  }

}
