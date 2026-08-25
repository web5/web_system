#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_arxiv.py — 拉取 arXiv 最新论文，输出 arxiv_raw.json
默认分类：cs.AI / cs.CL / cs.CV / cs.LG，按提交时间倒序
用法：python3 fetch_arxiv.py [max_results] [categories]
  max_results: 拉取条数，默认 20
  categories:  分类（+ 分隔），默认 cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG
输出：arxiv_raw.json（列表，每项含 external_id/title/summary/url/published/authors/categories）
"""
import json
import re
import sys
import time
import urllib.request

ARXIV_API = "http://export.arxiv.org/api/query"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def fetch(max_results: int = 20, categories: str = "cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG") -> str:
    url = (
        f"{ARXIV_API}?search_query=cat:{categories}"
        f"&sortBy=submittedDate&sortOrder=descending&start=0&max_results={max_results}"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).strip()


def parse(xml: str) -> list:
    entries = re.findall(r"<entry>[\s\S]*?</entry>", xml)
    results = []
    for entry in entries:
        id_match = re.search(r"<id>([^<]+)</id>", entry)
        title_match = re.search(r"<title>([\s\S]*?)</title>", entry)
        summary_match = re.search(r"<summary>([\s\S]*?)</summary>", entry)
        published_match = re.search(r"<published>([^<]+)</published>", entry)

        if not title_match:
            continue
        id_full = id_match.group(1).strip() if id_match else ""
        external_id = id_full.split("/abs/")[-1] if "/abs/" in id_full else id_full
        authors = re.findall(r"<name>([^<]+)</name>", entry)
        categories = re.findall(r'term="([^"]+)"', entry)

        results.append({
            "external_id": external_id,
            "title": strip_tags(title_match.group(1)),
            "summary": strip_tags(summary_match.group(1) if summary_match else ""),
            "url": id_full or f"https://arxiv.org/abs/{external_id}",
            "published": published_match.group(1).strip() if published_match else "",
            "authors": authors,
            "categories": categories,
            "source_name": "arXiv",
        })
    return results


def main() -> None:
    max_results = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    categories = sys.argv[2] if len(sys.argv) > 2 else "cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG"

    print(f"[fetch_arxiv] 拉取 arXiv: categories={categories} max_results={max_results}")
    try:
        xml = fetch(max_results, categories)
    except Exception as e:  # noqa: BLE001
        # 一次重试（arXiv 偶发超时）
        print(f"[fetch_arxiv] 首次失败({e})，5 秒后重试...")
        time.sleep(5)
        xml = fetch(max_results, categories)

    papers = parse(xml)
    with open("arxiv_raw.json", "w", encoding="utf-8") as f:
        json.dump(papers, f, ensure_ascii=False, indent=2)
    print(f"[fetch_arxiv] 完成：{len(papers)} 篇 → arxiv_raw.json")


if __name__ == "__main__":
    main()
