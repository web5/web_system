// tests/setup.js
// 微信小程序自动化测试环境设置

const automator = require('miniprogram-automator');

module.exports = {
  // 测试前启动工具
  async setup() {
    // 启动微信开发者工具（需要提前配置 CLI 路径）
    const miniProgram = await automator.launch({
      cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli', // macOS 默认路径
      projectPath: process.cwd(),
    });

    return miniProgram;
  },

  // 测试后关闭
  async teardown(miniProgram) {
    if (miniProgram) {
      await miniProgram.close();
    }
  },
};
