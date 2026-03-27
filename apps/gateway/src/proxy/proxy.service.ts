import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';

@Injectable()
export class ProxyService {
  private authServiceUrl: string;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:3001');
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

  createApiProxy() {
    return createProxyMiddleware({
      target: this.authServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api': '',
      },
      on: {
        proxyReq: fixRequestBody,
      },
    });
  }
}
