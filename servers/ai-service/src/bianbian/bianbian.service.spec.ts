import * as fs from 'fs';
import { of } from 'rxjs';
import { BianbianService } from './bianbian.service';

/**
 * A8 落盘改造的回归测试（ai-service 此前 0 个 spec）。
 * 只覆盖本次改动面：`downloadAndSaveImage` 是否走 upload-service、是否还写本地盘。
 */
describe('BianbianService.downloadAndSaveImage（A8）', () => {
  const storeImage = jest.fn();
  const httpGet = jest.fn();
  /** 启动期解析出的存储目录（形态分派后的进程常量） */
  const storageDirs = {
    uploadDir: '/data/web_system/uploads',
    tempDir: '/data/web_system/temp-images',
    uploadSource: 'system_service',
    tempSource: 'system_service',
    mode: 'cluster',
    notes: [],
  } as never;
  const service = new BianbianService(
    {} as never,
    {} as never,
    {} as never,
    { get: httpGet } as never,
    { get: () => undefined } as never,
    { storeImage } as never,
    storageDirs,
  );
  const invoke = (url: string) => (service as unknown as { downloadAndSaveImage(a: string, b: string): Promise<string> })
    .downloadAndSaveImage(url, 'rec-1');

  beforeEach(() => jest.clearAllMocks());

  it('已是本地路径 → 原样返回，不落盘也不下载', async () => {
    expect(await invoke('/api/uploads/bianbian/old.jpg')).toBe('/api/uploads/bianbian/old.jpg');
    expect(storeImage).not.toHaveBeenCalled();
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('下载后交给 upload-service 落盘，返回统一 URL，且不再本地写文件', async () => {
    const writeSpy = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    httpGet.mockReturnValue(of({ status: 200, data: Buffer.from('img-bytes') }));
    storeImage.mockResolvedValue('/api/uploads/bianbian/bianbian-1-a1b2c3.jpg');

    const url = await invoke('https://cdn.example.com/gen/abc.png?x=1');

    expect(url).toBe('/api/uploads/bianbian/bianbian-1-a1b2c3.jpg');
    expect(storeImage).toHaveBeenCalledTimes(1);
    const arg = storeImage.mock.calls[0][0];
    expect(arg.category).toBe('bianbian');
    // 扩展名取自 URL 且必须落在 upload-service 白名单内
    expect(arg.filename).toMatch(/^bianbian-\d+-[a-z0-9]{6}\.png$/);
    expect(Buffer.isBuffer(arg.buffer)).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('落盘失败 → 抛错（由 transform 降级为存远端 URL）', async () => {
    httpGet.mockReturnValue(of({ status: 200, data: Buffer.from('img-bytes') }));
    storeImage.mockRejectedValue(new Error('内部落盘失败: HTTP 401'));
    await expect(invoke('https://cdn.example.com/gen/abc.jpg')).rejects.toThrow(/内部落盘失败/);
  });

  it('下载失败 → 抛错，且不调落盘', async () => {
    httpGet.mockReturnValue(of({ status: 502, data: Buffer.from('') }));
    await expect(invoke('https://cdn.example.com/gen/abc.jpg')).rejects.toThrow(/下载图片失败/);
    expect(storeImage).not.toHaveBeenCalled();
  });
});

describe('BianbianService 临时图目录口径（W4：形态分派后的进程常量）', () => {
  const dirs = (tempDir: string | null) =>
    ({
      uploadDir: '/data/web_system/uploads',
      tempDir,
      uploadSource: 'system_service',
      tempSource: tempDir ? 'system_service' : null,
      mode: 'cluster',
      notes: [],
    }) as never;

  const make = (d: unknown) =>
    new BianbianService(
      {} as never,
      {} as never,
      {} as never,
      { get: () => undefined } as never,
      { get: () => undefined } as never,
      { storeImage: jest.fn() } as never,
      d as never,
    );

  const tempOf = (s: BianbianService) => (s as unknown as { tempImagesDir: string }).tempImagesDir;

  it('目录 = 启动期注入的解析结果（不是「运行根 + 段名」自己拼）', () => {
    expect(tempOf(make(dirs('/data/web_system/temp-images')))).toBe(
      '/data/web_system/temp-images',
    );
  });

  it('改了系统配置并重启 → 用新目录（证明它是注入值而非常量）', () => {
    expect(tempOf(make(dirs('/mnt/data/temp-images')))).toBe('/mnt/data/temp-images');
  });

  it('🔴 只解析了上传根目录（tempDir=null）→ 抛错，绝不静默回落到 cwd', () => {
    expect(() => tempOf(make(dirs(null)))).toThrow(/未解析|未启用/);
  });

  it('🔴 注入对象缺失（模块没装）→ 抛错而不是 undefined 参与路径拼接', () => {
    expect(() => tempOf(make(undefined))).toThrow(/未解析|未启用|Cannot read/);
  });
});
