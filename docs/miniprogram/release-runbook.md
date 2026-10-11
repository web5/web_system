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
| 能进首页、点「登录」失败并弹「登录失败，请重试」 | 后端 `MINI_PROGRAM_SECRET` 在微信侧失效 | 见 §5.1 |
| 后端日志 `invalid appsecret, rid: xxx` | AppSecret 被重置/停用，或填成了别的应用的 | 见 §5.1 |
| 扫码后白屏、vConsole/日志报 `page xxx 页面不存在` | 小程序码**手填了 path**，指向不存在或已改名的页面（包本身没问题） | 见 §5.2 |

### 5.1 登录失败：AppSecret 失效（真机点登录必现）

**判定三连**（能在一分钟内把问题从「前端/域名/后端」三选一定死）：

```bash
# 1) 网关是否能通 + 后端路由是否存在
curl -s -X POST https://<domain>/api/auth/miniprogram-login \
  -H 'Content-Type: application/json' -d '{"code":"probe-invalid-code"}'
# 2) 后端日志里有没有非探针的失败记录 —— 有，说明真机请求到达了后端
#    （即 request 合法域名已配好，问题不在域名）
pm2 logs auth-service --nostream | grep miniprogram-login
# 3) 直连微信验证凭据本身（不经过自己任何代码）
curl -s "https://api.weixin.qq.com/sns/jscode2session?appid=$MINI_PROGRAM_APP_ID\
&secret=$MINI_PROGRAM_SECRET&js_code=probe&grant_type=authorization_code"
```

| 微信返回 | 含义 |
|---|---|
| `{"errcode":40125,"errmsg":"invalid appsecret"}` | **凭据失效** —— 与放了多久、有没有重启无关，微信侧已不接受 |
| `{"errcode":40029,"errmsg":"invalid code"}` | ✅ 凭据有效（code 是假的，属预期） |

**处置**：公众平台 → 开发管理 → 开发设置 → 开发者密码(AppSecret) → 取当前值或重置 →
更新执行机上 `MINI_PROGRAM_SECRET` → **`pm2 restart auth-service`**（`dotenv` 在进程启动时读取，
改文件不重启不生效；且按既定禁项不用 `--update-env`）→ 重跑上面第 3 步确认返回 `invalid code`。

> ⚠️ `.env` 与 `servers/auth-service/.env` 都要一致（`auth-service` 的 cwd 在后者，两份都改最稳）。
> 这条同 `USER_SERVICE_KEY` 一样属**配置漂移**高危项：若流水线会下发 `.env.generated`，手工改的值会被冲掉。

### 5.2 扫码白屏：小程序码 path 参数指向不存在的页面

**这次真摔过**：开发版一切正常、体验版冷启动白屏，查遍域名/证书/登录/数据库/渲染层全绿，
最后靠一行日志定性 —— `pages/index/index 页面不存在`（`app.json` 里根本没有这一页）。

根因不在代码包：后台「工具 → 生成小程序码」允许**手填 path**，填了不存在或已改名的页面后，
微信冷启动照做 → 找不到页 → 白屏。标准体验版二维码本身不带 path，但带 path 的旧码会一直生效。

**先做二分，避免查错方向**（30 秒）：

1. 微信首页下拉 → 最近使用里直接点开小程序（不走码）→ 正常，则**实锤是码的 path 问题**
2. 仍白 → 才回到代码层排查

**处置**：公众平台 → 版本管理 → 体验版 → 用**系统生成的标准二维码**（不要手填 path）；
若必须用带 path 的码，`path` 必须是 `app.json` 注册过的页面（含分包，如
`packageTranslate/pages/translate/index/index`）。

**已加的防线**（PR #307）：
- `preview.js`：`pagePath` 不在注册列表里直接拒绝并打印可用页面；默认值改为 `pages/welcome/index/index`
- `upload.js`：上传前校验每个注册页面有实体文件（`.ts/.js` + `.wxml`）；上传成功打印 `pages[0]` 入口页并提示勿手填 path
- 两个脚本都从 **app.json** 读 `pages`（`project.config.json` 无此字段，读错会拿到空数组、校验形同虚设）

### 5.3 环境：不同版本连不同后端（别让正式版打到 dev）

`app.ts` 按 `wx.getAccountInfoSync().miniProgram.envVersion` 切换 `apiBase`：

| 运行环境 | envVersion | apiBase |
|---|---|---|
| 开发者工具 | (platform=devtools) | `http://local.kedouai.com` |
| 开发版 | develop | `https://dev.kedouai.com` |
| 体验版 | trial | `https://dev.kedouai.com` |
| **正式版** | release | `https://kedouai.com` |

老基础库不支持该 API 时兜底 dev（宁可连错环境也不白屏）。

