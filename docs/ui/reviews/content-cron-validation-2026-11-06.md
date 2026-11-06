# D3 实现一致性评审 · 发布管线 cron 校验与调度状态

阻塞: 0

- 日期：2026-11-06
- 关联故障：台账 #8557（prod `ai_news` 静默停摆 2 天）
- 关联需求：台账 #8561
- 页面规格：`specs/content-cron-validation/page-spec.md`
- 页面：admin → 内容 → 发布管线（列表页 / 编辑页）
- 后端：`servers/content-hub/src/common/cron.util.ts` · `src/content/dto/pipeline.dto.ts` · `src/content/scheduler.service.ts` · `src/content/content.controller.ts`
- 前端：`apps/admin/src/api/content.ts` · `src/views/Content/ContentPipelineEdit.vue` · `src/views/Content/ContentPipelines.vue`
- 本轮无新增原型屏（沿用既有列表/编辑页版式，只在既有表单项下方增加提示行与红条）

## 1. 需求回顾（为什么是这三刀）

11-04 11:43 有人把 `ai_news` 的 cron 改成 `0 8 0 * *` —— 本想写「每周四 8 点」，实际把 `4`
写进了**日**字段（5 段式顺序是「分 时 日 月 周」）。当时三道口子同时失守：

| 环节 | 旧行为 | 后果 |
|---|---|---|
| 编辑页输入 | 纯文本输入框，`submit()` 只 `trim()` + 判非空 | 任意字符串都能提交 |
| 后端接口 | `@Body() body: any`，全局 ValidationPipe 因无 DTO 元类型 **直接跳过** | 校验等于不存在 |
| 调度注册 | 启动时 `logger.error` 一行，进程照常起、`/health` 照常 200 | 管线静默不跑，2 天无人知 |

所以本轮只做三件事：**让坏 cron 进不来（DTO 硬门）**、**让它一眼看得见（预览 + 红条）**、
**改完立即生效（保存后重注册）**。管线执行逻辑一行未动。

## 2. 规格 ↔ 实现对照

### 2.1 编辑页 · cron 字段四态

| 规格 | 实现 | 一致性 |
|---|---|---|
| 空 → 灰色引导「5 段式「分 时 日 月 周」，如 `0 9 * * *`」 | `v-else` 分支渲染该文案，`.mono` 包裹表达式 | ✅ |
| 校验中 → 「校验中…」 | `cronChecking` 为真时渲染；`watch` 立刻置真、350ms 后发请求 | ✅ |
| 非法 → `✗ <error>` `#cf1322` | `cronCheck.valid === false` 时渲染 `cronCheck.error` | ✅ |
| 合法 → `✓ 接下来 3 次：MM-DD HH:mm · …` `#389e0d` | `fmtRun()` 逐条格式化 `cronCheck.next` | ✅ |
| 口径唯一：前端不引 cron 库，一律调 `cron-preview` | 前端零 cron 依赖，`previewCron(cron)` 单一入口 | ✅ |
| 保存前同步再校验，不等防抖 | `submit()` 先 `await checkCron(form.cron)`，`valid === false` 直接 return | ✅ |
| 预览接口不可用 → 放行保存 | `checkCron` catch 返回 `null`，`submit()` 只在 `checked && !checked.valid` 时拦 | ✅ |

### 2.2 列表页 · 调度失败红条

| 规格 | 实现 | 一致性 |
|---|---|---|
| 条件 `failed > 0` 才出现 | `failedJobs = jobs.filter(j => !j.registered)`，`v-if="failedJobs.length"` | ✅ |
| 位置在表格上方、与「正在运行」提示同层 | 插在既有 `a-alert`（运行中提示）之后、`a-table` 之前 | ✅ |
| 文案「N 条管线的 cron 无法注册，不会按时运行」 | 一致，`不会按时运行` 加粗 | ✅ |
| 每条列 `code（cron）：error`，按 code 稳定排序 | 后端 `jobs` 已按 code 排序输出 | ✅ |
| 接口失败 → 不显示红条、不影响列表 | catch 里 `scheduler.value = null`，列表照常渲染 | ✅ |

### 2.3 接口契约

| 规格 | 实现 | 一致性 |
|---|---|---|
| `POST /pipelines/cron-preview`，DTO 只收 `cron` | `CronPreviewDto{ cron }` + 全局 `forbidNonWhitelisted` ⇒ 多传字段 400 | ✅ |
| 预览**永不返回 4xx**，非法走 `valid:false` | 控制器内 `parseCronExpression` 判 ok，非法时返回 `{valid:false,next:[],error}` | ✅ |
| `GET /scheduler/status` 返回 `{timezone,checkedAt,total,failed,jobs[]}` | `SchedulerService.getStatus()` 按此结构输出 | ✅ |
| 时间格式 `ISO +08:00` | `CronTime(expr,'Asia/Shanghai').getNextDateFrom().toISO()` | ✅ |

