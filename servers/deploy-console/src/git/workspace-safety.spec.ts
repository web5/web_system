import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertIsolatedBuildWorkspace, assertRunAfterWorkspaceCutover } from './workspace-safety';
import { PipelineService } from '../pipeline/pipeline.service';
import { ReleaseGitService } from './release-git.service';
import { CommandService } from '../shell/command.service';

describe('构建/运行路径隔离', () => {
  let root: string;
  let runtime: string;
  let build: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-safety-'));
    runtime = path.join(root, 'runtime');
    build = path.join(root, 'runtime-build');
    fs.mkdirSync(runtime);
    fs.mkdirSync(build);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('拒绝相同目录以及双向包含', () => {
    expect(() => assertIsolatedBuildWorkspace(runtime, [runtime])).toThrow(BadRequestException);
    expect(() => assertIsolatedBuildWorkspace(root, [runtime])).toThrow(BadRequestException);
    expect(() => assertIsolatedBuildWorkspace(path.join(runtime, 'build'), [runtime])).toThrow(BadRequestException);
  });

  it('允许仅名称前缀相同的独立目录', () => {
    expect(() => assertIsolatedBuildWorkspace(build, [runtime])).not.toThrow();
  });

  it('构建目录的软链不能绕过隔离', () => {
    const alias = path.join(root, 'build-link');
    fs.symlinkSync(runtime, alias);
    expect(() => assertIsolatedBuildWorkspace(alias, [runtime])).toThrow(BadRequestException);
    expect(() => assertIsolatedBuildWorkspace(path.join(alias, 'not-created'), [runtime])).toThrow(BadRequestException);
  });

  it('运行目录的软链也按真实路径比较', () => {
    const alias = path.join(root, 'runtime-link');
    fs.symlinkSync(build, alias);
    expect(() => assertIsolatedBuildWorkspace(build, [alias])).toThrow(BadRequestException);
  });

  it('允许尚未初始化但与运行目录无关的新构建路径', () => {
    expect(() => assertIsolatedBuildWorkspace(path.join(build, 'checkout'), [runtime])).not.toThrow();
  });

  it('真实 git 仓库中的未跟踪回退文件保持不变，拒绝实际拉码', () => {
    execFileSync('git', ['init', '--quiet', build]);
    const preserved = path.join(build, 'backup.txt');
    fs.writeFileSync(preserved, 'keep rollback material');
    const config = new ConfigService({ RELEASE_WORKSPACE: build, WEB_SYSTEM_DIR: runtime });
    const command = new CommandService(config);
    const execute = jest.spyOn(command, 'exec');
    const git = new ReleaseGitService(config, command);
    expect(() => git.syncToBranch('master')).toThrow(/未提交/);
    expect(fs.readFileSync(preserved, 'utf8')).toBe('keep rollback material');
    expect(execute.mock.calls).toHaveLength(1);
    expect(execute.mock.calls[0][0]).toBe('git status --porcelain --untracked-files=all');
  });

  it('真实运行仓库在任何 git 执行前被保护', () => {
    execFileSync('git', ['init', '--quiet', runtime]);
    const preserved = path.join(runtime, 'backup.txt');
    fs.writeFileSync(preserved, 'keep runtime');
    const config = new ConfigService({ RELEASE_WORKSPACE: runtime, WEB_SYSTEM_DIR: runtime });
    const command = new CommandService(config);
    const execute = jest.spyOn(command, 'exec');
    const git = new ReleaseGitService(config, command);
    expect(() => git.syncToBranch('master')).toThrow(/运行目录/);
    expect(execute).not.toHaveBeenCalled();
    expect(fs.readFileSync(preserved, 'utf8')).toBe('keep runtime');
  });

  it.each(['cwd', 'RELEASE_DIR'])('实际 shell 的 %s 指向运行目录时，任务变量也不能绕过安全门', async target => {
    fs.mkdirSync(path.join(build, '.git'));
    const config = new ConfigService({ RELEASE_WORKSPACE: build, WEB_SYSTEM_DIR: runtime });
    const command = { exec: jest.fn(() => ''), nodeBinDir: jest.fn(() => '/node/bin') };
    const git = new ReleaseGitService(config, command as never);
    const runner = { run: jest.fn() };
    const context = {
      configService: config, git, command, shellRunner: runner, releaseWorkspace: build,
    };
    const runShell = (PipelineService.prototype as unknown as {
      runShell: (statement: string, env: Record<string, string>, run: unknown, timeout?: number, cwd?: string) => Promise<number>;
    }).runShell;
    await expect(runShell.call(context, 'git clean -fd',
      { RELEASE_DIR: target === 'RELEASE_DIR' ? runtime : build }, { id: 'test-run' },
      undefined, target === 'cwd' ? runtime : build)).rejects.toThrow(/运行目录/);
    expect(runner.run).not.toHaveBeenCalled();
    expect(command.exec).not.toHaveBeenCalled();
  });

  it.each(['WEB_SYSTEM_DIR_DEV', 'WEB_SYSTEM_DIR_PROD', 'BACKEND_RUNTIME_ROOT_PROD', 'BACKEND_RUNTIME_ROOT_LOCAL'])('%s 在 Git 清理前受保护', key => {
    fs.mkdirSync(path.join(runtime, '.git'));
    const config = new ConfigService({ RELEASE_WORKSPACE: runtime, [key]: runtime });
    const command = { exec: jest.fn(() => '') };
    const git = new ReleaseGitService(config, command as never);
    expect(() => git.assertWorkspaceSafe()).toThrow(/运行目录/);
    expect(command.exec).not.toHaveBeenCalled();
  });

  it('dev 的依赖根配置不能遮蔽全局依赖根保护', () => {
    fs.mkdirSync(path.join(runtime, '.git'));
    const config = new ConfigService({ RELEASE_WORKSPACE: runtime, BACKEND_RUNTIME_ROOT: runtime, BACKEND_RUNTIME_ROOT_DEV: build });
    const command = { exec: jest.fn(() => '') };
    const git = new ReleaseGitService(config, command as never);
    expect(() => git.assertWorkspaceSafe()).toThrow(/运行目录/);
    expect(command.exec).not.toHaveBeenCalled();
  });

  it.each([
    ['WEB_SYSTEM_DIR_PROD', 'prod'],
    ['BACKEND_RUNTIME_ROOT_PROD', 'prod'],
    ['WEB_SYSTEM_DIR_QA', 'qa'],
    ['BACKEND_RUNTIME_ROOT_QA', 'qa'],
  ])('实际 shell 在 %s 内执行时先拒绝再调用 runner', async (key, environment) => {
    fs.mkdirSync(path.join(build, '.git'));
    const config = new ConfigService({ RELEASE_WORKSPACE: build, [key]: runtime });
    const command = { exec: jest.fn(() => ''), nodeBinDir: jest.fn(() => '/node/bin') };
    const git = new ReleaseGitService(config, command as never);
    const runner = { run: jest.fn().mockResolvedValue(0) };
    const context = { configService: config, git, command, shellRunner: runner, releaseWorkspace: build, shells: new Map() };
    const runShell = (PipelineService.prototype as any).runShell;
    await expect(runShell.call(context, 'git clean -fd', { RELEASE_DIR: build }, { id: 'preflight-run', env: environment }, undefined, runtime)).rejects.toThrow(/运行目录/);
    expect(runner.run).not.toHaveBeenCalled();
    expect(command.exec).not.toHaveBeenCalled();
  });
});

