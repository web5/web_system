# 发布评审：脱敏器保持 JSON 结构 + 事实解析不再静默失败 + layer 存量回填

> **阻塞: 0** · **重要: 2**
> 日期 2026-10-15 · 分支 `fix/redact-json-structure` · 涉及文件 6 个（含 3 个 spec）
> 触发路径：「把 prod 纳入环境事实巡检」→ 首次采集出现异常判定 → 定位到两个缺陷；
> 同批顺带把 P0-1 缺失的 layer 存量回填补上

## 一、背景与根因

把 `FACT_SNAPSHOT_ENVS` 扩到 `dev,prod` 后的首轮采集，prod 报 **10 项 `process` 全 missing**，
而同一批次的 `port` 事实 **10 项全 ok** —— 端口在听、进程却不存在的自相矛盾判定。

实测证据（在 dev 上用 ssh2 复现采集通道）：

```
exit=0 stdoutBytes=73741 stderrBytes=0
RAW parse:      OK, processes=10
redacted bytes=72871 (delta=870)
REDACTED parse: FAIL -> Unexpected token '*', ..."DMIN_KEY":***REDACTE"... is not valid JSON
```

根因在 `src/common/redact.ts` 的形状兜底规则：匹配 `"KEY": "value"` 时只回吐「前缀 + 占位符」，
把包裹引号一起丢掉了 → `"MCP_ADMIN_KEY":***REDACTED***` → JSON 非法。

`dev` 未暴露是因为 dev 的 `pm2_env` 里没有 `PASSWORD/TOKEN/API_KEY` 这类键名；
prod 的进程环境变量里有 `MCP_ADMIN_KEY`，正则命中。

**第二个缺陷（同类，但更隐蔽）**：`fact-parse.ts` 的 `parsePm2Processes` 在 JSON 解析
失败时 `return []`。空列表同时代表「真的没有进程」和「采集失败」两种完全相反的含义，
上层无法区分，于是把**采集机制故障**报成了**业务状态 missing**。

这是最坏的失效模式：流水线是绿的，症状却是"线上服务都没了"，会把人引导去重启正常服务。

## 二、检查清单

| 档 | 项 | 结论 |
|---|---|---|
| **A 运行** | 无进程/pm2/workflow 变更 | ✅ 纯函数改动 |
| **A 运行** | 回滚方式 | ✅ revert 两个文件；`.env` 的 `FACT_SNAPSHOT_ENVS` 摘掉 `prod` 即停 prod 采集 |
| **B 配置** | 无新增环境变量 | ✅ 未动 `.env.example` |
| **C 数据** | 无表结构变更、无迁移 | ✅ |
| **D 前端** | 无 UI 改动 | ✅ 豁免 UI 门 |
| **E 特殊** | 横切关注点需扫全仓副本（编码铁律） | ✅ 实现仅 `common/redact.ts` 一份；5 个使用点全是受益方，无第二份实现 |
| **E 特殊** | 公开仓库去敏 | ✅ 评审报告与 commit 均不出现服务器 IP / 用户名 / 密钥路径 |
| **E 特殊** | 安全语义回归 | ✅ 密钥值消失的断言全部保留，仅修正 JSON 引号（结构属非敏感） |

## 三、改动

| 文件 | 改动 |
|---|---|
| `common/redact.ts` | 形状规则拆成四条具名常量；`KEY=value` / `"KEY": "value"` 规则**原样补回包裹引号**；无引号形态不凭空添加 |
| `common/redact.spec.ts` | 修正锁住旧行为的断言（`"password": ${REDACTED}` → 带引号）；新增「脱敏后仍是合法 JSON」「引号成对」2 例 |
| `fact/fact-parse.ts` | 解析失败 / 非数组改为**抛错**，携带截断上下文；空输入或空数组仍返回 `[]` |
| `fact/fact-parse.spec.ts` | 拆分原「非 JSON → 空数组」用例；新增「必须抛错」3 条，含被改坏 JSON 的真实形态 |

行为对照：

