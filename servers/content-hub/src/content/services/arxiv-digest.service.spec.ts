/**
 * 论文摘要落库 —— 质量归因语义单测（p35 · CQO）。
 *
 * 锁的是「Phase 2 评测能不能成立」的三件事，坏了都不会报错、只会让评测结果悄悄失真：
 *   ① 降级产物必须打 partial + fallback：模板化摘要没有 LLM 内容，混进评测集会**拉低幻觉率**
 *      （模板自然没幻觉）—— 不标记 = 评测结论虚高。
 *   ② content 存 arXiv 原文 abstract、不是中文摘要：那是幻觉判定的比对基准，存错等于丢标准答案。
 *   ③ external_id = sha1(arxiv_id|prompt_version)：同版本重复提交幂等，换版本算新条目 ——
 *      评测按 prompt 版本对照抽样，全靠这一个键。
 *   ④ `title` 必须是原文、译名只能进 `title_zh`：一旦把译名写进 `title`，
 *      英文原名就永久丢了（重跑不自愈、幻觉核对没基准）。展示的「中文优先」由 `title_zh || title` 负责。
 */
import { createHash } from 'node:crypto';
import type { Repository } from 'typeorm';
import { ArxivDigestService, type ArxivDigestInput } from './arxiv-digest.service';
import type { ContentItemEntity } from '../entities/content-item.entity';
import { QUALITY_STATUS, QUALITY_STAGE } from '../quality/quality.enum';

const ARXIV_ID = '2408.12345';
const ABSTRACT = 'We propose a method that yields 91.2% accuracy on X.';

function input(over: Partial<ArxivDigestInput> = {}): ArxivDigestInput {
  return {
    arxiv_id: ARXIV_ID,
    title_en: 'A Test Paper',
    abstract: ABSTRACT,
    title_zh: '一篇测试论文',
    contribution: '核心贡献一句话',
    prompt_version: 'v1',
    ...over,
  };
}

/** repo 只用到 insert —— 断言全部对着落库的那一行 */
function makeRepo(insertImpl?: jest.Mock) {
  const rows: Array<Partial<ContentItemEntity>> = [];
  const insert =
    insertImpl ??
    jest.fn().mockImplementation(async (row: Partial<ContentItemEntity>) => {
      rows.push(row);
      return { identifiers: [] };
    });
  return { rows, insert, repo: { insert } as unknown as Repository<ContentItemEntity> };
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

describe('ArxivDigestService.persistDigest', () => {
  it('正常产出 → ok + llm，且 content 存的是原文 abstract（幻觉判定基准）', async () => {
    const { rows, repo } = makeRepo();
    const svc = new ArxivDigestService(repo);
    const r = await svc.persistDigest(input());

    expect(r.inserted).toBe(true);
    expect(r.quality_status).toBe(QUALITY_STATUS.OK);
    expect(r.quality_stage).toBe(QUALITY_STAGE.LLM);
    expect(rows[0].content).toBe(ABSTRACT);
    expect(rows[0].quality_issue).toBeNull();
    expect(rows[0].source_name).toBe('arxiv_digest');
  });

  it('title 存英文原文、title_zh 存译名 —— 存储不被展示需求污染', async () => {
    const { rows, repo } = makeRepo();
    const svc = new ArxivDigestService(repo);
    await svc.persistDigest(input());

    // 反过来（译名写进 title）会让英文原名永久丢失：重跑不自愈、幻觉核对没基准
    expect(rows[0].title).toBe('A Test Paper');
    expect(rows[0].title_zh).toBe('一篇测试论文');
    expect(rows[0].source_lang).toBe('en');
  });

  it('只有译名、没有英文原名 → title 退回译名，不写空标题', async () => {
    const { rows, repo } = makeRepo();
    const svc = new ArxivDigestService(repo);
    await svc.persistDigest(input({ title_en: undefined, title_zh: '一篇测试论文' }));

    expect(rows[0].title).toBe('一篇测试论文');
    expect(rows[0].title_zh).toBe('一篇测试论文');
    expect(rows[0].source_lang).toBe('zh');
  });

  it('降级产物 → partial + fallback，并写明 quality_issue（不能算正常产出）', async () => {
    const { rows, repo } = makeRepo();
    const svc = new ArxivDigestService(repo);
    const r = await svc.persistDigest(input({ degraded: true }));

    expect(r.degraded).toBe(true);
    expect(r.quality_status).toBe(QUALITY_STATUS.PARTIAL);
    expect(r.quality_stage).toBe(QUALITY_STAGE.FALLBACK);
    expect(rows[0].quality_issue).toContain('降级通道');
    expect(rows[0].meta?.prompt_version).toBe('v1');
    expect(rows[0].meta?.degraded).toBe(true);
  });

  it('external_id = sha1(arxiv_id|prompt_version)：同版本幂等，换版本算新条目', async () => {
    const { rows, repo } = makeRepo();
    const svc = new ArxivDigestService(repo);

    await svc.persistDigest(input());
    await svc.persistDigest(input({ prompt_version: 'v2' }));

    expect(rows[0].external_id).toBe(sha1(ARXIV_ID + '|v1'));
    expect(rows[1].external_id).toBe(sha1(ARXIV_ID + '|v2'));
    expect(rows[0].external_id).not.toBe(rows[1].external_id);
  });

  it('同版本重复提交 → 命中唯一键时不抛错、标记未插入', async () => {
    const insert = jest.fn().mockRejectedValue(
      Object.assign(new Error("Duplicate entry 'x' for key 'uk_items_pipeline_external'"), {
        code: 'ER_DUP_ENTRY',
      }),
    );
    const { repo } = makeRepo(insert);
    const svc = new ArxivDigestService(repo);
    const r = await svc.persistDigest(input());

    expect(r.inserted).toBe(false);
    expect(r.quality_status).toBe(QUALITY_STATUS.OK);
  });

  it('非唯一键错误 → 如实抛出（不能用一个原因吞掉全部故障）', async () => {
    const insert = jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const { repo } = makeRepo(insert);
    const svc = new ArxivDigestService(repo);
    await expect(svc.persistDigest(input())).rejects.toThrow('ENOTFOUND');
  });
});

describe('ArxivDigestService.persistBatch', () => {
  it('单条失败不打断整批 —— 坏的那条标 fail，其余照落', async () => {
    // 第 2 条炸，其余两条正常落库 —— 同时把落下来的行留下以便断言
    const rows: Array<Partial<ContentItemEntity>> = [];
    let calls = 0;
    const insert = jest.fn().mockImplementation(async (row: Partial<ContentItemEntity>) => {
      calls += 1;
      if (calls === 2) throw new Error('boom');
      rows.push(row);
      return { identifiers: [] };
    });
    const svc = new ArxivDigestService({ insert } as unknown as Repository<ContentItemEntity>);
    const results = await svc.persistBatch([
      input({ arxiv_id: '2408.00001' }),
      input({ arxiv_id: '2408.00002' }),
      input({ arxiv_id: '2408.00003' }),
    ]);

    expect(results).toHaveLength(3);
    expect(rows).toHaveLength(2);
    expect(results[1].quality_status).toBe(QUALITY_STATUS.FAIL);
    expect(results[0].inserted).toBe(true);
    expect(results[2].inserted).toBe(true);
  });
});
