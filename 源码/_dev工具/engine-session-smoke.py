#!/usr/bin/env python3
"""验证新版一场直播一个文件夹中的多个 MP4 能按文件名顺序合并。"""
from __future__ import annotations

import importlib.util
import os
import pathlib
import sys

session_dir = pathlib.Path(sys.argv[1]).resolve()
engine_root = pathlib.Path(os.environ["ZY_ENGINE_ROOT"]).resolve()
spec = importlib.util.spec_from_file_location("zy_engine", engine_root / "直播拆解工具.py")
if spec is None or spec.loader is None:
    raise RuntimeError("无法加载拆解引擎")

engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

clips = engine.find_clips(session_dir)
expected = [
    "测试主播_20261019150000_000.mp4",
    "测试主播_20261019150000_001.mp4",
]
if [p.name for p in clips] != expected:
    raise AssertionError(f"分段顺序错误：{[p.name for p in clips]}")

merged = engine.merge_clips(clips, session_dir / "merged.mp4", lambda _line: None)
if merged is None or not merged.exists() or merged.stat().st_size <= 1024:
    raise AssertionError("分段合并失败")

info = engine.probe(merged)
if info["duration"] < 1.7:
    raise AssertionError(f"合并后时长异常：{info}")
print("SESSION_DIRECTORY_MERGE_OK", round(info["duration"], 2), merged.stat().st_size)
