import {
  Controller,
  All,
  Req,
  Res,
  Post,
  Header,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import * as http from 'http';
import * as url from 'url';

@ApiExcludeController()
@Controller('api')
export class ProxyController {
  constructor(private proxyService: ProxyService) {}

  @All('auth/:path(*)')
  proxyAuth(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createAuthProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('users/:path(*)')
  proxyUsersSubpath(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createUserProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('users')
  proxyUsers(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createUserProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
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
      timeout: 120000,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      // 透传所有 SSE 数据到客户端
      proxyRes.on('data', (chunk: Buffer) => {
        res.write(chunk);
      });
      proxyRes.on('end', () => {
        res.end();
      });
    });

    proxyReq.on('error', (err) => {
      console.error('SSE proxy error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'AI service unavailable' });
      } else {
        res.end();
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
      timeout: 15000,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const contentType = proxyRes.headers['content-type'] || '';

      if (contentType.startsWith('audio/')) {
        // 成功：透传音频二进制数据
        res.writeHead(statusCode, {
          'Content-Type': contentType,
          'Content-Length': proxyRes.headers['content-length'] || '',
          'Cache-Control': 'public, max-age=3600',
        });
        proxyRes.on('data', (chunk: Buffer) => res.write(chunk));
        proxyRes.on('end', () => res.end());
      } else {
        // 失败：读取 JSON 错误信息透传
        let errorBody = '';
        proxyRes.on('data', (chunk: Buffer) => {
          errorBody += chunk.toString();
        });
        proxyRes.on('end', () => {
          try {
            const parsed = JSON.parse(errorBody);
            res.status(statusCode).json(parsed);
          } catch {
            res.status(502).json({ code: 502, message: 'TTS service error' });
          }
        });
      }
    });

    proxyReq.on('error', (err) => {
      console.error('TTS proxy error:', err.message);
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
    const proxy = this.proxyService.createAiProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('admin/:path(*)')
  @All('admin')
  proxySystem(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createSystemProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('bianbian/:path(*)')
  @All('bianbian')
  proxyBianbian(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createBianbianProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('todos/:path(*)')
  proxyTodosSubpath(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createTodoProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('todos')
  proxyTodos(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createTodoProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('upload/:path(*)')
  @All('upload')
  proxyUpload(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createUploadProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  /** 上传文件的静态资源访问（/uploads/* → upload-service） */
  @All('uploads/:path(*)')
  @All('uploads')
  proxyUploadStatic(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createUploadStaticProxy();
    return proxy(req, res, () => {
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  @All(':path(*)')
  proxyApi(@Req() req: Request, @Res() res: Response) {
    res.status(404).json({ code: 404, message: `Unknown API route: ${req.method} ${req.path}` });
  }
}
