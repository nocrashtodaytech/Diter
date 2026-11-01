=============================================
 Diter · Windows 运行库说明 / Runtime Notes
=============================================

【中文】
如果双击 Diter.exe 时弹出类似下面的提示：

  "由于找不到 VCRUNTIME140_1.dll，无法继续执行代码"
  "由于找不到 MSVCP140.dll，无法继续执行代码"
  "The program can't start because VCRUNTIME140_1.dll is missing"

说明你的 Windows 缺少 Microsoft Visual C++ 2015-2022 运行库
（Diter 基于 Electron 构建，依赖该运行库；精简版 / 旧版 / 未更新的
Windows 上很常见）。

解决方法（任选其一）：
  1. 双击本目录下的 vc_redist.x64.exe，按提示安装，完成后重启 Diter。
  2. 或到微软官网下载安装最新版：
     https://aka.ms/vs/17/release/vc_redist.x64.exe

安装后无需重启电脑，重新打开 Diter 即可。

【English】
If Diter.exe fails to start with an error like:

  "The program can't start because VCRUNTIME140_1.dll is missing"
  "The code execution cannot proceed because MSVCP140.dll was not found"

your Windows is missing the Microsoft Visual C++ 2015-2022 Redistributable
(required by Electron-based apps; common on trimmed/older Windows builds).

To fix:
  1. Run vc_redist.x64.exe in this folder and follow the prompts.
  2. Or download the latest runtime from Microsoft:
     https://aka.ms/vs/17/release/vc_redist.x64.exe

Then relaunch Diter.
=============================================
