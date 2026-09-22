import * as http from 'http';
import type { AddressInfo } from 'net';
import { SERVICE_URL_DEFAULTS } from '@web-system/shared';
import { ProxyService } from './proxy.service';

/**
 * A4（specs/backend-consolidation/design.md §1.6）：上传链路切到 upload-service。
 *
 * 这里用**真 HTTP**（三个假上游 + 一个假网关）而不是断言私有字段：
 * 变变图片的「先新后旧」兜底是**响应码驱动**的中间件行为
 * （`selfHandleResponse` 拦 404 → 再问 ai-service），靠读代码很难确认它真能工作。
 */

interface Upstream {
  url: string;
  hits: string[];
  close: () => Promise<void>;
}

async function startUpstream(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<Upstream> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url || '');
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function send(res: http.ServerResponse, code: number, body: string): void {
  res.writeHead(code, { 'content-type': 'text/plain' });
  res.end(body);
}

describe('ProxyService（A4：/api/upload* 与 /api/uploads/* 切到 upload-service）', () => {
  let upload: Upstream;
  let ai: Upstream;
  let user: Upstream;
  let gateway: http.Server;
  let gatewayUrl: string;
  let service: ProxyService;

  beforeEach(async () => {
    // 统一上传根（upload-service）：新文件在这里
    upload = await startUpstream((req, res) => {
      if (req.url === '/uploads/bianbian/new.png') return send(res, 200, 'from-upload-service');
      if (req.url === '/uploads/avatars/x.png') return send(res, 200, 'avatar-from-upload-service');
      if (req.url?.startsWith('/upload/categories')) {
        return send(res, 200, 'categories-from-upload-service');
      }
      send(res, 404, 'not-found-upload');
    });
    // 历史变变文件只在 ai-service
    ai = await startUpstream((req, res) => {
      if (req.url === '/uploads/bianbian/old.png') return send(res, 200, 'legacy-from-ai-service');
      send(res, 404, 'not-found-ai');
    });
    // user-service：A4 之后不该再收到任何上传/静态请求
    user = await startUpstream((_req, res) => send(res, 200, 'from-user-service'));

    service = new ProxyService({
      get: (key: string, def?: unknown) =>
        ({
          UPLOAD_SERVICE_URL: upload.url,
          AI_SERVICE_URL: ai.url,
          USER_SERVICE_URL: user.url,
        })[key] ?? def,
    } as never);
    service.onModuleInit();

    const fallthrough = (res: http.ServerResponse) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"code":404,"message":"File not found"}');
    };
    gateway = http.createServer((req, res) => {
      const url = req.url || '';
      if (url.startsWith('/api/uploads/bianbian')) {
        service.proxyBianbianStatic(req, res, () => fallthrough(res));
        return;
      }
      if (url.startsWith('/api/uploads')) {
        service.getUploadStaticProxy()(req, res, () => fallthrough(res)) as never;
        return;
      }
      if (url.startsWith('/api/upload')) {
        service.getUploadProxy()(req, res, () => fallthrough(res)) as never;
        return;
      }
      fallthrough(res);
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await Promise.all([
      upload.close(),
      ai.close(),
      user.close(),
      new Promise<void>((resolve) => gateway.close(() => resolve())),
    ]);
  });

  it('未配 UPLOAD_SERVICE_URL 时回落 upload-service，而不是 user-service', () => {
    const bare = new ProxyService({ get: (_k: string, def?: unknown) => def } as never);
    const url = (bare as unknown as { uploadServiceUrl: string }).uploadServiceUrl;
    expect(url).toBe(SERVICE_URL_DEFAULTS.upload);
    expect(url).not.toBe(SERVICE_URL_DEFAULTS.user);
  });

  it('/api/upload* 走 upload-service（user-service 收不到请求）', async () => {
    const res = await fetch(`${gatewayUrl}/api/upload/categories`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('categories-from-upload-service');
    expect(user.hits).toEqual([]);
  });

  it('/api/uploads/<其它分类> 静态由 upload-service 提供', async () => {
    const res = await fetch(`${gatewayUrl}/api/uploads/avatars/x.png`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('avatar-from-upload-service');
    expect(user.hits).toEqual([]);
  });

  it('变变新文件：upload-service 命中就返回，不问历史服务', async () => {
    const res = await fetch(`${gatewayUrl}/api/uploads/bianbian/new.png`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('from-upload-service');
    expect(ai.hits).toEqual([]);
  });

  it('变变历史文件：upload-service 404 → 回落 ai-service（长期兜底）', async () => {
    const res = await fetch(`${gatewayUrl}/api/uploads/bianbian/old.png`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('legacy-from-ai-service');
    expect(upload.hits).toContain('/uploads/bianbian/old.png');
    expect(ai.hits).toContain('/uploads/bianbian/old.png');
  });

  it('两边都没有 → 404，且历史服务只被问一次（不重复回落）', async () => {
    const res = await fetch(`${gatewayUrl}/api/uploads/bianbian/gone.png`);
    expect(res.status).toBe(404);
    expect(ai.hits.filter((h) => h === '/uploads/bianbian/gone.png')).toHaveLength(1);
  });
});
