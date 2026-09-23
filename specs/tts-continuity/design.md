# TTS 长句连续性改造（A′：服务端整段合成 + 端侧首句快播）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：修复长英文朗读「断断续续 + 中途停掉」，统一 portal 与小程序两条朗读链路。

## 1 现状链路

两端共用同一后端接口，区别只在切块与播放：

- 服务端：`POST /api/ai/tts/speak` → gateway 原生 http 转发（超时 `API_TIMEOUT.GATEWAY.TTS` = 15s）→ ai-service `TtsService`（腾讯云 `TextToVoice`，音色 603007，Codec mp3 / 16kHz）。
- 小程序：`apps/kedou-ai-minigram/services/tts.ts`，`splitSpeakChunks` 切块 → 每块一次请求 → 每块一个 `InnerAudioContext` 顺序播放，预取 1 块。
- portal：`apps/portal/src/api/tts.ts` + `AiChat.vue` 的 `speak()`，串行 `await requestTts(chunk)` → `await playBlob(blob)`，**无预取**。

## 2 根因

### 2.1 断断续续：块上限照搬中文限制，把英文切碎

`SPEAK_CHUNK_MAX = 110` 的设计依据是「腾讯云 TTS 单次 150 字符，留余量」。实测（音色 603007，PrimaryLanguage=2）该限制对英文严重偏保守：

| 文本 | 实测长度 | 结果 | 耗时 |
|---|---|---|---|
| EN | 110 / 150 / 200 / 300 / 330 / **499** | 全部成功 | 1.7s / 2.1s / 4.9s / 4.8s / 5.9s / 5.1s |
| EN | 520 / 550 / 579 / 599 | `Text too long` | <0.4s |
| ZH | 150 | 成功 | 4.2s |
| ZH | 300 / 500 | `Text too long` | <0.3s |

→ **英文单次上限 ≥499、中文 ≥150，必须分开设限**；110 是中文口径，套到英文上就把长句切碎。

用户实测句（330 字符）按现算法切成 **5 块、2 刀切在句中**：

```
[0] 58   Thank you for your company's support for this cooperation.
[1] 107  Regarding the delivery time ... postponed to            ← 句中硬断
[2] 23   the 15th of next month.                                  ← 残句独立合成
[3] 110  The reason is that ... production is                     ← 句中硬断
[4] 28   currently being coordinated.                             ← 残句独立合成
```

每块一次独立合成 → 语调重新起头；残句被当作完整句朗读 → 听感断续。块间还需一次重新起播 → 叠加空档。

### 2.2 中途停掉

- portal：串行请求 + 无预取，任一块失败即 `catch` 退出；且前端 axios `timeout = API_TIMEOUT.DEFAULT = 10s`，而 330 字符单片合成实测 5.9s，加网络与网关转发后逼近超时。
- 小程序：`playFileAndWait` 每块 `wx.createInnerAudioContext()` 且**只把最后一个赋给 `audio` 并在收尾 destroy**，前 n-1 个实例全程泄漏；累积后新实例播放失败（`onError`）或 `onEnded` 不回调（promise 永久挂住）→ 停在中间。

## 3 目标

1. 长英文朗读**语调连贯**：330 字符的块数 5 → 2，唯一接缝落在句末标点（自然停顿处）。
2. **不再中途停掉**：块数下降 + 预取 + 不泄漏音频实例。
3. portal 与小程序共用同一套切块与播放语义。
4. 首播等待不回归：首句 ~2s 出声（现状水平）。

## 4 方案

### 4.1 服务端（ai-service `TtsService`）

- 新增按语言的单次上限常量：`/[\u4e00-\u9fff]/.test(text) ? ZH_MAX : EN_MAX`，取 **EN_MAX = 480、ZH_MAX = 150**（实测安全值 499 / 150 留余量；499 与 520 之间未逐字符二分，取保守值）。
- `textToSpeech(text)` 语义不变（单次合成）；新增 `textToSpeechLong(text)`：
  1. 长度 ≤ 上限 → 直接单次合成（**绝大多数场景走这条，与现状相比零切片**）；
  2. 超限 → 按**句末标点**切句，句子仍超限时再按**空格**切（禁止按字符硬切单词），得到 ≤上限 的片；
  3. 各片**并发**调 `TextToVoice`（并发上限 3，避免触发云厂商 QPS 限流），`Buffer.concat` 拼接后返回。
