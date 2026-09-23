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
