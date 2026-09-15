import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DeployPipelineVarEntity } from '../entities/deploy-pipeline-var.entity';
import { PipelineVarService, PIPELINE_VAR_MASK } from './pipeline-var.service';

/** 内存仓库：覆盖 service 用到的 findOne / find / create / save / delete */
function memRepo() {
  const rows: any[] = [];
  return {
    rows,
    findOne: jest.fn(async ({ where }: any) => {
      const keys = Object.keys(where ?? {});
      return (
        rows.find((r) => keys.every((k) => (r as any)[k] === (where as any)[k])) ?? null
      );
    }),
    find: jest.fn(async ({ where }: any = {}) => {
      const keys = Object.keys(where ?? {});
      return keys.length
        ? rows.filter((r) => keys.every((k) => (r as any)[k] === (where as any)[k]))
        : [...rows];
    }),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (row: any) => {
      const i = rows.findIndex((r) => r.id === row.id);
      if (i >= 0) rows[i] = row;
      else rows.push(row);
      return row;
    }),
    delete: jest.fn(async (id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
      return { affected: i >= 0 ? 1 : 0 };
    }),
  };
}

describe('PipelineVarService（流水线变量）', () => {
  let svc: PipelineVarService;
  let repo: ReturnType<typeof memRepo>;

  beforeEach(async () => {
    repo = memRepo();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineVarService,
        { provide: getRepositoryToken(DeployPipelineVarEntity), useValue: repo },
      ],
    }).compile();
    svc = mod.get(PipelineVarService);
  });

  it('V1 新增变量：属于某条流水线（pipelineId 隔离）', async () => {
    await svc.create('tpl-1', { key: 'PUBLISH_PATH', value: '/a' }, 'admin');
    await svc.create('tpl-2', { key: 'PUBLISH_PATH', value: '/b' }, 'admin');
    const l1 = await svc.list('tpl-1');
    const l2 = await svc.list('tpl-2');
    expect(l1).toHaveLength(1);
    expect(l1[0].value).toBe('/a');
    expect(l2[0].value).toBe('/b');
  });

  it('V2 同一流水线重名 → 拒绝', async () => {
    await svc.create('tpl-1', { key: 'BUILD_CMD', value: 'npm run build' }, 'admin');
    await expect(svc.create('tpl-1', { key: 'BUILD_CMD', value: 'x' }, 'admin')).rejects.toThrow(
      /已存在/,
    );
  });

  it('V3 键非法 → 拒绝（须匹配 ^[A-Za-z_][A-Za-z0-9_]{0,63}$）', async () => {
    await expect(svc.create('tpl-1', { key: 'bad key', value: 'x' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.create('tpl-1', { key: '9abc', value: 'x' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('V4 密钥：列表掩码，且值为空时不覆盖原值（防止把掩码写回）', async () => {
    const v = await svc.create('tpl-1', { key: 'SSH_KEY', value: 'real-secret', isSecret: true });
    expect((await svc.list('tpl-1'))[0].value).toBe(PIPELINE_VAR_MASK);
    await svc.update(v.id, { value: '' }, 'admin');
    expect((await svc.resolve('tpl-1')).SSH_KEY).toBe('real-secret');
    await svc.update(v.id, { value: 'new-secret' }, 'admin');
    expect((await svc.resolve('tpl-1')).SSH_KEY).toBe('new-secret');
  });

  it('V5 resolve：只注入启用的变量；无变量返回空对象', async () => {
    expect(await svc.resolve('tpl-x')).toEqual({});
    await svc.create('tpl-1', { key: 'A', value: '1' });
    const b = await svc.create('tpl-1', { key: 'B', value: '2', enabled: false });
    expect(await svc.resolve('tpl-1')).toEqual({ A: '1' });
    await svc.update(b.id, { enabled: true });
    expect(await svc.resolve('tpl-1')).toEqual({ A: '1', B: '2' });
    // 未传 pipelineId 不查库
    expect(await svc.resolve(null)).toEqual({});
  });

  it('V6 删除后不再出现在列表与 resolve 里', async () => {
    const v = await svc.create('tpl-1', { key: 'A', value: '1' });
    await svc.remove(v.id);
    expect(await svc.list('tpl-1')).toHaveLength(0);
    expect(await svc.resolve('tpl-1')).toEqual({});
  });
});
