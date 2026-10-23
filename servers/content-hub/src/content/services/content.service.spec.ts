import { ContentService } from './content.service';

/**
 * 采集明细页统计卡（itemStats）的原生 SQL 形状回归测试。
 *
 * 背景（2026-10-23 线上事故）：
 *   itemStats 里曾写成 `'item.quality_status IN (:...qs'` —— 少一个右括号、多写 `...`，
 *   TypeORM 拼出的 SQL 未闭合，MySQL 报
 *     "You have an error in your SQL syntax ... near '' at line 1"
 *   采集明细页 `Promise.all([listItems(), itemStats()])` 因此整页 500，
 *   而列表数据其实一直是好的。
 *
 * 根因是这条 SQL 从没被任何测试覆盖过（content.service 此前零单测），
 * 故本文件专门钉死「原生 SQL 的形状」，防止同类笔误再次上线。
 */

/** 记录 QueryBuilder 收到的每个 SQL 片段与参数 */
type SqlLog = Array<{ sql: string; params?: Record<string, unknown> }>;

function makeQueryBuilder(log: SqlLog) {
  const qb: any = {
    where(sql: string, params?: Record<string, unknown>) {
      log.push({ sql, params });
      return qb;
    },
    andWhere(sql: string, params?: Record<string, unknown>) {
      log.push({ sql, params });
      return qb;
    },
    orWhere(sql: string, params?: Record<string, unknown>) {
      log.push({ sql, params });
      return qb;
    },
    getCount: async () => 0,
    getRawOne: async () => null,
  };
  return qb;
}

