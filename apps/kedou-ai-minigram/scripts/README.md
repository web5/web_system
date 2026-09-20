# 微信小程序打包脚本

## 安装依赖

```bash
npm install
```

## 配置

### 1. 设置 AppID

在 `scripts/preview.js` 和 `scripts/upload.js` 中，将 `your-appid` 替换为你的小程序 AppID：

```javascript
const config = {
  appid: 'wx1234567890abcdef', // 替换这里
  ...
};
```

### 2. 获取私钥

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 进入「开发」→「开发管理」→「开发设置」
3. 找到「小程序代码上传」部分
4. 点击「生成密钥」下载私钥
5. 将私钥文件保存到项目根目录，命名为 `private.key`

### 3. 开启开发者工具服务端口

1. 打开微信开发者工具
2. 点击「设置」→「安全设置」
3. 开启「服务端口」

## 使用

### 预览

```bash
npm run preview
```

预览成功后会生成 `preview-qrcode.png` 二维码，用微信扫描即可预览。

### 上传

```bash
npm run upload
```

上传成功后会输出版本号，然后到微信公众平台提交审核。

## 注意事项

- 首次使用需要确保微信开发者工具已登录
- 上传前请先更新 `package.json` 中的版本号
- 确保已在微信公众平台配置项目成员
