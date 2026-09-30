# portal 发布 prod 修复（2026-09-24）— 事项清单

会话上下文：portal 流水线发 prod 失败，本机 vite 排查 + 远端 DB 改动落地。
本文件只做**事项梳理与跟踪**，不写自动化脚本——所有 DB 改动已通过 `/tmp/portal_db_update.mjs`（临时一次性）手工完成。

---

## 1. 已完成（DB 数据改动 · 不动工程代码）

| # | 动作 id | 名字 | 改动 | 旧→新 |
|---|---|---|---|---|
| 1 | `c64d30e2-d629-4383-bb26-046af3aa72f3` | 预构建依赖包（平台托管） | 开头加 `mkdir -p` + `ln -sfT` 建 `@web-system/ui` 软链（vite resolve 兜底） | 429→728 chars, 10→14 lines |
| 2 | `f5df0fb3-fd98-4cc8-a6c0-5b435c23704c` | 构建（平台托管） | TAG_ENV 公式统一 envId 段：`TAG_ENV="${DEPLOY_ENV:?}/${COMMIT_ID##*/}"`（dev/prod 也走 envId，与远端落盘一致） | 828→885 chars, 15→16 lines |
| 3 | `0974bdd4-8c31-461c-8198-1b49fa5e9ba5` | write-version · 写版本记录（prod） | curl body JSON `\"` 转义修复 | 883→908 chars, 19 lines |

**mark 字段**：`portal-prod-fix-2026-09-24`（写在每个新脚本的注释里），便于幂等判断。

**备份**：`/tmp/portal-actions-backup-2026-09-24T09-12-02-727Z.json`
（含旧脚本全文 + action id，可写回原值）。

---

## 2. 待验证（人工）

| # | 项 | 预期 | 失败信号 |
|---|---|---|---|
| 1 | 重提 portal `prod` 发布 | 流水线跑通，状态 success | 构建/投递任一动作失败 |
| 2 | 检查 `[hook:deps]` 日志 | 输出"@web-system/ui 依赖包构建完成"，且**软链已建** | 没软链兜底仍 vite resolve fail |
| 3 | 检查 `[hook:build] RELEASE_TAG` | 值形如 `prod/<7位commit>`（不再是 `portal-dev/<commit>`） | 仍是 `portal-dev/<commit>` 表示 build 动作没生效 |
| 4 | 检查堡垒机 dist/产物 | `dist/index.css` 内联含 tokens.css 内容 | 404 或空 CSS bundle |
| 5 | 远端 nginx `/static/modules/portal/prod/<commit>/` | 目录存在 + `index.js` 200 | 404 表示 scp 没投递 |
| 6 | `__manifest__` 远端 byEnv 加载 | `prod` 环境指向 `prod/<commit>/index.js` 200 | 仍指向 `portal-dev/...` 表示 VER 没改 |
| 7 | write-version API | `POST /internal/release/versions` 返回 201 | 400 表示 JSON 还是坏的 |

---

## 3. 待检查（其它流水线的同问题扫描）

> 排查是否还有别的流水线有同样 883 字符 write-version 脚本。

| # | 检查项 | 方法 |
|---|---|---|
| 1 | 全库扫 `deploy_pipeline_actions.script`，匹配 `\.script = "{"moduleKey"`（裸 `{` 的 write-version 脚本） | SQL：`SELECT id, name, script FROM deploy_pipeline_actions WHERE script LIKE '%"d": "{"moduleKey"%'` |
| 2 | 检查 admin 流水线 prod task write-version | 同上 SQL + `WHERE task_id IN (SELECT id FROM deploy_pipeline_tasks WHERE step_id IN (SELECT id FROM deploy_pipeline_steps WHERE pipeline_id='tpl-admin'))` |
| 3 | 检查其它微前端流水线（shell/mcp-admin/...） | 同上 |

> **已知修复范围**：仅 portal pipeline。其它流水线如有同样 JSON 转义缺失，沿用 `/tmp/portal_db_update.mjs` 同模式修复。

---

## 4. 后续观察（次要）

| # | 项 | 备注 |
|---|---|---|
| 1 | nginx 远端 `/static/modules/portal/` 实际目录布局 | 用户提到"为什么 local dev 能过"——可能远端实际有 `portal-dev/`、`dev/`、`prod/` 多份历史产物，需 SSH 实地看 |
| 2 | 本机 portal/node_modules/@web-system 软链是否仍稳定 | 已确认存在（指向 `../../../../packages/ui`）；堡垒机 new clone 后靠新加的预构建软链兜底 |
| 3 | `pull.executor.ts` PREBUILD 清单漏 ui 是历史决议（`# 依赖谁、要不要先构建，是模块自己的事`）——不动 | 无 |
| 4 | `vite-micro-frontend.mjs` 没加 `@web-system/ui` alias（用户拒绝，相对路径怕落地机炸）——不动 | 无 |

---

## 5. 回滚路径

如上三处 UPDATE 引入新问题，单条还原：

```bash
node -e "
const fs = require('fs');
const backup = JSON.parse(fs.readFileSync('/tmp/portal-actions-backup-2026-09-24T09-12-02-727Z.json','utf8'));
const { Client } = require('mysql2/promise');
const mysql = new Client();
mysql.connect();
for (const r of backup) {
  mysql.query('UPDATE deploy_pipeline_actions SET script=? WHERE id=?', [r.script, r.id])
       .then(()=>console.log('REVERT', r.id));
}
"
```

或单条：
```sql
UPDATE deploy_pipeline_actions SET script=(旧值) WHERE id IN (
  'c64d30e2-d629-4383-bb26-046af3aa72f3',
  'f5df0fb3-fd98-4cc8-a6c0-5b435c23704c',
  '0974bdd4-8c31-461c-8198-1b49fa5e9ba5'
);
```

---

## 6. 关联文档

- `scripts/migrations/p22-app-env-dir-artifact.mjs` — env-dir 约定（方案 A）的来源
- `servers/deploy-console/src/pipeline/steps/pull.executor.ts:21-27` — PREBUILD 清单的"模块级依赖不进"约束
- `apps/portal/src/lifecycle.ts:12-14` — `tokens.css` `theme.css` 直指 src 的设计注释
- `packages/ui/package.json:8-17` — ui 包 exports 声明（`./tokens.css: ./src/tokens.css`）
- `vite-micro-frontend.mjs:48-83` — `resolveMfBase` 对 RELEASE_TAG 段位的强制校验

---

**最后状态**：DB 改动已就位，等待人工重提 portal prod 验证。