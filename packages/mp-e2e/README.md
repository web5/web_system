# @web-system/mp-e2e · 小程序真机 E2E 基建

web_system 小程序（dachengzi / kedou / 未来第三个 app）的真机 E2E 统一基建：
launch/导航/断言/storage/KEYS 守卫/page 注册守卫/四态 runner。本文即 runbook——
**新会话只读本文即可写出新用例**（验收判据 V3 的载体）。

> 规则真源：技术方案见任务产物《01-技术方案.md》（exit code 语义、配置契约以本文为仓库内单点真源）。

---

## ① 30 秒 Quickstart

以一个已有 `@web-system/mp-e2e` workspace 依赖的 app 为例，三步：

**1. app 的 `package.json` 加 script 与 devDep**（已接线的 app 跳过）：

```json
{
  "scripts": { "test:e2e": "mp-e2e" },
  "devDependencies": {
    "@web-system/mp-e2e": "workspace:*",
    "miniprogram-automator": "^0.12.1"
  }
}
```

然后在仓库根 `pnpm install` 完成链接。

**2. app 根写 `e2e.config.js`**（调用方与本包的唯一配置契约）：

```js
// apps/<app>/e2e.config.js
module.exports = {
  // —— 必填 ——
  entryPath: 'pages/welcome/index/index', // 启动落点（= app.json pages[0]）
  storageKeys: {                          // 逐 key 注释真源位置（keys-guard 会对账）
    token: 'access_token',                // 真源: utils/request.ts TOKEN_KEY
    // ...
  },

  // —— 可选（有默认） ——
  // projectPath: __dirname,             // 默认 = 本 config 所在目录（app 根）
  // cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  // launchTimeoutMs: 20000,
  // casesDir: 'tests/e2e/cases',
};
```

**3. 写首条用例 `tests/e2e/cases/A-launch-home.js`**：

```js
/** A. 启动到达首页 */
module.exports = {
  name: 'A. 启动到达首页',
  async run(ctx) {
    const { mp } = ctx;
    await ctx.run('A1 启动到达首页', async () => {
      await ctx.pollPath(mp, 'pages/welcome/index/index'); // 换成你的 entryPath
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/welcome/index/index', '启动落点路径');
    });
  },
};
```

跑：`pnpm --filter <app> test:e2e`（在仓库任意 worktree 下均可）。

---

## ② 前置条件

