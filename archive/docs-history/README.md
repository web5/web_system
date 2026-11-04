# 历史快照归档（archive/docs-history/）

> 🔴 **本目录全部为历史快照，不承载当前事实**。全仓事实检索 / grep 必须排除 `archive/`：
> `grep -R --exclude-dir=archive ...`（门禁命令见 `~/AiWorkspace/20-私域资产/记忆索引化验收规范.md` §5）。

- 归档日期：**2026-11-04**；共 **80 份 / 915173 B**，正文逐字节未改动（与 git 原文逐份核对）。
- 目录结构与归档前一致：`docs/…`、`specs/…`（按原相对路径存放）。
- 原位置保留同名**纯指针桩**（3 行，指向此处），旧链接不会断；git 历史亦可恢复。
- 改前全文备份：`~/WorkBuddy/chase 个人 AI 工作空间/30-任务产物/2026-11-04-web_system文档治理/backup/史料归档前/`。
- ⚠️ 归档时踩到 macOS 大小写坑：3 份 `HANDOFF.md`/`handoff.md` 同 inode 被重复处理，正文一度被桩覆盖，
  已用 `git show HEAD:<path>` 逐份恢复并核对字节数；去重后实数 **80 份**（不是初次统计的 83）。
- 当前事实唯一入口：`docs/INDEX.md`（按问句 → 真源）→ `README.md` / `~/skills/web-system-deploy/SKILL.md`。
- 史料里的 60+ 行旧口径（3000 系端口、`apps/admin-web`、`POST /api/pipelines`、`scp` 手工部署）**刻意不改写** —— 改了就破坏史料；靠物理隔离 + 边界声明保证不污染检索。

## 归档范围判据（与 `docs/INDEX.md` §2 一致）

`docs/plans/**`、`docs/reviews/**`、`docs/development/release-reviews/**`、`docs/development/reports/**`、
`docs/operations/` 带日期验收/快照与 2026-09 迁移手册、`docs/development/` 的 `*review*` / `*todo*` /
`*handover*` / 迁移与路线图快照、`specs/*/tasks.md`、8 份 HANDOFF/HANDOVER、根 `handover-20260922.md`。

**不在归档范围**：41 份 `specs/*/design.md`（设计定稿，属规格）、常青手册与判据清单、
`.workbuddy/memory/2026-*.md`（append-only 日志，属记忆系统，移走会破坏注入链）。
