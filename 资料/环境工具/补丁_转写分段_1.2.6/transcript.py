#!/usr/bin/env python3
"""Get a timestamped transcript for a video -- the half of understanding that
frames cannot supply.

Grids show what is on screen; they never show what was SAID. On a 24-minute
episode the grid alone yields the arc (someone is accused, a gadget appears, a
shadow chases them) while every fact that matters -- what was stolen, the
gadget's name and rule, how it resolves -- lives entirely in the audio. Pair the
two or the read is a guess.

Sources, in priority order:

  elevenlabs  Scribe v2, word-level timestamps. Default, and the most accurate
              option for Thai. Needs ELEVENLABS_API_KEY.
  captions    Native subtitles pulled by yt-dlp. Free and instant, but only for
              URLs that publish them.
  whisper     Local faster-whisper. Free, offline, no key, slower and weaker on
              Thai.

Usage:
  python3 transcript.py VIDEO_OR_URL --out transcript.json
                        [--source auto|elevenlabs|captions|whisper] [--lang th]

Output JSON:
  {source, language, duration_s, segments:[{t_ms, end_ms, t_label, text}], words:[...]}
  prints the path on the last line as `TRANSCRIPT: <abs-path>`

Exit codes:
  0  transcript written
  1  bad args / missing input
  2  no usable source (no key, no captions, no whisper)
  3  the source ran but returned nothing

Requires: ffmpeg on PATH. Python stdlib only (yt-dlp / faster-whisper optional).
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path


# 如果给包里的 Python 装过 NVIDIA 的 CUDA 库（nvidia-cublas-cu12 / nvidia-cudnn-cu12），
# 这里把它们的 bin 目录加进 DLL 搜索路径。
# 不加这一步，即使装了库，ctranslate2 也找不到 cublas64_12.dll / cudnn，
# 选 GPU 就会在“开始推理”那一刻报 Library ... is not found。
def _add_nvidia_dll_dirs() -> None:
    import os
    for sp in list(sys.path):
        if not sp or not sp.endswith("site-packages"):
            continue
        root = os.path.join(sp, "nvidia")
        if not os.path.isdir(root):
            continue
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for name in names:
            d = os.path.join(root, name, "bin")
            if not os.path.isdir(d):
                continue
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            try:
                os.add_dll_directory(d)
            except Exception:
                pass


_add_nvidia_dll_dirs()

ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVENLABS_MODEL = "scribe_v2"

# 转写用哪个设备。包里的 ctranslate2 是带 CUDA 的构建，但 CUDA 的 cublas 并没有随包发（只带了 cudnn），
# 所以在装了 N 卡驱动的机器上 device="auto" 会去挑 CUDA，然后报 "Library cublas64_12.dll is not found"。
# 这里固定用 CPU；确有需要可以用环境变量 WHISPER_DEVICE 覆盖。
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")

# ElevenLabs speaks ISO 639-3; accept the 2-letter codes people actually type.
ISO3 = {"th": "tha", "en": "eng", "ja": "jpn", "zh": "zho", "ko": "kor",
        "es": "spa", "fr": "fra", "de": "deu", "id": "ind", "vi": "vie"}


def fmt_ts(ms: int) -> str:
    s, ms_r = divmod(int(ms), 1000)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}.{ms_r // 100}"
    return f"{m:02d}:{sec:02d}.{ms_r // 100}"


def load_env_file() -> None:
    """Walk up from cwd for a .env and load it WITHOUT overriding real env vars.

    Shell-exported keys must win: a stale .env silently shadowing the key the
    user just exported is a maddening failure to debug.
    """
    here = Path.cwd().resolve()
    for d in [here, *here.parents]:
        f = d / ".env"
        if not f.exists():
            continue
        try:
            for line in f.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        except OSError:
            pass
        return


def is_url(v: str) -> bool:
    return v.startswith("http://") or v.startswith("https://")


def extract_audio(video: str, dest: Path) -> bool:
    """Mono 16kHz m4a -- small enough to upload, plenty for ASR."""
    r = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", video,
         "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", str(dest)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return r.returncode == 0 and dest.exists() and dest.stat().st_size > 0


def multipart_post(url: str, headers: dict, fields: dict, file_path: Path) -> bytes:
    """Minimal multipart/form-data POST so this stays stdlib-only."""
    boundary = f"----vu{uuid.uuid4().hex}"
    pre = bytearray()
    for k, v in fields.items():
        pre += (f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n').encode()
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    pre += (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'
            f"Content-Type: {mime}\r\n\r\n").encode()
    body = bytes(pre) + file_path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=900) as resp:
        return resp.read()


def group_words(words: list[dict], max_gap_ms: int = 700,
                max_chars: int = 90) -> list[dict]:
    """Group word timings into readable lines.

    Splits on a real pause or on length. Thai has no spaces, so never join on
    whitespace -- concatenate and let the gap decide the boundary.
    """
    out: list[dict] = []
    cur: list[dict] = []

    def flush() -> None:
        if not cur:
            return
        text = "".join(w["text"] for w in cur).strip()
        if text:
            out.append({"t_ms": cur[0]["t_ms"], "end_ms": cur[-1]["end_ms"],
                        "t_label": fmt_ts(cur[0]["t_ms"]), "text": text})
        cur.clear()

    for w in words:
        if cur:
            gap = w["t_ms"] - cur[-1]["end_ms"]
            wide = sum(len(x["text"]) for x in cur) >= max_chars
            if gap > max_gap_ms or wide:
                flush()
        cur.append(w)
    flush()
    return out


def via_elevenlabs(audio: Path, lang: str | None) -> dict:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY not set")
    fields = {"model_id": ELEVENLABS_MODEL, "timestamps_granularity": "word"}
    code = ISO3.get(lang, lang) if lang else None
    if code:
        fields["language_code"] = code
    try:
        raw = multipart_post(ELEVENLABS_URL, {"xi-api-key": key}, fields, audio)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"ElevenLabs HTTP {e.code}: {detail}") from e
    data = json.loads(raw)

    words = []
    for w in data.get("words", []) or []:
        # `audio_event` entries are sounds like [laughter], not speech. Keeping
        # them corrupts both the text and the timing of real words.
        if w.get("type") == "audio_event":
            continue
        t = w.get("text", "")
        if not t:
            continue
        words.append({"text": t,
                      "t_ms": int(round(float(w.get("start", 0)) * 1000)),
                      "end_ms": int(round(float(w.get("end", 0)) * 1000))})
    return {"language": data.get("language_code") or lang,
            "words": words,
            "segments": group_words(words)}


def via_captions(url: str, lang: str | None) -> dict:
    """Native subtitles via yt-dlp. Free, but only when the platform has them."""
    if shutil.which("yt-dlp") is None:
        raise RuntimeError("yt-dlp not installed")
    tmp = Path(tempfile.mkdtemp(prefix="vu_subs_"))
    try:
        langs = lang or "th,en"
        r = subprocess.run(
            ["yt-dlp", "--skip-download", "--write-subs", "--write-auto-subs",
             "--sub-langs", langs, "--sub-format", "vtt/srt",
             "--convert-subs", "srt", "-o", str(tmp / "s.%(ext)s"),
             "--no-warnings", url],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        files = pick_caption(sorted(tmp.glob("*.srt")), langs.split(","))
        if not files:
            raise RuntimeError(f"no captions available: {(r.stderr or '')[-200:]}")
        got = files[0].name.split(".")[-2] if files[0].name.count(".") >= 2 else lang
        return {"language": got, "words": [],
                "segments": parse_srt(files[0].read_text(encoding="utf-8", errors="replace"))}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def pick_caption(files: list[Path], langs: list[str]) -> list[Path]:
    """Order caption files by the requested language priority.

    yt-dlp writes one `s.<lang>.srt` per track, and a plain sort puts `en`
    before `th` -- so a Thai video that also carries English subs used to be
    transcribed from the English track even though `th` was asked for first.
    """
    def rank(p: Path) -> int:
        tag = p.name.split(".")[-2] if p.name.count(".") >= 2 else ""
        for i, want in enumerate(langs):
            want = want.strip()
            if tag == want or tag.startswith(want + "-"):
                return i
        return len(langs)
    return sorted(files, key=rank)


def parse_srt(text: str) -> list[dict]:
    def to_ms(s: str) -> int:
        s = s.replace(",", ".").strip()
        h, m, rest = s.split(":")
        return int((int(h) * 3600 + int(m) * 60 + float(rest)) * 1000)

    segs: list[dict] = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if len(lines) < 2:
            continue
        stamp = next((ln for ln in lines if "-->" in ln), None)
        if not stamp:
            continue
        body = " ".join(lines[lines.index(stamp) + 1:]).strip()
        if not body:
            continue
        try:
            a, b = stamp.split("-->")
            t0, t1 = to_ms(a), to_ms(b)
        except (ValueError, IndexError):
            continue
        if segs and segs[-1]["text"] == body:  # auto-subs repeat rolling lines
            segs[-1]["end_ms"] = t1
            continue
        segs.append({"t_ms": t0, "end_ms": t1, "t_label": fmt_ts(t0), "text": body})
    return segs


def _avail_mem() -> str:
    """本机当前可用内存（给「内存不足」类报错当证据）"""
    try:
        import ctypes

        class _MS(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        m = _MS()
        m.dwLength = ctypes.sizeof(_MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return (f"可用物理内存 {m.ullAvailPhys / 1073741824:.1f}GB / 共 {m.ullTotalPhys / 1073741824:.1f}GB，"
                f"页面文件可用 {m.ullAvailPageFile / 1073741824:.1f}GB")
    except Exception:
        return ""


def _probe_duration(path: Path) -> float:
    """用 ffprobe 取时长（秒）；没 ffprobe 或取不到就返回 0（按“要分段”处理）"""
    exe = shutil.which("ffprobe")
    if not exe:
        return 0.0
    try:
        out = subprocess.run(
            [exe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=60)
        return float((out.stdout or "").strip() or 0.0)
    except Exception:
        return 0.0


def _iter_audio_chunks(path: Path, chunk_sec: int, sr: int = 16000):
    """用 ffmpeg 边解码边按 chunk_sec 秒切，逐段 yield float32 波形（单声道 16k）。

    为什么要自己切？faster-whisper 是**一次性**把整段音频算频谱的（feature_extractor
    里对整段数组做 rfft）：5 小时的音频单次要 5GB+ 内存，小机器直接 _ArrayMemoryError。
    分段后内存只占一段的量（10 分钟约 300MB），而且时间戳可以自己加偏移、仍然是整场的。
    """
    import numpy as np

    cmd = [shutil.which("ffmpeg") or "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
           "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(sr), "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            bufsize=1024 * 1024)
    per = chunk_sec * sr * 2          # 每段字节数（16bit 单声道 = 2 字节/采样）
    buf = bytearray()
    try:
        while True:
            data = proc.stdout.read(per - len(buf))
            if not data:
                break
            buf.extend(data)
            if len(buf) >= per:
                yield np.frombuffer(bytes(buf), dtype="<i2").astype("float32") / 32768.0
                buf = bytearray()
        if buf:
            yield np.frombuffer(bytes(buf), dtype="<i2").astype("float32") / 32768.0
    finally:
        try:
            proc.stdout.close()
        except Exception:
            pass
        try:
            proc.kill()
        except Exception:
            pass
        try:
            proc.wait(timeout=10)
        except Exception:
            pass


def via_whisper(audio: Path, lang: str | None) -> dict:
    """Local faster-whisper. Free and offline; weaker on Thai than Scribe."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "内置转写组件缺失（faster-whisper 未安装）。请重新解压完整的工具压缩包，"
            "不要只复制其中一部分文件。") from e
    except OSError as e:
        # 常见原因：本机缺少 VC++ 运行库（MSVCP140.dll），或杀毒软件拦截/隔离了
        # ctranslate2.dll。v1.2.5 起运行库已随包内置。
        raise RuntimeError(
            f"转写组件无法加载：{e}\n"
            "原因：本机缺少 VC++ 运行库，或杀毒软件把 ctranslate2.dll 拦截了。\n"
            "处理：①把工具文件夹加入杀毒软件白名单，再重新解压一次完整压缩包；"
            "②双击工具目录里的「检查环境.bat」，把自检结果截图发给我。") from e
    model_name = os.environ.get("WHISPER_MODEL", "base")
    # 转写用哪个设备：cpu（默认）/ cuda / auto。
    # 注意：包里的 ctranslate2 是带 CUDA 的构建，但 CUDA 的 cublas/cudnn 没有随包发，
    # 所以选了 GPU 而本机又没装 CUDA 运行库时，这里会自动回退到 CPU，不会像以前那样直接崩。
    want = (os.environ.get("WHISPER_DEVICE") or "cpu").strip().lower()
    if want not in ("cpu", "cuda", "auto"):
        want = "cpu"
    print(f"[whisper] 正在加载模型 {model_name}（设备：{want}，首次使用会自动下载）…",
          file=sys.stderr, flush=True)

    model = None
    used_dev = None
    last_err = None
    # 加载重试矩阵。除了「联网试一次 + 只用本地缓存再试」，还加了「把 CPU 线程降到 1」：
    # 小内存电脑上 mkl_malloc 分配失败，十有八九是线程太多、每个线程的临时缓冲加起来放不下；
    # 降成单线程基本都能过（慢一点，但比整场失败强）。
    plan = []
    for dev in ([want, "cpu"] if want != "cpu" else ["cpu"]):
        plan.append((dev, False, None))
        plan.append((dev, True, None))
        plan.append((dev, True, 1))
        plan.append((dev, False, 1))
    for dev, offline, threads in plan:
        try:
            if offline:
                os.environ["HF_HUB_OFFLINE"] = "1"
            else:
                os.environ.pop("HF_HUB_OFFLINE", None)
            kw = {"cpu_threads": threads} if threads else {}
            model = WhisperModel(model_name, device=dev, compute_type="int8", **kw)  # type: ignore
            used_dev = dev
            if threads == 1:
                print("[whisper] 已用单线程模式加载成功（省内存，速度略慢）。",
                      file=sys.stderr, flush=True)
            break
        except Exception as exc:
            last_err = exc
            if not offline:
                print(f"[whisper] {dev} 加载失败（{exc}），改用本地缓存重试…",
                      file=sys.stderr, flush=True)
            elif threads == 1:
                print("[whisper] 再试一次：把 CPU 线程降到 1（省内存，慢一些）…",
                      file=sys.stderr, flush=True)
    if model is not None and used_dev != want and want != "cpu":
        print("[whisper] GPU 用不了，已回退用 CPU 转写（结果一样，只是慢些）。",
              file=sys.stderr, flush=True)
        print("[whisper] 想真正用上 GPU：需要在这台电脑装 CUDA 运行库"
              "（cublas + cudnn，且显卡驱动要够新）。",
              file=sys.stderr, flush=True)
    if model is None:
        msg = str(last_err or "")
        mem = _avail_mem()
        mem_hint = ("mkl_malloc" in msg) or ("allocate memory" in msg) or ("内存" in msg)
        if mem_hint:
            raise RuntimeError(
                f"转写模型加载失败：内存不足（{msg}）。" + (f"{mem}\n" if mem else "\n") +
                "这台电脑当时的内存不够放下这个模型。处理：\n"
                "① 关掉浏览器 / 剪辑 / 录屏 / 微信等占内存的软件，再点一次；\n"
                "② 在「拆解」页把「转写模型」换成 tiny（最省内存，约 75MB）再跑一次；\n"
                "③ 想稳定用 small：这台电脑建议 8GB 以上内存（并在系统里保留页面文件）。")
        raise RuntimeError(
            f"转写模型加载失败：{msg}\n" + (f"{mem}\n" if mem else "") +
            "原因通常是：本机还没下载过这个语音模型，或者网络访问不了 hf-mirror.com。\n"
            "处理：连上网后点一次「下载/校验模型」；仍不行就双击「检查环境.bat」看自检结果。")
    print("[whisper] 模型就绪，开始转写…", file=sys.stderr, flush=True)

    # GPU 情况下，ctranslate2 是到「真正开始推理」时才去加载 cublas64_12.dll 的 ——
    # 所以「模型加载成功」不等于「GPU 能用」。这里先拿 1 秒静音试跑一次：
    # 有问题就在这一步暴露、就地回退 CPU，不至于跑到一半才失败。
    if used_dev and used_dev != "cpu":
        try:
            import numpy as _np
            _seg, _ = model.transcribe(_np.zeros(16000, dtype="float32"),
                                       language=lang, without_timestamps=True)
            for _ in _seg:      # 生成器是惰性的，必须真正取一次才会执行推理
                break
            print("[whisper] GPU 试跑通过，开始用显卡转写…", file=sys.stderr, flush=True)
        except Exception as _exc:
            print(f"[whisper] GPU 推理用不了（{_exc}），改用 CPU 重新加载并转写…",
                  file=sys.stderr, flush=True)
            model = WhisperModel(model_name, device="cpu", compute_type="int8")
    # 长音频必须分段（见 _iter_audio_chunks 的说明）：超过 20 分钟就按 10 分钟一段跑，
    # 时间戳加上段偏移，输出仍然是「整场」的时间。
    CHUNK_SEC = 600
    dur = 0.0 if is_url(str(audio)) else _probe_duration(audio)
    chunked = dur <= 0 or dur > 20 * 60
    if chunked:
        _mins = f"{dur / 60:.0f} 分钟" if dur > 0 else "时长未知"
        print(f"[whisper] 音频 {_mins}：按 {CHUNK_SEC // 60} 分钟分段转写（省内存，"
              "时间戳仍是整场的）…", file=sys.stderr, flush=True)

    def _run_transcribe(word_ts: bool):
        """跑一遍转写。word_ts=True 取词级时间戳（更细，但个别音频会对齐越界）。"""
        _t0 = time.time()
        _words: list[dict] = []
        _segs: list[dict] = []
        _info = None
        if not chunked:
            _segments, _info = model.transcribe(str(audio), language=lang, word_timestamps=word_ts)
            _total = float(getattr(_info, "duration", 0.0) or 0.0)
            _next = 5
            for _s in _segments:
                _text = (_s.text or "").strip()
                if _text:
                    _segs.append({"t_ms": int(_s.start * 1000), "end_ms": int(_s.end * 1000),
                                 "t_label": fmt_ts(int(_s.start * 1000)), "text": _text})
                for _w in (getattr(_s, "words", None) or []):
                    _words.append({"text": _w.word, "t_ms": int(_w.start * 1000),
                                   "end_ms": int(_w.end * 1000)})
                if _total > 0:
                    _pct = int(_s.end * 100 / _total)
                    if _pct >= _next:
                        _el = time.time() - _t0
                        _eta = (_total - _s.end) * (_el / max(_s.end, 0.001))
                        print(f"[whisper] 转写进度 {min(_pct, 100)}%　{fmt_ts(int(_s.end * 1000))} / "
                              f"{fmt_ts(int(_total * 1000))}　已用 {_el / 60:.1f} 分钟，"
                              f"预计还需 {max(_eta, 0) / 60:.1f} 分钟", file=sys.stderr, flush=True)
                        _next = min(100, _pct + 5)
            return _segs, _words, _info, _t0

        # 分段路径：一段一段喂，内存只占一段；时间戳加 _offset 变成整场时间
        _offset = 0.0
        for _chunk in _iter_audio_chunks(audio, CHUNK_SEC):
            _segments, _info = model.transcribe(_chunk, language=lang, word_timestamps=word_ts)
            for _s in _segments:
                _text = (_s.text or "").strip()
                if _text:
                    _segs.append({"t_ms": int((_offset + _s.start) * 1000),
                                 "end_ms": int((_offset + _s.end) * 1000),
                                 "t_label": fmt_ts(int((_offset + _s.start) * 1000)),
                                 "text": _text})
                for _w in (getattr(_s, "words", None) or []):
                    _words.append({"text": _w.word,
                                   "t_ms": int((_offset + _w.start) * 1000),
                                   "end_ms": int((_offset + _w.end) * 1000)})
            _offset += len(_chunk) / 16000.0
            _el = time.time() - _t0
            if dur > 0:
                _eta = (dur - _offset) * (_el / max(_offset, 0.001))
                print(f"[whisper] 转写进度 {min(int(_offset * 100 / dur), 100)}%　"
                      f"{fmt_ts(int(_offset * 1000))} / {fmt_ts(int(dur * 1000))}　"
                      f"已用 {_el / 60:.1f} 分钟，预计还需 {max(_eta, 0) / 60:.1f} 分钟",
                      file=sys.stderr, flush=True)
            else:
                print(f"[whisper] 已转写 {_offset / 60:.1f} 分钟（用时 {_el / 60:.1f} 分钟）",
                      file=sys.stderr, flush=True)
        return _segs, _words, _info, _t0

    # 词级时间戳遇到「这一段没有词」（纯音乐 / 长时间静音）时，faster-whisper 的
    # 对齐会直接抛 IndexError，整场就白跑了。这里失败就自动退回句级时间戳重跑一次。
    try:
        segs, words, info, t0 = _run_transcribe(True)
    except Exception as _exc:
        print(f"[whisper] 词级时间戳转写失败（{_exc}），改用句级时间戳重跑…",
              file=sys.stderr, flush=True)
        segs, words, info, t0 = _run_transcribe(False)
    print(f"[whisper] 转写完成：{len(segs)} 句，用时 {(time.time() - t0) / 60:.1f} 分钟",
          file=sys.stderr, flush=True)
    return {"language": getattr(info, "language", lang), "words": words,
            "segments": segs}


