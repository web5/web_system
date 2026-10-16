#!/usr/bin/env python3
# ============================================================
# hook-worktree-shell-gate.py — Bash 通道写主工作树源码的门禁（v1.0）
#
# 补的洞：PreToolUse matcher 按「工具名」匹配 —— 只挂
#   write_to_file|replace_in_file|Write|Edit|MultiEdit
# 的话，Agent 改走 Bash（echo > / cat > / sed -i / tee / python -c / node -e）
# 时文件直接落盘，Write 类工具从未被调用，门禁 hook 根本不会触发。
# 本仓库 UI 门禁踩过同一洞（hook-shell-ui-gate.py 文件头「漏洞 v1.0」），
# 故这里沿用其已验证的「双命中」判据：路径特征 ∩ 写算子特征。
#
# 判据（只在主工作树生效，worktree 内一律放行）：
#   ① 命令文本里出现落在仓库内的源码路径
#   ② 且出现写语义（重定向 / sed -i / cp / mv / tee / python -c / node -e ...）
#   两条同时命中 → 按档位 deny 或提醒
#
# 档位（环境变量 WORKTREE_SHELL_GATE，默认 soft）：
#   soft（默认）：不阻断，注入提醒 —— shell 文本解析天生模糊，
#                误拦会催生绕过（本仓库 abdc9f16 实证），故默认留摩擦最低档
#   hard        ：deny + 自救命令
#   off         ：全放行
#   WORKTREE_GATE=off 时整体关闭本门禁
#
# fail-open：任何异常 exit 0，绝不阻断会话。
# ============================================================
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
NL = chr(10)
ENV_KEY = 'WORKTREE_SHELL_GATE'
DEFAULT_MODE = 'soft'


def _load_sibling(name):
    """加载同目录带连字符的模块（文件名不合法标识符，import 语句用不了）。"""
    p = os.path.join(HERE, name + '.py')
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


try:
    G = _load_sibling('hook-worktree-gate')
except Exception:
    sys.exit(0)  # fail-open：主门禁模块缺失不阻断


# —— 写算子（沿用 UI shell 门禁已验证的清单）——
WRITE_OP_PAT = re.compile(
    '('
    'sed[ \t]+-[A-Za-z\'\"]*i'
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

# —— 重定向：排除 fd 重定向（2> / 2>>）与 &>，只留真的数据重定向 ——
#    2>/dev/null 会把后半条命令拖进判定（本仓库 abdc9f16 实证误拦），故排除。
REDIR_PAT = re.compile(r'(?<![0-9&])>>?[ \t]*([A-Za-z0-9_./$-]+)')

# 看起来像路径的 token
TOKEN_PAT = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_./-]*')


def strip_quoted(cmd):
    """去掉引号段：commit message / -c 脚本体里的字面量不是命令。

    同源坑（2026-10-10 本仓库实测）：`git commit -m "..."` 的 message 里
    写了文件名 + ASCII 箭头 `->`，被当成「路径 + 重定向」双命中误拦。
    """
    return re.sub(r'"[^"]*"|\'[^\']*\'', ' ', cmd)


def to_rel(root, cwd, tok):
    """token → 相对仓库根的路径；不在仓库内返回 None。"""
    try:
        ap = tok if os.path.isabs(tok) else os.path.join(cwd, tok)
        ap = os.path.realpath(os.path.normpath(ap))
    except Exception:
        return None
    if not (ap.startswith(root + os.sep) or ap == root):
        return None
    return os.path.relpath(ap, root).replace(os.sep, '/')


def rel_hit(root, cwd, tok):
    """该 token 是否是「需要在 worktree 内改的源码」。"""
    rel = to_rel(root, cwd, tok)
    if not rel:
        return None
    for p in G.ALWAYS_ALLOW_PREFIXES:
        if rel.startswith(p) or ('/' + p) in rel:
            return None
    if G.is_repo_level(rel):
        return None
    return rel if G.is_source(rel) else None


def command_of(payload):
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
    payload = G.read_payload()
    cmd = command_of(payload)
    if not cmd:
        return 0

    # 全局关闭
    if (os.environ.get(G.ENV_KEY, '') or '').strip().lower() == 'off':
        return 0
    mode = (os.environ.get(ENV_KEY, '') or '').strip().lower() or DEFAULT_MODE
    if mode == 'off':
        return 0

    root = G.project_root(payload)
    if not os.path.isdir(os.path.join(root, '.git')):
        return 0                      # 非 git 项目
    if G.in_worktree(root):
        return 0                      # 已在 worktree 内：随便改

    cwd = payload.get('cwd') or root
    session_id = payload.get('session_id', '') or ''
    tool_name = payload.get('tool_name', '') or ''

    plain = strip_quoted(cmd)

    # ① 重定向目标（强信号：明确写了哪个文件）
    redir_src = [r for r in (rel_hit(root, cwd, m.group(1))
                             for m in REDIR_PAT.finditer(plain)) if r]

    # ② 命令里出现的源码路径
    src_tokens = [r for r in (rel_hit(root, cwd, t)
                              for t in TOKEN_PAT.findall(plain)) if r]

    has_write_op = bool(WRITE_OP_PAT.search(plain)) or bool(redir_src)
    if not has_write_op:
        return 0                      # 纯只读命令
    if not src_tokens:
        return 0                      # 没有源码路径，不命中

    hit = redir_src[0] if redir_src else src_tokens[0]

    if mode == 'hard':
        G.deny(
            'shell 正在写主工作树源码：' + hit + NL
            + '多会话并行时改动会互相覆盖且 Git 事后才可能发现。' + NL
            + '自救：1) git -C ' + root + ' worktree add .worktrees/<name> -b feat/<name>' + NL
            + '     2) 在 .worktrees/<name>/ 下重跑本命令。' + NL
            + '确需在主工作树执行：WORKTREE_SHELL_GATE=soft（只提醒）或 =off。'
        )
        G.audit(root, 'deny-shell', tool_name, hit, session_id, {'via': 'shell'})
        return 0

    # soft：放行但把纪律注入模型上下文
    G.allow_with_context(
        '[worktree 门禁] 你正在用 shell 写主工作树源码（' + hit + '）。'
        '多会话并行会互相覆盖。建议先建 worktree：'
        'git -C ' + root + ' worktree add .worktrees/<name> -b feat/<name>，'
        '然后在其中执行；本次已放行。'
    )
    G.audit(root, 'warn-shell', tool_name, hit, session_id, {'via': 'shell'})
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('hook-worktree-shell-gate error (fail-open): %s%s' % (e, NL))
        sys.exit(0)