- 拼接合法性已实测：腾讯云返回的 mp3 **无 ID3 头**，各长度首 16 字节恒为 `ff f3 48 c4 00 1d 0b d6 ...`（帧同步 + 相同编码参数），同音色/同 SampleRate 下裸 concat 可被播放器连续解码。
- 任一片失败 → 整段抛错（不产出"读到一半静音"的残缺音频），端侧沿用现有失败提示。

### 4.2 端侧切块（两端统一）

改为「**首句 1 块 + 剩余整段 1 块**」：

- `first` = 第一句（≤110，保证 ~2s 出声）；
- `rest` = 全文去掉首句后的剩余文本，作为**一次**请求交给 `textToSpeechLong`（≤480 英文时服务端单次合成，语调完全连贯）；
- `rest` 超限时服务端按句再切（接缝仍只落在句末）。

用户实测句的结果：块数 **5 → 2**（`first` 58 字符 + `rest` 271 字符单次合成），接缝 1 处且在第 1 句句末。

### 4.3 播放侧

- portal：预取下一块（首块开播后并行请求 rest）；播放实例复用/播完释放，不再每块新建 `Audio` 后丢弃。
- 小程序：`playFileAndWait` 播完即 `destroy()`（或全程复用单个 `InnerAudioContext` 换 `src`），消除实例泄漏。
- portal 请求超时：`requestTts` 单独放宽（新增 `API_TIMEOUT.TTS` 前端值 **20s**），不能复用 `DEFAULT`(10s)。

### 4.4 超时预算

| 环节 | 现状 | 改造后 |
|---|---|---|
| 前端 axios | 10s ← 不足 | 20s |
| gateway 代理 | 15s | 15s 不变（单片 ≤6s；并发 ≤3 片 ≈6~8s，仍在预算内） |
| 腾讯云单次 | — | ≤6s（实测最大 5.9s） |

⚠️ 服务端切片合成**必须并发**；串行 3 片 ≈18s 会打爆 gateway 15s。

### 4.5 缓存

沿用「块文本 hash」落盘缓存：首句块与 rest 块各自缓存，重复朗读命中率高。缓存文件名规则不变。

## 5 接口契约

`POST /api/ai/tts/speak`（gateway → ai-service，路由与鉴权不变）

- 入参：`{ text, voiceType?, speed? }`，新增可选 `{ long?: boolean }`（默认 true：按 4.1 策略自动处理；false = 严格单次合成，保留旧行为便于排查）。
- 出参：`audio/mpeg` 二进制；失败仍为 JSON `{ code, message }`（端侧 `isJsonResponse` 判定逻辑不变）。
- 变更点：**可接受的 text 长度上限从 110 放宽到 EN 480 / ZH 150**，且服务端保证返回的是**完整整段**音频（内部切片对调用方透明）。

## 6 任务拆分

| # | 任务 | 涉及文件 |
|---|---|---|
| T1 | 服务端按语言设限 + `textToSpeechLong`（并发合成 + mp3 拼接）+ 单测 | `servers/ai-service/src/tts/tts.service.ts`、`tts.controller.ts` |
| T2 | 共享超时常量新增前端 TTS 值 20s | `packages/shared/src/api.ts` |
| T3 | portal 切块改「首句+剩余」+ 预取 + 独立超时 + 播放实例管理 | `apps/portal/src/api/tts.ts`、`apps/portal/src/views/AiChat.vue`（`Translate.vue` 同链路核对） |
| T4 | 小程序切块改「首句+剩余」+ 修 `InnerAudioContext` 泄漏 | `apps/kedou-ai-minigram/utils/translate-parse.ts`、`services/tts.ts` |
| T5 | 真机/浏览器实测：本节选句子块数=2、无中途停掉、首句 ~2s 出声 | — |

T3/T4 若不改页面模板（只改 `api/tts.ts` / `services/tts.ts` / `utils/*.ts`），不触发 UI 动作门；一旦改 `AiChat.vue` 的模板/按钮态，需先过原型门。

## 7 待确认

1. 英文上限取 480（保守）还是补测 500~519 精确边界后取 500？
2. 服务端并发上限 3 是否会触发腾讯云限流（默认 QPS 未知），需压一次确认。
3. 本地/联调验证需走发布流程（工作区 commit&push → `~/web_system_release` 构建重启；portal 前端另需 MF 构建 + 更新 `deploy_deployments.current_version`）。

## 8 实测验证（音色 603007）