| 项 | 说明 |
|---|---|
| 微信开发者工具 | 仅 macOS 本地可跑（GUI 自动化）；默认 cli 路径 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli` |
| 服务端口 | 开发者工具「设置 → 安全设置 → 服务端口」必须开启，否则全部用例 SKIP |
| 环境变量 | `WECHAT_DEVTOOLS_CLI`（覆盖 cli 路径）、`MP_AUTOMATOR_LAUNCH_TIMEOUT`（慢机调大，默认 20000ms）、`MP_E2E_REQUIRE_ENV=1`（严格模式，见第④章） |
| CI | 不适用（devtools GUI 仅本地）。E2E 不进 CI 门禁 |

字段优先级：**环境变量 > e2e.config.js > 包内默认值**（仅 cliPath / launchTimeoutMs 支持环境变量覆盖）。

---

## ③ 用例契约与 ctx API 一览表

**用例契约**：`tests/e2e/cases/<字母>-<slug>.js` 导出 `{ name, run(ctx) }`。
runner 按文件名排序、顺序执行，**每条用例独立 launch/close**（隔离语义）。
字母 per-app 独立计数；步骤号 = `<字母><n>`，对应每个 `ctx.run('<字母><n> <名称>', fn)`。

```js
module.exports = {
  name: 'B. 某功能（判据 V<n>）',
  async run(ctx) {
    const { mp } = ctx;
    await ctx.run('B1 某步骤', async () => {
      await ctx.switchTab(mp, '/pages/x/index/index');
      ctx.assertEqual(await ctx.currentPath(mp), 'pages/x/index/index', '路径');
    });
    // 被「已知限制」挡住的步骤：ctx.blocked('B2 xxx', '理由 + 非产品 bug 证据');
  },
};
```

**ctx 字段一览**：

| 分类 | API | 说明 |
|---|---|---|
| 会话 | `ctx.mp` / `ctx.launch()` / `ctx.close(mp)` | mp 为当前用例的 MiniProgram 实例；launch/close 供用例内重建会话（E3 先例）。launch 失败返回 null 不抛 |
| 配置 | `ctx.KEYS` | = e2e.config.js 的 storageKeys |
| 步骤 | `ctx.run(name, fn)` / `ctx.blocked(name, message)` | 步骤级 PASS/FAIL、BLOCKED 记录与汇总 |
| 导航 | `switchTab(mp,url)` `navigateTo(mp,url)` `reLaunch(mp,url)` `navigateBack(mp,expectedPath)` `pollPath(mp,expected,timeoutMs=12000)` | 导航类内置 pollPath；url 可带 query，断言路径自动去 query |
| 页面 | `currentPath(mp)` `stackPaths(mp)` `pageData(mp,key)` `waitForData(mp,key,expected,timeoutMs=8000)` `tabBarSelected(mp)` | 路径均为「无前导斜杠」形式 |
| storage | `getStorage(mp,key)` `setStorage(mp,key,value)` `removeStorage(mp,key)` | key 只许用 `ctx.KEYS.<别名>` |
| 断言 | `assertEqual(actual,expected,label)` `assertOk(cond,label,detail?)` | JSON 序列化比较 |

**两条不封装、允许直达的能力（不是缺 API）**：
- **tap / dom 断言**：走 page 对象——`const page = await ctx.mp.currentPage(); (await page.$(sel)).tap(); await page.$$(sel)`（G2 先例）。
- **sourceShell 断言**：走裸 node `execSync`（G3 先例，如 grep 源码无残留）；目录必须白名单在 app 内。

**约定（红线）**：用例内引用 storage key **只许 `ctx.KEYS.<别名>`，禁字面量**——漂移守卫只对 config 里的值对账，写字面量等于绕过守卫。

**写新用例的流程**：先填一张**测试用例卡**（见附录 A），卡评审通过后按附录 A §6 映射规则翻译成 case 文件；动作/断言只允许使用上表 API（含两条直达能力）。

---

## ④ exit code 与环境失败口径

| 情形 | 输出 | exit code |
|---|---|---|
| 全部 PASS（BLOCKED 不计失败） | 四态汇总表 | **0** |
| ≥1 条 FAIL（含 preflight 静态守卫不通过、配置错误） | 汇总表 + 失败详情 | **1** |
| 环境不可用（devtools 未装/服务端口未开/launch 超时） | 醒目横幅 + 全部用例标 SKIP + 排查提示 | **0**（默认）/ **2**（`MP_E2E_REQUIRE_ENV=1`） |

口径说明：**环境失败不红**——环境问题非代码问题，噪声不该混进信号（kedou 既有决策，CI 实测背书）。
`MP_E2E_REQUIRE_ENV=1` 是本地严格验收的逃生门，防「环境坏了但全绿」的假阳性。

四态：**PASS / FAIL / BLOCKED / SKIP**。SKIP 由 runner 统一判（环境不可用），用例与用例卡都不需要写 SKIP；
BLOCKED 由用例显式声明（`ctx.blocked`），判定标准见附录 A §3.4。

CLI：`mp-e2e [--config <path>] [--filter <文件名子串>]`（默认读 cwd 下 `e2e.config.js`）。

---

## ⑤ 已知限制

1. **① close()→launch() 之间 devtools 自动化会清空 wx storage**（仅 api_base 因 onLaunch 重写残留）→ 跨进程持久化用例判 `BLOCKED`，不当产品 bug（E3 先例）。⚠️ 2026-11-11 探针实测：现版 devtools 可能已不再清空（close→launch 后 appearance_radius 仍在），待复核——复核确认前 BLOCKED 口径不变。
2. **② 仅 macOS 本地可跑**；需开发者工具「设置 → 安全设置 → 服务端口」开启；CI 不适用。
3. **③ automator 0.12.1 与 devtools 36.x automation 协议的 checkVersion 不兼容**，包内已 patch（`src/automator.js`）——**升级 miniprogram-automator 前先看本节与源码头注**。

---

## ⑥ KEYS 与漂移守卫

**KEYS 单一真源的两级做法**：

- **现状（M 档）**：KEYS 留在各 app `e2e.config.js` 的 `storageKeys`，**逐 key 注释真源文件:符号**。
  产品侧 key 真源散在 `.ts` 私有常量与行内字面量里（裸 node runner require 不了 TS），无法直接 import，
  故本包提供 `assertKeysInSource` **漂移守卫**：runner preflight 阶段（launch 之前，纯文件 IO、秒级）
  对 KEYS 每个值在产品源码目录做字面量扫描（排除 `node_modules/`、`tests/`），
  **任一 key 找不到即 FAIL-fast**——产品侧 key 改名/删除时 e2e 第一时间红，且红在 launch 之前。
- **同机守卫（R2）**：`assertPagesRegistered` 校验 entryPath 与 cases 内全部导航 path 已在
  app.json（含 subPackages root 拼接）注册，未注册同样 preflight FAIL-fast。
- **Follow-up（不进 M 档）**：产品侧把 storage key 收敛为纯 JS 常量模块，产品 TS 与 e2e.config.js 同源 require，单独立项。

**约定**：用例卡与 case 文件中引用 storage key 一律用 e2e.config.js 别名（`ctx.KEYS.<别名>`），**禁字面量**（漂移守卫与卡片规范 M1/M4 的共同前提）。

---

## ⑦ FAQ

**Q：pollPath 为什么吞掉 currentPage 的竞态报错？**
页面切换期间 webview 重建，getCurrentPage 偶发 rawPath 竞态报错，属过渡期噪声；轮询重试即可，
竞态不是信号。不要把「偶尔超时」当产品 bug——真超时（12s）会抛错带 expected/actual。

**Q：为什么不用 automator 的 changeRoute / page.callMethod？**
changeRoute 内部前后各调一次 currentPage，webview 重建期会抛 rawPath 竞态——故导航封装直连
wx 方法 + 轮询当前页。page.callMethod 对本项目 Proxy 页面失效（this.xxx is not a function）——
调页面方法用 `mp.evaluate(() => { getCurrentPages().pop().someMethod(); })`（D3/F3 先例）。

**Q：BLOCKED 什么时候用？**
仅当**同时满足**：① 依赖的能力被第⑤章「已知限制」明文条目挡住（引用条目编号）；② 已确认非产品 bug
（附证据）；③ 同用例内仍有 ≥1 步正常 PASS/FAIL。详见附录 A §3.4。环境问题不是 BLOCKED，是 SKIP（runner 判）。

**Q：用例间会互相污染 storage 吗？**
runner 对每条用例独立 launch/close；但同一 devtools 项目内 storage 跨会话保留（已知限制①仅指
close→launch 间隙被清）。用例若写了垃圾 key，自行在用例内清理或断言后清（F 用例的垃圾 key 即被
产品逻辑清掉）。

**Q：E 用例内部 close→launch 后，runner 还会 close 吗？**
runner 只负责关闭 `ctx.mp`（用例启动时的会话）。用例内自行 launch 的新会话自行 close（E3 先例）。

**Q：切换系统代理会影响跑测吗？**
不影响。automator 与 devtools 之间走 127.0.0.1 本地端口，不经过系统代理（macOS 代理例外列表
默认含 `127.*`/`localhost`）；2026-11-11 实测代理切换前后 PASS/FAIL/BLOCKED 分布一致。
唯一例外：代理工具开 TUN/增强模式劫持回环时 automator launch 可能异常——遇到先关 TUN 再复跑。

---

## 附录 A · 测试用例卡模板与规范

> 本附录是「界面功能 → 可执行用例」的描述标准：写用例不再「读产品源码临时抄」，
> 填一张卡 → 按映射规则翻成 case 文件 → runner preflight 机器校验。
> （全文内联自任务产物《02-测试用例卡规范.md》，本文为仓库内单点真源。）

### A.2 用例卡模板（空白，复制即填）

````markdown
## 用例卡：<app>:<字母> <一句话标题>

| 字段 | 值 |
|---|---|
| 用例编号 | <app>:<字母>（如 dachengzi:B；步骤号 <字母><n>，如 B1） |
| 目标 app | dachengzi-minigram / kedou-ai-minigram |
| 判据溯源 | V<n>（既有判据编号；新判据写「新判据-待登记」并附一句话） |
| 目标界面 | <页面名>，入口 page path = `<path>`（必须已在 app.json/subPackages 注册） |
| 作者 / 日期 | <谁> / <YYYY-MM-DD> |

### 前置条件
| 项 | 值 | 说明 |
|---|---|---|
| storage 预置 | `<KEYS 别名>` = <值>（无则写「无」） | 只许引用 e2e.config.js storageKeys 的别名，禁写字面量 |
| 登录态 | 已登录 / 未登录 / 需清登录态 | 清登录态 = removeStorage(token/refreshToken/loggedOut) |
| 依赖服务/端口 | 无 / <服务 + 端口>（如后端 dev :3000） | 涉及真网络的服务依赖默认转 BLOCKED，见异常分支 |
| 环境 | devtools 服务端口已开（默认前提，可省略） | |

### 步骤
| # | 动作类型 | 参数 | 断言类型 | 期望值 | 备注 |
|---|---|---|---|---|---|
| <字母>1 | switchTab / navigateTo / reLaunch / navigateBack / storage.set / storage.remove / callWxMethod / evaluate / tap / sourceShell | <url / key / selector / js / cmd> | path.current / path.stack / data.wait / data.now / storage.get / tabbar.selected / dom.count / dom.exists / shell.grep | <期望值> | <可选> |

### 异常分支
| 分支 | 判定 | 理由与证据 |
|---|---|---|
| <哪一步/哪段> | SKIP / BLOCKED | SKIP=环境不可用（runner 统一判，不用写）；BLOCKED 必须引用 README 已知限制条目 + 非产品 bug 证据 |

### 反例（什么算假绿，≥1 条）
- <如果少了哪个断言/用错了哪种断言，功能坏了测试也绿>
````

### A.3 字段详解与枚举

#### A.3.1 用例编号与命名规则（与 runner 用例发现对齐）

- **一卡 = 一个 case 文件**（默认，见 A.6.1）。文件落点 `apps/<app>/tests/e2e/cases/<字母>-<slug>.js`，runner 按文件名排序执行。
- **字母 = 卡在 app 内的编号**：每个 app 独立计数（dachengzi 现有 A–G，新卡从 H 起；kedou 从 A 起）。字母同时是文件名前缀与步骤号前缀，保证「汇总输出 ↔ 卡 ↔ 文件」三方互查。
- **步骤号 = `<字母><n>`**，从 1 连续编号，对应 case 文件里每个 `ctx.run('<字母><n> <名称>', fn)`。
- **跨 app 引用用全限定 `<app>:<字母>`**（如 `dachengzi:B`），避免 kedou:A 与 dachengzi:A 撞名。
- 卡内断言粒度 ≠ 步骤粒度：一步可含多条断言（如 B2 含路径 + 栈深两条），但**一个步骤号对应一个 `ctx.run`**，保证失败定位到步。

#### A.3.2 动作类型枚举（→ ctx API 映射）

| 动作 | 参数写法 | 翻译目标（ctx） | 说明 |
|---|---|---|---|
| `switchTab` | `/pages/x/index/index` | `ctx.switchTab(mp, url)` | 仅 tab 页；内置 pollPath |
| `navigateTo` | `/pkg/pages/x?k=v` | `ctx.navigateTo(mp, url)` | query 原样传，断言路径自动去 query |
| `reLaunch` | 同上 | `ctx.reLaunch(mp, url)` | 重启到某页（清栈） |
| `navigateBack` | 期望回到的 path | `ctx.navigateBack(mp, expectedPath)` | 固定 delta=1 |
| `storage.set` | `<KEYS别名>` = `<JSON 值>` | `ctx.setStorage(mp, ctx.KEYS.<别名>, value)` | **只许别名，禁字面量**（漂移守卫前提） |
| `storage.remove` | `<KEYS别名>` | `ctx.removeStorage(mp, ctx.KEYS.<别名>)` | 常用于清登录态 |
| `callWxMethod` | `<wx方法>(<参数>)` | `ctx.mp.callWxMethod(...)` | 逃生门；卡上须注明为何不用封装 |
| `evaluate` | 一段 JS | `ctx.mp.evaluate(fn)` | 逃生门；tabBar 读 selected 请直接用断言 `tabbar.selected` 而非自写 evaluate |
| `tap` | CSS selector | `(await page.$(sel)).tap()` | 无封装，允许直接用 `ctx.mp.currentPage()` 取 page |
| `sourceShell` | shell 命令 | `execSync`（裸 node，G3 先例） | runner 外断言（如 grep 源码无残留）；**目录必须白名单在 app 内** |

隐式动作不用写：launch/close 由 runner 对每条用例独立执行。

#### A.3.3 断言类型枚举

| 断言 | 期望写法 | 翻译目标 | 何时用 |
|---|---|---|---|
| `path.current` | `pages/x/index/index`（无前导斜杠） | `ctx.assertEqual(await ctx.currentPath(mp), ...)` | 导航落点 |
| `path.stack` | 路径数组 | `ctx.assertEqual(await ctx.stackPaths(mp), [...])` | 返回栈/栈深 |
| `data.wait` | `data.<key>` = `<JSON 值>` | `ctx.waitForData(mp, key, expected)` | **onShow/异步 setData 场景首选**（8s 轮询） |
| `data.now` | 同上 | `ctx.pageData(mp, key)` + assertEqual | 仅当确定同步可读（如上一步已 wait 过同页其它字段） |
| `storage.get` | `<KEYS别名>` = `<JSON 值>` | `ctx.getStorage` + assertEqual | 预置读回 / 持久化断言 |
| `tabbar.selected` | 整数 index | `ctx.tabBarSelected(mp)` | tab 选中态 |
| `dom.count` | selector → 数量 | `page.$$(sel)` 长度 | 列表/设置项数量（G2 先例） |
| `dom.exists` | selector | `page.$(sel)` 非空 | 元素存在性 |
| `shell.grep` | 模式 → 命中数 | `execSync` grep（G3 先例） | 「源码无残留」类 |

导航类动作（switchTab/navigateTo/reLaunch/navigateBack）内置 pollPath（12s），**不需要**再为同一次导航单列 path 断言；列 path.current 断言是为了显式留下期望值记录。

#### A.3.4 异常分支口径：SKIP vs BLOCKED 判定标准

| 态 | 谁判 | 判定标准 | 后果 |
|---|---|---|---|
| **SKIP** | **runner 统一判，卡上不用写** | 环境不可用：devtools 未安装 / 服务端口未开 / launch 超时（launch 返回 null，第④章） | 全量 SKIP，exit 0（`MP_E2E_REQUIRE_ENV=1` 时 exit 2） |
| **BLOCKED** | 提测人在卡上显式声明，实现者用 `ctx.blocked()` 落地 | **同时满足三条**：① 依赖的能力被第⑤章「已知限制」明文条目挡住（须引用条目编号，如「已知限制① close→launch 清 storage」）；② 已确认非产品 bug（附证据，如「产品侧 grep 无 clearStorage 触碰该 key」）；③ 卡内仍有 ≥1 步可正常 PASS/FAIL（**整卡全 BLOCKED 的卡不收**——说明该功能此基建测不了，应整体标 BLOCKED 立项而不是占一张卡） | 该步标 BLOCKED，不计失败，exit 0 |

**典型 BLOCKED 场景**（来自 E3 先例）：close→launch 跨进程持久化、真 LLM/流式网络依赖、devtools automation 协议不支持的交互。

**反模式**：把「我懒得搭环境」写成 BLOCKED——环境问题是 SKIP 的事，且由 runner 判；把产品 bug 写成 BLOCKED 压红灯——违反②，评审打回。

#### A.3.5 反例（假绿）字段

每张卡至少写一条「如果这样写，功能坏了也绿」。常见假绿模式（可直接引用）：

- **只断路径不断业务态**：如只 assertEqual(currentPath) 不断 data/storage——页面白了路径也对。
- **同步直读异步渲染**：该用 `data.wait` 用了 `data.now`，竞态下时红时绿，绿了也是运气。
- **预置即断言**：setStorage 后只读回 storage（只证明 wx.setStorageSync 没坏），不断真实消费方（页面 data 回填）——C 用例头注「不是装饰」正是防这个。
- **断言了 runner 吞掉的竞态分支**：pollPath 竞态吞错是设计（第⑦章），不要把「偶尔超时」当信号。

### A.5 示例卡（精简版）：kedou:B 设置页字体大小修改并生效（含 BLOCKED 演示）

> 另一张完整示例（dachengzi:B 返回栈反推）见任务产物《02-测试用例卡规范.md》§4。

```markdown
## 用例卡：kedou:B 设置页字体大小修改并生效

