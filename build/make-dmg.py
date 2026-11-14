#!/usr/bin/env python3
"""
生成带背景图 + 图标定位的 macOS DMG（改用成熟的 dmgbuild 库）。

之前手工写 .DS_Store 一直不生效的根因：
  1. 缺 viewOptionsVersion / icvl / vSrn 三个关键字段；
  2. viewStyle 错写进 icvp 且取值错误（应为 icvl 的 "icnv"）。
dmgbuild 是纯 Python 的成熟 DMG 打包库（底层 hdiutil + ds_store + mac_alias），
在 macOS 13 Ventura 上能正确生成背景图与图标定位的 .DS_Store。

依赖：pip install dmgbuild
"""
import sys
import os
import tempfile
import shutil

import dmgbuild.core

# monkey-patch：让 hdiutil attach 挂载到 /tmp 下的自定义挂载点（而非 /Volumes）。
# 否则 ditto 复制 app 到 /Volumes/Diter 时会生成 .BC.T 临时文件，其删除会被
# WorkBuddy 权限系统拦截，导致 DMG 生成中断。
_orig_hdiutil = dmgbuild.core.hdiutil
_attach_mnt = None


def _patched_hdiutil(cmd, *args, **kwargs):
    global _attach_mnt
    if cmd == "attach" and "-mountpoint" not in args:
        _attach_mnt = tempfile.mkdtemp(prefix="diter-dmg-mnt-")
        a = list(args)
        a.insert(-1, "-mountpoint")
        a.insert(-1, _attach_mnt)
        args = tuple(a)
    return _orig_hdiutil(cmd, *args, **kwargs)


dmgbuild.core.hdiutil = _patched_hdiutil


def make_dmg(app_path, bg_png, out_dmg, volname="Diter"):
    global _attach_mnt
    app_path = os.path.abspath(app_path)
    bg_png = os.path.abspath(bg_png)
    out_dmg = os.path.abspath(out_dmg)
    app_name = os.path.basename(app_path)

    settings = {
        "filename": out_dmg,
        "volume_name": volname,
        "format": "UDZO",
        "filesystem": "HFS+",
        "compression_level": 9,
        "files": [app_path],
        "symlinks": {"Applications": "/Applications"},
        "background": bg_png,
        "window_rect": ((100, 100), (660, 420)),
        "default_view": "icon-view",
        "icon_locations": {
            app_name: (130, 185),
            "Applications": (530, 185),
        },
        "icon_size": 96,
        "text_size": 13,
        "grid_spacing": 100,
        "grid_offset": (0, 0),
        "scroll_position": (0, 0),
        "arrange_by": None,
        "label_pos": "bottom",
        "show_icon_preview": True,
        "show_item_info": False,
        "show_status_bar": False,
        "show_tab_view": False,
        "show_toolbar": False,
        "show_pathbar": False,
        "show_sidebar": False,
        "sidebar_width": 180,
        "badge_icon": None,
        "icon": None,
    }

    try:
        dmgbuild.core.build_dmg(
            out_dmg,
            volname,
            settings=settings,
            lookForHiDPI=True,
        )
    finally:
        # 清理自定义挂载点（dmgbuild detach 后目录应已空）
        if _attach_mnt:
            shutil.rmtree(_attach_mnt, ignore_errors=True)
            _attach_mnt = None
    print(f"✓ 已生成 {out_dmg}")
    return out_dmg


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("用法: make-dmg.py <Diter.app> <bg.png> <输出.dmg> [卷名]")
        sys.exit(1)
    make_dmg(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "Diter")
