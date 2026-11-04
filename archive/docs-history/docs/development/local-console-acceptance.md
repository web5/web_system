# 本地发布平台 · 功能验收说明

> 适用：https://local.kedouai.com/console/（**local 环境**，服务在 6200）
> 更新：2026-09-17（master `ea0e183`，前端产物 `index-Cv4WK4uo.js`）
> 用途：逐条点一遍验证近期改动；同时标出**哪些没做**，别当 bug。

## 0. 前置

- 硬刷新一次（Cmd/Ctrl+Shift+R）
- `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6200/console/` → 200
- `pm2 list` 应有 `web-deploy-console` / `web-gateway` / `web-mcp-gateway`

## 1. 流水线列表（/console/pipelines）

| 操作 | 期望 |
|---|---|
| 「**+ 新建流水线**」 | 弹「选择模块类型」：前端（micro-frontend）/ 后台（backend） |
| 选后台 | 进新建页，表单可编辑（名 / key / 模块 / 环境），构建节点脚本预填 `npm ci + npx tsc` |
| 选前端 | 同上，构建脚本预填 `npx vite build` |
| 说明 | 列表页已无「发起发布」按钮 |

## 2. 编辑流水线（独立页，4 个 Tab）

| Tab | 期望 |
|---|---|
| **基本信息** | 新建态：名 / key / 模块 / 环境可编辑，**页头标签随选择实时联动**；编辑态：这几项**禁用**，只有「启用」可改 |
| | 已移除：投递目标、审批策略、审批人、失败回滚（下移到节点：审批在 approval 节点配，回滚在节点标 watchdog） |
| **流程编排** | 拖拽重排、连接线「+」或「+ 添加节点」新增、卡片右上「×」删除；**无「保存顺序」按钮**（由页头「保存」统一提交） |
| **参数** | 只读速查（平台内置 / 配置中心 / 全局 / 本条流水线），写脚本对键名用 |
| **变量** | 本条流水线变量可增删改：检索框 + 「+ 新增变量」面板 + 定宽表格 |

**点节点 → 右侧抽屉（3 Tab）**：

- 类型「执行 shell」→ 脚本编辑 + 超时 + 语法校验
- 类型「审批 approval」→ 审批人 / 超时 / 超时未批 / 拒绝后，**无脚本编辑器**
- 抽屉的「变量 / 参数」与页面 Tab 共用同一组件

## 3. 模块（/console/services）

| 操作 | 期望 |
|---|---|
| 「**新建模块**」 | 进独立页 `/modules/new`（不是弹窗） |
| 类型=后台 | 目录自动 `servers/<key>`，显示 **pm2 进程名** `web-<key>`，隐藏 publicPath |
| 类型=前端 | 目录自动 `apps/<key>`，显示 **publicPath** `/<key>/`，隐藏 pm2 |
| 详情 → 版本历史 →「**回滚到此版本**」 | **秒级回滚**（不重新构建）：后台=版本目录落地 dist + 重启 pm2；前端=仅切指针 |

## 4. gateway 完整发布（本次重点，需你批准一次审批）

`流水线 → tpl-gateway-local → 执行`：

```
拉取代码 → 构建 → 发布确认（挂起，等你批准）→ 发布
                                              ├ ① 上传产物  → 版本目录
                                              ├ ② 写版本记录
                                              └ ③ 部署生效  → 版本目录 → dist + 重启 + 切指针   ← 本次新增
```

验收点：

1. 跑完**不用**再去点「部署」（③ 自动生效）
2. `pm2 list` 中 `web-gateway` 是**新进程**（uptime 重置），且 online
3. 模块详情 → gateway → 当前版本 = 本次 commit 的版本引用（形如 `gateway-local/<commit>`）
4. 再点「回滚到此版本」应能回到上一个版本

⚠️ ③ 会重启 gateway：期间**所有微前端与 API 调用短暂不可用**，挑不影响你操作的时间做。

## 5. 尚未完成（别当成 bug）

| 项 | 状态 |
|---|---|
| 微前端「发布并生效」独立管理动作 | 方案 C，**未开始**（等三个问题拍板：是否含清缓存 / shell 是否改 micro-frontend / 影响面提示） |
| 远端（dev/prod）shell 按版本加载 | **未验证** —— ssh 未授权，我连不上远端核对 |
| 其他后台模块的「部署生效」 | 只有 gateway 三条流水线挂了 ③，其余仍是就地构建 + restart |
| 物理列名 `template_id`、API 路径 `/pipeline-templates`、`tpl-` 前缀 ID | 有意保留（已改名的是表名与代码语义层） |

## 6. 出问题看哪里

```bash
pm2 logs web-deploy-console --lines 50      # 服务日志
pm2 logs web-gateway --lines 30             # 网关日志

# 指针与版本（库 web_system_deploy）
#   deploy_pipelines      = 流水线（定义）
#   deploy_pipeline_runs  = 发布单（执行）
#   deploy_pipeline_vars / deploy_pipeline_step_commands 按流水线 id 查

# 产物与版本目录（本地）
ls ~/web_system_release/servers/gateway/dist          # 当前生效
ls -d ~/web_system_release/servers/gateway/dist.bak-* # 落地前备份
ls ~/web_system_release/servers/gateway/gateway-local # 版本目录
```

常见报错与含义：

- `部署失败：版本目录是空的 / 只有 tsbuildinfo` —— 构建没产出（P0 守卫拦下，dist 未被破坏）
- `pm2 中未找到服务` —— 模块注册表 pm2 名与真实进程名不一致（已修正 11 项，新增模块时注意填对）
- 页面 404 但显示发布成功 —— 产物投到了字面量 `~` 目录（PUBLISH_PATH 必须绝对路径）
