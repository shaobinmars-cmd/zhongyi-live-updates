# -*- coding: utf-8 -*-
r"""把本机孵化库打包成 JSON，上传到私有数据仓库。
用法：python 自动上传数据.py [--operator 张三]
配置：%APPDATA%\douyin-live-info\sync.json
  {"owner":"shaobinmars-cmd","repo":"zhongyi-data","token":"ghp_...","operator":"张三"}
"""
import base64
import json
import os
import sqlite3
import sys
import urllib.request
import urllib.parse
from datetime import datetime

HOME = os.environ.get("APPDATA", os.path.expanduser("~"))
DB = os.path.join(HOME, "douyin-live-info", "incubate.db")
CFG = os.path.join(HOME, "douyin-live-info", "sync.json")


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


def api(url, token, data=None, method="GET"):
    req = urllib.request.Request(url, method=method,
                                 data=(json.dumps(data).encode() if data else None),
                                 headers={"Authorization": f"token {token}",
                                          "User-Agent": "zhongyi-sync",
                                          "Accept": "application/vnd.github+json",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    cfg = load_cfg()
    op = cfg.get("operator") or (sys.argv[sys.argv.index("--operator") + 1] if "--operator" in sys.argv else "未命名运营")
    today = datetime.now().strftime("%Y-%m-%d")
    payload = {"operator": op, "date": today, "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "tables": export_db()}
    raw = json.dumps(payload, ensure_ascii=False, indent=1)
    path = f"data/{op}-{today}.json"
    owner, repo, token = cfg["owner"], cfg["repo"], cfg["token"]
    url_path = "data/" + urllib.parse.quote(f"{op}-{today}.json")
    base = f"https://api.github.com/repos/{owner}/{repo}/contents/{url_path}"
    body = {"message": f"sync {op} {today}", "content": base64.b64encode(raw.encode("utf-8")).decode()}
    try:
        old = api(base, token)
        body["sha"] = old["sha"]
    except Exception:
        pass
    api(base, token, body, "PUT")
    print(f"已上传：{path}（{len(raw)} 字节）")


if __name__ == "__main__":
    main()
