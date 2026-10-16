#!/usr/bin/env python3
# ============================================================
# hook-worktree-gate.py — PreToolUse：源码改动必须在 worktree 内（v1.0）
#
# 要解决的问题：
#   WorkBuddy 5.8.2 有完整的 worktree 功能，但三道锁都要求「人主动」：
#     ① UI 默认「不使用 Worktree」
#     ② settings.json: using-git-worktrees = user-invocable-only（模型不得自动调）
#     ③ commands/using-git-worktrees.md: disable-model-invocation: true
#   结果：不手动勾框 → 所有会话落在同一工作树、同一分支 → 分支被反复 checkout/commit。
#
# 本 hook 把「是否隔离」从人的选择，变成代码强制：
#   写源码时若目标不在 worktree 内 → deny，并给出可执行的创建命令。
#
# 设计原则（承接既有 redline hook 的教训）：
#   1. fail-open —— 任何异常 exit 0，绝不阻断正常会话
#   2. deny 必须带自救通路 —— 只拒绝不给路 = 逼用户关掉门禁（U3 教训：误拦催生绕过）
#   3. 放行 git worktree 管理命令 —— 否则死锁
#   4. 显式豁免开关 WORKTREE_GATE=off —— 与 UI_GATE=off 同一模式
#
# 档位（环境变量 WORKTREE_GATE）：
#   hard   主工作树写任何非元数据文件 → deny
#   hybrid 只拦源码（源码目录 or 源码扩展名），文档/配置/脚本放行 ← 推荐
#   soft   主工作树写源码 → 放行 + 注入提醒，不阻断
#   off    全放行
# ============================================================
import json
import os
import subprocess
import sys

NL = chr(10)
WRITE_TOOLS = {'write_to_file', 'replace_in_file', 'Write', 'Edit', 'MultiEdit',
               'NotebookEdit'}

# 这些路径即使在主工作树也放行（元数据 / 依赖 / VCS 内部 / 门禁自身）
# ⚠️ scripts/redline/ 必须放行：否则改门禁脚本自己也要先建 worktree —— 门禁不能拦自己
ALWAYS_ALLOW_PREFIXES = ('.git/', 'node_modules/', '.codebuddy/.state/', '.worktrees/',
                         'scripts/redline/')
ENV_KEY = 'WORKTREE_GATE'
DEFAULT_MODE = 'hybrid'

# hybrid 档：命中即视为「源码」，须在 worktree 内改
SRC_DIR_PREFIXES = ('servers/', 'packages/', 'apps/', 'src/', 'libs/', 'scripts/',
                    'internal/', 'cmd/', 'api/', 'web/')
SRC_EXTS = ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.py', '.go',
            '.java', '.kt', '.rs', '.rb', '.php', '.c', '.cc', '.cpp', '.h',
            '.sql', '.wxml', '.wxss', '.scss', '.less')

# hybrid 档额外放行：仓库级配置与文档（改这些不需要隔离）
REPO_LEVEL_ALLOW = ('.gitignore', '.gitattributes', '.editorconfig', '.env.example',
                    '.github/', '.gitlab-ci.yml', '.codebuddy/', 'docs/', 'README',
                    'CHANGELOG', 'LICENSE', 'Makefile', 'docker-compose')


def is_source(rel):
    """hybrid 档判据：是否属于需要在 worktree 内改动的源码。"""
    for p in SRC_DIR_PREFIXES:
        if rel.startswith(p) or ('/' + p) in rel:
            return True
    return rel.lower().endswith(SRC_EXTS)


def is_repo_level(rel):
    for p in REPO_LEVEL_ALLOW:
        if rel.startswith(p) or ('/' + p) in rel:
            return True
    return False


def read_payload():
    raw = sys.stdin.read()
    try:
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def project_root(payload=None):
    v = os.environ.get('CODEBUDDY_PROJECT_DIR')
    if v and os.path.isdir(v):
        return os.path.realpath(v)
    cwd = (payload or {}).get('cwd')
    if cwd and os.path.isdir(cwd):
        return os.path.realpath(cwd)
    return os.path.realpath(os.getcwd())


def extract_path(ti):
    """兼容 IDE(filePath) / CLI(file_path|path) / MultiEdit(edits[])。"""
    if not isinstance(ti, dict):
        return ''
    p = (ti.get('filePath') or ti.get('file_path') or ti.get('path') or '').strip()
    if p:
        return p
    edits = ti.get('edits') or []
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and e.get('file_path'):
                return e['file_path']
    return ''


def git(repo_dir, *args):
    """在 repo_dir 下跑 git；失败返回 None（绝不抛）。"""
    try:
        r = subprocess.run(['git', '-C', repo_dir] + list(args),
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           timeout=5)
        if r.returncode != 0:
            return None
        return r.stdout.decode('utf-8', 'replace').strip()
    except Exception:
        return None


def locate_repo(path):
    """找到 path 所在的 git 工作树根。非 git 返回 None。

    ⚠️ 必须向上回溯到「存在的」祖先目录：新建文件时父目录尚不存在，
       直接 dirname 会拿到不存在的路径 → git 失败 → 误判为非 git 仓库 → 放行。
       新建文件恰恰是最需要隔离的场景之一，这个洞必须堵。
    """
    d = os.path.dirname(os.path.abspath(path))
    while d and not os.path.isdir(d):
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    if not os.path.isdir(d):
        return None
    top = git(d, 'rev-parse', '--show-toplevel')
    return os.path.realpath(top) if top else None


