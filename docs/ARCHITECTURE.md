# Diter · 技术方案

> 一个安装包同时支持 Windows / macOS / Linux 三种目标系统，自动识别并锁死系统盘。

---

## 1. 先说结论：为什么现有工具会互相"写不了"

| 工具 | 平台 | 能写 Windows | 能写 macOS | 能写 Linux | 写不了的原因 |
|---|---|---|---|---|---|
| Rufus | Windows | ✅ 最佳 | ❌ | ✅ | Windows 没有 HFS+/APFS 写入能力，也没有 `asr`/`bless` |
| balenaEtcher | 全平台 | ⚠️ 能写但**不可启动** | ❌ | ✅ | 只做 dd，而 Windows ISO 不是混合镜像 |
| Apple `createinstallmedia` | macOS | ❌ | ✅ | ❌ | Apple 只做自家安装器 |
| `dd` / `dd for Windows` | 全平台 | ⚠️ 同上 | ⚠️ 部分 | ✅ | 不理解镜像语义，也没有安全护栏 |
| **Diter** | 全平台 | ✅ 文件级安装盘 | ✅ 原生安装器 / asr | ✅ 整盘写入 | — |

**根因**：三类镜像的"正确写法"在物理层面完全不同。

- **Linux ISO** 是 isohybrid：自带分区表 + El Torito 引导，逐字节写入即双启动。→ 用 `raw`
- **Windows ISO** 是 ISO9660/UDF + El Torito，**不是**混合镜像。必须建分区、格式化 FAT32、拷文件、补引导扇区。→ 用 `files`
- **macOS 安装器**是 HFS+/APFS 卷 + Apple 私有引导（bless）。必须在 macOS 上用 Apple 自己的工具。→ 用 `native`

所以 Diter 的核心不是"一个 dd 加壳"，而是**三个引擎 + 一个决策器**。

---

## 2. 三层架构

```
┌─────────────────────────────────────────────────────┐
│  渲染层  React 18 + TS（转译目标 Chrome 76）          │
│  拖放 → 识别 → 选盘 → 长按确认 → 进度/校验/弹出        │
└──────────────────────────┬──────────────────────────┘
                           │ contextBridge（无 Node 暴露）
┌──────────────────────────▼──────────────────────────┐
│  编排层  writer.js                                   │
│  安全复核 → 引擎选择 → 执行 → 校验 → 弹出             │
└───────┬──────────────┬──────────────┬───────────────┘
        │              │              │
┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────────┐
│ detect.js    │ │ safety.js  │ │ engines/       │
│ 镜像语义识别  │ │ 唯一判决者  │ │ raw / macos /  │
│ ISO9660 目录 │ │ 10 条规则   │ │ windows / linux│
└──────────────┘ └─────┬──────┘ └────────────────┘
                       │
              ┌────────▼─────────┐
              │ devices/         │
              │ darwin/win32/    │
              │ linux 事实探测    │
              └──────────────────┘
```

设计原则：**探测层只陈述事实，安全层独占判决权，UI 无权放行。**
UI 里的 `device.selectable` 是服务端算好后传下来的只读字段；即使有人改前端，`assertWritable()` 仍会在写入前抛错。

---

## 3. 镜像识别：不靠文件名，靠内容

`detect.js` 直接读文件头，不做挂载：

| 判据 | 位置 | 得到什么 |
|---|---|---|
| ISO9660 PVD | 扇区 16（偏移 32768） | 卷标、根目录 LBA、El Torito 标志 |
| 目录树走查（深度 2） | 根目录 | `sources/install.wim`、`casper/`、`isolinux/`、`.disk/` |
| GPT | 偏移 512 `EFI PART` | 是否自带分区表 |
| MBR | 偏移 510 `55 AA` + 分区类型 | 引导类型 0x0c/0x0e/0x83/0xef |
| HFS+ / HFSX | 偏移 1024 `H+` / `HX` | macOS 卷 |
| APFS | 偏移 32 `NXSB` | APFS 容器 |

由此得出 `target.os`、`version`、`arch`，并附上**证据链**（界面上那排小标签），让用户能自己判断识别是否靠谱，而不是盲信一个百分比。

补充判定：
- `install.wim > 4 GB` → 标记 `needsFat32Split`（FAT32 单文件上限 3.99 GB）
- 有 `casper/` 或 `LiveOS/` → 支持持久化分区

---

## 4. 安全模型：灾难防护是产品的地基

### 4.1 三道闸门

1. **枚举期**：每台设备算出 `verdict`，被锁的**不出现在可选项里**（不是变灰，是根本没得选）
2. **确认期**：勾选 + **长按 1.5 秒**（单次误触物理上无法完成）
3. **写入前**：重新枚举设备、比对容量、再跑一次 `assertWritable()` —— 防止用户在确认弹窗停留时换了盘

### 4.2 平台判据（关键在于"系统盘"怎么算）

