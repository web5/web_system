import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { UploadStoreClient } from './upload-store.client';

/** 构造一个最小可用的 AxiosResponse */
function resp(status: number, data: unknown): AxiosResponse {
  return { status, data, statusText: '', headers: {}, config: {} as never } as AxiosResponse;
}

describe('UploadStoreClient（A8 · 内部落盘）', () => {
  let client: UploadStoreClient;
  let post: jest.Mock;

  beforeEach(async () => {
    post = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadStoreClient,
        { provide: HttpService, useValue: { post } },
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) =>
              ({
                UPLOAD_SERVICE_URL: 'http://localhost:6008',
                INTERNAL_API_KEY: 'test-key',
              })[k],
          },
        },
      ],
    }).compile();
    client = module.get(UploadStoreClient);
  });

  it('走 multipart 调 internal/uploads/store，带 x-internal-key，返回统一 URL', async () => {
    post.mockReturnValue(
      of(resp(200, { code: 0, data: { url: '/api/uploads/bianbian/bianbian-1-a1b2c3.jpg' } })),
    );

    const url = await client.storeImage({
      category: 'bianbian',
      filename: 'bianbian-1-a1b2c3.jpg',
      buffer: Buffer.from('binary'),
      mimeType: 'image/jpeg',
    });

    expect(url).toBe('/api/uploads/bianbian/bianbian-1-a1b2c3.jpg');
    const [target, body, opts] = post.mock.calls[0];
    expect(target).toBe('http://localhost:6008/internal/uploads/store');
    expect(opts.headers['x-internal-key']).toBe('test-key');
    // 字段必须齐备且不得多传（upload-service 开了 forbidNonWhitelisted）
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('category')).toBe('bianbian');
    expect((body as FormData).get('filename')).toBe('bianbian-1-a1b2c3.jpg');
    expect((body as FormData).get('file')).toBeTruthy();
  });

  it('返回 code≠0 或缺 url → 抛错（供上层降级）', async () => {
    post.mockReturnValue(of(resp(200, { code: 1, message: 'bad category' })));
    await expect(
      client.storeImage({ category: 'nope', filename: 'x.jpg', buffer: Buffer.from('x') }),
    ).rejects.toThrow(/内部落盘失败/);
  });

  it('401 / 网络异常 → 抛错', async () => {
    post.mockReturnValue(throwError(() => new Error('connect ECONNREFUSED')));
    await expect(
      client.storeImage({ category: 'bianbian', filename: 'x.jpg', buffer: Buffer.from('x') }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('配置了 UPLOAD_SERVICE_URL 时用配置值（去掉结尾斜杠）', async () => {
    post.mockReturnValue(of(resp(200, { code: 0, data: { url: '/api/uploads/bianbian/x.jpg' } })));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadStoreClient,
        { provide: HttpService, useValue: { post } },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://upload.internal:6008/' },
        },
      ],
    }).compile();
    const c2 = module.get(UploadStoreClient);
    await c2.storeImage({ category: 'bianbian', filename: 'x.jpg', buffer: Buffer.from('x') });
    expect(post.mock.calls[0][0]).toBe('http://upload.internal:6008/internal/uploads/store');
  });
});
