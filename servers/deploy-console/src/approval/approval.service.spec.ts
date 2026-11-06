import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService, REQUIRE_APPROVAL_ENVS_KEY } from './approval.service';

describe('ApprovalService', () => {
  let service: ApprovalService;
  let repo: any;
  let settings: { get: jest.Mock };
  let audit: { log: jest.Mock };
  /** CAS 更新链：update().set().where().execute() */
  let updateChain: { execute: jest.Mock };

  beforeEach(async () => {
    updateChain = { execute: jest.fn().mockResolvedValue({ affected: 1 }) };
    const qb: any = {
      update: jest.fn(() => qb),
      set: jest.fn(() => qb),
      where: jest.fn(() => qb),
      execute: updateChain.execute,
    };
    repo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x })),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => qb),
    };
    settings = { get: jest.fn().mockResolvedValue(null) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: getRepositoryToken(DeployApprovalEntity), useValue: repo },
        { provide: SystemSettingsService, useValue: settings },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(ApprovalService);
  });

  describe('needsApproval（哪些环境要审批）', () => {
    it('未配置时默认只有 prod 需要审批', async () => {
      await expect(service.needsApproval('prod')).resolves.toBe(true);
      await expect(service.needsApproval('dev')).resolves.toBe(false);
      await expect(service.needsApproval('local')).resolves.toBe(false);
    });

    it('系统设置可放宽/收紧（如要求 staging 也审批）', async () => {
      settings.get.mockResolvedValue('prod, staging');
      await expect(service.needsApproval('staging')).resolves.toBe(true);
      await expect(service.needsApproval('dev')).resolves.toBe(false);
    });

    it('配置里清空值（全空格）时回落到默认 prod', async () => {
      settings.get.mockResolvedValue('   ,  ');
      await expect(service.needsApproval('prod')).resolves.toBe(true);
    });
  });

  describe('create', () => {
    const spec = {
      pipelineId: 'p1',
      env: 'prod',
      moduleKey: 'auth-service',
      mode: 'direct',
      operator: 'alice',
    };

    it('创建 pending 单并带提交人快照', async () => {
      const row = await service.create(spec);
      expect(row.status).toBe('pending');
      expect(row.pipelineId).toBe('p1');
      expect(row.operator).toBe('alice');
      expect(row.createdAt).toBeDefined();
    });

    it('同一 env+moduleKey 已有待审批单时拒绝重复提交', async () => {
      repo.findOne.mockResolvedValue({ pipelineId: 'p0', status: 'pending' });
      await expect(service.create(spec)).rejects.toThrow(ConflictException);
    });
  });

  describe('resolve（approve/reject）', () => {
    it('通过：置 approved 并记录审批人与意见', async () => {
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'pending' });
      const row = await service.resolve('a1', 'approve', 'bob', ' 可以发 ');
      expect(row.status).toBe('approved');
      expect(row.reviewer).toBe('bob');
      expect(row.comment).toBe('可以发');
      expect(row.reviewedAt).toBeDefined();
    });

    it('拒绝：置 rejected 并记录意见', async () => {
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'pending' });
      const row = await service.resolve('a1', 'reject', 'bob', 'dev 还没验证');
      expect(row.status).toBe('rejected');
      expect(row.comment).toBe('dev 还没验证');
    });

    it('已处理过的单不可二次审批（幂等保护）', async () => {
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'approved' });
      await expect(service.resolve('a1', 'approve', 'bob')).rejects.toThrow(ConflictException);
    });

    it('单据不存在时抛 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.resolve('nope', 'approve', 'bob')).rejects.toThrow(NotFoundException);
    });
  });

  describe('byPipelineId / list', () => {
    it('按流水线取审批单', async () => {
      await service.byPipelineId('p1');
      expect(repo.findOne).toHaveBeenCalledWith({ where: { pipelineId: 'p1' } });
    });

    it('list 按创建时间倒序、默认 200 上限', async () => {
      await service.list();
      const [opts] = repo.find.mock.calls[0];
      expect(opts.order.createdAt).toBe('DESC');
      expect(opts.take).toBe(200);
    });

    it('list 支持按状态过滤', async () => {
      await service.list('pending');
      const [opts] = repo.find.mock.calls[0];
      expect(opts.where).toEqual({ status: 'pending' });
    });
  });

  describe('cancel（作废孤儿单）', () => {
    it('pending → cancelled：CAS 条件带 status=pending，原因与操作者落库', async () => {
      repo.findOne.mockResolvedValue({
        id: 'o1',
        status: 'cancelled',
        env: 'prod',
        pipelineId: 'p-orphan',
      });

      await expect(
        service.cancel('o1', '挂起实例已随重启丢失', 'orphan-cleanup'),
      ).resolves.toMatchObject({ status: 'cancelled' });

      const qb = repo.createQueryBuilder.mock.results[0].value;
      // 🔴 CAS 断言的落点：where 必须同时锁 id 与 pending，少一半就等于允许覆盖已审批单
      expect(qb.where).toHaveBeenCalledWith(
        'id = :id AND status = :pending',
        { id: 'o1', pending: 'pending' },
      );
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'cancelled',
          reviewer: 'orphan-cleanup',
          comment: '挂起实例已随重启丢失',
        }),
      );
    });

    it('作废必须写原因：空/纯空白 → 400，且不碰数据库', async () => {
      await expect(service.cancel('o1', '   ', 'bob')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.cancel('o1', '', 'bob')).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('作废必须记录操作者：空操作者 → 400', async () => {
      await expect(service.cancel('o1', '原因', '  ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('单据不存在 → 404', async () => {
      updateChain.execute.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue(null);
      await expect(service.cancel('nope', '原因', 'bob')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('单已 approved → 409，绝不覆盖真实审批留痕', async () => {
      updateChain.execute.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'approved' });
      await expect(service.cancel('a1', '原因', 'bob')).rejects.toThrow(
        /只有 pending 可作废/,
      );
    });

    it('审计写入失败不影响作废结果（状态已变是既成事实）', async () => {
      repo.findOne.mockResolvedValue({
        id: 'o2',
        status: 'cancelled',
        env: 'prod',
      });
      audit.log.mockRejectedValue(new Error('audit down'));

      await expect(
        service.cancel('o2', '实例丢失', 'orphan-cleanup'),
      ).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('作废写审计，带原因与流水线 id', async () => {
      repo.findOne.mockResolvedValue({
        id: 'o3',
        status: 'cancelled',
        env: 'prod',
        pipelineId: 'p-3',
      });
      await service.cancel('o3', '实例丢失', 'orphan-cleanup');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          user: 'orphan-cleanup',
          action: 'approval.cancel',
          env: 'prod',
          detail: expect.stringContaining('实例丢失'),
        }),
      );
      expect(audit.log.mock.calls[0][0].detail).toContain('p-3');
    });
  });
});