| 平台 | 不可移动/内建判据 | 系统盘判据 |
|---|---|---|
| macOS | `diskutil info -plist` 的 `Internal`、`BusProtocol`（SATA/PCI-Express/Apple Fabric 一律视为内建）、`VirtualOrPhysical` | 根卷 `/` 的 `ParentWholeDisk` **再沿 `APFSPhysicalStores` 追溯到物理盘** |
| Windows | `Get-Disk` 的 `BusType`（USB=7、SD=12、MMC=13 才放行） | `IsSystem` / `IsBoot` / 是否含 `%SystemDrive%` 盘符 |
| Linux | `/sys/block/*/removable` + `device` 链接是否含 `/usb` | `/proc/mounts` 反查 `/`、`/boot`、swap，再经 `/sys/class/block/*/slaves` 还原 LVM/mdraid/dm-crypt 到真实整盘 |

**实测踩坑（本机 macOS 15 已验证）**：
`diskutil list -plist` 里内建 SSD 的 `OSInternal` 返回 `false`，完全不可用；而根卷 `/` 的 `ParentWholeDisk` 是**合成盘 `disk1`**（APFS 容器），只比对它就会漏判物理盘 `disk0`。必须做整条链解析：

```
/ → disk1s4s1 → disk1 (APFS Container) → APFSPhysicalStores: disk0s2 → disk0  ← 真正的系统盘
```

本机实测结果（未插 U 盘时）：`0 台可写 / 4 台已锁定`，内建 SSD、APFS 容器、两个磁盘映像全部正确锁定。

### 4.3 规则表（`electron/core/safety.js`，10/10 单测通过）

| 优先级 | 规则 | 结果 |
|---|---|---|
| 1 | `isSystemDisk` | 拦截 `SYSTEM_DISK`（最高优先级，先于容量判断） |
| 2 | `virtual`（磁盘映像/APFS 容器） | 拦截 `VIRTUAL_DISK` |
| 3 | `internal`（即使 `removable=true`） | 拦截 `INTERNAL_DISK` |
| 4 | `busKind === 'unknown'` | 拦截 `UNKNOWN_BUS`（需显式开启才放行） |
| 5 | `writable === false` | 拦截 `READ_ONLY` |
| 6 | `size < image + 16 MB` | 拦截 `TOO_SMALL` |
| 7 | `size < image × 1.12` | 放行但告警"容量偏紧" |

原则：**宁可拦错，不可写错**。拦错了用户换台设备；写错了用户丢的是整台机器。

---

## 5. 三个写入引擎

### 5.1 `raw` —— Linux / 整盘映像
不调用 `dd`，直接用 Node `fs` 读写设备节点（macOS `/dev/rdiskN` 字符设备绕缓冲）：

- 8 MB 分块 + 部分写循环，进度精确到字节
- `AbortSignal` 取消（3 秒内响应）
- 3 秒滑动窗口算速率，避免界面数字抽搐
- 写完 `fsync`，可选回读整盘比对 SHA-256（源镜像哈希带磁盘缓存，重试不用重算）

### 5.2 `windows-media` —— 文件级安装盘（任意宿主）
```
分区(MBR/FAT32/active) → 挂载 ISO 只读 → 递归拷贝(带进度)
  → install.wim > 4GB ? wimlib-imagex split 成 install.swm
  → 补引导 → 刷新缓存
```
- **UEFI 保证可启动**：ISO 内的 `/efi/boot/bootx64.efi` 拷过去就行，全平台 100% 可用
- **Legacy BIOS**：Windows 宿主调 ISO 自带的 `bootsect.exe /nt60 X: /mbr`；macOS/Linux 宿主调 `ms-sys`；缺失时**明确告警降级**为"仅 UEFI"，不静默失败
- 需要外部依赖时给的是可执行指令（`brew install wimlib` / `apt install wimlib-tools`），不是一句"失败了"

### 5.3 `darwin-native` —— macOS 三级策略
按挂载后的**实际内容**判定，不猜文件名：

| 顺序 | 模式 | 适用 | 为什么这样选 |
|---|---|---|---|
| A | `createinstallmedia` | 镜像内含 `Install macOS *.app` | 调用该 app **自带**的 createinstallmedia。这个程序随每个版本由 Apple 更新，10.8 → 27 全部覆盖，布局差异由 Apple 自己处理 |
| B | `asr restore` | 老式 `BaseSystem.dmg` / `InstallESD.dmg` | Apple 官方整卷恢复，10.10–10.12 的经典路径，之后补 `Packages` + `bless` |
| C | `raw` | 已是成品启动盘映像 | 自带 GPT + HFS/APFS，逐字节写入即可 |

进度解析：createinstallmedia 的输出被映射成 `Erasing(2–14%) → Copying(14–92%) → Making bootable(93–99%)` 三段，用户看到的不是一句"正在写入"。

---

## 6. 版本兼容矩阵

### macOS
| 范围 | 支持方式 | 说明 |
|---|---|---|
| 10.10 – 10.12 | `asr` + `Packages` | InstallESD 布局 |
| 10.13 – 10.15 | `createinstallmedia` | BaseSystem + APFS 转换 |
| 11 – 15 | `createinstallmedia` | 原生 |
| 26 / 27（最新） | `createinstallmedia` | 版本无关设计：只要安装器里还有那个可执行文件就成立；若 Apple 调整布局，降级到 `raw` 仍可用 |

