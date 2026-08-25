#!/usr/bin/env bash
# ============================================================
# remote-wechat-publish.sh — 在 dev 机器上执行的降级发布脚本
# 通过 SSH 由 wechat-fallback-publish.sh 调用，一般不直接执行。
#
# 功能：
#   1. 从 content-hub 拉财经数据（/api/market-pulse、/api/topics）
#   2. 用 python3 生成带封面图的公众号风格 HTML
#   3. 调 /api/content/wechat/draft 建草稿（默认），或 /wechat/publish 发布
#
# 环境变量：
#   CH_BASE          content-hub 地址（默认 http://127.0.0.1:6007）
#   COVER_URL        封面图 URL
#   TITLE            文章标题
#   PUBLISH_FLAG     1=发布，0=仅建草稿（默认）
# ============================================================
set -euo pipefail

CH_BASE="${CH_BASE:-http://127.0.0.1:6007}"
COVER_URL="${COVER_URL:-https://dummyimage.com/800x400/FF8C42/fff.png&text=Finance+Daily}"
TITLE="${TITLE:-财经日报（降级通道）}"
PUBLISH_FLAG="${PUBLISH_FLAG:-0}"

# 1) 拉财经数据
PULSE=$(curl -sf -m 10 "$CH_BASE/api/market-pulse") || { echo "FAIL: 拉取 market-pulse 失败"; exit 1; }
TOPICS=$(curl -sf -m 10 "$CH_BASE/api/topics?limit=3") || TOPICS="[]"

# 2) 用 python3 生成 HTML（带封面图）
HTML=$(COVER_URL="$COVER_URL" PULSE="$PULSE" TOPICS="$TOPICS" python3 <<'PY'
import json, os, html

pulse = json.loads(os.environ["PULSE"])
raw_topics = json.loads(os.environ["TOPICS"])
topics = raw_topics.get("topics", []) if isinstance(raw_topics, dict) else raw_topics
cover = os.environ["COVER_URL"]

sent = pulse.get("sentiment_label", "中性")
idx  = pulse.get("sentiment_index", 0)
vol  = pulse.get("news_volume_24h", 0)
good = pulse.get("sentiment_distribution", {}).get("利好", 0)
bad  = pulse.get("sentiment_distribution", {}).get("利空", 0)
hot  = [s["sector"] for s in pulse.get("hot_sectors", [])[:5]]

items = []
for t in topics[:3]:
    items.append("<h3>%s</h3>" % html.escape(t.get("title", "")))
    if t.get("summary"):
        items.append("<p>%s</p>" % html.escape(t["summary"]))

body = "<body>"
body += '<p><img src="%s" width="800" /></p>' % cover
body += "<p>今日市场情绪指数为 <strong>%d（%s）</strong>，24 小时资讯量 %d 条，利好 %d / 利空 %d。热门板块：%s。</p>" % (
    idx, sent, vol, good, bad, "、".join(hot) if hot else "暂无")
body += "".join(items)
body += "</body>"
print(body)
PY
)

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