| 场景 | 结果 |
|---|---|
| 单次上限 | 英文 499 成功 / 520 失败；中文 150 成功 / 300 失败 |
| 330 字符整段 | 1 片单次合成，0.6s~5.9s（随网络波动），首帧 `ff f3 48 c4` |
| 700 字符整段 | 2 片（455 + 244）并发拼接，4.7s，拼接后首帧一致，远低于 gateway 15s |
| 用户实测句（330 字符） | 切块数 5 → **2**（首句 58 + 剩余 271），271 < 480 → 服务端单次合成，无内部接缝 |
| 小程序单测 | `tests/translate-parse.test.ts` 17/17 通过（含 `splitSpeakParts` 4 条） |

## 9 业界方案调研（块间延迟 / 首包延迟）

### 9.1 问题归类

「后面的语音有点延迟」不是网络抖动，是**块间等待**：剩余块的合成要等首块返回后才发起，
等待时长 = 剩余块合成时间 − 首块音频时长。首句 58 字符音频约 3~4s，剩余 271 字符合成实测
0.6s~5.9s（腾讯云侧波动大），因此经常差出 0~3s 空档。合成耗时本身占大头，网络只占一小截。

### 9.2 业界主流做法

| 层次 | 做法 | 代表 |
|---|---|---|
| 流式合成（根治） | WebSocket 流式逐句/逐字合成，**首包延迟 300~400ms**，服务端按句合成并分块下发，天然无"整段等待"、语调连贯 | 腾讯云**流式文本语音合成**（WebSocket）、腾讯云**对话式 TTS**（TRTC，首包低至 300ms，推荐模型 flow_02_turbo）；火山引擎（<300ms）；阿里云 / 百度（WebSocket 流式）；Azure Speech（WebSocket v2 端点做文本流式输入降延迟） |
| 长文本异步 | RESTful 异步任务（提交 → 轮询/回调取音频），适合离线预生成 | 腾讯云长文本语音合成 |
| Web 端边下边播 | MediaSource Extensions：`SourceBuffer.appendBuffer` 把分片喂给 `<audio>`；配起音缓冲（jitter buffer 200~500ms）、淡入淡出、断连重连。也可用 Web Audio 解码 PCM 拼接 | MSE / Web Audio API 通行实践 |
| 小程序端边下边播 | 无 MSE。`InnerAudioContext` 支持流式 src（远程 URL 边下边播，但**有实例数上限**，正是本次"停掉"的根因）；更灵活用 `wx.createWebAudioContext()` 喂 AudioBuffer 拼接 PCM | 微信官方能力 |
| 编排 / 请求层 | 首块与后续块**并发发起**（不等首块返回）；卡片渲染即预热合成；HTTP/2 多路复用 + preconnect；结果缓存 | 各厂通用优化 |

### 9.3 本项目三档路线

| 档 | 做法 | 预期 | 代价 |
|---|---|---|---|
| **P0** | ① 首块与剩余块**并发发起**（现在剩余块等首块 RTT 后才请求）② 首块缩到首个逗号/从句（更快出声）③ 卡片渲染即后台预热合成 | 省掉一个 RTT，剩余块合成被首块播放完全掩盖，空档基本消失 | 仅端侧改动，服务端不动 |
| **P1** | 服务端接腾讯云**流式文本语音合成**（WebSocket）→ gateway 加 SSE/chunked 流式通道 → 端侧边收边播（Web 用 MSE，小程序用 `createWebAudioContext`） | 首包 ~300ms 出声；长文本无整段等待；语调连贯 | 新增流式接口 + gateway 流式转发 + 超时模型改造；音色是否支持流式需先确认 |
| **P2** | 换对话式 TTS（TRTC）/ 火山流式，或长文本异步 + 预生成 | 极致延迟 / 成本优化 | 换厂商或换音色，需业务确认音色一致性 |

### 9.4 落地 P1 前必须确认

1. 音色 603007 是否可用于流式 / 对话式接口（文档推荐模型 `flow_02_turbo` 支持中英日粤）—— 换音色会影响产品调性。
2. 流式接口的计费与并发额度（与实时语音合成共用并发额度）。
3. gateway 现有 TTS 转发是整包 `http.request`（`proxy.controller.ts`），需改为流式转发；`API_TIMEOUT.GATEWAY.TTS` 的一次性超时模型也要换成「首包超时 + 流空闲超时」。

## 10 P1 设计：流式合成（腾讯云流式文本语音合成 WebSocket）

### 10.1 官方协议要点（文档 product/1073/108595）

