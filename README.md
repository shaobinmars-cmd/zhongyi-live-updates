# 众艺传媒运营工具

> 当前版本：**2.9.30**（长期基线与对照标签仍为 `baseline-2.9.9`）
> 项目根目录：`H:\众艺传媒运营工具`

众艺传媒自用的直播运营工作台，覆盖直播监看、录制、弹幕与礼物记录、视频拆解、AI 复盘、双场对比、主播孵化和运营数据汇总。

## 先读这几份

1. [项目基线与迭代入口](./项目基线与迭代入口.md)：完整架构、功能、路径、测试和发版规则。
2. [GLOSSARY.md](./GLOSSARY.md)：统一运营、拆解、素材包、孵化等术语。
3. [迭代日志.md](./迭代日志.md)：每次改动都从这里继续记录。
4. [docs/adr](./docs/adr)：会影响后续架构的关键决定。
5. [协作方式与语言习惯.md](./协作方式与语言习惯.md)：给后续 AI 或接手同事看的协作说明。

## 目录

| 目录 | 用途 |
|---|---|
| `源码` | Electron App，开发和打包入口 |
| `直播拆解引擎` | Python、ffmpeg、转写与拆解脚本，独立 Git 仓库 |
| `安装包` | 指向 `源码\release`，放最新安装版和便携版 |
| `资料` | 运营说明、验收说明、截图 |
| `开发记录` | 历史设计、调试脚本和旧资料 |
| `tools` | GitHub 数据上传、汇总和报表脚本 |

运行时数据不在项目目录里，固定存放在 `%APPDATA%\douyin-live-info`。

## 快速检查

```powershell
# 引擎自检
& "H:\众艺传媒运营工具\直播拆解引擎\python-embed\python.exe" -c "import sys, ctranslate2; print(sys.version); print(ctranslate2.__version__)"

# App 数据层自测
cmd /c "cd /d H:\众艺传媒运营工具\源码 && set ELECTRON_NO_ASAR=1 && node_modules\electron\dist\electron.exe _dev工具\incubate-smoke.js"
```

构建、打包和完整验收命令见 [项目基线与迭代入口.md](./项目基线与迭代入口.md)。

## 下载与更新

> 当前正式版本：**2.9.30**。安装包在 `安装包` 目录，线上稳定入口始终取最新版本。

- 稳定下载页：<https://github.com/shaobinmars-cmd/zhongyi-live-updates/releases/latest>
- 2.9.30 安装版（国内首选）：<https://ghfast.top/https://github.com/shaobinmars-cmd/zhongyi-live-updates/releases/download/v2.9.30/zhongyi-setup-2.9.30.exe>
- 备用通道 1：<https://ghproxy.net/https://github.com/shaobinmars-cmd/zhongyi-live-updates/releases/download/v2.9.30/zhongyi-setup-2.9.30.exe>
- 备用通道 2：<https://gh-proxy.com/https://github.com/shaobinmars-cmd/zhongyi-live-updates/releases/download/v2.9.30/zhongyi-setup-2.9.30.exe>
- 官方原链接：<https://github.com/shaobinmars-cmd/zhongyi-live-updates/releases/download/v2.9.30/zhongyi-setup-2.9.30.exe>
- 便携版国内首选：<https://ghfast.top/https://github.com/shaobinmars-cmd/zhongyi-live-updates/releases/download/v2.9.30/zhongyi-portable-2.9.30.exe>
- 国内更新清单（首选）：<https://ghfast.top/https://raw.githubusercontent.com/shaobinmars-cmd/zhongyi-live-updates/main/latest.json>
- 更新清单备用 1：<https://ghproxy.net/https://raw.githubusercontent.com/shaobinmars-cmd/zhongyi-live-updates/main/latest.json>
- 更新清单备用 2：<https://gh-proxy.com/https://raw.githubusercontent.com/shaobinmars-cmd/zhongyi-live-updates/main/latest.json>

## 安全铁律

- 授权私钥：`源码\tools\授权密钥\私钥.pem`，永不外发、永不打包、永不提交。
- GitHub Token、AI Key、授权文件和用户数据不得写进源码、文档示例或截图。
- 不改、不删运营的录像、弹幕库、孵化库和授权文件。
- 没有完成构建、测试和打包版实测，不发布版本。
