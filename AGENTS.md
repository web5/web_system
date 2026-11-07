# web_system 工程 · Agent 协作纪律入口

> 多会话并行开发纪律**真源** → `docs/development/multi-agent-dev.md`
> 跨项目方法论（五层治理模型）→ `~/AiWorkspace/20-私域资产/Vibe Coding 治理规范.md`（尤其 ③ 执行隔离层）
>
> **在 web_system 仓库干活的 agent，进入本目录后必须先读这两份，再动手。**
> 不要在 `README.md` 或本文件复制纪律正文——正文在上方真源文件，本文件只做指针。

## 核心铁律（速记，详情见真源）

1. **一分支一 worktree**：当前 10 个 worktree 在跑（`git worktree list`）；主仓 `web_system` 停在 `feature/nce-lessons`，**不要在上面直接开发 / 抢 HEAD**。
2. **提交前 `git branch --show-current`** + **逐路径 `git add`（禁 `-A`）**。
3. **构建必须在自己 worktree 的 cwd**（防「构建源错位」：在发布源构建，分支改动进不了产物，且无报错）。
4. **禁 `kill -9` 共享服务** 6000(gateway) / 6200(deploy-console)；要重启先跟占用方打招呼。
5. **微前端四步铁律**：构建(mf) → 拷贝 → 改版本表 → 等 10s / 重启（见 `docs/development/admin-dev.md` §一·C）。

## 其他入口

- 本地开发总入口：`docs/development/local-dev-guide.md`
- AI 任务红线（UI / 发布 / 契约 / 代码评审门）：`docs/协作指令速查.md`
- 发布唯一入口：`web-system-deploy` skill（deploy-console 自身永远手动）
