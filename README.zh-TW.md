<div align="center">

# Diter

**一個工具，寫三種系統。跨平台 USB 開機碟製作工具 —— 而且永遠不會碰你的系統碟。**

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [한국어](README.ko.md) · [العربية](README.ar.md) · [Русский](README.ru.md)

</div>

Diter 是一款跨平台 USB 開機碟製作工具。不同於只能「寫自己那一半」的工具，
Diter 會依映像檔語意分派正確的寫入策略，讓 Windows ISO、macOS 安裝程式、任意
Linux 發行版都能做出**真正可開機**的隨身碟 —— 同時把系統碟擋在可選範圍之外。

## 為什麼做 Diter

| 工具 | 短板 |
|---|---|
| **Rufus** | Windows 上極強，但寫不了 macOS（無 HFS/APFS 寫入能力） |
| **createinstallmedia** | 只做 Apple 自家安裝程式 |
| **Etcher** | 全平台 `dd`，但 Windows ISO 不是混合映像，`dd` 出來的隨身碟**無法開機** |

Diter 依映像檔語意分派引擎，而不是一律 `dd`：

| 目標 | 策略 |
|---|---|
| **Windows ISO** | 分割 → FAT32 → 複製檔案 → 開機程式（`install.wim > 4GB` 自動用 wimlib 拆分） |
| **macOS** | 三級策略：`createinstallmedia` → `asr` → `raw`，涵蓋 10.10 到最新版本 |
| **Linux** | 整碟位元組級寫入，可選 `casper-rw` 持久化分割區 |

## 亮點

- **跨平台** —— macOS / Windows / Linux 主機皆可用
- **映像識別** —— 直接讀取檔案標頭（ISO9660、GPT、MBR、HFS+、APFS、UDF、DMG），並提供識別證據鏈
- **系統碟防護** —— 三道獨立閘門，系統碟在內建層就無法被選取
- **提權助手** —— 授權執行的是無視窗背景助手，主視窗不重啟、已選內容不遺失
- **寫完驗證** —— 回讀整碟並比對 SHA-256
- **多執行緒寫入與驗證** —— 整碟映像按區塊對齊並行寫入、並行回讀驗證，執行緒數可選（自動 / 1 / 2 / 4 / 8）
- **磁碟工具** —— 零覆寫清除任意磁碟、把磁碟備份成 .img 映像
- **任務歷史** —— 每次寫入 / 清除 / 備份都記錄日誌，可一鍵定位日誌檔
- **多映像佇列** —— 一次拖入多個映像，隨時切換
- **外觀模式** —— 深色 / 淺色 / 跟隨系統
- **多語言** —— 6 種語言：简体中文、繁體中文、English、한국어、العربية、Русский

## 安全模型

1. **列舉期** —— 每台裝置算出 `verdict`，被鎖定的不進可選項
2. **確認期** —— 勾選 + 長按 1.5 秒
3. **寫入前** —— 重新列舉、比對容量、再跑一次 `assertWritable()`

macOS 上系統碟判定的關鍵：根卷宗 `/` 掛在**合成碟**（APFS 容器）上，必須沿
`APFSPhysicalStores` 追溯到實體碟，否則會漏判。已在真機實測驗證。

## 介面截圖

![Diter 主介面](preview/01-idle.png)

## 快速開始（開發）

```bash
npm install          # 首次執行會下載 Electron 執行環境
npm run preview      # 只產生介面預覽（不需要 Electron）
npm start            # 建置並啟動桌面應用程式
```

介面預覽產物 `preview/diter-preview.html` 是單一檔案，點兩下即可檢視，使用模擬
資料，不會碰觸真實磁碟。

## 已打包產物（`release/`）

| 產物 | 平台 | 說明 |
|---|---|---|
| `Diter-2.0.2-mac-x64.dmg` | macOS (x64) | 未簽署 —— 首次開啟需按右鍵 → 開啟 |
| `Diter-2.0.2-win-x64-setup.exe` | Windows (x64) | 安裝版（NSIS）—— 雙擊安裝，像一般軟體一樣使用 |

重新打包：`npm run package`（見 `build/package.sh`）。

> **Windows 常見問題**：若點兩下 `Diter.exe` 提示「缺少 VCRUNTIME140_1.dll /
> MSVCP140.dll，建議重新安裝」，是因為系統缺少 Microsoft Visual C++ 2015-2022
> 執行階段程式庫（Diter 以 Electron 建置，依賴該程式庫）。點兩下壓縮檔內的
> `vc_redist.x64.exe` 安裝後重新開啟即可。

## 目錄結構

```
electron/core/     偵測 / 安全 / 編排 / 引擎
src/renderer/      React 介面（編譯到 Chrome 76，相容舊版 Electron）
docs/              ARCHITECTURE.md —— 完整方案、相容矩陣、選型理由
preview/           介面預覽與流程截圖
tools/             建置與打包輔助腳本
```

詳細設計見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 技術棧

Electron 33 · React 18 · esbuild —— 純 Node 原生系統呼叫（無需編譯 Rust/Go
原生依賴）。

## 目前狀態與路線圖

已完成：映像識別、磁碟安全判定、寫入引擎、完整介面與全流程互動、提權助手、驗證、多執行緒寫入。

待補：把 `wimlib`/`ms-sys` 打包進安裝包；macOS 助手遷移到 `SMJobBless`；
Windows 側磁碟區鎖定（`FSCTL_LOCK_VOLUME`）。

## 授權條款

[MIT](LICENSE)
