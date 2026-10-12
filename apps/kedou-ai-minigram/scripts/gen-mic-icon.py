#!/usr/bin/env python3
"""生成输入栏图标：常态线性（橙）+ 录音中（白）两态。

v1.0.12（2026-10-12）造型换代：麦克风 → 声波（圆点 + 右侧双弧，微信语音输入同款语义）。
真机迭代史：v1.0.10 瘦长胶囊「单薄」→ v1.0.11 加粗圆头仍不够精致 → 用户拍板去话筒只留声波，
并选定「圆点+右弧」构图（对照稿 ①），要求整体放大、视觉居中。

几何（24 网格，脚本内 ×16 映射到 96px 画布，4x 超采样）：
- 圆点：cx=6.5, cy=12, r=2.6（实心）
- 内弧：M10.7 7.8 → a4.2（半圆，右凸），端点 (10.7,7.8)/(10.7,16.2)
- 外弧：M13.3 5.2 → a6.8（半圆，右凸），端点 (13.3,5.2)/(13.3,18.8)
- 水平跨度 3.9→20.1，光学中心 ≈ 12.0（居中）；竖直 5.2→18.8 居中
- 线宽 2.2（×16=35.2≈36 → 96 画布 9px），所有端点补圆头，杜绝 PIL 平切
- ➕ 维持 v1.0.10 定稿不动（线宽锁定 8px）

显示口径：位图 44rpx → 48rpx（76rpx 圆钮内占比 58%→63%，响应「稍微大一点」）。
生成后 base64 内联进 WXSS（小程序 background-image 只吃 base64）。
"""
import base64
import io
import os
from PIL import Image, ImageDraw

SS = 4
SIZE = 96
C = SIZE * SS
K = 16  # 24 网格 → 96 画布 的换算系数

ORANGE = (249, 115, 22, 255)
WHITE = (255, 255, 255, 255)

# ---- 声波几何（24 网格值 × K） ----
DOT_CX, DOT_CY, DOT_R = 6.5 * K, 12 * K, 2.6 * K
IN_X, IN_R = 10.7 * K, 4.2 * K     # 内弧：圆心 x、半径
OUT_X, OUT_R = 13.3 * K, 6.8 * K   # 外弧
LW = round(2.2 * K)                 # 36（=96 画布 9px）

WAVE_JSON = os.environ.get("WAVE_JSON", "")


def _arc_right(d, ccx, r, color):
    """右凸半圆弧（-90°→90°）+ 两端圆头。"""
    box = (ccx - r, C // 2 - r, ccx + r, C // 2 + r)
    d.arc(box, start=-90, end=90, fill=color, width=LW)
    for ey in (C // 2 - r, C // 2 + r):
        d.ellipse((ccx - LW // 2, ey - LW // 2, ccx + LW // 2, ey + LW // 2), fill=color)


def wave(color):
    """声波：实心圆点 + 右侧双弧，全部圆头。"""
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((DOT_CX - DOT_R, DOT_CY - DOT_R, DOT_CX + DOT_R, DOT_CY + DOT_R), fill=color)
    _arc_right(d, IN_X, IN_R, color)
    _arc_right(d, OUT_X, OUT_R, color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


# ---- 线性加号（v1.0.10 定稿，不动） ----
PLUS_LW = 32


def plus_line(color):
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((C // 2 - PLUS_LW // 2, 42, C // 2 + PLUS_LW // 2, 342),
                        radius=PLUS_LW // 2, fill=color)
    d.rounded_rectangle((42, C // 2 - PLUS_LW // 2, 342, C // 2 + PLUS_LW // 2),
                        radius=PLUS_LW // 2, fill=color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    wave_lo = wave(ORANGE)   # 橙声波（常态，浅橙底）
    wave_fw = wave(WHITE)    # 白声波（录音中，橙底）
    plus_lo = plus_line(ORANGE)

    wave_lo.save("/tmp/wave-orange.png")
    wave_fw.save("/tmp/wave-white.png")

    # 三联预览：常态 | 录音中 | 加号
    preview = Image.new("RGB", (SIZE * 3, SIZE), (255, 255, 255))
    def paste(img, x, bg):
        preview.paste(Image.new("RGB", (SIZE, SIZE), bg), (x, 0))
        preview.paste(img, (x, 0), img)
    paste(wave_lo, 0, (255, 247, 237))
    paste(wave_fw, SIZE, (249, 115, 22))
    paste(plus_lo, SIZE * 2, (255, 247, 237))
    preview = preview.resize((SIZE * 3 * 4, SIZE * 4), Image.NEAREST)
    preview.save("/tmp/wave-preview3.png")

    with open("/tmp/mic3-b64.txt", "w") as f:
        f.write("\n".join([b64(wave_lo), b64(wave_fw), b64(plus_lo)]))
    print("done; base64 → /tmp/mic3-b64.txt（行1=橙声波 行2=白声波 行3=加号）；预览 /tmp/wave-preview3.png")


main()
