<div align="center">

# Diter

**Write Windows, macOS, and Linux bootable USB drives — from any OS — without ever touching your system disk.**

[English](README.md) · [中文](README.zh-CN.md)

</div>

Diter is a cross-platform USB boot-media creator. Unlike tools that can only
"write their own half", Diter dispatches the correct strategy per image, so a
Windows ISO, a macOS installer, and any Linux distribution all produce
**actually bootable** drives — while keeping your system disk off-limits.

## Why Diter

| Tool | Gap |
|---|---|
| **Rufus** | Great on Windows, but can't write macOS (no HFS/APFS support) |
| **createinstallmedia** | Apple-only, installers only |
| **Etcher** | `dd` everywhere — but a Windows ISO is not a hybrid image, so `dd` produces an **unbootable** USB |

Diter routes each image to the right engine instead of blindly `dd`-ing:

| Target | Strategy |
|---|---|
| **Windows ISO** | partition → FAT32 → copy files → boot code (auto-splits `install.wim > 4 GB` with wimlib) |
| **macOS** | three-tier: `createinstallmedia` → `asr` → `raw`, covering 10.10 through the latest |
| **Linux** | whole-disk byte-level write, with optional `casper-rw` persistence partition |

## Highlights

- **Cross-platform** — macOS, Windows, and Linux hosts
- **Image detection** — reads file headers directly (ISO9660, GPT, MBR, HFS+, APFS, UDF, DMG) and shows an evidence chain
- **System-disk protection** — three independent gates; the system disk can't even be selected
- **Privilege helper** — authorization runs a headless helper, so the main window never restarts and keeps your selections
- **Post-write verification** — reads the whole drive back and compares SHA-256

## Safety model

1. **Enumeration** — every device gets a `verdict`; locked devices are excluded from the picker
2. **Confirmation** — checkbox + a 1.5-second press-and-hold
3. **Before writing** — re-enumerate, compare capacity, and re-run `assertWritable()`

On macOS, the system-disk check is non-trivial: the root volume `/` lives on a
*synthesized* APFS container, so the code must trace `APFSPhysicalStores` back to
the physical disk to avoid false negatives. Verified on real hardware.

## Screenshots

![Diter main window](preview/01-idle.png)

## Getting started (development)

```bash
npm install          # first run downloads the Electron runtime
npm run preview      # build a UI preview only (no Electron needed)
npm start            # build and launch the desktop app
```

The UI preview (`preview/diter-preview.html`) is a single self-contained file
using mock data — it never touches a real disk.

## Prebuilt artifacts (`release/`)

| Artifact | Platform | Notes |
|---|---|---|
| `Diter-0.1.0-mac-x64.dmg` | macOS (x64) | Unsigned — first launch needs right-click → Open |
| `Diter-win32-x64/Diter.exe` | Windows | Portable, no installer (keep the whole folder together) |

Rebuild: `npm run package` (see `build/package.sh`).

## Project structure

```
electron/core/     detection / safety / orchestration / engines
src/renderer/      React UI (compiled to Chrome 76 for older Electron)
docs/              ARCHITECTURE.md — full design, compatibility matrix, rationale
preview/           UI previews and flow screenshots
tools/             build & packaging helpers
```

Full design details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack

Electron 33 · React 18 · esbuild — with plain Node system calls (no native
Rust/Go dependencies to compile).

## Status & roadmap

Done: image detection, disk safety verdicts, write engines, full UI and flow,
privilege helper, verification.

Planned: bundle `wimlib`/`ms-sys` into the package; migrate the macOS helper to
`SMJobBless`; Windows volume locking (`FSCTL_LOCK_VOLUME`).

## License

[MIT](LICENSE)
