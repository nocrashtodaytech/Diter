#!/usr/bin/env python3
"""生成带 alpha（透明圆角）的 Diter 应用图标。
用 Pillow 直接绘制，完全控制 alpha 通道，避免 Chrome 渲染 SVG 丢失透明的问题。

整体（圆角方块 + 磁盘图形）四周留透明边，适配 macOS 图标视觉尺寸，
避免圆角方块占满画布导致比正常图标「大一圈」。
"""
from PIL import Image, ImageDraw

S = 1024
INSET = 82          # 四周透明留白（约 8%），让整体图标比正常大小略小
R = 190             # 圆角半径（约 22% 的方块边长）

top = (30, 35, 46)      # 渐变顶部（深蓝灰，磁盘外壳质感）
bottom = (11, 13, 18)   # 渐变底部

L = INSET
B = S - INSET           # 圆角方块右下角坐标

# 1) 垂直渐变 + 圆角 alpha mask（方块四周透明）
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([L, L, B - 1, B - 1], radius=R, fill=255)

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
for y in range(L, B):
    t = (y - L) / (B - L)
    c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    d.line([(L, y), (B, y)], fill=c + (255,))
img.putalpha(mask)

d = ImageDraw.Draw(img)

# 2) 磁盘外壳（圆角矩形，描边）
shell = (259, 360, 765, 664)
d.rounded_rectangle(shell, radius=50, fill=(18, 21, 28, 255), outline=(233, 238, 247, 255), width=37)

# 3) 状态灯（绿）
d.ellipse([309, 475, 383, 549], fill=(53, 211, 155, 255))

# 4) 盘片（圆环 + 蓝色中心）
d.ellipse([586, 440, 730, 584], fill=(18, 21, 28, 255), outline=(233, 238, 247, 255), width=37)
d.ellipse([634, 488, 682, 536], fill=(10, 132, 255, 255))

# 5) 底部标签线
d.line([(410, 595), (557, 595)], fill=(138, 149, 167, 255), width=34)

img.save('assets/icon.png')
print('icon.png written, hasAlpha =', img.mode == 'RGBA')
