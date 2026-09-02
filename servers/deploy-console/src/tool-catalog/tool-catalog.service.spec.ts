import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeployToolEntity } from '../entities/deploy-tool-catalog.entity';
import { ToolCatalogService } from './tool-catalog.service';

describe('ToolCatalogService', () => {
  let service: ToolCatalogService;
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
        ToolCatalogService,
        { provide: getRepositoryToken(DeployToolEntity), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(ToolCatalogService);
  });

  it('create 由名称生成 shell 工具 code', async () => {
    const t = await service.create({ name: 'My Tool' });
    expect(t.code).toBe('my-tool');
    expect(t.kind).toBe('shell');
    expect(t.builtin).toBe(false);
  });

  it('code 冲突 409', async () => {
    repo.findOne.mockResolvedValue({ code: 'my-tool' });
    await expect(service.create({ name: 'my-tool' })).rejects.toThrow(ConflictException);
  });

  it('非法分类 400', async () => {
    await expect(service.create({ name: 'x', category: 'nope' })).rejects.toThrow(BadRequestException);
  });

  it('内置工具不可删除', async () => {
    repo.findOne.mockResolvedValue({ code: 'verify', builtin: true });
    await expect(service.remove('verify')).rejects.toThrow(BadRequestException);
  });

  it('自定义工具可删除', async () => {
    repo.findOne.mockResolvedValue({ code: 'my-tool', builtin: false });
    await service.remove('my-tool');
    expect(repo.delete).toHaveBeenCalledWith('my-tool');
  });

  it('不存在抛 404', async () => {
    await expect(service.get('nope')).rejects.toThrow(NotFoundException);
  });

  it('update 可停用', async () => {
    repo.findOne.mockResolvedValue({ code: 'curl', builtin: true });
    const t = await service.update('curl', { available: false });
    expect(t.available).toBe(false);
  });

  it('create 保存 shell 命令（语法合法）', async () => {
    const t = await service.create({ name: 'health-check', command: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT:-6200}/' });
    expect(t.command).toContain('curl');
    expect(t.kind).toBe('shell');
  });

  it('shell 命令语法错误拒绝 400', async () => {
    await expect(
      service.create({ name: 'bad-cmd', command: 'if then fi' }),
    ).rejects.toThrow(BadRequestException);
    repo.findOne.mockResolvedValue({ code: 'x', kind: 'shell', builtin: false });
    await expect(
      service.update('x', { command: 'while do done' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('update 命令置空即清除（清空不校验）', async () => {
    repo.findOne.mockResolvedValue({ code: 'x', kind: 'shell', builtin: false });
    const t = await service.update('x', { command: '' });
    expect(t.command).toBeUndefined();
  });
});
