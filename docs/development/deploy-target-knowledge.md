# 模块域归属与部署方式（运维知识库）

> 建立：2026-09-20 ｜ 性质：**开发 / 维护 / 运营层面的知识**，与系统架构和功能无关
> 相关：`docs/development/local-dev-guide.md §3.2`、`local-release-runbook.md`

---

## 0. 先说边界

- **流水线（发布）**：只负责**构建并发布代码** —— 拉码 → 构建 → 投递产物 → 写版本记录
- **部署（生效）**：让产物真正生效，由**对应域的接口**完成（应用切指针 / 服务重启 + 探活）
- **系统不做"域归属"判断**：哪个模块是应用、哪个是服务，是**静态事实**，维护在本文件；
  流水线按**脚本 / 配置**决定部署动作，代码里不写 if/else 分流

> 历史教训：曾把「按 `moduleType` 判断前后端」写进流水线，
> 而 `moduleType` 从未写入流水线实体 → 后端服务永远被判成应用、部署静默跳过。
> 这类判断不该进系统，应由配置/脚本显式表达。

---

## 1. 应用域（`deploy_apps`）—— 部署 = 切入口指针

| key | kind | deployMode | 仓库目录 | 生效方式 |
|---|---|---|---|---|
| `admin` | micro-frontend | `env-dir` | `apps/admin` | 切 `<key>/<envId>/index.js` 指针 |
| `portal` | micro-frontend | `env-dir` | `apps/portal` | 同上 |
| `shell` | shell | `site-version` | `apps/shell` | 基座，按站点 + 版本加载 |
| `mini-contract` | mini-app | `site-version` | `apps/mini-contract` | 同上 |

- `env-dir`：产物目录 `<key>/<envId>/<版本>/`，入口指针固定不含版本 → 切版本只改磁盘指针
- `site-version`：基座类，按站点 + 版本目录（不参与环境切换）

**接口**：`POST /api/apps/:key/switch` `{ envId, version }`（另有 `/rollback`）

---

## 2. 服务域（`deploy_services`）—— 部署 = 重启 + 探活

| key | kind | pm2 进程名 | 发布通道 |
|---|---|---|---|
| `gateway` | nest | `web-gateway` | managed |
| `auth-service` | nest | `web-auth` | managed |
| `user-service` | nest | `web-user` | managed |
| `system-service` | nest | `web-system` | managed |
| `ai-service` | nest | `web-ai` | managed |
| `ai-agent` | nest | `web-ai-agent` | managed |
| `mcp-gateway` | mcp | `web-mcp-gateway` | managed |
| `content-hub` | nest | `web-content-hub` | managed |
| `upload-service` | nest | `web-upload` | managed |
| `todo-service` | nest | `web-todo` | managed |
| `knowledge-service` | nest | `web-knowledge` | managed |
| `deploy-console` | nest | `web-deploy-console` | **legacy**（传统发布，不走流水线） |

**接口**：`POST /api/services/:key/deploy` `{ envId }`（重启进程 + 探活；未配目标主机会 fail-fast）

---

## 3. 在流水线里接部署（脚本示例）

部署不是流水线内置动作，而是在**流水线脚本**里显式调用接口：

```bash
# 应用（前端）：切指针
curl -sS -X POST http://127.0.0.1:6200/api/apps/admin/switch \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"envId\":\"local\",\"version\":\"${COMMIT_ID##*/}\"}"

# 服务（后端）：重启 + 探活
curl -sS -X POST http://127.0.0.1:6200/api/services/gateway/deploy \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"envId":"local"}'
```

也可在控制台操作：「应用 → 环境 → 切换版本」「服务 → 部署」。

---

## 4. 维护约定

1. **新增模块**（应用或服务）时，同步更新本文件的对应表格
2. 表格是**给人看的知识**；系统真相源仍是 `deploy_apps` / `deploy_services` 两张表
   —— 两边不一致时以表为准，并回来修正本文件
3. 不要把域归属判断写进代码；需要分流就在流水线脚本 / 模板配置里显式表达
