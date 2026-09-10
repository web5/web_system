/**
 * CanvasEngine 视口变换辅助函数
 */

/** 视口变换所需的最小状态接口 */
interface ViewportState {
  panX: number;
  panY: number;
  scale: number;
}

/** 屏幕坐标 → 世界坐标 */
export function screenToWorld(state: ViewportState, sx: number, sy: number) {
  return {
    x: (sx - state.panX) / state.scale,
    y: (sy - state.panY) / state.scale,
  };
}

/** 位移画布 */
export function applyPan(state: ViewportState, dx: number, dy: number) {
  state.panX += dx;
  state.panY += dy;
}

/** 设置缩放（以任意点为中心），返回新的 scale 但不触发重绘 */
export function applyZoomAt(
  state: ViewportState,
  scaleFactor: number,
  cx: number,
  cy: number,
) {
  const newScale = Math.max(0.3, Math.min(5, state.scale * scaleFactor));
  state.panX = cx - (cx - state.panX) * (newScale / state.scale);
  state.panY = cy - (cy - state.panY) * (newScale / state.scale);
  state.scale = newScale;
}

/** 重置视口变换到初始状态 */
export function resetTransform(state: ViewportState) {
  state.panX = 0;
  state.panY = 0;
  state.scale = 1;
}
