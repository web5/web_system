#!/usr/bin/env python3
# ============================================================
# hook-session-start.py — SessionStart 注入 + 过期标记清理（v1.1）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4.1 ②③
# 职责：① 清理过期通行证标记（TTL 4h），防止跨会话误放行；
#       ② 把 §2.5 动作门摘要与 §3.8 方案 B 两条铁律注入会话上下文 ——
#          治「换了个会话就忘了」这类漂移（命名空间在意图层，不在工具层）。
# 无第三方依赖。失败一律 fail-open（exit 0）。
# ============================================================
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

GATE_TEXT = (
    '[UI 动作门 · 不可跳]' + chr(10)
    + '凡改动 apps/*/pages/**、apps/*/components/**、packages/ui/**、app.json '
    + '或任何 *.wxml / *.wxss / *.vue —— 无论用户如何表达（含「间距高了」「隐藏掉」这类微调措辞）：' + chr(10)
    + '1 先改原型（apps/<app>/prototype/index.html 或 docs/ui/prototypes/**）+ 同步页面规格 specs/**/page-spec*.md' + chr(10)
    + '2 过 ux-review-checklist 独立交互质检' + chr(10)
    + '3 用户确认原型 ← 人审节点，缺此步不得落码' + chr(10)
    + '4 原型/规格单独 commit，记下 sha' + chr(10)
    + '5 才改落地代码；该 UI commit 的 message 必须带一行 Proto: <sha>（commit-msg hook 强制 + CI R10 兜底）' + chr(10)
    + '豁免：纯视觉微调在原型里记一行「微调豁免」；批量机械改动/紧急修复用 UI_GATE=off。'
)


def main():
    payload = C.read_payload()
    root = C.project_root(payload)
    session_id = payload.get('session_id', '') or ''

    removed = 0
    d = C.state_dir(root)
    try:
        if os.path.isdir(d):
            for name in os.listdir(d):
                if not name.endswith(C.MARKER_SUFFIX):
                    continue
                p = os.path.join(d, name)
                try:
                    with open(p, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                except Exception:
                    continue
                if not C.marker_fresh(data):
                    os.remove(p)
                    removed += 1
    except Exception:
        pass

    C.audit(root, 'session-start', 'SessionStart', '-', session_id, {'expired_cleaned': removed})

    out = {
        'hookSpecificOutput': {
            'hookEventName': 'SessionStart',
            'additionalContext': GATE_TEXT,
        }
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('hook-session-start error (fail-open): %s%s' % (e, chr(10)))
        sys.exit(0)
