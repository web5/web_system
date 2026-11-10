# 微信小程序打包脚本

> 📘 **完整出码手册（前置条件 / 依赖隔离 / 排错）见
> [docs/miniprogram/release-runbook.md](../../../docs/miniprogram/release-runbook.md)。**
> 本文件只讲脚本本身的用法；IP 白名单、`MINIPROGRAM_CI_PATH` 为什么必须配、报错怎么查都在手册里。

## 安装依赖

```bash
npm install
```

## 配置

### 1. AppID

脚本自动读 `project.config.json` 的 `appid`，**无需手工填**。
（历史版本曾在脚本里硬编码 `your-appid` 占位，现已移除，不要再改回去。）

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

### 一键发布（推荐）

把「出码 + 推企业微信」串成一条命令：

```bash
# 出预览码并推送到企业微信（默认推给授权人本人）
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- preview

# 指定直达页 / 指定会话 / 只出码不推送
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- preview --page pages/chat/index/index --to <会话名>
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- preview --no-push

# 上传体验版到微信后台（--notify 时推一条通知）
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- upload --notify
```

推送链路：`wecom-cli media upload`（上传二维码图）→ `wecom-cli message aibot send`（发说明 + 图片）。
目标会话按名字匹配，缺省发第一个单聊（授权人本人）。

### 预览（仅出码，不推送）

```bash
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run preview
```

预览成功后生成 `.ci-output/preview-qr.png`（二维码原图）与 `.ci-output/preview-qr.html`（自包含可扫码卡片，带倒计时），用微信扫码即可预览。

### 上传（仅上传，不推送）

```bash
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run upload
```

上传成功后会输出版本号，然后到微信公众平台提交审核。

## 注意事项

- **不需要**打开微信开发者工具，也不需要它登录（见 §配置 3）
- 上传前请先更新 `package.json` 中的版本号（微信要求递增，重复会被拒）
- 确保已在微信公众平台配置项目成员 / 体验成员
- **在固定出口 IP 的执行机上出码**，不要在本机出（本机公网 IP 会变，白名单维护不动）
- 二维码落在 `.ci-output/preview-qr.png`（已 gitignore），**有时效**，过期重跑
