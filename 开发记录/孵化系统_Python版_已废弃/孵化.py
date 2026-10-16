# -*- coding: utf-8 -*-
"""
孵化系统（独立模块，供「直播拆解工具」挂载为第 ③ 个页签）

设计原则：
1. 只用标准库（自带 Python 无需装任何依赖），numpy 可选；
2. 数据落在 APP 目录下的 运营 子目录里（升级不覆盖）；
3. 表格用 CSV（utf-8-sig，Excel 双击能开），导出 Excel 用自带的最小 XLSX 写出器；
4. 运营考核全部从数据表自动算，不靠印象打分。

主程序接入只需要一行：
    from 孵化 import add_tab
    add_tab(nb, self)      # nb 是 ttk.Notebook，self 是 App（可用 .log/.set_status）
"""
from __future__ import annotations

import csv
import os
import re
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("FH_DATA_DIR") or (MODULE_DIR / "运营"))

# ---------------------------------------------------------------- 表结构
TABLES = {
    "资产库": ["编号", "类型", "内容", "来源场次", "时间戳", "证据等级", "复用次数", "适用主播", "状态", "提交人", "维护人"],
    "主播学籍": ["主播", "路径", "起点_连说3分钟", "起点_有开场收尾", "起点_独立开播", "当前等级", "更新时间"],
    "每周数字": ["周次", "主播", "最长空档秒", "每10分钟事件数", "点名次数", "口令道具次数", "收尾完成", "录入人", "录入时间"],
    "课表": ["日期", "主播", "资产编号", "今天练什么", "怎么练", "验收", "打卡", "录入人"],
    "案例库": ["案例名", "日期", "赛道", "证明了什么", "不能证明什么", "证据等级", "提交人"],
    "变更日志": ["日期", "谁", "改了什么", "为什么", "影响谁"],
    "运营日报": ["日期", "运营", "主播", "开播前检查", "最长空档秒", "每10分钟事件数", "点名次数", "口令道具次数", "收尾完成", "提交时间"],
    "运营抽查": ["日期", "运营", "主播", "指标", "运营值", "复核值", "误差百分比", "是否合格", "复核人"],
    "周复盘": ["周次", "运营", "主持", "回放片段数", "资产更新数", "课表产出", "提交时间"],
    "运营考核": ["月份", "运营", "日报按时率", "数字准确率", "主播进步率", "课表完成率", "资产贡献", "复盘按时率", "出师率", "总分", "等级", "计算时间"],
}

# 五个数字的目标（下单游戏赛道基准）
TARGETS = {"最长空档秒": ("<=", 2.0), "每10分钟事件数": (">=", 1.0), "点名次数": (">=", 15.0),
           "口令道具次数": (">=", 10.0), "收尾完成": ("==", 1.0)}

# 运营考核权重（合计 100）
WEIGHTS = {"日报按时率": 20, "数字准确率": 20, "主播进步率": 20, "课表完成率": 15,
           "资产贡献": 10, "复盘按时率": 10, "出师率": 5}


def grade(total: float) -> str:
    if total >= 90:
        return "S"
    if total >= 80:
        return "A"
    if total >= 70:
        return "B"
    if total >= 60:
        return "C"
    return "D"


# ---------------------------------------------------------------- 基础读写
def ensure_files(verbose: bool = False) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name, cols in TABLES.items():
        f = DATA_DIR / (name + ".csv")
        if not f.exists():
            with f.open("w", encoding="utf-8-sig", newline="") as fp:
                csv.writer(fp).writerow(cols)
            if verbose:
                print("建表:", f)
    return DATA_DIR


def table_path(name: str) -> Path:
    return DATA_DIR / (name + ".csv")


def read_table(name: str) -> list:
    f = table_path(name)
    if not f.exists():
        return []
    with f.open("r", encoding="utf-8-sig", newline="") as fp:
        return list(csv.DictReader(fp))


def append_row(name: str, row: dict) -> None:
    ensure_files()
    cols = TABLES[name]
    with table_path(name).open("a", encoding="utf-8-sig", newline="") as fp:
        csv.writer(fp).writerow([row.get(c, "") for c in cols])


def rewrite_table(name: str, rows: list) -> None:
    cols = TABLES[name]
    with table_path(name).open("w", encoding="utf-8-sig", newline="") as fp:
        w = csv.writer(fp)
        w.writerow(cols)
        for r in rows:
            w.writerow([r.get(c, "") for c in cols])


