#!/usr/bin/env bash
# ============================================================
# check-commit.sh — L0 本地 pre-commit 红线检查
#
# 由 .githooks/pre-commit 调用；也可手动执行：
#   bash scripts/redline/check-commit.sh
#
# 只检查 git staged 变更（R1~R4 error 级），秒级返回。
# R5/R8 误报率高，本地不拦（--strict 由 CI 侧 scan-rules 决定）。
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$TOP"

exec bash "$SCRIPT_DIR/scan-rules.sh" cached --no-color
