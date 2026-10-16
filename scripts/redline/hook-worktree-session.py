#!/usr/bin/env python3
# ============================================================
# hook-worktree-session.py — SessionStart：注入 worktree 纪律 + 当前状态（v1.0）
#
# 职责：在会话一开始就告诉模型「你现在在哪、该在哪」，
#       避免它先写一次被 PreToolUse 拦下才明白规则（那次写入已浪费一轮）。
#
# 注入内容：
#   ① 当前工作树位置 + 是否已在 worktree
#   ② 若不在：给出本次会话应执行的建树命令（带具体分支建议）
#   ③ 逃生开关 WORKTREE_GATE=off 的适用口径
#
# fail-open：任何异常 exit 0。
# ============================================================
import json
import os
import subprocess
import sys

NL = chr(10)
ENV_KEY = 'WORKTREE_GATE'


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


def git(repo_dir, *args):
    try:
        r = subprocess.run(['git', '-C', repo_dir] + list(args),
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           timeout=5)
        if r.returncode != 0:
            return None
        return r.stdout.decode('utf-8', 'replace').strip()
    except Exception:
        return None


def in_worktree(repo):
    gd = git(repo, 'rev-parse', '--absolute-git-dir')
    if not gd:
        return False
    return os.path.basename(os.path.dirname(os.path.realpath(gd))) == 'worktrees'


def wt_dir(repo):
    common = git(repo, 'rev-parse', '--git-common-dir')
    main = os.path.realpath(os.path.dirname(common)) if (common and common != '.git') else repo
    for cand in ('.worktrees', 'worktrees'):
        if os.path.isdir(os.path.join(main, cand)):
            return main, cand
    return main, '.worktrees'


def main():
    payload = read_payload()
    root = project_root(payload)
    mode = (os.environ.get(ENV_KEY, '') or '').strip().lower() or 'hybrid'

    if not os.path.isdir(os.path.join(root, '.git')):
        return 0  # 非 git 项目：不注入，避免噪声

    if mode == 'off':
        text = ('[worktree 门禁] 已通过 WORKTREE_GATE=off 关闭。'
                '本次会话可直接改主工作树。'
                '注意：若同时开了其他会话，改动可能互相覆盖。')
    elif in_worktree(root):
        text = ('[worktree 门禁] ✅ 当前已在 worktree 内：' + root + NL
                + '可直接改动，写入不会被拦。'
                '结束后记得：改动要么 commit 到本分支，要么明确告知用户分支名，不要留在游离状态。')
    else:
        main, pref = wt_dir(root)
        branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD') or 'main'
        ignored = subprocess.run(
            ['git', '-C', main, 'check-ignore', '-q', pref],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        gi_hint = ('（' + pref + '/ 已在 .gitignore）'
                   if ignored else
                   '⚠️ ' + pref + '/ 尚未被 gitignore —— 先加进 .gitignore 再建树，否则会把 worktree 内容提交进仓库')

        text = (
            '[worktree 门禁 · 硬约束]' + NL
            + '当前在主工作树：' + root + '（分支 ' + branch + '）。' + NL
            + '凡涉及源码改动，必须先建 worktree 并在其中进行 —— 直接改主工作树会被 PreToolUse 拒绝。' + NL
            + '建树命令：' + NL
            + '  git -C ' + main + ' worktree add ' + pref + '/<name> -b feat/<name>' + NL
            + '  ' + gi_hint + NL
            + '然后把写入目标指向 ' + pref + '/<name>/ 下的对应路径。' + NL
            + '不受此限：docs/、.gitignore、.codebuddy/ 等仓库级文件，以及项目外路径。'
            + '确需改主工作树源码时设 WORKTREE_GATE=off。'
        )

    sys.stdout.write(json.dumps({
        'hookSpecificOutput': {
            'hookEventName': 'SessionStart',
            'additionalContext': text,
        }
    }, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('hook-worktree-session error (fail-open): %s%s' % (e, NL))
        sys.exit(0)
