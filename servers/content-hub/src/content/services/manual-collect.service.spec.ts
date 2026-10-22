/**
 * ManualCollectService 单测（p40）。
 *
 * 覆盖三类最关键语义：
 *   1. run()  落库路径：采集 → persist → collect_runs 日志（成功/空/失败三态）
 *   2. test() 试采路径：**任何情况都不碰 persist / collectLog**（不污染真实记录）
 *   3. hasCollector 分派判据
 *
 * 采集器经第三构造参注入假实现，测试不碰网络。
 */
import { ManualCollectService } from './manual-collect.service';
import { CollectLogService } from './collect-log.service';
import { ContentItemPersistService } from './content-item-persist.service';
import { ContentSourceEntity } from '../entities/content-source.entity';
import { ICollector, RawItem } from '../collectors/collector.interface';
import { COLLECT_TRIGGER } from '../quality/quality.enum';

/** 假采集器：collect 行为可配置 */
class FakeCollector implements ICollector {
  readonly code: string;
  constructor(
    code: string,
    private readonly behavior: () => Promise<RawItem[]>,
  ) {
    this.code = code;
  }
  collect(): Promise<RawItem[]> {
    return this.behavior();
  }
}

const rawItem = (id: string, title = `标题-${id}`): RawItem => ({
  external_id: id,
  title,
  content: `正文-${id}`,
  url: `https://example.com/${id}`,
  source_name: '假源',
});

const makeSource = (over: Partial<ContentSourceEntity> = {}): ContentSourceEntity =>
  ({
    id: 1,
    code: 'arxiv',
    name: 'arXiv 论文',
    type: 'arxiv',
    config: { categories: 'cs.AI' },
    enabled: true,
    ...over,
  }) as ContentSourceEntity;

describe('ManualCollectService', () => {
  let collectLog: { logSuccess: jest.Mock; logFailure: jest.Mock };
  let persist: { persistItems: jest.Mock };
  let service: ManualCollectService;

  /** 建一个注入了假采集器的 service；collectors 为空时走默认注册表 */
  const build = (collectors?: Record<string, ICollector>) => {
    collectLog = { logSuccess: jest.fn(), logFailure: jest.fn() };
    persist = {
      persistItems: jest.fn().mockResolvedValue({ written: 2, skipped: 1, failed: 0 }),
    };
    service = new ManualCollectService(
      collectLog as unknown as CollectLogService,
      persist as unknown as ContentItemPersistService,
      collectors,
    );
  };

  describe('run() 手动触发（落库路径）', () => {
    it('采集成功：落库 + 记成功日志 + 返回计数', async () => {
      build({
        arxiv: new FakeCollector('arxiv', async () => [rawItem('1'), rawItem('2'), rawItem('3')]),
      });
      const out = await service.run(makeSource(), { trigger: COLLECT_TRIGGER.MANUAL, limit: 20 });

      expect(out.status).toBe('ok');
      expect(out.item_count).toBe(3);
      expect(out.inserted).toBe(2);
      expect(out.deduped).toBe(1);
      // 手动触发不归固定管线，但要带 source_id（明细按源筛选）
      expect(persist.persistItems).toHaveBeenCalledWith(expect.any(Array), {
        pipelineId: null,
        sourceId: 1,
      });
      expect(collectLog.logSuccess).toHaveBeenCalledTimes(1);
      expect(collectLog.logFailure).not.toHaveBeenCalled();
    });

    it('上游返回空：不落库 + 记失败日志 + status=empty', async () => {
      build({ arxiv: new FakeCollector('arxiv', async () => []) });
      const out = await service.run(makeSource());

      expect(out.status).toBe('empty');
      expect(persist.persistItems).not.toHaveBeenCalled();
      expect(collectLog.logFailure).toHaveBeenCalledTimes(1);
    });

    it('采集器抛异常：不落库 + 记失败日志 + status=failed 带错误', async () => {
      build({
        arxiv: new FakeCollector('arxiv', async () => {
          throw new Error('fetch failed');
        }),
      });
      const out = await service.run(makeSource());

      expect(out.status).toBe('failed');
      expect(out.error).toBe('fetch failed');
      expect(persist.persistItems).not.toHaveBeenCalled();
      expect(collectLog.logFailure).toHaveBeenCalledTimes(1);
    });
  });

  describe('test() 试采（不落库路径）', () => {
    it('成功：返回预览条目，且 persist / collectLog 一次都不碰', async () => {
      build({
        arxiv: new FakeCollector('arxiv', async () => [rawItem('1'), rawItem('2')]),
      });
      const out = await service.test('arxiv', { categories: 'cs.AI' }, 5);

      expect(out.status).toBe('ok');
      expect(out.item_count).toBe(2);
      expect(out.items).toHaveLength(2);
      expect(out.items[0]).toMatchObject({ external_id: '1', title: '标题-1' });
      // 🔴 试采的铁律：零副作用
      expect(persist.persistItems).not.toHaveBeenCalled();
      expect(collectLog.logSuccess).not.toHaveBeenCalled();
      expect(collectLog.logFailure).not.toHaveBeenCalled();
    });

    it('空结果：status=empty，同样零副作用', async () => {
      build({ arxiv: new FakeCollector('arxiv', async () => []) });
      const out = await service.test('arxiv', {}, 5);
      expect(out.status).toBe('empty');
      expect(persist.persistItems).not.toHaveBeenCalled();
      expect(collectLog.logFailure).not.toHaveBeenCalled();
    });

    it('采集器抛异常：status=failed 带错误，零副作用', async () => {
      build({
        arxiv: new FakeCollector('arxiv', async () => {
          throw new Error('connect timeout');
        }),
      });
      const out = await service.test('arxiv', {}, 5);
      expect(out.status).toBe('failed');
      expect(out.error).toBe('connect timeout');
      expect(persist.persistItems).not.toHaveBeenCalled();
    });

    it('未注册类型：status=failed 且提示未注册', async () => {
      build({});
      const out = await service.test('nope', {}, 5);
      expect(out.status).toBe('failed');
      expect(out.error).toContain('未注册采集器类型');
    });

    it('预览上限 20 条：超量时截断', async () => {
      build({
        arxiv: new FakeCollector('arxiv', async () =>
          Array.from({ length: 50 }, (_, i) => rawItem(String(i))),
        ),
      });
      const out = await service.test('arxiv', {}, 50);
      expect(out.item_count).toBe(50);
      expect(out.items).toHaveLength(20);
    });
  });

  describe('hasCollector 分派判据', () => {
    it('默认注册表含 arxiv/rss/hackernews/eastmoney_lhb，不含 sina_news', () => {
      build();
      expect(service.hasCollector('arxiv')).toBe(true);
      expect(service.hasCollector('rss')).toBe(true);
      expect(service.hasCollector('hackernews')).toBe(true);
      expect(service.hasCollector('eastmoney_lhb')).toBe(true);
      // finnews 双写类型不归本服务分派
      expect(service.hasCollector('sina_news')).toBe(false);
      expect(service.hasCollector('eastmoney_news')).toBe(false);
      expect(service.hasCollector('nope')).toBe(false);
    });
  });
});