> ⚠️ **改 dev 的 AppSecret 时，prod 也要同步改**（同一 appid 同一份密钥，但两边 `.env` 独立）。
> prod 的 pm2 运行目录可能与部署目录不同名，先 `pm2 jlist` 看 `pm2_env.cwd` 再改，改完按 §5.1 复验。
> 否则会出现「体验版登录正常、正式版登录失败」的假象。

### 5.4 隐私校验：开 `__usePrivacyCheck__` 前必须声明齐全

`__usePrivacyCheck__: true` 是**全局开关**——开启后小程序内**所有**隐私接口都要经过校验，
且**只有在公众平台《用户隐私保护指引》里声明过的信息类型才放行**；未声明的会被微信硬性拦截
（不是报错，代码侧 `try/catch` 也救不回来）。

**顺序依赖（反了最难排查）**：先在后台声明并**发布** → 再开 `__usePrivacyCheck__`。
提前开 = 真机表现「不报错、也不执行」。

本仓库代码里用到的隐私接口与需声明的对应关系：

| 代码位置 | 接口 | 需声明的信息类型 |
|---|---|---|
| `services/asr.ts` | `wx.getRecorderManager` | 麦克风 |
| `services/ocr-api.ts`、`packageAssess` | `wx.chooseMedia` | 相册（图片/视频）、摄像头 |
| `packageAssess` | `wx.chooseMessageFile` | 文件 |
| `packageBianbian` | `wx.saveImageToPhotosAlbum` | 相册写入 |

> 结论：**只声明「麦克风」时不要开校验**——语音功能本身不受影响（不校验就照常录音），
> 但会连带打断变变保存图片、OCR/测评选图。补全声明并发布后再开。
>
> 代码侧已用 `wx.requirePrivacyAuthorize` 主动方式（`services/asr.ts`），
> 因此 `app.ts` 无需再注册 `wx.onNeedPrivacyAuthorization`。

---

## 六、后端部署：把 dev 验证过的东西送到 prod

小程序连的后端（dev/prod）与小程序代码是**两条独立发布线**：体验版连 dev，正式版连 prod。
prod 落后时（曾落后 88 个提交）会出现「体验版有语音、正式版 404」。

**流程（可回滚优先）**：

1. **先备份**：`pm2 save` + 把要动的服务的 `dist/` 复制到 `/root/dist-backup-<ts>/`，
   并记录当前 HEAD（`git log --oneline -1`）。回滚 = 拷回 dist + restart
2. `git pull --ff-only`，确认 `git status` 无被挡（未跟踪的 `dist.bak-*` 之类会挡 pull，按需清理）
3. **看 migration 注释再决定跑不跑**：`migrations/` 下的文件可能是 DEPRECATED。
   例：`0013_music_agent_binding.sql` 头部写明「请勿执行」，且 `schema_migrations`
   里的"已执行"记录其实是**空跑**（UPDATE 命中 0 行）——
   **不要把 `schema_migrations` 当「已生效」证据，它只记「跑过」**
4. **只构建改动过的服务**：`git diff --name-only <旧HEAD> HEAD | grep -oE "^servers/[^/]+"` 看影响面；
   若服务 `package.json` 无变化则**不用 reinstall**
5. `pm2 restart <name>`（fork 单实例有秒级中断；cluster 才走 reload）。
   进程是旧 ecosystem 起的，`restart` 沿用现有配置，不受 `ecosystem.*.cjs` 拆分影响
6. **验证**：服务日志看路由注册（如 `AsrController {/ai/asr}`）；
   直连验证需临时 token——用 `jsonwebtoken` + `JWT_SECRET` 现签，
   payload 照抄 `auth.service.ts` 的 `{sub, username, roles, systems, sid, type:'access'}`，
   然后 `curl -H "Authorization: Bearer <token>" http://127.0.0.1:<port>/...`
   （端口从 `.env` 的 `PORT` 读，`pm2_env.env` 里没有——dotenv 是运行时加载的）

> ⚠️ `pm2 logs --lines N` 会混入历史日志（含几个月前的 ERROR），
> 判断"本次启动是否正常"要**带时间戳过滤**，别被旧 ERROR 误导。

---

## 七、变更历史

| 日期 | 变更 |
|---|---|
| 2026-10-10 | 初版。CI 脚本改造（PR #292）：二维码 `image` 落盘、版本读 `package.json`、支持 `PREVIEW_PAGE`、`MINIPROGRAM_CI_PATH` 依赖隔离 |
| 2026-10-11 | §5.1 登录失败判定三连（AppSecret 失效）；§5.2 扫码白屏 = 小程序码 path 指向不存在页面；§5.3 三环境 apiBase + prod 需同步改 AppSecret（PR #307） |
| 2026-10-11 | §5.4 隐私校验前置（全局生效 + 未声明即拦截 + 隐私接口↔声明类型对照）；§六 后端 prod 部署手法（备份优先、migration 需读注释、只构建改动服务、临时 token 验证法） |