def in_worktree(repo):
    """判据：--absolute-git-dir 位于 <main>/.git/worktrees/<name>。

    主工作树: /main/.git
    worktree : /main/.git/worktrees/<name>
    """
    gd = git(repo, 'rev-parse', '--absolute-git-dir')
    if not gd:
        return False
    gd = os.path.realpath(gd)
    return os.path.basename(os.path.dirname(gd)) == 'worktrees'


def wt_dir(repo):
    """返回主仓库下已存在的 worktree 目录偏好（.worktrees > worktrees）。"""
    common = git(repo, 'rev-parse', '--git-common-dir')
    if not common:
        return None, None
    main = os.path.realpath(os.path.dirname(common)) if common != '.git' else repo
    a = os.path.join(main, '.worktrees')
    b = os.path.join(main, 'worktrees')
    if os.path.isdir(a):
        return main, '.worktrees'
    if os.path.isdir(b):
        return main, 'worktrees'
    return main, '.worktrees'


def deny(reason, stop_reason='源码改动须在 worktree 内进行'):
    sys.stdout.write(json.dumps({
        'continue': False,
        'stopReason': stop_reason,
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'deny',
            'permissionDecisionReason': reason,
        },
    }, ensure_ascii=False))


def allow_with_context(text):
    sys.stdout.write(json.dumps({
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'additionalContext': text,
        }
    }, ensure_ascii=False))


def audit(root, decision, tool_name, path, session_id='', extra=None):
    try:
        d = os.path.join(root, '.codebuddy/.state')
        os.makedirs(d, exist_ok=True)
        rec = {'ts': int(__import__('time').time()), 'session_id': session_id,
               'tool_name': tool_name, 'path': path, 'decision': decision}
        if extra:
            rec.update(extra)
        with open(os.path.join(d, 'worktree-gate.log'), 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + NL)
    except Exception:
        pass


def main():
    payload = read_payload()
    tool_name = payload.get('tool_name', '') or ''
    if tool_name not in WRITE_TOOLS:
        return 0

    mode = (os.environ.get(ENV_KEY, '') or '').strip().lower() or DEFAULT_MODE
    if mode == 'off':
        return 0

    ti = payload.get('tool_input') or {}
    path = extract_path(ti)
    if not path:
        return 0

    root = project_root(payload)
    session_id = payload.get('session_id', '') or ''

    try:
        rel = os.path.relpath(os.path.abspath(path), root)
    except Exception:
        rel = path
    rel = rel.replace(os.sep, '/')

    # 元数据 / 依赖 / VCS 内部：永远放行
    if rel == '.' or rel.startswith('..'):
        pass  # 落在项目外，交给下面的 repo 判定
    for pre in ALWAYS_ALLOW_PREFIXES:
        if rel.startswith(pre) or ('/' + pre) in rel:
            return 0

    repo = locate_repo(path)
    if not repo:
        return 0  # 非 git 项目：零摩擦

    if in_worktree(repo):
        return 0  # ✅ 已在 worktree：放行

    # ---- 主工作树：按档位处理 ----
    # hybrid/soft 只对「源码」生效：仓库级配置与文档不要求隔离
    # （否则改个 .gitignore 都要建 worktree，门禁三天内必被关掉 —— U3 教训）
    if mode != 'hard':
        if is_repo_level(rel):
            return 0
        if not is_source(rel):
            return 0

    main, pref = wt_dir(repo)
    branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD') or 'main'

    if mode == 'soft':
        allow_with_context(
            '你正在主工作树 ' + repo + '（分支 ' + branch + '）上改 ' + rel + '。'
            '当前不在 worktree 内，多个会话会互相覆盖。'
            '建议先建 worktree：git -C ' + repo + ' worktree add ' + pref +
            '/<name> -b feat/<name>，然后在那个目录下改动。'
        )
        audit(root, 'warn-soft', tool_name, rel, session_id, {'branch': branch})
        return 0

    # hard / hybrid：deny + 自救通路
    deny(
        '目标 ' + rel + ' 位于主工作树（' + repo + '，分支 ' + branch + '），不在 worktree 内。'
        + NL + '原因：多会话共享同一工作树会静默互相覆盖，且切分支时会被反复 commit。'
        + NL + '自救（三步，完成后重试本次写入）：'
        + NL + '1) git -C ' + repo + ' worktree add ' + pref + '/<name> -b feat/<name>'
        + NL + '2) 确认 ' + pref + '/ 已在 .gitignore（否则 git check-ignore 检查并补上）'
        + NL + '3) 把写入目标改为 ' + pref + '/<name>/' + rel
        + NL + '不受此限：docs/、.gitignore、.codebuddy/ 等仓库级文件与项目外路径。'
        + NL + '若确需在主工作树改源码，设环境变量 WORKTREE_GATE=off 或 soft。',
        stop_reason='源码改动须在 worktree 内进行'
    )
    audit(root, 'deny', tool_name, rel, session_id, {'branch': branch, 'repo': repo})
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('hook-worktree-gate error (fail-open): %s%s' % (e, NL))
        sys.exit(0)
