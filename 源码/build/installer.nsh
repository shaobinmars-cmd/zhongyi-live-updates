; electron-builder NSIS 自定义脚本
;
; 作用：安装时自动把 VC++ 2015-2022 运行库装上。
;
; 为什么必须做这一步：whisper 的推理内核（ctranslate2）需要
; System32\MSVCP140.dll 版本 >= 14.40。老一点的公司电脑（14.32 及以下）
; 会在转写时直接崩掉、而且不报任何错 —— 我们已经被这个坑咬过两台机器。
; 与其每台机器手工装，不如让安装包自己带走。

!macro customInstall
  IfFileExists "$INSTDIR\resources\vc_redist.x64.exe" 0 vcskip
    DetailPrint "正在检查 / 安装 VC++ 运行库…"
    ; /install /quiet /norestart：已装或版本更新时会自己跳过，不会重复装
    ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $0
    DetailPrint "VC++ 运行库安装返回码：$0"
    Goto vcdone
  vcskip:
    DetailPrint "未找到 vc_redist.x64.exe，跳过（如果转写报错，请手动安装 VC++ 运行库）"
  vcdone:
!macroend
