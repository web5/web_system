# 新概念英语学习 · 整合进 web_system（流程凭证 / 接口契约）

> 建：2026-11-05 · 归属主线：`10-主线工作/10-新概念英语学习站点/`
> 用户拍板的 5 条特性：admin 后台预览 / PC portal「发现」入口 / 小程序「发现」入口 / 抓取数据按现有 JSON 字段入库 / `leadQuestion` 补中文。
> 版权：用户 2026-11-07 已明确「接受版权风险、发布 prod 对外」（决策落地见 #8503 收口）；已随 commit `948d24fd` 发布 prod（content-hub/admin/portal 三端 verified）。仅作个人学习用途，不对外商业化分发。

## 一、交付物定义

| # | 交付物 | 落点 | 验收判据 |
|---|---|---|---|
| D1 | 课文表（字段对齐 `lessons.json`） | `migrations/0025_nce_lessons.sql` + `servers/content-hub/src/content/entities/nce-lesson.entity.ts` | 标量列 + 4 个 JSON 列齐全；`lead_question_zh` 存在；时间列 `DATETIME(3)` / `precision: 3` |
| D2 | 幂等入库器 | `scripts/import-nce-lessons.mjs` | 重复运行不产生重复行；中文回读无 `\uXXXX`；JSON 列可解析 |
| D3 | 三端共用只读接口 | `servers/content-hub/src/content/nce.controller.ts` + service/dto | `meta` / `lessons` / `lessons/:id` 可用，响应 `{code:0,data,message}` |
| D4 | admin 预览 | `apps/admin/src/views/Content/NceLessons.vue` | 列表可搜索分页，抽屉能看全文/逐句/生词/习题/译文 |
| D5 | PC portal 发现入口 | `apps/portal/src/config/capabilities.ts` + `views/Nce.vue` | 发现页出现卡片并跳转；译文按需揭示 |
| D6 | 小程序发现入口 | `apps/kedou-ai-minigram/pages/nce/**` + 发现页卡片 | 卡片可跳转；列表/详情可看；中文问题优先 |
| D7 | 中文导入问题 | `data/lead-question-zh.json` + 抓取器新字段 | `leadQuestionCn` 有值时优先显示，空时回落英文，都空隐藏 |

## 二、字段映射（JSON → DB → API）

数据库列名 snake_case（仓库约定），API 出参**刻意保持与 `lessons.json` 一致的 camelCase**，转换只在 `NceLessonService` 做一次，三端共用同一套渲染逻辑。

| lessons.json | DB 列 | 类型 | 说明 |
|---|---|---|---|
| `id` | `lesson_no` | INT UNSIGNED | 表主键另用自增 `id`；唯一键 `(book, lesson_no)` |
| `book` / `bookTitle` | `book` / `book_title` | VARCHAR | 册别与教材名 |
| `title` | `title` | VARCHAR(255) | 英文标题 |
| `titleCn` | `title_cn` | VARCHAR(255) | 中文标题 |
| `leadQuestion` | `lead_question` | VARCHAR(512) | 英文导入问题 |
| **`leadQuestionCn`** | `lead_question_zh` | VARCHAR(512) | **本次新增**：中文导入问题 |
| `text` | `text` | MEDIUMTEXT | 英文课文全文 |
| `textSource` | `text_source` | VARCHAR(16) | `xdf` 权威全文 / `lrc` 字幕拼接 |
| `lines` | `lines` | JSON | `[{en,cn}]` ⚠️ MySQL 保留字，SQL 里必须反引号 |
| `translation` | `translation` | MEDIUMTEXT | 连贯参考译文 |
| `words` | `words` | JSON | `[{word,phonetic,pos,def,example}]` |
| `exercises` | `exercises` | JSON | `[{q,options,answer,exp}]` |
| `sources` | `sources` | JSON | 来源 URL 数组 |
| `fetchedAt` | `fetched_at` | DATETIME(3) | 抓取时间 |
| — | `created_at` / `updated_at` | DATETIME(3) | 表自身时间戳 |

🔴 **写 JSON 列必须参数化**：`JSON.stringify(...)` 的结果作为 `?` 的参数值传入，绝不拼进 SQL 字面量，否则中文静默变 `u62c9…`（2026-11-02 事故）。入库器已内置回读校验。

## 三、接口契约

统一前缀 `/api/content-admin/nce/*`。gateway 的 `contentAdminProxy` 把 `^/api/content-admin` 重写成 `/api`，落到 content-hub 的 `@Controller('api/nce')`。该通道不校验 service key、用户 JWT 原样透传；本 controller **只提供公开只读内容，不挂 JwtAuthGuard**，因此 admin / portal / 小程序三端共用一份数据。

> 通道决策：复用既有 `content-admin` 通道，避免改动 gateway 的 `proxy.controller.ts` / `proxy.service.ts`（本分支刚动过 trust-proxy，属软热区），也避免新增对外接口评审面。语义上略宽，后续若要收紧可加独立 `/api/nce/*` 通道再迁移。

