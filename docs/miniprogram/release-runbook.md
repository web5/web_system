# 小程序出码手册（Preview / Upload Runbook）

> 适用范围：`apps/kedou-ai-minigram`（科豆 AI 小程序，微信原生 + TS）。
> 其他小程序包照此办理，把路径里的包名替换即可。
>
> ⚠️ **本仓库是公开仓库**：本手册及 `scripts/` 下脚本内**不得出现**服务器 IP、SSH 用户名、绝对路径、密钥路径。
> 需要这些信息的，去配置中心 / 本地环境配置取，不要写进仓库。

## 零、三十秒速查

| 我要干什么 | 命令 |
|---|---|
| 出预览码（开发版，扫码即用） | `MINIPROGRAM_CI_PATH=<ci-dir>/node_modules node scripts/preview.js` |
| 上传体验版 | `MINIPROGRAM_CI_PATH=<ci-dir>/node_modules node scripts/upload.js` |

两条都在**固定出口 IP 的执行机**上跑（原因见 §1.3）。跑完二维码落在
`apps/kedou-ai-minigram/.ci-output/preview-qr.png`（该目录已 gitignore）。

---

## 一、一次性前置条件

### 1.1 CI 私钥 `private.key`

公众平台 → 开发管理 → 开发设置 → 小程序代码上传密钥 → 下载，放到：

```
apps/kedou-ai-minigram/private.key
```

安全核验（每次换机器都过一遍）：

```bash
chmod 600 apps/kedou-ai-minigram/private.key
git check-ignore -v apps/kedou-ai-minigram/private.key   # 必须命中
git status --porcelain apps/kedou-ai-minigram/           # 不得出现它
git log --oneline --all -- apps/kedou-ai-minigram/private.key  # 必须为空
```

仓库侧已有双保险（显式路径 + `*.key`）。第三条是**历史**核验——"现在没提交"不等于"从来没提交过"。

### 1.2 AppID

读 `project.config.json` 的 `appid`，脚本自动取，无需手工填。
历史包袱：`scripts/*.js` 里曾硬编码占位 `your-appid`，现已改为读配置文件，不要再改回去。

### 1.3 IP 白名单（最容易反复踩的一条）

公众平台 → 开发管理 → 开发设置 → IP 白名单。

**用固定出口 IP 的执行机出码，不要用本机。** 本机公网 IP 会变（家宽/办公网都是动态的），
每次变都要改白名单，不可维护。执行机出口 IP 固定，加一次即可。

实测证据：同一台开发机在 2026-10-10 当天，17:32 时出口 IP 是 `14.17.22.245`，
21:53 再跑变成了 `14.153.59.150` —— **不到半天换了一次**，白名单当场失效。
本机出码只适合「改完立刻自验」这种临时场景；要给出可复现的码，走执行机。

判定出口 IP 时**以微信侧报错为准**，不要信 `curl ifconfig.me`：

```
[Preview] 失败: invalid ip 14.17.22.245, not in whitelist
```

实测本机 `curl ifconfig.me` 看到的与微信识别的**不是同一个**（本机走了代理出口）。
报错里给的那个 IP 才是要加进白名单的。

### 1.4 其他平台侧配置

| 项 | 位置 | 说明 |
|---|---|---|
| request 合法域名 | 开发设置 → 服务器域名 | 预览版跑 dev 数据，配 `https://dev.kedouai.com` |
| 体验成员 | 成员管理 → 体验成员 | 预览码只有开发者本人 + 体验成员能扫 |
| 服务端口 | 开发者工具 → 设置 → 安全设置 | **非必需**，见 §4 误区 |

---

## 二、依赖隔离（必读，否则必踩）

### 2.1 现象

在仓库里直接跑会报：

```
TypeError: _lruCache is not a constructor
```

### 2.2 根因

monorepo 用 pnpm 提升依赖，根上提升的 `@babel/helper-compilation-targets` 版本
与 `miniprogram-ci` 的编译链不兼容。**此问题在脚本改造前就存在**，不是某次改动引入的。

### 2.3 解法

在仓库**之外**的独立目录单独装一份 `miniprogram-ci`，用 `MINIPROGRAM_CI_PATH` 指过去：

```bash
mkdir -p <ci-dir> && cd <ci-dir> && npm init -y
npm install miniprogram-ci@2.1.31 --no-audit --no-fund
```

