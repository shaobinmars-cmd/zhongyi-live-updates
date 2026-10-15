# 弹幕库清理验证：注入一条 60 天前的旧消息，App 启动后应该被清掉
# 用法： python prune-test.py inject | check
import os
import sqlite3
import sys
import datetime

db = os.path.join(os.environ["APPDATA"], "douyin-live-info", "danmu.db")
mode = sys.argv[1] if len(sys.argv) > 1 else "check"
c = sqlite3.connect(db)
tabs = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'room_%'")]
target = None
for t in tabs:
    cols = [r[1] for r in c.execute(f"PRAGMA table_info([{t}])")]
    if "Time" in cols and c.execute(f"SELECT COUNT(*) FROM [{t}]").fetchone()[0] > 0:
        target = t
        break
if not target:
    print("没有可用的房间表")
    sys.exit(1)

utcnow = datetime.datetime.utcnow()
old = (utcnow - datetime.timedelta(days=60)).strftime("%Y-%m-%d %H:%M:%S")
if mode == "inject":
    c.execute(f"INSERT INTO [{target}] (Time, Type, UserName, Content) VALUES (?, ?, ?, ?)",
              (old, "Chat", "测试用户", "60天前的旧消息"))
    c.commit()
    print(f"已注入旧消息：{target}  Time={old}")

cutoff = (utcnow - datetime.timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
row = c.execute(f"SELECT COUNT(*) FROM [{target}] WHERE Time < ?", (cutoff,)).fetchone()[0]
print(f"{target} 里 30 天前的行数 = {row}  → {'✅ 已清理' if row == 0 else '❌ 还在'}")
print("库大小(MB) =", round(os.path.getsize(db) / 1024 / 1024, 1))
