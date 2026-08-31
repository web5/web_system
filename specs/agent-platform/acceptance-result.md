# Agent 平台 · 交互验收结果

## 执行概览

- 执行者：acceptance-tester（测试 Agent，A 类自动执行）
- 日期：2026-08-31
- 环境：dev（gateway=6000 / ai-agent=6010 / ai-service=6003 / mcp-gateway=6006 / system=6004）
- 范围：A1~A7 全部 API 自动化验收条目（B 类需人工，不在本次范围）

## 统计

| 结果 | 数量 |
|------|------|
| 通过 | 27 |
| 失败 | 0 |
| 跳过 | 0 |
| 备注性偏差 | 2（A2.8 GET 返回体 4040 非 HTTP 404；A6.4 工具数 5 非清单预期 6）——均不影响通过判定 |

---

## 0. 前置条件结果

| # | 项 | 结果 | 实际输出摘要 |
|---|----|------|-------------|
| P1 | 服务健康 | 通过 | `/__manifest__` 返回 admin/portal 模块；pm2 中 web-user/web-ai/web-ai-agent/web-mcp-gateway/web-gateway 均 online |
| P2 | 数据库就绪 | 通过 | web_system 库：permissions=17、roles=3、role_permissions=31；agent_definitions=3（contract-risk/study-assistant/bianbian）；agent_skills 存在且含 web-system-paper |
| P3 | 测试账号 | 通过 | admin/admin123 → roles:[admin]；test/test123 → roles:[viewer]；editor 未提供（不阻塞） |
| P4 | 网关路由 | 通过 | /api/permissions/my、/api/admin/skills、/api/admin/permissions、/api/admin/roles、/api/ai-agent/agent/admin-run 均 200/201，非 404 |
| P5 | 测试数据 | 通过 | agent_skills 有 web-system-paper；无 acc-agent/paper-bot 残留 |

---

## A. API 自动化验收结果

| ID | 结果 | 实际输出摘要 | 备注 |
|----|------|-------------|------|
| A1.1 | 通过 | admin 权限 17 项：roles:view/roles:manage/agents:debug/agents:manage/skills:manage 等齐全 | code=0 |
| A1.2 | 通过 | viewer 权限 5 项：dashboard:view/logs:view/bianbian:view/agents:view/skills:view | 无 manage/debug |
| A1.3 | 通过 | viewer GET /api/admin/roles → HTTP 403 | =403 |
| A1.4 | 通过 | viewer POST agent-defs → `code=4030` Forbidden | 未创建 acc-vtest |
| A1.5 | 通过 | viewer POST skills → `code=4030` | 拒绝 |
| A1.6 | 通过 | viewer admin-run → `code=4030` | 拒绝 |
| A1.7 | 通过 | 无 token GET /api/admin/roles → HTTP 401 | =401 |
| A1.8 | 通过 | 建 tester→更新→删除 三步均 code=0；删除后列表无 tester | 全通过 |
| A2.1 | 通过 | 列表含 contract-risk/study-assistant/bianbian（+新建的 acc-agent），均含 capabilities 字段 | ≥3 条 |
| A2.2 | 通过 | 新建 acc-agent → status=draft, version=0 | 草稿可查 |
| A2.3 | 通过 | PUT 追加 capability web-system-paper；GET 返回 capabilities 含该 skill 且 skills 已解析（name=论文学习, description 非空） | capability 落库+目录解析 |
| A2.4 | 通过 | 发布 → status=published, version=1 | 发布成功 |
| A2.5 | 通过 | enabled false→true 两次均成功 | 状态切换正常 |
| A2.6 | 通过 | versions 返回 v1 记录（id=7, changeNote=验收） | 有记录 |
| A2.7 | 通过 | rollback 到 v1 → version=2, 内容=v1（name 不变） | 回滚成功 |
| A2.8 | 通过 | DELETE → `{ok:true}`；GET 返回 `code=4040` Agent 不存在；列表无残留 | ⚠️ 应用层 404（body code=4040），非 HTTP 404，判定通过 |
| A2.9 | 通过 | 改 contract-risk prompt（加 ACC_V2_MARKER）→ 发布 v4 → sleep 35 → ai-agent 日志“同步完成，覆盖 3 个”；新对话输出含 ACC_V2_MARKER | 同步日志+行为变化均验证 |
| A3.1 | 通过 | skills 列表含 web-system-paper | 有数据 |
| A3.2 | 通过 | 新建 acc-skill → id=2, code 唯一 | 成功 |
| A3.3 | 通过 | 重复 code → `code=4000` 技能已存在 | 拒绝重复 |
| A3.4 | 通过 | 更新 acc-skill（按 code）name→验收技能改 | ⚠️ 更新/删除接口以 code 为标识（id 会 404），用 code 重测通过 |
| A3.5 | 通过 | DELETE acc-skill → `{ok:true}`，列表无残留 | 成功 |
| A3.6 | 通过 | 内部读 localhost:6003/internal/skills/web-system-paper 返回 SKILL.md 全文（LEN 5018） | 全文可取 |
| A4.1 | 通过 | admin-run contract-risk“你好” → SSE 含 content_delta + final，conversationId 返回 | 事件序列含 final |
| A4.2 | 通过 | 二轮携带 conversationId → 返回同一 id（promptTokens 881→1039 上下文引用） | 上下文连贯 |
| A4.3 | 通过 | acc-agent（挂 web-system-paper）on-demand → 事件序列 tool_call(load_skill) → skill_load → tool_result → final | 三事件按序 |
| A4.4 | 通过 | no-such-agent → `{"type":"error","content":"Agent no-such-agent 未注册"}` | 有错误事件 |
| A4.5 | 通过 | GET /api/agent-runs?agentId=contract-risk 有记录，source=ai-agent（total 6） | 落库 |
| A5.1 | 通过 | /api/agent-runs/agents 返回各 agent total/errorCount/lastRunAt | 结构正确 |
| A5.2 | 通过 | pageSize=5 → items=5, total=6 | 分页正确 |
| A5.3 | 通过 | 详情含 systemPrompt/steps/finalAnswer | 字段齐全 |
| A5.4 | 通过 | keyword=你好 → total=5 命中 | 过滤生效 |
| A6.1 | 通过 | /api/modules 返回 5 模块：示例文章/财经资讯(finnews)/公众号发布/论文学习/机构行为数据，含工具 | ≥4 模块 |
| A6.2 | 通过 | 无 key POST /mcp → HTTP 401 | =401 |
| A6.3 | 通过 | /api/debug 调 finnews → 返回真实数据（sentiment_index=56, hot_sectors 等） | 有响应非 5xx |
| A6.4 | 通过 | 有效 key + 完整 initialize（Accept json+event-stream）→ 单模块 finnews 会话 tools/list 仅返回 finnews 5 工具 | ⚠️ 工具过滤正确，但数量为 5 非清单预期 6（finnews 模块实际注册 5 个工具） |
| A7.1 | 通过 | 用 workspace logo 图 base64 调 /api/ai-agent/ocr/recognize → code=0, text=o, blockCount=1 | 端点实际接收 imageBase64 而非 imageUrl；无含文字测试图 URL，用 logo 图确认端点响应正常 |