> `<ci-dir>` 建议放在**用户目录下固定位置**（例如 `~/mp-ci`），别放 `/tmp`
> —— 临时目录会被系统清理，下次出码又得重装一千多个包。

然后：

```bash
cd <repo>/apps/kedou-ai-minigram
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules node scripts/preview.js
```

两个脚本都支持这个环境变量；不传则回退到 `require('miniprogram-ci')`（在隔离环境未备好时会报错）。

> 后续若抽到发布流水线执行，**必须在动作脚本里显式注入 `MINIPROGRAM_CI_PATH`**，
> 否则流水线机器上会重现同一个 `_lruCache` 错误。

---

## 三、日常出码

### 3.1 出预览码（开发版）

```bash
# ① 执行机上先对齐代码（防止基于旧源码构建）
cd <repo> && git pull

# ② 出码
cd apps/kedou-ai-minigram
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules node scripts/preview.js
```

产物：`.ci-output/preview-qr.png` + **`.ci-output/preview-qr.html`**。

**扫码请用 HTML 那个**。原因：二维码图片直接丢进聊天工具/IM 会被转码压缩，
压缩后手机常常扫不出来（踩过）。HTML 里用 data URI 内嵌原图，打开就是清晰的码，
点开即可扫。

> 实现细节：微信 CI 的 `qrcodeOutputDest` 写出的文件**扩展名是 .png 但内容是 JPEG**，
> 所以脚本按文件头魔数嗅探真实格式再写 data URI 的 MIME，照扩展名写会导致图片显示不出来。

**有时效**（约 25 分钟量级，以微信侧为准），过期重跑即可，重跑幂等。

可选环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PREVIEW_PAGE` | `pages/chat/index/index` | 扫码直达页面 |
| `PREVIEW_QUERY` | 空 | 页面参数 |
| `PREVIEW_SCENE` | 空 | 场景值 |

版本号与描述自动取 `package.json` 的 `version` + git 短 sha，`desc` 里能看出是哪次提交出的码。

### 3.2 上传体验版

```bash
MINIPROGRAM_CI_PATH=<ci-dir>/node_modules node scripts/upload.js
```

上传后到公众平台 → 版本管理 → 把该版本设为**体验版**，二维码长期有效，可分给体验成员反复扫。

> 上传前记得更新 `package.json` 的 `version`——微信要求版本号递增，重复会被拒。

### 3.3 真机复验（别省）

**开发者工具里 OK ≠ 真机 OK。** 典型差异：SSE 分片行为、域名校验、`baseUrl` 指向。
预览码出来后必须真机扫码走一轮，尤其是涉及流式/卡片渲染的改动。

---

## 四、常见误区

| 误区 | 事实 |
|---|---|
| 必须打开微信开发者工具才能上传 | ❌ 不需要。`miniprogram-ci` 直连微信后台，无头即可上传。`scripts/README.md` 里"开启服务端口"那条是陈旧说明 |
| 本机 `curl ifconfig.me` 的 IP 就是出口 IP | ❌ 不一定，尤其走代理时。以微信报错里的 IP 为准 |
| 预览码能一直用 | ❌ 有时效，过期重跑 |
| 改了源码直接出码就行 | ❌ 先 `git pull`，否则构建的是旧源码 |

---

## 五、排错表

| 报错 | 原因 | 处置 |
|---|---|---|
| `invalid ip x.x.x.x, not in whitelist` | 出码机出口 IP 未加白名单 | 把报错里的 IP 加进公众平台白名单；长期方案是换固定出口 IP 的执行机 |
| `TypeError: _lruCache is not a constructor` | pnpm 提升的 babel 与 ci 编译链冲突 | 用 `MINIPROGRAM_CI_PATH` 指向隔离安装的 `miniprogram-ci`（§2） |
| 私钥相关失败 | `private.key` 缺失或权限不对 | 按 §1.1 重新放置并 `chmod 600` |
| 版本号不合规 / 已存在 | `package.json` 版本未递增 | 升版本号后重跑 |
| 编译成功但扫码白屏 | 域名未配合法 / 代码本身问题 | 检查 §1.4 域名配置；真机调试看 vConsole |

---

## 六、变更历史

| 日期 | 变更 |
|---|---|
| 2026-10-10 | 初版。CI 脚本改造（PR #292）：二维码 `image` 落盘、版本读 `package.json`、支持 `PREVIEW_PAGE`、`MINIPROGRAM_CI_PATH` 依赖隔离 |
