# D3 实现一致性评审 · 存储配置扩展「临时图目录」

阻塞: 0

- 日期：2026-11-03
- 关联原型：`docs/ui/prototypes/deploy-console-domain.html` → `dc-settings` 屏（本轮原型无改动，沿用既有存储配置卡）
- 页面规格：`specs/backend-consolidation/page-spec-storage-config.md`（本轮增补「临时图目录」段）
- 后端：system-service `servers/system-service/src/storage/*`
- 前端：`apps/deploy-console/src/components/StorageConfigCard.vue` + `src/api/index.ts`

## 1. 需求回顾

部署形态改造（PR #531）把「上传根目录」统一到系统配置表之后，
**临时图目录仍是独立口径**：ai-service 用 `process.cwd()/temp-images`，
而 `cwd` 是 pm2 的启动目录 —— 换个启动方式目录就换（11-03 实测 prod 的 `pm_cwd` 曾为 `/data/web_system`）。
这正是用户点名的漂移形态：「用单服务的路径去接受微服务的请求」。

本轮把它补成平台配置键 `storage.temp_dir`，并让控制台可看、可改。

## 2. 交互与原型对照

| 原型 / 规格 | 实现 | 一致性 |
|---|---|---|
| 双值区：当前生效 vs 待生效 | 上传根目录保留双值（effectivePath 由 system-service 代问）；临时图目录只有权威值（尚无消费服务上报生效值），标签明说「待生效」 | ✅（超出部分：多一行临时图目录） |
| 目录选择器（目录树 / 手动输入） | 两个目标共用同一套选择器，用「编辑目标」单选切换 | ✅ |
| 校验结果块（resolvedPath / exists / writable / freeSpace / code） | 复用同一块，标题带上当前目标名 | ✅ |
| 保存按钮默认 disabled + 原因文案 | `canSave` 要求「改过且校验通过」，底部 `saveHint` 明说卡在哪个目录 | ✅ |
| 「使用默认目录」link | 按目标分别填 `defaultDir` / `defaultTempDir` | ✅ |
| 待重启提示条 | 文案改为「服务只在启动时读取该配置」（原写死 upload-service，现两个服务） | ✅ |

## 3. 设计决议（含为什么）

1. **派生默认取「上传根目录的同级」而不是「uploads 之下」**
   dev / prod 存量都是 `/data/web_system/temp-images`，与 `/data/web_system/uploads` **同级**。
   若默认落在 `<uploads>/temp-images`，存量临时图会全部 404（11-02 刚踩过同类坑），
   且每次部署都得靠「记得补配置键」兜底 —— 默认就该落在存量位置。

2. **页面必须区分「已配置」与「用的是派生默认」**
   派生默认值会随上传根目录变化。若页面把它显示成「已配置」，
   运维改了 uploads 后会产生「临时图目录怎么也跟着变了」的困惑。
   故后端回 `tempConfigured`，未配置时打「未配置（随上传根目录变化）」标签。

3. **两个目录先全校验、再一起落库；`tempDir` 省略 = 不改动**
   只校验一半就写库会产生「上传目录已改、临时图目录被拒」的半改状态；
   而「不提交」不能解释成「清空」——否则一次只改一个目录的保存会误删另一个键。

4. **内部接口 `?key=` 必须走白名单**
   `system_configs` 里还有审批环境等其它平台配置；能查任意键等于把配置表整体暴露成内部 API。
   未知键 400 `STORAGE_KEY_UNSUPPORTED`。

5. **只校验当前目标，不连带校验另一个**
   没改动的目录不该被拖着一起校验（它会凭空创建一个目录），
   校验结果还必须记住它对应的输入值（`checkedFor`），防止改了输入仍拿旧结果去保存。

## 4. 一致性判定与证据

| 项 | 证据 |
|---|---|
| 后端契约 | 单测 48 条全绿（system-service 全部存储用例，含新增 18 条） |
| 闸门有效（非假绿） | 变异验证 4 组：派生默认改到 uploads 之下 → 5 红；先写 upload 再校验 temp → 2 红；去掉键白名单 → 1 红；派生默认也标「已配置」 → 3 红 |
| 类型 / lint | `vue-tsc --noEmit` 通过（并验证过它确实能捕获类型错误）；eslint 0 error（仅存量 `any` warning） |

→ **阻塞: 0**，可带 `Design: pass` 进 UI 门。

## 5. 不在本轮范围

- ai-service / user-service 消费侧接入（把 `temp-images` 换成读配置）—— 见 W4；
- 内部接口对 `source=default` 的容忍策略（上传根目录拒绝启动 / 临时图目录允许派生默认）由 W4 在 shared 侧实现。
