# -*- coding: utf-8 -*-
r"""老板端：拉取私有仓库里的运营数据，合并成本地汇总 + 日报。
用法：python 汇总数据.py
配置：%APPDATA%\douyin-live-info\sync.json（同上，operator 可写“老板”）
主读 GitCode（国内），GitHub 旧仓作为补充（老运营未升级时数据不丢）。
输出：H:\直播运营汇总\汇总_YYYY-MM-DD.json 和 日报_YYYY-MM-DD.md
"""
import base64
import json
import os
import ssl
import urllib.request
import urllib.parse
from datetime import datetime

HOME = os.environ.get("APPDATA", os.path.expanduser("~"))
CFG = os.path.join(HOME, "douyin-live-info", "sync.json")
OUT = r"H:\直播运营汇总"

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


def cfg():
    with open(CFG, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def api_gitcode(url, token):
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(url + sep + "access_token=" + urllib.parse.quote(token),
                                 headers={"User-Agent": "zhongyi-sync"})
    with _open(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def api_github(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"token {token}", "User-Agent": "zhongyi-sync", "Accept": "application/vnd.github+json"})
    with _open(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def pull(owner, repo, token, provider):
    """返回 [(文件名, 内容dict)]；失败返回空列表"""
    out = []
    try:
        if provider == "gitcode":
            base = f"https://api.gitcode.com/api/v5/repos/{owner}/{repo}/contents/data"
            files = api_gitcode(base, token)
            for f in files:
                if not f["name"].endswith(".json"):
                    continue
                # GitCode 列表项的 url 不带文件名，按 name 自拼
                raw = api_gitcode(base + "/" + urllib.parse.quote(f["name"]), token)
                out.append((f["name"], json.loads(base64.b64decode(raw["content"]).decode("utf-8"))))
        else:
            base = f"https://api.github.com/repos/{owner}/{repo}/contents/data"
            files = api_github(base, token)
            for f in files:
                if not f["name"].endswith(".json"):
                    continue
                raw = api_github(f["url"], token)
                out.append((f["name"], json.loads(base64.b64decode(raw["content"]).decode("utf-8"))))
    except Exception as ex:
        print(f"[{provider}] 拉取失败：{ex}")
    return out


def main():
    c = cfg()
    token = c["token"]
    owner = c.get("owner") or DEFAULT_OWNER
    repo = c.get("repo") or DEFAULT_REPO
    today = datetime.now().strftime("%Y-%m-%d")
    os.makedirs(OUT, exist_ok=True)

    # 主：GitCode 国内仓；备：GitHub 旧仓（老运营还没升级时的数据也捞回来）
    merged = pull(owner, repo, token, "gitcode")
    gh_token = c.get("githubToken") or ""
    gh_owner = c.get("githubOwner") or "shaobinmars-cmd"
    gh_repo = c.get("githubRepo") or "zhongyi-data"
    if gh_token:
        seen = {n for n, _ in merged}
        for n, d in pull(gh_owner, gh_repo, gh_token, "github"):
            if n not in seen:
                merged.append((n, d))

    ops = [d for _, d in merged]
    out = {"date": today, "operators": ops}
    with open(os.path.join(OUT, f"汇总_{today}.json"), "w", encoding="utf-8") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
    lines = [f"# 运营数据日报 {today}", ""]
    for op in ops:
        t = op.get("tables", {})
        lines.append(f"## {op.get('operator')}（{op.get('date')}）")
        for name in ("主播学籍", "培训计划", "孵化反馈", "场次记录", "运营日报"):
            lines.append(f"- {name}：{len(t.get(name, []))} 条")
        lines.append("")
    with open(os.path.join(OUT, f"日报_{today}.md"), "w", encoding="utf-8") as fp:
        fp.write("\n".join(lines))
    print(f"已汇总 {len(ops)} 个运营 → {OUT}")


if __name__ == "__main__":
    main()
