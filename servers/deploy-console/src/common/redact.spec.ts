import {
  MIN_SECRET_LEN,
  REDACTED,
  collectSecretValues,
  createRedactor,
  redactDeep,
  resetRedactor,
} from './redact';

describe('redact（诊断 #8 日志脱敏）', () => {
  const KEY = 'a1b2c3d4e5f6a7b8c9d0';

  it('进程内已知 env 值：整体替换（最可靠，无误伤）', () => {
    const r = createRedactor([KEY]);
    expect(r(`+ curl -H "x-internal-key: ${KEY}" http://x`)).toContain(REDACTED);
    expect(r(`+ curl -H "x-internal-key: ${KEY}" http://x`)).not.toContain(KEY);
  });

  it('值未知时按名称兜底：KEY=value / JSON / curl -H / Bearer', () => {
    const r = createRedactor([]);
    expect(r('CONSOLE_TOKEN=abc123def')).toBe(`CONSOLE_TOKEN=${REDACTED}`);
    expect(r('"password": "p@ssw0rd1"')).toBe(`"password": ${REDACTED}`);
    expect(r(`-H 'x-internal-key: zzz-zzz'`)).toBe(`-H 'x-internal-key: ${REDACTED}'`);
    expect(r('Authorization: Bearer eyJhbGciOiJIUzI1')).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it('URL userinfo 只替换密码，保留 host 便于排障', () => {
    const r = createRedactor([]);
    expect(r('mysql://root:s3cr3tpw@172.16.16.10:3306/db')).toBe(
      `mysql://root:${REDACTED}@172.16.16.10:3306/db`,
    );
  });

  it('脚本 set -x 的真实回显行：key 必须消失', () => {
    // 这是 #8 的原型场景：bash 把整条 curl（含头）回显到 stderr
    const line = `+ curl -s -X POST $CONSOLE_API/internal/release/pointer -H "x-internal-key: ${KEY}"`;
    const out = createRedactor([KEY])(line);
    expect(out).not.toContain(KEY);
    expect(out).toContain('/internal/release/pointer');
  });

  it('短值不脱敏，避免误伤 PORT=0 / KEEP_VERSIONS=5', () => {
    const r = createRedactor([]);
    expect(r('KEEP_VERSIONS=5')).toBe('KEEP_VERSIONS=5');
    expect(r('GATEWAY_TTL_SEC=10')).toBe('GATEWAY_TTL_SEC=10');
    expect(collectSecretValues({ INTERNAL_API_KEY: 'abc' }, [])).toEqual([]); // < MIN_SECRET_LEN
  });

  it('默认层级不脱敏 IP/端口（排障需要 127.0.0.1:6200）', () => {
    const r = createRedactor([KEY]);
    expect(r('curl http://127.0.0.1:6200/api/health')).toBe('curl http://127.0.0.1:6200/api/health');
  });

  it('redactSecretsAndAddress 才脱敏公网地址（云库错误消息用）', () => {
    // 通过默认脱敏器的地址分支验证：直接查导出函数的行为
    const { redactSecretsAndAddress } = require('./redact') as typeof import('./redact');
    resetRedactor();
    const out = redactSecretsAndAddress(
      'connect ECONNREFUSED gz-cdb-8y2lp8rt.sql.tencentcdb.com:27241 (106.52.176.246)',
    );
    expect(out).not.toContain('gz-cdb-8y2lp8rt.sql.tencentcdb.com');
    expect(out).not.toContain('106.52.176.246');
    expect(out.match(/<address>/g)?.length).toBe(2);
    resetRedactor();
  });

  it('长值优先匹配：短值是长值前缀时不会截断', () => {
    const long = 'abcdefghijklmnop';
    const r = createRedactor([long, long.slice(0, 8)]);
    expect(r(`TOKEN=${long}`)).toBe(`TOKEN=${REDACTED}`);
  });

  it('collectSecretValues 去重 + 忽略空值/短值', () => {
    const vals = collectSecretValues(
      { INTERNAL_API_KEY: KEY, CONSOLE_TOKEN: KEY, MYSQL_PASSWORD: '' },
      [KEY, 'x'],
    );
    expect(vals).toEqual([KEY]);
  });

  it('redactDeep 递归处理对象与数组，且不破坏非字符串', () => {
    const r = createRedactor([KEY]);
    // 用 redactDeep 走默认 redactor：先 reset 再注入不到，故这里直接验证结构行为
    resetRedactor();
    process.env.INTERNAL_API_KEY = KEY;
    const out = redactDeep({
      cmd: `curl -H "x-internal-key: ${KEY}"`,
      code: 90,
      ok: false,
      nested: { logs: [`token=${KEY}`] },
    });
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(out.code).toBe(90);
    expect(out.ok).toBe(false);
    delete process.env.INTERNAL_API_KEY;
    resetRedactor();
  });

  it('null / undefined / 空串安全', () => {
    const r = createRedactor([KEY]);
    expect(r('')).toBe('');
    expect(r(undefined as unknown as string)).toBeUndefined();
    expect(r(null as unknown as string)).toBeNull();
  });
});
