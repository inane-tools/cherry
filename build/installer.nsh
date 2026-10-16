!include nsDialogs.nsh
!include LogicLib.nsh

; Keep electron-builder's installation/update/uninstall engine. Only replace
; the initial wizard pages: this page is never shown for silent updates.
!define MUI_BGCOLOR "111116"
!define MUI_TEXTCOLOR "F4F4F5"
!define MUI_FINISHPAGE_TITLE "Cherry is ready"
!define MUI_FINISHPAGE_TEXT "You're all set. Open Cherry and sign in to YouTube Music."
!define MUI_HEADER_TRANSPARENT_TEXT

!macro customInstallMode
  ; Install for the current user without a separate scope-selection page.
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
Var CherryDestination
Var CherryHeadingFont
Var CherryBodyFont
Var CherryDestinationField
Var CherryDialog

!macro customWelcomePage
  Page custom CherryInstallPage CherryInstallLeave

Function CherryInstallPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Install Cherry" "A desktop home for YouTube Music."
  nsDialogs::Create 1044
  Pop $CherryDialog
  ${If} $CherryDialog == error
    Abort
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1256
  ShowWindow $0 ${SW_HIDE}
  SetCtlColors $HWNDPARENT 0xF4F4F5 0x111116
  SetCtlColors $CherryDialog 0xF4F4F5 0x111116
  ; Full-body page, rather than a wizard header above a second content panel.
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1039
  ShowWindow $0 ${SW_HIDE}
  CreateFont $CherryHeadingFont "Segoe UI" 20 600
  CreateFont $CherryBodyFont "Segoe UI" 10 400

  InitPluginsDir
  File /oname=$PLUGINSDIR\cherry.ico "${PROJECT_DIR}\electron\assets\icon.ico"
  ${NSD_CreateIcon} 16u 20u 38u 38u ""
  Pop $0
  ${NSD_SetIcon} $0 "$PLUGINSDIR\cherry.ico" $1
  ${NSD_CreateLabel} 64u 21u 230u 28u "Cherry"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $CherryHeadingFont 1
  SetCtlColors $0 0xF4F4F5 0x111116
  ${NSD_CreateLabel} 65u 50u 230u 14u "${VERSION}  /  inane.tools"
  Pop $0
  SetCtlColors $0 0xA1A1AA 0x111116

  ${NSD_CreateLabel} 16u 87u 280u 26u "Your music, in its own space."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $CherryBodyFont 1
  SetCtlColors $0 0xF4F4F5 0x111116
  ${NSD_CreateLabel} 16u 125u 280u 12u "Install location"
  Pop $0
  SetCtlColors $0 0xA1A1AA 0x111116
  ${NSD_CreateDirRequest} 16u 141u 220u 14u "$INSTDIR"
  Pop $CherryDestinationField
  ${NSD_CreateBrowseButton} 242u 140u 60u 16u "Browse..."
  Pop $0
  ${NSD_OnClick} $0 CherryBrowse
  ${NSD_CreateLabel} 16u 172u 280u 25u "Installs for your Windows account. Your music and settings stay on this device."
  Pop $0
  SetCtlColors $0 0xA1A1AA 0x111116

  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Install"
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

Function CherryBrowse
  nsDialogs::SelectFolderDialog "Choose where to install Cherry" "$INSTDIR"
  Pop $CherryDestination
  ${If} $CherryDestination != error
    ${NSD_SetText} $CherryDestinationField $CherryDestination
  ${EndIf}
FunctionEnd

Function CherryInstallLeave
  ${NSD_GetText} $CherryDestinationField $CherryDestination
  ${If} $CherryDestination == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "Choose an install location."
    Abort
  ${EndIf}
  ; NSIS's directory page normally validates this; keep that guard on our page.
  GetFullPathName $0 "$CherryDestination"
  ${GetRoot} "$0" $1
  ${If} $0 == "$1\"
  ${OrIf} $0 == "$1"
    MessageBox MB_OK|MB_ICONEXCLAMATION "Choose a folder for Cherry, rather than a drive root."
    Abort
  ${EndIf}
  ${GetFileName} "$0" $2
  ${If} $2 != "cherry"
    StrCpy $0 "$0\Cherry"
  ${EndIf}
  StrCpy $INSTDIR $0
FunctionEnd
!macroend

!macro customFinishPage
  Page custom CherryFinishPage CherryFinishLeave

Function CherryFinishPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  nsDialogs::Create 1044
  Pop $CherryDialog
  ${If} $CherryDialog == error
    Abort
  ${EndIf}
  SetCtlColors $CherryDialog 0xF4F4F5 0x111116
  ${NSD_CreateIcon} 16u 20u 38u 38u ""
  Pop $0
  ${NSD_SetIcon} $0 "$PLUGINSDIR\cherry.ico" $1
  ${NSD_CreateLabel} 64u 21u 230u 28u "Cherry is ready"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $CherryHeadingFont 1
  SetCtlColors $0 0xF4F4F5 0x111116
  ${NSD_CreateLabel} 16u 87u 280u 38u "Open Cherry and sign in to YouTube Music to get started."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $CherryBodyFont 1
  SetCtlColors $0 0xA1A1AA 0x111116
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Open Cherry"
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  nsDialogs::Show
FunctionEnd

Function CherryFinishLeave
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
FunctionEnd
!macroend
!endif
