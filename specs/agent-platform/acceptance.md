# Agent 平台 · 交互验收清单

> 范围：ai-agent / ai-service / user-service / mcp-gateway 权限、Agent 定义、Skill、Playground、运行记录、MCP 能力。
> 执行方式：A 类由测试 Agent 用 curl 自动执行断言；B 类需人工在浏览器操作。
> 最终：人工复核 A 类结果 + 执行 B 类后勾选确认。

---

## 0. 前置条件（测试 Agent 执行前必须完成）

| # | 项 | 检查方式 |
|---|----|---------|
| P1 | 服务健康 | `curl -s localhost:6000/__manifest__` 返回 admin/portal 模块；`pm2 list` 中 web-user/web-ai/web-ai-agent/web-mcp-gateway/web-gateway 均 online |
| P2 | 数据库就绪 | `permissions`=17 行、`roles`=3 行、`role_permissions`≥31 行；`agent_definitions` 有 3 个 seed agent；`agent_skills` 表存在 |
| P3 | 测试账号 | `admin/admin123`（admin 角色）、`test/test123`（viewer 角色）、editor 账号（若缺，人工创建后填入） |
| P4 | 网关路由 | `POST /api/ai-agent/agent/admin-run`、`/api/permissions/my`、`/api/admin/skills`、`/api/admin/permissions`、`/api/admin/roles` 均可达（非 404） |
| P5 | 测试数据 | 技能库有 1 个测试技能（code=web-system-paper）；验证残留（paper-bot 等）已删除 |

登录取 token（后续所有命令用）：
```bash
ADMIN_TOKEN=$(curl -s -X POST localhost:6000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
VIEWER_TOKEN=$(curl -s -X POST localhost:6000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"test","password":"test123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
```

---

## A. API 自动化验收（测试 Agent 执行，逐条 curl + 断言）

### A1. 权限体系

| ID | 验收点 | 命令/步骤 | 预期结果 | 通过标准 |
|----|--------|----------|---------|---------|
| A1.1 | admin 权限清单 | `curl -s localhost:6000/api/permissions/my -H "Authorization: Bearer $ADMIN_TOKEN"` | `code=0`，data 含 `roles:view/roles:manage/agents:debug/agents:manage/skills:manage` 共 17 项 | 17 项权限齐全 |
| A1.2 | viewer 权限清单 | 同 A1.1 用 `$VIEWER_TOKEN` | data 仅 5 项：`dashboard:view,logs:view,bianbian:view,agents:view,skills:view` | 不含 manage/debug 类 |
| A1.3 | viewer 读角色（应 403） | `curl -s -o /dev/null -w "%{http_code}" localhost:6000/api/admin/roles -H "Authorization: Bearer $VIEWER_TOKEN"` | HTTP 403 | =403 |
| A1.4 | viewer 新建 Agent（应 403） | `curl -s -X POST localhost:6000/api/agent-defs -H "Authorization: Bearer $VIEWER_TOKEN" -H 'Content-Type: application/json' -d '{"id":"acc-vtest","name":"v","systemPrompt":"x","model":"hy3","tools":[],"maxSteps":5,"memory":{"compactionThreshold":20,"keepRecent":6,"enabled":true}}'` | body `code=4030`（或 HTTP 403），且未创建 | 拒绝 + 无残留 |
| A1.5 | viewer 创建技能（应 403） | `curl -s -X POST localhost:6000/api/admin/skills -H "Authorization: Bearer $VIEWER_TOKEN" -H 'Content-Type: application/json' -d '{"code":"acc-skill","name":"x","description":"x","content":"x"}'` | `code=4030` | 拒绝 |
| A1.6 | viewer 调 admin-run（应 403） | `curl -s -X POST localhost:6000/api/ai-agent/agent/admin-run -H "Authorization: Bearer $VIEWER_TOKEN" -H 'Content-Type: application/json' -d '{"agentId":"contract-risk","userInput":"hi"}'` | `code=4030` | 拒绝 |
| A1.7 | 无 token 访问（应 401） | `curl -s -o /dev/null -w "%{http_code}" localhost:6000/api/admin/roles` | 401 | =401 |
| A1.8 | admin 建角色→更新→删除 | `POST /api/admin/roles` `{"code":"tester","name":"验收角色","permissions":["agents:view"]}` → `PUT /api/admin/roles/tester` → `DELETE /api/admin/roles/tester`（均用 ADMIN_TOKEN） | 三步均 `code=0`，删除后 `GET /api/admin/roles` 无 tester | 全通过 |

