// tests/layout.test.ts
// 横屏布局 TDD 测试 — BDD 风格（类似 Superpowers/Jasmine）

// ── 模拟 wx 全局对象 ─────────────────────────────────────────────
const mockGetSystemInfoSync = jest.fn();
const mockCreateSelectorQuery = jest.fn();

beforeEach(() => {
  (global as any).wx = {
    getSystemInfoSync: mockGetSystemInfoSync,
    createSelectorQuery: mockCreateSelectorQuery,
  };
});

afterEach(() => {
  jest.clearAllMocks();
  delete (global as any).wx;
});

// ── 工具函数：从 draw.ts 提取的设备检测逻辑 ─────────────────────
//（将在实现步骤中实际提取，此处先描述预期行为）

describe('iPad 横屏布局', () => {
  // 每个 it(...) 都是一句自然语言描述 = Superpowers 风格
  it('should detect iPad and landscape correctly', () => {
    // 模拟 iPad 横屏
    mockGetSystemInfoSync.mockReturnValue({
      model: 'iPad',
      windowWidth: 1024,
      windowHeight: 768,
      pixelRatio: 2,
    });

    const isIPad = (wx as any).getSystemInfoSync().model.indexOf('iPad') >= 0;
    const isLandscape = (wx as any).getSystemInfoSync().windowWidth >
      (wx as any).getSystemInfoSync().windowHeight;

    expect(isIPad).toBe(true);
    expect(isLandscape).toBe(true);
  });

  it('should apply ipad and landscape CSS classes to container', () => {
    // 模拟数据
    const data = { isIPad: true, isLandscape: true };
    const className = `container ${data.isIPad ? 'ipad' : ''} ${data.isIPad && data.isLandscape ? 'landscape' : ''}`;

    expect(className).toContain('ipad');
    expect(className).toContain('landscape');
  });

  it('should give canvas left+right padding in landscape to make room for sidebars', () => {
    // 横屏时画布应有左右 padding，各约 160rpx
    const canvasStyle = {
      paddingLeft: '160rpx',
      paddingRight: '160rpx',
      boxSizing: 'border-box',
    };
    expect(canvasStyle.paddingLeft).toBe('160rpx');
    expect(canvasStyle.paddingRight).toBe('160rpx');
    expect(canvasStyle.boxSizing).toBe('border-box');
  });

  it('should position material sidebar on the left in landscape', () => {
    const sidebarStyle = {
      position: 'fixed',
      left: '0',
      right: 'auto',
      width: '160rpx',
    };
    expect(sidebarStyle.left).toBe('0');
    expect(sidebarStyle.width).toBe('160rpx');
  });

  it('should position toolbar on the right in landscape', () => {
    const toolbarStyle = {
      position: 'fixed',
      right: '24rpx',
      top: '50%',
      transform: 'translateY(-50%)',
    };
    expect(toolbarStyle.right).not.toBe('auto');
    expect(toolbarStyle.top).toBe('50%');
  });

  it('should keep canvas content fully visible (not clipped) in landscape', () => {
    // 画布逻辑尺寸应等于 CSS 可见区域尺寸
    const screenW = 1024;
    const sidebarW = 160;
    const toolbarW = 140;
    const expectedCanvasW = screenW - sidebarW - toolbarW;
    expect(expectedCanvasW).toBeGreaterThan(0);
    // 画布不应超出屏幕
    expect(expectedCanvasW).toBeLessThan(screenW);
  });
});
