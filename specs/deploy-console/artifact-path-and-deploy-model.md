# 产物路径与部署模型（解耦环境）：设计文档

> 状态：**设计（未实现）** —— 2026-09-17 用户定调，实现待确认后排期。
> 关联：`specs/pipeline-node-model/design.md`、`specs/deploy-console/pipeline-naming.md`、
> `specs/deploy-console/gateway-and-shell-versioned-release.md`

## 1. 背景与问题

现状（实测 + 代码证据）：

| 现象 | 证据 |
|---|---|
| 一个模块有 **3 条流水线**（local / dev / prod），内容几乎相同 | `scripts/migrations/p5-…mjs` 为每个模块 × 3 环境各建 `tpl-<key>-<env>` |
| 三条的差异**只有投递变量** | 同文件：local 只写 `PUBLISH_PATH`（本机路径），dev/prod 追加 `PUBLISH_HOST` / `PUBLISH_USER`；节点序列与 actions 三条完全一样 |
| 投递路径**硬编码在流水线变量里** | `pipeline.service.ts` 注入 `BUILD_OUTPUT_DIR` / `ARTIFACT_DIR`；`PUBLISH_PATH` 来自流水线变量表 |
| 产物目录分裂成两套 | 前端类 `servers/gateway/public/static/modules/<key>/<版本>/`；后台类 `servers/<dir>/<版本>/` |
| 部署目标由流水线隐式决定，用户看不到产物 | 部署（含新增的 `apply`）直接按 `versionTag` 找目录落地，中间没有"选产物"环节 |

**问题本质**：流水线（流程定义）里混进了"投到哪台机器的哪个目录"这种**环境/部署**信息，于是同一个流程复制三份；而部署环节又缺少"这次到底部署哪个产物"的显式确认。

## 2. 目标模型（用户 2026-09-17 定调）

三个解耦：

```
① 模块自持部署位置     模块定义「部署根路径」—— 环境不再参与路径决策
② 流水线按环境投递产物  build / 发布动作按 env 把产物放到「该环境的产物区」，不直接落进服务目录
③ 部署 = 独立确认动作   模块 + 环境 + 版本 → 列出产物路径 → 用户确认 → 部署
```

### 2.1 目录约定（示意）

```
产物区（只存，不生效）
  <artifactsRoot>/<moduleKey>/<env>/<版本引用>/        ← 流水线投递到这里，env 只是一层目录
        ├─ dist/                （后台常见）
        ├─ index.js / index.css  （前端常见）
        └─ …                     （可能多个候选产物）

部署区（模块自持）
  后台：  <模块.deployRoot>/dist          ← 把选中的产物路径内容落到这里 + 重启
  前端：  <模块.deployRoot>/<版本引用>/    ← 切指针即可（网关按指针读）
```

### 2.2 部署动作

```
1) 列出产物：GET /deploy/artifacts?moduleKey&env&version
   → 返回该版本目录下**相对模块根**的产物路径列表（dist/、index.js、static/…）
2) 用户确认：在控制台选中"这次要发布的产物路径"（可记住为模块默认值）
3) 执行部署：POST /deploy/deploy  { moduleKey, env, version, artifactPath }
   → 后台：把 <产物区>/<artifactPath> 落到 <deployRoot>/dist + 重启
   → 前端：指针切到 <版本引用>（产物路径即版本目录，无需拷贝）
```

## 3. 数据模型改动

| 对象 | 改动 |
|---|---|
| `deploy_modules` | 新增 **`deployRoot`**：模块部署根路径（相对发布目录根，如 `servers/gateway`）；本机/远端同构，环境不参与 |
| `deploy_modules` | 新增可选 **`defaultArtifactPath`**：部署时默认选中的产物相对路径（首次由用户确认后记住） |
| 流水线变量 | `PUBLISH_PATH` / `PUBLISH_HOST` / `PUBLISH_USER` **停止新增**；改由平台按 `模块.deployRoot + env + 版本` 推导 |
| `deploy_pipelines`（模板） | `env` 语义扩展：`null` = 不限环境（一条流水线可跑多环境）；提交校验从"env 必须相等"改为"环境允许" |
| 部署记录 | 记录本次 `artifactPath`（可追溯：这次部署的到底是哪个产物） |

## 4. 与已实现能力的衔接

- **`apply`（部署生效，2026-09-17）**：执行体 `DeployService.deployVersion()` 不变，入参从
  `versionTag` 扩展为 `versionTag + artifactPath`（缺省用模块默认值） —— 控制台按钮与流水线
  仍共用同一执行体，行为不分叉。
- **产物守卫（`assertArtifactUsable`）**：继续生效，且校验对象变为**选中的产物路径**（而不是笼统的版本目录）。
- **构建前清理（`cleanBuildOutputDir`）**：不变。
- **表名与命名（`deploy_pipelines` / `deploy_pipeline_runs`）**：不变。

## 5. 迁移步骤（建议顺序，每步可独立回滚）

| 步 | 内容 | 风险 | 回滚 |
|---|---|---|---|
| M1 | `deploy_modules` 加 `deployRoot` / `defaultArtifactPath` 两列 + 按现有路径回填 | 低（加列） | 删列 |
| M2 | 平台按 `deployRoot + env` 推导投递目标；流水线变量**仍优先**（兼容旧模板），无变量时才用推导 | 低（双轨） | 关掉推导开关 |
| M3 | 新增「列出产物 / 选产物部署」接口与 UI；旧路径（直接按 versionTag 部署）保留为默认分支 | 中 | 前端回退到直接部署 |
| M4 | 合并流水线：48 → 16 条（`env=null`），节点命令与变量按新模型整理；**先在影子库演练** | 高（数据迁移） | p9 式备份 + RENAME 回滚 |

