# 众艺传媒 · 直播运营中控台 —— 项目总览（2026-10-15 整理）

> 这份文件是"接手这个项目"的第一入口：项目是什么、东西放在哪、怎么改、怎么发版、哪些不能碰。
> 每次发版后请顺手更新第 7 节的版本记录。

---

## 1. 这个项目是什么

两条线合成一个软件，装在每个运营自己的电脑上：

| 线 | 干什么 | 在哪 |
|---|---|---|
| **A. 直播运营中控台（App）** | 盯直播间（弹幕/礼物/在线）、自动录制 mp4、下播后一键拆解、双场对比、AI 出复盘报告 | `douyin-live-info/`（Electron + Vue3） |
| **B. 拆解引擎（Python）** | 视频 → 镜头索引 → 抽帧网格图 → 语音转写 → 生成《拆解素材包.md》 | `D:\直播拆解工具\`（打包时塞进 App 的 resources/engine） |

一张图记住数据流：

```
弹幕：抖音直播间页(隐身窗口) ─CDP旁听─> 解析 ─> danmu.db（+ 录制时写 .meta.json）
录制：直播间拉流地址 ─ffmpeg─> 输出目录\主播_时间戳_000.mp4（30 分钟一段，断流自动重连）
拆解：录像 ─引擎─> work_场次\拆解素材包.md（+ 网格图/转写/分段统计）
      App 再把该场次的弹幕礼物并进「第七节」，超预算自动分片
AI  ：素材包/分片 ─DeepSeek(每个运营自己的 key)─> AI分析报告.md
```

---

## 2. 目录地图（哪些能动、哪些不能动）

| 路径 | 是什么 | 能动吗 |
|---|---|---|
| `H:\...\直播间拆解项目github\douyin-live-info\` | App 源码（主仓库） | ✅ 在这改代码 |
| ├ `src\` | 界面（Vue3 + Pinia，一页一个 view、一页一个 store） | ✅ |
| ├ `electron\` | 主进程：`ipc-handlers.ts`（通道）+ `services\`（业务逻辑） | ✅ |
| ├ `release\` | 打包产物：**只留最新版**安装包 + `win-unpacked`（本机测试用） | ⚠️ 旧包定期清 |
| ├ `build\` | 图标、installer.nsh（安装时自动装 VC 运行库）、vc_redist | ✅ 少动 |
| ├ `tools\` | 授权签发、环境自检等脚本；**`tools\授权密钥\私钥.pem` 是命根子** | 🚫 私钥永不外发 |
| `D:\直播拆解工具\` | 引擎源码 + python-embed + ffmpeg（打包时被复制进 App） | ✅ 引擎逻辑在这改 |
| ├ `录像\` | 老工具录的素材（**33.7GB**，属于用户数据） | 🚫 别删 |
| `H:\直播运营中控台\` | 指向 `douyin-live-info` 的短路径（快捷方式） | 保留 |
| `C:\Users\Administrator\Desktop\众艺传媒-直播运营中控台\` | **发给运营的转发夹**：只放最新安装包+便携版+说明+VC运行库 | ✅ 发版时更新 |
| `_调试脚本\` | 本机测试脚本（e2e、批量合段验证、db-stats 等） | ✅ 复用 |
| `_版本快照\` | 每版源码快照 zip（没装 git 之前的手工版本管理） | ✅ 每版加一个 |
| `_文档\` | 方案、说明、手册、问题清单 | ✅ |

**运营电脑上的位置**：程序 `%LOCALAPPDATA%\Programs\douyin-live-info`；
数据（配置/授权/弹幕库/日志）`%APPDATA%\douyin-live-info\`（固定死，改软件名也不会搬家）。

---

## 3. 关键文件速查（改功能先看这几处）

| 想改什么 | 去哪儿 |
|---|---|
| 录制（分段/重连/看门狗/ffmpeg 定位） | `electron\services\stream-recorder.ts` |
| 磁盘清理、剩余空间保护 | `electron\services\disk-guard.ts` |
| 弹幕采集（隐身窗口+CDP） | `electron\services\danmu-capture.ts` → `danmu.ts` → `database.ts` |
| 弹幕并进素材包（第七节） | `electron\services\danmu-into-packet.ts` |
| 拆解调用/合并分段/批量队列 | `electron\services\teardown.ts`、`teardown-queue.ts` |
| 素材包分片（不超上下文） | `electron\services\packet-split.ts` |
| 双场对比 | `electron\services\comparison.ts` |
| AI 分析（DeepSeek） | `electron\services\ai-analyze.ts` |
| 授权 | `electron\services\license.ts` + `tools\一键签发授权.bat` |
| 所有前后端通道 | `electron\ipc-handlers.ts` + `electron\preload.ts`（新模块要同时登记） |
| 引擎（索引/抽帧/转写） | `D:\直播拆解工具\scripts\index.py / frames.py / transcript.py` |

---

## 4. 发版标准流程（一次做全，别来回折腾）

```powershell
# 0) 先改源码 + 改 package.json 版本号（如 2.4.8）
# 1) 构建打包（约 90 秒；最后退出码 1 是已知现象，看产物在不在）
$env:PATH = "D:\APP\手机对接\.tools\node-v22.23.3-win-x64;" + $env:PATH
cmd /c "cd /d H:\360MoveData\Users\Administrator\Documents\ChatGPT\直播间拆解项目github\douyin-live-info && npm run electron:build"

