; electron-builder NSIS 自定义脚本
;
; 作用：安装时自动把 VC++ 2015-2022 运行库装上。
;
; 为什么必须做这一步：whisper 的推理内核（ctranslate2）需要
; System32\MSVCP140.dll 版本 >= 14.40。老一点的公司电脑（14.32 及以下）
; 会在转写时直接崩掉、而且不报任何错 —— 我们已经被这个坑咬过两台机器。
; 与其每台机器手工装，不如让安装包自己带走。

!macro customInit
  ; 升级前先把旧版装在安装目录里的 GPU 库搬到用户目录。
  ; customInit 在卸载旧版 / 覆盖文件之前执行，所以不会丢。
  StrCpy $R0 "$INSTDIR\resources\engine\python-embed\Lib\site-packages\nvidia"
  StrCpy $R1 "$LOCALAPPDATA\douyin-live-info\gpu-runtime\nvidia"
  IfFileExists "$R1\cublas\bin\cublas64_12.dll" zhongyi_gpu_skip
  IfFileExists "$R0\cublas\bin\cublas64_12.dll" 0 zhongyi_gpu_skip
  CreateDirectory "$LOCALAPPDATA\douyin-live-info\gpu-runtime"
  DetailPrint "正在保留旧版 GPU 运行库，升级后无需重新下载…"
  nsExec::ExecToLog '"$SYSDIR\robocopy.exe" "$R0" "$R1" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP'
  Pop $0
  Goto zhongyi_gpu_done
  zhongyi_gpu_skip:
  DetailPrint "GPU 运行库已存在或本机未安装，跳过迁移。"
  zhongyi_gpu_done:
!macroend

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
