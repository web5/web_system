/**
 * 网关 trust proxy 回归测试（prod 限流分桶修复，2026-10-27）
 *
 * ── 这个测试存在的意义 ────────────────────────────────────────────────────
 *   生产的 @nestjs/throttler 限流是「每 IP 100 次/分钟」，按 req.ip 分桶。
 *   修复前网关没开 trust proxy → req.ip 恒等于 nginx 内网 IP → 全站共享一个桶
 *   （改前实测：200 次请求产生 205 条 TIME_WAIT/ESTAB=0、12672 次 connect() 失败）。
 *
 *   这个测试锁死的是**「trust 必须按代理 IP 白名单配」**这一条：
 *   数字跳数（1 / 2）与 trust=true 都能让 req.ip 变成客户端可控的值 → 限流可被绕过，
 *   而这类改动**不会报任何错**，只表现为「限流静默失效」，靠人工很难发现。
 *   所以除了正向断言，必须同时写**反向用例**：显式证明换成数字跳数 / true 时伪造会生效。
 *
 * ── 为什么不用 mock proxy-addr ────────────────────────────────────────────
 *   mock 掉 proxy-addr 测的是「我们对 mock 的假设」，不是真实行为。
 *   本文件一律用**真实 express app + 真实 HTTP 请求**（起 listen(0) 实例，
 *   用 http.request 打过去读服务端 req.ip）；
 *   生产形态（socket 对端 = nginx 内网 IP）本地造不出真实 socket，
 *   因此改用 **express 自己的 req.ip getter**（express/lib/request.js 里 defineGetter
 *   定义的那个真实函数）配一个生产形态的 req 对象来求值 —— 信任函数仍然来自
 *   真实 express app 的 'trust proxy fn'，没有绕过任何真实逻辑。
 *
 *   机制（forwarded + proxy-addr）：
 *     地址链 = [socket对端, XFF最右, …, XFF最左]（socket 在 index 0）；
 *     proxy-addr 从 index 0 起判定信任，命中第一个「不可信」就截断，返回截断后最后一个。
 *     nginx 用 $proxy_add_x_forwarded_for 追加 → XFF 最右 = 真实客户端 IP，伪造值在更左侧。
 */
import express from 'express';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
// express 内部模块没有官方类型声明，但 tsconfig 里 noImplicitAny=false，
// 因此这个 import 在类型层面是合法的；运行时经 esModuleInterop 拿到 module.exports。
import expressRequestProto from 'express/lib/request';
import {
  DEFAULT_TRUST_PROXY,
  applyTrustProxy,
  buildTrustProxyList,
  resolveThrottleTracker,
  type TrackerRequest,
} from './trust-proxy';

/** express app 实例类型（由 express() 工厂函数推导，避免手写 any） */
type ExpressApp = ReturnType<typeof express>;

// express 真实的 req.ip getter（express/lib/request.js 里 defineGetter 定义的那个函数）
const ipGetter = Object.getOwnPropertyDescriptor(expressRequestProto, 'ip')!.get!;

/** 生产形态请求：socket 对端 = prod nginx 内网 IP；XFF 由 nginx 追加（最右 = 真实客户端 IP） */
function prodRequest(app: ExpressApp, xff?: string) {
  return {
    app,
    headers: xff ? { 'x-forwarded-for': xff } : {},
    socket: { remoteAddress: DEFAULT_TRUST_PROXY },
    connection: { remoteAddress: DEFAULT_TRUST_PROXY },
  };
}

/** 用 express 真实 getter 求生产形态下的 req.ip */
function prodReqIp(app: ExpressApp, xff?: string): string | undefined {
  return ipGetter.call(prodRequest(app, xff));
}

