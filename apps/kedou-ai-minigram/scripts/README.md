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

## 本地测试（draw.test.js · E2E）

`tests/draw.test.js` 是依赖微信开发者工具 CLI 的 E2E 套件（会拉起 GUI 进程）。本机跑法：

```bash
cd apps/kedou-ai-minigram
npx jest tests/draw.test.js --config tests/jest.config.js --runInBand
```

若出现 **用例全 PASS 但 Jest 进程卡住不退出**（open handles），加 `--forceExit` 即可正常退出（实测 ~5.8s）：

```bash
npx jest tests/draw.test.js --config tests/jest.config.js --runInBand --forceExit
```

- 根因：第三方库 `miniprogram-automator` 的 `Launcher.launch()` 在 `checkVersion()` 抛错时，spawn 的 CLI 子进程无回收路径，属已知句柄泄漏。
- **CI 上无微信开发者工具，不存在此问题**，因此无需、也不应全局加 `--forceExit`。
- 台账 **9200** 已按「已知取舍」关闭：这里仅作本机开发体验注明，**不改 `package.json` 的 `test` 脚本**（避免掩盖 CI 里真实的 open-handle 泄漏）。

## 注意事项

- **不需要**打开微信开发者工具，也不需要它登录（见 §配置 3）
- 上传前请先更新 `package.json` 中的版本号（微信要求递增，重复会被拒）
- 确保已在微信公众平台配置项目成员 / 体验成员
- **在固定出口 IP 的执行机上出码**，不要在本机出（本机公网 IP 会变，白名单维护不动）
- 二维码落在 `.ci-output/preview-qr.png`（已 gitignore），**有时效**，过期重跑
