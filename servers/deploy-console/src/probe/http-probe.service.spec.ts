import * as http from 'http';
import { AddressInfo } from 'net';
import { HttpProbeService } from './http-probe.service';

/**
 * 用真实本地 http server 验证探活行为（node http 模块直连，绕过 undici bad-port 限制，
 * 与线上「fetch 访问不了 gateway:6000」场景一致）。
 */
describe('HttpProbeService', () => {
  let server: http.Server;
  let baseUrl: string;
  const svc = new HttpProbeService();

  const listen = async (handler: http.RequestListener): Promise<void> => {
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const close = async () => {
    if (server?.listening) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };

  afterEach(async () => {
    await close();
  });

  describe('HEAD（产物可访问性）', () => {
    it('2xx → ok=true', async () => {
      await listen((_req, res) => {
        res.statusCode = 200;
        res.end();
      });
      expect(await svc.headOk(`${baseUrl}/x.js`)).toBe(true);
      await close();
    });

    it('404 → ok=false', async () => {
      await listen((_req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await svc.headOk(`${baseUrl}/x.js`)).toBe(false);
      await close();
    });
  });

  describe('GET JSON', () => {
    it('200 且 JSON 可解析 → 返回对象', async () => {
      await listen((_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ modules: [{ name: 'admin', version: 'abc' }] }));
      });
      const json = await svc.getJson<{ modules: Array<{ name: string }> }>(`${baseUrl}/__manifest__`);
      expect(json?.modules?.[0]).toEqual({ name: 'admin', version: 'abc' });
      await close();
    });

    it('200 但响应体不是 JSON → null（状态码与 JSON 解析分开判定）', async () => {
      await listen((_req, res) => {
        res.end('not-json');
      });
      expect(await svc.getJson(`${baseUrl}/plain`)).toBeNull();
      await close();
    });

    it('404 → null', async () => {
      await listen((_req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await svc.getJson(`${baseUrl}/missing`)).toBeNull();
      await close();
    });
  });

  describe('fetchGatewayManifest（版本断言）', () => {
    it('裸 {modules:[...]} 响应可解析', async () => {
      await listen((_req, res) => {
        res.end(JSON.stringify({ modules: [{ key: 'admin', version: 'abc' }] }));
      });
      const m = await svc.fetchGatewayManifest(baseUrl);
      expect(m?.modules?.[0]?.version).toBe('abc');
      await close();
    });

    it('全局拦截器包装 {code,data:{modules:[...]}} 响应可解析', async () => {
      await listen((_req, res) => {
        res.end(JSON.stringify({ code: 0, data: { modules: [{ key: 'admin', version: 'def' }] } }));
      });
      const m = await svc.fetchGatewayManifest(baseUrl);
      expect(m?.modules?.[0]?.version).toBe('def');
      await close();
    });

    it('请求失败 → null（不抛错）', async () => {
      expect(await svc.fetchGatewayManifest('http://127.0.0.1:1')).toBeNull();
    });
  });

  describe('超时与连接错误', () => {
    it('连接被拒 → ok=false', async () => {
      const res = await svc.request('http://127.0.0.1:1/', 'GET');
      expect(res.ok).toBe(false);
      expect(res.status).toBe(0);
    });

    it('超时 → ok=false', async () => {
      let slowTimer: NodeJS.Timeout | undefined;
      await listen((_req, res) => {
        // 不响应，等客户端超时
        slowTimer = setTimeout(() => res.end(), 5000);
      });
      const res = await svc.request(`${baseUrl}/slow`, 'GET', 300);
      expect(res.ok).toBe(false);
      if (slowTimer) clearTimeout(slowTimer);
      await close();
    });
  });
});
