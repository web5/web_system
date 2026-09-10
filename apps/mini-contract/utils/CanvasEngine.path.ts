/**
 * CanvasEngine 路径绘制模块
 * 将 beginPath / drawSegment / endPath 抽象为纯函数，
 * 通过 PathState 接口与引擎解耦。
 */
import { catmullRom, type Point } from './catmullRom';

const SPLINE_STEPS = 16;

/** 路径绘制所需的引擎状态 */
export interface PathState {
  pointBuffer: Point[];
  lastDrawnPoint: Point | null;
  getActiveCtx(): any;
  currentSize: number;
  currentBrush: { type: string; color: string; opacity: number };
  markContent(): void;
  compositeToMain(): void;
  saveSnapshot(): void;
}

// ==================== 公开 API ====================

/** 初始化笔刷状态 & 点缓冲，绘制起始点 */
export function beginPath(state: PathState, x: number, y: number) {
  const ctx = state.getActiveCtx();
  if (!ctx) return;

  ctx.save();
  ctx.lineWidth = state.currentSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = state.currentBrush.color;
  ctx.globalAlpha = state.currentBrush.opacity;

  const bt = state.currentBrush.type;
  if (bt === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
  } else if (bt === 'highlighter') {
    ctx.globalCompositeOperation = 'multiply';
  } else {
    ctx.globalCompositeOperation = 'source-over';
  }

  state.pointBuffer = [{ x, y }];
  state.lastDrawnPoint = null;

  // 画起始圆点（避免单点不可见）
  ctx.beginPath();
  ctx.arc(x, y, state.currentSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = state.currentBrush.color;
  ctx.fill();
}

/** 添加新点并通过 Catmull-Rom 样条绘制增量线段 */
export function drawSegment(state: PathState, x: number, y: number) {
  const ctx = state.getActiveCtx();
  if (!ctx) return;

  state.pointBuffer.push({ x, y });
  const pts = state.pointBuffer;
  const n = pts.length;
  if (n < 2) return;

  let drawFrom = skipDrawn(pts, state.lastDrawnPoint);

  if (n === 2 && drawFrom === 0) {
    if (dist(pts[0], pts[1]) < 0.5) return;
    drawLine(ctx, pts[0], pts[1]);
    state.lastDrawnPoint = pts[1];
    state.compositeToMain();
    return;
  }

  for (let i = drawFrom; i < n - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = i + 2 < n ? pts[i + 2] : pts[i + 1];
    drawSpline(ctx, p0, p1, p2, p3);
    state.lastDrawnPoint = p2;
  }

  state.compositeToMain();
}

/** 结束绘制：补全尾段、恢复上下文、合成并保存快照 */
export function endPath(state: PathState, x: number, y: number) {
  const ctx = state.getActiveCtx();
  if (!ctx) return;

  const pts = state.pointBuffer;
  if (pts.length > 0 && state.lastDrawnPoint) {
    drawLine(ctx, pts[pts.length - 1], { x, y });
  }

  ctx.restore();
  state.compositeToMain();
  state.saveSnapshot();

  state.pointBuffer = [];
  state.lastDrawnPoint = null;
  state.markContent();
}

// ==================== 内部辅助 ====================

function drawSpline(ctx: any, p0: Point, p1: Point, p2: Point, p3: Point) {
  if (dist(p1, p2) < 0.5) return;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  for (let i = 1; i <= SPLINE_STEPS; i++) {
    const pt = catmullRom(p0, p1, p2, p3, i / SPLINE_STEPS);
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();
}

function drawLine(ctx: any, from: Point, to: Point) {
  if (dist(from, to) < 0.5) return;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/** 找到首个已绘制点之后的索引，避免重复绘制 */
function skipDrawn(pts: Point[], lastDrawn: Point | null): number {
  if (!lastDrawn) return 0;
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i].x - lastDrawn.x) < 0.01 && Math.abs(pts[i].y - lastDrawn.y) < 0.01) {
      return i;
    }
  }
  return 0;
}

function dist(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}