| 方法 | 路径 | 响应 `data` |
|---|---|---|
| GET | `/api/content-admin/nce/meta` | `{ book, bookTitle, total: 96, downloaded }` |
| GET | `/api/content-admin/nce/lessons?page=1&pageSize=20&keyword=&book=NCE2` | `{ total, items: NceLessonSummary[] }` |
| GET | `/api/content-admin/nce/lessons/:id` | `NceLessonDetail`（字段同 lessons.json 单课） |

响应体统一 `{ code: 0, data, message: 'ok' }`：admin/portal 的 axios 拦截器拆 `data`，小程序 `Wrapped<T>` 取 `res.data`，两边都兼容。

`NceLessonSummary` = `id / book / title / titleCn / leadQuestion / leadQuestionCn / textSource / lineCount / wordCount / exerciseCount / fetchedAt`。

## 四、数据链路

```
85.mleo.site 双语 LRC ─┐
GitHub 词汇/测验 JSON ─┼→ fetch_lessons.py → 私域资产/课文/*.md（唯一真源）
新东方课文页(前 5 课) ─┘                  ├→ data/lessons.json
lead-question-zh.json ─────────────────────┘   └→ data/lessons.js（本地双击直开原型）
                                                        ↓
                                   import-nce-lessons.mjs → MySQL web_system.nce_lessons
                                                        ↓
                                   content-hub /api/nce/* → gateway /api/content-admin/*
                                                        ↓
                                   admin 预览 / portal 发现 / 小程序 发现
```

⚠️ `data/lessons.js` 只服务本地单文件原型；三端**一律走数据库接口**，不读静态文件。补课后必须重跑入库器，否则三端看不到新数据。

## 五、阅读体验判据（三端一致）

沿用 `20-私域资产/新概念英语学习/阅读体验设计判断.md`：**并排双语会让眼睛自动滑向中文，英文阅读训练失效**。

1. 正文默认纯英文，中文**按需揭示**（沉浸 / 点按 / 对照三档，默认沉浸）。
2. 导入问题 `leadQuestionCn` 优先，`leadQuestion` 作英文副行，都空则隐藏。
3. 生词就地查，不跳页；习题**读完再展开**、即时判分；参考译文默认折叠。
4. PC 三栏（目录 / 文章 / 习题），移动端顶部目录条 + 吸底习题按钮 + ≤52vh 抽屉。
5. 浅色白底：`#FFFFFF` / `#1A1A1F` / `#6B7280` / `#F97316` / `#0EA5A4`。不做深色卡面、积分打卡、自动播放。

## 六、验证判据

| # | 判据 | 命令 / 方法 | 当前状态 |
|---|---|---|---|
| V1 | JSON 结构与课号合法 | `node scripts/import-nce-lessons.mjs --dry-run` | ✅ PASS |
| V2 | 建表 + 幂等 UPSERT + 中文回读 | `node scripts/import-nce-lessons.mjs` | ✅ PASS（2 课，中文/JSON 转义检查 PASS） |
| V3 | content-hub 类型检查 | `pnpm --filter content-hub exec tsc --noEmit`（或仓库既有 build） | ⬜ 待跑 |
| V4 | 三端类型 / 结构检查 | admin / portal `vue-tsc --noEmit`；小程序 `tsc --noEmit` + app.json 合法 | ⬜ 待跑 |
| V5 | 接口实测 | 启动 content-hub 后 `curl --noproxy '*' http://127.0.0.1:6007/api/nce/meta` | ⬜ 待跑 |
| V6 | 三端入口一致 | 发现页卡片 → 路由 → 页面加载 → 中文问题显示 | ⬜ 待人工目视 |
| V7 | 补 96 课后重跑入库 | 2026-11-06 02:00 自动化 → `downloaded==96` → 重跑入库器 | ⬜ 待定时任务 |

## 七、已知缺口（照实列，不编造）

1. **导入问题只覆盖前 5 课**：新东方文章 ID 第 6 课起跳号，全站未找到稳定的 96 课英文问句源；tingroom 与开源 LRC 均不含导入问题。映射文件只填能核实英文原句的 5 课，中文为**直译（非教材官方译文）**，其余课 `leadQuestion` / `leadQuestionCn` 为空，前端隐藏该区块。后续补录只需往 `data/lead-question-zh.json` 加条目再重跑入库器。
2. **Lesson 3–96 课文是 LRC 字幕断句拼接**，引号与感叹号会被简化（`textSource: lrc`）；前 2 课用新东方权威全文。
3. 习题来自开源项目整理的选择题（2–3 题/课），非教材原版课后练习。
4. 已发布 prod（2026-11-07，commit `948d24fd`，content-hub/admin/portal 三端 `release-verify` verdict=verified）；版权风险用户已接受，仅作个人学习用途、不对外商业化分发。
5. 音频跟读 / 逐句高亮 / 错题本导出未做。
