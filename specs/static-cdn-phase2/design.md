# Phase 2 · 静态资源本机 CDN 目录（PR-A 发布链路）设计

> 2026-11-04 · 研发部 · 状态：**PR-A 施工中（默认零变化）**
> 上游总控方案（含拓扑图 / 验收清单 / 探针）：
> `/Users/geekwen/WorkBuddy/chase 个人 AI 工作空间/30-任务产物/2026-11-04-静态资源CDN化架构评估/Phase2-实现方案.md`
> 本文只写**契约**（函数签名 / 配置键 / 顺序 / 安全断言），不复述方案正文。

---

## 1. 目标与边界

**做**：把「产物在哪个磁盘目录、HTTP URL 是什么、投到哪台机器」从散点手拼收口成**单一出口**，布局从
`static/modules/<app>/<env>/<commit>/` 改为 `<env>/<app>/<commit>/` 并落在入口机 `/data/cdn/`。

**不做**（属 PR-B / PR-C）：nginx 规则、构建侧 `vite base`、DB 流水线脚本正文、prod 部署形态。
**红线**：`/cdn/` 不硬编码进 bundle；URL 一律经 gateway `assetUrl()` + `ASSET_ORIGIN`（Phase 1 已落地，PR-A 不得回退）。

---

## 2. 映射契约

```
磁盘（入口机）  /data/cdn/<env>/<app>/<commit>/index.js
URL            <ASSET_ORIGIN>/<env>/<app>/<commit>/index.js
公共依赖        /data/cdn/common/{libs,pub}/…
               <ASSET_ORIGIN>/common/{libs,pub}/…
```

- **顺序是 `<env>/<app>`，与现状 `<app>/<env>` 互换**，不可靠 nginx rewrite 兼容（前缀含义不同）。
- 路径段白名单统一 `^[A-Za-z0-9._-]{1,64}$` 且不得为 `.` / `..`；`<commit>` 实际来自 git 短哈希（7–40 位），
  版本引用（`default/1a2b3c4`）**必须先经 `toCommitId()` 归一化**，未归一化会被段校验直接 throw。
- 同一 `<env>/<app>/<commit>` 已存在 → **fail-fast，绝不覆盖**（immutable 缓存）。
- `shell/index.html` 留在应用机模板根，**不进 CDN**。

---

## 3. 函数契约（`servers/deploy-console/src/pipeline/release-paths.ts`）

| 函数 | 签名 | 语义 |
|---|---|---|
| `isSafeSegment` | `(s: string) => boolean` | 单段白名单校验，`.`/`..`/空/含 `/` 一律 false |
| `cdnAssetDir` | `(root, env, app, commit) => string` | `<root>/<env>/<app>/<commit>`，段非法即 throw |
| `cdnAssetUrl` | `(origin, env, app, commit, file?) => string` | `origin` 去尾斜杠；`file` 默认 `index.js` |
| `cdnCommonUrl` | `(origin, group, file) => string` | `group ∈ {libs, pub}`，越界即 throw |
| `resolveCdnTarget` | `(get, env) => {root, sshTarget}` | 唯一落点解析，**投递/校验/GC 共用** |

**`resolveCdnTarget` 取值优先级**（同源解析，禁止调用方各拼一遍）：

```
root:      CDN_ROOT_<ENV> → CDN_ROOT → '/data/cdn'
sshTarget: CDN_SSH_TARGET_<ENV> → CDN_SSH_TARGET → null（本机）
```

> P0：`dir` 与 `ssh.run()` 必须同源。历史上 `staticRootOf()` 与 `SshExecService.resolve()` 是两套独立配置，
> 于是「路径算在一处、删除执行在另一处」，GC 能删到别的机器的同名路径。

---

## 4. 发布顺序契约（不可变）

```
build → 判重(test -d 已存在即 fail-fast) → 上传入口机新目录 → verify(200 + sha256 + 文件数)
      → 切 DB 版本指针（两库同步） → gateway 缓存 notify(best-effort)
```

任何一步失败：**只删本次新建的 commit 目录**，旧目录全程保留，DB 不动。

---

## 5. 兼容与过渡（默认零变化）