| 输入 | 改前 | 改后 |
|---|---|---|
| `"password": "p@ss"` | `"password": ***REDACTED***` ❌ JSON 坏 | `"password": "***REDACTED***"` ✅ |
| `TOKEN=abc` | `TOKEN=***REDACTED***` | 不变 |
| `'SECRET': 'zzz'` | `'SECRET': ***REDACTED***` | `'SECRET': '***REDACTED***'` ✅ |
| `mysql://root:pw@host/db` | `mysql://root:***REDACTED***@host/db` | 不变 |

## 四、为什么两处一起修

只修 redact：prod 采集恢复正常，但下次任何原因导致输出不是 JSON（`pm2` 版本变化、
输出混入提示行、脱敏器再出岔子），仍会以 missing 的形态静默误导。
只修 parse：能正确报 error，但问题照样每天发生。

**一个是把事情做对，一个是把 failure 模式从"误导"改成"报错"。** 缺任何一个都不完整。

## 五、layer 存量回填（`scripts/config-layer-backfill.sql`）

P0-1 的字段侧早已落地（`config-item.entity.ts` 的 `layer`/`value_type`/`deliverable`），
但实体注释里点名的回填脚本一直不存在 —— 存量行的 `layer` 全是 synchronize 填的默认值 `app`。

新增 SQL + 一致性单测。**关键的防漂移设计**：层的判定在代码（`RESERVED_LOCAL_KEYS`）
和数据（本 SQL）里各有一份，天生会漂移；故由
`src/config/config-layer-backfill.spec.ts` 解析本文件并与代码名单双向比对：

| 用例 | 断言 |
|---|---|
| 不得超出 | SQL 里的键 ⊆ `RESERVED_LOCAL_KEYS`（不凭空发明） |
| 不得遗漏 | `RESERVED_LOCAL_KEYS` ⊆ SQL 里的键（少一个，那批行的 layer 永远停在 app） |
| 层与下发 | `SET layer` 只出现 `bootstrap`/`platform`，且每处都同时置 `deliverable=0` |
| 幂等 | 每条 UPDATE 都带 `WHERE layer='app'`，不覆盖人工修正过的行 |

dev 验收（2026-10-15）：

```
回填前受影响行数 = 0            ← dev 配置中心当前 12 行全是合理的 app 层
插桩 MYSQL_HOST_BACKFILL_TEST：app / deliverable=1
执行回填后：                    bootstrap / deliverable=0 / updated_by=config-layer-backfill
清理临时行后残留 = 0
```

⚠️ 现实说明：**dev 上没有真正需要回填的存量脏数据**（配置中心目前只登记了少量应用级键，
没有 `MYSQL_*` 之类引导键）。本项的价值是把设计文档里点名却一直缺失的回填环节补上 ——
将来配置中心接入引导键时可以直接跑，且单测保证它不会与代码漂移。

## 六、验证

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 error |
| deploy-console 全量单测 | ✅ 78 suite / 884 例通过 |
| 新增/改写用例 | redact +2、fact-parse +3（含"必须抛错"反向）、layer-backfill +4 |
| dev 部署 | ✅ `/health` 200，重启无新增 ERROR |
| **prod 事实巡检首跑（修复后）** | ✅ `事实巡检通过（env=prod，26 项一致）` |
| prod process 事实 | ✅ 10 项 missing → **10 项 ok** |
| layer 回填 | ✅ 插桩行 `app/1` → `bootstrap/0`，执行后清理干净 |

**同批次事实一览（首次把 prod 完整纳入观测）**

| env | dir | port | process | version |
|---|---|---|---|---|
| dev | 3 ok | 12 ok | 12 ok | 2 ok + 1 skipped |
| prod | 3 ok | 10 ok | 10 ok | 2 ok + 1 skipped |

（`version` 的 skipped 是 `shell` —— index.html 入口型产物不走 SystemJS 版本指针，
适用判定见 `2026-10-14-fact-snapshot-v1.md`）

## 重要项（不阻塞，需记入后续）

1. **脱敏器目前仍会修改任何含敏感键名的文本内容**，`ssh-exec.service.ts` 的所有调用方
   拿到的都是脱敏后的输出。本次修复后 JSON 结构可保，但**值被替换**这一点不变 ——
   将来若有逻辑依赖 SSH 输出的**精确值**（而非结构），需先确认该值不在 `SECRET_ENV_KEYS`
   且键名不匹配形状规则，否则会被静默改写。建议在 `execOn` 的注释里标注这条（已补）。
