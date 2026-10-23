import { WechatMpPublisher } from './wechat-mp.publisher';

/**
 * 封面兜底回归测试。
 *
 * 背景（2026-10-23）：日报类成文是纯文本 HTML（h2/h3/p，无 <img>），
 * 取不到正文首图 → 建草稿必抛「缺少封面」→ 每天 8:00 定时发布全失败。
 * 修复后：显式 thumb_media_id → 正文首图 → env 覆盖 → 内置默认封面。
 */
describe('WechatMpPublisher 封面', () => {
  /** 日报真实形态：一张图都没有 */
  const HTML_NO_IMAGE = '<h2>AI 资讯日报</h2><h3>1. 标题</h3><p>正文内容</p>';

  function setup() {
    const pub = new WechatMpPublisher();
    const added: Array<Record<string, unknown>> = [];
    const fakeClient = {
      addDraft: jest.fn(async (p: Record<string, unknown>) => {
        added.push(p);
        return 'draft-media-1';
      }),
      submitFreepublish: jest.fn(async () => 'publish-1'),
      uploadThumbMedia: jest.fn(async () => 'thumb-from-body'),
      downloadImage: jest.fn(),
    };
    jest.spyOn(pub as never, 'getClient').mockReturnValue(fakeClient as never);
    return { pub, fakeClient, added };
  }

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.WECHAT_MP_DEFAULT_THUMB_MEDIA_ID;
  });

  it('正文无图时用默认封面兜底，不再抛「缺少封面」', async () => {
    const { pub, fakeClient, added } = setup();
    const r = await pub.publish({ title: 'AI 资讯日报 ｜ 2026-10-23', html: HTML_NO_IMAGE });

    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    // 没有图可上传
    expect(fakeClient.uploadThumbMedia).not.toHaveBeenCalled();
    // 但封面必须有值，且是兜底常量
    expect(added[0].thumb_media_id).toBe(
      'BUSabtk9juW90vSVH4g1KvRzUZWAHmPFAFslvaKJIwuQ_CyNhFapHJA7CIRSUTTI',
    );
  });

  it('显式 thumb_media_id 优先级最高', async () => {
    const { pub, added } = setup();
    await pub.publish({
      title: 't',
      html: HTML_NO_IMAGE,
      thumb_media_id: 'explicit-thumb',
    });
    expect(added[0].thumb_media_id).toBe('explicit-thumb');
  });

  it('env WECHAT_MP_DEFAULT_THUMB_MEDIA_ID 可覆盖内置兜底（换封面不用改代码）', async () => {
    process.env.WECHAT_MP_DEFAULT_THUMB_MEDIA_ID = 'env-thumb-id';
    const { pub, added } = setup();
    await pub.publish({ title: 't', html: HTML_NO_IMAGE });
    expect(added[0].thumb_media_id).toBe('env-thumb-id');
  });
});
