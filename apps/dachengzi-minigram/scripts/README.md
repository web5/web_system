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

### 出码 / 上传 / 推送 + 版本指引（推荐日常入口）

把「出码 + 推企业微信」串成一条命令；脚本只到「上传开发版本」为止，
**不代做**后台版本操作，也不会把上传结果说成体验版 / 正式版已经生效推进：

```bash
# 出预览码并推送到企业微信（默认 cli 模式，免白名单，推给第一个群，如公司群）
npm run publish -- preview

# 指定会话 / 只出码不推送
npm run publish -- preview --to <会话名>
npm run publish -- preview --no-push

# 上传开发版本（默认 cli 模式），脚本不代做后台操作；--notify 时推一条通知
npm run publish -- upload --notify

# 打印「设为体验版」/「提交审核 → 发布正式版」人工分步指引（纯打印、零副作用）
npm run publish -- trial
npm run publish -- release

# 走 miniprogram-ci（执行机固定 IP 已配白名单时）
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- preview --mode ci
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules npm run publish -- upload --mode ci
```

> 🔴 微信不向自建小程序开放「设为体验版 / 提交审核 / 发布」的服务端接口：
> `trial` / `release` 只打印指引，不操作公众平台、不推消息、不改版本状态。
> 详见本文件「体验版 / 正式版（人工版本管理）」小节。

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

上传成功后会输出版本号，并在控制台打印「脚本到此为止」的分步指引。上传产物是公众平台后台
「**开发版本**」列表中的一条，**不是体验版、更不是正式版**。后续两步均为人工操作，脚本不代做：

1. **体验版**（可选，连 dev）：公众平台 → 管理 → 版本管理 → 开发版本 → 选中该版本 →
   「设为体验版」；体验成员在「成员管理 → 体验成员」添加；二维码用系统标准码，勿手填 path。
2. **正式版**（连 prod）：同页「提交审核」（填类目 / 测试账号 / 备注）→ 审核通过 →
   点击「发布」（全量或分阶段）。

分步指引：`npm run publish -- trial`（体验版）/ `npm run publish -- release`（正式版）。

## 体验版 / 正式版（人工版本管理）

🔴 **能力边界**：本脚本只到「上传开发版本」为止。微信不向自建小程序开放
「设为体验版 / 提交审核 / 发布」的服务端接口（开发者工具 CLI 无版本管理子命令，
`miniprogram-ci` 只到上传/预览，开放平台 `wxa/*` 属第三方平台代商家管理模式），
因此以下均为**微信公众平台人工步骤**，脚本不代做、也不会自称已推进到体验版 / 正式版。

### 四档术语（不得混用）

| 档 | 怎么产生 | 连哪个后端 | 有效期 / 谁能扫 |
|---|---|---|---|
| **开发版** | 本地 `cli preview` 出的二维码（`npm run publish -- preview`） | `https://dev.kedouai.com` | 约 25 分钟；开发者本人 + 体验成员 |
| **开发版本** | `cli upload` 传到公众平台后台「开发版本」列表的条目 | —（后台条目） | 长期；需人工设为体验版或提审 |
| **体验版** | 后台**人工**把开发版本设为体验版 | `https://kedouai.com` | 体验版二维码官方口径 7 天；体验成员可扫 |
| **正式版** | 后台**人工**提交审核 → 审核通过 → 发布 | `https://kedouai.com` | 线上用户 |

> 版本与环境切换的真源以本包 `app.ts` 的 `resolveApiBase()` 为准；
> 「开发版连 dev、体验版 / 正式版连 prod」不要混写。

### 体验版设置步骤（`npm run publish -- trial` 打印指引）

- **谁有权**：公众平台管理员 / 有「版本管理」权限的开发者（需先完成成员授权）。
- **入口**：`https://mp.weixin.qq.com/` → 管理 → 版本管理 → 开发版本 → 选中版本 →
  点击「设为体验版」。
- **前置检查**：`package.json` 版本已递增（重复会被拒）；开发版本已上传（否则先 `npm run publish -- upload`）；
  体验成员已添加；`https://kedouai.com` 已在「request 合法域名」登记。
- **体验成员**：公众平台 → 管理 → 成员管理 → 体验成员 → 添加；谁能扫、上限以微信侧为准。
- **二维码**：用系统生成的标准二维码，**勿手填 path**（带 path 的旧码会一直生效，
  指向未注册页面会冷启动白屏；本包默认页为 `pages/home/index/index`）。
  扫码白屏先查 path，再查 request 合法域名。
- **验收**：体验成员真机扫码验证气泡对话 / NCE 书籍列表 / 头像昵称同步等核心链路。
- **有效期**：体验版二维码以微信侧为准（官方口径 7 天）。

### 正式版发布步骤（`npm run publish -- release` 打印指引）

- **前置**：体验版已真机验收通过；prod 后端已发布（`https://kedouai.com`）；
  `dev.kedouai.com` 与 `kedouai.com` 均已登记 request 合法域名；AppSecret 已同步；
  隐私指引已声明并发布；版本号已递增。
- **提交审核**：公众平台 → 管理 → 版本管理 → 开发版本 → 提交审核；
  表单填类目 / 测试账号 / 备注；审核时长以微信侧为准，可催审。
- **驳回处理**：按驳回原因修改 → 重新上传开发版本 → 重新提审。
- **发布**：审核通过后点击「发布」（全量或分阶段灰度）。
- **发布后真机验证**：正式版连 prod，确认不打到 dev。
  ⚠️ 体验版同样连 prod：设为体验版前就须确认 prod 后端、接口、合法域名、
  AppSecret 均已就绪，再用真机验证。
- **小程序侧回滚**：审核中可在「审核版本」区撤回审核；已发布可在
  公众平台 → 管理 → 版本管理 → 线上版本 → 版本回退（回到上一线上版本）。
- ⚠️ **后端服务回滚是另一条线**（pm2 + `dist` 备份），不要与小程序版本回退混写。

## 注意事项

- **cli 模式**需要微信开发者工具已登录（`cli islogin` → `{"login":true}`），**但不需要 IP 白名单**。
- **ci 模式**才需要 `private.key` + 固定出口 IP 白名单（本机公网 IP 会变，白名单维护不动）。
- 上传前请先更新 `package.json` 中的版本号（微信要求递增，重复会被拒）。
- 二维码落在 `.ci-output/`（已 gitignore），**有时效**（约 25 分钟），过期重跑。
- cli 出码的 `--qr-output` 必须是**项目内**绝对路径；写 `/tmp/...` 会报「二维码输出路径无效或不存在 (code 17)」。
- cli 出码产出的 `.png` 实际内容为 JPEG（470×470），后续推图不受影响（media upload 按内容识别）。
- cli 出码不生成 meta 信息，说明文案由 `publish.js` 自拼为一行「小程序开发版预览二维码 v<版本> · 有效期至 <时间>」（版本取 `package.json.version`、25 分钟有效期）。
