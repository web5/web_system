#!/usr/bin/env python3
"""L1 声波 icon 资产包构建器：三态 × 四尺寸 SVG/PNG/base64 + 总览图。

几何唯一真源 = gen-mic-icon.py 的 L1 定稿（dot_cx=6.90, dot_r=2.5,
r1=7.25, r2=11.55, span=±48°, sw=2.3, 端点同 x 严格镜像）。
"""
import base64
import io
import math
import os
import subprocess

from PIL import Image

REPO = "/Users/geekwen/workspace/web_system/apps/kedou-ai-minigram/prototype/assets/voice-icon"
MICGEN = "/tmp/micgen"
NODE_MODULES = "/Users/geekwen/.workbuddy/binaries/node/workspace/node_modules"
NODE_BIN = "/Users/geekwen/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
SVG2PNG = "/Users/geekwen/workspace/web_system/apps/kedou-ai-minigram/scripts/svg2png.js"

DOT_CX, DOT_R, R1, R2, SPAN, SW = 6.90, 2.5, 7.25, 11.55, 48, 2.3
INK = "#1F1F1F"

X1 = DOT_CX + R1 * math.cos(math.radians(SPAN))
Y1 = 12 - R1 * math.sin(math.radians(SPAN))
Y2 = 12 + R1 * math.sin(math.radians(SPAN))
X2 = DOT_CX + R2 * math.cos(math.radians(SPAN))
Y3 = 12 - R2 * math.sin(math.radians(SPAN))
Y4 = 12 + R2 * math.sin(math.radians(SPAN))


def build_svg(color: str) -> str:
    stroke = color if color != "current" else "currentColor"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
        f'stroke="{stroke}" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round">'
        f'<circle cx="{DOT_CX:.2f}" cy="12" r="{DOT_R}" fill="{stroke}" stroke="none"/>'
        f'<path d="M{X1:.2f} {Y1:.2f}A{R1} {R1} 0 0 1 {X1:.2f} {Y2:.2f}"/>'
        f'<path d="M{X2:.2f} {Y3:.2f}A{R2} {R2} 0 0 1 {X2:.2f} {Y4:.2f}"/></svg>'
    )


def rasterize(svg_path: str, png_path: str, px: int) -> None:
    env = dict(os.environ, NODE_PATH=NODE_MODULES)
    r = subprocess.run([NODE_BIN, SVG2PNG, svg_path, png_path, str(px)],
                       env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"光栅化失败: {r.stderr}")


def b64_of(path: str) -> str:
    buf = io.BytesIO()
    Image.open(path).convert("RGBA").save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    for d in ("svg", "png", "base64"):
        os.makedirs(os.path.join(REPO, d), exist_ok=True)

    states = {
        "wave-orange": "#F97316",
        "wave-white": "#FFFFFF",
        "wave-ink": INK,
        "wave-current": "current",
    }
    for name, color in states.items():
        svg_path = os.path.join(REPO, "svg", f"{name}.svg")
        with open(svg_path, "w") as f:
            f.write(build_svg(color))
        if name == "wave-current":
            continue  # currentColor 不出位图（供原型 inline 引用）
        # 288px 主位图：橙/白直接复用生成器产物（保真同源），墨版新光栅化
        src = os.path.join(MICGEN, f"{name}.png")
        if not os.path.exists(src):
            rasterize(svg_path, src, 288)
        for px in (288, 96, 54, 27):
            dst = os.path.join(REPO, "png", f"{name}-{px}.png")
            if px == 288:
                Image.open(src).convert("RGBA").save(dst)
            else:
                Image.open(src).convert("RGBA").resize((px, px), Image.LANCZOS).save(dst)
        print(f"[pack] {name}: svg + 4 尺寸 png ✓")

    # base64 即用片段（橙常态 / 白录音中）
    for name in ("wave-orange", "wave-white"):
        b = b64_of(os.path.join(REPO, "png", f"{name}-288.png"))
        with open(os.path.join(REPO, "base64", f"{name}.b64.txt"), "w") as f:
            f.write(b)
        print(f"[pack] base64/{name}.b64.txt ✓ ({len(b)} chars)")


if __name__ == "__main__":
    main()
