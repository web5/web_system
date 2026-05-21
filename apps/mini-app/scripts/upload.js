/**
 * 微信小程序上传脚本
 * 使用方法: npm run upload
 * 
 * 前提条件:
 * 1. 安装微信开发者工具
 * 2. 在微信开发者工具中登录并开启服务端口
 * 3. 在项目根目录创建 private.key 私钥文件（从微信公众平台下载）
 * 4. 小程序已发布过正式版本
 */

const { upload, getVersion } = require('miniprogram-ci');
const path = require('path');
const fs = require('fs');

// 读取配置
const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf-8'));
const privateKeyPath = path.join(__dirname, '../private.key');
const privateKey = fs.existsSync(privateKeyPath) ? fs.readFileSync(privateKeyPath) : null;

async function uploadApp() {
  const projectPath = path.join(__dirname, '..');
  
  if (!privateKey) {
    console.error('❌ 缺少私钥文件，请将私钥保存为 private.key');
    process.exit(1);
  }

  // 从 package.json 读取版本号
  const packageJson = require('../package.json');
  const version = packageJson.version || '1.0.0';
  
  const config = {
    appid: projectConfig.appid,
    type: 'miniProgram',
    projectPath,
    privateKey,
    privateKeyPath,
    ignores: ['node_modules/**/*'],
  };

  try {
    console.log('🚀 开始上传...');
    console.log(`📦 版本号: ${version}`);
    
    const uploadResult = await upload({
      ...config,
      version,
      desc: `上传时间: ${new Date().toLocaleString('zh-CN')}`,
      setting: {
        urlCheck: false,
        es6: true,
        enhance: true,
        postcss: true,
        minified: true,
      },
    });

    console.log('✅ 上传成功!');
    console.log(`🔢 上传后版本: ${uploadResult.version}`);
    console.log('💡 请到微信公众平台提交审核');
  } catch (error) {
    console.error('❌ 上传失败:', error.message);
    if (error.message.includes('private key')) {
      console.log('\n💡 请确保:');
      console.log('   1. 已在项目根目录创建 private.key 文件');
      console.log('   2. 私钥文件内容正确');
      console.log('   3. 已在微信公众平台配置项目成员');
    }
    process.exit(1);
  }
}

uploadApp();
