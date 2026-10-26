/**
 * 封面素材库单测。
 *
 * 锁的是三条「坏了不报错、只会静默出错」的行为：
 *  ① 删掉被管线当默认封面的图 → 下次定时发布静默退回兜底封面（封面"自己变了"）
 *  ② 已同步的图重复上传微信 → 撞永久素材 5000 上限，且每次都是外网往返
 *  ③ 微信同步失败就把发布卡死 → 封面传不上去不该让整篇文章发不出去
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MediaService } from './media.service';
import type { ContentMediaEntity } from '../entities/content-media.entity';

/** 1×1 PNG（合法头部即可，本测试不解码像素） */
function pngBuffer(width = 900, height = 383): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function mediaRow(over: Partial<ContentMediaEntity> = {}): ContentMediaEntity {
  return {
    id: 7,
    kind: 'cover',
    name: '日报封面',
    media_type: 'image',
    file_url: '/api/uploads/covers/x.png',
    media_id: null,
    account: 'default',
    url: null,
    width: 900,
    height: 383,
    bytes: 1024,
    mime: 'image/png',
    tags: ['日报'],
    source: 'upload',
    prompt: null,
    last_error: null,
    enabled: true,
    use_count: 0,
    last_used_at: null,
    created_at: new Date('2026-10-26T00:00:00Z'),
    updated_at: new Date('2026-10-26T00:00:00Z'),
    deleted_at: null,
    ...over,
  } as ContentMediaEntity;
}

function build(over: {
  row?: ContentMediaEntity | null;
  pipelines?: Array<{ id: number; code: string }>;
  uploadStore?: any;
  publisher?: any;
} = {}) {
  const saved: ContentMediaEntity[] = [];
  const mediaRepo: any = {
    findOne: async () => (over.row === undefined ? mediaRow() : over.row),
    save: async (r: any) => {
      saved.push(r);
      return r;
    },
    create: (r: any) => r,
    softDelete: jest.fn(async () => ({ affected: 1 })),
    createQueryBuilder: () => ({
      update: () => ({
        set: () => ({ where: () => ({ execute: async () => ({ affected: 1 }) }) }),
      }),
    }),
  };
  const pipelineRepo: any = { find: async () => over.pipelines ?? [] };
  const uploadStore: any = over.uploadStore ?? {
    storeImage: async () => ({
      url: '/api/uploads/covers/x.png',
      filename: 'x.png',
      originalName: 'x.png',
      size: pngBuffer().length,
      category: 'covers',
      mimetype: 'image/png',
    }),
  };
  const publisher: any = over.publisher ?? {
    uploadCoverToWechat: async () => ({ media_id: 'MID-1', url: 'https://mmbiz/x.png' }),
  };
  const svc = new MediaService(mediaRepo, pipelineRepo, uploadStore, publisher);
  return { svc, mediaRepo, saved, publisher, uploadStore };
}

describe('MediaService.createFromUpload', () => {
  it('正常 PNG → 转存后落库，宽高与来源都记上', async () => {
    const { svc, saved } = build();
    const vo = await svc.createFromUpload(
      { buffer: pngBuffer(), originalname: '日报封面.png', mimetype: 'image/png' },
      '日报封面',
      ['日报'],
    );
    expect(saved[0].file_url).toBe('/api/uploads/covers/x.png');
    expect(saved[0].width).toBe(900);
    expect(saved[0].height).toBe(383);
    expect(saved[0].source).toBe('upload');
    expect(vo.ratio_hint.ok).toBe(true);
  });

  it('GIF → 直接拒（上传到微信只剩首帧，预览却在动，会被当成同步失败）', async () => {
    const { svc } = build();
    await expect(
      svc.createFromUpload({
        buffer: Buffer.from('gif'),
        originalname: 'a.gif',
        mimetype: 'image/gif',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('超过 5MB → 拒绝，并说清上限', async () => {
    const { svc } = build();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    await expect(
      svc.createFromUpload({ buffer: big, originalname: 'a.png', mimetype: 'image/png' }),
    ).rejects.toThrow(/5MB/);
  });
});

describe('MediaService.remove', () => {
  it('被管线当默认封面时拒绝删除，并在报错里点名是哪条管线', async () => {
    const { svc, mediaRepo } = build({ pipelines: [{ id: 2, code: 'ai_news' }] });
    await expect(svc.remove(7)).rejects.toThrow(/ai_news/);
    expect(mediaRepo.softDelete).not.toHaveBeenCalled();
  });

  it('没被引用 → 软删（不物理删，历史成文还要能查）', async () => {
    const { svc, mediaRepo } = build({ pipelines: [] });
    await expect(svc.remove(7)).resolves.toEqual({ ok: true });
    expect(mediaRepo.softDelete).toHaveBeenCalledWith(7);
  });

  it('素材不存在 → 404 而不是静默成功', async () => {
    const { svc } = build({ row: null });
    await expect(svc.remove(7)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MediaService.syncToWechat', () => {
  it('已同步且账号一致 → 直接用缓存，不再调微信', async () => {
    const { svc, publisher } = build({
      row: mediaRow({ media_id: 'OLD-ID', account: 'default' }),
    });
    const spy = jest.spyOn(publisher, 'uploadCoverToWechat');
    const vo = await svc.syncToWechat(7, 'default');
    expect(spy).not.toHaveBeenCalled();
    expect(vo.media_id).toBe('OLD-ID');
  });

  it('换了账号 → 必须重传（media_id 按公众号隔离）', async () => {
    const { svc, publisher } = build({
      row: mediaRow({ media_id: 'OLD-ID', account: 'default' }),
    });
    const spy = jest.spyOn(publisher, 'uploadCoverToWechat');
    const vo = await svc.syncToWechat(7, 'kedouai');
    expect(spy).toHaveBeenCalledWith('/api/uploads/covers/x.png', 'kedouai');
    expect(vo.media_id).toBe('MID-1');
    expect(vo.account).toBe('kedouai');
  });

  it('同步失败 → 记 last_error 并抛出（否则前端只看到"点了没反应"）', async () => {
    const { svc, saved } = build({
      publisher: {
        uploadCoverToWechat: async () => {
          throw new Error('微信 add_material 失败[40001] invalid credential');
        },
      },
    });
    await expect(svc.syncToWechat(7)).rejects.toThrow(/add_material/);
    expect(saved.at(-1)?.last_error).toContain('40001');
  });
});

describe('MediaService.ensureWechatMediaId（发布前兜底）', () => {
  it('同步失败返回 null 而不抛错 —— 封面传不上去不该让文章发不出去', async () => {
    const { svc } = build({
      publisher: {
        uploadCoverToWechat: async () => {
          throw new Error('network down');
        },
      },
    });
    await expect(svc.ensureWechatMediaId(7)).resolves.toBeNull();
  });

  it('素材已停用 → 返回 null，走发布器兜底封面', async () => {
    const { svc, publisher } = build({ row: mediaRow({ enabled: false }) });
    const spy = jest.spyOn(publisher, 'uploadCoverToWechat');
    await expect(svc.ensureWechatMediaId(7)).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('未同步过 → 同步一次并返回 media_id', async () => {
    const { svc } = build();
    await expect(svc.ensureWechatMediaId(7, 'default')).resolves.toBe('MID-1');
  });
});
