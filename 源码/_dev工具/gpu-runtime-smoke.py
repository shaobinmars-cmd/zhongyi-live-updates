"""GPU 运行库永久目录、旧目录迁移和 DLL 搜索路径专项测试。"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT.parent / "直播拆解引擎"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def touch(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"test")


with tempfile.TemporaryDirectory() as tmp:
    fake_runtime = Path(tmp) / "runtime"
    os.environ["DOUYIN_GPU_RUNTIME_DIR"] = str(fake_runtime)
    touch(fake_runtime / "nvidia" / "cublas" / "bin" / "cublas64_12.dll")
    touch(fake_runtime / "nvidia" / "cudnn" / "bin" / "cudnn64_9.dll")

    pg = load("prefetch_gpu_smoke", ENGINE / "scripts" / "prefetch_gpu.py")
    assert Path(pg.RUNTIME_ROOT).resolve() == fake_runtime.resolve()
    assert pg.ready(), "prefetch_gpu 没有识别永久目录中的 CUDA 库"
    print("[OK] GPU 永久目录可被识别")

    tr = load("transcript_smoke", ENGINE / "scripts" / "transcript.py")
    path_env = os.environ.get("PATH", "").lower()
    assert str(fake_runtime / "nvidia" / "cublas" / "bin").lower() in path_env
    assert str(fake_runtime / "nvidia" / "cudnn" / "bin").lower() in path_env
    print("[OK] 转写进程会加载永久目录中的 cublas/cudnn")

    legacy_site = Path(tmp) / "legacy" / "site-packages"
    touch(legacy_site / "nvidia" / "cublas" / "bin" / "cublas64_12.dll")
    touch(legacy_site / "nvidia" / "cudnn" / "bin" / "cudnn64_9.dll")
    migrated = Path(tmp) / "migrated"
    pg.RUNTIME_ROOT = str(migrated)
    pg.RUNTIME_NVIDIA = str(migrated / "nvidia")
    old_path = list(sys.path)
    try:
        sys.path.append(str(legacy_site))
        assert pg.migrate_legacy(), "旧 GPU 目录没有迁移到永久目录"
        assert (migrated / "nvidia" / "cublas" / "bin" / "cublas64_12.dll").exists()
        print("[OK] 旧版 site-packages\\nvidia 可自动迁移")
    finally:
        sys.path[:] = old_path

print("GPU RUNTIME PERSISTENCE OK")
