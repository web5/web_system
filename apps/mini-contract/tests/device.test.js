// tests/device.test.js
// TDD — 先让测试失败，再实现代码让测试通过
// Superpowers/BDD 风格：每个 it(...) 都是一句自然语言描述

const { detectDevice } = require('../utils/device');

describe('detectDevice', () => {
  beforeEach(() => {
    // Mock wx object
    global.wx = {
      getSystemInfoSync: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.wx;
  });

  it('should detect iPad in landscape mode', () => {
    // 模拟 iPad 横屏
    global.wx.getSystemInfoSync.mockReturnValue({
      model: 'iPad',
      windowWidth: 1024,
      windowHeight: 768,
      pixelRatio: 2,
    });

    const result = detectDevice();

    expect(result.isIPad).toBe(true);
    expect(result.isLandscape).toBe(true);
  });

  it('should detect iPhone in portrait mode', () => {
    // 模拟 iPhone 竖屏
    global.wx.getSystemInfoSync.mockReturnValue({
      model: 'iPhone',
      windowWidth: 375,
      windowHeight: 667,
      pixelRatio: 2,
    });

    const result = detectDevice();

    expect(result.isIPad).toBe(false);
    expect(result.isLandscape).toBe(false);
  });

  it('should return safe defaults when wx API fails', () => {
    // 模拟 wx API 失败
    global.wx.getSystemInfoSync.mockImplementation(() => {
      throw new Error('fail');
    });

    const result = detectDevice();

    expect(result.isIPad).toBe(false);
    expect(result.isLandscape).toBe(false);
  });
});
