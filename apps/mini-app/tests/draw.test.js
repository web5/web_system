// tests/draw.test.js
// 画板页面端到端自动化测试

const { setup, teardown } = require('./setup');

describe('画板功能自动化测试', () => {
  let miniProgram;
  let page;

  // 每个测试套件前启动
  beforeAll(async () => {
    miniProgram = await setup();
  });

  // 每个测试套件后关闭
  afterAll(async () => {
    await teardown(miniProgram);
  });

  // 每个测试前跳转到画板页
  beforeEach(async () => {
    // 跳转到画板页面
    await miniProgram.reLaunch('/pages/draw/draw');
    page = await miniProgram.currentPage();
  });

  // ==================== 基础功能测试 ====================

  test('1. 画板页面正常加载', async () => {
    const canvas = await page.$('#drawCanvas');
    expect(canvas).not.toBeNull();
  });

  test('2. 工具按钮可以切换笔刷', async () => {
    // 点击工具按钮打开菜单
    const toolBtn = await page.$('[data-test="tool-btn"]');
    expect(toolBtn).not.toBeNull();
    
    if (toolBtn) {
      await toolBtn.tap();
    }

    await page.waitFor(300);

    // 验证菜单出现
    const data = await page.data();
    expect(data.showBrushMenu).toBe(true);
  });

  test('3. 颜色选择器功能', async () => {
    // 打开颜色面板
    const colorBtn = await page.$('[data-test="color-btn"]');
    expect(colorBtn).not.toBeNull();

    if (colorBtn) {
      await colorBtn.tap();
    }

    await page.waitFor(300);

    // 验证面板出现
    const data = await page.data();
    expect(data.showColorPanel).toBe(true);
  });

  test('4. 撤销/重做功能', async () => {
    const data = await page.data();
    
    // 检查初始状态
    expect(data.canUndo).toBe(false);
    expect(data.canRedo).toBe(false);
  });

  test('5. 素材库打开/关闭', async () => {
    // 打开素材栏
    await page.callMethod('toggleMaterialBar');
    
    let data = await page.data();
    expect(data.showMaterialBar).toBe(true);

    // 关闭素材栏
    await page.callMethod('toggleMaterialBar');
    
    data = await page.data();
    expect(data.showMaterialBar).toBe(false);
  });

  test('6. 画布清空功能', async () => {
    // 调用清空方法
    await page.callMethod('onClearCanvas');
    
    const data = await page.data();
    expect(data.showMaterialBar).toBe(true); // 清空后显示素材栏
  });

  // ==================== 设备旋转测试 ====================

  test('7. 横竖屏切换 - 画布尺寸更新', async () => {
    const initialData = await page.data();
    const initialWidth = initialData.canvasWidth;

    // 模拟横屏
    await miniProgram.changeWindowSize(667, 375); // 横屏尺寸
    await page.waitFor(300);

    const newData = await page.data();
    expect(newData.canvasWidth).not.toBe(initialWidth);
  });

  // ==================== 图层功能测试 ====================

  test('8. 图层添加和切换', async () => {
    await page.callMethod('onAddLayer');
    
    const data = await page.data();
    expect(data.layers.length).toBeGreaterThan(1);
  });

  test('9. 图层可见性切换', async () => {
    await page.callMethod('onToggleLayerVisible', { detail: { index: 0 } });
    
    const data = await page.data();
    expect(data.layers[0].visible).toBe(false);
  });
});
