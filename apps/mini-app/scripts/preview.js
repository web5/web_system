const { preview, Project } = require('miniprogram-ci');
const path = require('path');
const fs = require('fs');

// 读取配置
const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf-8'));
const privateKeyPath = path.join(__dirname, '../private.key');

if (!fs.existsSync(privateKeyPath)) {
  console.error('❌ 缺少私钥文件 private.key，请从微信公众平台下载并保存到项目根目录');
  process.exit(1);
}
const privateKey = fs.readFileSync(privateKeyPath);

async function previewApp() {
  const projectPath = path.join(__dirname, '..');

  try {
    // 创建 Project 实例
    const project = new Project({
      appid: projectConfig.appid,
      type: 'miniProgram',
      projectPath,
      privateKey,
      privateKeyPath,
      ignores: ['node_modules/**/*'],
    });

    console.log(`🚀 开始预览... appid: ${projectConfig.appid}`);
    
    const previewResult = await preview({
      project,
      version: '1.0.0',
      desc: '预览版本',
      setting: {
        urlCheck: false,
        es6: true,
        enhance: true,
        postcss: true,
        minified: true,
      },
      qrcodeFormat: 'terminal',
    });

    console.log('✅ 预览成功!');
    console.log('📱 请在微信开发者工具中确认');
  } catch (error) {
    console.error('❌ 预览失败:', error.message);
    process.exit(1);
  }
}

previewApp();
