# 自动合入（Auto-merge）开启指南 · 2026-09-28

> 目标：PR 打开后不用人盯 —— 质量门全绿 GitHub 自动合并，有红就挂着不动。
> 质量门 = quality-gate workflow 的两个 job：`红线扫描（R9–R14）` + `改动包 build/test`。

## 一、仓库设置（管理员一次性操作，共 2 步）

> ⚠️ 本地 gh 的 fine-grained PAT 无 Administration 权限，API 会 403，须在网页操作；
> 或用带 `Administration: read/write` 权限的 token 跑文末的 API 版本。

### 1. 允许自动合入

```
Settings → General → Pull Requests → ✅ Allow auto-merge
```
> 合并形态：仓库**惯例是 merge commit**（master 历史绝大多数提交为双父节点 merge commit）。
> `.github/workflows/{auto-pr,auto-merge}.yml` 的 `merge_method` 已统一为 `merge`；
> 本地手动合也用 `gh pr merge --auto --merge`，不要用 `--squash`。

### 2. master 分支保护 + 必需检查

```
Settings → Rules → Rulesets（或经典 Branches → Add branch protection rule）
```

经典保护规则配置项：

| 配置 | 值 | 说明 |
|---|---|---|
| Branch name pattern | `master` | |
| ✅ Require a pull request before merging | 开 | 禁止直推 |
| ✅ Require status checks to pass | 开 | 自动合入的前提 |
| └ 搜索并添加必需检查 | `红线扫描（R9–R14）`<br>`改动包 build/test` | 名字必须与 workflow 里 `name:` 逐字一致 |
| ✅ Require branches to be up to date | 开（可选） | 开了更安全，但 PR 多时要 frequent update |
| ❌ Do not allow bypassing the above settings | 按需 | 管理员要不要留后门自行权衡 |

**API 版本**（有 admin token 时可替代上面两步）：

```bash
gh api -X PATCH repos/web5/web_system -f allow_auto_merge=true
gh api -X PUT repos/web5/web_system/branches/master/protection --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["红线扫描（R9–R14）", "改动包 build/test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

## 二、日常使用（配置完成后零操作）

- **auto-pr 自动建的 PR**：workflow 已自动挂上自动合入（`mergeMethod=MERGE`），checks 全绿即自动合，无需任何动作。
- **手工开的 PR**：不用手动点，`auto-merge.yml` 对**所有**同仓库、非草稿 PR 都会挂（2026-10-23 起）。
- **落后 master 时**：`auto-merge.yml` 会自动 `updatePullRequestBranch` 同步（2026-10-23 起，见 §四），
  同步后 checks 重跑一轮，自动合入保持有效 —— 不再需要人工 `gh pr update-branch`。
- **想撤**：PR 页面 Disable auto-merge；checks 红了 GitHub 会一直挂着不合并，不会误合。

## 三、commit trailer 速查（让门禁一次通过）

红线扫描按 commit message 判定，trailer 必须是**行首独立行**（正文里随口提"豁免"无效）：

| 场景 | 必须带的行 | 级别 |
|---|---|---|
| 改 UI 源码（.vue 等），评审已过 | `Design: pass` | **error 级，缺了必红** |
| 纯文案/视觉微调豁免 | `Micro-exempt: <理由>` | 代替上一行 |
| 原型凭证 | `Proto: <sha>` | warning；⚠️ sha 后**直接换行或空格+英文**，别黏中文括号（如 `Proto: abc1234（说明）` 会被当成非法 sha） |
| 动契约/迁移（controller、migrations、packages/types…） | `Contract: pass` | warning |
| 动发布面（workflows、ecosystem、部署脚本…） | `Release: pass` | warning |
| 新增对外接口 controller | `Code: pass` | warning |

示例（合规的微调豁免 commit）：

```
chore(portal): 欢迎页示例问题更新

正文说明……

