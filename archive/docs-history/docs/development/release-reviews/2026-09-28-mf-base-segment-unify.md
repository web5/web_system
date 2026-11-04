# 发布评审：微前端 base 段位契约统一 + prod/dev 版本指针扁平化

- **日期**：2026-09-28
- **范围**：`scripts/`（构建 + 本地发布脚本）、`docs/`、`specs/`、**线上数据**（prod/dev 的 `deploy_deployments.current_version` 与静态根目录）
- **评审结论**：**阻塞 0 / 重要 1**（遗留项：deploy-console 侧 `buildVersionRef` 未改，见 §5）

---

## 1. 为什么要改

同一个仓里，`RELEASE_TAG`（决定微前端产物 base）存在**三套互不一致**的写法：

| # | 出处 | 值 | 产物/投递目录 |
|---|---|---|---|
| 1 | `scripts/build-module.mjs`（改动前） | `default/<commit>` | `modules/<k>/default/<commit>/` |
| 2 | `scripts/deploy.sh` | `<commit>` + `MF_ALLOW_FLAT_BASE=1` | `modules/<k>/<commit>/` |
| 3 | 线上 NEW 域实际入口 | 指针 `<k>/<envId>/index.js` → `<k>/<envId>/<commit>/` | `modules/<k>/<envId>/<commit>/` |

而 `resolveMfBase` 强制要求 2 段，导致 **#2 必须靠逃生舱环境变量绕过自己的校验** ——
校验形同虚设，且无法拦截真正的错误。

根因澄清（本次调研的核心结论）：

- **产品线段的历史使命已终结**。它存在的唯一理由是让产物内 public 资源（logo / avatars / materials）
  落在与投递目录逐字一致的 base 下。2026-09-27 PR #205 把这些资源全部迁到
  `/static/cdn/pub/`（编译期常量 `__PUBLIC_ASSET_BASE__`）后，产物只剩
  `index.js` / `index.css` / `manifest.json`，**资源路径与 base 已彻底解耦**。
- **两边消费的数据源不同**：
  - dev（`dev.kedouai.com` 命中 `deploy_sites`）→ NEW 域，读 `deploy_app_env_versions`，
    入口是 `byEnv` 指针，**指针路径本身不含版本**，与该表的 `current_version` 取值无路径关系；
  - prod（**无 `deploy_sites` 表**，清单 `source: new:error` 回落 legacy）→ 读 `deploy_deployments`，
    `current_version` **原样拼进 URL**，必须与磁盘目录逐字一致。

> 因此本次改动里 **gateway 一行代码都不需要改**：它只做字符串拼接，扁平只是少一层目录。

## 2. 改了什么（代码）

| 文件 | 变更 |
|---|---|
| `scripts/vite-micro-frontend.mjs` | `resolveMfBase` 不再强制 2 段；删除 `DEFAULT_PRODUCT_SEGMENT` 硬编码与 `MF_ALLOW_FLAT_BASE` 逃生舱；保留字段字符校验与「≤2 段」上限；JSDoc 写明两种合法形态的出处 |
| `scripts/build-module.mjs` | `releaseTag` 默认纯 `<commit>`；新增可选 `MF_BASE_NAMESPACE=<ns>` 恢复命名空间段 |
| `scripts/deploy.sh` | 第 22/151 行去掉 `MF_ALLOW_FLAT_BASE=1`（扁平已合法，无需逃生舱） |
| `docs/development/{admin-dev,deploy-pipeline-dev}.md`、`docs/architecture/micro-frontend-technical-design.md`、`specs/app-artifact-env-dir/design.md` | 更正过期描述（不再说"必带产品线段"），保留历史语境 |

## 3. 线上变更（已执行）

采用**双份共存 → 切指针 → 冗余段转备份**的顺序，全程无裂图窗口：

| 步骤 | 操作 | 验证 |
|---|---|---|
| 基线条 | — | `/static/modules/admin/default/d9889ff/index.js` 200，扁平路径 404 |
| ① 双份共存 | prod `cp -r <k>/default/d9889ff → <k>/d9889ff`（admin/portal） | 扁平 js/css 四条全部 200，MIME 正确 |
| ② 切指针 | prod `deploy_deployments.current_version` → `d9889ff` | 等 TTL（10s）后清单已指向扁平路径；`/` 与 `/admin/` 均 200 |
| ③ 冗余转备份 | `mv <k>/default → <k>/_default_backup_20260928` | 两侧页面 + CDN logo 复测 200 |

**回退路径**（30 秒内可完成）：把 `current_version` 改回 `default/d9889ff`，
并把备份目录名还原为 `default` —— 已验证旧路径在上一步仍可服务（备份期间目录内容未变）。

**dev 同步**：`deploy_app_env_versions`（真正在用的表）**未动**，仍为 `admin@dev=3d5ce61` /
`portal@dev=7a6be04`，入口指针指向 `./3d5ce61/index.js`、`./7a6be04/index.js`，完全符合新契约；
仅把无人消费的 legacy 行 `default/d9889ff` 同步为 `d9889ff` 以保持两表一致，
并把孤儿目录 `modules/{admin,portal}/default/` 转为备份。

## 4. 验证证据

```
构建  node scripts/build-module.mjs portal   # 扁平 tag，通过
      dist: index.js + index.css + manifest.json
      产物内 /static/modules/portal/** 引用 = 0；/static/cdn/pub/ 引用 = 87

解析  resolveMfBase('admin','4caf272')        → /static/modules/admin/4caf272/
      resolveMfBase('admin','default/4caf272')→ /static/modules/admin/default/4caf272/
      '' / 'a/b/c' / 'bad seg'                → 抛错（缺值 / 超两段 / 非法字符）

prod  /__manifest__ → portal d9889ff → /static/modules/portal/d9889ff/index.js
                      admin  d9889ff → /static/modules/admin/d9889ff/index.js
      / 200    /admin/ 200    /static/cdn/pub/logo.svg 200
dev   /__manifest__ → source=new, site=dev, byEnv['dev']=['admin','portal']
```

## 5. 遗留 / 建议（重要 1）

- **`deploy-console` 侧未改**：`pipeline.service.ts:2056 buildVersionRef(p.templateKey, commit)`
  与 `release-paths.ts buildReleaseRef` 仍会产出 `<templateKey>/<commit>`。
  这不是 bug（两段仍合法），但与"扁平常态化"的目标不一致，且该方位属 `src/pipeline/**`，
  按流程需单独一轮评审再动。**建议下次发布前确认流水线实际的 `templateKey` 取值**，
  避免又落出一层 `default/`。
- **prod 无新表**：prod 缺少 `deploy_sites` / `deploy_apps` / `deploy_app_env_versions`，
  清单走 `new:error` 回落。想让 prod 享受 env-dir 入口指针（切换环境无需改 DB/等缓存），
  需先补齐这几张表的初始化数据 —— 建议单独立项。
- 备份目录 `_default_backup_20260928`（dev/prod 各 ~9MB）保留 7 天无异常后再清理。
