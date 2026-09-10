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
  /** 图层内容的世界坐标偏移量（用于拖动移动图层） */
  offsetX: number;
  offsetY: number;
  /** 图层内容的缩放比（张小龙：素材像真实贴纸，可缩放） */
  scale: number;
  /** 图层内容的旋转角度（弧度） */
  rotation: number;
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
    offsetX: 0,
    offsetY: 0,
    scale: 1,           // 张小龙：素材像真实贴纸，可缩放
    rotation: 0,         // 张小龙：素材像真实贴纸，可旋转
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
  baseImageData?: any,
  /** 缩放/平移只作用于当前活动图层 */
  activeLayerIndex = 0,
) {
  const cw = targetCtx.canvas.width;
  const ch = targetCtx.canvas.height;
  targetCtx.clearRect(0, 0, cw, ch);

  // 填充背景
  if (backgroundColor) {
    targetCtx.fillStyle = backgroundColor;
    targetCtx.fillRect(0, 0, cw, ch);
  } else {
    drawCheckerboard(targetCtx, cw, ch);
  }

  // 绘制 undo/redo 基层
  if (baseImageData) {
    try {
      targetCtx.putImageData(baseImageData, 0, 0);
    } catch (_) { /* ignore */ }
  }

  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'high';

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer.visible) continue;
    targetCtx.save();

    // 只有活动图层应用视口变换（缩放/平移只影响当前操作图层）
    if (i === activeLayerIndex) {
      targetCtx.translate(panX, panY);
      targetCtx.scale(scale, scale);
    }

    targetCtx.translate(layer.offsetX || 0, layer.offsetY || 0);
    // 张小龙：素材像真实贴纸，可缩放/旋转
    if (layer.scale && layer.scale !== 1) {
      targetCtx.scale(layer.scale, layer.scale);
    }
    if (layer.rotation && layer.rotation !== 0) {
      const cx = width / 2, cy = height / 2;
      targetCtx.translate(cx, cy);
      targetCtx.rotate(layer.rotation);
      targetCtx.translate(-cx, -cy);
    }
    targetCtx.globalAlpha = layer.opacity;
    targetCtx.drawImage(
      layer.canvas,
      0, 0, layer.canvas.width, layer.canvas.height,
      0, 0, width, height,
    );
    targetCtx.restore();
  }
  targetCtx.globalAlpha = 1;
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