M1–M3 可日常迭代；**M4 需要时间窗口 + 影子库演练**（`scripts/db-shadow.mjs`）。

## 6. 收益

- 改流程只改一次（现在改一个节点要改三处）
- 新增模块**零投递变量配置**（目录由模块自持推导）
- 部署前能看见"这次发布的是什么" —— 从"跑完才知道"变成"确认后再发"
- 一条流水线跑多环境成为可能（配合环境级启用矩阵，见 §7）

## 7. 部署目标：本地目录 / 远程目录 / **CDN**（2026-09-17 追加）

用户追问"落地目录是远程 CDN 呢" —— 这是一个必须单独建模的场景：

- `deployRoot` 只表达**目录**语义；CDN 没有目录、不能"落地+重启"，多出三件事：
  **上传对象 / 对象前缀 / 访问 URL（与缓存）**
- 现状只有 `entryUrl` 注释里预留了 COS（"完整入口 URL（COS 时覆盖）"），**没有任何上传实现**

### 7.1 统一模型：`deployTarget`

| 类型 | 适用模块 | 部署动作 | 回滚 |
|---|---|---|---|
| `local-dir` | 后台（dist + 重启）、前端（切指针） | 本机拷贝 | 切回旧版本 |
| `remote-dir` | 同上（ssh 投递） | 打包 → scp → 落地/切指针 | 切回旧版本 |
| **`cdn`** | **仅前端类/静态产物**（代码不能放 CDN 跑） | 上传对象到 `<prefix>/<版本>/` → 切指针 → 访问 URL 生效 | 切回旧版本（旧对象须保留） |

模块侧新增：`deployTarget` + CDN 配置（`bucket` / `region` / `prefix` / `baseUrl`）。
**凭据不进模块表** —— 走配置中心（与环境级配置同一套机制）。

### 7.2 CDN 与"选产物路径"仍然自洽

CDN 下"产物路径"就是**对象前缀内的相对路径**（`index.js` / `dist/` / `static/…`），
§2.2 的"列出产物 → 用户确认 → 部署"流程不变，只是落地介质从文件系统换成对象存储。

### 7.3 一个顺带的好处：版本化路径天然避缓存

因为产物 URL 里**含有版本号**（`<baseUrl>/<prefix>/<版本>/index.js`），
每次发布都是**新 URL** → CDN 不需要刷新缓存（purge）；需要刷新的只有"指针/清单"本身
（如果用清单方式引用入口）。这也是坚持"版本目录 + 指针"而不是"覆盖式发布"的回报。

### 7.4 CDN 落地需要补的东西

- 上传实现（对象存储 SDK / CLI）+ 凭据接入配置中心
- manifest 注入：现在 gateway 注入的是相对路径 `/static/modules/...`，CDN 时要能输出**绝对 URL**
  （与 `entryUrl` 字段对上）
- 旧版本对象清理策略：**有指针引用的版本不能删**（否则无法回滚）

## 8. 待确认（实现前必须拍板）

1. **产物路径相对什么**：相对版本目录（`dist/`）还是相对模块根？—— 影响"列出产物"的实现与展示
2. **后台是否固定落到 `dist`**：还是允许模块指定目标子目录（如 `public/`）
3. **前端类是否仍是"切指针"**：若是，则"选产物路径"对前端其实退化成"选版本"，是否还需要这一步
4. **远端怎么办**：产物由流水线投递到远端产物区，还是部署时从本机推到远端？（决定 `deployRoot` 在远端是否需要另一套值）
5. **一个版本多个产物时**：单选还是多选？（如 admin 有 `index.js` + `static/`）
6. **自动 vs 人工确认**：流水线内的 `apply` 是否仍自动生效（用默认产物路径），还是一律改为人工确认后再部署
7. **环境级启用矩阵**：合并成一条后，如何表达"prod 暂不发布"（需要 流水线 × 环境 的开关）

9. **CDN 是否在本次范围**：先用 local-dir / remote-dir 落地，CDN 留到 M3 之后作为第三种 target？
10. **CDN 凭据放哪**：确认走配置中心（不在模块表存密钥）
11. **入口 URL 形态**：manifest 注入相对路径 vs 绝对 CDN URL（涉及 `entryUrl` 字段与 shell 基座取值）

### 已拍板（2026-09-17）

| # | 决策 |
|---|---|
| 9 | ✅ **CDN 不在本次范围**：先落 `local-dir` / `remote-dir`，CDN 作为 M3 之后的第三种 target |
| 10 | ✅ **凭据走配置中心**，模块表不存密钥 |
| 11 | ✅ **CDN 时 manifest 输出绝对 URL**（与 `entryUrl` 对上），本地/远程仍用相对路径 |

另：开工顺序确认为 **M1（加 `deployRoot` 字段 + 回填）→ M2（平台按 模块根 + env 推导投递目标，旧变量双轨优先）**；
实施前先出**模块原型交互稿**（模块部署设置 + 部署时选产物），见
`docs/ui/prototypes/module-deploy-target-prototype.html`。
