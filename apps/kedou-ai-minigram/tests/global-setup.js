// tests/global-setup.js
// 全局测试环境设置

const automator = require('miniprogram-automator');

module.exports = async () => {
  // 可以在这里做一些全局初始化
  console.log('开始启动微信开发者工具...');

  // 检查开发者工具是否安装
  const fs = require('fs');
  const cliPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

  if (!fs.existsSync(cliPath)) {
    console.warn('警告：未找到微信开发者工具 CLI，请确认安装路径');
    console.warn('默认路径：', cliPath);
  }
};