**客户端本身**跑在老 macOS 上：前端产物按 `target: chrome76` 降级编译，因此同一份 JS/CSS 可运行在 Electron 6 → 33 整个区间。发布时出两个通道：
- `Diter.dmg`（当前 Electron，macOS 10.15+，体积小、性能好）
- `Diter-legacy.dmg`（锁定最后一个支持 10.10–10.14 的 Electron 大版本；具体版本号在构建前用官方 release notes 核对，因为 Electron 的 minOS 会随版本上调）

### Windows
| 范围 | 支持方式 |
|---|---|
| Windows 7 | 枚举回退 `wmic`（PowerShell 2 无 `Get-Disk`）；目标盘 FAT32 + `bootsect` |
| Windows 8 / 8.1 | `Get-Disk`（PS 3+） |
| Windows 10 / 11 | 完整流程，含 `install.wim` 自动拆分 |
| ARM64 | 输出 arm64 安装包，写入 x64/arm64 镜像均不受限 |

目标镜像侧：Win7 到 Win11（含 Server）均按"文件级安装盘"处理，识别 build 号映射到版本名。

### Linux
无特殊要求：`/sys/block` 有就得。分发 AppImage（免装）+ deb。写入不需要任何额外依赖，`sfdisk`/`mkfs.vfat` 在标准发行版中已存在。

---

## 7. 权限模型

写原始磁盘必须 root/Administrator。

**v0.1（当前实现）**：应用启动时不提权，正常浏览与识别；点"开始写入"时若未提权，弹窗引导 `osascript ... with administrator privileges`（macOS）/ `pkexec`（Linux）/ `Start-Process -Verb RunAs`（Windows）重启自身，镜像路径随参数带入。一次提权，后续所有子进程继承权限，进度流不中断。

**生产版（推荐改造）**：macOS 用 `SMJobBless` 装一个常驻 privileged helper，通过 XPC 通信；Windows 用服务 + 命名管道。好处是主进程不需要 root，攻击面更小，也不会出现"应用以 root 运行时 UI 异常"的老问题。

---

## 8. 技术栈选型

| 方案 | 优点 | 为什么不选 |
|---|---|---|
| **Electron + Node**（已选） | 写盘本质是系统调用编排，Node 的 `fs`/`child_process` 最直接；Etcher 同路线已在大规模生产验证 | 体积 ~120 MB |
| Tauri + Rust | 体积小、内存安全 | 需 Rust 工具链与逐平台交叉编译；老 macOS 上 WKWebView 版本过旧，反而更难兼容 10.10–10.14 |
| 各平台原生三份代码 | 性能与体验最好 | 三倍工程量，且 macOS 老 SDK 与新系统要分别维护 |

选 Electron 的关键理由：**这份代码里 90% 的复杂度是"跟三个操作系统的磁盘子系统打交道"，不是 UI**。Node 恰好是这类胶水活最短的路径，而前端用 Chrome 76 目标编译后，反而让老系统兼容变成了一个构建配置问题。

---

## 9. 目录结构

```
diter/
├── electron/
│   ├── main.js                  主进程 + IPC
│   ├── preload.js               contextBridge（不暴露 Node）
│   └── core/
│       ├── detect.js            镜像语义识别（ISO9660/HFS/APFS/GPT）
│       ├── safety.js            唯一安全判决者 + assertWritable
│       ├── writer.js            编排器
│       ├── elevation.js         提权
│       ├── devices/             darwin / win32 / linux 事实探测
│       └── engines/             raw / darwin / windows-media / linux
├── src/renderer/                React 界面
├── test/safety.test.js          安全层单测（10 条）
├── build/bundle.mjs             esbuild 打包 + 单文件预览生成
└── docs/ARCHITECTURE.md         本文
```

---

## 10. 已知边界与下一步

**当前边界（诚实清单）**
- macOS 目标盘只能在 macOS 上制作（Apple 引导链的硬限制；其他宿主仅支持"整盘映像"试验性写入）
- Legacy BIOS 启动 Windows 盘：Windows 宿主完整支持；macOS/Linux 宿主需要 `ms-sys`，否则仅 UEFI
- `wimlib` 需外部安装（未打进安装包）
- 未做 Windows 侧的卷锁定（`FSCTL_LOCK_VOLUME`），写入前用 `diskpart` 卸载，极端情况下可能被系统占用

**下一步**
1. 打包 `wimlib` + `ms-sys` 静态二进制进 `assets/bin/{darwin,win32,linux}`，去掉外部依赖
2. macOS 改 `SMJobBless` 助手；Windows 加卷锁定
3. 校验支持 xxHash3（6 GB 盘从 40 秒降到 3 秒）
4. 直接下载官方镜像（Windows Media Creation Tool 的 ISO 直链、Apple 的 InstallAssistant）
5. 写入历史与设备健康度（累计写入量、坏块预警）
