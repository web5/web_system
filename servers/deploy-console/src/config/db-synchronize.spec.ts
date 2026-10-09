import { resolveSynchronize, logSynchronizeDecision } from './db-synchronize';

/**
 * 诊断 #19：主库 synchronize 不该硬编码 true。
 *
 * 定夺逻辑必须可测 —— 这类「启动即 DDL」的开关，靠注释提醒没用，
 * 只有默认值和判据被测试锁住，将来把 console 部署到别处才不会静默写表。
 */
describe('resolveSynchronize（诊断 #19）', () => {
  const cfg = (map: Record<string, string | undefined>) => ({
    get: (k: string) => map[k],
  });

  it('本地库默认保持 true（不改变 dev 现状，避免一改就起不来）', () => {
    const d = resolveSynchronize(cfg({ MYSQL_HOST: '127.0.0.1' }), {});
    expect(d).toEqual({ enabled: true, reason: 'default-local' });
  });

  it('显式 DB_SYNCHRONIZE=false 无条件关闭（优先级最高）', () => {
    const d = resolveSynchronize(cfg({ MYSQL_HOST: '127.0.0.1', DB_SYNCHRONIZE: 'false' }), {});
    expect(d).toEqual({ enabled: false, reason: 'explicit-off' });
    expect(resolveSynchronize(cfg({ DB_SYNCHRONIZE: '0' }), {}).enabled).toBe(false);
    expect(resolveSynchronize(cfg({ DB_SYNCHRONIZE: 'no' }), {}).enabled).toBe(false);
  });

  it('NODE_ENV=production → 关闭（将来 console 真上生产也不会自动 DDL）', () => {
    const d = resolveSynchronize(cfg({ MYSQL_HOST: '127.0.0.1' }), { NODE_ENV: 'production' });
    expect(d).toEqual({ enabled: false, reason: 'production' });
  });

  /** 这条是真正的止血点：指向远端库时绝不自动建表 */
  it('连非回环地址（远端库）→ 关闭（即使是 dev 也禁止自动 DDL）', () => {
    for (const host of ['gz-cdb-xxx.sql.tencentcdb.com', '172.16.16.10', '10.0.0.5']) {
      expect(resolveSynchronize(cfg({ MYSQL_HOST: host }), {}).reason).toBe('remote-host');
      expect(resolveSynchronize(cfg({ MYSQL_HOST: host }), {}).enabled).toBe(false);
    }
    // localhost 各种写法都算本机
    expect(resolveSynchronize(cfg({ MYSQL_HOST: 'localhost' }), {}).enabled).toBe(true);
  });

  it('环境变量兜底：ConfigService 没配时读 process.env', () => {
    expect(resolveSynchronize(cfg({}), { DB_SYNCHRONIZE: 'false' }).enabled).toBe(false);
    expect(resolveSynchronize(cfg({}), { MYSQL_HOST: '1.2.3.4' }).enabled).toBe(false);
  });

  it('启动时把定夺结果打进日志 —— 开关状态不能靠读代码才知道', () => {
    const logger = require('@nestjs/common').Logger;
    const warn = jest.spyOn(logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = jest.spyOn(logger.prototype, 'log').mockImplementation(() => undefined);

    logSynchronizeDecision({ enabled: true, reason: 'default-local' }, '127.0.0.1', 'db');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('synchronize=true'));

    logSynchronizeDecision({ enabled: false, reason: 'remote-host' }, '1.2.3.4', 'db');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('synchronize=false'));

    warn.mockRestore();
    log.mockRestore();
  });
});
