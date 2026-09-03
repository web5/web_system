import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import {
  PipelineTemplateService,
  needsApprovalForTemplate,
  normalizeSteps,
  DEFAULT_TEMPLATE_NAME,
  GLOBAL_TEMPLATE,
} from './pipeline-template.service';

describe('normalizeSteps（活动阶段校验，纯函数）', () => {
  it('null/空 → null（= 全量九阶段）', () => {
    expect(normalizeSteps(undefined)).toBeNull();
    expect(normalizeSteps([])).toBeNull();
  });

  it('合法裁剪保留', () => {
    expect(
      normalizeSteps(['check', 'pull', 'build', 'upload', 'restart', 'version', 'pointer']),
    ).toEqual(['check', 'pull', 'build', 'upload', 'restart', 'version', 'pointer']);
  });

  it('非法/重复/重排/缺核心均拒绝', () => {
    expect(() => normalizeSteps(['check', 'rollback'])).toThrow(BadRequestException);
    expect(() => normalizeSteps(['check', 'check', 'version', 'pointer'])).toThrow(
      BadRequestException,
    );
    expect(() => normalizeSteps(['version', 'pointer', 'check'])).toThrow(BadRequestException);
    expect(() => normalizeSteps(['pull', 'build', 'version', 'pointer'])).toThrow(
      BadRequestException,
    );
  });
});

describe('needsApprovalForTemplate（审批判定，纯函数）', () => {
  it('always 强制；never 免除；inherit 沿用环境', () => {
    expect(needsApprovalForTemplate({ approval: 'always' }, false)).toBe(true);
    expect(needsApprovalForTemplate({ approval: 'never' }, true)).toBe(false);
    expect(needsApprovalForTemplate({ approval: 'inherit' }, true)).toBe(true);
    expect(needsApprovalForTemplate(null, false)).toBe(false);
  });
});

describe('PipelineTemplateService（全局化：流水线不跟模块走）', () => {
  let service: PipelineTemplateService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineTemplateService,
        { provide: getRepositoryToken(DeployPipelineTemplateEntity), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(PipelineTemplateService);
  });

  const globalDefault = () => ({
    id: 'g-default',
    moduleKey: GLOBAL_TEMPLATE,
    name: DEFAULT_TEMPLATE_NAME,
    builtin: true,
    enabled: true,
    skipVerify: false,
    approval: 'inherit',
    defaultTarget: 'auto',
  });

  describe('ensureDefault（全局默认模板）', () => {
    it('不存在时创建 moduleKey=* 的 builtin 默认', async () => {
      const tpl = await service.ensureDefault();
      expect(tpl.moduleKey).toBe(GLOBAL_TEMPLATE);
      expect(tpl.builtin).toBe(true);
    });

    it('已存在时直接返回（幂等）', async () => {
      repo.findOne.mockResolvedValue(globalDefault());
      const tpl = await service.ensureDefault();
      expect(tpl.id).toBe('g-default');
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('resolveForSubmit', () => {
    it('不传模板 → 全局默认', async () => {
      repo.findOne.mockResolvedValue(globalDefault());
      const tpl = await service.resolveForSubmit('auth-service');
      expect(tpl.moduleKey).toBe(GLOBAL_TEMPLATE);
    });

    it('显式全局模板可用于任意模块', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', moduleKey: GLOBAL_TEMPLATE, enabled: true, name: '通用' });
      await expect(service.resolveForSubmit('auth-service', 't1')).resolves.toBeTruthy();
    });

    it('模块专属模板只可用于该模块', async () => {
      repo.findOne.mockResolvedValue({ id: 't2', moduleKey: 'order-service', enabled: true });
      await expect(service.resolveForSubmit('auth-service', 't2')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('停用模板拒绝提交；不存在 404', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 't1', moduleKey: GLOBAL_TEMPLATE, enabled: false, name: 'x' });
      await expect(service.resolveForSubmit('auth-service', 't1')).rejects.toThrow(BadRequestException);
      repo.findOne.mockResolvedValue(null);
      await expect(service.resolveForSubmit('auth-service', 'nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create / duplicate / update / remove（全局资产）', () => {
    it('create 生成 moduleKey=* 的全局模板', async () => {
      const tpl = await service.create({ name: '正式线', approval: 'always', skipVerify: true });
      expect(tpl.moduleKey).toBe(GLOBAL_TEMPLATE);
      expect(tpl.approval).toBe('always');
      expect(tpl.skipVerify).toBe(true);
      expect(tpl.steps).not.toContain('verify');
    });

    it('同名全局模板冲突 409；非法枚举 400', async () => {
      repo.findOne.mockResolvedValue({ id: 't9', moduleKey: GLOBAL_TEMPLATE, name: '快线' });
      await expect(service.create({ name: '快线' })).rejects.toThrow(ConflictException);
      await expect(service.create({ name: 'x', approval: 'maybe' as any })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('duplicate 复制策略并标副本', async () => {
      repo.findOne
        .mockResolvedValueOnce({ id: 'g-default', moduleKey: GLOBAL_TEMPLATE, name: '默认', steps: null, skipVerify: false, rollbackOnFailure: 'previous', approval: 'inherit', defaultTarget: 'auto', enabled: true, builtin: true })
        .mockResolvedValueOnce(null);
      const copy = await service.duplicate('g-default');
      expect(copy.name).toContain('副本');
      expect(copy.builtin).toBe(false);
    });

    it('builtin 不可改名/删除；可调策略', async () => {
      repo.findOne.mockResolvedValue(globalDefault());
      await expect(service.update('g-default', { name: '改名' })).rejects.toThrow(BadRequestException);
      await expect(service.remove('g-default')).rejects.toThrow(BadRequestException);
      const updated = await service.update('g-default', { rollbackOnFailure: 'none', approval: 'never' });
      expect(updated.rollbackOnFailure).toBe('none');
    });

    it('自定义模板可删除', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', moduleKey: GLOBAL_TEMPLATE, builtin: false });
      await service.remove('t1');
      expect(repo.delete).toHaveBeenCalledWith('t1');
    });
  });

  describe('list', () => {
    it('listUsable 返回全局+模块专属', async () => {
      repo.findOne.mockResolvedValue(globalDefault());
      await service.listUsable('auth-service');
      expect(repo.find).toHaveBeenCalledWith({
        where: [{ moduleKey: GLOBAL_TEMPLATE }, { moduleKey: 'auth-service' }],
        order: { builtin: 'DESC', createdAt: 'ASC' },
      });
    });

    it('listUsable 在存在全局 builtin「默认」时，去掉模块专属同名 builtin 记录', async () => {
      repo.findOne.mockResolvedValue(globalDefault());
      const rows = [
        // 全局默认（保留）
        {
          id: 'g-default',
          moduleKey: GLOBAL_TEMPLATE,
          name: '默认',
          builtin: true,
          enabled: true,
          approval: 'inherit',
        },
        // 模块专属「默认」（被去掉）
        {
          id: 'm-default',
          moduleKey: 'auth-service',
          name: '默认',
          builtin: true,
          enabled: true,
          approval: 'inherit',
        },
        // 模块自定义模板（保留）
        {
          id: 'm-custom',
          moduleKey: 'auth-service',
          name: '快线',
          builtin: false,
          enabled: true,
          approval: 'never',
        },
      ];
      repo.find.mockResolvedValue(rows);
      const out = await service.listUsable('auth-service');
      const ids = out.map((r) => r.id);
      expect(ids).toEqual(['g-default', 'm-custom']);
      expect(ids).not.toContain('m-default');
    });
  });
});