/** 起一个真实 express 实例（listen 0 = 随机端口），跑完自动关闭 */
async function withRealServer(
  trustRaw: string,
  fn: (get: (headers?: Record<string, string>) => Promise<string>) => Promise<void>,
): Promise<void> {
  const app = express();
  applyTrustProxy(app, trustRaw);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const get = (headers?: Record<string, string>) =>
    new Promise<string>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/ip', method: 'GET', headers },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body).ip);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });

  try {
    await fn(get);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ────────────────────────────────────────────────────────────────────────────
describe('1. trust proxy 必须是「代理 IP 白名单」，不能是数字跳数 / true', () => {
  it('装到真实 express app 上后是数组形态的白名单，且不等于 1 / 2 / true', () => {
    const app = express();
    applyTrustProxy(app, DEFAULT_TRUST_PROXY);

    const setting = app.get('trust proxy');
    expect(Array.isArray(setting)).toBe(true);
    expect(setting).toEqual([DEFAULT_TRUST_PROXY]);
    // 反向断言：这三种写法都可被客户端伪造 XFF 绕过限流，一旦有人改回去必须红
    expect(setting).not.toBe(1);
    expect(setting).not.toBe(2);
    expect(setting).not.toBe(true);
    // express 会把 'trust proxy' 编译成 'trust proxy fn'
    expect(typeof app.get('trust proxy fn')).toBe('function');
  });

  it('默认值就是 prod nginx 内网 IP（唯一允许的直接上游）', () => {
    expect(DEFAULT_TRUST_PROXY).toBe('172.16.16.15');
    expect(buildTrustProxyList(DEFAULT_TRUST_PROXY)).toEqual(['172.16.16.15']);
  });

  it('多值配置按逗号切分并去空白', () => {
    expect(buildTrustProxyList('172.16.16.15, 10.0.0.1 ,10.0.0.2')).toEqual([
      '172.16.16.15',
      '10.0.0.1',
      '10.0.0.2',
    ]);
  });

  it('空配置 / 缺省 → 空数组（绝不退化成数字或布尔）', () => {
    expect(buildTrustProxyList('')).toEqual([]);
    expect(buildTrustProxyList(undefined)).toEqual([]);
    expect(buildTrustProxyList(null)).toEqual([]);
    for (const list of [buildTrustProxyList(''), buildTrustProxyList('x')]) {
      expect(Array.isArray(list)).toBe(true);
      expect(list.every((v) => typeof v === 'string')).toBe(true);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('2. 伪造 X-Forwarded-For 无效（生产形态地址链）', () => {
  const FORGED_XFF = '9.9.9.9, 8.8.8.8, 1.1.1.1'; // 客户端伪造 2 段 + nginx 追加的真实 IP

  it('白名单策略：req.ip 取 XFF 最右的真实值，伪造段被丢弃', () => {
    const app = express();
    applyTrustProxy(app, DEFAULT_TRUST_PROXY);
    expect(prodReqIp(app, FORGED_XFF)).toBe('1.1.1.1');
  });

  it('白名单策略：正常客户端取到的就是真实 IP', () => {
    const app = express();
    applyTrustProxy(app, DEFAULT_TRUST_PROXY);
    expect(prodReqIp(app, '1.1.1.1')).toBe('1.1.1.1');
  });

  it('白名单策略：nginx 没追加 XFF 时降级为 socket 对端（不会变 undefined）', () => {
    const app = express();
    applyTrustProxy(app, DEFAULT_TRUST_PROXY);
    expect(prodReqIp(app, undefined)).toBe(DEFAULT_TRUST_PROXY);
  });

  it('反向用例：trust=true 时同样的伪造链会把最左的伪造值交给 req.ip（所以不能用 true）', () => {
    const app = express();
    app.set('trust proxy', true);
    expect(prodReqIp(app, FORGED_XFF)).toBe('9.9.9.9');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('3. 直连网关时回落安全（真实 express + 真实 HTTP）', () => {
  it('无 XFF 头 → req.ip = 自己的 socket 地址（127.0.0.1）', async () => {
    await withRealServer(DEFAULT_TRUST_PROXY, async (get) => {
      expect(await get()).toBe('127.0.0.1');
    });
  });

  it('自带伪造 XFF → req.ip 仍是 socket 地址，伪造不生效', async () => {
    await withRealServer(DEFAULT_TRUST_PROXY, async (get) => {
      expect(await get({ 'x-forwarded-for': '9.9.9.9' })).toBe('127.0.0.1');
    });
  });

  it('反向用例：数字跳数在直连时会把客户端自带的 XFF 变成 req.ip（所以不能用 1）', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const ip = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/ip', headers: { 'x-forwarded-for': '9.9.9.9' } },
          (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => resolve(JSON.parse(b).ip));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(ip).toBe('9.9.9.9'); // ← 伪造成功 = 限流可被绕过，这正是必须用 IP 白名单的原因
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('4. 经 nginx 转发时取到真实客户端 IP（真实 HTTP，socket 对端可信）', () => {
  // 本地模拟：把 127.0.0.1 也放进白名单，顶替 nginx 在链中的位置
  const HOP_TRUST = `${DEFAULT_TRUST_PROXY}, 127.0.0.1`;

  it('XFF 含伪造段时，req.ip = 最右的真实值', async () => {
    await withRealServer(HOP_TRUST, async (get) => {
      expect(await get({ 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 1.1.1.1' })).toBe('1.1.1.1');
    });
  });

  it('正常转发的 XFF 原样取出', async () => {
    await withRealServer(HOP_TRUST, async (get) => {
      expect(await get({ 'x-forwarded-for': '1.1.1.1' })).toBe('1.1.1.1');
    });
  });

  it('反向用例：trust=true 时伪造段会胜出', async () => {
    const app = express();
    app.set('trust proxy', true);
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const ip = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { host: '127.0.0.1', port, path: '/ip', headers: { 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 1.1.1.1' } },
          (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => resolve(JSON.parse(b).ip));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(ip).toBe('9.9.9.9');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('5. 限流 tracker 兜底：永不为 undefined', () => {
  it('req.ip 正常时直接用它', () => {
    expect(resolveThrottleTracker({ ip: '1.1.1.1' })).toBe('1.1.1.1');
  });

  it('req.ip 缺失时回退到 socket.remoteAddress', () => {
    expect(resolveThrottleTracker({ ip: undefined, socket: { remoteAddress: '127.0.0.1' } })).toBe(
      '127.0.0.1',
    );
  });

  it('req.ip 与 socket 都缺失时回退到 unknown（仍是有效字符串）', () => {
    expect(resolveThrottleTracker({ ip: undefined, socket: undefined })).toBe('unknown');
    expect(resolveThrottleTracker({})).toBe('unknown');
  });

  it('任何输入都不会返回 undefined / 空串（否则限流 key 退化成同一个桶）', () => {
    const inputs: TrackerRequest[] = [
      {},
      { ip: '' },
      { ip: null },
      { ip: undefined },
      { ip: undefined, socket: {} },
      { ip: '1.1.1.1' },
    ];
    for (const input of inputs) {
      const tracker = resolveThrottleTracker(input);
      expect(typeof tracker).toBe('string');
      expect(tracker.length).toBeGreaterThan(0);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('6. 接线：main.ts / app.module.ts 真的用上了上面这两个函数', () => {
  const readSrc = (name: string) => readFileSync(join(__dirname, name), 'utf8');

  it('main.ts 用 applyTrustProxy 装白名单，且默认值取 DEFAULT_TRUST_PROXY', () => {
    const src = readSrc('main.ts');
    expect(src).toContain('applyTrustProxy(app, trustProxyRaw)');
    expect(src).toContain("configService.get<string>('TRUST_PROXY', DEFAULT_TRUST_PROXY)");
    // 不允许出现「直接塞数字跳数 / true」的自伤写法
    expect(src).not.toMatch(/trust proxy['"]?\s*,\s*(1|2|true)\b/);
  });

  it('app.module.ts 的限流器用上了 tracker 兜底', () => {
    const src = readSrc('app.module.ts');
    expect(src).toContain('getTracker: resolveThrottleTracker');
  });
});
