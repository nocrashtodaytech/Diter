#!/usr/bin/env python3
"""
生成 Diter 的 DMG 安装背景图（简洁 + 品牌配色，去掉琐碎装饰）。

输出两个文件（dmgbuild 的 lookForHiDPI 会自动用 @2x 版本）：
  - assets/dmg-bg.png      (660x420, 1x)
  - assets/dmg-bg@2x.png   (1320x840, 2x Retina)

设计：对角渐变背景（淡蓝灰 → 淡暖橙白，呼应品牌深蓝灰 + 橙双主色），
左上角真实应用图标 + Diter 字标，中部简洁箭头（深灰线 + 橙色箭头头）+ 拖拽提示，
底部一句标语。无多余装饰，靠配色与排版取胜。
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 660, 420          # 逻辑尺寸
SCALE = 2                # 输出 2x（Retina）

# ---- 品牌色（取自 assets/icon.svg）----
INK        = (30, 35, 46)      # #1e232e 深蓝灰（标题）
BODY       = (58, 65, 77)      # #3a414d 正文/箭头线
GRAY       = (138, 149, 167)   # #8a95a7 副文字
ORANGE     = (255, 90, 43)     # #ff5a2b 箭头头（唯一品牌亮点）

# 对角渐变：左上淡蓝灰（呼应深蓝灰）→ 右下淡暖橙白（呼应橙）
BG_TOP     = (229, 235, 244)   # #e5ebf4
BG_BOTTOM  = (247, 238, 227)   # #f7eee3

FONT = "/System/Library/Fonts/PingFang.ttc"


def load_font(size, weight="regular"):
    idx = {"regular": 0, "medium": 4, "semibold": 5}.get(weight, 0)
    try:
        return ImageFont.truetype(FONT, size, index=idx)
    except Exception:
        try:
            return ImageFont.truetype(FONT, size, index=0)
        except Exception:
            return ImageFont.load_default()


def diagonal_gradient(w, h, top, bottom):
    img = Image.new("RGB", (w, h))
    px = img.load()
    inv_w, inv_h = 1.0 / w, 1.0 / h
    for y in range(h):
        ty = y * inv_h
        for x in range(w):
            t = (x * inv_w + ty) * 0.5
            r = round(top[0] + (bottom[0] - top[0]) * t)
            g = round(top[1] + (bottom[1] - top[1]) * t)
            b = round(top[2] + (bottom[2] - top[2]) * t)
            px[x, y] = (r, g, b)
    return img


def draw():
    S = SCALE
    img = diagonal_gradient(W * S, H * S, BG_TOP, BG_BOTTOM)
    d = ImageDraw.Draw(img)
    cx = W * S / 2

    # ---------- 左上角：真实应用图标 + 字标 ----------
    icon_size = 72 * S
    icon = Image.open("assets/icon.png").resize((icon_size, icon_size), Image.LANCZOS)
    img.paste(icon, (28 * S, 24 * S), icon)

    f_title = load_font(32, "semibold")
    d.text((112 * S, 60 * S), "Diter", font=f_title, fill=INK, anchor="lm")

    # ---------- 中部：简洁箭头 + 拖拽提示 ----------
    arrow_y = 188 * S
    ax0, ax1 = 220 * S, 440 * S
    d.line([ax0, arrow_y, ax1 - 1 * S, arrow_y], fill=INK, width=round(3 * S))
    hx, half = ax1, 6 * S
    d.polygon([(hx - 1 * S, arrow_y - half), (hx - 1 * S, arrow_y + half), (hx + 9 * S, arrow_y)], fill=INK)

    f_hint = load_font(24, "medium")
    d.text((cx, 244 * S), "拖入「应用程序」文件夹", font=f_hint, fill=BODY, anchor="mm")

    # ---------- 底部标语 ----------
    f_tag = load_font(18, "regular")
    d.text((cx, 348 * S), "跨平台启动盘制作工具", font=f_tag, fill=GRAY, anchor="mm")

    img.save("assets/dmg-bg@2x.png")
    img.resize((W, H), Image.LANCZOS).save("assets/dmg-bg.png")
    print("✓ 已生成 assets/dmg-bg.png (660x420) 与 assets/dmg-bg@2x.png (1320x840)")


if __name__ == "__main__":
    draw()
