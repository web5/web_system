#!/usr/bin/env python3
# ============================================================
# hook-mark-proto-touched.py — PostToolUse 标记写入（v1.1 · 细粒度通行证）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4.1 ②
# 职责：当本次写操作命中「原型与规格」集合（或内容含「微调豁免」），
#       写 per-session 标记 .codebuddy/.state/<session_id>-proto.json
#       内容 {ts, session_id, apps:[...], proto_files:[...], sha256:{file:hash}}
#       —— 使同会话后续「同 app」的 UI 写被放行，跨 app 仍被 §gate 拦下（V12）。
# 无第三方依赖。失败一律 fail-open（exit 0）。
# ============================================================
import hashlib
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

try:
    import ui_gate_common as C
except Exception:
    sys.exit(0)  # fail-open


def sha256_file(abs_path):
    try:
        with open(abs_path, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()
    except Exception:
        return ''


def main():
    payload = C.read_payload()
    root = C.project_root(payload)
    ti = payload.get('tool_input') or {}
    path = C.extract_path(ti)
    session_id = payload.get('session_id', '') or ''
    tool_name = payload.get('tool_name', '') or ''
    if not path:
        return 0

    try:
        abs_path = os.path.realpath(path)
    except Exception:
        abs_path = path
    rel = C.to_rel(path, root)

    content = C.extract_text(ti)
    by_exempt = C.EXEMPT_KEYWORD in content
    if not C.is_passport(rel) and not by_exempt:
        return 0

    data = C.load_marker(root, session_id) or {}
    apps = list(data.get('apps') or [])
    proto_files = list(data.get('proto_files') or [])
    hashes = dict(data.get('sha256') or {})

    # 具体到 app 的原型（apps/<app>/prototype/**）→ 记 app 边界；
    # docs/ui/prototypes、specs/**/page-spec*.md 为全局通行证（apps 保持为空 = 不限制端）
    app = C.app_of(rel)
    if app and app not in apps:
        apps.append(app)
    if C.is_passport(rel) and rel not in proto_files:
        proto_files.append(rel)
        h = sha256_file(abs_path)
        if h:
            hashes[rel] = h

    info = {
        'ts': time.time(),
        'session_id': session_id,
        'apps': apps,
        'proto_files': proto_files,
        'sha256': hashes,
        'source': 'exempt' if by_exempt else 'prototype',
    }
    C.save_marker(root, session_id, info)
    C.audit(root, 'mark', tool_name, rel, session_id, {'apps': apps, 'source': info['source']})
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('hook-mark-proto-touched error (fail-open): %s%s' % (e, chr(10)))
        sys.exit(0)
