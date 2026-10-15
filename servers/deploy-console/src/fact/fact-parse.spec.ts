import {
  parseEntryCount,
  parseListeningPorts,
  parsePm2Processes,
  parsePointerCommit,
} from './fact-parse';

describe('事实采集 · 输出解析', () => {
  it('从 env 层入口指针取真实版本', () => {
    const js = `System.register(['./5ba74517/index.js'], function (_export) { return {}; });`;
    expect(parsePointerCommit(js)).toBe('5ba74517');
  });

  it('指针内容异常 → null（采不到 ≠ 一致，由上层判 missing）', () => {
    expect(parsePointerCommit('')).toBeNull();
    expect(parsePointerCommit('not a pointer')).toBeNull();
  });

  it('pm2 jlist 只取 5 个安全字段，绝不落进程环境变量', () => {
    const out = JSON.stringify([
      {
        name: 'gateway',
        pid: 123,
        pm2_env: {
          status: 'online',
          pm_cwd: '/data/web_system/servers/gateway',
          restart_time: 7,
          // 真实 pm2 jlist 里就是这些：进程启动时的全部环境变量
          MYSQL_PASSWORD: 'super-secret',
          env: { DB_PASSWORD: 'another-secret' },
        },
      },
    ]);
    const rows = parsePm2Processes(out);
    expect(rows).toEqual([
      {
        name: 'gateway',
        pid: 123,
        status: 'online',
        cwd: '/data/web_system/servers/gateway',
        restarts: 7,
      },
    ]);
    // 反向断言：任何形式的密钥都不该出现在解析结果里
    expect(JSON.stringify(rows)).not.toContain('super-secret');
    expect(JSON.stringify(rows)).not.toContain('another-secret');
  });

  it('pm2 输出非 JSON / 空 → 空数组（不抛错，交给上层记 error）', () => {
    expect(parsePm2Processes('')).toEqual([]);
    expect(parsePm2Processes('not json')).toEqual([]);
    expect(parsePm2Processes('{}')).toEqual([]);
  });

  it('ss -ltn 解析监听端口', () => {
    const out = [
      'State    Recv-Q   Send-Q     Local Address:Port',
      'LISTEN   0        128        0.0.0.0:6000      0.0.0.0:*',
      'LISTEN   0        128        127.0.0.1:6200    0.0.0.0:*',
    ].join('\n');
    expect(parseListeningPorts(out)).toEqual([6000, 6200]);
  });

  it('端口在行尾也能解析（只输出一列时不能判成「没监听」）', () => {
    expect(parseListeningPorts('LISTEN 0 128 0.0.0.0:6000')).toEqual([6000]);
    expect(parseListeningPorts('LISTEN 0 128 [::]:6200')).toEqual([6200]);
  });

  it('没有监听端口 → 空数组（不是 null，调用方据此判 missing）', () => {
    expect(parseListeningPorts('State    Recv-Q   Send-Q')).toEqual([]);
    expect(parseListeningPorts('')).toEqual([]);
  });

  it('ls | wc -l 解析条目数', () => {
    expect(parseEntryCount('12\n')).toBe(12);
    expect(parseEntryCount('0\n')).toBe(0);
    expect(parseEntryCount('')).toBeNull();
  });
});
