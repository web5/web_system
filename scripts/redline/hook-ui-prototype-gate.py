#!/usr/bin/env python3
# ============================================================
# hook-ui-prototype-gate.py — PreToolUse 硬阻断（L3）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4
# 职责：本地写 UI 源码前，必须先动过原型/页面规格；否则 deny。
# 路径判定挂在「改动对象」而非「用户措辞」（§3.1）。
# 无第三方依赖。失败一律 fail-open（exit 0），绝不阻断正常 IDE 会话。
# ============================================================
import json
import os
import sys
import time

MARKER_REL = ".codebuddy/.state/proto-touched"
TTL_HOURS = 8

# 受门禁约束的「UI 源码」集合（§3.1）。
# 说明：fnmatch 的 * 跨 / 匹配，故 apps/*/pages/* 覆盖 pages 全部深度。
UI_PATH_GLOBS = [
    "apps/*/pages/*",
    "apps/*/src/*.vue",
    "apps/*/components/*",
    "packages/ui/*",
    "apps/*/app.json",
    "app.json",
]
UI_EXTS = (".wxml", ".wxss", ".vue")

WRITE_TOOLS = {
    "write_to_file", "replace_in_file", "Write", "Edit", "MultiEdit",
}


def log(msg):
    sys.stderr.write(msg + "\n")


def project_root(payload):
    v = os.environ.get("CODEBUDDY_PROJECT_DIR")
    if v and os.path.isdir(v):
        return os.path.realpath(v)
    cwd = payload.get("cwd")
    if cwd and os.path.isdir(cwd):
        return os.path.realpath(cwd)
    return os.path.realpath(os.getcwd())


def to_rel(path, root):
    path = os.path.realpath(path)
    if path.startswith(root + os.sep):
        return path[len(root) + 1:]
    return path


def is_ui_source(rel):
    rel = rel.replace(os.sep, "/")
    if rel.endswith(UI_EXTS):
        return True
    import fnmatch
    for pat in UI_PATH_GLOBS:
        if fnmatch.fnmatch(rel, pat):
            return True
    return False


def marker_fresh(root):
    p = os.path.join(root, MARKER_REL)
    if not os.path.isfile(p):
        return False
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        ts = float(data.get("ts", 0))
    except Exception:
        return False
    return (time.time() - ts) <= TTL_HOURS * 3600


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0  # fail-open

    tool_name = payload.get("tool_name", "")
    if tool_name not in WRITE_TOOLS:
        return 0

    root = project_root(payload)
    ti = payload.get("tool_input") or {}
    path = (ti.get("filePath") or ti.get("file_path") or ti.get("path") or "").strip()
    if not path:
        # MultiEdit / 批量工具可能把路径放在 edits[] 下
        edits = ti.get("edits") or []
        if isinstance(edits, list):
            for e in edits:
                if isinstance(e, dict) and e.get("file_path"):
                    path = e["file_path"]
                    break
    if not path:
        return 0

    try:
        rel = to_rel(path, root)
    except Exception:
        rel = path

    if not is_ui_source(rel):
        return 0  # 非 UI 文件：零摩擦

    # 豁免出口 1：环境变量
    if (os.environ.get("UI_GATE", "") or "").lower() == "off":
        return 0

    # 豁免出口 2：本会话已动过原型（标记文件新鲜）
    if marker_fresh(root):
        return 0

    out = {
        "continue": False,
        "stopReason": "UI 改动须先过原型",
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                "本次会话尚未修改原型/页面规格。请先改 "
                "apps/<app>/prototype/index.html 或 specs/**/page-spec*.md，"
                "过 ux-review-checklist 并取得用户确认；"
                "纯视觉微调请在原型里记一行「微调豁免」。"
            ),
        },
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log("hook-ui-prototype-gate error (fail-open): %s" % e)
        sys.exit(0)
