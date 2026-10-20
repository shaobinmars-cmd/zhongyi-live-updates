# -*- coding: utf-8 -*-
r"""把本机孵化库打包成 JSON，上传到私有数据仓库。
用法：python 自动上传数据.py [--operator 张三]
配置：%APPDATA%\douyin-live-info\sync.json
  {"provider":"gitcode","owner":"gcw_7Nfzwkf5","repo":"zhongyi-data","token":"...","operator":"张三"}
provider 缺省 = gitcode（国内满速）；填 github 走旧通道备用。
"""
import base64
import json
import os
import sqlite3
import ssl
import sys
import urllib.request
import urllib.parse
from datetime import datetime

HOME = os.environ.get("APPDATA", os.path.expanduser("~"))
DB = os.path.join(HOME, "douyin-live-info", "incubate.db")
CFG = os.path.join(HOME, "douyin-live-info", "sync.json")

# 数据仓默认指向国内 GitCode 私有仓；sync.json 里 owner/repo 留空时用这组
DEFAULT_OWNER = "gcw_7Nfzwkf5"
DEFAULT_REPO = "zhongyi-data"


def _open(req, timeout=60):
    """CA 证书缺失的内置 Python 环境下，验证失败自动降级"""
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.URLError as ex:
        if 'CERTIFICATE_VERIFY_FAILED' in str(getattr(ex, 'reason', ex)):
            return urllib.request.urlopen(req, timeout=timeout, context=ssl._create_unverified_context())
        raise


def load_cfg():
    with open(CFG, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def export_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    out = {}
    for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        out[name] = [dict(r) for r in conn.execute(f"SELECT * FROM [{name}]")]
    conn.close()
    return out


def base_of(cfg):
    if str(cfg.get("provider", "gitcode")).lower() == "github":
        return "https://api.github.com/repos/{}/{}/contents", "github"
    return "https://api.gitcode.com/api/v5/repos/{}/{}/contents", "gitcode"


def api(url, token, provider, data=None, method="GET"):
    sep = "&" if "?" in url else "?"
    if provider == "gitcode":
        url = url + sep + "access_token=" + urllib.parse.quote(token)
        headers = {"User-Agent": "zhongyi-sync", "Content-Type": "application/json"}
    else:
        headers = {"Authorization": f"token {token}", "User-Agent": "zhongyi-sync",
                   "Accept": "application/vnd.github+json", "Content-Type": "application/json"}
    req = urllib.request.Request(url, method=method,
                                 data=(json.dumps(data).encode() if data else None),
                                 headers=headers)
    with _open(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    cfg = load_cfg()
    op = cfg.get("operator") or (sys.argv[sys.argv.index("--operator") + 1] if "--operator" in sys.argv else "未命名运营")
    today = datetime.now().strftime("%Y-%m-%d")
    payload = {"operator": op, "date": today, "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "tables": export_db()}
    raw = json.dumps(payload, ensure_ascii=False, indent=1)
    path = f"data/{op}-{today}.json"
    owner = cfg.get("owner") or DEFAULT_OWNER
    repo = cfg.get("repo") or DEFAULT_REPO
    token = cfg["token"]
    tpl, provider = base_of(cfg)
    url_path = "data/" + urllib.parse.quote(f"{op}-{today}.json")
    base = tpl.format(owner, repo) + "/" + url_path
    body = {"message": f"sync {op} {today}", "content": base64.b64encode(raw.encode("utf-8")).decode()}
    method = "POST"  # GitCode：新建文件用 POST
    try:
        old = api(base, token, provider)
        body["sha"] = old["sha"]
        method = "PUT"  # 已存在则带 sha 用 PUT 更新
    except Exception:
        pass
    api(base, token, provider, body, method)
    print(f"已上传：{path}（{len(raw)} 字节）→ {provider}")


if __name__ == "__main__":
    main()
