# 微信小程序打包脚本

> 📘 **完整出码手册（前置条件 / 依赖隔离 / 排错）见
> [docs/miniprogram/release-runbook.md](../../../docs/miniprogram/release-runbook.md)。**
> 本文件只讲脚本本身的用法；IP 白名单、`MINIPROGRAM_CI_PATH` 为什么必须配、报错怎么查都在手册里。

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

### 3.（可选）开启开发者工具服务端口

**CI 出码不需要它** —— `miniprogram-ci` 直连微信后台，不开开发者工具也能编译上传。
仅在需要用图形界面调试时才开：设置 → 安全设置 → 服务端口。

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

- **不需要**打开微信开发者工具，也不需要它登录（见 §配置 3）
- 上传前请先更新 `package.json` 中的版本号（微信要求递增，重复会被拒）
- 确保已在微信公众平台配置项目成员 / 体验成员
- **在固定出口 IP 的执行机上出码**，不要在本机出（本机公网 IP 会变，白名单维护不动）
- 二维码落在 `.ci-output/preview-qr.png`（已 gitignore），**有时效**，过期重跑
