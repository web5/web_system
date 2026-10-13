#!/usr/bin/env python3
"""输入栏录音键图标生成：SVG 唯一真相源 → 无头 Chrome 光栅化 → base64。

为什么不再用 PIL 手画（v1.0.13 起因）：
PIL 版与原型稿 SVG 是两套几何代码，位图与原型观感会漂移（双源漂移）。现在**原型稿与真机位图共用同一份 SVG**，
本脚本只负责把 SVG 光栅化成 WXSS 能吃的 base64 PNG（小程序 background-image
不支持本地路径，也不支持 SVG data-uri，必须位图）。

构图（微信语音输入同款）：实心圆点 + 右侧双层同心弧，整组在 24 画布内光学居中
（圆点偏左是构图的一部分，不是居中对象）。

几何参数集中在 PARAMS，改这里即可换档：
    dot_r 圆点半径 / r1 内弧半径 / r2 外弧半径 / span 弧半张角(度) / sw 线宽
派生量：
    dot_cx = 12 - (r2 - dot_r) / 2 - sw / 4   # 整组水平光学居中（含线宽补偿）
    水平跨度 = r2 + dot_r            # 决定横向饱满度
    竖向跨度 = 2 * r2 * sin(span)    # 决定纵向饱满度（也决定"弯曲感"）

产物：/tmp/wave-b64.txt（行1=橙线版常态 / 行2=白线版录音中）
"""
import base64
import io
import math
import os
import subprocess
from PIL import Image

# ---- 几何（L1 定稿：立弧 · 半弧端点严格同 x 镜像）----
# 端点 = (dot_cx + R·cos(span), 12 ± R·sin(span))，两端同 x、关于水平中线镜像
# span=48° ↔ 端点与垂直轴夹角 42°（L 系列 θ）；W 63% H 79%，点弧缝 1.35px、弧间距 2.25px
PARAMS = dict(dot_r=2.5, r1=7.25, r2=11.55, span=48, sw=2.3)
DOT_R = PARAMS["dot_r"]
R1, R2 = PARAMS["r1"], PARAMS["r2"]
SPAN, SW = PARAMS["span"], PARAMS["sw"]
# 整组光学居中：含线宽补偿 —— 左极值 = dot_cx - dot_r（圆点无描边），
# 右极值 = dot_cx + r2 + sw/2（外弧描边向外撑），中点为两者平均 ⇒ 多退 sw/4
DOT_CX = 12 - (R2 - DOT_R) / 2 - SW / 4

ORANGE = "#F97316"
WHITE = "#FFFFFF"

NODE_MODULES = "/Users/geekwen/.workbuddy/binaries/node/workspace/node_modules"
NODE_BIN = "/Users/geekwen/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
RASTER_PX = 288  # 96 的 3 倍，对应 @3x 位图，缩放不糊


def wave_paths(color: str) -> str:
    """圆点 + 双层同心弧的 SVG 片段。原型稿 HTML 与本脚本共用同一份几何。"""
    parts = [f'<circle cx="{DOT_CX:.2f}" cy="12" r="{DOT_R}" fill="{color}" stroke="none"/>']
    for R in (R1, R2):
        x = DOT_CX + R * math.cos(math.radians(SPAN))
        y1 = 12 - R * math.sin(math.radians(SPAN))
        y2 = 12 + R * math.sin(math.radians(SPAN))
        parts.append(f'<path d="M{x:.2f} {y1:.2f}A{R} {R} 0 0 1 {x:.2f} {y2:.2f}"/>')
    return "".join(parts)


def build_svg(color: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" '
        f'stroke="{color}" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round">'
        f'{wave_paths(color)}</svg>'
    )


def rasterize(svg_path: str, png_path: str) -> None:
    env = dict(os.environ, NODE_PATH=NODE_MODULES)
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "svg2png.js")
    r = subprocess.run([NODE_BIN, script, svg_path, png_path, str(RASTER_PX)],
                       env=env, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"[gen-mic-icon] 光栅化失败（需无头 Chrome + puppeteer-core）:\n{r.stderr}")
    print(r.stdout.strip())


def b64_of(path: str) -> str:
    buf = io.BytesIO()
    Image.open(path).convert("RGBA").save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    os.makedirs("/tmp/micgen", exist_ok=True)
    out = []
    for name, color in (("wave-orange", ORANGE), ("wave-white", WHITE)):
        svg_path, png_path = f"/tmp/micgen/{name}.svg", f"/tmp/micgen/{name}.png"
        with open(svg_path, "w") as f:
            f.write(build_svg(color))
        rasterize(svg_path, png_path)
        b = Image.open(png_path).getbbox()
        w, h = b[2] - b[0], b[3] - b[1]
        print(f"[gen-mic-icon] {name}: 宽 {w/RASTER_PX*100:.0f}% 高 {h/RASTER_PX*100:.0f}% "
              f"中心 ({(b[0]+b[2])/2:.0f},{(b[1]+b[3])/2:.0f})")
        out.append(b64_of(png_path))
        Image.open(png_path).resize((96, 96), Image.LANCZOS).save(f"/tmp/micgen/{name}-96.png")

    with open("/tmp/wave-b64.txt", "w") as f:
        f.write("\n".join(out))
    print("done; base64 → /tmp/wave-b64.txt（行1=橙常态 行2=白录音中）")
    print(f"[gen-mic-icon] 几何: dot_r={DOT_R} r1={R1} r2={R2} span=±{SPAN}° sw={SW} dot_cx={DOT_CX:.2f}")
    print(f"[gen-mic-icon] 两态 SVG 同步来源: {os.path.basename(__file__)} 的 wave_paths()")
    print("[gen-mic-icon] 原型稿请同步 <svg …>" + wave_paths("currentColor") + "</svg>")


main()
