#!/usr/bin/env python3
"""
生成 favicon.ico（多尺寸 16/32/48）。

为什么需要：浏览器只有在 index.html **没声明图标**、或走「书签 / 分享卡片 / RSS 阅读器」
这类非页面通道时，才会按惯例去请求站根 `/favicon.ico`。此前它是 404。

源文件：`servers/gateway/public/favicon.svg`（品牌橙 #F97316 圆角块 + 白豆 + 橙点）。
PIL 不能直接渲染 SVG，故此处按同一份几何参数重绘 ——
**改了 SVG 的形状或配色，要同步改这里的参数并重新生成**。

用法：
    python3 scripts/build_favicon_ico.py

产物：`servers/gateway/public/favicon.ico`
  —— dev/prod 都由 gateway 静态根提供该文件（prod 需额外把文件放到外置静态根
     `/data/web_system_static/public/favicon.ico`，因为那里才是 nginx 实际服务的目录）。
"""

from pathlib import Path

from PIL import Image, ImageDraw

# 与 favicon.svg 一致的设计参数（viewBox 0 0 96 96）
VIEW = 96
BG = (249, 115, 22, 255)  # #F97316 品牌橙
BG_RADIUS = 22
BEAN = (255, 255, 255, 255)
BEAN_BOX = (24, 20, 72, 76)  # 白豆外接矩形
BEAN_RADIUS = 24
DOT = (249, 115, 22, 255)
DOT_R = 8
DOT_HL = (253, 230, 138, 255)  # #FDE68A 高光
DOT_HL_R = 3

SS = 4  # 超采样倍数（抗锯齿）


def draw(size: int) -> Image.Image:
    side = size * SS
    img = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = side / VIEW

    d.rounded_rectangle([0, 0, side - 1, side - 1], radius=BG_RADIUS * k, fill=BG)
    d.rounded_rectangle(
        [c * k for c in BEAN_BOX], radius=BEAN_RADIUS * k, fill=BEAN
    )

    cx = cy = side / 2
    for r, color in ((DOT_R, DOT), (DOT_HL_R, DOT_HL)):
        rr = r * k
        # 高光点在 svg 里比圆心高 1 个单位，保持一致
        y = cy if r == DOT_R else cy - 1 * k
        d.ellipse([cx - rr, y - rr, cx + rr, y + rr], fill=color)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    sizes = [16, 32, 48]
    base = draw(max(sizes))
    out = Path(__file__).resolve().parent.parent / "servers" / "gateway" / "public" / "favicon.ico"
    out.parent.mkdir(parents=True, exist_ok=True)
    base.save(out, format="ICO", sizes=[(s, s) for s in sizes])
    print(f"已生成 {out} ({out.stat().st_size} bytes), sizes={sizes}")


if __name__ == "__main__":
    main()
