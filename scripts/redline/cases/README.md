# 门禁黄金用例集（scripts/redline/cases/）

给红线门禁做**逐字节回归**的固定输入 + 期望输出。

```bash
bash scripts/redline/cases/run.sh              # 校验：与 expected/ 比对
bash scripts/redline/cases/run.sh --filter r17 # 只跑 id 含 r17 的场景
bash scripts/redline/cases/run.sh --update     # 重生成期望（⚠ 必须先 review diff）
bash scripts/redline/cases/run.sh --keep       # 保留临时夹具仓库（排查用）
```

---

## 为什么要有它

改门禁最怕的不是「报错」，是**改完还绿着，但判的东西变了**。

2026-10-30 实测的两个例子：

| 现象 | 后果 |
|---|---|
| 拿现有 range 当基线（`origin/master~20..HEAD`） | 本仓 `shallow=true`，range 解析成 0 commit → 跑出 `0 error / 0 warning`，**对重写零区分力**：新引擎把 8 道门全删了，基线照样「通过」 |
| 只测阳性（"该报的报了"） | 一个「把所有 commit 都判违规」的坏实现全绿 |

所以这里的每条场景都要能回答：**它防的是哪种回归**。只测阳性不够，每门至少一条阴性。

---

## 与 `test-gate-hardening.sh` 的分工（别合并）

| | `test-gate-hardening.sh` | `cases/`（本目录） |
|---|---|---|
| 性质 | 单元测试 | 黄金快照 |
| 判据 | 「该报哪个门」（布尔） | 「完整输出一字不差」（逐字节） |
| 什么时候跑 | 改判定逻辑时，秒级反馈 | 换执行引擎 / 改输出格式时，做影子比对 |
| 失败时怎么修 | 改断言 | 先看 diff，确认变化是有意的，再 `--update` |
| 数量 | 27 条 | 22 个场景 |

合并会让「改一条断言」和「重写引擎」互相污染 —— 影子期需要一份**未被改动过**的期望值。

---

## 目录

```
cases/
├── README.md        本文件
├── fixture.sh       确定性夹具仓库（被 run.sh source）
├── run.sh           运行器
├── scenarios.tsv    场景表（TAB 分隔）
└── expected/        期望输出（每个场景一个 .txt）
```

`expected/<id>.txt` 格式：

```
exit=1
errors=1
warnings=0
--- stdout ---
══ 红线违规（error）══
  [R1] 调试残留(console.log/debug/debugger)
       servers/api/src/dbg.ts:2
...
```

**为什么存完整 stdout 而不只存计数**：计数相同但报错位置/文案漂移，同样是回归。逐字节比对才能抓到「结构没变、细节全歪」。

---

## 确定性怎么保证

| 随机源 | 处理 |
|---|---|
| 文件内容 | 全部写死，不用 `$RANDOM`（`test-gate-hardening.sh` 里用了 `$RANDOM`，那是单元测试够用，黄金快照不行） |
| commit 时间 | 固定 unix 基准 `1767225600` + 每个 commit 顺序 +60s（`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`） |
| commit sha | **必然随机** → `normalize_output()` 按别名表反向替换成 `<C_XXX>` |
| 临时目录绝对路径 | 替换成 `<WORK>` |
| R20 生效日期 | 劣质理由场景的 commit 时间放在 `2026-11-01` 之后，否则质量门不判（这是有意的：历史 commit 不追溯） |

所以期望文件里**不应出现任何 40 位十六进制串或绝对路径**。出现即归一化漏了，会随机飘红。

---

## 加一个场景

1. `fixture.sh` 里造需要的 commit / 文件，`echo "C_XXX $(git rev-parse HEAD)"` 登记别名
2. `scenarios.tsv` 加一行：`id <TAB> diff|files <TAB> ${C_XXX}^..${C_XXX} <TAB> 说明（写清防哪种回归）`
3. `bash scripts/redline/cases/run.sh --update`
4. **人工 review 生成的 `.txt`**：命中门对不对？数量对不对？有没有出现 sha/绝对路径？
5. `bash scripts/redline/cases/run.sh` 再跑一次（必须全绿，证明归一化覆盖完整）
6. 提交

