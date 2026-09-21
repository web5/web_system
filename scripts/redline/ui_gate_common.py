#!/usr/bin/env python3
# ============================================================
# ui_gate_common.py — UI 门禁 hook 共用工具（v1.1）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4.1
# 职责：给 hook-ui-prototype-gate / hook-mark-proto-touched /
#       hook-shell-ui-gate 提供路径判定、标记读写、审计日志。
# 无第三方依赖。任何异常由调用方按 fail-open 处理（绝不阻断 IDE 会话）。
# ============================================================
import fnmatch
import json
import os
import sys
import time

STATE_REL = '.codebuddy/.state'
LOG_NAME = 'ui-gate.log'
LEGACY_MARKER = 'proto-touched'
MARKER_SUFFIX = '-proto.json'
TTL_HOURS = 4
NL = chr(10)

# §3.1 UI 源码（受门禁约束）
# fnmatch 的 * 跨 / 匹配，故 apps/*/pages/* 覆盖 pages 全部深度。
UI_PATH_GLOBS = [
    'apps/*/pages/*',
    'apps/*/src/*.vue',
    'apps/*/components/*',
    'packages/ui/*',
    'apps/*/app.json',
    'app.json',
]
UI_EXTS = ('.wxml', '.wxss', '.vue')

# §3.1 原型与规格（通行证路径）
PASSPORT_GLOBS = [
    'apps/*/prototype/*',
    'docs/ui/prototypes/*',
    'specs/*/page-spec*.md',
    '*/page-spec*.md',
    'page-spec*.md',
]

WRITE_TOOLS = {'write_to_file', 'replace_in_file', 'Write', 'Edit', 'MultiEdit'}
EXEMPT_KEYWORD = '微调豁免'
EXEMPT_ENV = 'UI_GATE'


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


def is_ui_source(rel):
    rel = rel.replace(os.sep, '/')
    if rel.endswith(UI_EXTS):
        return True
    for pat in UI_PATH_GLOBS:
        if fnmatch.fnmatch(rel, pat):
            return True
    return False


def is_passport(rel):
    rel = rel.replace(os.sep, '/')
    for pat in PASSPORT_GLOBS:
        if fnmatch.fnmatch(rel, pat):
            return True
    return False


def app_of(rel):
    """apps/<app>/... → app 名；非 apps/ 下（如 packages/ui、specs）返回 ''。

    '' 表示无法归属到某个 app —— UI 路径无法归属时调用方按「放行 + 提醒」处理，
    避免误伤 specs / docs 类文件。
    """
    rel = rel.replace(os.sep, '/')
    if rel.startswith('apps/'):
        parts = rel.split('/')
        if len(parts) >= 2:
            return parts[1]
    return ''


def state_dir(root):
    return os.path.join(root, STATE_REL)


def marker_path(root, session_id):
    if session_id:
        safe = ''.join(ch for ch in session_id if ch.isalnum() or ch in '-_')
        if safe:
            return os.path.join(state_dir(root), safe + MARKER_SUFFIX)
    return os.path.join(state_dir(root), LEGACY_MARKER)


def load_marker(root, session_id):
    """取本会话标记；无本会话标记时回退旧全局标记（兼容 v1.0 行为）。"""
    for p in (marker_path(root, session_id), os.path.join(state_dir(root), LEGACY_MARKER)):
        if os.path.isfile(p):
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                continue
    return None


def marker_fresh(data):
    if not data:
        return False
    try:
        ts = float(data.get('ts', 0))
    except Exception:
        return False
    return ts > 0 and (time.time() - ts) <= TTL_HOURS * 3600


def save_marker(root, session_id, info):
    d = state_dir(root)
    try:
        os.makedirs(d, exist_ok=True)
        with open(marker_path(root, session_id), 'w', encoding='utf-8') as f:
            json.dump(info, f, ensure_ascii=False)
        # 兼容通道：session 缺失时旧 gate 仍能读到全局标记
        with open(os.path.join(d, LEGACY_MARKER), 'w', encoding='utf-8') as f:
            json.dump(info, f, ensure_ascii=False)
    except Exception:
        pass


def deny(reason, stop_reason='UI 改动须先过原型'):
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
    """放行，但向模型注入提醒（§3.4.1 ③：约束下一步意图，而非工具调用）。"""
    out = {
        'hookSpecificOutput': {
            'hookEventName': 'PreToolUse',
            'additionalContext': text,
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


def audit(root, decision, tool_name, path, session_id='', extra=None):
    """§3.4.1 ④ 审计：append 决策摘要，>1MB 滚动保留后 500 行。"""
    try:
        d = state_dir(root)
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, LOG_NAME)
        rec = {
            'ts': int(time.time()),
            'session_id': session_id,
            'tool_name': tool_name,
            'path': path,
            'decision': decision,
        }
        if extra:
            rec.update(extra)
        with open(p, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + NL)
        try:
            if os.path.getsize(p) > 1024 * 1024:
                with open(p, 'r', encoding='utf-8') as f:
                    lines = f.readlines()[-500:]
                with open(p, 'w', encoding='utf-8') as f:
                    f.writelines(lines)
        except Exception:
            pass
    except Exception:
        pass


def extract_path(ti):
    """兼容 IDE(filePath) / CLI(file_path|path) / MultiEdit(edits[]) 三种形态。"""
    if not isinstance(ti, dict):
        return ''
    path = (ti.get('filePath') or ti.get('file_path') or ti.get('path') or '').strip()
    if path:
        return path
    edits = ti.get('edits') or []
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and e.get('file_path'):
                return e['file_path']
    return ''


def extract_text(ti):
    """取写入内容（content / new_string / edits[].new_string），用于「微调豁免」判定。"""
    if not isinstance(ti, dict):
        return ''
    content = ''
    if isinstance(ti.get('content'), str):
        content = ti['content']
    elif isinstance(ti.get('new_string'), str):
        content = ti['new_string']
    edits = ti.get('edits') or []
    if isinstance(edits, list):
        for e in edits:
            if isinstance(e, dict) and isinstance(e.get('new_string'), str):
                content += e['new_string']
    return content


def exempt_by_env():
    return (os.environ.get(EXEMPT_ENV, '') or '').lower() == 'off'
