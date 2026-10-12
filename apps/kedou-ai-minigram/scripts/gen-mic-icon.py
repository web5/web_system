#!/usr/bin/env python3
"""生成输入栏图标：常态线性（橙描边）+ 录音中面性（白）两态。

v1.0.11（2026-10-12）圆润度定档：真机反馈「录音 icon 单薄」→ 线性麦克风加粗 + 全圆头。
档位表 MIC_TIERS（A 现状 / B 微圆润 / C 圆润-默认 / D 明显圆润），用环境变量
MIC_ROUND=A|B|C|D 切档重跑即可，无需改几何代码。
圆润实现：所有直线段改用 rounded_rectangle（天然圆头），弧两端补端点圆，
杜绝 PIL line/arc 的平切端点（平切正是「单薄/生硬」的观感来源）。

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


# ---- 线性麦克风几何（圆润度分档） ----
# 档位：线宽(lw) 8/9/10/11px 递进，胶囊同步加宽、弧外张收敛
# 每项 = (lw, cap_half_w, cap_top, cap_bottom, arc_r, stem_top, stem_bottom, base_x0, base_x1)
MIC_TIERS = {
    "A": (32, 48, 14, 190,  96, 284, 350, 140, 244),  # v1.0.10 现状
    "B": (36, 50, 16, 190,  98, 286, 352, 138, 246),  # 微圆润
    "C": (40, 54, 18, 190, 102, 288, 354, 136, 248),  # 圆润（默认，v1.0.11 采用）
    "D": (44, 54, 20, 190, 102, 290, 356, 134, 250),  # 明显圆润
}
import os
MIC_TIER = os.environ.get("MIC_ROUND", "C").upper()
assert MIC_TIER in MIC_TIERS, f"MIC_ROUND 只接受 A/B/C/D，收到 {MIC_TIER}"
(LW, CAP_HW, CAP_TOP, CAP_BOT, ARC_R, STEM_TOP, STEM_BOT, BASE_X0, BASE_X1) = MIC_TIERS[MIC_TIER]


def mic_line(color):
    """线性麦克风：胶囊 + U 弧 + 茎 + 底座，全部圆头（无平切端点）。"""
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 胶囊（rounded_rectangle 自带圆头）
    d.rounded_rectangle((cx - CAP_HW, CAP_TOP, cx + CAP_HW, CAP_BOT),
                        radius=CAP_HW, outline=color, width=LW)
    # U 弧：端点落在胶囊底高，两端补圆头遮住 PIL arc 的平切
    arc_box = (cx - ARC_R, CAP_BOT - ARC_R, cx + ARC_R, CAP_BOT + ARC_R)
    d.arc(arc_box, start=0, end=180, fill=color, width=LW)
    for ex in (cx - ARC_R, cx + ARC_R):
        d.ellipse((ex - LW // 2, CAP_BOT - LW // 2, ex + LW // 2, CAP_BOT + LW // 2), fill=color)
    # 茎 + 底座：rounded_rectangle 圆头（不再用 line）
    d.rounded_rectangle((cx - LW // 2, STEM_TOP, cx + LW // 2, STEM_BOT),
                        radius=LW // 2, fill=color)
    d.rounded_rectangle((BASE_X0, STEM_BOT - LW // 2, BASE_X1, STEM_BOT + LW // 2),
                        radius=LW // 2, fill=color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


# ---- 线性加号（v1.0.10 定稿：画布占比 32%→78%，与麦克风视觉等大） ----
# v1.0.11：线宽锁定 8px，不随麦克风圆润档位浮动（真机已确认加号观感 OK，避免误伤）
PLUS_LW = 32


def plus_line(color):
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((cx - PLUS_LW // 2, 42, cx + PLUS_LW // 2, 342),
                        radius=PLUS_LW // 2, fill=color)
    d.rounded_rectangle((42, cx - PLUS_LW // 2, 342, cx + PLUS_LW // 2),
                        radius=PLUS_LW // 2, fill=color)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def b64(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def main():
    print(f"[gen-mic-icon] 麦克风圆润档位 = {MIC_TIER}（线宽 {LW // 4}px）")
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

    # 新旧对照：A（v1.0.10 现状）| 当前档位，浅橙圆钮里并排，肉眼验收用
    def with_tier(tier):
        global LW, CAP_HW, CAP_TOP, CAP_BOT, ARC_R, STEM_TOP, STEM_BOT, BASE_X0, BASE_X1
        save = (LW, CAP_HW, CAP_TOP, CAP_BOT, ARC_R, STEM_TOP, STEM_BOT, BASE_X0, BASE_X1)
        (LW, CAP_HW, CAP_TOP, CAP_BOT, ARC_R, STEM_TOP, STEM_BOT, BASE_X0, BASE_X1) = MIC_TIERS[tier]
        out = mic_line(ORANGE)
        (LW, CAP_HW, CAP_TOP, CAP_BOT, ARC_R, STEM_TOP, STEM_BOT, BASE_X0, BASE_X1) = save
        return out

    cmp_img = Image.new("RGB", (SIZE * 2 + 24, SIZE), (255, 255, 255))
    for i, (tier, label) in enumerate([("A", "old"), (MIC_TIER, "new")]):
        x = i * (SIZE + 24)
        cmp_img.paste(Image.new("RGB", (SIZE, SIZE), (255, 247, 237)), (x, 0))
        cmp_img.paste(with_tier(tier), (x, 0), with_tier(tier))
    cmp_img = cmp_img.resize(((SIZE * 2 + 24) * 4, SIZE * 4), Image.NEAREST)
    cmp_img.save("/tmp/mic-round-compare.png")
    print("对照图 /tmp/mic-round-compare.png（左=A 现状, 右=当前档位）")


main()