⚠️ **`--update` 不能当"修红"的手段**。期望值只能由人工确认过的行为产生；盲目 update 等于把"当前行为"当"正确行为"，黄金集就退化成快照记录器。

---

## 覆盖矩阵（如实标注，不粉饰）

| 门 | 阳性 | 阴性 | 状态 |
|---|---|---|---|
| R1 调试残留 | ✅ | ✅ scripts/*.mjs 白名单 | 完成 |
| R2 硬编码凭据 | ✅ | — | 部分（`.env` 入库未覆盖） |
| R3 占位残留 | ✅ TODO | — | 部分（TEMP/TBD 弱占位未覆盖） |
| R4 TS 铁律 | ✅ `: any` | ✅ 测试文件豁免 | 部分（`@ts-ignore` 未覆盖） |
| R5 CORS | ✅ | — | 完成 |
| R8 全局异常过滤器 | ✅ | — | 完成 |
| R9 UI 结构变更 | ❌ | ❌ | **未覆盖**（新增 pages / app.json IA 变化） |
| R9b 既有 UI 改动 | ✅ | — | 完成 |
| R10 Proto 凭证 | ✅ | — | 完成 |
| R11 设计评审（error） | ✅ | — | 完成 |
| R11b 原型锚点漂移 | ❌ | ❌ | **未覆盖** |
| R12 kit 同源 | ❌ | ❌ | **未覆盖** |
| R13 契约评审 | ✅ 6 行过阈值 | ✅ 1 行低于阈值 | 完成（含触发面差异现状） |
| R14 发布评审 | ✅ | — | 完成 |
| R15 新增接口评审 | ✅ | — | 完成 |
| R16 SSE 契约 | ❌ | ❌ | **未覆盖**（需 python 辅助脚本） |
| R17 测试用例凭证 | ✅ 假路径 | ✅ pass / 真实路径 | 完成（四态） |
| R18 研发方案凭证 | ✅ | — | 完成 |
| R19 空提交 | ✅ | — | 完成 |
| R20 豁免理由质量 | ✅ | — | 完成 |
| R21 旧格式豁免 | ✅ notice | — | 完成 |

**覆盖 15/21，未覆盖 6 道**（R9 / R11b / R12 / R16 完全没有，R2 / R3 / R4 有子规则缺口）。补齐顺序按「改动频率 × 判据复杂度」：R9 → R12 → R11b → R16。

---

## 已知「现状记录」型用例（红不代表坏）

这些用例忠实地记录了**当前实现的行为**，其中有的可能不符合预期。它们红了要先看这里，别急着改实现。

| 用例 | 现状 | 是否合理 |
|---|---|---|
| `commit-r13-controller-shallow` | `servers/api/src/x.controller.ts`（单层）触发 R15/R17/R18，**不触发 R13** | ⚠ 疑为漏报。R13 模式 `servers/*/src/*/*.controller.ts` 要求两层，R15/R18 用 `*/*.controller.ts` 任意层。真实仓库 controller 多在 `src/modules/<域>/` 能命中，但单层会被 R13 静默漏掉 |
| `line-r5-cors-main` | 同一个 `app.enableCors()` 报了 2 条 R5（文件级「CORS 无参启用」+ 行级「CORS 疑似硬编码」） | ⚠ 重复报，信息上冗余但不影响阻断；是否去重待定 |

---

## 下一步（门禁架构重构 S1/S2 的用法）

1. ~~**S1 语义抽取**~~ **已落（2026-10-30）**：`scripts/redline/gates.yaml` 是门的声明，`scripts/redline/gates-lint.ts` 负责把它钉在 bash 行为上（触发面逐个比对 + 用例覆盖 + 豁免接线）。见 [`docs/development/gates/00-单一真相源.md`](../../../docs/development/gates/00-单一真相源.md)
2. **S2 影子比对**：新引擎跑本用例集，输出必须与 `expected/` 逐字节一致。不一致就停下来看是人有意改的行为还是重写引入的偏差
3. **S3 切主**：切换后把 `expected/` 重新生成为基线的唯一实现，旧脚本归档

黄金集是这条路上的**唯一裁判**。没有它，重写就是"凭感觉觉得没变"。
