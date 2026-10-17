# -*- coding: utf-8 -*-
r"""老板端：拉取私有仓库里的运营数据，合并成本地汇总 + 日报。
用法：python 汇总数据.py
配置：%APPDATA%\douyin-live-info\sync.json（同上，operator 可写“老板”）
输出：H:\直播运营汇总\汇总_YYYY-MM-DD.json 和 日报_YYYY-MM-DD.md
"""
import json
import os
import urllib.request
from datetime import datetime

HOME = os.environ.get("APPDATA", os.path.expanduser("~"))
CFG = os.path.join(HOME, "douyin-live-info", "sync.json")
OUT = r"H:\直播运营汇总"


def cfg():
    with open(CFG, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def api(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"token {token}", "User-Agent": "zhongyi-sync", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    c = cfg()
    base = f"https://api.github.com/repos/{c['owner']}/{c['repo']}/contents/data"
    files = api(base, c["token"])
    today = datetime.now().strftime("%Y-%m-%d")
    os.makedirs(OUT, exist_ok=True)
    merged = []
    for f in files:
        if not f["name"].endswith(".json"):
            continue
        raw = api(f["url"], c["token"])
        content = __import__("base64").b64decode(raw["content"]).decode("utf-8")
        merged.append(json.loads(content))
    out = {"date": today, "operators": merged}
    with open(os.path.join(OUT, f"汇总_{today}.json"), "w", encoding="utf-8") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
    lines = [f"# 运营数据日报 {today}", ""]
    for op in merged:
        t = op.get("tables", {})
        lines.append(f"## {op.get('operator')}（{op.get('date')}）")
        for name in ("主播学籍", "培训计划", "孵化反馈", "场次记录", "运营日报"):
            lines.append(f"- {name}：{len(t.get(name, []))} 条")
        lines.append("")
    with open(os.path.join(OUT, f"日报_{today}.md"), "w", encoding="utf-8") as fp:
        fp.write("\n".join(lines))
    print(f"已汇总 {len(merged)} 个运营 → {OUT}")


if __name__ == "__main__":
    main()
