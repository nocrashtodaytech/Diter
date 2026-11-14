; Diter — Windows 安装包脚本（NSIS / makensis）
; 用户级安装（$LOCALAPPDATA\Programs\Diter），无需管理员权限；
; Diter 运行时通过按需提权（UAC）执行写盘操作。

!define APP_NAME "Diter"
!define APP_VERSION "2.0.2"
!define APP_EXE "Diter.exe"
!define APP_PUBLISHER "nocrashtodaytech"
!define SRC_DIR "/tmp/diter-win"
!define ICON_FILE "/Users/ryan/Documents/GitHub/Diter/assets/icon.ico"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "/tmp/Diter-${APP_VERSION}-win-x64-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Diter"
InstallDirRegKey HKCU "Software\Diter" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

Icon "${ICON_FILE}"
UninstallIcon "${ICON_FILE}"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${SRC_DIR}\*.*"

  ; 卸载器
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; 快捷方式
  CreateShortcut "$DESKTOP\Diter.lnk" "$INSTDIR\${APP_EXE}"
  CreateDirectory "$SMPROGRAMS\Diter"
  CreateShortcut "$SMPROGRAMS\Diter\Diter.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\Diter\Uninstall Diter.lnk" "$INSTDIR\uninstall.exe"

  ; 注册表：安装信息 + 卸载项
  WriteRegStr HKCU "Software\Diter" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Diter" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Diter" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Diter" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Diter" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Diter" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Diter" "DisplayIcon" "$INSTDIR\${APP_EXE}"

  ; 静默安装 VC++ 运行库（Electron 依赖，缺 DLL 时自动补上）
  IfFileExists "$INSTDIR\vc_redist.x64.exe" 0 +2
    ExecWait '"$INSTDIR\vc_redist.x64.exe" /install /quiet /norestart'
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Diter.lnk"
  RMDir /r "$SMPROGRAMS\Diter"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Diter"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Diter"
SectionEnd
