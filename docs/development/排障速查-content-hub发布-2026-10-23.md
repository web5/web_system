# 排障速查：content-hub 发布（2026-10-23 沉淀）

> 格式与收录标准：`~/AiWorkspace/20-私域资产/排障速查规范.md`（总控，通用规范）
> 本文是**项目实例**：只放可复用的判据/命令。
> 本次事故（一次功能发布连撞三个坑）因果见：`事故复盘-content-hub发布-2026-10-23.md`

---

## 1. 加了实体字段但 DB 没列：dev 也不会自动建

- **现象**：发布后新版本起不来 / 起起来但查询炸
  ```
  Runtime did not become healthy with the expected process and port
  driverError: Unknown column 'XxxEntity.publish_mode' in 'field list' (ER_BAD_FIELD_ERROR 1054)
  ```
- **根因**：content-hub 的 TypeORM 配置是
  `synchronize: configService.get('NODE_ENV') !== 'production'`，
  而 **dev 机的 `.env` 里 `NODE_ENV=production`** → dev 的 synchronize 同样是关的。
  也就是说：**不是只有 prod 要写迁移，dev 也要**。
- **判据**
  ```bash
  grep -E "^NODE_ENV=" /data/web_system/servers/<svc>/.env        # dev / prod 都看
  mysql … -e "SHOW COLUMNS FROM <table> LIKE '<column>';"          # 列到底在不在
  ```
- **处置**：补列（先备份单表，幂等判断）
  ```bash
  mysqldump … <db> <table> > /tmp/<table>_backup_$(date +%s).sql
  mysql … -e "ALTER TABLE <table> ADD COLUMN <col> varchar(16) NOT NULL DEFAULT 'publish';"
  ```
- **易误判**：看到 restart 失败就以为「服务有问题」。实际服务进程可能活着、health 也 200，
  炸的只是某个查询 —— 流水线的健康判定比 curl 更严（要进程+端口+预期进程）。
  **先读 `pm2 logs` 的 error 文件，不要只看流水线文案。**

---

## 2. 同一 commit 重发撞 Immutable

- **现象**：第二次发同一个 commit，卡在「发布」动作（比 restart 更早）
  ```
  Immutable runtime version already exists with different content
  ```
- **根因**：runtime 目录一旦写入就不可变；重发时 payload sha 与首次不一致
  （首次失败留下的半截产物 / 配置注入差异），被判为「同版本不同内容」。
- **判据**：`publish.sh status <jobId>` 里对比两次的 `payloadSha256`
- **处置**（重发前清产物，**别误删在用版本**）
  ```bash
  ls /home/ubuntu/web_system_runtimes/<svc>/<svc>-dev/          # 先确认在用版本
  readlink /data/web_system/servers/<svc>/dist                  # 在用版本 = 软链目标
  rm -rf /home/ubuntu/web_system_runtimes/<svc>/<svc>-dev/<commit> \
         /data/web_system/servers/<svc>/<svc>-dev/<commit>
  ```

---

## 3. preflight 因磁盘 FAIL 拒绝发布

- **现象**
  ```
  [FAIL] 磁盘 / 使用率 96% 可用 2033M（<2G）—— 会卡在 upload/scp
  ABORT: preflight 未通过，拒绝发起发布
  ```
- **判据 / 清理顺序**（dev 机 50G 盘实测）
  ```bash
  df -h / ; du -sh /tmp/* | sort -h | tail        # /tmp/content-hub-dist-* 构建残留
  du -sh /home/ubuntu/web_system_runtimes/<svc>/<svc>-dev/* | sort -h   # 历史版本目录
  ```
  每个历史版本目录约 280M，删 3 个 ≈ 840M；`/tmp/content-hub-dist-*` 一次构建 25~240M。
- **易误判**：`--skip-preflight` 跳过去。磁盘真的不够会在 upload/scp 阶段以更费解的方式失败，
  先清再发比跳过快。

---

## 4. 一条命令拿到服务当前 DB 配置（prod 无 .env，配置在 pm2 环境里）

```bash
ssh <host> 'bash -s' <<'R'
ID=$(pm2 jlist | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).find(x=>x.name==='content-hub').pm_id)})")
ENVOUT=$(pm2 env "$ID"); get() { echo "$ENVOUT" | sed -n "s/^$1: //p"; }
mysql -h"$(get DB_HOST)" -P"$(get DB_PORT)" -u"$(get DB_USERNAME)" -p"$(get DB_PASSWORD)" "$(get DB_DATABASE)" -e "SELECT 1;"
R
```
- `pm2 env <name>` 不认服务名，**只认 id**（`pm2 jlist` 取 `pm_id`）。
- prod 的 content-hub `.env` 里没有 `DB_*`（那是 dev 的形态），DB 配置全在 pm2 进程环境里。

---

## 5. 发布后怎么确认「真的生效」

| 层 | 命令 | 通过标准 |
|---|---|---|
| 流水线 | `publish.sh <env> <svc> --commit <sha>` | 末尾 `verdict=verified`（**不是** `status=succeeded`） |
| 代码 | `ssh <host> "cd /home/ubuntu/web_system_build/<build-dir> && git log --oneline -1"` | = 目标 commit |
| DB | `SHOW COLUMNS FROM <table> LIKE '<new_col>';` | 列存在 |
| 行为 | 打真实接口（见 §6） | 返回体 status 符合预期 |

---

## 6. 公众号发布模式（draft / publish）验证

```bash
# 草稿模式：只进草稿箱，落 published 记录 status=drafted
curl -s -X POST http://127.0.0.1:6007/api/content/wechat/draft \
  -H "Authorization: Bearer $CONTENT_HUB_SERVICE_KEY" -H "Content-Type: application/json" \
  -d '{"title":"模式验证-草稿","html":"<h2>x</h2><p>正文</p>"}'
# 期望：{"success":true,"status":"drafted","media_id":"…","publication_id":N,"error":null}

SELECT id,target,status,
       JSON_EXTRACT(detail,'$.mode')     AS mode,
       JSON_EXTRACT(detail,'$.media_id') AS media_id
FROM content_publications ORDER BY id DESC LIMIT 3;
```
| detail.mode | 含义 |
|---|---|
| `"draft"` | 主动选的草稿模式（预期结果） |
| `"publish"` | 正式发布路径 |
| `NULL` | 2026-10-23 前的记录，或 48001 被动降级（旧口径） |

- 公众号未认证个人号撞 48001 时，正式发布仍会降级为 `drafted` 且带 `error` —— 这是**被动**，
  与主动 `mode=draft` 的区别就在 `detail.mode` 与有没有 `error`。
