#!/usr/bin/env python3
# ============================================================
# hook-ui-prototype-gate.py — PreToolUse 硬阻断（L3 · v1.1）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4 / §3.4.1 ②③
# 职责：本地写 UI 源码前，须先动过原型/页面规格（per-session 通行证），
#       且 UI 文件所属 app 必须在通行证记录的 app 集合内（跨端不放行）。
#       放行时输出 additionalContext 提醒（约束下一步意图）。
# 路径判定挂在「改动对象」而非「用户措辞」（§3.1）。
# 无第三方依赖。失败一律 fail-open（exit 0），绝不阻断正常 IDE 会话。
# ============================================================
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

try:
    import ui_gate_common as C
except Exception:
    sys.exit(0)  # fail-open

GATE_MSG = (
    '本次会话尚未修改原型/页面规格。请先改 '
    'apps/<app>/prototype/index.html 或 specs/**/page-spec*.md，'
    '过 ux-review-checklist 并取得用户确认；'
    '纯视觉微调请在原型里记一行「微调豁免」。'
)
CROSS_MSG = (
    '通行证属于 app [{seen}]，本次要改的是 app [{want}] —— 跨端改动不被放行。'
    '请先为该 app 更新其原型/页面规格，或记一行「微调豁免」。'
)


def main():
    payload = C.read_payload()
    tool_name = payload.get('tool_name', '') or ''
    if tool_name not in C.WRITE_TOOLS:
        return 0

    root = C.project_root(payload)
    session_id = payload.get('session_id', '') or ''
    ti = payload.get('tool_input') or {}
    path = C.extract_path(ti)
    if not path:
        return 0

    rel = C.to_rel(path, root)
    if not C.is_ui_source(rel):
        return 0  # 非 UI 文件：零摩擦

    if C.exempt_by_env():
        C.audit(root, 'allow-env-off', tool_name, rel, session_id, {})
        return 0

    data = C.load_marker(root, session_id)
    if not C.marker_fresh(data):
        C.deny(GATE_MSG)
        C.audit(root, 'deny', tool_name, rel, session_id, {'reason': 'no-fresh-marker'})
        return 0

    apps = list(data.get('apps') or [])
    want = C.app_of(rel)
    # apps 为空 = 通行证来自 docs/ui/prototypes 或 specs/**（全局），不限端
    if apps and want and want not in apps:
        C.deny(CROSS_MSG.format(seen=','.join(apps), want=want),
               stop_reason='跨端改动不被放行')
        C.audit(root, 'deny', tool_name, rel, session_id, {'reason': 'cross-app', 'apps': apps})
        return 0

    proto_hint = (data.get('proto_files') or ['apps/<app>/prototype/index.html'])[0]
    text = (
        '你正在改 UI 源码 ' + rel + '，本会话通行证来自 ' + proto_hint + '。'
        '若本次改动的形态未在原型中体现，请先更新原型并再取用户确认；'
        '纯视觉微调请在原型或 page-spec 里记一行「微调豁免」。'
        '提交时：UI commit 的 message 须带 Proto: <原型 commit sha>（§3.8 方案 B）。'
    )
    C.allow_with_context(text)
    C.audit(root, 'allow', tool_name, rel, session_id, {'apps': apps})
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('hook-ui-prototype-gate error (fail-open): %s%s' % (e, chr(10)))
        sys.exit(0)