# 2) 自测（必须）：干净 PATH + 全流程
#    node "_调试脚本\fresh-e2e.mjs" 9460   （模拟全新电脑：激活→默认格式→AI→录制→拆解）

# 3) 同步到桌面转发夹（旧包不进转发夹，直接删）
#    只放：Setup 2.4.x.exe、2.4.x-Portable.exe、使用说明、VC运行库

# 4) 更新说明文档（桌面「直播中控台使用说明」.md/.txt 一起改）

# 5) 本机静默安装验证
Start-Process "<Setup.exe>" -ArgumentList "/S" -Wait

# 6) 源码快照
tar -a -c -f "_版本快照\App源码_2.4.x.zip" --exclude=node_modules --exclude=release -C douyin-live-info src electron public package.json electron-builder.yml
```

---

## 5. 授权与密钥（只有老板能做）

- **私钥**：`douyin-live-info\tools\授权密钥\私钥.pem` —— 唯一的签发权，**不进安装包、不发人、不提交到任何地方**。
- 签发：运营打开软件 → 激活页显示机器码 → 发给你 → 运行 `tools\一键签发授权.bat` 生成 `授权_名字_机器码.json` → 发回去粘贴激活。
- 立即停用某人：把他的机器码写进"吊销名单"（共享盘 txt 或网址），运营端启动时会去读一次。
- AI：每个运营一把 DeepSeek key，在设置页"管理员发的配置串"里一键填好；老板可在 DeepSeek 后台看每个人的用量。

---

## 6. 本机常用命令

| 用途 | 命令 |
|---|---|
| 构建前端+主进程 | `npm run build`（在 douyin-live-info 下） |
| 打包安装包/便携版 | `npm run electron:build` |
| 跑完整链路测试 | `node "_调试脚本\fresh-e2e.mjs" <调试端口>` |
| 验证批量合段 | `node "_调试脚本\batch-merge-test.mjs" <调试端口>` |
| 看弹幕库体量 | `& "D:\直播拆解工具\python-embed\python.exe" "_调试脚本\db-stats.py"` |
| 环境自检（运营电脑） | 转发夹里的 `环境自检.bat`，或 App 设置页"环境自检" |
| 日志 | `%APPDATA%\douyin-live-info\logs\app_日期.log`（UTC 时间，比本地早 8 小时） |

---

## 7. 版本记录（新版本往下加）

| 版本 | 日期 | 关键变化 |
|---|---|---|
| 2.3.x | 10-14 | 首次把 douyin-live-info 与拆解引擎合并；授权、弹幕、录制成型 |
| 2.4.x | 10-14~15 | 弹幕并入素材包；双场对比；AI 分析；素材包分片；界面重做 |
| **2.4.7** | **10-15** | 修运营机 0B 录制（ffmpeg 定位）、AI 保存报错（IPC 克隆）、默认录制改 mp4、VC 运行库自带、GPU 自动回退 |
| 2.4.8（待定） | — | 待修：批量拆解漏合并分段、无口播场次转写崩、磁盘清理误删范围（见 `_文档\代码梳理与问题清单_2026-10-15.md`） |

---

## 8. 铁律（每次动手前读一遍）

1. **不要动用户的录像和弹幕库**；测试产生的文件，测完自己清理干净。
2. **私钥不出本机**；授权 json 只发给对应的人。
3. **改完必须自测**（干净 PATH + 空配置模拟新电脑），没验证不要说"好了"。
4. **一次改全**：同类问题一起查、一起改、一起发版，避免一版一版试。
5. **给运营的说明要中文、要简单**：她们不看术语，只看"双击哪个、点哪里"。
6. 引擎是独立进程：App 与引擎之间靠"命令行 + work 目录文件"约定，改一侧要确认另一侧。
