#!/bin/bash
# Diter macOS 签名 / 公证脚本
# 用法：
#   bash build/sign.sh <Diter.app 路径> [dmg 路径]
#
# 环境变量（可选）：
#   APPLE_IDENTITY   Developer ID Application 证书名（如 "Developer ID Application: Your Name (TEAMID)"）
#   APPLE_TEAM_ID    团队 ID（公证用）
#   APPLE_ID         公证用 Apple ID 邮箱（与 APPLE_PASSWORD 二选一）
#   APPLE_PASSWORD   公证用 App 专用密码
#   NOTARY_PROFILE   notarytool 已存储的凭据 profile 名（优先）
#
# 说明：
#   - 有 Developer ID 证书：完整签名（hardened runtime + entitlements）+ 公证 + 装订
#   - 无证书：自动降级为 ad-hoc 签名（codesign -s -），Gatekeeper 仍拦截，仅作占位
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP="${1:-release/Diter.app}"
DMG="${2:-}"
ENTITLEMENTS="assets/entitlements.mac.plist"

IDENTITY="${APPLE_IDENTITY:-}"
TEAM_ID="${APPLE_TEAM_ID:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

echo "=== Diter macOS 签名 ==="

if [ ! -d "$APP" ]; then
  echo "✗ 找不到 $APP"
  exit 1
fi

# 自动探测 Developer ID 证书
if [ -z "$IDENTITY" ]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -oE '"Developer ID Application: [^"]+"' \
    | head -1 | tr -d '"' || true)"
fi

if [ -z "$IDENTITY" ]; then
  echo "⚠ 未检测到 Developer ID Application 证书。"
  echo "  将使用 ad-hoc 签名（codesign -s -），仅作占位；"
  echo "  Gatekeeper 仍会拦截，用户首次打开需「右键 → 打开」。"
  echo "  要真正签名，请在 Apple Developer 后台创建 Developer ID Application 证书并安装到本机钥匙串，"
  echo "  再设置 APPLE_IDENTITY 后重跑本脚本。"
  ADHOC=1
else
  echo "✓ 签名身份：$IDENTITY"
  ADHOC=0
fi

echo ""
echo "--- 签名 $APP ---"
if [ "$ADHOC" = "1" ]; then
  codesign --force --deep --sign - "$APP"
else
  codesign --force --deep --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" "$APP"
fi

echo "--- 校验签名 ---"
codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -6
echo "✓ 签名完成"

# dmg 签名与公证（仅在正式签名时）
if [ "$ADHOC" = "0" ] && [ -n "$DMG" ] && [ -f "$DMG" ]; then
  echo ""
  echo "--- 签名 dmg ---"
  codesign --force --sign "$IDENTITY" "$DMG"

  echo "--- 公证 ---"
  if [ -n "$NOTARY_PROFILE" ]; then
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_PASSWORD:-}" ] && [ -n "$TEAM_ID" ]; then
    xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$TEAM_ID" --wait
  else
    echo "⚠ 未配置公证凭据（NOTARY_PROFILE 或 APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID），跳过公证。"
  fi

  echo "--- 装订公证票据 ---"
  if xcrun stapler staple "$DMG" 2>/dev/null; then
    echo "✓ 装订完成"
  else
    echo "⚠ 装订失败（可能公证未成功）"
  fi
fi

echo ""
echo "=== 完成 ==="
