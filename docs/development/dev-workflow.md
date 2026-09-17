# 开发流程：三区分离（2026-09-17 建立）

> 起因：用户指出此前改动是"在发布源目录里直接改、直接验"的 —— 分支流程有，
> 但**没有隔离的调试环境**：开发目录 = 发布源，端到端验证直接打在本机生产（6200 / 真库）上。
> 本文档固定三区分离的做法。

## 1. 三个区

| 区 | 路径 | 用途 | 禁忌 |
|---|---|---|---|
| **开发** | `~/workspace/web_system_dev`（git worktree） | 写代码、跑单测、建分支、提交 PR | ❌ 不要跑 `publish-deploy-console.sh`（它会动线上服务） |
| **发布源** | `~/workspace/web_system`（只留 master） | 合并后从这里构建发布 | ❌ 不要在上面开发/切分支改代码 |
| **影子库** | MySQL `web_system_deploy_shadow` | 演练数据库改动 | ❌ 不要把应用指到它上面跑 |

## 2. 日常步骤

```bash
# ① 开发：在 worktree 里建分支
cd ~/workspace/web_system_dev
git checkout -B feat/xxx master

# ② 自测（只跑受影响的套件，最后再全量）
cd servers/deploy-console && npx jest src/<受影响的目录>
cd apps/deploy-console  && npx vue-tsc --noEmit -p tsconfig.json

# ③ 涉及数据库改动 —— 先在影子库演练
cd ~/workspace/web_system
node scripts/db-shadow.mjs create                                   # 复制结构+数据
node scripts/db-shadow.mjs run migrations/pX-xxx.mjs                # 演练（真库不动）
node scripts/db-shadow.mjs status                                   # 对比
#   通过 → 申请时间窗口 → 停服务 → 真库执行 → 发布 → 验证

# ④ PR：分支 → CI（L1 结构 / build+test / 红线扫描）→ squash 合入 master
# ⑤ 发布：只在发布源做
cd ~/workspace/web_system && git pull --ff-only && ./scripts/publish-deploy-console.sh
```

## 3. 真机验证要申请窗口

下面这些会**真的重启服务或改真数据**，做之前先跟用户约时间，不要随手执行：

- 重建/重启任何 pm2 进程（gateway 重启 = 所有微前端与 API 短暂不可用）
- 数据库 `RENAME` / `UPDATE` / 删表
- 跑完整发布流水线（会经过审批挂起，且会替换线上 dist）

## 4. worktree 初始化备忘

新 worktree 首次使用需要：

```bash
cd ~/workspace/web_system_dev
pnpm install --frozen-lockfile        # 15s 左右（命中缓存）
pnpm --filter @web-system/shared build # 内部包产物，否则 jest 报 TS2307: Cannot find module '@web-system/shared'
```

## 5. 收尾

- 交付前 `git status` 必须干净（临时脚本用完即删，不要留在仓库里）
- 迁移类脚本必须**幂等可重跑**，并在脚本头部写清回滚方式
