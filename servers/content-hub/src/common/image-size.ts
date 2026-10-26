/**
 * 从图片字节里读出像素宽高（只认 jpg / png / webp）。
 *
 * 为什么要自己解析：素材库上传后要告诉运营「这张图是 2.35:1 还是 16:9，微信会不会裁掉字」，
 * 这是唯一的用途。为此引入 sharp（带原生依赖、镜像里要编译）不值当，
 * 而 jpg/png/webp 的头部都是定长结构，几十行就能读准。
 *
 * 读不出来一律返回 null，**不要猜**：猜错的尺寸会让「比例提示」骗人。
 */

export interface ImageSize {
  width: number;
  height: number;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** PNG：8 字节签名 + IHDR，宽高是第 16/20 字节起的大端 uint32 */
function parsePng(buf: Buffer): ImageSize | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height, mime: 'image/png' } : null;
}

/** JPEG：逐段扫到 SOFn（0xC0~0xCF，排除 C4/C8/CC），高在 +5、宽在 +7 */
function parseJpeg(buf: Buffer): ImageSize | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1; // 段之间可能有填充字节
      continue;
    }
    const marker = buf[offset + 1];
    // SOI/EOI/RSTn 没有长度字段
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const len = buf.readUInt16BE(offset + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buf.readUInt16BE(offset + 5);
      const width = buf.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height, mime: 'image/jpeg' } : null;
    }
    offset += 2 + len;
  }
  return null;
}

/** WebP：RIFF 容器，三种帧头（VP8X 扩展 / VP8 有损 / VP8L 无损）各不相同 */
function parseWebp(buf: Buffer): ImageSize | null {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    // 扩展格式：24 位宽-1、24 位高-1
    const width = buf.readUIntLE(24, 3) + 1;
    const height = buf.readUIntLE(27, 3) + 1;
    return { width, height, mime: 'image/webp' };
  }
  if (chunk === 'VP8 ') {
    // 关键帧起始码 0x9d 0x01 0x2a，随后 14 位宽 / 14 位高
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height, mime: 'image/webp' };
  }
  if (chunk === 'VP8L') {
    // 无损：0x2f 签名后 14 位宽-1 / 14 位高-1（小端打包）
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height, mime: 'image/webp' };
  }
  return null;
}

/** 识别并读出宽高；不支持或损坏返回 null */
export function readImageSize(buf: Buffer): ImageSize | null {
  if (!buf?.length) return null;
  return parsePng(buf) ?? parseJpeg(buf) ?? parseWebp(buf) ?? null;
}

/**
 * 公众号封面比例建议。
 *
 * 微信的实际行为：`draft/add` 只吃一个 `thumb_media_id`（2.35:1 主图），
 * 群发列表里还会用 1:1 小图，而小图是从主图裁的 —— 所以主图**中间那 1:1 区域**必须能看。
 * 这里只给提示不拦截：强行拦下来，运营会去别处改图再传，问题只是被藏起来。
 */
export function coverRatioHint(
  width: number | null,
  height: number | null,
): { ok: boolean; ratio: string; hint: string } {
  if (!width || !height) {
    return { ok: false, ratio: '未知', hint: '读不出尺寸，无法确认微信是否会裁切' };
  }
  const ratio = width / height;
  const text = `${width}×${height}`;
  if (Math.abs(ratio - 2.35) <= 0.12) {
    return { ok: true, ratio: `${ratio.toFixed(2)}:1`, hint: `${text}，接近 2.35:1，符合公众号封面` };
  }
  if (Math.abs(ratio - 1) <= 0.06) {
    return { ok: true, ratio: '1:1', hint: `${text}，正方形可直接用，但列表头图会被裁成横幅` };
  }
  if (ratio > 2.6) {
    return { ok: false, ratio: `${ratio.toFixed(2)}:1`, hint: `${text} 过宽，微信会左右裁切` };
  }
  if (ratio < 0.9) {
    return { ok: false, ratio: `${ratio.toFixed(2)}:1`, hint: `${text} 竖图，微信会大幅裁切` };
  }
  return {
    ok: false,
    ratio: `${ratio.toFixed(2)}:1`,
    hint: `${text} 不是 2.35:1，微信会居中裁切，注意别把重点放边上`,
  };
}