| 字段 | 值 |
|---|---|
| 用例编号 | kedou:B（步骤 B1–B5） |
| 目标 app | kedou-ai-minigram |
| 判据溯源 | 新判据-待登记：设置页改字体大小后，设置项即时生效并写入本地持久化 |
| 目标界面 | 设置页（假想），入口 page path = `pages/settings/index/index`（填卡时已核对 app.json 注册） |

### 前置条件
| 项 | 值 | 说明 |
|---|---|---|
| storage 预置 | 无 | |
| 登录态 | 无要求 | |
| 依赖服务/端口 | 无 | |
| 环境 | 默认 | |
| ⚠️ 实现前依赖 | e2e.config.js storageKeys 需新增 `fontSize: 'kd_settings_fontsize'`（注释真源） | 新 key 必须产品源码先存在，否则 keys-guard preflight FAIL-fast |

### 步骤
| # | 动作类型 | 参数 | 断言类型 | 期望值 | 备注 |
|---|---|---|---|---|---|
| B1 | navigateTo | `/pages/settings/index/index` | path.current | `pages/settings/index/index` | |
| B2 | tap | `.font-size-option[data-value="large"]` | data.wait `fontSize` | `'large'` | |
| B3 | （无动作） | — | storage.get `fontSize` | `'large'` | 写盘闭环 |
| B4 | reLaunch | `/pages/settings/index/index` | data.wait `fontSize` | `'large'` | 同会话重进仍生效 |
| B5 | —（跨进程持久化） | — | storage.get `fontSize` | `'large'` | **BLOCKED**，见异常分支 |

