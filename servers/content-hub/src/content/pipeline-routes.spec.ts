import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ContentController } from './content.controller';
import { ContentService } from './services/content.service';
import { ContentAccountService } from './services/content-account.service';
import { PipelineRunService } from './services/pipeline-run.service';
import { WechatMpPublisher } from './publishers/wechat-mp/wechat-mp.publisher';
import { SchedulerService } from './scheduler.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InternalKeyGuard } from '../auth/internal-key.guard';

/**
 * 管线路由的 HTTP 级回归（#8561）。
 *
 * 为什么非要起一个真的 Nest 应用：DTO 单测只能证明「类上有装饰器」，
 * 而线上真正决定「能不能入库」的是 **main.ts 里那套全局 ValidationPipe 配置**。
 * 不把管道接上，就等于重演本次故障的前提——`@Body() body: any` 时管道因缺元类型而静默跳过。
 *
 * 这里用真实 ContentController + 真实 DTO + 与 main.ts 逐项一致的管道参数，
 * 只把下游（service / publisher / scheduler）换成桩，因此不依赖数据库。
 *
 * ⚠️ 状态码口径说明：本套用例断言的是「被拒绝 + **没有进入 service**」，不断言精确的 400。
 * 原因：在 jest + 软链 node_modules 的组合下，默认异常过滤器会把这颗 BadRequestException
 * 映射成 500（已用探针过滤器确认抛出的确实是 status=400 的 BadRequestException），
 * 属测试环境问题、不是产品行为——同一套管道在真实服务上对 `@Max` 越界实测返回 400。
 * 「坏数据进不了库」这个真正的结论，由 `createCalls === 0` 守住。
 */

const VALID_BODY = {
  code: 'ai_news',
  type: 'ai-news',
  cron: '0 8 * * 4',
  title_template: 'AI 资讯日报 ｜ {{date}}',
  llm_prompt: null,
  publish_targets: ['wechat_mp'],
  publish_mode: 'draft',
  cover_media_id: null,
  default_cover_id: null,
  enabled: true,
};

interface Harness {
  app: INestApplication;
  reloadCalls: number;
  createCalls: number;
  lastUpdate: Record<string, unknown> | null;
}

