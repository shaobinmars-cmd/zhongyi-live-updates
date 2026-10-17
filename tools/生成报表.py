# -*- coding: utf-8 -*-
"""老板端：拉取私有库里的运营数据，自动生成日报/周报/月报/季报/年报。
用法：python 生成报表.py
配置：%APPDATA%\douyin-live-info\sync.json（owner/repo/token/operator）
输出：H:\直播运营汇总\日报_日期.md、周报_日期.md、月报_年月.md、季报_年Qn.md、年报_年.md
"""
import base64
import json
import os
import urllib.request
from collections import Counter
from datetime import datetime, timedelta

HOME = os.environ.get("APPDATA", os.path.expanduser("~"))
CFG = os.path.join(HOME, "douyin-live-info", "sync.json")
OUT = r"H:\直播运营汇总"


def api(url, token):
    req = urllib.request.Request(url, headers={
        "Authorization": f"token {token}", "User-Agent": "zhongyi-sync",
        "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def load_ops(c):
    files = api(f"https://api.github.com/repos/{c['owner']}/{c['repo']}/contents/data", c["token"])
    ops = []
    for f in files:
        if not f["name"].endswith(".json"):
            continue
        raw = api(f["url"], c["token"])
        ops.append(json.loads(base64.b64decode(raw["content"]).decode("utf-8")))
    return ops


def day(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def collect(ops, table, start, end):
    rows = []
    for op in ops:
        for r in op.get("tables", {}).get(table, []):
            d = day(r.get("日期") or r.get("更新时间") or r.get("录入时间"))
            if d and start <= d <= end:
                rr = dict(r)
                rr["_运营"] = op.get("operator", "")
                rows.append(rr)
    return rows


def write(name, lines):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("已生成", p)


def build(ops, label, start, end, name):
    fb = collect(ops, "孵化反馈", start, end)
    roster = collect(ops, "主播学籍", datetime(2000, 1, 1).date(), end)
    sess = collect(ops, "场次记录", start, end)
    done = Counter(str(r.get("完成情况", "")).strip() for r in fb)
    total = len(fb)
    rate = round((done.get("完成", 0) + done.get("部分完成", 0)) / total * 100, 1) if total else 0
    streamers = {str(r.get("主播", "")).strip() for r in fb if r.get("主播")}
    reported = {str(r.get("主播", "")).strip() for r in fb if r.get("主播")}
    missing = []
    for r in roster:
        n = str(r.get("主播", "")).strip()
        if not n or n in reported:
            continue
        if r.get("离司日期"):
            continue
        missing.append(n)
    issues = Counter(str(r.get("问题", "")).strip() for r in fb if str(r.get("问题", "")).strip())
    by_op = Counter(str(r.get("_运营", "")).strip() for r in fb)
    by_actor = Counter(str(r.get("主播", "")).strip() for r in fb if r.get("主播"))

    L = [f"# {label}（{start} ~ {end}）", ""]
    L += ["## 一、总览", "",
          f"- 反馈总数：{total} 条",
          f"- 完成 / 部分完成 / 未完成：{done.get('完成', 0)} / {done.get('部分完成', 0)} / {done.get('未完成', 0)}",
          f"- 提交率（完成+部分）：{rate}%",
          f"- 涉及主播：{len(streamers)} 人；场次记录：{len(sess)} 条", ""]
    L += ["## 二、按运营", ""]
    for op, n in by_op.most_common():
        L.append(f"- {op or '未署名'}：{n} 条")
    L += ["", "## 三、按主播（反馈最多）", ""]
    for n, c in by_actor.most_common(10):
        L.append(f"- {n}：{c} 条")
    L += ["", "## 四、未反馈主播", ""]
    L.append("- " + ("、".join(missing[:30]) if missing else "无（全部有反馈）"))
    L += ["", "## 五、问题 TOP", ""]
    for q, c in issues.most_common(10):
        L.append(f"- {q}（{c} 次）")
    L.append("")
    write(name, L)


def main():
    with open(CFG, "r", encoding="utf-8-sig") as f:
        c = json.load(f)
    ops = load_ops(c)
    today = datetime.now().date()

    build(ops, "运营数据日报", today, today, f"日报_{today}.md")
    build(ops, "运营数据周报", today - timedelta(days=6), today, f"周报_{today}.md")
    build(ops, "运营数据月报", today.replace(day=1), today, f"月报_{today.strftime('%Y-%m')}.md")
    q = (today.month - 1) // 3 * 3 + 1
    build(ops, f"运营数据季报 Q{(q - 1) // 3 + 1}", today.replace(month=q, day=1), today, f"季报_{today.year}Q{(q - 1) // 3 + 1}.md")
    build(ops, "运营数据年报", today.replace(month=1, day=1), today, f"年报_{today.year}.md")
    print(f"完成：{len(ops)} 个运营的数据")


if __name__ == "__main__":
    main()