Proto: 51632a8
Micro-exempt: 纯文案替换，无结构/交互变更
```

## 四、已知边界

- 必需检查的名字改了（如 workflow 里 job 改名），分支保护里要同步改，否则永远 pending。
- **分支落后 master（`mergeStateStatus=BEHIND`）**：2026-10-23 起由 `auto-merge.yml` 的
  「落后 master 时自动同步分支」step 自动处理（`updatePullRequestBranch`）。三条实现细节：
  1. `mergeable_state=unknown`（GitHub 异步计算，刚 push 完常见）会等 3s 再读一次；否则会把
     「还没算完」误判成「无需同步」。
  2. 安全阀：head 已包含 base sha（说明刚同步过）直接跳过，避免 synchronize 触发的第二轮重复同步。
  3. 同步失败**只 warning 不判红** —— 「该不该合」没被破坏，只是没自动补齐条件；
     判红会让每次落后都红一片，反而盖住真正的问题。日志里带临时修法（`gh pr update-branch <n>`）。
  4. ⚠️ `AUTO_PR_TOKEN` 需 **`contents: write`**（`updatePullRequestBranch` 的要求，比只挂合入的
     `pull_requests:write` 高一档）。2026-10-23 实测当前 token 已具备。
  5. ✅ **已补（2026-10-23）**：PR 已开着、master 后来前进 —— 由新增的 `sync-behind-on-master`
     job 负责（`push: branches: [master]` 触发，扫所有开放 PR，只同步 `behind` 的）。
     **此前这里写的是「有意不做（每次合并都扫所有 open PR）」，今天证明这个权衡是错的**：
     master 前进**不会产生任何 `pull_request` 事件**，所以上面那个同步 step 只在
     「PR 恰好有动静」时才跑得到。实测 PR #417：12:30 变 `BEHIND`，随后 #418、#419 接连合入，
     它一直 `BEHIND`、`autoMergeRequest` 挂着却一动不动，只能人工 `gh pr update-branch`。
     代价重算：开放 PR 常年个位数，成本 = 1 次 list + 每个 PR 1 次 get；
     对比「每次都要人记得手敲 update-branch」，这个成本可以直接认。
  6. 🔴 **安全阀的比对基准是「当前 base 分支 tip」，不是 `pr.base.sha`**。
     `pr.base.sha` 是**该 PR 记录里的 base**（分支上次合并/分叉时的 master 提交），
     master 前进后它不会跟着变。2026-10-23 实测：#417 的 head `467c06a1` 是 merge commit，
     父提交里就含着 `pr.base.sha = 3a0d83b9`（旧 master），而当时 master tip 已是 `21725b60` ——
     拿 `pr.base.sha` 比对会把「落后 2 个提交」判成「已同步」，落后 PR 于是**永远被跳过**。
     push 事件直接用 `context.payload.after`（当前 tip，零 API 且准确），其他事件退回
     `repos.getBranch(base.ref)`。回归用例：「旧 base 不得被当成已同步（#417 回归）」——
     把基准改回 `pr.base.sha` 它会立刻变红（已用负向探针验证）。
  7. ⏳ **`mergeable_state` 必须轮询，不能「等一轮看一眼」**。master 前进后十几秒内它一直是
     `unknown`。实测 05:20:26 合并、05:20:32 job 开跑、等 3 秒后 #417 / #420 仍是 `unknown`
     → 被当成「无需同步」全跳过，job 白跑一轮。现在轮询 5×3 秒；15 秒后仍 `unknown` 就
     `core.warning`（下一次 master 前进会再试），**不静默**。
- 🔴 **mock 测不出 GraphQL schema 错误**：`expectedHeadOid` 必须声明成 `GitObjectID!`
  （写成 `String!` 会报 `Type mismatch ... (String! / GitObjectID)`），而假 graphql 对变量类型
  照单全收 —— 单测全绿、线上必挂（PR #409 实测）。

  **改完这两个 workflow，先跑一条命令再推**：

  ```bash
  node scripts/verify-workflows.mjs --schema
  ```

  它把「人眼看日志发现不了」的那几件事都做成了断言（**35 条离线 / 40 条含 schema**，任一失败退出码 1）：

  | 层 | 覆盖 | 需要网络 |
  |---|---|---|
  | YAML + 每段 `script:` 的语法 | 2 份 YAML、3 段内嵌脚本 | 否 |
  | 静态回归 | 无 `rest.pulls.enableAutoMerge`（#396 根因）、`$oid` 声明必须是 `GitObjectID!`（#409，**两个同步块各查一次**）、`on.push.branches` 必须含 `master`（缺了 #417 会一直挂着） | 否 |
  | mock 行为 | 首次挂上 / 已挂幂等 / 非 OPEN 不动 / **mutation 名改错必须判红** / auto-pr 只 warning / BEHIND 触发同步 / 已同步跳过 / clean 不动 / `unknown` 等一轮重读 / **master 前进后只同步 behind 的 PR（草稿与 fork 必须跳过）** / master 同步的安全阀 / master 同步遇 unknown / master 同步失败只 warning | 否 |
  | 线上 schema | `Mutation` 里确有 `enablePullRequestAutoMerge`、`updatePullRequestBranch`；`expectedHeadOid` 类型与声明一致；`updateMethod` / `mergeMethod` 取值合法 | 是（`gh` 已登录） |

  不加 `--schema` 时只跑离线部分（schema 那几条会显式标注「未含」，不会假装通过）。
  底线：**mock 通过 ≠ 线上能跑**，这两层是并列的，少跑一层就等于没测。

  单查某个类型时仍可直接 introspection：
  ```bash
  gh api graphql -f query='{ __type(name:"UpdatePullRequestBranchInput"){ inputFields{ name type{ name ofType{ name } } } } }'
  ```
- 红线扫描 R11 是 **error 级**：UI commit 缺 `Design: pass` / `Micro-exempt:` 会直接挂——这是 2026-09-22 拍板的口径，不是误报；被拦时按上表补 trailer 即可（改 commit message 用 `git commit --amend` 或 rebase）。
