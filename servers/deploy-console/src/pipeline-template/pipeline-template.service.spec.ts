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

  it('非法/重复/缺核心均拒绝', () => {
    expect(() => normalizeSteps(['check', 'rollback'])).toThrow(BadRequestException);
    expect(() => normalizeSteps(['check', 'check', 'version', 'pointer'])).toThrow(
      BadRequestException,
    );
    expect(() => normalizeSteps(['pull', 'build', 'version', 'pointer'])).toThrow(
      BadRequestException,
    );
  });

  it('语义约束内允许重排（cleanup 可前移、upload/restart 互调）', () => {
    expect(
      normalizeSteps(['check', 'pull', 'build', 'restart', 'upload', 'version', 'pointer', 'verify', 'cleanup']),
    ).toEqual(['check', 'pull', 'build', 'restart', 'upload', 'version', 'pointer', 'verify', 'cleanup']);
    expect(
      normalizeSteps(['check', 'pull', 'build', 'upload', 'version', 'pointer', 'cleanup', 'verify']),
    ).toEqual(['check', 'pull', 'build', 'upload', 'version', 'pointer', 'cleanup', 'verify']);
  });

  it('语义硬约束违规拒绝：check 不首/version 晚于 pointer/verify 早于 pointer', () => {
    expect(() => normalizeSteps(['version', 'pointer', 'check'])).toThrow(BadRequestException);
    expect(() => normalizeSteps(['check', 'pull', 'pointer', 'version'])).toThrow(
      BadRequestException,
    );
    expect(() => normalizeSteps(['check', 'pull', 'build', 'upload', 'version', 'verify', 'pointer'])).toThrow(
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

  describe('v5 nodes（PIPELINE_V5_NODES 门禁）', () => {
    const v5nodes = () => [
      { kind: 'platform', key: 'git' },
      { kind: 'script', key: 'build', label: '构建' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
    ];

    const origFlag = process.env.PIPELINE_V5_NODES;
    afterEach(() => {
      if (origFlag === undefined) delete process.env.PIPELINE_V5_NODES;
      else process.env.PIPELINE_V5_NODES = origFlag;
    });

    it('flag=on：create 收 nodes 并归一落库', async () => {
      process.env.PIPELINE_V5_NODES = 'on';
      await service.create({ name: 'v5线', nodes: v5nodes() as any });
      const created = repo.create.mock.calls[0][0];
      expect(created.nodes.map((n: any) => n.key)).toEqual(['git', 'build', 'version', 'pointer']);
    });

    it('flag=off（缺省）：create 忽略 nodes（nodes=null，走 legacy）', async () => {
      delete process.env.PIPELINE_V5_NODES;
      await service.create({ name: 'legacy线', nodes: v5nodes() as any });
      const created = repo.create.mock.calls[0][0];
      expect(created.nodes).toBeNull();
    });

    it('flag=on 且 nodes 非法 → 400', async () => {
      process.env.PIPELINE_V5_NODES = 'on';
      const bad = [
        { kind: 'platform', key: 'git' },
        { kind: 'platform', key: 'version' }, // 缺 pointer
      ];
      await expect(service.create({ name: '坏线', nodes: bad as any })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('flag=on：update 落 nodes', async () => {
      repo.findOne.mockResolvedValue(globalDefault());
      process.env.PIPELINE_V5_NODES = 'on';
      const updated = await service.update('g-default', { nodes: v5nodes() as any });
      expect(updated.nodes!.length).toBe(4);
    });

    it('flag=off：update 忽略 nodes（保持原值 undefined）', async () => {
      repo.findOne.mockResolvedValue(globalDefault());
      delete process.env.PIPELINE_V5_NODES;
      const ignored = await service.update('g-default', { nodes: v5nodes() as any });
      expect(ignored.nodes).toBeUndefined(); // 未触碰，保持原值
    });

    it('duplicate 复制 nodes', async () => {
      repo.findOne
        .mockResolvedValueOnce({
          id: 'g-default',
          moduleKey: GLOBAL_TEMPLATE,
          name: '默认',
          steps: null,
          nodes: v5nodes(),
          skipVerify: false,
          rollbackOnFailure: 'previous',
          approval: 'inherit',
          defaultTarget: 'auto',
          enabled: true,
          builtin: true,
        })
        .mockResolvedValueOnce(null);
      const copy = await service.duplicate('g-default');
      expect(copy.nodes!.length).toBe(4);
    });

    it('v5 on：create 未传 nodes → 按 legacy steps 兜底转存（全量含 git/watchdog）', async () => {
      process.env.PIPELINE_V5_NODES = 'on';
      await service.create({ name: '转存线', rollbackOnFailure: 'previous' });
      const created = repo.create.mock.calls[0][0];
      expect(created.nodes![0].key).toBe('git');
      const keys = created.nodes!.map((n: any) => n.key);
      expect(keys).toContain('version');
      expect(keys.indexOf('version')).toBeLessThan(keys.indexOf('pointer'));
    });

    it('v5 on：旧模板（无 nodes）update 时自动转存为 nodes', async () => {
      repo.findOne.mockResolvedValue({
        id: 'legacy-1',
        moduleKey: GLOBAL_TEMPLATE,
        name: '旧线',
        steps: ['check', 'pull', 'build', 'version', 'pointer', 'verify'],
        skipVerify: false,
        rollbackOnFailure: 'previous',
        approval: 'inherit',
        defaultTarget: 'auto',
        enabled: true,
        builtin: false,
        nodes: null,
      });
      process.env.PIPELINE_V5_NODES = 'on';
      const updated = await service.update('legacy-1', { description: '改一下说明' });
      expect(updated.nodes).toBeTruthy();
      const verify = updated.nodes!.find((n: any) => n.key === 'verify') as any;
      expect(verify.watchdog).toBe(true); // rollback=previous → verify 带 watchdog
      expect(updated.nodes!.some((n: any) => n.key === 'upload')).toBe(false); // steps 已裁掉 upload
    });

    it('v5 off：旧模板 update 不产生 nodes（nodes 保持 null）', async () => {
      repo.findOne.mockResolvedValue({
        id: 'legacy-2',
        moduleKey: GLOBAL_TEMPLATE,
        name: '旧线2',
        steps: null,
        skipVerify: false,
        rollbackOnFailure: 'previous',
        approval: 'inherit',
        defaultTarget: 'auto',
        enabled: true,
        builtin: false,
        nodes: null,
      });
      delete process.env.PIPELINE_V5_NODES;
      const updated = await service.update('legacy-2', { description: 'v4 下只改说明' });
      expect(updated.nodes).toBeNull();
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
