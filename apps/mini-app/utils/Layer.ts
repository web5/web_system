/**
 * 图层管理
 */
export interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  canvas: any;          // OffscreenCanvas
  ctx: any;             // 2D context
}

let layerCounter = 0;

export function createLayer(engine: any): LayerData {
  layerCounter++;
  const id = `layer_${Date.now()}_${layerCounter}`;
  const dpr = engine.dpr || 1;
  const offCanvas = wx.createOffscreenCanvas({
    type: '2d',
    width: engine.width * dpr,
    height: engine.height * dpr,
  });
  const ctx = offCanvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return {
    id,
    name: `图层 ${layerCounter}`,
    visible: true,
    opacity: 1,
    canvas: offCanvas,
    ctx,
  };
}

export function compositeLayers(
  layers: LayerData[],
  targetCtx: any,
  width: number,
  height: number,
  backgroundColor?: string,
  panX = 0,
  panY = 0,
  scale = 1,
) {
  const cw = targetCtx.canvas.width;
  const ch = targetCtx.canvas.height;
  targetCtx.clearRect(0, 0, cw, ch);

  // 填充背景：透明时画棋盘格，否则填充纯色
  if (backgroundColor) {
    targetCtx.fillStyle = backgroundColor;
    targetCtx.fillRect(0, 0, cw, ch);
  } else {
    // 透明度提示棋盘格
    drawCheckerboard(targetCtx, cw, ch);
  }

  targetCtx.save();
  // 应用视口变换
  targetCtx.translate(panX, panY);
  targetCtx.scale(scale, scale);
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'high';
  for (const layer of layers) {
    if (!layer.visible) continue;
    targetCtx.globalAlpha = layer.opacity;
    targetCtx.drawImage(
      layer.canvas,
      0, 0, layer.canvas.width, layer.canvas.height,
      0, 0, width, height,
    );
  }
  targetCtx.globalAlpha = 1;
  targetCtx.restore();
}

/** 画棋盘格（指示透明区域），不限于绘图可见区域，铺满像素 canvas */
function drawCheckerboard(ctx: any, cw: number, ch: number) {
  const size = 12; // 每个格子的像素大小
  const cols = Math.ceil(cw / size);
  const rows = Math.ceil(ch / size);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#e8e8e8' : '#ffffff';
      ctx.fillRect(c * size, r * size, size, size);
    }
  }
}
