# 测试范围决策

阻塞: 0

- 决策：**B 抽样**（SOP §7.4 人审节点，2026-11-20 20:21 用户「按默认继续」逐项确认）
- 命中共享面：`scripts/ci/changed-packages.sh`（SOP §7.3 L226「测试与构建基建」，R23 `test_surface`）
- 适用规范：§7.4 人审节点 / §7.6 核心接口 ≥5 条 / §7.8 `TestScope` trailer / §7.9 反模式 2、3
- 关联：PR #662 · 任务产物 `74` §五 / `75` §三
- 不跑全量：`09` §2 L54「不得跑全量、不得用 CI 改动包绿替代」

| 编号 | 检查面 / 核心接口 | 包 | 为什么核心 | 怎么验 | 通过标准 |
|---|---|---|---|---|---|
| C-01 | C9 原型护栏单套件 | apps/dachengzi-minigram/tests | CI 唯一失败用例所在套件 | `pnpm exec jest tests/auth-expiry-v7c.test.ts --config tests/jest.config.js --runInBand --no-coverage` | 40/40、exit=0、C9 首条 `it` 非 skipped |
| C-02 | 冻结原型副本字节级 | apps/dachengzi-minigram/prototype | 测试数据源从仓库外迁到仓库内 | `shasum -a 256` + `cmp` | sha12 `7e71bfe5152f` / 95431 B；原件 mtime `1794969610` 不变 |
| C-03 | 断言未削弱 + `tests/` 零硬编码路径 | apps/dachengzi-minigram/tests | 防「改测试造绿」 | `git diff` + Grep `/Users/geekwen\|AiWorkspace\|existsSync\|it.skip` | L48/L49 逐字未改、零命中 |
| C-04 | CI 脚本语法 | scripts/ci | 共享面直接改动 | `bash -n scripts/ci/changed-packages.sh` | EXIT=0；`pnpm test -- --runInBand --passWithNoTests` 未变 |
| C-05 | 失败分支完整回显 + 变异反例 | scripts/ci | 本次治本目标 | `/tmp` 副本造必失败命令；并把 `cat` 改回 `tail -20` | A 态全文回显 / B 态末 20 行截断，两态可区分 |
| C-06 | 变异防假绿（C9） | apps/dachengzi-minigram/prototype | SOP §2.1 L109「至少要有一个能失败的」 | 副本改名 → C9 FAIL → 恢复 → 再跑 | `1 failed/39 passed` + ENOENT 指向仓库内 `prototype` → 40/40、无探针残留 |
| C-07 | 改动面 + 暂存区 | 仓库根 | 防夹带 | `git status --short` / `git diff --cached` | 恰好 4 文件、staged 空、`docs/` 3 行外部写入不认领 |
| C-08 | 门禁实现层无 error 门 | scripts/redline | 判合入可行性 | 读 `72` L139/L152/L165 | R23 仅 warning；CI 与本地均无 `--strict` |
| C-09 | 流水线脚本体检 + 专用验收 | scripts/ci | 共享面消费方 | `pipeline-lint` / `test-changed-packages.sh` | EXIT=0 / 8-0；`changed-packages.sh` 未入逐字节快照 |

**覆盖包**：`apps/dachengzi-minigram`（`tests/` + `prototype/`）、`scripts/ci`（构建脚本）、`scripts/redline` / `scripts/pipeline-lint.mjs`（门禁实现，只读核实）。

**未覆盖范围与风险**（SOP §7.4 硬性要求，如实列）：
- 未跑全量 18 套件（`09` §2 L54 禁止）；SOP §7.2 L205「改动包全绿不代表消费方不炸」，本单无生产模块导出变更，消费方风险由 CI 全量 job 覆盖，非本地绿证明。
- 本机 Node 22 / CI Node 20.20.2 环境差异；CI checkout 取 **PR merge commit**（`72` Q1）。
- `/tmp` 副本验证 ≠ CI runner 真实执行新脚本，须靠**新 push 触发 `synchronize`** 后 CI 一手日志补正；**Re-run 复用旧 `GITHUB_SHA` 无效**（`72` L97/L100）。
- `rm -f` 保留 → 失败时 job stdout 可见完整输出，但**无 artifact 留存**（`66` L282 方案 S 原文含「并/或 upload-artifact」）；要留存须另行授权改 workflow，本单不含。
- 「原型体系静态门禁」只扫 `PROTO_DIR = docs/ui/prototypes`（`72` Q4），新增副本不在其扫描面。
- 「规格体系静态门禁（命名 / 状态字段 / 死链 / 空壳 / 可验判据）」当前 CI pass，但其实现在本仓库 `.github/workflows/` 与 `scripts/` 内**未定位到**（疑似外部托管 check）→ 新增 `docs/test-scope/*.md` 是否落入其扫描面**无法从仓库内判定**，属如实未覆盖项；若该 check 翻红，只读取证、另单处置，不绕检查、不改门禁配置。
