#!/usr/bin/env python3
# ============================================================
# hook-process-gate.py — PreToolUse 硬阻断：需求实现流程门（赛道一 · 非 UI 部分）
#
# 背景：现有 hook-ui-prototype-gate 只管 UI（原型先行）。
#       业务逻辑 / 接口 / 契约三类改动此前无 L1 约束，只能等 commit 被 L2 拦。
# 本门：写 *.service.ts / *.controller.ts / packages/types/* / migrations/*.sql 前，
#       须先动过「流程凭证」（方案 / 设计 / 契约文档），否则 deny。
#
# 凭证（session 内任一路径被写过即算）：
#   docs/development/** · specs/** · docs/api/** · docs/architecture/**
#   含「微调豁免」/「Micro-exempt」/「机械重构」字样也算
#
# 协议：stdin JSON → stdout JSON（与 CodeBuddy / Claude Code PreToolUse 同构）。
#       无第三方依赖。失败一律 fail-open（exit 0），绝不阻断正常会话。
# 开关：PROCESS_GATE=off 可全局关闭。
# ============================================================
import fnmatch
import json
import os
import re
import sys
import time

NL = chr(10)
STATE_REL = '.codebuddy/.state'
LOG_NAME = 'process-gate.log'
MARKER_SUFFIX = '-process.json'
TTL_HOURS = 8

# —— 受门禁约束的路径（需求实现流程触发面）——
# 取自 scan-rules.sh R18 触发面，L1 用同口径。
TARGET_GLOBS = [
    'servers/*/src/**/*.controller.ts',
    'servers/*/src/**/*.controller.js',
    'servers/*/src/**/*.service.ts',
    'servers/*/src/**/*.service.js',
    'packages/types/*',
    'migrations/*.sql',
    'apps/*/src/views/*',
]
TARGET_EXTS = ('.controller.ts', '.controller.js', '.service.ts', '.service.js', '.sql')

# —— 流程凭证路径（写过任一 = 流程已走）——
PASSPORT_GLOBS = [
    'docs/development/*',
    'docs/api/*',
    'docs/architecture/*',
    'specs/*',
    '*/page-spec*.md',
    'page-spec*.md',
    'docs/development/reports/*',
]

WRITE_TOOLS = {'write_to_file', 'replace_in_file', 'Write', 'Edit', 'MultiEdit'}
EXEMPT_RE = re.compile(r'微调豁免|Micro-exempt|机械重构|零视觉变化')
EXEMPT_ENV = 'PROCESS_GATE'


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


def to_rel(path, root):
    try:
        path = os.path.realpath(path)
    except Exception:
        pass
    if path.startswith(root + os.sep):
        return path[len(root) + 1:]
    return path


def matches_any(rel, globs, exts=()):
    rel = rel.replace(os.sep, '/')
    if exts and any(rel.endswith(e) for e in exts):
        return True
    for pat in globs:
        if fnmatch.fnmatch(rel, pat):
            return True
    return False


def is_target(rel):
    return matches_any(rel, TARGET_GLOBS, TARGET_EXTS)


def is_passport(rel):
    return matches_any(rel, PASSPORT_GLOBS)


def state_dir(root):
    return os.path.join(root, STATE_REL)


def marker_path(root, session_id):
    """凭证只按 session 落盘，没有 session_id 就不发通行证。

    🔴 2026-10-26 修：原先 session_id 为空时落到全局 `process-touched`，且 save/load
    双写双读 —— 一个会话写过方案，全机器（含别的 agent）8 小时内全部免检。
    凭证必须是「一次会话 × 一次改造」，不存在全局通行证。
    """
    safe = ''.join(ch for ch in (session_id or '') if ch.isalnum() or ch in '-_')
    if not safe:
        return None
    return os.path.join(state_dir(root), safe + MARKER_SUFFIX)


