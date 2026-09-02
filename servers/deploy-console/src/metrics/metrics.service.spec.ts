import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';
import {
  MetricsService,
  calcSuccessRate,
  calcAvg,
  calcPercentile,
} from './metrics.service';

describe('度量计算（纯函数）', () => {
  describe('calcSuccessRate', () => {
    it('全部成功为 1', () => {
      expect(calcSuccessRate(5, 0)).toBe(1);
    });

    it('全部失败为 0', () => {
      expect(calcSuccessRate(0, 5)).toBe(0);
    });

    it('按比例计算', () => {
      expect(calcSuccessRate(1, 3)).toBeCloseTo(0.25);
    });

    it('无终态记录时返回 null（避免把"还没跑完"误读成"全失败"）', () => {
      expect(calcSuccessRate(0, 0)).toBeNull();
    });
  });

  describe('calcAvg', () => {
    it('空数组返回 null', () => {
      expect(calcAvg([])).toBeNull();
    });

    it('计算平均值', () => {
      expect(calcAvg([2, 4, 6])).toBe(4);
    });
  });

  describe('calcPercentile', () => {
    it('空数组返回 null', () => {
      expect(calcPercentile([], 95)).toBeNull();
    });

    it('单值返回自身', () => {
      expect(calcPercentile([7], 95)).toBe(7);
    });

    it('P50 为中位数', () => {
      expect(calcPercentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it('非整数位时线性插值', () => {
      // 4 个值，P95 rank = 0.95 * 3 = 2.85 → 介于 3 与 4 之间
      expect(calcPercentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85);
    });

    it('不修改入参顺序', () => {
      const input = [5, 1, 3];
      calcPercentile(input, 95);
      expect(input).toEqual([5, 1, 3]);
    });
  });
});

describe('MetricsService（聚合查询）', () => {
  let service: MetricsService;
  let repo: { query: jest.Mock };

  const countRow = (over: Partial<Record<string, number>> = {}) => [
    {
      total: 0,
      succeeded: 0,
      failed: 0,
      running: 0,
      cancelled: 0,
      ...over,
    },
  ];

  beforeEach(async () => {
    repo = { query: jest.fn() };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: getRepositoryToken(DeployPipelineEntity), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(MetricsService);
  });

  describe('overview', () => {
    it('汇总各状态数量并算出成功率与时长', async () => {
      repo.query
        .mockResolvedValueOnce(countRow({ total: 10, succeeded: 7, failed: 3 }))
        .mockResolvedValueOnce([{ d: '10' }, { d: '20' }, { d: '30' }]);

      const r = await service.overview();

      expect(r.total).toBe(10);
      expect(r.succeeded).toBe(7);
      expect(r.failed).toBe(3);
      expect(r.successRate).toBeCloseTo(0.7);
      expect(r.avgDurationSec).toBe(20);
    });

    it('无成功发布时时长为 null（不返回 0 误导）', async () => {
      repo.query
        .mockResolvedValueOnce(countRow({ total: 3, succeeded: 0, failed: 3 }))
        .mockResolvedValueOnce([]);

      const r = await service.overview();
      expect(r.successRate).toBe(0);
      expect(r.avgDurationSec).toBeNull();
      expect(r.p95DurationSec).toBeNull();
    });

    it('过滤条件以参数化方式传入（防 SQL 注入）', async () => {
      repo.query
        .mockResolvedValueOnce(countRow({ total: 1, succeeded: 1 }))
        .mockResolvedValueOnce([{ d: '5' }]);

      await service.overview({ env: 'dev', moduleKey: 'auth-service', from: 100, to: 200 });

      const [sql, params] = repo.query.mock.calls[0];
      expect(sql).toContain('env = ?');
      expect(sql).toContain('module_key = ?');
      expect(params).toEqual(['dev', 'auth-service', 100, 200]);
    });

    it('无过滤条件时不带 WHERE', async () => {
      repo.query.mockResolvedValueOnce(countRow()).mockResolvedValueOnce([]);
      await service.overview();
      const [sql] = repo.query.mock.calls[0];
      expect(sql).not.toContain('WHERE');
    });
  });

  describe('stageFailures', () => {
    it('按失败数量降序返回', async () => {
      repo.query.mockResolvedValueOnce([
        { stage: 'build', count: '48' },
        { stage: 'restart', count: '7' },
      ]);
      await expect(service.stageFailures()).resolves.toEqual([
        { stage: 'build', count: 48 },
        { stage: 'restart', count: 7 },
      ]);
    });
  });

  describe('failures（下钻）', () => {
    it('默认只查失败记录', async () => {
      repo.query.mockResolvedValueOnce([]);
      await service.failures();
      const [sql, params] = repo.query.mock.calls[0];
      expect(sql).toContain('status = ?');
      expect(params[0]).toBe('failed');
    });

    it('支持按阶段下钻', async () => {
      repo.query.mockResolvedValueOnce([]);
      await service.failures({ stage: 'build' });
      const [sql, params] = repo.query.mock.calls[0];
      expect(sql).toContain('stage = ?');
      expect(params).toContain('build');
    });

    it('映射字段为驼峰并保留错误信息', async () => {
      repo.query.mockResolvedValueOnce([
        {
          id: 'p1',
          moduleKey: 'auth-service',
          env: 'dev',
          versionTag: 'abc123',
          stage: 'build',
          error: '模块未配置 build 命令',
          startTime: '1700000000000',
          endTime: null,
          operator: 'alice',
        },
      ]);
      const rows = await service.failures({ stage: 'build' });
      expect(rows[0]).toEqual({
        id: 'p1',
        moduleKey: 'auth-service',
        env: 'dev',
        versionTag: 'abc123',
        stage: 'build',
        error: '模块未配置 build 命令',
        startTime: 1700000000000,
        endTime: null,
        operator: 'alice',
      });
    });
  });

  describe('trend / topModules', () => {
    it('趋势按日期升序', async () => {
      repo.query.mockResolvedValueOnce([
        { date: '2026-09-01', succeeded: '3', failed: '1' },
        { date: '2026-09-02', succeeded: '5', failed: '0' },
      ]);
      await expect(service.trend()).resolves.toEqual([
        { date: '2026-09-01', succeeded: 3, failed: 1 },
        { date: '2026-09-02', succeeded: 5, failed: 0 },
      ]);
    });

    it('限制 limit 上限，避免异常入参拼进 SQL', async () => {
      repo.query.mockResolvedValueOnce([]);
      await service.topModules({}, 9999);
      const [sql] = repo.query.mock.calls[0];
      expect(sql).toContain('LIMIT 100');
    });
  });
});
