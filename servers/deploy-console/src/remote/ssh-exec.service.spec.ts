import { BadGatewayException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * 假 ssh2：只保留 `execOn` 用到的那点面（ready → exec → stream 的 data/stderr/close）。
 * 目的不是测 ssh2，而是测**退出码语义** —— 监控要「非零也返回输出」，
 * 发布链路要「非零即失败」，两条语义必须各自成立且互不污染。
 *
 * 退出码走 globalThis（jest.mock 工厂会被提升到顶部，读不到外层 let）。
 */
const setExitCode = (code: number) => {
  (globalThis as unknown as { __mockExitCode?: number }).__mockExitCode = code;
};

jest.mock('ssh2', () => {
  const stream = {
    signal: () => undefined,
    close: () => undefined,
    stderr: { on: () => undefined },
    on: (ev: string, cb: (d: unknown) => void) => {
      if (ev === 'data') {
        setImmediate(() => cb(Buffer.from('pm2 说服务不存在')));
        return;
      }
      if (ev === 'close') {
        setImmediate(() =>
          cb((globalThis as unknown as { __mockExitCode?: number }).__mockExitCode ?? 0),
        );
      }
    },
  };
  class Client {
    on(ev: string, cb: (...a: unknown[]) => void) {
      if (ev === 'ready') setImmediate(() => cb());
      return this;
    }
    exec(_cmd: string, cb: (err: null, s: unknown) => void) {
      setImmediate(() => cb(null, stream));
      return this;
    }
    connect() {
      return this;
    }
    end() {
      return this;
    }
  }
  return { Client };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { SshExecService } from './ssh-exec.service';

/**
 * 远程命令执行通道（诊断 #15 的真相源）。
 *
 * 这里锁的是**判据**，不是实现：谁都能写一份 ssh2，难的是「私钥缺失必须显式报错」
 * 「超时/退出码语义一致」这些判据只有一处 —— 监控侧曾经各写一份，就是靠这里的用例兜住。
 */
describe('SshExecService（远程执行通道）', () => {
  let svc: SshExecService;

  beforeEach(() => {
    svc = new SshExecService({ get: () => undefined } as never, {} as never, {} as never);
  });

  describe('configForHost（按主机行构造配置）', () => {
    it('私钥存在 → 读出私钥内容，端口默认 22', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshkey-'));
      const key = path.join(dir, 'id_ed25519');
      fs.writeFileSync(key, 'KEY-CONTENT');

      const cfg = svc.configForHost({ name: 'dev-1', host: '1.2.3.4', sshUser: 'root', sshKeyPath: key });
      expect(cfg.host).toBe('1.2.3.4');
      expect(cfg.port).toBe(22);
      expect(cfg.username).toBe('root');
      expect(cfg.privateKey.toString()).toBe('KEY-CONTENT');
    });

    /** 这条是监控与发布侧共用的判据：私钥读不到必须炸，不能静默 undefined */
    it('私钥不存在 → 抛 BadGatewayException（不静默回落）', () => {
      expect(() =>
        svc.configForHost({
          name: 'dev-1',
          host: '1.2.3.4',
          sshUser: 'root',
          sshKeyPath: '/definitely/not/exist/id_x',
        }),
      ).toThrow(BadGatewayException);
    });

    it('sshKeyPath 为空 → 用默认路径；`~` 展开为 HOME', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
      fs.mkdirSync(path.join(dir, '.ssh'));
      fs.writeFileSync(path.join(dir, '.ssh', 'id_ed25519_servers'), 'DEFAULT-KEY');
      const home = process.env.HOME;
      process.env.HOME = dir;
      try {
        const cfg = svc.configForHost({ host: 'h', sshUser: 'u' });
        expect(cfg.privateKey.toString()).toBe('DEFAULT-KEY');
      } finally {
        process.env.HOME = home;
      }
    });
  });

  describe('execOn 的退出码语义（新增开关，别改坏既有行为）', () => {
    it('allowNonZeroExit：非零退出也返回输出（监控要把 pm2 的报错展示给人看）', async () => {
      setExitCode(1);
      await expect(
        svc.execOn(
          { host: 'h', port: 22, username: 'u', privateKey: Buffer.from('k') },
          'pm2 restart nope',
          't',
          1000,
          { allowNonZeroExit: true },
        ),
      ).resolves.toContain('pm2 说服务不存在');
    });

    it('默认严格：非零退出即失败（发布链路上「命令没跑成功」不能被当成成功）', async () => {
      setExitCode(1);
      await expect(
        svc.execOn({ host: 'h', port: 22, username: 'u', privateKey: Buffer.from('k') }, 'x', 't', 1000),
      ).rejects.toThrow(/退出码 1/);
    });
  });
});