def main() -> None:
    ap = argparse.ArgumentParser(description="Timestamped transcript for a video.")
    ap.add_argument("video", help="Local path or URL")
    ap.add_argument("--out", required=True)
    ap.add_argument("--source", default="auto",
                    choices=["auto", "elevenlabs", "captions", "whisper"])
    ap.add_argument("--lang", default=None, help="e.g. th, en (auto-detect if unset)")
    args = ap.parse_args()

    load_env_file()
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found on PATH.")

    src, video = args.source, args.video
    local = not is_url(video)
    if local and not Path(video).expanduser().exists():
        sys.exit(f"no such file: {video}")

    order = ([src] if src != "auto"
             else (["captions", "elevenlabs", "whisper"] if not local
                   else ["elevenlabs", "whisper"]))

    tmp = Path(tempfile.mkdtemp(prefix="vu_audio_"))
    audio: Path | None = None
    result: dict | None = None
    errors: list[str] = []

    try:
        for cand in order:
            try:
                if cand == "captions":
                    if local:
                        raise RuntimeError("captions only apply to URLs")
                    result = via_captions(video, args.lang)
                else:
                    if audio is None:
                        if not local:
                            raise RuntimeError(
                                "download the video first, then pass the local path")
                        audio = tmp / "a.m4a"
                        if not extract_audio(str(Path(video).expanduser()), audio):
                            raise RuntimeError("audio extraction failed")
                    result = (via_elevenlabs(audio, args.lang) if cand == "elevenlabs"
                              else via_whisper(audio, args.lang))
                if result and result.get("segments"):
                    result["source"] = cand
                    break
                errors.append(f"{cand}: returned nothing")
                result = None
            except (RuntimeError, OSError, ValueError, json.JSONDecodeError) as e:
                errors.append(f"{cand}: {e}")
                print(f"[transcript] {cand} failed: {e}", file=sys.stderr)
                result = None

        if not result:
            for line in errors:
                print(f"  - {line}", file=sys.stderr)
            sys.exit(2 if not errors else 3)

        segs = result["segments"]
        payload = {
            "video": video if not local else str(Path(video).expanduser().resolve()),
            "source": result["source"],
            "language": result.get("language"),
            "duration_s": round(segs[-1]["end_ms"] / 1000, 2) if segs else 0,
            "segment_count": len(segs),
            "segments": segs,
            "words": result.get("words", []),
        }
        out = Path(args.out).expanduser()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[transcript] {result['source']}: {len(segs)} segments", file=sys.stderr)
        print(f"TRANSCRIPT: {out.resolve()}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
