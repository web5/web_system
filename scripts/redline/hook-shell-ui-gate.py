#!/usr/bin/env python3
# ============================================================
# hook-shell-ui-gate.py — PreToolUse 硬阻断：shell 通道写 UI 源码（v1.1）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4.1 ①
# 漏洞：v1.0 matcher 只覆盖 write_to_file/replace_in_file/Write/Edit/MultiEdit，
#       execute_command / Bash 绕行 —— sed -i / cat > / git apply / cp 可直改 UI 源码。
# 判据：命令文本「UI 路径特征」∩「写操作符特征」双命中 → deny。
# 已拍板（2026-09-21）：直接 deny，不设 warning 观察期；误报只能靠白名单兜。
# 无第三方依赖。失败一律 fail-open（exit 0），绝不阻断正常 IDE 会话。
# ============================================================
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

try:
    import ui_gate_common as C
except Exception:
    sys.exit(0)  # fail-open：common 缺失不阻断

# —— UI 路径特征（命令文本级，非结构化路径）——
UI_PATH_PAT = re.compile(
    '('
    '[A-Za-z0-9_./-]+[.](?:wxss|wxml|vue)(?![A-Za-z0-9_])'   # 文件名优先（审计留痕更准）
    '|apps/[^/ \t"\'<>|&;]*/(' + 'pages|components' + ')/'
    '|packages/ui/'
    '|(?:apps/[A-Za-z0-9_-]+/)?app[.]json'
    ')'
)

# —— 写操作符特征（强写语义；纯只读命令如 cat/grep/ls 不命中）——
WRITE_OP_PAT = re.compile(
    '('
    'sed[ \t]+-[A-Za-z\'\"]*i'          # sed -i / sed -i''
    '|perl[ \t]+-i'
    '|tee[ \t]'
    '|cp[ \t]|mv[ \t]|rm[ \t]|install[ \t]'
    '|git[ \t]+apply'
    '|git[ \t]+checkout[ \t]+--'
    '|patch[ \t]'
    '|python[0-9.]*[ \t]+-c'
    '|node[ \t]+-e'
    '|writeFile(Sync)?[(]'
    '|open[(][^)]*[\'"][wa]'
    '|<<[A-Za-z\'"]'
    ')'
)

# —— 白名单（命中即放行，防误伤构建/发布/发布脚本）——
# 约定：白名单任何扩充，必须同步补 V11 用例（design.md §4 实现约束）。
WHITELIST_PREFIX = (
    'bash scripts/', 'sh scripts/', './scripts/', 'node scripts/', 'python3 scripts/',
    'pnpm ', 'npm ', 'npx ', 'yarn ', 'vite', 'nest build', 'pm2 ', 'make ',
    'git status', 'git diff', 'git log', 'git rev-parse', 'git show', 'git --version',
    'curl ', 'wget ', 'ls ', 'cd ', 'echo ', 'pwd', 'which ', 'docker ',
)

DENY_MSG = (
    'shell 不允许直接写 UI 源码（UI 改动须先过原型）。'
    '请改用 write_to_file/replace_in_file 走 §2.5 动作门，'
    '或先改原型/页面规格（apps/*/prototype/**、specs/**/page-spec*.md）取得通行证；'
    '批量机械改动/紧急修复可用 UI_GATE=off 豁免。'
    '构建/发布类命令若被误拦，请补白名单并同步补 V11 用例。'
)


def ui_targets(cmd):
    return [m.group(0) for m in UI_PATH_PAT.finditer(cmd)]


def within_repo(root, cwd, p):
    """该 UI 路径是否真的落在本仓库内。

    必要性：临时目录/示例仓库里的脚手架命令（如 init 一个 demo repo）会误触发双命中，
    摩擦最终会导致 hook 被关掉。判定不了的按保守处理（视为仓库内，仍然拦截）。
    """
    try:
        ap = p if os.path.isabs(p) else os.path.join(cwd, p)
        ap = os.path.realpath(os.path.normpath(ap))
    except Exception:
        return True
    return ap.startswith(root + os.sep) or ap == root


def command_of(payload):
    if payload.get('tool_name') == 'read_file':
        return ''
    ti = payload.get('tool_input') or {}
    if isinstance(ti, dict):
        for k in ('command', 'cmd', 'command_line'):
            v = ti.get(k)
            if isinstance(v, str) and v.strip():
                return v
    for k in ('command', 'cmd'):
        v = payload.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ''


def main():
    payload = C.read_payload()
    cmd = command_of(payload)
    if not cmd:
        return 0

    root = C.project_root(payload)
    session_id = payload.get('session_id', '') or ''
    tool_name = payload.get('tool_name', '') or ''
    cmd_s = cmd.strip()

    # 1) 落在本仓库内的 UI 路径才算数（零摩擦放行临时目录/示例仓库的脚手架命令）
    cwd = payload.get('cwd') or root
    hits = [h for h in ui_targets(cmd) if within_repo(root, cwd, h)]
    if not hits:
        return 0
    hit = hits[0]

    # 2) 双命中判定（判定优先于白名单）
    #    白名单不赦免写语义 —— 否则 `echo x > a.wxss` 会因 `echo ` 在白名单里被放过。
    redirected = False
    for mm in re.finditer('>>?', cmd):
        tail = cmd[mm.end():mm.end() + 160]
        if any(within_repo(root, cwd, p) for p in ui_targets(tail)):
            redirected = True
            break

    if WRITE_OP_PAT.search(cmd) or redirected:
        C.deny(DENY_MSG, stop_reason='UI 源码须经原型改动通道')
        C.audit(root, 'deny', tool_name, hit, session_id, {'via': 'shell'})
        return 0

    # 3) 只读命令（cat / grep / head 等）放行，留痕便于度量摩擦
    decision = 'allow-read'
    if any(cmd_s.startswith(p) or cmd_s.startswith(p.strip()) for p in WHITELIST_PREFIX):
        decision = 'allow-whitelist'
    C.audit(root, decision, tool_name, hit, session_id, {'via': 'shell'})
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('hook-shell-ui-gate error (fail-open): %s%s' % (e, chr(10)))
        sys.exit(0)
