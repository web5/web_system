import {
  endpointMatches,
  patternMatches,
  pickRoute,
  prefixMatches,
  resolveEnvId,
  resolveUpstream,
  rewritePath,
  type RouteRule,
} from './route-match';

/**
 * DB 路由匹配单测（P2 · V9「规则改动生效」与 V10「未登记接口按 unknownPolicy」的可用性基础）
 *
 * 这些是纯函数：网关运行时只做「查表 + 调这里」，故把它们锁死等于锁住路由语义本身。
 */
describe('dynamic-route 匹配语义', () => {
  const rule = (p: Partial<RouteRule> = {}): RouteRule => ({
    serviceKey: 'todo-service',
    envId: null,
    pathPrefix: '/api/todo',
    stripPrefix: null,
    rewriteTo: null,
    upstreamOverride: null,
    timeoutMs: 30000,
    authMode: 'passthrough',
    priority: 0,
    ...p,
  });

  describe('prefixMatches（前缀边界不能靠 startsWith）', () => {
    it('命中自身与子路径，不命中"同前缀不同资源"', () => {
      expect(prefixMatches('/api/todo', '/api/todo')).toBe(true);
      expect(prefixMatches('/api/todo/1', '/api/todo')).toBe(true);
      // 关键反例：/api/todos 与 /api/todo 是不同资源
      expect(prefixMatches('/api/todos', '/api/todo')).toBe(false);
      expect(prefixMatches('/api/todoother', '/api/todo')).toBe(false);
      // 尾斜杠写法等价
      expect(prefixMatches('/api/todo/1', '/api/todo/')).toBe(true);
    });
  });

  describe('pickRoute（优先级 → 环境具体性 → 前缀长度）', () => {
    it('优先级数值小者优先', () => {
      const chosen = pickRoute(
        [rule({ pathPrefix: '/api', priority: 20 }), rule({ pathPrefix: '/api/todo', priority: 5 })],
        '/api/todo/1',
        'dev',
      );
      expect(chosen?.pathPrefix).toBe('/api/todo');
    });

    it('同优先级取更长前缀（更具体者优先）', () => {
      const chosen = pickRoute(
        [rule({ pathPrefix: '/api', priority: 10 }), rule({ pathPrefix: '/api/todo', priority: 10 })],
        '/api/todo/1',
        'dev',
      );
      expect(chosen?.pathPrefix).toBe('/api/todo');
    });

    it('同优先级同前缀时，环境级规则优先于全环境默认', () => {
      const chosen = pickRoute(
        [
          rule({ pathPrefix: '/api/todo', envId: null, upstreamOverride: 'http://global:1' }),
          rule({ pathPrefix: '/api/todo', envId: '1', upstreamOverride: 'http://env1:2' }),
        ],
        '/api/todo',
        '1',
      );
      expect(chosen?.upstreamOverride).toBe('http://env1:2');
    });

    it('环境级规则不对其它环境生效', () => {
      const rules = [rule({ pathPrefix: '/api/todo', envId: '1' })];
      expect(pickRoute(rules, '/api/todo', 'dev')).toBeNull();
      expect(pickRoute(rules, '/api/todo', '1')).not.toBeNull();
    });

    it('未命中任何 DB 规则 → null（调用方回落硬编码，双轨零破坏）', () => {
      expect(pickRoute([rule()], '/api/unknown', 'dev')).toBeNull();
      expect(pickRoute([], '/api/todo', 'dev')).toBeNull();
    });
  });

  describe('rewritePath', () => {
    it('剥离 /api 后重写到 /api（mcp 场景）', () => {
      expect(rewritePath('/api/mcp/modules', { stripPrefix: '^/api/mcp', rewriteTo: '/api' })).toBe(
        '/api/modules',
      );
    });
    it('只剥离不重写 → 直接去掉前缀', () => {
      expect(rewritePath('/api/uploads/a.png', { stripPrefix: '^/api', rewriteTo: null })).toBe(
        '/uploads/a.png',
      );
    });
    it('无规则 → 原样返回；剥离后为空 → 回到 "/"', () => {
      expect(rewritePath('/api/todo', { stripPrefix: null, rewriteTo: null })).toBe('/api/todo');
      expect(rewritePath('/api', { stripPrefix: '^/api', rewriteTo: null })).toBe('/');
    });
    it('非法正则不抛错（配置错误不放大为 500）', () => {
      expect(rewritePath('/api/todo', { stripPrefix: '^/(', rewriteTo: null })).toBe('/api/todo');
    });
  });

  describe('resolveUpstream（没配就必须 fail-fast，不回落本机）', () => {
    /** 主机组名 → 可解析地址（Q17 方案 D：地址只在 deploy_hosts 维护） */
    const hosts = new Map([
      ['dev-default', '175.27.189.123'],
      ['prod-default', '106.52.176.246'],
    ]);

    it('显式覆盖 > 环境 upstreamUrl > 主机解析地址:端口', () => {
      expect(
        resolveUpstream({ upstreamOverride: 'http://override:1' }, { hostName: 'dev-default', port: 2 }, hosts),
      ).toBe('http://override:1');
      expect(
        resolveUpstream(
          { upstreamOverride: null },
          { upstreamUrl: 'http://u:9', hostName: 'dev-default', port: 2 },
          hosts,
        ),
      ).toBe('http://u:9');
      // 组名 → 真实地址（不得把组名当主机名拼成 http://dev-default:6010）
      expect(
        resolveUpstream({ upstreamOverride: null }, { hostName: 'dev-default', port: 6010 }, hosts),
      ).toBe('http://175.27.189.123:6010');
      expect(
        resolveUpstream({ upstreamOverride: null }, { hostName: 'prod-default', port: 3001 }, hosts),
      ).toBe('http://106.52.176.246:3001');
    });

    it('无覆盖且无指向 / 主机组未登记 / 缺端口 → null（不得回落 localhost —— B4）', () => {
      expect(resolveUpstream({ upstreamOverride: null }, null, hosts)).toBeNull();
      expect(resolveUpstream({ upstreamOverride: null }, { hostName: null, port: 6005 }, hosts)).toBeNull();
      // 主机组未在主机管理登记
      expect(
        resolveUpstream({ upstreamOverride: null }, { hostName: 'ghost-default', port: 6005 }, hosts),
      ).toBeNull();
      // Q19：端口不继承、不回落 80
      expect(
        resolveUpstream({ upstreamOverride: null }, { hostName: 'dev-default', port: null }, hosts),
      ).toBeNull();
    });
  });

  describe('resolveEnvId（请求头 > Host 站点默认 > dev 回退）', () => {
    const sites = [
      { host: 'dev.kedouai.com', defaultEnvId: 'dev' },
      { host: 'portal.kedouai.com', defaultEnvId: 'prod' },
    ];
    it('请求头优先（用户在页面切换了环境）', () => {
      expect(resolveEnvId('1', 'dev.kedouai.com', sites)).toBe('1');
    });
    it('无请求头 → 按 Host 匹配站点默认环境', () => {
      expect(resolveEnvId(undefined, 'portal.kedouai.com', sites)).toBe('prod');
      expect(resolveEnvId(undefined, 'portal.kedouai.com:6000', sites)).toBe('prod');
    });
    it('Host 未登记 → 回退 dev（Q1）', () => {
      expect(resolveEnvId(undefined, 'unknown.local', sites)).toBe('dev');
      expect(resolveEnvId(undefined, undefined, sites)).toBe('dev');
    });
  });

  describe('未登记接口判定（unknownPolicy=deny 的依据，V10）', () => {
    const eps = [
      { method: 'GET', pathPattern: '/api/todo' },
      { method: 'GET', pathPattern: '/api/todo/:id' },
      { method: 'POST', pathPattern: '/api/todo' },
      { method: 'ALL', pathPattern: '/api/todo/ping' },
    ];
    it('方法 + 路径都要匹配（含 :param 占位符）', () => {
      expect(endpointMatches('GET', '/api/todo', eps)).toBe(true);
      expect(endpointMatches('GET', '/api/todo/42', eps)).toBe(true);
      // 方法不匹配
      expect(endpointMatches('DELETE', '/api/todo', eps)).toBe(false);
      // 路径层级不匹配（:id 只吃一段）
      expect(endpointMatches('GET', '/api/todo/42/logs', eps)).toBe(false);
    });
    it('ALL 方法通配；方法大小写不敏感', () => {
      expect(endpointMatches('DELETE', '/api/todo/ping', eps)).toBe(true);
      expect(endpointMatches('get', '/api/todo', eps)).toBe(true);
    });
    it('patternMatches 转义正则元字符（路径里的 . 不是通配）', () => {
      expect(patternMatches('/api/v1.0/x', '/api/v1.0/x')).toBe(true);
      expect(patternMatches('/api/v1.0/x', '/api/v1x0/x')).toBe(false);
    });
  });
});
