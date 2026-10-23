# 事故复盘：content-hub「发布模式」功能发布连撞三坑（2026-10-23）

> 格式：`~/AiWorkspace/20-私域资产/事故复盘规范.md`（总控规范）
> 可复用判据/命令已抽出：`排障速查-content-hub发布-2026-10-23.md`

## 一句话

给公众号发布加「草稿 / 正式发布」两种模式，功能改动本身一次通过，
但**发布过程连撞三个环境坑**（缺列、产物不可变、磁盘满），同一 commit 发了三次才成功。

## 时间线（dev）

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| 1 | restart 动作失败：`Runtime did not become healthy` | 实体加了 `publish_mode` 字段，但 **dev 库也没这列**（dev 的 `.env` 里 `NODE_ENV=production` → synchronize 关闭）→ 查询 1054 | 备份单表后 `ALTER TABLE` 补列 |
| 2 | 「发布」动作失败：`Immutable runtime version already exists with different content` | 首次发布留下半截产物，重发时 payload sha 与首次不一致 | 删掉该 commit 的 runtime/servers 产物目录后重发 |
| 3 | preflight FAIL：`磁盘 96% 可用 2033M（<2G）` | dev 机 50G 盘被历史 runtime 版本 + /tmp 构建残留占满 | 删 3 个非在用版本（840M）+ /tmp 残留（420M） |
| 4 | 第三次发布 | — | `verdict=verified` → `96626cec` |

prod 侧因为**先跑了迁移再加列**，一次通过（content-hub + admin 均 verified）。

## 根因（为什么会发生）

1. **「dev 有 synchronize 兜底」是错觉**：判断依据是 `NODE_ENV !== 'production'`，
   而 dev 机的 `.env` 恰恰写的是 `production`。加字段 → **dev 和 prod 都要写迁移**，没有例外。
2. **失败产物没有自清理**：首次失败的 runtime 目录留着，重发时 sha 比对必然不等。
3. **磁盘是发布的前置资源，不是运行时问题**：preflight 已经能查出来，
   但清理动作（删历史版本）此前没有固化成文档动作。

## 做对了什么

- 加列前先 `mysqldump` 单表备份（dev/prod 各一份），ALTER 用幂等判断（列存在则跳过）。
- 第一次 restart 失败没有靠猜，而是 `pm2 logs` 的 error 文件定位到 `ER_BAD_FIELD_ERROR`。
- 删历史版本前先 `readlink dist` 确认在用版本，只删非在用目录。

## 改进项

| 优先级 | 事项 | 状态 |
|---|---|---|
| P0 | 加实体字段一律写迁移 SQL（dev/prod 都跑），不依赖 synchronize | 已沉淀到排障速查 §1 |
| P1 | 发布失败后重发同一 commit：先清该 commit 的 runtime 产物 | 已沉淀 §2 |
| P1 | dev 机磁盘常态化清理（历史 runtime 版本只保留在用 + 上一个） | 待做（本次是人工清） |
| P2 | 流水线在 restart 失败时把 `pm2 logs` 尾部带进 error，减少一次 ssh | 待提（deploy-console） |