function buildService(log: SqlLog): ContentService {
  const itemRepo: any = {
    count: async () => 0,
    createQueryBuilder: () => makeQueryBuilder(log),
  };
  return new ContentService(
    {} as any,
    {} as any,
    itemRepo,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe('ContentService.itemStats 原生 SQL 形状', () => {
  it('quality_status 的 IN 子句必须闭合，且占位符与参数名一致', async () => {
    const log: SqlLog = [];
    await buildService(log).itemStats();

    const hit = log.find((l) => l.sql.includes('quality_status'));
    expect(hit).toBeDefined();
    expect(hit!.sql).toBe('item.quality_status IN (:qs)');
    expect(hit!.params).toEqual({ qs: ['fail', 'partial'] });
    // 事故原文就是 'IN (:...qs' —— 显式钉死不得再出现
    expect(hit!.sql).not.toContain('...');
  });

  it('所有原生 SQL 片段的括号必须配对（防未闭合 SQL 上线）', async () => {
    const log: SqlLog = [];
    await buildService(log).itemStats();

    expect(log.length).toBeGreaterThan(0);
    for (const { sql } of log) {
      const open = (sql.match(/\(/g) ?? []).length;
      const close = (sql.match(/\)/g) ?? []).length;
      expect({ sql, open, close }).toEqual({ sql, open: close, close: open });
    }
  });

  it('占位符 :name 必须在 params 里有对应 key（防 :...qs 这类笔误）', async () => {
    const log: SqlLog = [];
    await buildService(log).itemStats();

    for (const { sql, params } of log) {
      const names = [...sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
      for (const n of names) {
        expect({ sql, missing: n, has: Object.prototype.hasOwnProperty.call(params ?? {}, n) }).toEqual({
          sql,
          missing: n,
          has: true,
        });
      }
    }
  });
});

/**
 * 成文预览的失败原因（#405）。
 *
 * 线上现象：pub 记录 status=failed，后台预览只有红叉 —— 想看原因得去查库。
 * 直接透出 `detail.error` 又不行：那是日志原文，带 access_token、部署绝对路径。
 * 所以这里钉死两件事：**该出现的信息要出现**，**不该出现的（凭证/路径）一个字都不能出现**。
 */
import { redactFailure } from './content.service';

function buildPreviewService(pub: Record<string, any>) {
  const publicationRepo: any = { findOne: async () => pub };
  return new ContentService(
    {} as any,
    {} as any,
    {} as any,
    publicationRepo,
    {} as any,
    {} as any,
  );
}

describe('redactFailure 脱敏规则（#405）', () => {
  it('凭证类参数的值一律抹成 ***', () => {
    const f = redactFailure(
      '调用失败 access_token=abc123def456&appsecret=zzz999&other=keep',
      new Date('2026-10-23T02:00:07Z'),
    );
    expect(f!.message).toContain('access_token=***');
    expect(f!.message).toContain('appsecret=***');
    // 非敏感参数保留，排障才有信息量
    expect(f!.message).toContain('other=keep');
  });

  it('不误伤普通字段（monkey / design 里含 key / sig 的词）', () => {
    const f = redactFailure('monkey=alpha design=beta key=gamma');
    expect(f!.message).toContain('monkey=alpha');
    expect(f!.message).toContain('design=beta');
    expect(f!.message).toContain('key=***');
  });

  it('JSON 风格与 Bearer 也要抹', () => {
    const f = redactFailure('body={"access_token":"tok_9f8e7d6c"} Authorization: Bearer eyJhbGciOiJIUzI1NiJ9');
    expect(f!.message).not.toContain('tok_9f8e7d6c');
    expect(f!.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(f!.message).toContain('***');
  });

  it('部署绝对路径不外泄', () => {
    const f = redactFailure('ENOENT: no such file /Users/geekwen/workspace/web_system/.env.prod');
    expect(f!.message).not.toContain('/Users/geekwen');
    expect(f!.message).toContain('***');
  });

  it('抓得到机器码（微信 [] 与 errcode= 两种写法）', () => {
    expect(redactFailure('微信 草稿失败[48001] 未开通发布接口')!.code).toBe('48001');
    expect(redactFailure('wechat errcode=45009 limit')!.code).toBe('45009');
    expect(redactFailure('普通错误没有码')!.code).toBeNull();
  });

  it('超长消息截断到 400 字（不把接口返回体整段搬上页面）', () => {
    const f = redactFailure('x'.repeat(2000));
    expect(f!.message.length).toBe(400);
  });

  it('空错误返回 null（不产出空 failure 块）', () => {
    expect(redactFailure('')).toBeNull();
    expect(redactFailure(null)).toBeNull();
    expect(redactFailure(undefined)).toBeNull();
  });
});

describe('publicationPreview 透出失败原因（#405）', () => {
  const basePub = {
    id: 10,
    target: 'wechat_mp',
    status: 'failed',
    external_id: null,
    created_at: new Date('2026-10-23T02:00:07Z'),
    updated_at: new Date('2026-10-23T02:00:09Z'),
    pipeline_id: null,
    detail: {
      error: '公众号发布失败：微信 草稿失败[48001] token=abc123 invalid ip 1.2.3.4',
      payload: { title: 'AI 资讯日报 ｜ 10-23', html: '<p>正文</p>' },
    },
  };

  it('failed 记录带上脱敏后的 failure（code/message/at 三件）', async () => {
    const r = await buildPreviewService(basePub).publicationPreview(10);
    expect(r!.failure).toEqual({
      code: '48001',
      message: expect.stringContaining('token=***'),
      at: '2026-10-23T02:00:09.000Z',
    });
  });

  it('🔴 反向断言：整条响应里不得出现原始 token', async () => {
    const r = await buildPreviewService(basePub).publicationPreview(10);
    expect(JSON.stringify(r)).not.toContain('abc123');
  });

  it('success 记录不带 failure（不产出误导性的红条）', async () => {
    const r = await buildPreviewService({
      ...basePub,
      status: 'success',
      detail: { payload: { title: 't', html: '<p>x</p>' } },
    }).publicationPreview(10);
    expect(r!.failure).toBeNull();
  });

  it('drafted 记录也不带 failure —— 它的 error 是「已进草稿箱」提示语，不是失败', async () => {
    const r = await buildPreviewService({
      ...basePub,
      status: 'drafted',
      detail: {
        error: '已进草稿箱待发布（media=xyz）：该公众号未开通发布接口权限',
        payload: { title: 't', html: '<p>x</p>' },
      },
    }).publicationPreview(10);
    expect(r!.failure).toBeNull();
  });
});

/**
 * 存量记录重建（#431）。
 *
 * 线上现象：#427 把渲染器修好了，但**存量记录的预览一字未变** —— preview 与
 * republish 两条路都直传发布当时存下的 `payload.html`，渲染器改了它也不会变。
 * 这里钉死三件事：
 *   1. 重建是从 markdown **重新渲染**（不是给旧 HTML 打补丁）；
 *   2. markdown 里的 `{{date}}` 也要洗 —— 存量 markdown 是旧代码落的，只重渲
 *      title 会让正文 h2 里剩半截模板；
 *   3. 写回留 `rebuilt_at`，不抹掉 error / media_id 这些审计痕迹，且幂等。
 */
function buildRebuildService(pub: Record<string, any> | null) {
  const sink: { updated?: { id: number; patch: any } } = {};
  const publicationRepo: any = {
    findOne: async () => pub,
    update: async (id: number, patch: any) => {
      sink.updated = { id, patch };
      return { affected: 1, generatedMaps: [], raw: [] };
    },
  };
  const svc = new ContentService(
    {} as any,
    {} as any,
    {} as any,
    publicationRepo,
    {} as any,
    {} as any,
  );
  return { svc, sink };
}

/** 一条「10-23 之前落的」存量记录：标题与正文都带 {{date}}，原文是纯文本 URL */
const stalePub = {
  id: 17,
  item_id: 0,
  pipeline_id: 2,
  target: 'wechat_mp',
  status: 'drafted',
  external_id: null,
  created_at: new Date('2026-10-23T04:34:00Z'),
  updated_at: new Date('2026-10-23T04:34:00Z'),
  detail: {
    payload: {
      title: 'AI 资讯日报 ｜ {{date}}',
      markdown:
        '# AI 资讯日报 ｜ {{date}}\n\n## 1. 某条新闻\n\n摘要\n\n原文：https://example.com/a',
      html:
        '<h2>AI 资讯日报 ｜ {{date}}</h2>\n<h3>1. 某条新闻</h3>\n<p>摘要</p>\n<p>原文：https://example.com/a</p>',
    },
  },
};

describe('rebuildPublication 存量记录重建（#431）', () => {
  it('从 markdown 重渲：裸 URL 变 <a>、{{date}} 在全链路被洗掉', async () => {
    const { svc, sink } = buildRebuildService(stalePub);
    const r = await svc.rebuildPublication(17);

    expect(r.ok).toBe(true);
    // 日期取记录创建日，不是「今天」
    expect(r.title).toBe('AI 资讯日报 ｜ 2026-10-23');

    const written = sink.updated!.patch.detail.payload;
    // 正文里的 {{date}} 必须也洗掉 —— 只重渲 title 修不到正文
    expect(written.markdown).not.toContain('{{date}}');
    expect(written.html).not.toContain('{{date}}');
    // 裸 URL 变成可点链接（#399 的渲染器）
    expect(written.html).toContain(
      '<a href="https://example.com/a">https://example.com/a</a>',
    );
    expect(written.title).toBe('AI 资讯日报 ｜ 2026-10-23');
  });

  it('写回留 rebuilt_at，且不抹掉 error / media_id 这些审计痕迹', async () => {
    const { svc, sink } = buildRebuildService({
      ...stalePub,
      detail: { ...stalePub.detail, error: '微信 48001', media_id: 'm1' },
    });
    await svc.rebuildPublication(17);

    const d = sink.updated!.patch.detail;
    expect(d.rebuilt_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(d.error).toBe('微信 48001');
    expect(d.media_id).toBe('m1');
  });

  it('幂等：拿写回结果再重建一次，两个 changed 都是 false', async () => {
    const { svc, sink } = buildRebuildService(stalePub);
    const first = await svc.rebuildPublication(17);
    expect(first.title_changed).toBe(true);
    expect(first.html_changed).toBe(true);

    const { svc: svc2 } = buildRebuildService({
      ...stalePub,
      detail: { ...stalePub.detail, payload: sink.updated!.patch.detail.payload },
    });
    const second = await svc2.rebuildPublication(17);
    expect(second).toEqual(
      expect.objectContaining({ title_changed: false, html_changed: false }),
    );
  });

  it('只有 html 没有 markdown：400（成品反推不回源，重建等于抄一遍旧串）', async () => {
    const { svc, sink } = buildRebuildService({
      ...stalePub,
      detail: { payload: { title: 't', html: '<p>x</p>' } },
    });
    await expect(svc.rebuildPublication(17)).rejects.toThrow(/没有 markdown 源/);
    expect(sink.updated).toBeUndefined();
  });

  it('无 payload（2026-10-22 前记录）：400 且文案指向重跑管线', async () => {
    const { svc } = buildRebuildService({ ...stalePub, detail: null });
    await expect(svc.rebuildPublication(17)).rejects.toThrow(/未留存成文内容/);
  });

  it('记录不存在：404', async () => {
    const { svc } = buildRebuildService(null);
    await expect(svc.rebuildPublication(999)).rejects.toThrow(/不存在/);
  });
});