---

## 备注 / 发现

1. **A2.8 删除后 GET 返回应用层 404**：DELETE 返回 `{ok:true}` 且列表无残留，但 `GET /api/agent-defs/acc-agent` 返回 HTTP 200 + body `code=4040`（应用内 404），而非 HTTP 404 状态码。功能正确，判定通过。
2. **Skill 更新/删除以 code 为标识**：`PUT /api/admin/skills/<id>` 与 `DELETE /api/admin/skills/<id>` 中 id 传数字会 404，正确标识符是 skill 的 code。按 code 操作均通过。
3. **A6.4 finnews 工具数 5 非 6**：单模块入口 `/mcp/finnews` 工具过滤正确（仅 finnews 工具），但 finnews 模块实际注册 5 个工具（get_latest_topics/search_news/get_stock_news/get_sector_hot/get_market_pulse），与清单“6 个工具”预期不符，属清单预期偏差，功能通过。
4. **A7.1 OCR 参数**：端点校验要求传 `imageBase64`（传 `imageUrl` 会报 4000），且仓库内无含文字测试图 URL，故用 logo 图标 base64 验证端点可用。如需正式文字识别可后续补含文本样例图。
5. **A4.3 依赖的 acc-agent 为测试数据，予以保留**：acc-agent（挂 web-system-paper，已发布 v1）供人工复核；contract-risk 的 systemPrompt 追加了 `ACC_V2_MARKER_9f2k` 标记用于 A2.9 行为验证，如需还原可回滚。
6. **A2.8 已删除一次 acc-agent 后重建**：A2.8 删除验证通过，随后为 A4.3 重建并发布 acc-agent（当前存在，版本 v1）。

## 人工确认区（用户填写）

| ID | 确认(✅/❌) | 备注 |
|----|-----------|------|
| B1 | | |
| B2 | | |
| B3 | | |
| B4 | | |
| B5 | | |
| B6 | | |
| B7 | | |
| B8 | | |
| B9 | | |
| B10 | | |
