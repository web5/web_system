# 生产后端隔离运行包：迁移前置检查

## 当前边界

2026-10-19 的生产目录维护已完成，活动根为 `/data/web_system`；本阶段继续准备旧模板迁移，不再次停服、不发布业务代码、不改生产模板/版本账本、不执行 DDL，也不批准或取消原 pending 审批。

本阶段新增只读模板预检和构建目录隔离修复。源码仍在人工评审草稿 PR 中，不能把本地测试通过说成控制台现网代码已更新。新模板、产物和正式发布仍需独立验收。

## 可重复的本地预检

```sh
pnpm --filter deploy-console-server build
node scripts/plan-backend-template-migration.cjs \
  --input /private/path/backend-readiness-input.json \
  --output /private/path/backend-readiness-report.json
```

命令不连接服务器或数据库，不启动应用，不执行脚本内容，只读取操作者提供的私有快照。没有 apply 模式；指定输出时使用 0600 和排他创建，不覆盖已有结果。输出不含动作脚本正文、环境变量值或凭据。

输入为 `{ "schema": 1, "modules": [...] }`。每个模块使用 `BackendTemplateReadinessInput`：

- `pipelineId`、`revision`、`moduleKey`，可选 `moduleDirectory`、`runtimeRoot`；显式 `environment=dev|prod`。
- `orchestration` 为已按实际执行顺序排列的 EngineStep/EngineTask/EngineAction 树；保留 disabled 节点和脚本正文，以生成完整编排指纹。数据库的 0/1 enabled 和 JSON env/approval 字段须先按引擎类型归一化。
- `processes` 为目标机实际进程引用、cwd、入口、NODE_ENV、监听端口及本机健康状态；不能拿配置中的期望值替代实际观测。
- `currentVersion` 来自同一环境/模块的部署账本，缺失时保持 null；不能由运行仓库 HEAD 或其他服务版本补造。

输出永久为 `readOnly=true`、`evidence=snapshot-only`、`canPublish=false`。`standard-five-action` 只表示动作名称/顺序符合已知骨架，不代表脚本安全、配置可用、schema 兼容或产物已验证。动作源码只输出 SHA-256；配置下发前缀也只输出指纹，需要后续人工核对并保留其失败语义。

## 实际盘点结果

本阶段读取维护后的控制台数据库快照及生产 10 个服务的真实进程/健康状态，结果如下：

| 模块 | revision | 模板骨架 | cwd 迁移前置 | 控制台当前版本元数据 |
|---|---:|---|---|---|
| todo-service | 8 | 标准五动作 | 当前为服务目录 | 有记录，但为短 commit |
| ai-service | 6 | 标准五动作 | 当前为服务目录 | 有记录，但为短 commit |
| user-service | 6 | 标准五动作 | 当前为服务目录 | 有记录，但为短 commit |
| mcp-gateway | 6 | 标准五动作 | 仍为仓库根，需兼容评估 | 有记录，但为短 commit |
| content-hub | 6 | 标准五动作 | 仍为仓库根，需兼容评估 | 有记录，但为短 commit |
| ai-agent | 6 | 标准五动作 | 仍为仓库根，需兼容评估 | 有记录，但为短 commit |
| auth-service | 6 | 额外版本/指针动作 | 当前为服务目录 | 中央部署账本无当前记录 |
| system-service | 6 | 额外版本/指针动作 | 当前为服务目录 | 中央部署账本无当前记录 |
| upload-service | 6 | 额外版本/指针动作 | 仍为仓库根，需兼容评估 | 中央部署账本无当前记录 |
| gateway | 6 | 额外版本/指针动作 | 仍为仓库根，需兼容评估 | 中央部署账本无当前记录 |

“无当前记录”限定于本次核对的控制台 `deploy_deployments`，不代表服务未运行或没有历史产物；10 个服务在本阶段只读探测时仍 online、实际端口 `/health` 为 200。

共同问题和单独问题：

1. 全部 10 个模板仍有重置运行仓库的旧同步动作；原安全门继续阻止其执行。
2. 全部 10 个模板中仍有 `${COMMIT_ID##*/}`，会把完整产物引用截成短 commit。不能只替换同步/重启动作，却保留截断版本的记录/指针路径。
3. auth-service、system-service、upload-service、gateway 各有两个已启用写版本动作，并保留从目标机 deploy-console `.env` 取密钥的旧指针流程；本次生产盘点未发现该目标控制台实例。需要收敛到已核实的中央控制平面及 run-scoped token/lockOwner，不能靠复制密钥或补造目标控制台放行。
4. 仓库根 cwd 的 5 个服务不得因目录已统一就自动通过隔离激活门禁。必须逐项评估配置、数据文件、日志和依赖解析；本阶段没有改变这些服务的 cwd。
5. 有短版本记录的 6 个服务仍需以真实产物清单确认完整引用；无记录的 4 个服务须先建立可信当前状态。不能直接把 10 个版本都改成运行仓库 HEAD。

预检通过脚本特征识别提示这些风险，并非完整 shell 语义分析器；最终仍需核对替换脚本、候选产物和真实执行证据。

## 已修复的源码安全缺口

原 Git/shell 构建隔离仅检查全局运行根和 dev 依赖根，未覆盖环境级生产配置；dev 依赖根存在时还会遮蔽全局依赖根。新增回归中 9 项在修复前失败，验证确实可能在这些配置指向的运行目录执行清理或 shell。

现在 Git 预检与实际 shell 共用根集合：控制台自身、默认 canonical 根、全局运行/依赖根、dev/prod/local 各自根，以及当前发布环境（例如 qa）的根。全局和环境级目录都保留保护，不因配置优先级互相遮蔽；按既有 realpath/双向包含规则比较。提交、恢复审批和实际执行都传递 run 的环境，不采信脚本覆盖的 DEPLOY_ENV。

## 后续执行顺序

1. 先完成源码人工评审和控制平面部署验证，不能用模板变更代替代码上线。
2. Todo/prod 作为首个候选：它当前已有服务 cwd，且此前已核对当前 dist 与留存版本字节一致。但这不等于完整隔离回退包已验证；还须准备匹配候选与回退包、完整版本引用和 schema 审查。
3. 对首个候选精确生成并评审 prod 专属打包、不可变投递、完整版本记录、只读产物检查、配置下发、隔离激活和健康后切指针；保留 dev/local 分支，不批量覆盖整个模板树。迁移时校验 revision/完整编排指纹，获取模块发布锁，保存动作和配置备份，并生成新 revision。
4. 新建发布单并使用独立审批门，按模块执行正式发布和回滚演练；原历史 pending 单始终保留，不复用。后续再推进 ai-service/user-service、cwd 兼容组和额外指针流程组。
5. MCP Gateway 的 schema 风险独立审查；旧 24 项差异不是本阶段重新测量的结果。未评审前不运行 ORM 同步或整包部署。

原始数据库脚本、进程详情、归一化输入及报告保存在本机私有 `/tmp/web-system-console-delivery-20261019/` 和 `/tmp/web-system-console-p0-20261019/`。不得将输入或原始快照提交到 Git；公开材料仅记录脱敏结论和操作边界。
