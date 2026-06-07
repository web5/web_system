/**
 * CanvasEngine 预设图形绘制
 */

import type { ShapeType } from './shapes';

/**
 * 在给定的 Canvas 2D 上下文上绘制预设图形（不负责图层合成/快照）
 */
export function drawShapeOnContext(
  ctx: any,
  type: ShapeType,
  cx: number,
  cy: number,
  size: number,
  color: string,
  strokeWidth: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth * 0.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.translate(cx, cy);

  const r = size / 2;

  switch (type) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      break;

    case 'rect':
      ctx.beginPath();
      ctx.rect(-r, -r, size, size);
      ctx.stroke();
      break;

    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 1.2, r * 0.7);
      ctx.lineTo(-r * 1.2, r * 0.7);
      ctx.closePath();
      ctx.stroke();
      break;

    case 'star5': {
      const outerR = r;
      const innerR = r * 0.38;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerAngle = (i * 2 * Math.PI) / 5 - Math.PI / 2;
        const innerAngle = outerAngle + Math.PI / 5;
        if (i === 0) {
          ctx.moveTo(outerR * Math.cos(outerAngle), outerR * Math.sin(outerAngle));
        } else {
          ctx.lineTo(outerR * Math.cos(outerAngle), outerR * Math.sin(outerAngle));
        }
        ctx.lineTo(innerR * Math.cos(innerAngle), innerR * Math.sin(innerAngle));
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }

    case 'heart': {
      const s = r * 0.8;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.6);
      // 左半心
      ctx.bezierCurveTo(-s, -s * 0.3, -s * 0.5, -s * 1.1, 0, -s * 1.1);
      // 右半心
      ctx.bezierCurveTo(s * 0.5, -s * 1.1, s, -s * 0.3, 0, s * 0.6);
      ctx.closePath();
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}
