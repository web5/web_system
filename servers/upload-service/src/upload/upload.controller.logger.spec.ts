import { Logger } from '@nestjs/common';
import { Request } from 'express';
import { UploadController } from './upload.controller';

/**
 * UploadController 日志合规化（specs/auto-deliver/2026-09-30-upload-logger）。
 *
 * 锁的是「失败记录元数据时走 Logger 告警、不去碰进程 stdout」这件事：
 * 铁律要求日志统一走 NestJS Logger，否则既难集中采集、级别也不可控。
 * 判据 V3/V4 要求 spy 到 Logger.warn 一次且含预期文案，并反证未被调用。
 */
function fileStub(): Express.Multer.File {
  return {
    originalname: 'a.png',
    filename: 'avatar-1.png',
    mimetype: 'image/png',
    size: 2048,
  } as Express.Multer.File;
}

function reqStub(): Request {
  return { user: { sub: 'user-1' } } as unknown as Request;
}

/** 只实现 respond()/persist() 用到的三个成员 */
function serviceStub(recordUpload: jest.Mock) {
  return {
    recordUpload,
    buildUrl: jest.fn((filename: string, dir: string) => `/uploads/${dir}/${filename}`),
    getCategories: jest.fn(() => ({})),
  } as never;
}

type Respondable = { respond: (...args: unknown[]) => Promise<{ code: number }> };

describe('UploadController 日志合规化（recordUpload 失败只告警，不让上传失败）', () => {
  let warnSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('recordUpload 抛错 → Logger.warn 一次含预期文案，stdout 裸写一次都没发生', async () => {
    const recordUpload = jest.fn(async () => {
      throw new Error('db connection lost');
    });
    const controller = new UploadController(serviceStub(recordUpload));

    const res = await (controller as never as Respondable).respond(
      fileStub(),
      'avatars',
      'avatar',
      reqStub(),
    );

    expect(recordUpload).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('[upload] 记录上传元数据失败');
    // 原始错误信息要保留，否则告警只剩标题、没法定位是哪个库问题
    expect(String(warnSpy.mock.calls[0][0])).toContain('db connection lost');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    // AC5：元数据失败不影响上传成功响应语义
    expect(res).toEqual({ code: 200, data: expect.objectContaining({ url: '/uploads/avatars/avatar-1.png' }) });
  });

  it('recordUpload 成功 → 不产生任何 warn（成功路径静默）', async () => {
    const recordUpload = jest.fn(async (v: Record<string, unknown>) => v);
    const controller = new UploadController(serviceStub(recordUpload));

    await (controller as never as Respondable).respond(fileStub(), 'drawing', 'drawing', reqStub());

    expect(recordUpload).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