### 异常分支
| 分支 | 判定 | 理由与证据 |
|---|---|---|
| B5 close→launch 后读回 | **BLOCKED** | 命中已知限制①「close()→launch() 之间 devtools 自动化清空 wx storage」。非产品 bug 证据：产品侧 grep 无 clearStorage/removeStorageSync 触碰该 key。卡内 B1–B4 正常 PASS/FAIL，满足「非整卡 BLOCKED」准入。 |

### 反例
- 若只做 B2+B3：设置页 UI 回显坏了（重新打开显示默认字号）也绿——B4 的 reLaunch 回显断言不可省。
- 若 B2 用 `data.now` 而非 `data.wait`：tap 后 setData 异步未落，竞态假红/假绿。
```

### A.6 用例卡 → 可执行用例 映射规则

#### A.6.1 对应关系

- **一卡 = 一个 case 文件**（`tests/e2e/cases/<字母>-<slug>.js`）。卡内步骤多不拆文件——同卡步骤共享前置状态（栈、storage），拆开反而要重复预置。
- **例外允许一卡多文件**：卡内步骤组间前置互斥（如一组要登录态一组要登出态且 storage 污染严重）时，允许拆 `<字母>-<slug>-1.js` / `-2.js`，卡上注明拆分理由。
- 一个 `ctx.run('<步骤号> <名称>', fn)` = 卡上一个步骤行；一行多断言就多条 assert 在同一 run 内。

#### A.6.2 字段 → ctx API 映射总表

| 卡字段 | 翻译目标 |
|---|---|
| 前置条件 · storage 预置 | launch 后首步 `ctx.setStorage(mp, ctx.KEYS.<别名>, <值>)` + 读回断言；清登录态 = `ctx.removeStorage` × token/refreshToken/loggedOut 三个别名 |
| 前置条件 · 登录态「已登录」 | 预置 `ctx.KEYS.token`/`refreshToken` 伪值（除非依赖真后端，真后端依赖 → 转 BLOCKED 评估） |
| 步骤 · 动作类型 | A.3.2 表逐行对应 |
| 步骤 · 断言类型 | A.3.3 表逐行对应 |
| 异常分支 · BLOCKED | `ctx.blocked('<步骤号> <名称>', '<理由+证据>')` |
| 异常分支 · SKIP | 不写——runner preflight launch 失败统一 SKIP（第④章） |
| 用例编号 | case 文件名前缀 + `module.exports.name`（如 `'B. 返回栈（判据 V7/V22/V23）'`，头注抄卡标题与判据溯源） |

实现者纪律：**只翻不改**——卡上没写的断言不许自行加（要加先改卡）；断言体逐行对应步骤表。

#### A.6.3 runner 机器校验的字段（preflight 清单）

| # | 校验 | 机制 |
|---|---|---|
| M1 | storage key 值在产品源码存在（漂移守卫） | `assertKeysInSource`，launch 前 FAIL-fast |
| M2 | 用例引用的入口 page path 在 app.json（含 subPackages）注册 | `assertPagesRegistered`，preflight 对 cases 内导航 path 静态扫描校验 |
| M3 | case 文件命名 `<字母>-<slug>.js`、步骤号与 run 名前缀一致 | runner 用例发现/执行时打 warning（不挡测试信号） |
| M4 | e2e.config.js storageKeys 逐 key 有真源注释 | 人审（卡评审环节） |

机器校验**不做**的：期望值业务正确性、反例质量、判据溯源真实性——全在人审卡。

### A.9 填写纪律

#### A.9.1 准入门槛（以下字段不齐不收）

1. **用例编号**：符合 A.3.1，字母不与本 app 既有用例撞（撞了往后排）。
2. **判据溯源**：V 编号或「新判据-待登记 + 一句话判据」——二选一，不许空。
3. **入口 page path**：填卡时已核对 app.json（含 subPackages）注册；未注册的路径直接打回（M2 机器拦）。
4. **前置条件**：四项全填，无则写「无」；storage 预置只许 KEYS 别名。
5. **步骤表**：≥1 步；每步动作类型 ∈ A.3.2 枚举、断言类型 ∈ A.3.3 枚举、期望值具体（禁「正常显示」「不报错」这类不可测表述）。
6. **异常分支**：无则写「无」；有 BLOCKED 必须三条判定标准齐全（A.3.4）。
7. **反例**：≥1 条具体假绿场景（禁「无」）。

#### A.9.2 打回情形（满足任一即打回）

| 情形 | 理由 |
|---|---|
| 缺反例 / 反例写成「无」 | 没想过怎么假绿的卡，断言设计不可信 |
| 前置条件缺项或 storage 用字面量 key | 绕过别名即绕过 M1/M4 漂移守卫 |
| 判据无溯源且不登记新判据 | 无法回追溯源，卡变孤儿 |
| 全卡断言只有 path 类、无一条业务断言（data/storage/dom） | 假绿高危（A.3.5 模式一） |
| BLOCKED 缺「非产品 bug」证据，或整卡全 BLOCKED | A.3.4 反模式 |
| 期望值不可测（「正常」「合理」「大概」） | 无法翻译成 assertEqual 参数 |
| 一卡测多个互不相关界面 | 违背「一卡一文件一主题」，拆卡重填 |

---

## 用例索引

| app | 用例 | 文件 | 判据溯源 |
|---|---|---|---|
| dachengzi | A. 三 tab 渲染 + 选中态 | `apps/dachengzi-minigram/tests/e2e/cases/A-tabs.js` | V21 |
| dachengzi | ~~B. 返回栈~~ **暂缓** | —（暂缓：目标页 packageTranslate/pages/translate/result 已于 commit 75898073「2026-11-10 对话式翻译改造」废弃；重写走用例卡流程单独立项——新对话流首问会走真 LLM，须评估首问部分转 BLOCKED 或 mock 方案，返回栈断言保留） | V7 / V22 / V23 |
| dachengzi | C. 翻译设置偏好初值闭环 | `apps/dachengzi-minigram/tests/e2e/cases/C-translate-prefs.js` | V52③ |
| dachengzi | D. 清空历史不误清 | `apps/dachengzi-minigram/tests/e2e/cases/D-clear-history.js` | V53④⑤ |
| dachengzi | E. 圆角设置持久化（E3 BLOCKED） | `apps/dachengzi-minigram/tests/e2e/cases/E-radius-persist.js` | V42 |
| dachengzi | F. 清缓存白名单 | `apps/dachengzi-minigram/tests/e2e/cases/F-clear-cache.js` | V45 |
| dachengzi | G. accent 已删 | `apps/dachengzi-minigram/tests/e2e/cases/G-accent-removed.js` | A2 落地验收 |
| kedou | A. 启动到达首页 | `apps/kedou-ai-minigram/tests/e2e/cases/A-launch-home.js` | 基建首条 |
