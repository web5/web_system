import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import type { Request, Response, RequestHandler } from 'express';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private authServiceUrl: string;
  private userServiceUrl: string;
  private aiServiceUrl: string;
  private systemServiceUrl: string;
  private todoServiceUrl: string;
  private uploadServiceUrl: string;

  constructor(private configService: ConfigService) {
    this.authServiceUrl = this.configService.get('AUTH_SERVICE_URL', 'http://localhost:3001');
    this.userServiceUrl = this.configService.get('USER_SERVICE_URL', 'http://localhost:3002');
    this.aiServiceUrl = this.configService.get('AI_SERVICE_URL', 'http://localhost:3003');
    this.systemServiceUrl = this.configService.get('SYSTEM_SERVICE_URL', 'http://localhost:3004');
    this.todoServiceUrl = this.configService.get('TODO_SERVICE_URL', 'http://localhost:3005');
    this.uploadServiceUrl = this.configService.get('UPLOAD_SERVICE_URL', 'http://localhost:3006');
  }

  getAiServiceUrl(): string {
    return this.aiServiceUrl;
  }

  /** 通用代理超时，失败时返回 504 */
  private errorHandler(err: Error, _req: Request, res: Response) {
    this.logger.error(`Proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.status(504).json({ code: 504, message: 'Gateway timeout' });
    }
  }

  createAuthProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.authServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/auth': '/auth',
      },
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        proxyReq: fixRequestBody,
        error: this.errorHandler,
      },
    });
  }

  createUserProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.userServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/users': '/users',
      },
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        proxyReq: fixRequestBody,
        error: this.errorHandler,
      },
    });
  }

  createAiProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.aiServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/ai': '/ai',
      },
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        proxyReq: (proxyReq, req) => {
          fixRequestBody(proxyReq, req);
          // SSE 请求：禁用代理缓冲，避免延迟推送
          if (req.url?.includes('/chat/stream')) {
            proxyReq.setHeader('Connection', 'keep-alive');
          }
        },
        proxyRes: (proxyRes, req, res) => {
          // SSE 响应：透传 Content-Type，禁用压缩
          if (req.url?.includes('/chat/stream')) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            // 移除 Content-Encoding 避免压缩破坏流
            proxyRes.headers['content-encoding'] = '';
            // 禁用代理内部缓冲
            proxyRes.headers['transfer-encoding'] = 'chunked';
          }
        },
        error: this.errorHandler,
      },
    });
  }

  createSystemProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.systemServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/admin': '/admin',
      },
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        proxyReq: fixRequestBody,
        error: this.errorHandler,
      },
    });
  }

  createBianbianProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.aiServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/bianbian': '/bianbian',
      },
      proxyTimeout: 120000,
      timeout: 120000,
      on: {
        proxyReq: fixRequestBody,
        error: this.errorHandler,
      },
    });
  }

  createTodoProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.todoServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/todos': '/todos',
      },
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        proxyReq: fixRequestBody,
        error: this.errorHandler,
      },
    });
  }

  createUploadProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.uploadServiceUrl,
      changeOrigin: true,
      pathRewrite: {
        '^/api/upload': '/upload',
      },
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        proxyReq: fixRequestBody,
        error: this.errorHandler,
      },
    });
  }

  /** 上传文件静态资源代理（/uploads/* → upload-service） */
  createUploadStaticProxy(): RequestHandler {
    return createProxyMiddleware({
      target: this.uploadServiceUrl,
      changeOrigin: true,
      proxyTimeout: 30000,
      timeout: 30000,
      on: {
        error: this.errorHandler,
      },
    });
  }

}
