import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import {
  PipelineTemplateService,
  needsApprovalForTemplate,
  normalizeSteps,
  DEFAULT_TEMPLATE_NAME,
} from './pipeline-template.service';

describe('normalizeSteps（活动阶段校验，纯函数）', () => {
  it('null/空 → null（= 全量九阶段）', () => {
    expect(normalizeSteps(undefined)).toBeNull();
    expect(normalizeSteps([])).toBeNull();
  });

  it('合法裁剪（剔除 verify/cleanup）保留并校验', () => {
    expect(normalizeSteps(['check', 'pull', 'build', 'upload', 'restart', 'version', 'pointer'])).toEqual([
      'check',
      'pull',
      'build',
      'upload',
      'restart',
      'version',
      'pointer',
    ]);
  });

  it('非法步骤拒绝', () => {
    expect(() => normalizeSteps(['check', 'rollback'])).toThrow(BadRequestException);
  });

  it('重复步骤拒绝', () => {
    expect(() => normalizeSteps(['check', 'check', 'version', 'pointer'])).toThrow(BadRequestException);
  });

  it('重排拒绝（仅可裁剪不可重排）', () => {
    expect(() => normalizeSteps(['version', 'pointer', 'check'])).toThrow(BadRequestException);
  });

  it('裁剪核心步骤（check/version/pointer）拒绝', () => {
    expect(() => normalizeSteps(['pull', 'build', 'version', 'pointer'])).toThrow(BadRequestException);
    expect(() => normalizeSteps(['check', 'pull', 'build'])).toThrow(BadRequestException);
  });
});

describe('needsApprovalForTemplate（审批判定，纯函数）', () => {
  it('always 强制审批（即使 dev 不需要）', () => {
    expect(needsApprovalForTemplate({ approval: 'always' }, false)).toBe(true);
  });
  it('never 免除审批（即使 prod）', () => {
    expect(needsApprovalForTemplate({ approval: 'never' }, true)).toBe(false);
  });
  it('inherit / 未设 沿用环境规则', () => {
    expect(needsApprovalForTemplate({ approval: 'inherit' }, true)).toBe(true);
    expect(needsApprovalForTemplate({ approval: 'inherit' }, false)).toBe(false);
    expect(needsApprovalForTemplate(null, true)).toBe(true);
    expect(needsApprovalForTemplate(undefined, false)).toBe(false);
  });
});

describe('PipelineTemplateService', () => {
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

  const builtin = (moduleKey: string) => ({
    id: 'default-1',
    moduleKey,
    name: DEFAULT_TEMPLATE_NAME,
    builtin: true,
    enabled: true,
    skipVerify: false,
    approval: 'inherit',
    defaultTarget: 'auto',
  });

  describe('ensureDefault（懒建默认模板）', () => {
    it('不存在时创建 builtin 默认', async () => {
      const tpl = await service.ensureDefault('auth-service');
      expect(tpl.moduleKey).toBe('auth-service');
      expect(tpl.builtin).toBe(true);
      expect(tpl.name).toBe(DEFAULT_TEMPLATE_NAME);
    });

    it('已存在时直接返回（幂等，不重复建）', async () => {
      repo.findOne.mockResolvedValue(builtin('auth-service'));
      const tpl = await service.ensureDefault('auth-service');
      expect(tpl.id).toBe('default-1');
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('并发首建撞唯一键时返回已建成的默认模板', async () => {
      repo.findOne
        .mockResolvedValueOnce(null) // 首查无
        .mockResolvedValueOnce(builtin('auth-service')); // save 冲突后重查命中
      repo.save.mockRejectedValue(new Error('Duplicate entry'));
      const tpl = await service.ensureDefault('auth-service');
      expect(tpl.id).toBe('default-1');
    });
  });

  describe('resolveForSubmit', () => {
    it('不传模板 → 模块默认模板', async () => {
      repo.findOne.mockResolvedValue(builtin('auth-service'));
      const tpl = await service.resolveForSubmit('auth-service');
      expect(tpl.builtin).toBe(true);
    });

    it('显式传模板校验归属', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', moduleKey: 'other-module', enabled: true });
      await expect(service.resolveForSubmit('auth-service', 't1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('停用模板拒绝提交', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', moduleKey: 'auth-service', enabled: false, name: 'x' });
      await expect(service.resolveForSubmit('auth-service', 't1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('模板不存在抛 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.resolveForSubmit('auth-service', 't1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create / duplicate / update / remove', () => {
    it('创建自定义模板（非 builtin，默认 inherit）', async () => {
      const tpl = await service.create('auth-service', { name: '快速验证线', skipVerify: true });
      expect(tpl.builtin).toBe(false);
      expect(tpl.approval).toBe('inherit');
      expect(tpl.skipVerify).toBe(true);
    });

    it('同模块同名模板冲突 409', async () => {
      repo.findOne.mockResolvedValue({ id: 't9', moduleKey: 'auth-service', name: '快线' });
      await expect(service.create('auth-service', { name: '快线' })).rejects.toThrow(ConflictException);
    });

    it('非法审批枚举 400', async () => {
      await expect(
        service.create('auth-service', { name: 'x', approval: 'maybe' as any }),
      ).rejects.toThrow(BadRequestException);
    });

    it('duplicate 复制全部策略并标副本', async () => {
      repo.findOne
        .mockResolvedValueOnce(builtin('auth-service')) // get(id)
        .mockResolvedValueOnce(null); // 名称检查：无同名冲突
      const copy = await service.duplicate('default-1');
      expect(copy.name).toContain('副本');
      expect(copy.builtin).toBe(false);
      expect(copy.skipVerify).toBe(false);
    });

    it('builtin 默认模板不可改名', async () => {
      repo.findOne.mockResolvedValue(builtin('auth-service'));
      await expect(
        service.update('default-1', { name: '改名' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('update 可调 skipVerify/审批策略（builtin 也可）', async () => {
      repo.findOne.mockResolvedValue(builtin('auth-service'));
      const updated = await service.update('default-1', { skipVerify: true, approval: 'always' });
      expect(updated.skipVerify).toBe(true);
      expect(updated.approval).toBe('always');
    });

    it('builtin 默认模板不可删除', async () => {
      repo.findOne.mockResolvedValue(builtin('auth-service'));
      await expect(service.remove('default-1')).rejects.toThrow(BadRequestException);
    });

    it('自定义模板可删除', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', moduleKey: 'auth-service', builtin: false });
      await service.remove('t1');
      expect(repo.delete).toHaveBeenCalledWith('t1');
    });
  });
});
