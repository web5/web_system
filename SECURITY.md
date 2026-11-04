# Security Policy

> 🔴 仓库 `web5/web_system` 是 **PUBLIC**。脚本 / 文档 / commit **禁止写入**服务器 IP、用户名、
> 密钥路径、口令、明文 API Key 或内网拓扑。内部凭证统一归档 `~/env_config/`（目录 700 / 文件 600），
> 发布凭据明文唯一在 `~/env_config/web_system/dev.env`，不进 git、不复制到任何新文件。
> 详见 [docs/协作指令速查.md](./docs/协作指令速查.md) §4 与 [docs/INDEX.md](./docs/INDEX.md)。

## Supported Versions

| 分支 | 状态 |
|---|---|
| `master` | ✅ 支持 —— **唯一发布源**，dev / prod 均从 `origin/master` 的 commit 发布 |
| 特性分支 / worktree | ❌ 不单独发布（未合入 master 的分支发不了任何环境） |

## Reporting a Vulnerability

- 请通过**私有渠道**联系维护者（Chase Wen）。**不要**在公开 Issue 里贴复现细节、IP、凭证、内网拓扑或日志片段。
- 报告请附：影响面、复现步骤、是否已实测、建议修复方向；确认后随下一次发布修复。
- 历史泄露排查（只读）：`node scripts/history-secret-scan.mjs`；红线扫描：
  `bash scripts/redline/scan-rules.sh diff <range>`（本地约 11min，须后台跑，优先看 CI 结果）。

> 本文 2026-11-04 由 GitHub 未填写的默认模板补齐（原模板含虚构版本号 5.1.x / 4.0.x）。
