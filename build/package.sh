#!/bin/bash
# Diter 打包脚本：手动拼装 macOS .app 与 Windows 目录（绕过 electron-builder 与 wine）。
# 依赖：已下载的 electron 二进制 zip（/tmp/electron-darwin-x64.zip、/tmp/electron-win32-x64.zip）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION=$(node -p "require('./package.json').version")
OUT="$ROOT/release"
rm -rf "$OUT"
mkdir -p "$OUT"

# 确保前端已构建
[ -f dist/renderer/index.html ] || node build/bundle.mjs

echo "=== 打包 macOS (Diter.app) ==="
rm -rf /tmp/diter-mac
mkdir -p /tmp/diter-mac
unzip -q /tmp/electron-darwin-x64.zip -d /tmp/diter-mac
APP="$OUT/Diter.app"
cp -R /tmp/diter-mac/Electron.app "$APP"

PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleDisplayName Diter" "$PLIST" 2>/dev/null || true
$PB -c "Set :CFBundleName Diter" "$PLIST" 2>/dev/null || true
$PB -c "Set :CFBundleIdentifier dev.diter.usb" "$PLIST" 2>/dev/null || true
$PB -c "Set :CFBundleShortVersionString $VERSION" "$PLIST" 2>/dev/null || true
$PB -c "Set :NSHighResolutionCapable true" "$PLIST" 2>/dev/null || true

# 图标：直接覆盖默认 electron.icns（CFBundleIconFile 默认即 electron.icns）
cp assets/icon.icns "$APP/Contents/Resources/electron.icns"

# 应用代码
mkdir -p "$APP/Contents/Resources/app"
cp -R electron "$APP/Contents/Resources/app/"
cp -R dist "$APP/Contents/Resources/app/"
cp package.json "$APP/Contents/Resources/app/"

echo "  ✓ Diter.app"

echo "=== 打包 Windows (Diter.exe 目录) ==="
rm -rf /tmp/diter-win
mkdir -p /tmp/diter-win
unzip -q /tmp/electron-win32-x64.zip -d /tmp/diter-win
WIN="$OUT/Diter-win32-x64"
cp -R /tmp/diter-win "$WIN"

# 可执行文件改名
mv "$WIN/electron.exe" "$WIN/Diter.exe"
rm -f "$WIN/resources/default_app.asar"

# 应用代码
mkdir -p "$WIN/resources/app"
cp -R electron "$WIN/resources/app/"
cp -R dist "$WIN/resources/app/"
cp package.json "$WIN/resources/app/"

echo "  ✓ Diter-win32-x64"

echo "=== 生成 dmg 与 zip ==="
hdiutil create -volname "Diter" -srcfolder "$APP" -ov -format UDZO "$OUT/Diter-$VERSION-mac-x64.dmg" >/dev/null 2>&1 || echo "  (dmg 生成失败，改用 zip)"
(cd "$OUT" && zip -qr "Diter-$VERSION-win-x64.zip" "Diter-win32-x64")
# mac 也出一份 zip 方便跨平台传输
(cd "$OUT" && zip -qr "Diter-$VERSION-mac-x64.zip" "Diter.app")

echo "=== 产物清单 ==="
ls -la "$OUT"
echo ""
echo "Diter.app 大小: $(du -sh "$APP" | cut -f1)"
echo "Windows 目录: $(du -sh "$WIN" | cut -f1)"
