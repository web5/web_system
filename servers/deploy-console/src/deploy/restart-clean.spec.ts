import {
  buildRestartCleanEnv,
  parseEnvPort,
  parsePm2Names,
  parsePm2Port,
  pickPm2Name,
  pm2NameCandidates,
  RESTART_CLEAN_TOOL,
} from './restart-clean';

describe('parseEnvPort', () => {
  it('取到 PORT', () => {
    expect(parseEnvPort('PORT=6200\nDB_HOST=127.0.0.1')).toBe('6200');
  });

  it('跳过注释行（#PORT=）', () => {
    expect(parseEnvPort('#PORT=9999\nPORT=6200')).toBe('6200');
  });

  it('等号周围有空格 / 值后有注释也能取到', () => {
    expect(parseEnvPort('PORT = 6200 # 控制台端口')).toBe('6200');
  });

  it('CRLF（Windows 换行）也能取到', () => {
    expect(parseEnvPort('A=1\r\nPORT=6200\r\n')).toBe('6200');
  });

  it('PORT 空值视为没有', () => {
    expect(parseEnvPort('PORT=')).toBeNull();
  });

  it('无 PORT / 空内容 → null', () => {
    expect(parseEnvPort('DB_HOST=127.0.0.1')).toBeNull();
    expect(parseEnvPort('')).toBeNull();
    expect(parseEnvPort(null)).toBeNull();
  });
});

describe('parsePm2Names / parsePm2Port', () => {
  const jlist = JSON.stringify([
    { name: 'ai-service', pid: 11, pm2_env: { PORT: '3003' } },
    { name: 'web-gateway', pid: 12, pm2_env: { env: { PORT: '6000' } } },
  ]);

  it('解析进程名', () => {
    expect(parsePm2Names(jlist)).toEqual(['ai-service', 'web-gateway']);
  });

  it('非法 JSON / 非数组 → 空数组（不抛错）', () => {
    expect(parsePm2Names('not json')).toEqual([]);
    expect(parsePm2Names('{"a":1}')).toEqual([]);
    expect(parsePm2Names(null)).toEqual([]);
  });

  it('按候选顺序取端口（pm2_env.PORT）', () => {
    expect(parsePm2Port(jlist, ['ai-service'])).toBe('3003');
  });

  it('端口在 pm2_env.env.PORT 时也能取到', () => {
    expect(parsePm2Port(jlist, ['web-gateway'])).toBe('6000');
  });

  it('候选全不在 → null', () => {
    expect(parsePm2Port(jlist, ['nope', 'nope2'])).toBeNull();
  });
});

describe('pm2NameCandidates / pickPm2Name', () => {
  it('-service 后缀会补出 base 名候选，且去重保序', () => {
    expect(pm2NameCandidates('ai-service')).toEqual([
      'web-ai-service',
      'web-ai',
      'ai-service',
      'ai',
    ]);
  });

  it('注册表给了 pm2 名时排在最前（去重）', () => {
    expect(pm2NameCandidates('ai-service', 'web-ai-service')).toEqual([
      'web-ai-service',
      'web-ai',
      'ai-service',
      'ai',
    ]);
  });

  it('非 -service 模块不产生 base 重复项', () => {
    expect(pm2NameCandidates('gateway')).toEqual(['web-gateway', 'gateway']);
  });

  it('命中第一个真实存在的进程名', () => {
    expect(pickPm2Name(['web-ai-service', 'ai-service'], ['ai-service'])).toBe('ai-service');
  });

  it('都不存在 → null', () => {
    expect(pickPm2Name(['web-ai-service'], ['gateway'])).toBeNull();
  });
});

describe('buildRestartCleanEnv', () => {
  const base = { moduleKey: 'ai-service', svcDir: '/data/web_system/servers/ai-service' };

  it('PORT 缺失 → null（调用方据此回落旧行为，不让部署失败）', () => {
    expect(buildRestartCleanEnv({ ...base, port: null })).toBeNull();
    expect(buildRestartCleanEnv({ ...base, port: '  ' })).toBeNull();
  });

  it('必填三件套：MODULE_KEY / SVC_DIR / PORT', () => {
    const env = buildRestartCleanEnv({ ...base, port: '3003' })!;
    expect(env.MODULE_KEY).toBe('ai-service');
    expect(env.SVC_DIR).toBe('/data/web_system/servers/ai-service');
    expect(env.PORT).toBe('3003');
  });

  it('不重复落地 dist（ROLLBACK=1 只允许失败回滚，VER_DIR 不给）', () => {
    const env = buildRestartCleanEnv({ ...base, port: '3003' })!;
    expect(env.VER_DIR).toBeUndefined();
    expect(env.ROLLBACK).toBe('1');
    expect(env.PM2_ALLOW_NEW).toBe('0');
    expect(env.DRY_RUN).toBe('0');
  });

  it('可选参数缺省时不写进环境（脚本用默认值）', () => {
    const env = buildRestartCleanEnv({ ...base, port: '3003' })!;
    expect(env.RELEASE_DIR).toBeUndefined();
    expect(env.PM2_NAME).toBeUndefined();
    expect(env.PM2_BIN).toBeUndefined();
    expect(env.HEALTH_TIMEOUT).toBeUndefined();
    expect(env.EXTRA_ENV).toBeUndefined();
  });

  it('给了可选参数就注入', () => {
    const env = buildRestartCleanEnv({
      ...base,
      port: '3003',
      pm2Name: 'ai-service',
      pm2Bin: '/usr/local/bin/pm2',
      releaseDir: '/data/web_system',
      healthTimeoutSec: 90,
      extraEnv: 'STATIC_ROOT=/data/static',
    })!;
    expect(env.PM2_NAME).toBe('ai-service');
    expect(env.PM2_BIN).toBe('/usr/local/bin/pm2');
    expect(env.RELEASE_DIR).toBe('/data/web_system');
    expect(env.HEALTH_TIMEOUT).toBe('90');
    expect(env.EXTRA_ENV).toBe('STATIC_ROOT=/data/static');
  });

  it('能力 code 常量钉住（改名会让两边对不上）', () => {
    expect(RESTART_CLEAN_TOOL).toBe('restart-clean');
  });
});