### A2. Agent 定义管理

| ID | 验收点 | 命令/步骤 | 预期结果 | 通过标准 |
|----|--------|----------|---------|---------|
| A2.1 | 列表 | `curl -s localhost:6000/api/agent-defs -H "Authorization: Bearer $ADMIN_TOKEN"` | 含 contract-risk/study-assistant/bianbian | ≥3 条，均含 `capabilities` 数组（老数据已迁移） |
| A2.2 | 新建（草稿） | `POST /api/agent-defs` `{"id":"acc-agent","name":"验收Agent","systemPrompt":"你是验收助手","model":"hy3","tools":[],"capabilities":[],"maxSteps":5,"temperature":0.7,"memory":{...}}` | `status=draft, version=0` | 草稿可查 |
| A2.3 | 配置 Capability | `PUT /api/agent-defs/acc-agent` 追加 `"capabilities":[{"type":"skill","ref":"web-system-paper","enabled":true}]` | 保存成功；`GET` 返回 capabilities 含该 skill，且 `skills` 目录已解析（name/description 非空） | capability 落库 + 目录解析 |
| A2.4 | 发布 | `POST /api/agent-defs/acc-agent/publish` `{"changeNote":"验收"}` | `status=published, version=1` | 发布成功 |
| A2.5 | 启停 | `POST /api/agent-defs/acc-agent/enabled {"enabled":false}` → `true` | 状态切换成功 | 两次都 code=0 |
| A2.6 | 版本历史 | `GET /api/agent-defs/acc-agent/versions` | 含 v1 记录 | 有记录 |
| A2.7 | 回滚 | `POST /api/agent-defs/acc-agent/rollback {"versionId":<v1 id>}` | version=2，内容=v1 | 成功 |
| A2.8 | 删除 | `DELETE /api/agent-defs/acc-agent` | `{ok:true}`，GET 404 | 删除成功 |
| A2.9 | 发布后 30s 生效 | 修改 contract-risk prompt → 发布 → `sleep 35` → 对话 | ai-agent 日志出现"同步完成，覆盖 N 个"且新对话用新 prompt | 同步日志 + 行为变化 |

### A3. Skill 库

| ID | 验收点 | 命令/步骤 | 预期结果 | 通过标准 |
|----|--------|----------|---------|---------|
| A3.1 | 列表 | `curl -s localhost:6000/api/admin/skills -H "Authorization: Bearer $ADMIN_TOKEN"` | 含 web-system-paper | 有数据 |
| A3.2 | 新建 | `POST /api/admin/skills` `{"code":"acc-skill","name":"验收技能","description":"测试","content":"## 守则\n不要编造","requiredTools":[]}` | `id` 返回，code 唯一 | 成功 |
| A3.3 | 重复 code（应 400） | 再次 POST 同 code | `code=4000` 或 HTTP 400 | 拒绝重复 |
| A3.4 | 更新 | `PUT /api/admin/skills/<id>` 改 name | 更新成功 | code=0 |
| A3.5 | 删除 | `DELETE /api/admin/skills/<id>` | `{ok:true}` | 成功 |
| A3.6 | 内部读取 | `curl -s localhost:6003/internal/skills/web-system-paper` | 返回 content 含 SKILL.md 前文 | 全文可取 |

### A4. Playground（admin-run）

| ID | 验收点 | 命令/步骤 | 预期结果 | 通过标准 |
|----|--------|----------|---------|---------|
| A4.1 | 基础对话 SSE | `curl -s -N --max-time 90 -X POST localhost:6000/api/ai-agent/agent/admin-run -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"agentId":"contract-risk","userInput":"你好"}'` | 收到 `content_delta` + `final`，header 为 event-stream | 事件序列含 final |
| A4.2 | 多轮 | 记下 A4.1 返回的 `conversationId`，再次请求携带 | 第二轮引用上下文，返回同一 conversationId | 上下文连贯 |
| A4.3 | on-demand 触发 | `{"agentId":"<挂载了 web-system-paper 的 agent>","userInput":"请查看今天有哪些最新论文"}` | 事件序列含 `tool_call(load_skill)` → `skill_load` → `tool_result` | 三事件按序出现 |
| A4.4 | 错误 agentId | `{"agentId":"no-such-agent","userInput":"hi"}` | `error` 事件或明确错误 | 有错误事件 |
| A4.5 | 落库 | A4.1 后查 `GET /api/agent-runs?agentId=contract-risk` | 列表新增该 run，`source=ai-agent` | 有记录 |