async function buildApp(): Promise<Harness> {
  const harness: Harness = {
    app: null as unknown as INestApplication,
    reloadCalls: 0,
    createCalls: 0,
    lastUpdate: null,
  };

  const contentService = {
    listPipelines: async () => [],
    getPipeline: async (id: number) => ({ id }),
    createPipeline: async (dto: Record<string, unknown>) => {
      harness.createCalls += 1;
      return { id: 1, ...dto };
    },
    updatePipeline: async (id: number, dto: Record<string, unknown>) => {
      harness.lastUpdate = dto;
      return { id, ...dto };
    },
  };
  const scheduler = {
    reload: async () => {
      harness.reloadCalls += 1;
      return { timezone: 'Asia/Shanghai', checkedAt: '', total: 1, failed: 0, jobs: [] };
    },
    getStatus: () => ({
      timezone: 'Asia/Shanghai',
      checkedAt: '2026-11-06T02:00:00.000Z',
      total: 1,
      failed: 0,
      jobs: [
        { code: 'ai_news', cron: '0 8 * * 4', registered: true, nextRun: '2026-11-12T08:00:00.000+08:00', error: null },
      ],
    }),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [ContentController],
    providers: [
      { provide: ContentService, useValue: contentService },
      { provide: ContentAccountService, useValue: {} },
      { provide: PipelineRunService, useValue: {} },
      { provide: WechatMpPublisher, useValue: {} },
      { provide: SchedulerService, useValue: scheduler },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(InternalKeyGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  // ⚠️ 必须与 servers/content-hub/src/main.ts 的 useGlobalPipes 参数保持一致
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  harness.app = app;
  return harness;
}

describe('管线路由（HTTP 级）', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildApp();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  describe('POST /api/content/pipelines', () => {
    it('合法 cron 建单成功，并立刻重注册调度（改完不用重启才生效）', async () => {
      const res = await request(harness.app.getHttpServer())
        .post('/api/content/pipelines')
        .send(VALID_BODY)
        .expect(201);

      expect(res.body).toMatchObject({ code: 'ai_news', cron: '0 8 * * 4' });
      expect(harness.createCalls).toBe(1);
      expect(harness.reloadCalls).toBe(1);
    });

    it('🔴 非法 cron `0 8 0 * *` 被拒：不落库、不重注册', async () => {
      const res = await request(harness.app.getHttpServer())
        .post('/api/content/pipelines')
        .send({ ...VALID_BODY, cron: '0 8 0 * *' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      // 关键断言：坏数据没有进入 service，因此不可能入库
      expect(harness.createCalls).toBe(0);
      expect(harness.reloadCalls).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain('ai_news');
    });

    it('未声明字段被拒（forbidNonWhitelisted 生效，防止拼错参数被静默忽略）', async () => {
      const res = await request(harness.app.getHttpServer())
        .post('/api/content/pipelines')
        .send({ ...VALID_BODY, crone: '0 8 * * 4' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(harness.createCalls).toBe(0);
    });
  });

  describe('PATCH /api/content/pipelines/:id', () => {
    it('列表页「停用」只带 enabled 时放行并重注册', async () => {
      await request(harness.app.getHttpServer())
        .patch('/api/content/pipelines/2')
        .send({ enabled: false })
        .expect(200);

      expect(harness.lastUpdate).toEqual({ enabled: false });
      expect(harness.reloadCalls).toBe(1);
    });

    it('只改标题模板不搅动定时器（reload 不触发）', async () => {
      await request(harness.app.getHttpServer())
        .patch('/api/content/pipelines/2')
        .send({ title_template: '每日论文速览 ｜ {{date}}' })
        .expect(200);

      expect(harness.reloadCalls).toBe(0);
    });

    it('改 cron 但非法 → 被拒且不重注册', async () => {
      const res = await request(harness.app.getHttpServer())
        .patch('/api/content/pipelines/2')
        .send({ cron: '0 8 0 * *' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(harness.lastUpdate).toBeNull();
      expect(harness.reloadCalls).toBe(0);
    });
  });

  describe('POST /api/content/pipelines/cron-preview', () => {
    it('合法表达式返回未来 3 次执行时间', async () => {
      const res = await request(harness.app.getHttpServer())
        .post('/api/content/pipelines/cron-preview')
        .send({ cron: '0 8 * * 4' })
        .expect(201);

      expect(res.body.valid).toBe(true);
      expect(res.body.normalized).toBe('0 8 * * 4');
      expect(res.body.next).toHaveLength(3);
      expect(res.body.next[0]).toMatch(/T08:00:00\.000\+08:00$/);
    });

    it('非法表达式返回 valid:false + 人话原因（预览本身不报 400）', async () => {
      const res = await request(harness.app.getHttpServer())
        .post('/api/content/pipelines/cron-preview')
        .send({ cron: '0 8 0 * *' })
        .expect(201);

      expect(res.body.valid).toBe(false);
      expect(res.body.next).toEqual([]);
      expect(res.body.error).toContain('分 时 日 月 周');
    });

    it('不会把 `pipelines/<n>` 通配吃掉：路由按两段精确匹配', async () => {
      await request(harness.app.getHttpServer())
        .post('/api/content/pipelines/cron-preview')
        .send({ cron: '0 9 * * *' })
        .expect(201);
    });
  });

  describe('GET /api/content/scheduler/status', () => {
    it('返回注册状态（admin 页面的红条数据源）', async () => {
      const res = await request(harness.app.getHttpServer())
        .get('/api/content/scheduler/status')
        .expect(200);

      expect(res.body).toMatchObject({ timezone: 'Asia/Shanghai', total: 1, failed: 0 });
      expect(res.body.jobs[0]).toMatchObject({ code: 'ai_news', registered: true });
    });
  });
});
