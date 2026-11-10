# 微信小程序打包脚本

> 📘 **完整出码手册（前置条件 / 依赖隔离 / 排错）见
> [docs/miniprogram/release-runbook.md](../../../docs/miniprogram/release-runbook.md)。**
> 本文件只讲脚本本身的用法；`WECHAT_DEVTOOLS_CLI` 怎么设、`MINIPROGRAM_CI_PATH` 为什么必须配、
> IP 白名单什么时候需要、报错怎么查都在手册里。

## 安装依赖

```bash
npm install
```

## 配置

### 1. AppID

脚本自动读 `project.config.json` 的 `appid`，**无需手工填**。
（历史版本曾在脚本里硬编码 `your-appid` 占位，现已移除，不要再改回去。）

### 2. 两种出码模式，按需选

| 模式 | 参数 | 出码通道 | 前置条件 | 是否要 IP 白名单 |
|---|---|---|---|---|
| **cli（默认）** | 默认 / `--mode cli` | 微信开发者工具 CLI，走登录态 | 开发者工具已登录 | **不需要** |
| ci | `--mode ci` | `miniprogram-ci` 直连微信后台 | `private.key` + 固定出口 IP | 需要 |

**日常开发、本机出码、免 IP 白名单，一律用 cli 模式（默认）。**
`--mode ci` 只保留给「执行机固定出口 IP」这种已经配好白名单的场景。

### 3. 设置开发者工具 CLI 路径（cli 模式）

cli 模式需要找到微信开发者工具的 CLI 二进制，脚本**不硬编码路径**，按以下顺序解析：

1. 环境变量 `WECHAT_DEVTOOLS_CLI`（优先）
2. `PATH` 里的 `cli` 命令（`which cli`）

若 `cli` 不在 PATH（macOS GUI 应用默认不在），把它指给脚本：

```bash
# 例：把开发者工具安装目录下的 cli 二进制指给脚本（路径以本机为准，别写进仓库）
export WECHAT_DEVTOOLS_CLI="<微信开发者工具安装目录>/cli"

# 验证登录态（返回 {"login":true} 才算就绪）
cli islogin
# 或
"$WECHAT_DEVTOOLS_CLI" islogin
```

> 也可把开发者工具 CLI 软链/加进 PATH 后直接 `which cli` 定位，跳过 `WECHAT_DEVTOOLS_CLI`。

### 4. 获取私钥（仅 ci 模式需要）

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 进入「开发」→「开发管理」→「开发设置」
3. 找到「小程序代码上传」部分
4. 点击「生成密钥」下载私钥
5. 将私钥文件保存到项目根目录，命名为 `private.key`

cli 模式走登录态，**不需要** `private.key`。

## 使用

### 一键发布（推荐）

把「出码 + 推企业微信」串成一条命令：

```bash
# 出预览码并推送到企业微信（默认 cli 模式，免白名单，推给第一个群，如公司群）
npm run publish -- preview

# 指定会话 / 只出码不推送
npm run publish -- preview --to <会话名>
npm run publish -- preview --no-push

# 上传开发版本（默认 cli 模式），需后台手动设为体验版；--notify 时推一条通知
npm run publish -- upload --notify

# 走 miniprogram-ci（执行机固定 IP 已配白名单时）
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- preview --mode ci
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- upload --mode ci
```

推送链路：`wecom-cli media upload`（上传二维码图）→ `wecom-cli message aibot send`（发说明 + 图片）。
目标会话按名字匹配，缺省发第一个群（如公司群），`--to <会话名>` 指定；无群时回退第一个单聊。

### 预览（仅出码，不推送）

```bash
# cli 模式（默认）
npm run preview   # 等价于 publish preview --no-push 的 cli 路径（见下）

# ci 模式
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules node scripts/preview.js
```

预览成功后二维码落在 `.ci-output/cli-preview-qr.png`（cli）或 `.ci-output/preview-qr.png`（ci），
用微信扫码即可预览。

### 上传（仅上传，不推送）

```bash
# cli 模式（默认）
npm run publish -- upload

# ci 模式
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules node scripts/upload.js
```

上传成功后会输出版本号，然后到微信公众平台提交审核。

## 注意事项

- **cli 模式**需要微信开发者工具已登录（`cli islogin` → `{"login":true}`），**但不需要 IP 白名单**。
- **ci 模式**才需要 `private.key` + 固定出口 IP 白名单（本机公网 IP 会变，白名单维护不动）。
- 上传前请先更新 `package.json` 中的版本号（微信要求递增，重复会被拒）。
- 二维码落在 `.ci-output/`（已 gitignore），**有时效**（约 25 分钟），过期重跑。
- cli 出码的 `--qr-output` 必须是**项目内**绝对路径；写 `/tmp/...` 会报「二维码输出路径无效或不存在 (code 17)」。
- cli 出码产出的 `.png` 实际内容为 JPEG（470×470），后续推图不受影响（media upload 按内容识别）。
- cli 出码不生成 meta 信息，说明文案由 `publish.js` 自拼为一行「小程序开发版预览二维码 v<版本> · 有效期至 <时间>」（版本取 `package.json.version`、25 分钟有效期）。
