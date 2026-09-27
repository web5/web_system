# 发布评审报告 · prod upload-service 上线（2026-09-27）

```
阻塞: 0
重要: 1
```

> 触发面：`servers/upload-service/.env`（新建）+ 新增服务上线（pm2 + 端口 6008）
> 判据源：`docs/development/release-review-checklist.md`（A 运行面 / B 配置面 / C 数据面 / E 特殊通道）
> 目标：消除 `https://kedouai.com/api/upload*` 全量 502（upload-service 构建了但从未启动）

---

## 变更内容

| 项 | 值 |
|---|---|
| 发布目录 | `/data/web_system_git`（prod git 目录，HEAD `d9889ff`） |
| 服务 | `upload-service`，pm2 名 **短名 `upload-service`**（`ecosystem.config.js:193`，非 `.cjs` 的 `web-upload`） |
| 端口 | 6008 |
| 存储根 | `/data/web_system/uploads`（与 `system_configs.storage.upload_dir` 一致） |
| 新增文件 | `servers/upload-service/.env`（服务端，不入 git） |

---

## A 运行面

| # | 判据 | 取证 | 结论 |
|---|---|---|---|
| A1 | 构建发生在发布目录 | 在 `/data/web_system_git/servers/upload-service` 执行 `./node_modules/.bin/nest build`，`dist/main.js` 产出；pm2 `pm_cwd=/data/web_system_git` | ✅ |
| A2 | 发布目录 HEAD 与预期一致 | `git log --oneline -1` = `d9889ff` | ✅ |
| A4 | 端口占用者 == pm2 进程 | `lsof -ti tcp:6008` = `2609288`；pm2 pid = `2609288`，restarts=0 | ✅ 无孤儿进程 |
| A5 | 已在 ecosystem 登记 | `ecosystem.config.js:193 name:'upload-service'`，`script: ./servers/upload-service/dist/main.js` | ✅ |

> ⚠️ 踩坑记录：`pm2 start web-upload` 报 `Script not found` —— prod 的 pm2 用**短名**约定
> （`gateway`/`auth-service`…），`web-*` 那套定义在 `ecosystem.config.cjs`（本机约定，auth=6101）。
> **prod 用 `.js`，dev 用短名但定义在 `.cjs`**，两个文件服务名不同，启动前先 grep 确认。

## B 配置面

| # | 判据 | 取证 | 结论 |
|---|---|---|---|
| B1 | 不用 `pm2 restart --update-env` | 全新 `pm2 start ecosystem.config.js --only upload-service` | ✅ |
| B2 | 跨服务密钥一致 | `JWT_SECRET` / `INTERNAL_API_KEY` **取根 `.env.production` 同值**（未新生成随机值，否则 token 校验与内部互调全挂） | ✅ |
| B3 | 关键配置非缺失 | `MYSQL_*`、`JWT_SECRET`、`INTERNAL_API_KEY`、`SYSTEM_SERVICE_URL`、`STORAGE_UPLOAD_DIR`、`STORAGE_ALLOWED_ROOTS` 均配 | ✅ |
| B4 | 占位符密钥未被误判 | 无 `REPLACE_` 类占位符 | ✅ |
| B5 | 配置源唯一性 | 根 `.env.production` 含 `MYSQL_*`/`JWT_SECRET`/`INTERNAL_API_KEY`（ecosystem 注入，优先级更高），但与服务 `.env` **同值**，无冲突；`UPLOAD_DIR`/`PORT`/`CORS_ORIGINS` 根里没有 → 不被覆盖 | ✅ |

> ⚠️ 两个易错点（已规避）：
> 1. **`UPLOAD_DIR` 已弃用**——代码实际读 `storage.upload_dir`（system-service）→ `STORAGE_UPLOAD_DIR` → `~/web_system/uploads`，
>    写 `UPLOAD_DIR` 会被忽略并打印弃用告警。
> 2. **存储根必须显式放开**：允许根 = `os.homedir()` + `STORAGE_ALLOWED_ROOTS`，
>    `/data/web_system/uploads` 不在 `/root` 下 → 必须配 `STORAGE_ALLOWED_ROOTS=/data/web_system`，否则抛 `OUT_OF_SCOPE`。

## C 数据面

| # | 判据 | 取证 | 结论 |
|---|---|---|---|
| C1/C2 | 迁移必要性 | `upload_files` 实体存在，但 prod 库**表已存在**（`information_schema` 查询确认） | ✅ 无需迁移 |
| C4 | 按环境执行 | 未执行任何迁移 | ✅ |

## E 特殊通道

| # | 判据 | 取证 | 结论 |
|---|---|---|---|
| E3 | 变更后有验证 | ① 影子启动（7608）：启动日志正常、`/health` 200、上传根解析为 `/data/web_system/uploads`（来源 env）；② 正式启动后直连 `/health` 200、`/upload/categories` 返回分类数据；③ **经 gateway `https://kedouai.com/api/upload/categories` = 200**（原 502）；④ `pm2 save` 已固化 | ✅ |

---

## 重要（不阻塞，建议跟进）

| 项 | 现象 | 影响 | 建议 |
|---|---|---|---|
| I1 | 影子启动日志：`[UploadDir] 读取系统配置失败：system-service 返回 400，回落下一级` | 回落 env 得到的值与 `system_configs.storage.upload_dir` **一致**，当前无功能影响；但说明 system-service 的 `/internal/storage/path` 对本次调用返回 400 | 排查 400 成因（内部密钥 header 名 / system-service 版本），否则将来改系统配置不会生效，会静默用 env 值 |

---

## 结论

阻塞项清零，可以上线。上线后 prod 在线服务数 **9 → 10**，`restarts` 保持 0。
