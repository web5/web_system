#!/usr/bin/env python3
"""生成小程序输入栏麦克风图标（@3x PNG，透明底，单色可换）。

为什么不用纯 CSS 伪元素拼：WXSS 只有 ::before/::after 两个伪元素 + 一个实体子节点，
画出来的麦克风比例失真、边缘锯齿（rpx 在小尺寸下取整丢失），真机看就是「不像」。
直接出位图最稳：小程序 WXSS 的 background-image 不支持本地相对路径，只吃 base64，
所以这里生成后直接内联进 WXSS。
"""
import base64
import io
from PIL import Image, ImageDraw

SS = 4          # 超采样倍数
SIZE = 96       # 最终画布（@3x，实际显示 32px）
C = SIZE * SS   # 工作画布

ORANGE = (249, 115, 22, 255)
WHITE = (255, 255, 255, 255)

# —— 几何（工作画布坐标系，y 向下）——
CAP_W, CAP_H = 120 * SS // 4, 148 * SS // 4   # 话筒头胶囊
CAP_W, CAP_H = 120, 148
CAP_TOP = 57 * SS // 4
cx = C // 2
cap_box = (cx - CAP_W // 2, CAP_TOP, cx + CAP_W // 2, CAP_TOP + CAP_H)

ARC_R = 70 * SS // 4          # U 弧中线半径
ARC_W = 28 * SS // 4          # U 弧线宽
ARC_CY = 203 * SS // 4
arc_box = (cx - ARC_R, ARC_CY - ARC_R, cx + ARC_R, ARC_CY + ARC_R)

STEM_W = 26 * SS // 4
stem_top = ARC_CY + ARC_R - 6 * SS // 4
stem_bottom = 311 * SS // 4
stem_box = (cx - STEM_W // 2, stem_top, cx + STEM_W // 2, stem_bottom)

BASE_W, BASE_H = 104 * SS // 4, 20 * SS // 4
base_box = (cx - BASE_W // 2, 307 * SS // 4, cx + BASE_W // 2, 307 * SS // 4 + BASE_H)


def draw(color):
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 话筒头：胶囊
    d.rounded_rectangle(cap_box, radius=CAP_W // 2, fill=color)
    # U 形拾音支架（下半弧）
    d.arc(arc_box, start=0, end=180, fill=color, width=ARC_W)
    # 颈杆
    d.rounded_rectangle(stem_box, radius=STEM_W // 2, fill=color)
    # 底座
    d.rounded_rectangle(base_box, radius=BASE_H // 2, fill=color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    raw = buf.getvalue()
    return base64.b64encode(raw).decode(), len(raw)


if __name__ == "__main__":
    o = draw(ORANGE)
    w = draw(WHITE)
    o.save("/tmp/mic-orange.png")
    w.save("/tmp/mic-white.png")
    # 拼一张对比图方便肉眼验收：浅橙底 + 橙图标 / 橙底 + 白图标
    preview = Image.new("RGB", (SIZE * 3, SIZE), (255, 248, 240))
    preview.paste(Image.new("RGB", (SIZE, SIZE), (255, 237, 213)), (0, 0))
    preview.paste(o, (0, 0), o)
    preview.paste(Image.new("RGB", (SIZE, SIZE), (249, 115, 22)), (SIZE, 0))
    preview.paste(w, (SIZE, 0), w)
    preview.paste(Image.new("RGB", (SIZE, SIZE), (255, 255, 255)), (SIZE * 2, 0))
    preview.paste(o, (SIZE * 2, 0), o)
    preview = preview.resize((SIZE * 3 * 3, SIZE * 3), Image.NEAREST)
    preview.save("/tmp/mic-preview.png")

    ob, olen = b64(o)
    wb, wlen = b64(w)
    with open("/tmp/mic-b64.txt", "w") as f:
        f.write(ob + "\n" + wb + "\n")
    print(f"orange {olen}B -> b64 {len(ob)}; white {wlen}B -> b64 {len(wb)}")