### A5. 运行记录

| ID | 验收点 | 命令/步骤 | 预期结果 | 通过标准 |
|----|--------|----------|---------|---------|
| A5.1 | 聚合概览 | `GET /api/agent-runs/agents` | 返回各 agent 总数/失败数/最近时间 | 结构正确 |
| A5.2 | 列表过滤 | `GET /api/agent-runs?agentId=contract-risk&page=1&pageSize=5` | `items` ≤5，`total` 正确 | 分页正确 |
| A5.3 | 详情 | `GET /api/agent-runs/<id>` | 含 `systemPrompt`/`steps`/`finalAnswer` | 字段齐全 |
| A5.4 | 关键字 | `GET /api/agent-runs?keyword=你好` | 命中包含该词的 run | 过滤生效 |

### A6. MCP 能力

| ID | 验收点 | 命令/步骤 | 预期结果 | 通过标准 |
|----|--------|----------|---------|---------|
| A6.1 | 模块列表 | `curl -s localhost:6006/api/modules -H "Authorization: Bearer $ADMIN_TOKEN"` | 返回 finnews/wechat_mp/paper/institution 等模块及工具 | ≥4 模块 |
| A6.2 | 无 key 调 MCP（应 401） | `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:6006/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'` | 401 | =401 |
| A6.3 | 工具调试 | `POST localhost:6006/api/debug` `{"base_url":"http://127.0.0.1:6007","method":"GET","path":"/api/market-pulse"}`（或用 MCP_CLIENT_KEY 调 `/mcp`） | 返回真实数据或明确错误 | 有响应非 5xx |
| A6.4 | 单模块入口 | 用有效 key 调 `POST /mcp/finnews` | 工具列表仅含 finnews 6 个工具 | 工具过滤正确 |

### A7. OCR

| ID | 验收点 | 命令/步骤 | 预期结果 | 通过标准 |
|----|--------|----------|---------|---------|
| A7.1 | 识别 | `curl -s -X POST localhost:6000/api/ai-agent/ocr/recognize -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"imageUrl":"<测试图url>"}'` | 返回文本或明确错误 | 有响应 |

---

## B. UI 人工验收（浏览器操作，人工确认）

| ID | 页面 | 验收动作 | 预期结果 |
|----|------|---------|---------|
| B1 | `/admin/agents` 概览 | 打开，看场景分组与统计卡片 | 按场景分组，卡片显示总数/失败/最近时间 |
| B2 | `/admin/agents` → 定义管理 | 打开列表，新建 Agent → 三 Tab 配置工具/MCP/Skill → 保存 → 发布 | 表单可用，发布后状态变"已发布" |
| B3 | 定义管理 → 勾选带依赖技能的 Agent | 技能 Tab 勾选 web-system-paper | requiredTools 自动带出且置灰 |
| B4 | `/admin/skills` 技能库 | 列表展示；新建技能；上传 zip 导入 | 导入后 frontmatter 解析正确 |
| B5 | `/admin/agents/playground` | 选 agent → 输入 → 发送 | SSE 时间线渲染，tool_call/skill_load 卡片可见，多轮连贯 |
| B6 | Playground → 原始数据 | 点"查看原始数据" | 跳转 Run 详情，steps 完整 |
| B7 | `/admin/settings/roles` | 编辑 editor 角色权限勾选 → 保存 | 勾选持久化，重新登录生效 |
| B8 | `/admin/users` | 编辑某用户角色 | 角色下拉可选，保存生效 |
| B9 | viewer 账号登录 admin | 用 test/test123 登录 | 菜单只见概览/技能库（无定义管理/无 Playground 入口）；直接输 URL 跳 403 |
| B10 | 菜单与路由 | viewer 访问 `/admin/agents/definitions`、`/admin/settings/roles` | 跳转 403 页 |

---

## 结果记录模板

```markdown
## 验收结果（执行者：<测试 Agent>，日期：____）
| ID | 结果(通过/失败/跳过) | 实际输出摘要 | 备注 |
|----|---------------------|-------------|------|
| A1.1 | | | |

## 人工确认区（用户填写）
| ID | 确认(✅/❌) | 备注 |
|----|-----------|------|
| B1 | | |