| 项 | 值 |
|---|---|
| 端点 | `wss://tts.cloud.tencent.com/stream_wsv2?{params}` |
| Action | `TextToStreamAudioWSv2` |
| 必填参数 | `AppId`(整型) / `SecretId` / `Timestamp` / `Expired` / `SessionId` / `Codec` / `Signature` |
| 签名 | 除 Signature 外参数**字典序**拼接 → `GETtts.cloud.tencent.com/stream_wsv2?{串}` → HMAC-SHA1(SecretKey) → base64 → **urlencode** |
| 流程 | 握手 → 等 `ready=1` → 发 `ACTION_SYNTHESIS{data:文本}`（可多次）→ 收 **binary 音频帧** + text 事件帧 → 发 `ACTION_COMPLETE` → 收 `final=1` → 主动关闭 |
| 音频 | `pcm`（默认）/ `mp3`；采样率 8000/16000/24000；16bit 单声道 |
| 并发额度 | **超自然大模型音色 10 路**（与实时语音合成共用）；精品/大模型 20 路 |
| 限制 | 单会话 ≤10000 字；10 分钟无输入则关闭；不支持 SSML；两次合成指令间隔 ≤10 分钟 |
| 官方 SDK | 仅 Java / Python，**无 Node** → 需自研 WS 客户端（`ws`） |

### 10.2 关键风险：英文断句

服务端分割标点只列了全角 `。；？！`、半角 `; ? !` 与换行 —— **英文句点 `.` 不在列表内**。
英文长句若不逐句发送，服务端会一直缓存、音频迟迟不出（文档明确"确保合成文本包含正确标点"）。
→ 端侧必须**逐句发送**（每句一次 `ACTION_SYNTHESIS`，句末带标点），不能整段一把梭。

### 10.3 架构

1. `ai-service` 新增 `TtsStreamService`：连接腾讯云 WS，暴露「文本进 → 音频帧出」的 Node `Readable`；
   内部按句发送 + 收齐后发 `ACTION_COMPLETE`；异常/超时关闭连接。
2. `gateway` 新增流式通道：统一走 **WebSocket**（`@WebSocketGateway`，需新增 `@nestjs/websockets` + `ws`），
   portal 与小程序共用一套；握手时带 JWT（小程序 `wx.connectSocket` 支持 header）。
3. 端侧边收边播：
   - portal：`pcm` → Web Audio 队列（`AudioBufferSourceNode` 排队，无间隙）；或 `mp3` → MSE `SourceBuffer`。
   - 小程序：无 MSE。`pcm` → `wx.createWebAudioContext()` 手动填 `AudioBuffer`；
     `InnerAudioContext` 虽支持流式 src 但有实例上限（本次"停掉"的根因），不作为主路径。
4. 开关与降级：`TTS_MODE=chunked|stream`（服务端 env）；流式失败/未配置 → 自动回退现有整段链路。

### 10.4 阻塞项（开工前必须解决）

| # | 阻塞 | 现状 | 需谁解决 |
|---|---|---|---|
| 1 | `AppId`（流式握手必填，非 SecretId/Key） | 仓库无任何 `TENCENT_APP_ID` 配置 | 用户：腾讯云控制台 → API 密钥管理页取 AppId，配进 `servers/ai-service/.env` |
| 2 | 音色 603007 是否支持流式 | 文档未明列（并发条款提及"超自然大模型音色 10 路"，暗示支持） | 拿到 AppId 后用直连脚本实测（10 行代码即可判定，错误码 10001 即不支持） |
| 3 | gateway 无 WS 依赖 | `@nestjs/websockets` / `ws` 均未安装 | 实现时新增依赖 |
| 4 | ai-service 无 ws 依赖 | 未安装（根 `node_modules/ws` 为传递依赖，不可依赖） | 实现时显式声明 |
| 5 | 并发额度 10 路 | 超自然音色上限低，多用户并发朗读可能 10002 | 需限流/排队；量大需商务提额 |

## 11 P2 设计：预生成 / 换引擎

| 方案 | 落地形态 | 依赖 | 评价 |
|---|---|---|---|
| P2-a 长文本异步合成 | 云 API `CreateTtsTask` + 轮询/回调，离线产出音频 | 只需 SecretId/Key（**无需 AppId**） | 适合批量离线（术语库/收藏朗读），不适合即时交互 |
| P2-b 对话式 TTS（TRTC） | 首包 ~300ms，客户端 SDK 接入 | TRTC SDK、账号开通 | 延迟最优，但接入模型与现有 HTTP 链路差异大 |
| P2-c 端侧预热（成本换体验） | 卡片渲染完成即后台合成并缓存，用户点朗读时秒播 | 现有接口即可 | 见效最快；代价是**没点的也会产生合成费用与并发**，需限制（仅最新 1 条、仅 ≤600 字符） |
