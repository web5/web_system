# A8 · ai-service 生成图改调 `internal/uploads/store` 落盘（设计）

> 状态：设计稿 → 实现中。任务来源：`specs/backend-consolidation/design.md` §A 系列（A8 依赖 A3，A3 已完成）。
> 目标：ai-service 不再本地落盘，存储写入点收敛为 upload-service 单点。

## 0 背景与现状（已核实）

`servers/ai-service/src/bianbian/bianbian.service.ts` 是 ai-service **唯一的图片落盘点**：

| 函数 | 行号 | 现状 |
|---|---|---|
| `downloadAndSaveImage` | 524-557 | 下载 MaaS 生成图 → `writeFile(process.cwd()/uploads/bianbian/<name>)` → 返回 `/api/uploads/bianbian/<name>` |
| `saveTempImage`（参考图，非生成图） | 472-484 | 写 `process.cwd()/temp-images/bb-<ts>.<ext>`，URL 依赖 `PUBLIC_URL` / `BIANBIAN_PUBLIC_BASE_URL`（**均未在 .env 配置 → 实际必抛错，被 L118-120 warn 吞掉**） |
| `main.ts:43-46` | — | `useStaticAssets(cwd/uploads, {prefix:'/uploads'})` 出图 |

其它生图路径（`agent/tools/image-gen.tool.ts`、`common/http/image-gen.client.ts`、`artworks/artworks.service.ts`）**只传远端 URL、不落盘**。

消费点：

- DB：`bianbian_record.aiImage`（列注释即「本地路径 `/api/uploads/bianbian/xxx.jpg`，回退远程 CDN URL」）
- Portal：`views/Transform.vue:186-198` → `Result.vue` 直接当 `<img src>`、`saveArtwork({imageUrl})`
- 小程序：`packageBianbian/pages/bianbian/{transform,result,history}` 直接把 `aiImage` 当图片地址与本地历史
- gateway：`proxy.controller.ts:594-616` 对 `/api/uploads/bianbian/*` 有「先 upload-service 后 ai-service 历史文件」的兜底

## 1 目标 / 非目标

**目标**

1. 生成图落盘改为调用 upload-service `POST /internal/uploads/store`，返回统一 URL 契约 `/api/uploads/<category>/<file>`；
2. 去掉 ai-service 的**新写入**（`downloadAndSaveImage` 的 writeFile/mkdir），路径解析不扩散到 ai-service；
3. 保持对外契约不变：`aiImage` 字段仍是 `/api/uploads/bianbian/...`（URL 形状不变，Portal/小程序/DB 零改动）；
4. 失败可降级：store 调用失败时回退存 MaaS 远端 URL（沿用现有语义）。

**非目标**

- 不动历史文件与 gateway 的 legacy 兜底（A5 明确不迁 bianbian，历史图继续由 ai-service 静态出图 → `main.ts` 的 `useStaticAssets` **保留**）；
- 不动变变参考图（`temp-images`）：store 无删除接口，临时图走 store 会留下永久垃圾；参考图失效属既有问题，另开项处理；
- 不做 A7（删 user-service 上传端点）：依赖 A5 验证通过。

## 2 接口契约（来自 A3，已核实）

`POST <UPLOAD_SERVICE_URL>/internal/uploads/store`

- 鉴权：header `x-internal-key: <INTERNAL_API_KEY>`（upload-service 未配置 key 时一律 401）
- 传法（本设计选 **multipart**）：`file`(binary) + `category=bianbian` + `filename=bianbian-<ts>-<rand>.<ext>`
  - 备选 JSON：`{category, filename, dataBase64}`（base64 多 33% 体积，仅作兜底）
- 限制：12MB；`category` 取 `avatars|drawing|bianbian|general`；扩展名必须合法图片后缀；**DTO 开了 whitelist+forbidNonWhitelisted → 禁止多传字段**
- 返回：`{ code: 0, data: { url: '/api/uploads/bianbian/bianbian-...-xxx.jpg', filename, originalName, size, category, mimetype } }`

## 3 改造点（逐文件）

| # | 文件 | 改动 |
|---|---|---|
| 1 | 新增 `src/bianbian/upload-store.client.ts` | 封装 store 调用：multipart（FormData + Blob）、`x-internal-key`、超时 10s、校验返回 `code===0 && data.url`，否则抛错 |
| 2 | `src/bianbian/bianbian.service.ts` | `downloadAndSaveImage` 改为：下载 buffer → `uploadStore.storeImage({category:'bianbian', filename, buffer})` → 返回 `url`；**删除** writeFile/mkdir；store 失败 → 沿用现有回退（存远端 URL + warn） |
| 3 | `src/bianbian/bianbian.module.ts` | 注册新 client（module 已 imports HttpModule/ConfigModule） |
| 4 | `servers/ai-service/.env` + `.env.example` | 新增 `UPLOAD_SERVICE_URL`（默认回落 `SERVICE_URL_DEFAULTS.upload=http://localhost:6008`） |
| 5 | `src/main.ts` | **不改**（保留 uploads 静态出图，服务历史文件） |

配置读取：地址 `ConfigService.get('UPLOAD_SERVICE_URL') || SERVICE_URL_DEFAULTS.upload`；key `ConfigService.get('INTERNAL_API_KEY')`（ai-service 已有，且与 upload-service 同值）。

## 4 兼容与回退

- `aiImage` 值域不变（本地 `/api/uploads/bianbian/...` 或远端 URL），Portal/小程序/DB 无需改动；
- 新图落统一根后走 upload-service 出静态；旧图仍由 ai-service 出静态（gateway 兜底保留）；
- store 失败（网络/401/超限/扩展名非法）→ 记 warn + 回退远端 URL，**不阻断生成流程**（与现状一致）。

## 5 测试计划（ai-service 当前 0 spec，jest 已配置）

新增 `src/bianbian/upload-store.client.spec.ts` 与 `src/bianbian/bianbian.service.spec.ts`：

1. client：multipart 字段正确（file/category/filename）、header 带 `x-internal-key`、超时生效
2. client：返回 code≠0 / 缺 url → 抛错
3. client：401 / 网络异常 → 抛错（供上层回退）
4. service：`downloadAndSaveImage` 成功 → 返回 `/api/uploads/bianbian/...` 且**不写本地文件**
5. service：store 抛错 → 回退存远端 URL，不抛出

## 6 发布顺序

1. 合入并发布 ai-service（本地 → dev）；upload-service（A3）已在跑
2. dev 验证：变变生成一张图 → 落 `/api/uploads/bianbian/...` 且可访问；断网/改错 key 时回退远端 URL
3. prod 前置：prod 的 upload-service **未运行且端口未登记**（见 `dev-env-config-inventory.md` §prod、`session-handover-2026-09-23.md` §P2）→ **prod 需先起 upload-service 再上 A8**，否则 prod 上所有新生成图都会走回退（存远端 URL，功能可用但不符合收口目标）
