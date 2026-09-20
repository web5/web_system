/**
 * 预设图形类型和绘制函数
 * 从 draw.constants 抽取到此，消除 CanvasEngine 对 pages/draw 的反向依赖
 */

/** 预设图形类型 */
export type ShapeType = 'circle' | 'rect' | 'triangle' | 'star5' | 'heart';

/** 预设形状的 Canvas 2D 绘制函数 (fill) */
export const SHAPE_DRAWERS: Record<string, (ctx: any, size: number) => void> = {
  circle(ctx, size) {
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
  },
  rect(ctx, size) {
    ctx.fillRect(-size / 2, -size / 2, size, size);
  },
  triangle(ctx, size) {
    const r = size / 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.866, r * 0.5);
    ctx.lineTo(-r * 0.866, r * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  star5(ctx, size) {
    const r = size / 2;
    const innerR = r * 0.38;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outerAngle = (Math.PI / 2 * -1) + (2 * Math.PI * i / 5);
      const innerAngle = outerAngle + (Math.PI / 5);
      if (i === 0) ctx.moveTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      else ctx.lineTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      ctx.lineTo(innerR * Math.cos(innerAngle), innerR * Math.sin(innerAngle));
    }
    ctx.closePath();
    ctx.fill();
  },
  heart(ctx, size) {
    const s = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, s * 1.5);
    ctx.bezierCurveTo(-s * 2, -s * 0.5, -s * 1.5, -s * 2.5, 0, -s * 1.5);
    ctx.bezierCurveTo(s * 1.5, -s * 2.5, s * 2, -s * 0.5, 0, s * 1.5);
    ctx.fill();
  },

  // ===== 动物 & 植物 =====
  cat(ctx, size) {
    const s = size * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 1.6, -s * 0.5);
    ctx.lineTo(-s * 1.1, -s * 3.2);
    ctx.lineTo(-s * 0.3, -s * 0.8);
    ctx.quadraticCurveTo(0, -s * 3.5, s * 0.3, -s * 0.8);
    ctx.lineTo(s * 1.1, -s * 3.2);
    ctx.lineTo(s * 1.6, -s * 0.5);
    ctx.quadraticCurveTo(s * 2.2, s * 0.2, s * 1.8, s * 1.2);
    ctx.quadraticCurveTo(s * 2.4, s * 2.0, s * 2.0, s * 3.5);
    ctx.quadraticCurveTo(s * 1.0, s * 4.0, 0, s * 4.0);
    ctx.quadraticCurveTo(-s * 1.0, s * 4.0, -s * 2.0, s * 3.5);
    ctx.quadraticCurveTo(-s * 2.4, s * 2.0, -s * 1.8, s * 1.2);
    ctx.quadraticCurveTo(-s * 2.2, s * 0.2, -s * 1.6, -s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 1.8, s * 2.5);
    ctx.quadraticCurveTo(s * 3.5, s * 1.5, s * 3.0, -s * 0.5);
    ctx.lineWidth = s * 0.6;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  dog(ctx, size) {
    const s = size * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 1.5, -s * 1.0);
    ctx.quadraticCurveTo(-s * 3.0, -s * 0.2, -s * 2.8, s * 1.5);
    ctx.quadraticCurveTo(-s * 2.5, s * 2.0, -s * 1.6, s * 0.8);
    ctx.quadraticCurveTo(-s * 1.8, -s * 3.0, 0, -s * 3.2);
    ctx.quadraticCurveTo(s * 1.8, -s * 3.0, s * 1.6, s * 0.8);
    ctx.quadraticCurveTo(s * 2.5, s * 2.0, s * 2.8, s * 1.5);
    ctx.quadraticCurveTo(s * 3.0, -s * 0.2, s * 1.5, -s * 1.0);
    ctx.quadraticCurveTo(s * 1.0, -s * 3.2, -s * 0.5, -s * 3.0);
    ctx.closePath();
    ctx.fill();
  },

  rabbit(ctx, size) {
    const s = size * 0.1;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.5, s * 1.8, s * 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-s * 0.8, -s * 0.5, s * 0.7, s * 2.8, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s * 0.8, -s * 0.5, s * 0.7, s * 2.8, 0.3, 0, Math.PI * 2);
    ctx.fill();
  },

  // ===== 植物 =====
  tree(ctx, size) {
    const s = size * 0.1;
    ctx.fillStyle = ctx.strokeStyle;
    // 树干
    ctx.fillRect(-s * 0.3, -s * 0.5, s * 0.6, s * 3.0);
    // 树冠（3层三角形）
    ctx.beginPath();
    ctx.moveTo(0, -s * 3.5);
    ctx.lineTo(-s * 2.5, -s * 0.5);
    ctx.lineTo(s * 2.5, -s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 4.5);
    ctx.lineTo(-s * 2.0, -s * 1.5);
    ctx.lineTo(s * 2.0, -s * 1.5);
    ctx.closePath();
    ctx.fill();
  },

  flower(ctx, size) {
    const s = size * 0.05;
    // 5个花瓣
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(
        0, -s * 2.5,
        s * 1.5, s * 2.5,
        (i * 72) * Math.PI / 180,
        0, Math.PI * 2,
      );
      ctx.fill();
    }
    // 花心
    ctx.save();
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // ===== 符号 & 箭头 =====
  star(ctx, size) {
    const r = size / 2;
    const innerR = r * 0.38;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outerAngle = (Math.PI / 2 * -1) + (2 * Math.PI * i / 5);
      const innerAngle = outerAngle + (Math.PI / 5);
      if (i === 0) ctx.moveTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      else ctx.lineTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      ctx.lineTo(innerR * Math.cos(innerAngle), innerR * Math.sin(innerAngle));
    }
    ctx.closePath();
    ctx.fill();
  },

  arrow_right(ctx, size) {
    const s = size * 0.15;
    ctx.beginPath();
    ctx.moveTo(-s * 2.5, -s * 1.5);
    ctx.lineTo(s * 1.5, 0);
    ctx.lineTo(-s * 2.5, s * 1.5);
    ctx.closePath();
    ctx.fill();
  },

  check(ctx, size) {
    const s = size * 0.08;
    ctx.beginPath();
    ctx.moveTo(-s * 2, s * 1);
    ctx.lineTo(-s * 0.5, s * 2.5);
    ctx.lineTo(s * 2.5, -s * 1.5);
    ctx.lineWidth = s * 0.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  },

  // ===== 用户界面 =====
  button(ctx, size) {
    const s = size * 0.12;
    ctx.roundRect(-s * 2.5, -s * 1.5, s * 5, s * 3, s * 0.8);
    ctx.fill();
  },

  input_field(ctx, size) {
    const s = size * 0.12;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = s * 0.2;
    ctx.roundRect(-s * 2.5, -s * 1.5, s * 5, s * 3, s * 0.6);
    ctx.stroke();
  },
};
