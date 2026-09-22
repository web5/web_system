import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UploadService } from './upload.service';

/** 仓库桩：只实现 recordUpload 用到的 save */
function repoStub() {
  return { save: jest.fn(async (v: Record<string, unknown>) => v) };
}

describe('UploadService（A3：唯一写入点 + 目录可配）', () => {
  let tmp: string;
  let repo: ReturnType<typeof repoStub>;
  let service: UploadService;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-svc-'));
    repo = repoStub();
    service = new UploadService(tmp, repo as never);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('分类键统一为磁盘目录名（复数），URL 段与之一致', () => {
    expect(Object.keys(UploadService.CATEGORIES)).toEqual([
      'avatars',
      'drawing',
      'bianbian',
      'general',
    ]);
    expect(service.buildUrl('x.png', 'avatars')).toBe('/api/uploads/avatars/x.png');
    expect(service.getUploadDir()).toBe(path.resolve(tmp));
    expect(service.getCategoryDir('drawing')).toBe(path.join(tmp, 'drawing'));
  });

  it('分类元信息可一次性取给前端（key 即磁盘目录名）', () => {
    const cats = service.getCategories();
    expect(cats.map((c) => c.key)).toEqual(['avatars', 'drawing', 'bianbian', 'general']);
    expect(cats.find((c) => c.key === 'avatars')?.maxSize).toBe(2 * 1024 * 1024);
  });

  describe('multer 配置（唯一实现，按分类限制）', () => {
    it('未知/已废弃分类名 → 400 并列出可选值', () => {
      // 'avatar'（单数）是历史写法，已统一为 'avatars'
      expect(() => service.getMulterOptions('avatar')).toThrow(BadRequestException);
      expect(() => UploadService.multerOptionsFor('nope', () => tmp)).toThrow(
        /不支持的上传类型/,
      );
    });

    it('大小限制取自分类配置', () => {
      expect(service.getMulterOptions('avatars').limits?.fileSize).toBe(2 * 1024 * 1024);
      expect(service.getMulterOptions('drawing').limits?.fileSize).toBe(10 * 1024 * 1024);
      expect(service.getMulterOptions('general').limits?.fileSize).toBe(5 * 1024 * 1024);
    });

    it('fileFilter：非图片 MIME 拒绝、图片放行', () => {
      const filter = service.getMulterOptions('general').fileFilter!;

      const rejected = jest.fn();
      filter({} as never, { mimetype: 'text/plain' } as never, rejected as never);
      expect(rejected.mock.calls[0][0]).toBeInstanceOf(BadRequestException);
      expect(rejected.mock.calls[0][1]).toBe(false);

      const accepted = jest.fn();
      filter({} as never, { mimetype: 'image/png' } as never, accepted as never);
      expect(accepted).toHaveBeenCalledWith(null, true);
    });
  });

  describe('storeBuffer：内部接口/生成图的落盘（唯一写入点）', () => {
    it('写入 <root>/<category>/，URL 与前台一致，并落库元数据', async () => {
      const stored = await service.storeBuffer({
        category: 'bianbian',
        originalName: 'gen.png',
        buffer: Buffer.from('PNGDATA'),
      });

      expect(stored.url).toBe(`/api/uploads/bianbian/${stored.filename}`);
      expect(stored.filename.startsWith('bianbian-')).toBe(true);
      expect(fs.readFileSync(path.join(tmp, 'bianbian', stored.filename), 'utf-8')).toBe(
        'PNGDATA',
      );

      expect(repo.save).toHaveBeenCalledTimes(1);
      const row = repo.save.mock.calls[0][0] as Record<string, unknown>;
      expect(row).toMatchObject({
        category: 'bianbian',
        originalName: 'gen.png',
        storageName: stored.filename,
        storagePath: `uploads/bianbian/${stored.filename}`,
        sizeBytes: 7,
        status: 'uploaded',
      });
    });

    it('avatars 落库口径沿用历史值 avatar（不改数据口径）', async () => {
      await service.storeBuffer({
        category: 'avatars',
        originalName: 'a.png',
        buffer: Buffer.from('x'),
      });
      expect((repo.save.mock.calls[0][0] as Record<string, unknown>).category).toBe('avatar');
    });

    it('文件名带路径 → 只取 basename（不越出分类目录）', async () => {
      const stored = await service.storeBuffer({
        category: 'general',
        originalName: '../../evil.png',
        buffer: Buffer.from('x'),
      });
      expect(fs.existsSync(path.join(tmp, 'general', stored.filename))).toBe(true);
      expect(fs.existsSync(path.join(path.dirname(tmp), 'evil.png'))).toBe(false);
    });

    it('扩展名不在分类白名单 → 400，且不创建目录（校验先于落盘）', async () => {
      await expect(
        service.storeBuffer({
          category: 'general',
          originalName: 'x.exe',
          buffer: Buffer.from('x'),
        }),
      ).rejects.toThrow(/仅支持/);
      expect(fs.existsSync(path.join(tmp, 'general'))).toBe(false);
    });

    it('超过分类大小上限 → 400', async () => {
      await expect(
        service.storeBuffer({
          category: 'avatars',
          originalName: 'a.png',
          buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
        }),
      ).rejects.toThrow(/超过 2MB/);
    });

    it('空内容 / 缺文件名 → 400', async () => {
      await expect(
        service.storeBuffer({ category: 'general', originalName: 'a.png', buffer: Buffer.alloc(0) }),
      ).rejects.toThrow(/内容为空/);
      await expect(
        service.storeBuffer({ category: 'general', originalName: '', buffer: Buffer.from('x') }),
      ).rejects.toThrow(/缺少原始文件名/);
    });

    it('元数据落库失败不影响「文件已落盘」的结论（只告警）', async () => {
      repo.save.mockRejectedValueOnce(new Error('db down'));
      const stored = await service.storeBuffer({
        category: 'general',
        originalName: 'a.png',
        buffer: Buffer.from('x'),
      });
      expect(fs.existsSync(path.join(tmp, 'general', stored.filename))).toBe(true);
    });

    it('mimetype 可由扩展名反查补充', async () => {
      const stored = await service.storeBuffer({
        category: 'general',
        originalName: 'a.webp',
        buffer: Buffer.from('x'),
      });
      expect(stored.mimetype).toBe('image/webp');
    });
  });
});
