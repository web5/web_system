#!/usr/bin/env bash
# ============================================================
# remote-paper-publish.sh — 在 dev 机器上执行的论文学习日报降级脚本
# 由 paper-fallback-publish.sh 调用，一般不直接执行。
#
# 功能：
#   1. 调 arXiv 官方 API 拉取最新 AI/ML 论文（cs.AI/CL/CV/LG）
#   2. 用 Python 解析 Atom XML，生成中英双语 HTML
#   3. 调 /api/content/wechat/draft 建草稿（默认），或 /wechat/publish 发布
#
# 环境变量：
#   CH_BASE          content-hub 地址（默认 http://127.0.0.1:6007）
#   COVER_URL        封面图 URL
#   TITLE            文章标题
#   CATEGORIES       arxiv 分类（默认 cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG）
#   MAX_RESULTS      拉取论文数（默认 5）
#   PUBLISH_FLAG     1=发布，0=仅建草稿
# ============================================================
set -euo pipefail

CH_BASE="${CH_BASE:-http://127.0.0.1:6007}"
COVER_URL="${COVER_URL:-https://dummyimage.com/800x400/4A90E2/fff.png&text=arXiv+Daily}"
TITLE="${TITLE:-arXiv 论文日报（降级通道）}"
CATEGORIES="${CATEGORIES:-cs.AI+OR+cs.CL+OR+cs.CV+OR+cs.LG}"
MAX_RESULTS="${MAX_RESULTS:-5}"
PUBLISH_FLAG="${PUBLISH_FLAG:-0}"

# 1) 拉 arXiv 论文（用 curl + UA + 跟随重定向）
TMP_XML=$(mktemp)
HTTP_CODE=$(curl -sL -o "$TMP_XML" -w '%{http_code}' -m 30 \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  "http://export.arxiv.org/api/query?search_query=cat:${CATEGORIES}&sortBy=submittedDate&sortOrder=descending&start=0&max_results=${MAX_RESULTS}")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: arXiv API 返回 HTTP $HTTP_CODE"
  rm -f "$TMP_XML"
  exit 1
fi
# 检查是否真的拿到 XML（重定向后的 200 也可能返回 HTML 错误页）
if ! head -c 5 "$TMP_XML" | grep -q "<?xml"; then
  echo "FAIL: arXiv 返回非 XML 内容（可能是被限流或 IP 白名单）"
  head -c 200 "$TMP_XML" | sed 's/^/  /'
  rm -f "$TMP_XML"
  exit 1
fi

# 2) 用 Python 解析 XML + 生成中英双语 HTML
HTML=$(COVER_URL="$COVER_URL" TITLE="$TITLE" XML_PATH="$TMP_XML" python3 <<'PY'
import os, re, html, xml.etree.ElementTree as ET
from datetime import datetime, timezone

xml_path = os.environ["XML_PATH"]
cover = os.environ["COVER_URL"]
title = os.environ["TITLE"]

ns = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
tree = ET.parse(xml_path)
root = tree.getroot()
entries = root.findall("a:entry", ns)

# 分类中文映射
cat_zh = {
    "cs.AI": "人工智能", "cs.CL": "自然语言处理", "cs.CV": "计算机视觉",
    "cs.LG": "机器学习", "cs.IR": "信息检索", "cs.RO": "机器人",
    "cs.CV.": "计算机视觉", "cs.LG.": "机器学习",
}

def cat_to_zh(c):
    c = c.strip()
    return cat_zh.get(c, c)

# 提取论文
papers = []
for e in entries:
    paper_title = (e.find("a:title", ns).text or "").strip().replace("\n", " ")
    paper_summary = (e.find("a:summary", ns).text or "").strip().replace("\n", " ")
    id_full = (e.find("a:id", ns).text or "").strip()
    arxiv_id = id_full.split("/abs/")[-1] if "/abs/" in id_full else id_full
    abs_url = id_full if id_full.startswith("http") else f"https://arxiv.org/abs/{arxiv_id}"
    published = (e.find("a:published", ns).text or "").strip()
    authors = [a.find("a:name", ns).text for a in e.findall("a:author", ns) if a.find("a:name", ns) is not None]
    cats = [c.get("term") for c in e.findall("arxiv:category", ns)]
    if not cats:
        cats = [c.get("term") for c in e.findall("a:category", ns)]

    # 摘要截断 + 中文导读
    snip = paper_summary[:600] + ("…" if len(paper_summary) > 600 else "")
    cat_zh_list = [cat_to_zh(c) for c in cats[:3]]

    papers.append({
        "title": paper_title, "summary": snip, "arxiv_id": arxiv_id,
        "abs_url": abs_url, "published": published, "authors": authors,
        "cats_zh": cat_zh_list, "cats": cats,
    })

# 生成中英双语 HTML
parts = ["<body>"]
# 封面
parts.append(f'<p><img src="{html.escape(cover)}" width="800" /></p>')
# 中文导读
parts.append(f'<h3>今日 arXiv 速览</h3>')
parts.append(f'<p>本日报精选 <strong>{len(papers)}</strong> 篇最新 AI/ML 方向论文，覆盖 '
            + '、'.join(set(c for p in papers for c in p["cats_zh"])) + ' 等领域。'
            + '每篇包含英文原文标题/摘要与中文导读，方便快速把握研究动向。</p>')
parts.append('<hr/>')

for i, p in enumerate(papers, 1):
    # 论文块：中文序号+英文标题+双语切换
    parts.append(f'<h3>{i}. {html.escape(p["title"])}</h3>')
    # 英文原文摘要
    parts.append(f'<p><strong>[English Abstract]</strong></p>')
    parts.append(f'<p>{html.escape(p["summary"])}</p>')
    # 中文导读（模板化）
    auth_str = ", ".join(p["authors"][:3]) + (" et al." if len(p["authors"]) > 3 else "")
    pub_date = p["published"][:10] if p["published"] else ""
    parts.append(f'<p><strong>[中文导读]</strong> 来自 arXiv，'
                 f'作者：{html.escape(auth_str or "未知")}，'
                 f'分类：{html.escape("、".join(p["cats_zh"]))}，'
                 f'发布日期：{pub_date or "未知"}。</p>')
    # arxiv 链接
    parts.append(f'<p>🔗 <a href="{html.escape(p["abs_url"])}">{html.escape(p["abs_url"])}</a></p>')
    if i < len(papers):
        parts.append('<hr/>')

parts.append(f'<p>—— 本日报由 web_system 论文学习 MCP 降级链路生成，'
             f'抓取时间 {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}。</p>')
parts.append("</body>")
print("".join(parts))
PY
)

rm -f "$TMP_XML"

# 3) 投递
PAYLOAD=$(python3 -c 'import json,sys; print(json.dumps({"title":sys.argv[1],"html":sys.argv[2]}))' "$TITLE" "$HTML")

if [ "$PUBLISH_FLAG" = "1" ]; then
  RESP=$(curl -sf -m 30 -X POST "$CH_BASE/api/content/wechat/publish" \
    -H "Content-Type: application/json" -d "$PAYLOAD") \
    || { echo "FAIL: 发布失败"; exit 1; }
  echo "发布结果: $RESP"
else
  RESP=$(curl -sf -m 30 -X POST "$CH_BASE/api/content/wechat/draft" \
    -H "Content-Type: application/json" -d "$PAYLOAD") \
    || { echo "FAIL: 建草稿失败"; exit 1; }
  echo "草稿结果: $RESP"
fi