### 2.4 保存后副作用

| 规格 | 实现 | 一致性 |
|---|---|---|
| 新增 / `cron`·`enabled` 变更 → 重注册 | 控制器 `create` 后必调 `scheduler.reload()`；`update` 仅在 `cron` 或 `enabled` 出现在 payload 时调 | ✅ |
| 只改标题/封面/发布模式 → 不重注册 | 同上条件判断 | ✅ |
| 重注册失败不抛 500（数据已落库） | `reload()` 内部逐条 catch，失败写状态表 + `[ALERT]` 日志，不向调用方抛 | ✅ |

## 3. 设计决议（含为什么）

1. **校验口径放在后端，前端一个 cron 库都不引**
   前端另写一套，必然出现「页面说合法、调度器注册失败」的分裂 —— 那正是本次故障的形态换个地方重演。
   代价是每次输入多一个 HTTP 往返，用 350ms 防抖抹平。

2. **预览接口不返回 4xx**
   它是「问一句」，不是「提交一次」。用 400 表达「表达式写错了」会让前端不得不从错误响应体里
   抠文案，还容易和「接口挂了」混淆 —— 而这两种情况的处理策略完全相反（前者拦保存、后者放行）。

3. **不猜语义，只暴露语义**
   `0 9 4 * *`（每月 4 号）语法合法，DTO 放行。歧义交给「接下来 3 次：12-04 09:00」暴露 ——
   人一眼就能看出这不是自己要的。若在这里加「日字段非 `*` 就警告」，会把合法的每月任务误伤。

4. **不自动修正历史脏数据**
   库里已有的非法 cron 保留原样，只让它在页面上红出来。自动改写等于替运维做决定，
   且没有「改前改后」的对照，出问题反而更难查。

5. **调度状态用「注册时的快照」而不是「现算一遍」**
   `SchedulerService` 在注册时把每条管线的 `{registered,nextRun,error}` 记进内存状态表；
   `/scheduler/status` 只读这份表。若改成每次请求现算，就会出现「表里说失败、现算说正常」
   —— 而真相是「这个进程的定时器确实没挂上」，现算会把故障掩盖掉。

## 4. 反例与变异验证（防假绿）

新增 3 个 spec、29 条断言。为确认断言真的会咬人，做了两次变异：

| 变异 | 改法 | 期望 | 实测 |
|---|---|---|---|
| A · DTO 失守 | 摘掉 `PipelineCreateDto.cron` 上的 `@Validate(IsCronExpressionConstraint)` | 至少 2 条失败 | ✅ **2 failed** / 11 passed |
| B · 调度器失守 | 恢复旧行为（注册失败只 `logger.error`，不留状态） | 至少 1 条失败 | ✅ **3 failed** / 3 passed |

变异后均已还原（`grep -c '@Validate(IsCronExpressionConstraint)'` = 3，失败分支恢复写状态）。

**一次实测暴露的坑（记录在此）**：HTTP 级用例里，`BadRequestException` 在 jest + 软链接依赖
环境下被默认异常过滤器映射成 500（`@nestjs/common` 双实例导致 `instanceof HttpException` 失效）。
因此该用例改为断言「请求被拒 + 未进入 service + 响应体含 `cron`」，不锁死状态码；
**400 由真实服务侧验证**（prod/dev 实机 `curl`），避免用环境缺陷冒充产品缺陷。

## 5. 验证清单

| 项 | 方式 | 结果 |
|---|---|---|
| content-hub 全量单测 | `npx jest --forceExit --maxWorkers=2` | ✅ 20 suites / **247 passed** |
| admin 全量单测 | `npx jest --rootDir . --config jest.config.cjs` | ✅ 11 suites / **127 passed** |
| 后端类型检查 | `npx tsc --noEmit -p tsconfig.json` | ✅ 0 输出 |
| 前端类型检查 | `npx vue-tsc --noEmit` | ✅ 0 输出 |
| cron 语义正确性 | `cron.util.spec.ts`：`0 8 * * 4` → 连续 3 个周四；`0 9 4 * *` → 每月 4 号 | ✅ |
| 非法表达式被拒 | `0 8 0 * *` / `nope` / 段数不足 | ✅ |
| 改坏入口覆盖 | `PATCH {cron:'0 8 0 * *'}` 被拒且不重注册 | ✅ |

## 6. 遗留（不在本轮范围）

- **真机目视未做**：本轮改动只有文案行与一条红条，未在浏览器里截图确认排版。
  按规格 §3「红条不允许被折叠或隐藏」，上线后需在 dev 上看一眼（台账将登记）。
- 历史脏数据（若还有）不会被自动清理，只能靠红条暴露。
- 平台侧 `check_remote_config` 时序缺陷（#8559）是另一条线，与本轮无关。
