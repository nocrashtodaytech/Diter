#!/usr/bin/env python3
"""给已挂载的 dmg 卷写 .DS_Store：背景图、窗口大小、图标位置。

用法: dmg-dsstore.py <挂载点>
窗口 660x420，背景 .background/bg.png（相对卷根）。
注意：ds_store 1.3.3 的逐条 insert 有 bug，必须用 initial_entries 一次性构建。
"""
import os
import plistlib
import struct
import sys

from ds_store import DSStore
from ds_store.store import DSStoreEntry
import mac_alias

WIN_W, WIN_H = 660, 420
ICON_SIZE = 96
# 图标位置（内容区左上角坐标，与 tools/gen-dmg-bg.py 的箭头布局对应）
APP_POS = (140, 110)
FOLDER_POS = (420, 110)


def build_entries(mount):
    bg_path = os.path.join(mount, ".background/bg.png")
    if not os.path.exists(bg_path):
        print(f"背景图不存在: {bg_path}", file=sys.stderr)
        sys.exit(1)
    alias_bytes = mac_alias.Bookmark.for_file(bg_path).to_bytes()

    def plist_bin(d):
        return plistlib.dumps(d, fmt=plistlib.FMT_BINARY)

    return [
        DSStoreEntry(
            "", "bwsp", "blob",
            plist_bin({
                "WindowBounds": f"{{{{180, 160}}, {{{WIN_W}, {WIN_H}}}}}",
                "ContainerShowSidebar": False,
                "ShowStatusBar": False,
                "ShowSidebar": False,
                "ShowToolbar": False,
                "SidebarWidth": 0,
            })),
        DSStoreEntry(
            "", "icvp", "blob",
            plist_bin({
                "viewStyle": "icon",
                "backgroundType": 2,
                "backgroundImageAlias": alias_bytes,
                "gridSpacing": 100,
                "iconSize": ICON_SIZE,
                "textSize": 13,
                "arrangeBy": "none",
                "showItemInfo": False,
                "showIconPreview": True,
                "labelOnBottom": True,
            })),
        DSStoreEntry("Diter.app", "Iloc", "blob",
                     struct.pack(">IIII", APP_POS[0], APP_POS[1], 0xFFFFFFFF, 0xFFFF0000)),
        DSStoreEntry("Applications", "Iloc", "blob",
                     __import__("struct").pack(">IIII", FOLDER_POS[0], FOLDER_POS[1], 0xFFFFFFFF, 0xFFFF0000)),
    ]


def main(mount):
    entries = build_entries(mount)
    entries.sort()
    ds_path = os.path.join(mount, ".DS_Store")
    if os.path.exists(ds_path):
        os.remove(ds_path)
    with DSStore.open(ds_path, "w+", initial_entries=entries):
        pass

    # 读回验证
    with DSStore.open(ds_path, "r") as d:
        names = [(e.filename, e.code.decode()) for e in d]
        icvp = d[""]["icvp"]
        assert icvp["backgroundType"] == 2 and icvp["backgroundImageAlias"], "icvp 校验失败"
        assert d["Diter.app"]["Iloc"] == APP_POS, "Diter.app 位置校验失败"
    print(f".DS_Store written: {names}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