def _f(v, default=0.0) -> float:
    try:
        s = str(v).strip()
        if s == "":
            return default
        return float(s)
    except Exception:
        return default


# ---------------------------------------------------------------- 运营考核（全自动）
def compute_operator_score(month: str | None = None) -> list:
    """按月份计算每个运营的执行结果评分卡。全部来自数据表，无人工打分。"""
    ensure_files()
    month = month or datetime.now().strftime("%Y-%m")

    def in_month(s: str) -> bool:
        return str(s).strip().startswith(month)

    daily = read_table("运营日报")
    spot = read_table("运营抽查")
    weekly = read_table("每周数字")
    sched = read_table("课表")
    assets = read_table("资产库")
    review = read_table("周复盘")
    students = read_table("主播学籍")

    ops = set()
    for r in daily + spot + sched + review + assets:
        for k in ("运营", "录入人", "提交人", "维护人"):
            v = str(r.get(k, "")).strip()
            # 只把看起来像人名的短字段计入（排除"教研/系统"等）
            if v and v not in ("教研", "系统", "-", "—") and len(v) <= 12:
                ops.add(v)
    if not ops:
        ops = {str(r.get("运营", "")).strip() for r in daily if r.get("运营")}
        ops.discard("")

    out = []
    for op in sorted(o for o in ops if o):
        # 1 日报按时率：本月日报条数 / 本月应报场次（按该运营录入的课表天数估算）
        days = {str(r.get("日期", "")).strip() for r in sched if str(r.get("录入人", "")).strip() == op and in_month(r.get("日期"))}
        need = max(len(days), 0)
        got = len([r for r in daily if str(r.get("运营", "")).strip() == op and in_month(r.get("日期"))])
        rate_daily = 100.0 if need == 0 else min(100.0, got / need * 100.0)

        # 2 数字准确率：抽查合格率（误差 ≤10% 记合格）
        rows = [r for r in spot if str(r.get("运营", "")).strip() == op and in_month(r.get("日期"))]
        rate_spot = 100.0 if not rows else 100.0 * len([r for r in rows if str(r.get("是否合格", "")).strip() in ("是", "合格", "Y", "yes", "1")]) / len(rows)

        # 3 主播进步率：名下主播最近一周五个数字的达标项占比
        mine = [s for s in students if str(s.get("带教运营", "")).strip() == op or str(s.get("录入人", "")).strip() == op]
        names = {str(s.get("主播", "")).strip() for s in mine} or {str(r.get("主播", "")).strip() for r in weekly if str(r.get("录入人", "")).strip() == op}
        hit = tot = 0
        for nm in names:
            ws = [r for r in weekly if str(r.get("主播", "")).strip() == nm]
            if not ws:
                continue
            last = ws[-1]
            for key, (opk, tgt) in TARGETS.items():
                v = _f(last.get(key), None if last.get(key) in ("", None) else 0.0)
                if last.get(key) in ("", None):
                    continue
                tot += 1
                if (opk == "<=" and v <= tgt) or (opk == ">=" and v >= tgt) or (opk == "==" and v == tgt):
                    hit += 1
        rate_progress = 100.0 if tot == 0 else hit / tot * 100.0

        # 4 课表完成率
        mine_sched = [r for r in sched if str(r.get("录入人", "")).strip() == op and in_month(r.get("日期"))]
        rate_sched = 100.0 if not mine_sched else 100.0 * len([r for r in mine_sched if str(r.get("打卡", "")).strip() in ("是", "√", "Y", "1", "已打卡")]) / len(mine_sched)

        # 5 资产贡献（本月提交的候选资产条数，10 条记满分）
        cnt_asset = len([r for r in assets if str(r.get("提交人", "")).strip() == op])
        score_asset = min(100.0, cnt_asset * 10.0)

        # 6 复盘按时率（本月周复盘记录数 / 4 周）
        cnt_review = len([r for r in review if str(r.get("运营", "")).strip() == op and in_month(r.get("周次"))])
        rate_review = min(100.0, cnt_review / 4.0 * 100.0)

        # 7 出师率（名下通过二级及以上的主播占比）
        if names:
            ok = 0
            for nm in names:
                lv = ""
                for s in students:
                    if str(s.get("主播", "")).strip() == nm:
                        lv = str(s.get("当前等级", "")).strip()
                if lv in ("二级", "三级", "L2", "L3"):
                    ok += 1
            rate_pass = ok / len(names) * 100.0
        else:
            rate_pass = 0.0

        parts = {"日报按时率": rate_daily, "数字准确率": rate_spot, "主播进步率": rate_progress,
                 "课表完成率": rate_sched, "资产贡献": score_asset, "复盘按时率": rate_review, "出师率": rate_pass}
        total = sum(parts[k] * WEIGHTS[k] for k in WEIGHTS) / sum(WEIGHTS.values())
        row = {"月份": month, "运营": op}
        row.update({k: round(v, 1) for k, v in parts.items()})
        row["总分"] = round(total, 1)
        row["等级"] = grade(total)
        row["计算时间"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        out.append(row)
    return out


def save_operator_score(month: str | None = None) -> list:
    rows = compute_operator_score(month)
    old = [r for r in read_table("运营考核") if r.get("月份") != (month or datetime.now().strftime("%Y-%m"))]
    rewrite_table("运营考核", old + rows)
    return rows


# ---------------------------------------------------------------- 最小 XLSX 写出器（零依赖）
def _xesc(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;").replace("'", "&apos;"))


def _col_name(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def write_xlsx(path, sheets) -> None:
    """sheets: [(表名, [[表头], [行]...]), ...]  只支持纯文本与数字。"""
    used = []
    for name, _ in sheets:
        nm = re.sub(r"[\[\]:*?/\\]", "_", str(name))[:31] or "Sheet"
        base, k = nm, 2
        while nm in used:
            nm = (base[:28] + "_" + str(k))[:31]
            k += 1
        used.append(nm)

    def sheet_xml(rows):
        body = []
        for r, row in enumerate(rows, start=1):
            cells = []
            for c, v in enumerate(row):
                ref = _col_name(c) + str(r)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    cells.append('<c r="%s"><v>%s</v></c>' % (ref, v))
                else:
                    cells.append('<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
                                 % (ref, _xesc("" if v is None else v)))
            body.append('<row r="%d">%s</row>' % (r, "".join(cells)))
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                + "".join(body) + "</sheetData></worksheet>")

    ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
          '<Default Extension="xml" ContentType="application/xml"/>',
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
    for i in range(len(sheets)):
        ct.append('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1))
    ct.append("</Types>")

    wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>']
    for i, nm in enumerate(used, start=1):
        wb.append('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (_xesc(nm), i, i))
    wb.append("</sheets></workbook>")

    rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    for i in range(len(sheets)):
        rels.append('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1))
    rels.append("</Relationships>")

    root = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>")

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "".join(ct))
        z.writestr("_rels/.rels", root)
        z.writestr("xl/workbook.xml", "".join(wb))
        z.writestr("xl/_rels/workbook.xml.rels", "".join(rels))
        for i, (nm, rows) in enumerate(sheets, start=1):
            z.writestr("xl/worksheets/sheet%d.xml" % i, sheet_xml(rows))


def export_all_xlsx(out_path=None) -> Path:
    ensure_files()
    out_path = Path(out_path) if out_path else (DATA_DIR / ("运营数据_%s.xlsx" % datetime.now().strftime("%Y%m%d_%H%M")))
    sheets = []
    for name in TABLES:
        rows = read_table(name)
        sheets.append((name, [TABLES[name]] + [[r.get(c, "") for c in TABLES[name]] for r in rows]))
    write_xlsx(out_path, sheets)
    return out_path


# ---------------------------------------------------------------- 报告模版与分层
TEMPLATE_FALLBACK = """<!-- L0 -->
# 主播执行卡（一页 A4）
- 赛道：{{赛道}}｜主播：{{主播}}｜日期：{{日期}}
- 必说句子：{{照读句}}
- 必做动作：{{动作}}
- 表情三档：{{表情}}
- 红线：{{红线}}
- 没人互动怎么办：{{预案}}
<!-- /L0 -->

<!-- L1 -->
# 运营工作台（带教用）
## 日报卡
- 开播前 5 项检查：设备 / 声音(BGM 不断且人声压过) / 菜单道具 / 主播读过卡 / 记录时间点
- 下播后 5 个数字：最长空档__秒｜每10分钟事件__｜点名__次｜口令+道具__次｜收尾 走完/没走完
## 周复盘（30 分钟五步）
读数字 → 看两段回放 → 更新资产矩阵 → 淘汰新增资产 → 排下周课表
## 本周课表
| 日期 | 资产编号 | 练什么 | 怎么练 | 验收 | 打卡 |
|---|---|---|---|---|---|
{{课表行}}
<!-- /L1 -->

<!-- L2 -->
# 运营报告（教研版）
## 报告一 · 主播执行卡
（见 L0 层）
## 报告二 · 运营报告
### 1 总体框架
{{框架表}}
### 2 可复制资产
{{资产表}}
### 3 30 天孵化清单
{{课表行}}
### 4 运营考核口径
{{考核口径}}
## 附 · 对标拆解证据
{{证据}}
<!-- /L2 -->
"""


def load_template() -> str:
    f = MODULE_DIR / "报告模版_v1.md"
    if f.exists():
        return f.read_text(encoding="utf-8")
    return TEMPLATE_FALLBACK


def slice_layers(md: str) -> dict:
    out = {"L0": "", "L1": "", "L2": "", "ALL": md}
    for key in ("L0", "L1", "L2"):
        m = re.search(r"<!--\s*%s\s*-->(.*?)<!--\s*/%s\s*-->" % (key, key), md, re.S)
        if m:
            out[key] = m.group(1).strip()
    return out


def export_layers(md: str, out_dir) -> list:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    layers = slice_layers(md)
    written = []
    for key, fname in (("L0", "① 主播执行卡_A4.md"), ("L1", "② 运营工作台.md"), ("L2", "③ 运营报告_教研版.md")):
        f = out_dir / fname
        f.write_text(layers[key] or "（本层为空）", encoding="utf-8")
        written.append(f)
    return written


def gen_report_skeleton(work_dir, extra=None) -> Path:
    """读 work 目录里的素材包，生成报告模版骨架（含 L0/L1/L2 三层标记）。"""
    work = Path(work_dir)
    packet = None
    for nm in ("拆解素材包.md", "素材包.md"):
        if (work / nm).exists():
            packet = (work / nm).read_text(encoding="utf-8", errors="ignore")
            break
    info = {"赛道": "（待填）", "主播": "（待填）", "日期": datetime.now().strftime("%Y-%m-%d"),
            "时长": "", "句数": "", "视频": ""}
    if packet:
        m = re.search(r"时长：([0-9.]+) 秒（([0-9.]+) 分钟）", packet)
        if m:
            info["时长"] = m.group(2) + " 分钟"
        m = re.search(r"句数：([0-9]+)", packet)
        if m:
            info["句数"] = m.group(1)
        m = re.search(r"视频文件：(.+)", packet)
        if m:
            info["视频"] = m.group(1).strip()
    if extra:
        info.update({k: v for k, v in extra.items() if v})

    md = load_template()
    for k, v in info.items():
        md = md.replace("{{%s}}" % k, str(v))
    md = md.replace("{{证据}}", "素材包：%s（时长 %s，句数 %s）" % (info["视频"] or "—", info["时长"] or "—", info["句数"] or "—"))
    out = work / "报告模版_v1_骨架.md"
    out.write_text(md, encoding="utf-8")
    return out


# ---------------------------------------------------------------- Tkinter 页签
def add_tab(nb, app=None):
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    ensure_files()

    frame = ttk.Frame(nb)
    nb.add(frame, text="③ 运营孵化")

    def log(msg):
        try:
            app.log(msg)          # 复用主程序日志
        except Exception:
            print(msg)

    top = ttk.LabelFrame(frame, text="数据（升级不覆盖）")
    top.pack(fill="x", padx=8, pady=6)
    ttk.Label(top, text=str(DATA_DIR)).pack(side="left", padx=6, pady=6)
    ttk.Button(top, text="打开数据目录", command=lambda: os.startfile(str(DATA_DIR)) if os.name == "nt" else None).pack(side="left", padx=4)

    mid = ttk.LabelFrame(frame, text="表格")
    mid.pack(fill="both", expand=True, padx=8, pady=6)

    var_table = tk.StringVar(value="资产库")
    bar = ttk.Frame(mid)
    bar.pack(fill="x", padx=6, pady=4)
    ttk.Label(bar, text="表：").pack(side="left")
    combo = ttk.Combobox(bar, textvariable=var_table, values=list(TABLES.keys()), state="readonly", width=14)
    combo.pack(side="left", padx=4)

    tv = ttk.Treeview(mid, show="headings", height=14)
    tv.pack(fill="both", expand=True, padx=6, pady=4)
    sb = ttk.Scrollbar(mid, orient="vertical", command=tv.yview)
    tv.configure(yscrollcommand=sb.set)

    def refresh(*_):
        rows = read_table(var_table.get())
        cols = TABLES[var_table.get()]
        tv.delete(*tv.get_children())
        tv["columns"] = cols
        for c in cols:
            tv.heading(c, text=c)
            tv.column(c, width=max(70, min(220, 12 * len(c) + 40)), anchor="w")
        for r in rows:
            tv.insert("", "end", values=[r.get(c, "") for c in cols])
        log("已刷新：%s（%d 行）" % (var_table.get(), len(rows)))

    combo.bind("<<ComboboxSelected>>", refresh)

    def add_row_dialog():
        cols = TABLES[var_table.get()]
        win = tk.Toplevel(frame)
        win.title("新增一行：" + var_table.get())
        ents = {}
        for i, c in enumerate(cols):
            ttk.Label(win, text=c).grid(row=i, column=0, sticky="e", padx=6, pady=3)
            e = ttk.Entry(win, width=46)
            e.grid(row=i, column=1, sticky="w", padx=6, pady=3)
            ents[c] = e
        def ok():
            row = {c: ents[c].get().strip() for c in cols}
            append_row(var_table.get(), row)
            refresh()
            win.destroy()
            log("已新增一行：" + var_table.get())
        ttk.Button(win, text="保存", command=ok).grid(row=len(cols), column=1, sticky="e", padx=6, pady=8)

    def open_report_skeleton():
        d = filedialog.askdirectory(title="选择该场次的 work 目录（含 拆解素材包.md）")
        if not d:
            return
        out = gen_report_skeleton(d)
        log("已生成报告骨架：" + str(out))
        messagebox.showinfo("完成", "已生成报告骨架：\n" + str(out))

    def export_layers_ui():
        f = filedialog.askopenfilename(title="选择报告 md（含 <!-- L0 --> 标记）", filetypes=[("Markdown", "*.md")])
        if not f:
            return
        d = filedialog.askdirectory(title="选择导出目录")
        if not d:
            return
        outs = export_layers(Path(f).read_text(encoding="utf-8"), d)
        messagebox.showinfo("完成", "已导出三层：\n" + "\n".join(str(x) for x in outs))

    def calc_score():
        month = datetime.now().strftime("%Y-%m")
        rows = save_operator_score(month)
        var_table.set("运营考核")
        refresh()
        if rows:
            msg = "\n".join("%s：总分 %.1f（%s）" % (r["运营"], r["总分"], r["等级"]) for r in rows)
        else:
            msg = "没有可计算的数据（先在 运营日报 / 课表 / 运营抽查 里录数据）"
        messagebox.showinfo("%s 运营执行考核" % month, msg)

    def export_xlsx_ui():
        p = export_all_xlsx()
        log("已导出 Excel：" + str(p))
        messagebox.showinfo("完成", "已导出：\n" + str(p))

    bot = ttk.Frame(frame)
    bot.pack(fill="x", padx=8, pady=8)
    ttk.Button(bot, text="刷新", command=refresh).pack(side="left", padx=4)
    ttk.Button(bot, text="新增一行", command=add_row_dialog).pack(side="left", padx=4)
    ttk.Button(bot, text="从素材包生成报告骨架", command=open_report_skeleton).pack(side="left", padx=4)
    ttk.Button(bot, text="导出报告三层", command=export_layers_ui).pack(side="left", padx=4)
    ttk.Button(bot, text="计算运营考核", command=calc_score).pack(side="left", padx=4)
    ttk.Button(bot, text="导出 Excel", command=export_xlsx_ui).pack(side="left", padx=4)

    refresh()
    return frame


# ---------------------------------------------------------------- CLI（便于批量与自检）
def main_cli(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    ensure_files(verbose=True)
    if not argv or argv[0] == "init":
        print("数据目录:", DATA_DIR)
        return 0
    if argv[0] == "score":
        month = argv[1] if len(argv) > 1 else None
        rows = save_operator_score(month)
        for r in rows:
            print(r)
        return 0
    if argv[0] == "xlsx":
        print(export_all_xlsx(argv[1] if len(argv) > 1 else None))
        return 0
    if argv[0] == "skeleton":
        print(gen_report_skeleton(argv[1]))
        return 0
    if argv[0] == "layers":
        print("\n".join(str(x) for x in export_layers(Path(argv[1]).read_text(encoding="utf-8"), argv[2])))
        return 0
    print("用法: 孵化.py [init|score [月份]|xlsx [输出路径]|skeleton <work目录>|layers <md> <导出目录>]")
    return 2


if __name__ == "__main__":
    raise SystemExit(main_cli())
