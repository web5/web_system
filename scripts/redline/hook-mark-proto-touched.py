#!/usr/bin/env python3
# ============================================================
# hook-mark-proto-touched.py — PostToolUse 标记写入（L3 配对）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4
# 职责：当本次写操作命中「原型与规格」集合（或内容含「微调豁免」），
#       写 .codebuddy/.state/proto-touched 标记，使同会话后续 UI 写被放行。
# 无第三方依赖。失败一律 fail-open（exit 0）。
# ============================================================
import json
import os
import sys
import time

MARKER_REL = ".codebuddy/.state/proto-touched"

# 通行证路径集合（§3.1）：改这些不触发门禁，但记标记放行后续 UI 写。
PASSPORT_GLOBS = [
    "apps/*/prototype/*",
    "docs/ui/prototypes/*",
    "specs/*/page-spec*.md",
    "*/page-spec*.md",
    "page-spec*.md",
]

# 显式豁免关键词（写在原型/规格/任意文件中都记一次放行标记）
EXEMPT_KEYWORD = "微调豁免"


def project_root(payload):
    v = os.environ.get("CODEBUDDY_PROJECT_DIR")
    if v and os.path.isdir(v):
        return os.path.realpath(v)
    cwd = payload.get("cwd")
    if cwd and os.path.isdir(cwd):
        return os.path.realpath(cwd)
    return os.path.realpath(os.getcwd())


def to_rel(path, root):
    """绝对/相对路径 → 仓库相对路径（与 gate 脚本同一套归一化，两脚本必须对称）。

    缺了这一步，IDE 传来的绝对路径（/Users/.../apps/x/prototype/index.html）
    永远匹配不上 PASSPORT_GLOBS（apps/*/prototype/*）→ 标记永不写入 → 放行通道失效。
    """
    try:
        path = os.path.realpath(path)
    except Exception:
        pass
    if path.startswith(root + os.sep):
        return path[len(root) + 1:]
    return path


def write_marker(root, source, target):
    d = os.path.join(root, ".codebuddy", ".state")
    try:
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "proto-touched"), "w", encoding="utf-8") as f:
            json.dump({
                "ts": time.time(),
                "source": source,
                "target": target,
            }, f, ensure_ascii=False)
    except Exception:
        pass  # fail-open


def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0

    root = project_root(payload)
    ti = payload.get("tool_input") or {}
    path = (ti.get("filePath") or ti.get("file_path") or ti.get("path") or "").strip()
    if not path:
        edits = ti.get("edits") or []
        if isinstance(edits, list):
            for e in edits:
                if isinstance(e, dict) and e.get("file_path"):
                    path = e["file_path"]
                    break

    import fnmatch
    rel = to_rel(path, root).replace(os.sep, "/")
    for pat in PASSPORT_GLOBS:
        if fnmatch.fnmatch(rel, pat):
            write_marker(root, "prototype", rel)
            return 0

    # 显式豁免记录：内容含「微调豁免」即记放行标记（留痕为主）
    content = ""
    if isinstance(ti.get("content"), str):
        content = ti["content"]
    elif isinstance(ti.get("new_string"), str):
        content = ti["new_string"]
    elif isinstance(ti.get("edits"), list):
        for e in ti["edits"]:
            if isinstance(e, dict) and isinstance(e.get("new_string"), str):
                content += e["new_string"]
    if EXEMPT_KEYWORD in content:
        write_marker(root, "exempt", rel)
        return 0

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
