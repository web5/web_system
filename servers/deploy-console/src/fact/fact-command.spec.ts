import {
  assertSafeFactCommand,
  isSafeFactCommand,
  cmdCountEntries,
  cmdListeningPorts,
  cmdPm2List,
  cmdReadFile,
  UnsafeFactCommandError,
} from './fact-command';

describe('事实采集命令 · 只读约束', () => {
  it('白名单内的只读命令放行', () => {
    expect(isSafeFactCommand('cat /data/x/index.js')).toBe(true);
    expect(isSafeFactCommand('ls -1 /data/x')).toBe(true);
    expect(isSafeFactCommand('pm2 jlist')).toBe(true);
    expect(isSafeFactCommand('ss -ltn')).toBe(true);
    expect(isSafeFactCommand('md5sum /data/x/.env.generated')).toBe(true);
  });

  it('分号 / 逻辑运算 / 命令替换 / 重定向一律拒绝', () => {
    for (const bad of [
      'cat /data/x; rm -rf /',
      'ls /data && rm x',
      'cat `whoami`',
      'cat $(whoami)',
      'cat /data/x > /tmp/y',
      'ls /data < /dev/null',
    ]) {
      expect(isSafeFactCommand(bad)).toBe(false);
    }
  });

  it('写 / 删 / 杀 / 外连类命令拒绝（按词边界，不误伤正常路径）', () => {
    for (const bad of ['rm -rf /data', 'mv a b', 'cp a b', 'kill 1234', 'curl http://x', 'ssh host', 'dd if=/dev/zero']) {
      expect(isSafeFactCommand(bad)).toBe(false);
    }
    // 反例：路径里的正常词不能被当成危险命令
    expect(isSafeFactCommand('cat /data/web_system/restarts/index.js')).toBe(true);
    expect(isSafeFactCommand('ls -1 /data/deploy/add')).toBe(true);
  });

  it('管道只允许 `| wc -l`', () => {
    expect(isSafeFactCommand('ls -1 /data/x | wc -l')).toBe(true);
    expect(isSafeFactCommand('ls -1 /data/x | grep y')).toBe(false);
    expect(isSafeFactCommand('ls -1 /data/x | wc -l | wc -l')).toBe(false);
  });

  it('不在白名单前缀内拒绝，且错误信息指路', () => {
    expect(isSafeFactCommand('tail -n 5 /data/x')).toBe(false);
    try {
      assertSafeFactCommand('tail -n 5 /data/x');
      throw new Error('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeFactCommandError);
      expect((e as UnsafeFactCommandError).message).toContain('不在只读白名单内');
    }
  });

  it('构造出来的命令自身必须是安全的（防止将来加采集项时绕过校验）', () => {
    for (const cmd of [
      cmdReadFile('/data/web_system/servers/gateway/public/static/modules/portal/dev/index.js'),
      cmdCountEntries('/data/x/5ba74517'),
      cmdPm2List(),
      cmdListeningPorts(),
    ]) {
      expect(() => assertSafeFactCommand(cmd)).not.toThrow();
    }
  });

  it('空命令拒绝', () => {
    expect(isSafeFactCommand('')).toBe(false);
    expect(isSafeFactCommand('   ')).toBe(false);
  });
});
