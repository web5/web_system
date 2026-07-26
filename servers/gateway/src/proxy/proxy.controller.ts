import {
  Controller,
  All,
  Req,
  Res,
  Post,
  Header,
  Logger,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { Public } from '../auth/public.decorator';
import * as http from 'http';
import * as url from 'url';
import { API_TIMEOUT } from '@web-system/shared';

@ApiExcludeController()
@Public() // API 路由的认证由各后端微服务自行处理，Gateway 仅做代理转发
@Controller('api')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(private proxyService: ProxyService) {}

  @All('auth/:path(*)')
  proxyAuth(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAuthProxy()(req, res);
  }

  @All('users/:path(*)')
  @All('users')
  proxyUsers(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // SSE 流式对话 — 用原生 http 转发，避免 http-proxy-middleware 缓冲问题
  @Post('ai/chat/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  proxyAiChatStream(@Req() req: Request, @Res() res: Response) {
    const aiUrl = this.proxyService.getAiServiceUrl();
    const body = JSON.stringify(req.body);

    const parsedUrl = url.parse(aiUrl);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/ai/chat/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'keep-alive',
      },
      timeout: API_TIMEOUT.GATEWAY.AI_TASK,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      proxyRes.on('data', (chunk: Buffer) => res.write(chunk));
      proxyRes.on('end', () => res.end());
    });

    // 客户端断开时取消上游请求
    req.on('close', () => { proxyReq.destroy(); });

    proxyReq.on('error', (err) => {
      this.logger.error(`SSE proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'AI service unavailable' });
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: 'AI service timeout' });
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  // TTS 语音合成 — 用原生 http 转发，确保二进制音频流原样透传
  @Post('ai/tts/speak')
  proxyAiTtsSpeak(@Req() req: Request, @Res() res: Response) {
    const aiUrl = this.proxyService.getAiServiceUrl();
    const body = JSON.stringify(req.body);

    const parsedUrl = url.parse(aiUrl);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/ai/tts/speak',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
      },
      timeout: API_TIMEOUT.GATEWAY.TTS,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const contentType = proxyRes.headers['content-type'] || '';

      if (contentType.startsWith('audio/')) {
        res.writeHead(statusCode, {
          'Content-Type': contentType,
          'Content-Length': proxyRes.headers['content-length'] || '',
          'Cache-Control': 'public, max-age=3600',
        });
        proxyRes.on('data', (chunk: Buffer) => res.write(chunk));
        proxyRes.on('end', () => res.end());
      } else {
        let errorBody = '';
        proxyRes.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
        proxyRes.on('end', () => {
          try {
            res.status(statusCode).json(JSON.parse(errorBody));
          } catch {
            res.status(502).json({ code: 502, message: 'TTS service error' });
          }
        });
      }
    });

    req.on('close', () => { proxyReq.destroy(); });

    proxyReq.on('error', (err) => {
      this.logger.error(`TTS proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'TTS service unavailable' });
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: 'TTS service timeout' });
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  @All('ai/:path(*)')
  @All('ai')
  proxyAi(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAiProxy()(req, res);
  }

  @All('admin/:path(*)')
  @All('admin')
  proxySystem(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getSystemProxy()(req, res);
  }

  @All('bianbian/:path(*)')
  @All('bianbian')
  proxyBianbian(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getBianbianProxy()(req, res);
  }

  // 精确匹配 /api/todos（无尾斜杠）
  @All('todos')
  proxyTodosExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getTodoProxy()(req, res);
  }

  // 通配 /api/todos/:path(*)
  @All('todos/:path(*)')
  proxyTodosWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getTodoProxy()(req, res);
  }

  @All('upload/:path(*)')
  @All('upload')
  proxyUpload(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUploadProxy()(req, res);
  }

  /** 上传文件的静态资源访问（/api/uploads/* → user-service） */
  @All('uploads/:path(*)')
  @All('uploads')
  proxyUploadStatic(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUploadStaticProxy()(req, res, (e?: Error) => {
      if (e) {
        this.logger.error(`静态资源代理错误: ${e.message}`);
      }
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  @All(':path(*)')
  proxyApi(@Req() req: Request, @Res() res: Response) {
    res.status(404).json({ code: 404, message: `Unknown API route: ${req.method} ${req.path}` });
  }
}
