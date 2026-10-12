#!/usr/bin/env python3
"""生成输入栏图标：常态线性（橙）+ 录音中（白）两态。

v1.0.12（2026-10-12）造型换代：麦克风 → 声波（圆点 + 右侧双弧，微信语音输入同款语义）。
真机迭代史：v1.0.10 瘦长胶囊「单薄」→ v1.0.11 加粗圆头仍不够精致 → 用户拍板去话筒只留声波，
并选定「圆点+右弧」构图（对照稿 ①），要求整体放大、视觉居中。

几何（24 网格，脚本内 ×16 映射到 96px 画布，4x 超采样）· 左右对称单弧：
- 圆点居中：cx=12, cy=12, r=2.7（实心）
- 右弧：M15.4 7.2 → a4.8（半圆右凸）；左弧：M8.6 7.2 → a4.8（半圆左凸）——左右镜像
- 水平跨度 3.8→20.2，严格对称，光学中心 12.0；竖直 7.2→16.8 居中
- 线宽 2.25（×16=36 → 96 画布 9px），所有端点补圆头，杜绝 PIL 平切
- 迭代：v1.0.11 加粗圆头仍不够精致 → 换声波 → 去话筒 → ①圆点+右双弧 →
  用户裁定「不要对称双弧（双侧各两条），单弧就好但得左右对称」→ 定稿对称单弧
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
DOT_CX, DOT_CY, DOT_R = 12 * K, 12 * K, 2.7 * K   # 圆点居中
ARC_R = 7.0 * K                     # 弧半径（以圆点为圆心，同心）
ARC_SPAN = 60                       # 弧半张角（度）：-60°→60° 右弧，镜像左弧
LW = round(2.3 * K)                 # 37（=96 画布 9.2px）

WAVE_JSON = os.environ.get("WAVE_JSON", "")


import math


def _arc(d, r, color, right=True):
    """同心弧：以圆点为圆心，右弧 -SPAN→+SPAN / 左弧镜像，两端补圆头。"""
    box = (DOT_CX - r, DOT_CY - r, DOT_CX + r, DOT_CY + r)
    if right:
        d.arc(box, start=-ARC_SPAN, end=ARC_SPAN, fill=color, width=LW)
        angles = (-ARC_SPAN, ARC_SPAN)
    else:
        d.arc(box, start=180 - ARC_SPAN, end=180 + ARC_SPAN, fill=color, width=LW)
        angles = (180 - ARC_SPAN, 180 + ARC_SPAN)
    for a in angles:
        ex = DOT_CX + r * math.cos(math.radians(a))
        ey = DOT_CY + r * math.sin(math.radians(a))
        d.ellipse((ex - LW // 2, ey - LW // 2, ex + LW // 2, ey + LW // 2), fill=color)


def wave(color):
    """声波：居中实心圆点 + 左右镜像单弧，严格左右对称。"""
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((DOT_CX - DOT_R, DOT_CY - DOT_R, DOT_CX + DOT_R, DOT_CY + DOT_R), fill=color)
    _arc(d, ARC_R, color, right=False)
    _arc(d, ARC_R, color, right=True)
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
