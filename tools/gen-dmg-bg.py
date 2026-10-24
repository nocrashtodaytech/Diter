#!/usr/bin/env python3
"""生成 dmg 窗口背景图：箭头 + 中文提示（不含图标）。

背景图不画 app / 文件夹图标 —— 图标由 Finder 按卷内实际文件显示，
画进背景图必然与真实图标错位。只画「箭头 + 文字」，与 .DS_Store
里 Diter.app / Applications 的 Iloc 位置精确对应。

输出 assets/dmg-bg.png（1320x840，即 Finder 窗口 660x420 的 @2x）。
布局（与 tools/dmg-dsstore.py 保持一致）：
  APP Iloc    (140, 110)  内容区坐标，iconSize 96
  FOLDER Iloc (420, 110)
  图标中心 1x：(188, 182) / (468, 182)   （+24 标题栏）
  箭头   1x：y=182，x 272 → 384
  文字   1x：y=274，水平居中
"""
from PIL import Image, ImageDraw, ImageFont
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1320, 840  # 660x420 @2x
TITLE_BAR = 24    # 标题栏近似高度（1x）
APP_POS = (140, 110)
FOLDER_POS = (420, 110)
ICON = 96
FONT_PATH = "/System/Library/Fonts/PingFang.ttc"


def main():
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # 图标中心 @2x（内容区坐标 + 标题栏，再 ×2）
    app_cx = APP_POS[0] * 2 + ICON  # 376
    folder_cx = FOLDER_POS[0] * 2 + ICON  # 936
    cy = (APP_POS[1] + TITLE_BAR) * 2 + ICON // 1  # Iloc 是图标左上角；中心 = 左上 + 48pt
    # 左上 @2x = (APP_POS+TITLE)*2；中心 = 左上 + 96
    cy = (APP_POS[1] + TITLE_BAR) * 2 + ICON  # 364

    # 箭头：两图标之间，留 36pt（=72@2x）呼吸空间
    x1 = app_cx + 72
    x2 = folder_cx - 72
    arrow = (120, 126, 136, 210)
    lw = 14
    draw.line([(x1, cy), (x2 - 26, cy)], fill=arrow, width=lw)
    head = 34
    draw.line([(x2 - head, cy - head), (x2, cy)], fill=arrow, width=lw)
    draw.line([(x2 - head, cy + head), (x2, cy)], fill=arrow, width=lw)
    r = lw // 2
    draw.ellipse([x1 - r, cy - r, x1 + r, cy + r], fill=arrow)

    # 提示文字：图标(96) + 标签(约 34) + 呼吸(44) 下方
    text = "拖入「应用程序」文件夹"
    try:
        font = ImageFont.truetype(FONT_PATH, 56)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    ty = (APP_POS[1] + ICON + 44 + TITLE_BAR) * 2
    draw.text(((W - tw) // 2 - bbox[0], ty - bbox[1]), text,
              fill=(90, 96, 105, 255), font=font)

    out = os.path.join(ROOT, "assets", "dmg-bg.png")
    canvas.save(out)
    print(f"written {out} ({W}x{H})")
    print(f"arrow y={cy}, x {x1}->{x2}; text y={ty}")


if __name__ == "__main__":
    sys.exit(main())
