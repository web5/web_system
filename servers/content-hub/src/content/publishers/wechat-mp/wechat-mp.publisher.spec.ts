import { WechatMpPublisher } from './wechat-mp.publisher';
import { publicationStatus } from '../publisher.interface';

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

  it('发布接口无权限(48001)时降级为「已进草稿箱待发布」，不记成失败', async () => {
    const { pub, fakeClient, added } = setup();
    fakeClient.submitFreepublish.mockRejectedValue(
      new Error('微信 发布草稿失败[48001] api unauthorized rid: 6adae03f'),
    );
    const r = await pub.publish({ title: 'AI 资讯日报 ｜ 2026-10-23', html: HTML_NO_IMAGE });

    // 草稿其实建成功了，内容没丢
    expect(added).toHaveLength(1);
    expect(r.success).toBe(false);
    expect(r.drafted).toBe(true);
    expect(r.media_id).toBe('draft-media-1');
    expect(r.error).toContain('草稿箱');
  });

  it('非权限类发布错误仍是普通失败，不降级', async () => {
    const { pub, fakeClient } = setup();
    fakeClient.submitFreepublish.mockRejectedValue(
      new Error('微信 发布草稿失败[45009] reach max quota'),
    );
    const r = await pub.publish({ title: 't', html: HTML_NO_IMAGE });

    expect(r.success).toBe(false);
    expect(r.drafted).toBeUndefined();
  });
});

describe('publicationStatus', () => {
  it('成功 / 待发布 / 失败 三态换算', () => {
    expect(publicationStatus({ success: true })).toBe('success');
    expect(publicationStatus({ success: false, drafted: true })).toBe('drafted');
    expect(publicationStatus({ success: false, error: 'boom' })).toBe('failed');
  });

  /**
   * 显式草稿模式是 success=true + drafted=true。
   * 若 publicationStatus 先判 success，它会被记成「已发布」——后台状态骗人。
   */
  it('草稿模式（success + drafted）落库为 drafted，不误判成已发布', () => {
    expect(publicationStatus({ success: true, drafted: true })).toBe('drafted');
  });
});

/**
 * 发布模式：draft 与 publish 是两个**可选终点**，不是成功/失败。
 * 此前只有「发布失败后降级」这一条路，语义是反的。
 */
describe('WechatMpPublisher 发布模式', () => {
  const HTML_NO_IMAGE = '<h2>AI 资讯日报</h2><p>正文</p>';

  function setup() {
    const pub = new WechatMpPublisher();
    const fakeClient = {
      addDraft: jest.fn(async () => 'draft-media-1'),
      submitFreepublish: jest.fn(async () => 'publish-1'),
      uploadThumbMedia: jest.fn(async () => 'thumb-from-body'),
      downloadImage: jest.fn(),
    };
    jest.spyOn(pub as never, 'getClient').mockReturnValue(fakeClient as never);
    return { pub, fakeClient };
  }

  afterEach(() => jest.restoreAllMocks());

  it('mode=draft：只建草稿，不调发布接口，返回成功 + media_id', async () => {
    const { pub, fakeClient } = setup();
    const r = await pub.publish({ title: 't', html: HTML_NO_IMAGE, mode: 'draft' });

    expect(fakeClient.addDraft).toHaveBeenCalledTimes(1);
    expect(fakeClient.submitFreepublish).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.drafted).toBe(true);
    expect(r.media_id).toBe('draft-media-1');
    // 预期结果，不该带 error（带了就会被当成失败原因展示）
    expect(r.error).toBeUndefined();
  });

  it('mode=publish（默认）：建草稿后提交发布', async () => {
    const { pub, fakeClient } = setup();
    const r = await pub.publish({ title: 't', html: HTML_NO_IMAGE, mode: 'publish' });

    expect(fakeClient.submitFreepublish).toHaveBeenCalledWith('draft-media-1');
    expect(r.success).toBe(true);
    expect(r.drafted).toBeUndefined();
    expect(r.external_id).toBe('publish-1');
  });

  it('不传 mode 时按正式发布处理（存量调用方行为不变）', async () => {
    const { pub, fakeClient } = setup();
    await pub.publish({ title: 't', html: HTML_NO_IMAGE });
    expect(fakeClient.submitFreepublish).toHaveBeenCalledTimes(1);
  });
});
