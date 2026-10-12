#!/usr/bin/env python3
"""生成输入栏图标：常态线性（橙描边）+ 录音中面性（白）两态。

交互规范（2026-10-12 v1.0.10 真机定稿，回退 v1.0.9 全面型误读）：
- 常态 = 线性 line：浅橙底（--brand-50）+ 橙细描边图标
- 录音中（按住）= 面性 filled：实心橙底（--brand）+ 白面性麦克风
- ➕ 与 🎙 圆钮统一 76rpx、位图统一 44rpx 显示；加号画布占比从 32% 放大到 78%
  （v1.0.9 真机「加号偏小」的根因：加号线段只画了画布的 1/3，视觉远小于麦克风）
生成后 base64 内联进 WXSS（小程序 background-image 只吃 base64）。
"""
import base64
import io
from PIL import Image, ImageDraw

SS = 4
SIZE = 96
C = SIZE * SS

ORANGE = (249, 115, 22, 255)
WHITE = (255, 255, 255, 255)

cx = C // 2

# ---- 面性麦克风几何（实心：胶囊 + U 弧 + 颈杆 + 底座） ----
CAP_W, CAP_H, CAP_TOP = 120, 148, 57
cap_box = (cx - CAP_W // 2, CAP_TOP, cx + CAP_W // 2, CAP_TOP + CAP_H)
ARC_R, ARC_W, ARC_CY = 70, 28, 203
arc_box = (cx - ARC_R, ARC_CY - ARC_R, cx + ARC_R, ARC_CY + ARC_R)
STEM_W = 26
stem_box = (cx - STEM_W // 2, ARC_CY + ARC_R - 6, cx + STEM_W // 2, 311)
BASE_W, BASE_H = 104, 20
base_box = (cx - BASE_W // 2, 307, cx + BASE_W // 2, 307 + BASE_H)


def mic_fill(color):
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(cap_box, radius=CAP_W // 2, fill=color)
    d.arc(arc_box, start=0, end=180, fill=color, width=ARC_W)
    d.rounded_rectangle(stem_box, radius=STEM_W // 2, fill=color)
    d.rounded_rectangle(base_box, radius=BASE_H // 2, fill=color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


# ---- 线性麦克风几何（Feather mic 标准坐标 x16：弧端点=胶囊底高、明显外张、弧只在底以下） ----
LW = 32  # 线宽 8px 最终
def mic_line(color):
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 胶囊 x ±48, y 14..190（瘦长）
    d.rounded_rectangle((cx - 48, 14, cx + 48, 190), radius=48,
                        outline=color, width=LW)
    # 弧：端点 (±96, 190)=胶囊底高，U 架收拢贴住话筒头，弧底 286
    d.arc((cx - 96, 94, cx + 96, 286), start=0, end=180, fill=color, width=LW)
    d.line((cx, 284, cx, 354), fill=color, width=LW)
    d.line((140, 354, 244, 354), fill=color, width=LW)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


# ---- 线性加号（v1.0.10：画布占比 32%→78%，与麦克风视觉等大） ----
def plus_line(color):
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line((cx, 42, cx, 342), fill=color, width=LW)
    d.line((42, cx, 342, cx), fill=color, width=LW)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    mic_lo = mic_line(ORANGE)   # 线性橙麦克风（常态）
    mic_fw = mic_fill(WHITE)    # 面性白麦克风（录音中）
    plus_lo = plus_line(ORANGE)  # 线性橙加号（常态）

    mic_lo.save("/tmp/mic-line-orange.png")
    mic_fw.save("/tmp/mic-fill-white.png")
    plus_lo.save("/tmp/plus-line-orange.png")

    # 拼接对比图：麦克风常态（浅橙底）| 录音中（橙底）| 加号（浅橙底）
    preview = Image.new("RGB", (SIZE * 3, SIZE), (255, 255, 255))
    def paste(img, x, bg):
        preview.paste(Image.new("RGB", (SIZE, SIZE), bg), (x, 0))
        preview.paste(img, (x, 0), img)
    paste(mic_lo, 0, (255, 247, 237))
    paste(mic_fw, SIZE, (249, 115, 22))
    paste(plus_lo, SIZE * 2, (255, 247, 237))
    preview = preview.resize((SIZE * 3 * 4, SIZE * 4), Image.NEAREST)
    preview.save("/tmp/mic-preview3.png")

    with open("/tmp/mic3-b64.txt", "w") as f:
        f.write("\n".join([b64(mic_lo), b64(mic_fw), b64(plus_lo)]))
    print("done; 三张图 base64 已写入 /tmp/mic3-b64.txt（行1=线性麦 行2=面性白麦 行3=线性加号）")


main()
