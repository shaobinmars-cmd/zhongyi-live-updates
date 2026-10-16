# 看一眼弹幕库的真实体量：多少行、什么类型最多、时间范围
# 用法：$env:PYTHONUTF8="1"; & "D:\直播拆解工具\python-embed\python.exe" db-stats.py
import os
import sqlite3
from datetime import datetime

db = os.path.join(os.environ["APPDATA"], "douyin-live-info", "danmu.db")
c = sqlite3.connect(db)
tabs = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print("表数量:", len(tabs))
print("现在本地时间:", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
total = 0
for t in tabs:
    if not t.startswith("room_"):
        continue
    cols = [r[1] for r in c.execute(f"PRAGMA table_info([{t}])")]
    if "Time" not in cols or "Type" not in cols:
        print(f"\n{t}: 缺列（测试表？）cols={cols}")
        continue
    n = c.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0]
    total += n
    if n == 0:
        continue
    mn, mx = c.execute(f"SELECT MIN(Time), MAX(Time) FROM [{t}]").fetchone()
    types = ", ".join(f"{ty}={cnt}" for ty, cnt in
                      c.execute(f"SELECT Type, COUNT(*) FROM [{t}] GROUP BY Type ORDER BY 2 DESC"))
    print(f"\n{t}: {n} 行")
    print(f"   库里时间(UTC): {mn} -> {mx}")
    print(f"   类型: {types}")
print("\n总行数:", total)
print("文件大小(MB):", round(os.path.getsize(db) / 1024 / 1024, 1))