describe('PipelineService 提交前安全门', () => {
  it('即使模板可能内联 git 脚本，也在查询模板或创建 run 前拒绝不安全工作区', async () => {
    const failure = new BadRequestException('构建目录与运行目录重合');
    const context = {
      configService: { get: jest.fn() },
      git: { assertWorkspaceSafe: jest.fn(() => { throw failure; }) },
      pipelineRepo: { findOne: jest.fn(), save: jest.fn() },
      templates: { resolveForSubmit: jest.fn() },
    };
    await expect(PipelineService.prototype.submit.call(context as unknown as PipelineService,
      { env: 'dev', moduleKey: 'admin' }, 'test-owner')).rejects.toBe(failure);
    expect(context.git.assertWorkspaceSafe).toHaveBeenCalledTimes(1);
    expect(context.pipelineRepo.findOne).not.toHaveBeenCalled();
    expect(context.pipelineRepo.save).not.toHaveBeenCalled();
    expect(context.templates.resolveForSubmit).not.toHaveBeenCalled();
  });
});

describe('构建目录切换时间门禁', () => {
  it('未配置时保持既有任务兼容', () => {
    expect(() => assertRunAfterWorkspaceCutover(undefined, undefined)).not.toThrow();
  });

  it('旧任务被拒绝，新任务和边界时间可执行', () => {
    expect(() => assertRunAfterWorkspaceCutover(999, '1000')).toThrow(/重新提交/);
    expect(() => assertRunAfterWorkspaceCutover('1000', '1000')).not.toThrow();
    expect(() => assertRunAfterWorkspaceCutover(1001, '1000')).not.toThrow();
  });

  it.each(['bad', '0', '-1', '1000.5'])('非法切换时间 %s 不能静默放行', value => {
    expect(() => assertRunAfterWorkspaceCutover(Date.now(), value)).toThrow(/CUTOVER/);
  });

  it.each([undefined, null, 'bad'])('没有可信开始时间的历史任务不能恢复：%s', value => {
    expect(() => assertRunAfterWorkspaceCutover(value, '1000')).toThrow(/重新提交/);
  });

  it.each(['awaiting-approval', 'pending-approval'])('旧 %s 任务在改审批状态前返回 409', async status => {
    const run = { id: 'historical-run', status, startTime: 999, nodes: [], stage: 'gate' };
    const approval = { id: 'existing-approval', nodeKey: 'gate' };
    const context = {
      get: jest.fn(async () => run),
      configService: { get: jest.fn(() => '1000') },
      assertCanReview: jest.fn(async () => undefined),
      git: { assertWorkspaceSafe: jest.fn() },
      approvals: {
        pendingForPipeline: jest.fn(async () => approval),
        resolve: jest.fn(),
      },
      pipelineRepo: { save: jest.fn() },
    };
    const promise = PipelineService.prototype.approve.call(context as unknown as PipelineService, run.id, 'reviewer');
    await expect(promise).rejects.toHaveProperty('status', 409);
    expect(run.status).toBe(status);
    expect(context.approvals.resolve).not.toHaveBeenCalled();
    expect(context.pipelineRepo.save).not.toHaveBeenCalled();
    expect(context.git.assertWorkspaceSafe).not.toHaveBeenCalled();
  });
});
