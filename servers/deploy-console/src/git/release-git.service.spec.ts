import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReleaseGitService } from './release-git.service';

describe('ReleaseGitService（发布目录 git 工具）', () => {
  let tmpWs: string;
  let cfg: { get: jest.Mock };
  let command: { exec: jest.Mock; pnpmBin: jest.Mock };
  let svc: ReleaseGitService;

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'release-ws-'));
    fs.mkdirSync(path.join(tmpWs, '.git'));
    command = {
      exec: jest.fn((cmd: string) =>
        cmd.includes('rev-parse --short HEAD') ? 'abc1234\n' : '',
      ),
      pnpmBin: jest.fn(() => 'pnpm'),
    };
    cfg = { get: jest.fn((k: string) => (k === 'RELEASE_WORKSPACE' ? tmpWs : undefined)) };
    svc = new ReleaseGitService(cfg as never, command as never);
  });

  afterEach(() => {
    fs.rmSync(tmpWs, { recursive: true, force: true });
  });

  it('ensureRepo：非 git 仓库时抛错并提示初始化', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
    try {
      cfg.get.mockImplementation((k: string) => (k === 'RELEASE_WORKSPACE' ? plain : undefined));
      expect(() => svc.ensureRepo()).toThrow(/git clone/);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('syncToBranch：fetch → checkout 目标分支 → reset commit → clean，返回实际 commit', () => {
    const commit = svc.syncToBranch('feature/x', 'abc1234');
    expect(commit).toBe('abc1234');
    const calls = command.exec.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('git fetch --all --prune');
    expect(calls[1]).toContain('git checkout -B feature/x origin/feature/x');
    expect(calls[2]).toBe('git reset --hard abc1234');
    expect(calls[3]).toBe('git clean -fd');
    expect(calls[4]).toContain('rev-parse --short HEAD');
  });

  it('syncToBranch：未指定 commit 时不做 reset', () => {
    svc.syncToBranch('master');
    const cmds = command.exec.mock.calls.map((c) => c[0] as string);
    expect(cmds.some((c) => c.includes('git reset'))).toBe(false);
  });

  it('syncDependencies：无 lock 文件 → unchanged', () => {
    expect(svc.syncDependencies()).toBe('unchanged');
    expect(command.exec).not.toHaveBeenCalled();
  });

  it('syncDependencies：lock 指纹变化才 install，并记录指纹（幂等）', () => {
    fs.writeFileSync(path.join(tmpWs, 'pnpm-lock.yaml'), 'lock-v1');
    expect(svc.syncDependencies()).toBe('installed');
    expect(command.exec).toHaveBeenCalledWith('"pnpm" install --prefer-offline', tmpWs);
    // 指纹未变 → 跳过
    command.exec.mockClear();
    expect(svc.syncDependencies()).toBe('unchanged');
    expect(command.exec).not.toHaveBeenCalled();
    // 指纹变化 → 再次 install
    fs.writeFileSync(path.join(tmpWs, 'pnpm-lock.yaml'), 'lock-v2');
    expect(svc.syncDependencies()).toBe('installed');
  });

  it('shortHead / branchName 委托 command.exec 并 trim', () => {
    command.exec.mockReturnValue(' abc1234 \n');
    expect(svc.shortHead()).toBe('abc1234');
  });
});
