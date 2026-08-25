#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_report.py — 渲染论文学习日报
输入：
  summaries.json   键为 arxiv id，值为 {title_en, title_zh, core, methods, applications, url, authors, published}
  selected_ids.txt 每行一个入选 arxiv id（按期望顺序）
输出：daily_paper_YYYY-MM-DD.md
"""
import json
import os
import re
from datetime import datetime


def load_selected_ids(path: str = "selected_ids.txt") -> list:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def load_summaries(path: str = "summaries.json") -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def md_escape(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def render(selected: list, summaries: dict) -> str:
    today = datetime.now().strftime("%Y-%m-%d")
    lines = [f"# 每日论文学习 · {today}", ""]

    if not selected:
        lines.append("> 今日无入选论文。")
        lines.append("")
        return "\n".join(lines)

    lines.append(f"> 本期精选 **{len(selected)}** 篇 arXiv 论文（LLM / 智能体 / 世界模型 / 对齐方向）。")
    lines.append("")

    for i, pid in enumerate(selected, 1):
        s = summaries.get(pid, {})
        title_en = md_escape(s.get("title_en", "")) or pid
        title_zh = md_escape(s.get("title_zh", "")) or "（待补中文译名）"
        core = md_escape(s.get("core", "（待补一句话核心贡献）"))
        methods = md_escape(s.get("methods", "（待补方法亮点）"))
        applications = md_escape(s.get("applications", "（待补潜在应用意义）"))
        authors = md_escape(", ".join(s.get("authors", [])[:3]))
        url = s.get("url", f"https://arxiv.org/abs/{pid}")
        published = md_escape(s.get("published", "")[:10])

        lines.append(f"## {i}. {title_zh}")
        lines.append("")
        lines.append(f"**英文标题**：{title_en}")
        lines.append("")
        lines.append(f"**arXiv**：[{pid}]({url})　|　**作者**：{authors}　|　**日期**：{published}")
        lines.append("")
        lines.append(f"- **一句话核心贡献**：{core}")
        lines.append(f"- **方法亮点**：{methods}")
        lines.append(f"- **潜在应用意义**：{applications}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(f"*本日报由 web_system 论文学习流程生成 · {today}*")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    selected = load_selected_ids()
    summaries = load_summaries()
    today = datetime.now().strftime("%Y-%m-%d")
    out_file = f"daily_paper_{today}.md"

    content = render(selected, summaries)
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[build_report] 完成：{len(selected)} 篇 → {out_file}")


if __name__ == "__main__":
    main()
