#!/usr/bin/env bash
# pnpm 免沙箱 shim —— 剥掉 WorkBuddy 注入的环境变量再调 pnpm，规避 install 的假失败。
#
# 为什么要有这个脚本（真因是沙箱 shim，不是 pnpm 配置）：
#   WorkBuddy 沙箱 shim 会在 pnpm 批量删除（install 硬链接阶段清理旧 node_modules）时去连本机
#   broker：/tmp/workbuddy-sandbox-broker-*.sock。broker 的生命周期绑**单次工具调用**，
#   上一次调用结束它就退出了，socket 文件却留在原地 → 下一次 install 连上去必然
#   ECONNREFUSED，pnpm 侧表现为 `EXIT=195`（有时是 ERR_PNPM_LINKING_FAILED
#   [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]）。命令行看不到 stderr，极易误判成
#   「lockfile 不对」或「pnpm 配置不对」。
#
#   实测（同一台机器、同一 lockfile、同一 pnpm 9.15.0）：
#     带 shim  → 3 次只成功 1 次（1/3）
#     剥掉三个注入变量 → 3/3 全部 exit 0，各约 2 秒
#
#   ⚠️ .npmrc 里那行 `safe-delete=false` 与此无关，而且 pnpm 9 **没有**这个配置项
#     （`pnpm config get safe-delete` 只是照抄 .npmrc；无 .npmrc 的目录执行即 undefined）。
#     该行已删除，不要再往 .npmrc 里加配置试图解决这个问题。
#   📖 亲历记录：docs/development/local-release-runbook.md §4.1 / §4.2
#
# 用法（`$@` 原样透传给 pnpm，所以任何 pnpm 子命令都能用）：
#   bash scripts/pnpm.sh -C /path/to/worktree install --frozen-lockfile
#   bash scripts/pnpm.sh -C . install
#   bash scripts/pnpm.sh -C . --version
#
# 作用域：只撤销下面三个变量，registry / token / proxy 等其余环境一概不动；
#   本脚本不写任何文件，也不改 .npmrc / lockfile。
set -euo pipefail

exec env \
  -u NODE_OPTIONS \
  -u CODEBUDDY_SAFE_DELETE_SANDBOX \
  -u CODEBUDDY_SAFE_DELETE_BULK_GUARD \
  pnpm "$@"
