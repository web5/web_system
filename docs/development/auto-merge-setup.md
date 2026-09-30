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

- **auto-pr 自动建的 PR**：workflow 已自动 `enableAutoMerge(squash)`，checks 全绿即自动合入，无需任何动作。
- **手工开的 PR**：PR 页面底部点 **Enable auto-merge**，或本地：
  ```bash
  gh pr merge --auto --squash
  ```
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
- `Require branches to be up to date` 开启后，master 有新合入时 PR 会变 stale，需要 `gh pr update-branch` 或点 Update branch，然后 checks 重跑。
- 红线扫描 R11 是 **error 级**：UI commit 缺 `Design: pass` / `Micro-exempt:` 会直接挂——这是 2026-09-22 拍板的口径，不是误报；被拦时按上表补 trailer 即可（改 commit message 用 `git commit --amend` 或 rebase）。
