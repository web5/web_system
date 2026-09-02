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
