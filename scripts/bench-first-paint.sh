#!/usr/bin/env bash
# ============================================================================
# 微前端首屏「字节账 + 吞吐」基准测量
#
# 用途：服务器带宽 / 资源体积调整前后，用同一把尺子对比。
#   ./scripts/bench-first-paint.sh dev      # dev.kedouai.com/admin
#   ./scripts/bench-first-paint.sh prod     # kedouai.com（模块 URL 用 MODULE_URLS 指定）
#
# 输出：
#   1. HTML TTFB
#   2. 单流吞吐（用最大的那个文件量，近似「总带宽上限」—— 实测并行总吞吐≈单流）
#   3. 首屏必须下完的 gzip 字节账（CDN 依赖 + 模块产物，从 HTML 自动发现）
#   4. 预估首屏耗时 = 首屏字节 / 单流吞吐
#
# 说明：不做真实浏览器 FCP 测量（本机网络 ≠ 用户网络），只量「字节 ÷ 带宽」这一项，
#       因为在 1Mbps 级出口下它就是首屏耗时的绝对主导项。
# ============================================================================
set -uo pipefail

ENV="${1:-dev}"
case "$ENV" in
  dev)
    BASE="https://dev.kedouai.com"
    PAGE="/admin"
    ;;
  prod)
    BASE="https://kedouai.com"
    PAGE="${PROD_PAGE:-/admin/}"
    ;;
  *)
    echo "usage: $0 dev|prod"; exit 1 ;;
esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== $ENV ($BASE$PAGE) =="

# 1) HTML
curl -s -o "$TMP/page.html" -w 'html ttfb=%{time_starttransfer}s  total=%{time_total}s  size=%{size_download}B\n' \
  --compressed "$BASE$PAGE"

# 2) 收集首屏资源：HTML 里的 <script src> + <link rel=preload>
{
  grep -oE 'src="/[^"]+\.js"' "$TMP/page.html" | sed 's/src="//; s/"$//'
  grep -oE '<link rel="preload" href="/[^"]+"' "$TMP/page.html" | sed 's/.*href="//; s/"$//'
  # 兜底：老 gateway 没注入 preload 时，手动指定模块产物
  for u in ${MODULE_URLS:-}; do echo "$u"; done
} | awk '!seen[$0]++' > "$TMP/urls.txt"

if [ ! -s "$TMP/urls.txt" ]; then
  echo "没有发现任何资源（页面可能不是基座 html）"; exit 1
fi

# 3) 逐个量 gzip 体积，记下最大的那个 URL
total=0; biggest=""; biggest_size=0
while read -r u; do
  sz=$(curl -s -o /dev/null -w '%{size_download}' --compressed "$BASE$u")
  total=$((total + sz))
  if [ "$sz" -gt "$biggest_size" ]; then biggest_size=$sz; biggest="$u"; fi
  printf '  %8d B  %s\n' "$sz" "$u"
done < "$TMP/urls.txt"

# 4) 单流吞吐（用最大文件测，避免小文件被 RTT 主导）
read -r speed _ <<<"$(curl -s -o /dev/null -w '%{speed_download} %{time_total}' --compressed "$BASE$biggest")"
kbps=$(awk -v s="$speed" 'BEGIN{printf "%.0f", s*8/1000}')
sec=$(awk -v t="$total" -v s="$speed" 'BEGIN{printf "%.1f", (s>0? t/s : 0)}')

echo "---------------------------------------------"
printf '首屏字节（gzip）      : %d B (%.0f KB)\n' "$total" "$(awk -v t=$total 'BEGIN{print t/1024}')"
printf '单流吞吐（%s）: %.0f B/s ≈ %.1f Mbps\n' "$(basename "$biggest")" "$speed" "$(awk -v s="$speed" 'BEGIN{print s*8/1000000}')"
printf '预估首屏耗时          : %s s   （字节 ÷ 带宽；并行也受总带宽上限约束）\n' "$sec"
echo "提示：升级带宽后重跑本脚本，对比『单流吞吐』与『预估首屏耗时』两行即可。"
