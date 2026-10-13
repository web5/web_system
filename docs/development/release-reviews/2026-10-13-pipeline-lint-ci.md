# 发布评审报告 · pipeline-lint 接入 CI 门禁（2026-10-13）

```
阻塞: 0
重要: 1
```

> 触发面：`.github/workflows/quality-gate.yml`（CI 门禁）+ `scripts/pipeline-lint.mjs`（体检脚本）
> 判据源：`docs/development/release-review-checklist.md`（E 特殊通道为主；A/B/C/D 逐条判定适用性）
> 目标：把「改一行 shell 也踩坑」的反馈从"上线后"前移到"PR 阶段"，拦住 L1（语法）与 L5（ssh 缺续行符）两类最贵事故

---

## 变更内容

| 项 | 值 |
|---|---|
| 发布目录 | 无（本次不发布任何服务、不投产物、不改版本表、不重启进程） |
| 代码改动 | `scripts/pipeline-lint.mjs` 新增 `--scripts <dir>` 静态模式；`quality-gate.yml` 新增 `pipeline-lint` job |
| 是否启停服务 | **否** |
| 是否动 DB | **否**（本次刻意不碰 `deploy_pipeline_actions`，理由见 J3） |

---

## 逐条评审

### 适用项

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| E3 | 变更后有验证动作、留证据 | ✅ | 见下方「验证证据」三节 |
| E4 | PR 挂自动合入、合入方式符合惯例 | 🔄 提交后执行 | CI 全绿后 `gh pr merge --auto` |
| B1 | 不用 `pm2 restart --update-env` | ✅ 不涉及 | 本次无服务重启 |
| E1 | deploy-console 自身不走流水线 | ✅ 不涉及 | 本次未发布 deploy-console；其 dev 部署在同日另一条独立链路完成 |

### 不适用项（附理由，避免"没查就跳过"）

| 段 | 不适用理由 |
|---|---|
| A1/A2/A4/A5 | 无服务发布、无进程占用、无 ecosystem 登记需求；CI 每次是全新 checkout |
| A3 | 不涉及 `packages/*` 构建 |
| B2/B3/B4/B5 | 无配置来源变更、无密钥改动、无占位符风险 |
| C1–C6 | 无数据迁移、无跨库写入、无破坏性变更 |
| D1–D4 | 无前端产物、无版本指针改动 |

---

## CI 门禁自建判据（checklist 未覆盖，本次补）

| # | 判据 | 结论 |
|---|---|---|
| J1 | **新 job 不得让存量 PR 必红** | ✅ 全仓 47 个 `.sh` 试跑 **error 0**。8 条 L6 warning 是文档已声明的已知误报（远端 ssh 块内的 `rm -rf`），L6 是 warning 不阻断 |
| J2 | **不得需要任何 secret / 外网** | ✅ 只用 Node 内置模块（`child_process` / `fs` / `os` / `path`），无需 `pnpm install`，不联网、不连 DB |
| J3 | **不得把运维信息带进 PUBLIC 仓库** | ✅ 这是本次最重要的约束。DB 动作脚本含 `REMOTE_DIR` / 主机 / 账号，导出即泄露；故**只体检仓库内已有的公开 `.sh`**，DB 侧仍靠运维定期 `--from-db`。该约束已写进脚本文件头 |
| J4 | **Node 版本兼容** | ✅ CI 用 `node-version: 20`；`fs.readdirSync(dir,{recursive:true})` 自 20.1 起可用，setup-node 装的 20.x 最新版满足 |
| J5 | **失败可定位** | ✅ 报错格式 `[规则] …/文件名` + 行号 + 原文片段，CI 日志可直接定位 |

---

## 验证证据

**① 正向（全仓）**

```
$ node scripts/pipeline-lint.mjs --scripts scripts
pipeline-lint · 来源 scripts · 动作 47 个
error 0 · warning 8
EXIT=0
```

**② 反向（造两个真实缺陷，确认拦得住）**

```
bad-ssh.sh    : ssh -i "$KEY" "$U@$H"      ← 下一行未续行
                "rm -rf '$DIR'"
bad-syntax.sh : if [ "$A" == "1" ]; then   ← 缺 fi
good.sh       : set -e / echo hi

$ node scripts/pipeline-lint.mjs --scripts /tmp/lint-test
error 2 · warning 0
[L5] static-scripts / static / bad-ssh.sh
    第 2 行 ssh/scp 缺续行符 → 下一行命令将落本地执行
[L1] static-scripts / static / bad-syntax.sh
    bash -n: … line 4: syntax error: unexpected end of file
EXIT=1
```

`good.sh` 零报错 —— 无误报。**退出码 0 / 1 符合 CI 门禁语义。**

**③ 结构校验**

```
$ ruby -ryaml -e "YAML.load_file('.github/workflows/quality-gate.yml')['jobs'].keys"
jobs: redline-scan, pipeline-lint, changed-packages
```

---

## 重要（非阻塞）：静态模式的规则裁剪是刻意的

静态脚本没有流水线变量表 / 任务 kind / 聚合上下文，故只跑：

| 规则 | 是否跑 | 理由 |
|---|---|---|
| L1 bash -n 语法 | ✅ | 与上下文无关 |
| L5 ssh 缺续行符 | ✅ | **核心**；2026-09-29「脚本在 dev 机上删 prod 目录」就是它，`bash -n` 完全抓不到 |
| L6 危险命令提示 | ✅ warning | 与上下文无关 |
| L9 curl 调 CONSOLE_API 须带 `-f` | ✅ | 纯文本判据，静态脚本同样适用（防「HTTP 4xx 也返回 0」的静默失败） |
| L4 变量未声明 | ❌ 跳过 | 静态脚本的变量来自调用方注入的 env，无 `deploy_pipeline_vars` 可查 → 会把 `${PUBLISH_KEY}` 之类全判未声明 |
| L7/L8 聚合口径 | ❌ 自动不命中 | 静态 `pipelineId='static-scripts'` 不匹配 site-version / env-dir 应用集合 |

后续若要把 DB 动作也纳入 PR 门禁，正解是**让流水线脚本本身版本化进仓库**（同时满足"平台轻量、脚本承担"方向），而不是把快照导进 PUBLIC 仓库。
