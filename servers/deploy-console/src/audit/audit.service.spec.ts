import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogEntity } from '../entities/audit-log.entity';
import { AuditService, diffObject } from './audit.service';

describe('diffObject（字段级前后 diff）', () => {
  it('值相等的字段不输出', () => {
    expect(diffObject({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual([]);
  });

  it('值变化的字段输出 before/after', () => {
    const out = diffObject({ a: 1, b: 'x' }, { a: 2, b: 'x' });
    expect(out).toEqual([{ field: 'a', before: 1, after: 2 }]);
  });

  it('新增字段（before 缺失）也输出', () => {
    const out = diffObject({ a: 1 }, { a: 1, c: 'new' });
    expect(out).toEqual([{ field: 'c', before: undefined, after: 'new' }]);
  });

  it('删除字段（after 缺失）也输出', () => {
    const out = diffObject({ a: 1, c: 'gone' }, { a: 1 });
    expect(out).toEqual([{ field: 'c', before: 'gone', after: undefined }]);
  });

  it('对象/数组按整体比较（JSON 判等）', () => {
    expect(diffObject({ a: { x: 1 } }, { a: { x: 2 } }).length).toBe(1);
    expect(diffObject({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
    expect(diffObject({ a: [1, 2] }, { a: [1] })).toEqual([{ field: 'a', before: [1, 2], after: [1] }]);
  });

  it('空/缺省输入安全', () => {
    expect(diffObject(null, null)).toEqual([]);
    expect(diffObject(undefined, { a: 1 })).toEqual([{ field: 'a', before: undefined, after: 1 }]);
  });
});

describe('AuditService', () => {
  let service: AuditService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      save: jest.fn().mockResolvedValue({}),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLogEntity), useValue: repo },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  describe('log', () => {
    it('带 changes 时随详情一起落库', async () => {
      await service.log({
        user: 'alice',
        action: 'config.update',
        component: 'auth-service',
        status: 'success',
        detail: '改 key',
        changes: [{ field: 'value', before: 'v1', after: 'v2' }],
      });
      const saved = repo.save.mock.calls[0][0];
      expect(saved.changes).toEqual([{ field: 'value', before: 'v1', after: 'v2' }]);
    });

    it('空 changes 不写入（保持 null）', async () => {
      await service.log({ user: 'alice', action: 'x', status: 'ok', detail: '', changes: [] });
      expect(repo.save.mock.calls[0][0].changes).toBeNull();
    });

    it('落库失败不抛（审计尽力而为）', async () => {
      repo.save.mockRejectedValue(new Error('db down'));
      await expect(
        service.log({ user: 'alice', action: 'x', status: 'ok', detail: '' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('返回含 changes 的条目', async () => {
      const rows = [
        {
          id: 'u1',
          timestamp: new Date('2026-09-01T00:00:00Z'),
          user: 'alice',
          action: 'config.update',
          env: 'dev',
          component: 'auth-service',
          status: 'success',
          detail: 'x',
          changes: [{ field: 'value', before: 'a', after: 'b' }],
        },
      ];
      repo.findAndCount.mockResolvedValue([rows, 1]);
      const res = await service.list(1, 20);
      expect(res.data[0].changes).toEqual([{ field: 'value', before: 'a', after: 'b' }]);
      expect(res.total).toBe(1);
    });
  });
});
