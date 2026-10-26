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
    '|[ \t](?:cp|mv|rm|install)[ \t]'
    '|git[ \t]+apply'
    '|git[ \t]+checkout[ \t]+--'
    '|patch[ \t]'
    '|python[0-9.]*[ \t]+-c'
    '|node[ \t]+-e'
    '|writeFile(Sync)?[(]'
    '|open[(][^)]*[\'"][wa]'
    # ⚠️ 不要把 `<<` 收进写算子：`python3 - <<'PYEOF'` 只是把脚本喂给 stdin，不落盘；
    # 真正的 heredoc 落盘（`cat <<EOF > a.wxss`）由 redirect_targets 判目标，比这里准。
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


def strip_quoted(cmd):
    """去掉单/双引号包裹的段落，只留「裸命令」文本。

    必要性（2026-10-10 实测踩坑）：一条纯 `git commit -m "..."` 也可能被判成写 UI——
    ① commit message 里写了组件文件名（`.../UserSelect.vue`）→ 命中 UI_PATH_PAT；
    ② message 里的 ASCII 箭头 `->` 被 `>>?` 当成 shell 重定向 → 命中写语义。
    于是「双命中」deny，且文案指向动作门，看起来像门禁策略问题，实为**命令文本误判**。

    引号内一律是字面量（commit message / 脚本参数），不可能是真重定向或真写操作，
    故写算子与重定向判定只在去引号文本上跑；UI 路径判定仍用原文，保持保守。
    """
    return re.sub(r'"[^"]*"|\'[^\']*\'', ' ', cmd)


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


def redirect_targets(cmd):
    """引号感知地解析重定向目标 token（只取目标本身，不扫尾巴）。

    必要性（2026-10-26 实测踩坑）：旧实现扫 `>` 后 160 字符找 UI 路径——
    ① `grep ... 2>/dev/null` 的 `2>/dev/null` 被当文件重定向，尾巴里恰好有后续
       只读命令（`wc -l ...vue`）→ 误判「重定向写 UI」，纯只读命令被 deny；
    ② 复合命令（`;` 连接）后半段只是读 UI 文件，也被卷进「重定向目标」；
    ③ `strip_quoted` 会把带引号的目标整个吃掉（`cat > "a.vue"` → 目标丢失，漏判）。
    改为解析**真正的重定向目标 token**：引号外的 `>` / `>>`，跳过 fd 复制/关闭
    （`>&2` `2>&1` `>&-`），目标 token 可带引号；只对该 token 做 UI 判定。
    """
    targets = []
    i = 0
    n = len(cmd)
    while i < n:
        ch = cmd[i]
        if ch in ('"', "'"):
            q = ch
            i += 1
            while i < n and cmd[i] != q:
                if cmd[i] == '\\' and i + 1 < n:
                    i += 1
                i += 1
            i += 1  # 吃掉收尾引号
            continue
        if ch == '>':
            i += 2 if i + 1 < n and cmd[i + 1] == '>' else 1
            while i < n and cmd[i] in ' \t':
                i += 1
            if i < n and cmd[i] == '&':
                # `>&2` / `2>&1` / `>&-` 是 fd 复制或关闭，不是文件写；
                # bash 的 `>&file` 等价 `>file 2>&1`，是文件写，跳过 `&` 继续取目标。
                if i + 1 < n and (cmd[i + 1].isdigit() or cmd[i + 1] == '-'):
                    continue
                i += 1
            start = i
            if i < n and cmd[i] in ('"', "'"):
                q = cmd[i]
                i += 1
                while i < n and cmd[i] != q:
                    if cmd[i] == '\\' and i + 1 < n:
                        i += 1
                    i += 1
                i += 1  # 吃掉收尾引号
            else:
                while i < n and cmd[i] not in ' \t;|&<>':
                    i += 1
            token = cmd[start:i]
            if len(token) >= 2 and token[0] == token[-1] and token[0] in ('"', "'"):
                token = token[1:-1]
            if token and token != '/dev/null':
                targets.append(token)
            continue
        i += 1
    return targets


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
    #    写算子只在「去引号」文本上判定（commit message 等字面量不算写操作）；
    #    重定向判定用**原文**做引号感知解析（只取重定向目标 token，不扫尾巴）——
    #    2>/dev/null、复合命令里的只读 .vue 引用、引号包裹的目标，均按真实目标判。
    plain = strip_quoted(cmd)
    redirected = any(
        any(within_repo(root, cwd, p) for p in ui_targets(t))
        for t in redirect_targets(cmd)
    )

    if WRITE_OP_PAT.search(plain) or redirected:
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
