import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeployModuleStageCommandEntity } from '../entities/deploy-module-stage-command.entity';
import { StageCommandService } from './stage-command.service';

describe('StageCommandService', () => {
  let service: StageCommandService;

  const repo = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        StageCommandService,
        { provide: getRepositoryToken(DeployModuleStageCommandEntity), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(StageCommandService);
  });

  describe('resolve', () => {
    it('未配置命令时返回 null', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.resolve('auth-service', 'build')).resolves.toBeNull();
    });

    it('命令为空白时返回 null（避免执行空命令）', async () => {
      repo.findOne.mockResolvedValue({ command: '   ' });
      await expect(service.resolve('auth-service', 'build')).resolves.toBeNull();
    });

    it('已启用命令返回命令与超时', async () => {
      repo.findOne.mockResolvedValue({ command: 'npx tsc -p tsconfig.json', timeoutSec: 600 });
      await expect(service.resolve('auth-service', 'build')).resolves.toEqual({
        command: 'npx tsc -p tsconfig.json',
        timeoutSec: 600,
      });
    });

    it('只查启用记录（enabled=true 作为过滤条件）', async () => {
      repo.findOne.mockResolvedValue(null);
      await service.resolve('auth-service', 'build');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { moduleKey: 'auth-service', stage: 'build', enabled: true },
      });
    });
  });

  describe('validate（bash -n 语法校验）', () => {
    it('合法 shell 通过', () => {
      expect(() => service.validate('echo hello && ls -la')).not.toThrow();
    });

    it('语法错误抛 BadRequestException', () => {
      expect(() => service.validate('if [ 1 -eq 1 ]; then')).toThrow(BadRequestException);
    });

    it('空命令抛 BadRequestException', () => {
      expect(() => service.validate('   ')).toThrow(BadRequestException);
    });
  });

  describe('template', () => {
    it('按模块类型返回默认构建命令', () => {
      expect(service.template('backend')).toBe('npx tsc -p tsconfig.json');
      expect(service.template('micro-frontend')).toBe('npx vite build --mode mf');
    });

    it('未知类型返回 null', () => {
      expect(service.template('unknown-type')).toBeNull();
    });
  });

  describe('resolveView（流水线脚本视图：合并已配置命令与流程内置说明）', () => {
    /**
     * 预期排序：九阶段齐全（按 CONFIGURABLE_STAGES 顺序），永不省略；
     * 一旦少一个，前端「流水线步骤」面板就会缺一条，发布流程不透明。
     */
    it('始终返回全部 9 阶段（仅 source 不同：configured/builtin/required-unset/semantic）', async () => {
      repo.find.mockResolvedValue([]); // 完全没配置
      const view = await service.resolveView('admin');
      expect(view).toHaveLength(9);
      const stages = view.map((v) => v.stage).sort();
      expect(stages).toEqual(
        ['build', 'check', 'cleanup', 'pointer', 'pull', 'restart', 'upload', 'verify', 'version'].sort(),
      );
    });

    it('build 未配置：source=required-unset（前端提示「必须配置」）', async () => {
      repo.find.mockResolvedValue([]);
      const view = await service.resolveView('admin');
      const build = view.find((v) => v.stage === 'build');
      expect(build?.source).toBe('required-unset');
      expect(build?.command).toBeNull();
      // required-unset 也提供 builtin 说明，让运维知道为啥没起来
      expect(build?.builtin).toContain('必填');
    });

    it('build 已配置：source=configured，回传原命令', async () => {
      repo.find.mockResolvedValue([
        {
          stage: 'build',
          command: 'npx vite build --mode mf',
          enabled: true,
          timeoutSec: 600,
          updatedAt: new Date('2026-09-01'),
          updatedBy: 'alice',
        },
      ] as any);
      const view = await service.resolveView('portal');
      const build = view.find((v) => v.stage === 'build');
      expect(build?.source).toBe('configured');
      expect(build?.command).toBe('npx vite build --mode mf');
      expect(build?.enabled).toBe(true);
      expect(build?.timeoutSec).toBe(600);
      expect(build?.updatedBy).toBe('alice');
    });

    it('version/pointer（semantic）始终不回传命令（发布语义真相源，不允许用户改）', async () => {
      repo.find.mockResolvedValue([]); // 即使没配置，也不会被改成 required-unset
      const view = await service.resolveView('admin');
      const version = view.find((v) => v.stage === 'version');
      const pointer = view.find((v) => v.stage === 'pointer');
      expect(version?.source).toBe('semantic');
      expect(version?.command).toBeNull();
      expect(version?.commandMode).toBe('none');
      expect(pointer?.source).toBe('semantic');
      expect(pointer?.commandMode).toBe('none');
    });

    it('override 类阶段（pull/upload/restart/verify/cleanup）未配置回 builtin 说明', async () => {
      repo.find.mockResolvedValue([]);
      const view = await service.resolveView('admin');
      const tags: Record<string, 'configured' | 'builtin'> = Object.fromEntries(
        view.map((v) => [v.stage, v.source === 'configured' ? 'configured' : 'builtin']),
      ) as any;
      // build 单独验证（required），剩下的非 semantic 都是 builtin
      expect(tags.pull).toBe('builtin');
      expect(tags.upload).toBe('builtin');
      expect(tags.restart).toBe('builtin');
      expect(tags.verify).toBe('builtin');
      expect(tags.cleanup).toBe('builtin');
      // 每条 builtin 都有说明文字，前端可以直接渲染
      const pull = view.find((v) => v.stage === 'pull')!;
      expect(pull.builtin).toContain('git fetch');
      expect(pull.builtin).toContain('workspace');
    });

    it('check 阶段 base 模式：内置+命令叠加（commandMode=base）', async () => {
      repo.find.mockResolvedValue([
        {
          stage: 'check',
          command: 'echo extra-check',
          enabled: true,
        } as any,
      ]);
      const view = await service.resolveView('admin');
      const check = view.find((v) => v.stage === 'check')!;
      expect(check.commandMode).toBe('base');
      expect(check.source).toBe('configured');
      expect(check.command).toBe('echo extra-check');
      // 同时给 builtin 说明，让运维知道这个命令会跟内置安全基线叠加跑
      expect(check.builtin).toContain('安全基线');
    });

    it('每条 view 都带中文 title（前端无需再做 key→label 映射）', async () => {
      repo.find.mockResolvedValue([]);
      const view = await service.resolveView('admin');
      for (const v of view) {
        expect(typeof v.title).toBe('string');
        expect(v.title.length).toBeGreaterThan(0);
      }
      // 抽样：build = 构建、verify = 探活
      expect(view.find((v) => v.stage === 'build')?.title).toBe('构建');
      expect(view.find((v) => v.stage === 'verify')?.title).toBe('探活');
    });
  });

  describe('upsert', () => {
    it('version/pointer 阶段不可配置（发布语义真相源）', async () => {
      await expect(service.upsert('auth-service', 'version', 'echo hi')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.upsert('auth-service', 'pointer', 'echo hi')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('空命令拒绝保存', async () => {
      await expect(service.upsert('auth-service', 'build', '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('不存在时新建并记录编辑人', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue({
        moduleKey: 'auth-service',
        stage: 'build',
        command: 'npx tsc',
        enabled: true,
      });
      repo.save.mockImplementation(async (row) => row);

      const row = await service.upsert('auth-service', 'build', 'npx tsc', 'alice');

      expect(repo.create).toHaveBeenCalled();
      expect(row.command).toBe('npx tsc');
      expect(row.updatedBy).toBe('alice');
    });

    it('已存在时更新命令并重新启用', async () => {
      const existing = { moduleKey: 'auth-service', stage: 'build', command: 'old', enabled: false };
      repo.findOne.mockResolvedValue(existing);
      repo.save.mockImplementation(async (row) => row);

      const row = await service.upsert('auth-service', 'build', 'new-cmd', 'bob', 120);

      expect(repo.create).not.toHaveBeenCalled();
      expect(row.command).toBe('new-cmd');
      expect(row.enabled).toBe(true);
      expect(row.timeoutSec).toBe(120);
    });
  });
});