def load_marker(root, session_id):
    p = marker_path(root, session_id)
    if not p or not os.path.isfile(p):
        return None
    try:
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def save_marker(root, session_id, info):
    p = marker_path(root, session_id)
    if not p:
        return  # 无 session_id：不发通行证，也就不落盘
    d = state_dir(root)
    try:
        os.makedirs(d, exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(info, f, ensure_ascii=False)
    except Exception:
        pass


def marker_fresh(data):
    if not data:
        return False
    try:
        ts = float(data.get('ts', 0))
    except Exception:
        return False
    return ts > 0 and (time.time() - ts) <= TTL_HOURS * 3600


def deny(reason, stop_reason='需求实现改动须先过流程凭证'):
    out = {
        'continue': False,
        'stopReason': stop_reason,
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'permissionDecision': 'deny',
            'permissionDecisionReason': reason,
        },
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


def allow_with_context(text):
    out = {
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'additionalContext': text,
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


def audit(root, decision, tool_name, path, session_id='', extra=None):
    try:
        d = state_dir(root)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, LOG_NAME)
        rec = {'ts': int(time.time()), 'session_id': session_id,
               'tool_name': tool_name, 'path': path, 'decision': decision}
        if extra:
            rec.update(extra)
        with open(p, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + NL)
        if os.path.getsize(p) > 1024 * 1024:
            with open(p, 'r', encoding='utf-8') as f:
                lines = f.readlines()[-500:]
            with open(p, 'w', encoding='utf-8') as f:
                f.writelines(lines)
    except Exception:
        pass


def extract_path(ti):
    if not isinstance(ti, dict):
        return ''
    path = (ti.get('filePath') or ti.get('file_path') or ti.get('path') or '').strip()
    if path:
        return path
    for e in (ti.get('edits') or []):
        if isinstance(e, dict) and e.get('file_path'):
            return e['file_path']
    return ''


def extract_text(ti):
    if not isinstance(ti, dict):
        return ''
    parts = []
    for k in ('content', 'new_string'):
        if isinstance(ti.get(k), str):
            parts.append(ti[k])
    for e in (ti.get('edits') or []):
        if isinstance(e, dict) and isinstance(e.get('new_string'), str):
            parts.append(e['new_string'])
    return ''.join(parts)


def exempt_by_env():
    return (os.environ.get(EXEMPT_ENV, '') or '').lower() in ('off', '0', 'false')


DENY_MSG = (
    '本次会话尚未修改流程凭证。写 service / controller / types / migrations 前，'
    '请先产出并写入其一：'
    '① 方案文档 docs/development/reports/*.md（九子项，走《研发方案与发布规范》）；'
    '② 设计说明 docs/development/** 或 docs/architecture/**；'
    '③ 契约草案 docs/api/** 或 specs/**；'
    '然后取得用户确认。'
    '确属机械改动（重构/类型收敛/零行为变化）请在改动说明或文档中记一行「微调豁免」。'
)


def main():
    try:
        payload = read_payload()
    except Exception:
        return 0

    tool_name = payload.get('tool_name', '') or ''
    if tool_name not in WRITE_TOOLS:
        return 0

    root = project_root(payload)
    session_id = payload.get('session_id', '') or ''
    ti = payload.get('tool_input') or {}
    path = extract_path(ti)
    if not path:
        return 0

    rel = to_rel(path, root)

    # 凭证路径被写 → 记通行证
    if is_passport(rel):
        info = {'ts': time.time(), 'session_id': session_id,
                'files': [rel], 'kind': 'passport'}
        old = load_marker(root, session_id)
        if old and marker_fresh(old):
            info['files'] = list(set((old.get('files') or []) + [rel]))
        save_marker(root, session_id, info)
        audit(root, 'passport', tool_name, rel, session_id)
        return 0

    # 非目标路径：零摩擦
    if not is_target(rel):
        return 0

    # 开关
    if exempt_by_env():
        audit(root, 'allow-env-off', tool_name, rel, session_id)
        return 0

    # 豁免字样
    text = extract_text(ti)
    if EXEMPT_RE.search(text or ''):
        audit(root, 'allow-exempt-keyword', tool_name, rel, session_id)
        return 0

    # 通行证检查
    data = load_marker(root, session_id)
    if marker_fresh(data):
        audit(root, 'allow-passport', tool_name, rel, session_id,
              {'passport_files': (data or {}).get('files', [])})
        allow_with_context(
            '已过流程凭证（写过 {}）。本次改动请在 commit message 带对应 trailer：'
            'Plan: pass / Design: pass / Contract: pass。'.format(
                ', '.join((data or {}).get('files', [])[:3]) or '文档')
        )
        return 0

    # 无凭证 → deny
    audit(root, 'deny', tool_name, rel, session_id)
    deny(DENY_MSG)
    return 0


if __name__ == '__main__':
    try:
        main()
    except Exception:
        pass  # fail-open
    sys.exit(0)
