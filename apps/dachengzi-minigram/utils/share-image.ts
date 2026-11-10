/**
 * 分享卡生成（公共 util）—— 从翻译结果页 buildShareImage 迁出，供对话页「生成分享卡」复用。
 *
 * 形态：离屏 canvas（type=2d）绘制 5:4 白底译文图，无 logo / 无品牌色 ——
 * 卡片观感接近一条纯文本消息（小程序名灰字为微信强制，无法去除）。
 *
 * 调用方需在自己的 WXML 里放一个离屏 canvas 节点（默认 id=share-canvas），
 * 本 util 通过 wx.createSelectorQuery()（页面作用域）取该节点并绘制，产出临时文件路径。
 */
export function buildShareImage(text: string, canvasId = 'share-canvas'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const t = String(text || '').trim();
    if (!t) {
      reject(new Error('没有可生成的译文'));
      return;
    }
    try {
      const W = 500;
      const H = 400; // 5:4
      const query = wx.createSelectorQuery();
      query
        .select(`#${canvasId}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) {
            reject(new Error('分享画布不可用'));
            return;
          }
          const canvas = item.node as WechatMiniprogram.Canvas;
          const ctx = canvas.getContext('2d');
          const dpr = 2;
          canvas.width = W * dpr;
          canvas.height = H * dpr;
          ctx.scale(dpr, dpr);

          // 白底
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, W, H);

          // 译文：自动换行 + 截断（缩略图只求可读，完整内容靠预览）
          ctx.fillStyle = '#10131A';
          ctx.font = '500 30px -apple-system, PingFang SC, sans-serif';
          const maxWidth = W - 80;
          let y = 90;
          let line = '';
          const chars = Array.from(t);
          for (let i = 0; i < chars.length && y < H - 50; i++) {
            const test = line + chars[i];
            if (ctx.measureText(test).width > maxWidth) {
              ctx.fillText(line, 40, y);
              y += 44;
              line = chars[i];
            } else {
              line = test;
            }
          }
          if (line && y < H - 50) ctx.fillText(line, 40, y);
          else if (y >= H - 50 && line) ctx.fillText('…', 40, y - 44 < 90 ? 90 : y);

          wx.canvasToTempFilePath({
            canvas,
            success: (r) => resolve(r.tempFilePath),
            fail: () => reject(new Error('分享图导出失败')),
          });
        });
    } catch (e) {
      reject(e as Error);
    }
  });
}
