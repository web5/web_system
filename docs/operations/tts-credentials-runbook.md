# TTS（朗读）凭据配置 Runbook

> 适用：ai-service 的「朗读」能力（`POST /api/ai/tts/speak` 整段合成、`GET /api/ai/tts/stream` 流式合成）。
> 事故背景：2026-10-09 发现 dev/prod 从未配过 `TENCENT_*`，朗读长期 503 且无人察觉（`rNPjtC`）。
> 关联：`specs/tts-continuity/design.md` · `docs/operations/release-checklist.md` D/G 段。

---

## 1. 需要哪几个键

| 键 | 用途 | 不配的后果 |
|---|---|---|
| `TENCENT_SECRET_ID` | 云 API 签名 | 整段 + 流式**全部** 503 |
| `TENCENT_SECRET_KEY` | 云 API 签名 | 同上 |
| `TENCENT_APP_ID` | **流式**签名（自研签名，参与 WS 握手） | **整段能用、流式 503** ← 最坑的一种半残状态 |

> ⚠️ **AppId 是流式专属必填**，控制台「API 密钥管理」页顶部取整數 AppId。
> 只配 SecretId/SecretKey 时 `GET /ai/tts/health` 会返回
> `{configured:true, streamConfigured:false}` —— 端侧自动回退整段，**能听但无接缝优化**，
> 不报故障、很容易被当成「本来就这样」。

---

## 2. 凭据取值

三件套统一来自本机凭据仓 `~/env_config/tencent.env` 的 `tts/ocr` 段
（该文件权限 600，**绝不入库** —— 仓库 `web5/web_system` 是 PUBLIC）。

```bash
# 只看键名/长度，不要 echo 明文
grep -E '^(SecretId|SecretKey|AppId):' ~/env_config/tencent.env | cut -d: -f1
```

---

## 3. 配置中心：已纳管（⚠️ 下发当前**仅 local 生效**）

> ⚠️ **读这段前先看清楚**：`restart` 动作脚本里的 `config-dispatch` 段落判定是
> `if [ "$DEPLOY_ENV" = "local" ]`；而 **dev / prod 跑的是 `restart-remote`（远端版）脚本，
> 里面根本没有 config-dispatch 段**。也就是说 2026-10-09 纳管后，
> **只有本机 local 发布会自动落 `.env.generated`，dev / prod 仍要手工写 `.env`**。
> 打通远端下发是独立改动（16 条流水线的 dev 任务脚本 + lint 回归），见 §7 遗留。

已纳管（2026-10-09）：

| scope | envId | moduleKey | key | isSecret |
|---|---|---|---|---|
| module | dev | ai-service | `TENCENT_SECRET_ID` | ✅ |
| module | dev | ai-service | `TENCENT_SECRET_KEY` | ✅ |
| module | dev | ai-service | `TENCENT_APP_ID` | ❌（标识符，便于核对） |

- 密钥在库里是密文（`iv:authTag:ciphertext`），列表接口只回掩码 `••••••••`，明文不回显
- 下发路径（**local 生效**）：流水线 `restart` 动作脚本 →
  `GET /api/config/internal/dispatch/ai-service?envId=local`
  → 落盘 `servers/ai-service/.env.generated`（该文件**不会**进 git）
- 优先级：`.env.generated` > `.env`（`ConfigModule.envFilePath` 顺序）
- 纳管的价值不只是下发：它是**唯一有版本、有审计、有掩码的凭据存放点**，
  不再依赖「某台机器的 .env 里恰好有」

验证下发内容（只列键名，不打印值）：

```bash
IK=$(grep '^INTERNAL_API_KEY=' /data/web_system/servers/deploy-console/.env | cut -d= -f2-)
curl -s -H "x-internal-key: $IK" \
  "http://127.0.0.1:6200/api/config/internal/dispatch/ai-service?envId=dev" | sed 's/=.*/=<set>/'
```

---

## 4. dev / prod：手工写 `.env`（当前唯一生效路径）

> 远端下发未打通前，**两端都要手工** —— 换机/重建时最容易漏这一条。

```bash
# dev：/data/web_system/servers/ai-service/.env
# prod：/data/web_system_git/servers/ai-service/.env   ⚠️ 运行目录是 web_system_git
F=<按环境选上面之一>
cp "$F" "$F.bak-tts-$(date +%Y%m%d%H%M%S)"          # 先备份
TMP=$(mktemp); grep -v '^TENCENT_' "$F" > "$TMP"
cat >> "$TMP" <<'EOF'

# --- TTS (腾讯云语音合成) ---
TENCENT_SECRET_ID=<SecretId>
TENCENT_SECRET_KEY=<SecretKey>
TENCENT_APP_ID=<AppId>
EOF
mv "$TMP" "$F"; chmod 600 "$F"
```

**重启**（禁止 `--update-env`，它会把 pm2 记住的旧环境盖回进程）：

```bash
pm2 restart ai-service
```

---

## 5. 验收（三道，缺一不可）

1. **日志**：`pm2 logs ai-service --lines 200` 出现
   `腾讯云 TTS 客户端初始化成功`（缺凭据时是 WARN「TTS 未配置…」）
2. **健康检查**：`GET /api/ai/tts/health` → `{configured:true, streamConfigured:true}`
   （需登录 token）
3. **端到端**：`POST /api/ai/tts/speak` → 200 `audio/mpeg`；
   `GET /api/ai/tts/stream?text=...&codec=pcm` → 200 `audio/pcm`

---

## 6. 故障速查

| 现象 | 根因 | 处理 |
|---|---|---|
| 两个端点都 503，message 含「未配置」 | SecretId/SecretKey 缺失（或 `.env.generated` 覆盖成了空值） | 按 §3/§4 补配 + 重启 |
| 整段 200、流式 503 | **只缺 AppId** | 补 `TENCENT_APP_ID` |
| 配了但仍 503 | 改了 `.env` 没重启，或用了 `pm2 restart --update-env` | 去掉 `--update-env` 重新 restart |
| 页面弹「请求失败」看不到真因 | blob 响应错误体未解析（PR #258 已修） | 确认 portal 版本 ≥ `69d9e5f9` |

---

## 7. 遗留

- **远端配置下发**：给 `restart-remote` 脚本补 `config-dispatch` 段（dev 可下发，
  prod 因目标机没有控制台只能保持手工，或改成发布机代写），
  打通后 §4 的手工步骤可退化成兜底（`rm3oJf` 后续）
- 前端按钮在 `configured=false` 时禁用 + tooltip（须过 UI 门，`rVyJX7`）
- 流水线 `verify` 动作自动探 `/api/ai/tts/speak`（`rbvqgv`）