| 开关 | 默认 | 作用 |
|---|---|---|
| `CDN_LAYOUT_MODE` | `legacy` | `legacy` = 现有 `static/modules/<app>/<env>` 逐字节不变；`cdn` = 新布局 |
| `REMOTE_CLEANUP_ENABLED` | `false` | 双投期 GC 只观测不删 |

双投期两套路径**同时可读**；nginx 保留 `/static/modules/**` 直出，否则回滚到历史版本会全裂图。

---

## 5. GC 安全（`remote-artifact-cleanup.service.ts`）

顺序互换后，**只换根不换顺序 = 真会删错**：扫到的下一级恰好是 commit 哈希，能通过
`isSafeVersionName`，`rm -rf` 会成功。故 CDN 模式额外三条：

| # | 约束 | 实现 |
|---|---|---|
| 1 | 目录换序 | `versionDir` → `cdnAppDir(root, envId, appKey)`＝`<root>/<env>/<app>` |
| 2 | 执行打入口机，**不回落应用机** | `runRemote`：CDN 走 `CDN_SSH_TARGET` 解析出的 `SshTarget`；未配即抛错（fail-closed），清理结果为 `applied=false` |
| 3 | 删除前 realpath 归属断言 | 命令前缀 `real=$(pwd -P)`，不等于期望目录即 `exit 9` 拒删 |

`REMOTE_CLEANUP_ENABLED` 缺省 `false`（只观测）：双投期必须保持关闭，T3 后才讨论开启。

---

## 5bis. 切指针前的 CDN 硬门禁（S6，`cdn-asset-verifier.service.ts`）

**为什么在平台代码里而不是流水线脚本里**：脚本正文是 DB 数据，少写一行 `verify` 就静默跳过；
而「指针已切、资源 404」的后果是线上白屏，DB 里却全绿。顺序必须由结构保证。

```
pointer 执行体：assertCdnReady() → （灰度）写规则 / （全量）setPointer
```

**四道判据**（任一不满足即 throw → 流水线失败 → 已有自动回滚）：

| # | 判据 | 抓的是什么 |
|---|---|---|
| 1 | `CDN_ORIGIN_<ENV>`（或 `CDN_ORIGIN`）是完整 URL base | 配错/没配时**绝不静默跳过** |
| 2 | 本地产物目录非空 | 「构建没产出却报成功」 |
| 3 | `GET <base>/_manifest.sha256` 200 | nginx `/cdn/` 未生效、路径段不一致、目录不存在 |
| 4 | 清单逐文件 sha256 与本地目录一致（集合相等） | tar 截断、残留同名文件、上传错 commit |
| 5 | 入口 `index.js` HEAD 200 | 清单在但 JS 服务不出去（MIME/权限/软链） |

**为什么用清单对账而不是逐个 URL 探活**：逐 HEAD 只能证明「文件在」不能证明「内容对」；
逐 GET 算 sha256 在几百分包时会把 verify 拖成分钟级。清单一份即得「集合 + 内容」两个维度。

清单由上传脚本在入口机生成（BR 见 S8）：
```sh
cd "$DEST" && find . -type f ! -name _manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > _manifest.sha256
```

**默认零变化**：`CDN_LAYOUT_MODE≠cdn` 时 `assertReady()` 直接返回 `null`，**不发任何请求**。

---

## 6. 验收（PR-A 本地可验部分）

1. `npx jest src/pipeline/release-paths` 全绿，且新增「env/app 顺序互换」回归用例。
2. 变异验证：把 `cdnAssetDir` 的 `env/app` 顺序调回 `<app>/<env>`，单测必须红。
3. `CDN_LAYOUT_MODE` 未设时，`resolveRemoteScriptVars` 输出与改动前**逐字段相同**。
4. 段校验：`default/1a2b3c4` 经 `toCommitId()` 归一化后才能进路径；未归一化直接拼 → throw。
5. CDN 门禁：`cdn-verify.spec.ts` + `cdn-asset-verifier.service.spec.ts` + `steps/pointer.executor.spec.ts` 全绿；
   变异「校验失败只告警不抛」与「切指针放到校验之前」两处都必须变红。
