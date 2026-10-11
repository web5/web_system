#!/usr/bin/env python3
"""生成输入栏图标：线性（常态）+ 面性（录音中高亮）两套风格。

交互规范：常态 = 线性（浅橙底 + 橙细描边），录音中 = 面性（实心橙底 + 白面性），
激活态有明确视觉跃迁。生成后 base64 内联进 WXSS（小程序 background-image 只吃 base64）。
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

# ---- 面性麦克风几何（复用 v1.0.7，已验证居中） ----
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


# ---- 加号 ----
def plus_line(color):
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line((cx, 130, cx, 254), fill=color, width=LW)
    d.line((130, cx, 254, cx), fill=color, width=LW)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    mic_lo = mic_line(ORANGE)
    mic_fw = mic_fill(WHITE)
    plus_lo = plus_line(ORANGE)

    mic_lo.save("/tmp/mic-line-orange.png")
    mic_fw.save("/tmp/mic-fill-white.png")
    plus_lo.save("/tmp/plus-line-orange.png")

    # 拼接对比图：常态（浅橙底） | 录音中（橙底） | 加号（浅橙底）
    BG = (255, 248, 240)
    preview = Image.new("RGB", (SIZE * 3, SIZE), BG)
    def paste(img, x, bg):
        preview.paste(Image.new("RGB", (SIZE, SIZE), bg), (x, 0))
        preview.paste(img, (x, 0), img)
    paste(mic_lo, 0, (255, 237, 213))
    paste(mic_fw, SIZE, (249, 115, 22))
    paste(plus_lo, SIZE * 2, (255, 237, 213))
    preview = preview.resize((SIZE * 3 * 4, SIZE * 4), Image.NEAREST)
    preview.save("/tmp/mic-preview2.png")

    with open("/tmp/mic2-b64.txt", "w") as f:
        f.write("\n".join([b64(mic_lo), b64(mic_fw), b64(plus_lo)]))
    print("done; 三张图 base64 已写入 /tmp/mic2-b64.txt")


main()
