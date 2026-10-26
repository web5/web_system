/**
 * 封面尺寸解析单测。
 *
 * 为什么值得测：尺寸只用于「微信会不会裁掉重点」的提示，
 * 解析错不会报错，只会让人看着一句错的话去做决定 —— 比 crash 更难发现。
 * 这里用最小合法头部构造三种格式，锁死各字段的偏移。
 */
import { coverRatioHint, readImageSize } from './image-size';

/** 最小 PNG 头：签名 + IHDR + 宽高 */
function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** 最小 JPEG：SOI + SOF0（高在 +5、宽在 +7） */
function jpeg(width: number, height: number): Buffer {
  const buf = Buffer.alloc(20);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  buf.writeUInt16BE(0x0011, 4); // 段长
  buf[6] = 0x08; // 精度
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  return buf;
}

/** 最小 WebP（VP8X 扩展头）：宽-1 / 高-1 各 24 位 */
function webp(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

describe('readImageSize', () => {
  it('PNG 读得出宽高', () => {
    expect(readImageSize(png(900, 383))).toEqual({
      width: 900,
      height: 383,
      mime: 'image/png',
    });
  });

  it('JPEG 读得出宽高', () => {
    expect(readImageSize(jpeg(1200, 510))).toEqual({
      width: 1200,
      height: 510,
      mime: 'image/jpeg',
    });
  });

  it('WebP 读得出宽高（VP8X 每条边 +1 的编码容易漏）', () => {
    expect(readImageSize(webp(900, 383))).toEqual({
      width: 900,
      height: 383,
      mime: 'image/webp',
    });
  });

  it('不是图片 / 空内容 → null（宁可说未知，也不猜一个数）', () => {
    expect(readImageSize(Buffer.from('not an image at all, definitely not'))).toBeNull();
    expect(readImageSize(Buffer.alloc(0))).toBeNull();
  });

  it('头部被截断 → null 而不是抛错', () => {
    expect(readImageSize(png(900, 383).subarray(0, 12))).toBeNull();
    expect(readImageSize(jpeg(1200, 510).subarray(0, 8))).toBeNull();
  });
});

describe('coverRatioHint', () => {
  it('2.35:1 附近判为符合公众号封面', () => {
    const r = coverRatioHint(900, 383);
    expect(r.ok).toBe(true);
    expect(r.ratio).toBe('2.35:1');
  });

  it('正方形可用，但要提醒列表头图会被裁', () => {
    const r = coverRatioHint(200, 200);
    expect(r.ok).toBe(true);
    expect(r.hint).toContain('裁');
  });

  it('竖图/过宽 → 不合规并说清后果', () => {
    expect(coverRatioHint(600, 1200).ok).toBe(false);
    expect(coverRatioHint(2400, 400).ok).toBe(false);
  });

  it('尺寸未知时如实说未知，不给出「符合」的错误结论', () => {
    const r = coverRatioHint(null, null);
    expect(r.ok).toBe(false);
    expect(r.ratio).toBe('未知');
  });
});
