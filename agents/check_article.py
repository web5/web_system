#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
公众号成稿结构层自检脚本（对应专家定义 §9 S 层）

用法:
    python3 check_article.py <article.html> [--title "文章标题"] [--check-links] [--mode short|long] [--exempt]

--mode short  -> 篇幅参考 800-1200（仅供参考，不阻塞）
--mode long   -> 篇幅参考 1500-2500（默认，仅供参考，不阻塞）
--check-links -> 额外发起 HTTP 请求校验首图与外链存活（需要联网）
--exempt      -> 标杆豁免模式，判真实好文时用（FAIL 项不构成缺陷）

设计原则（2026-09-04 修订）：
    篇幅由选题决定，不由判据决定。字数降级为「参考项」——只提示、不阻塞，
    避免为了凑字数而注水。结构层只卡「能不能发、能不能读」，不卡「好不好」。

退出码: 0 = 全部通过; 1 = 存在 FAIL 项（参考项不影响退出码）
"""

import argparse
import re
import sys
from html.parser import HTMLParser
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

VOID_TAGS = {"img", "br", "hr", "meta", "link", "input", "source"}
ALLOWED_TAGS = {"p", "h1", "h2", "h3", "h4", "blockquote", "strong", "b",
                "em", "ul", "ol", "li", "img", "a", "br", "hr", "section", "span"}
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"


class StructureParser(HTMLParser):
    """提取标签栈、图片、链接、段落文本"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.unclosed = []
        self.illegal_tags = []
        self.imgs = []
        self.links = []
        self.h2 = []
        self.paragraphs = []
        self._cur_h2 = None
        self._cur_p = None

    def handle_starttag(self, tag, attrs):
        if tag not in ALLOWED_TAGS:
            self.illegal_tags.append(tag)
        if tag not in VOID_TAGS:
            self.stack.append(tag)
        attr = dict(attrs)
        if tag == "img":
            self.imgs.append(attr.get("src", ""))
        if tag == "a":
            self.links.append(attr.get("href", ""))
        if tag == "h2":
            self._cur_h2 = []
        if tag == "p":
            self._cur_p = []

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            return
        if tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass
        else:
            self.unclosed.append(tag)
        if tag == "h2" and self._cur_h2 is not None:
            self.h2.append("".join(self._cur_h2).strip())
            self._cur_h2 = None
        if tag == "p" and self._cur_p is not None:
            self.paragraphs.append("".join(self._cur_p).strip())
            self._cur_p = None

    def handle_data(self, data):
        if self._cur_h2 is not None:
            self._cur_h2.append(data)
        if self._cur_p is not None:
            self._cur_p.append(data)


def count_words(text: str) -> int:
    """中文字数 + 英文单词数（近似公众号计字口径）"""
    cn = len(re.findall(r"[\u4e00-\u9fff]", text))
    en = len(re.findall(r"[A-Za-z]+", text))
    return cn + en


OK, DEAD, UNREACHABLE = "ok", "dead", "unreachable"


def check_url(url: str, timeout: int = 8) -> str:
    """三态判定：ok / dead / unreachable。

    关键：不可达（超时、DNS 失败、出网受限）≠ 死链（HTTP 4xx/5xx）。
    早期版本把两者都判 False，导致沙箱/内网环境下把可达但被墙的域名误报为死链。
    不可达是"测量失败"，不是"文章有问题"，只能 WARN 不能 FAIL。
    """
    if not url.startswith(("http://", "https://")):
        return DEAD
    try:
        req = Request(url, method="GET", headers={"User-Agent": UA, "Range": "bytes=0-1024"})
        with urlopen(req, timeout=timeout) as resp:
            return OK if resp.status in (200, 206) else DEAD
    except HTTPError as e:
        # 拿到了 HTTP 状态码 = 服务器确实响应了，按状态码判
        return DEAD if 400 <= getattr(e, "code", 0) < 600 else UNREACHABLE
    except (URLError, Exception):
        # 超时 / DNS / 连接失败 = 测量失败，无法判定文章是否有问题
        return UNREACHABLE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("--title", default=None, help="文章标题（公众号标题常不在正文内）")
    ap.add_argument("--check-links", action="store_true")
    ap.add_argument("--mode", choices=["short", "long"], default="long")
    ap.add_argument("--exempt", action="store_true",
                    help="标杆文豁免模式：仅作参考，FAIL 不阻断（真实好文常为博客体裁，"
                         "无 h2 分层/长段密集/篇幅自由，学招式不学格式）")
    args = ap.parse_args()

    try:
        raw = open(args.html, encoding="utf-8").read()
    except OSError as e:
        print(f"ERROR 无法读取文件: {e}")
        sys.exit(1)

    parser = StructureParser()
    parser.feed(raw)

    results = []  # (name, ok, detail) —— 阻塞项，FAIL 影响退出码
    notes = []    # (name, detail)   —— 参考项，只提示、不阻塞

    # 1. 首图封面：正文开头（前 500 字符内）存在 https 图片
    head = raw[:500]
    head_imgs = re.findall(r'<img[^>]+src="([^"]+)"', head)
    cover = head_imgs[0] if head_imgs else (parser.imgs[0] if parser.imgs else "")
    ok_cover = bool(head_imgs) and cover.startswith("https://")
    results.append(("首图封面", ok_cover,
                    f"{'开头 500 字符内' if head_imgs else '未找到'} https 图片: {cover[:70] or '无'}"))

    # 2. 标题长度
    title = args.title or ""
    if not title:
        m = re.search(r"<h1[^>]*>(.*?)</h1>", raw, re.S)
        if m:
            title = re.sub(r"<[^>]+>", "", m.group(1)).strip()
    tlen = len(title)
    if not title:
        results.append(("标题长度", False, "未提供标题，请用 --title 传入（缺失无法校验 ≤64 字）"))
    else:
        results.append(("标题长度", tlen <= 64, f"{tlen} 字（上限 64，公众号截断线）"))

    # 3. 小标题分层
    n_h2 = len(parser.h2)
    results.append(("小标题分层", n_h2 >= 3, f"h2 × {n_h2}（要求 ≥3）"))

    # 4. 单段行数（按句号/换行估算手机端行数，约 22 字/行）
    long_ps = [p for p in parser.paragraphs if len(p) > 180]
    results.append(("段落长度", len(long_ps) == 0,
                    f"{len(parser.paragraphs)} 段，超 8 行(≈180字) 的段: {len(long_ps)}"))

    # 5. 字数（参考项，不阻塞 —— 篇幅由选题决定，不为凑字数注水）
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", raw, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    words = count_words(text)
    lo, hi = (800, 1200) if args.mode == "short" else (1500, 2500)
    if words < lo:
        delta = f"比参考下限少 {lo - words} 字"
    elif words > hi:
        delta = f"比参考上限多 {words - hi} 字"
    else:
        delta = "在区间内"
    notes.append(("篇幅参考",
                  f"{words} 字（{args.mode} 参考 {lo}-{hi}，{delta}）—— "
                  f"篇幅由选题决定，非硬指标"))

    # 6. Markdown 残留
    md_hits = []
    for pat, label in [(r"\*\*[^*]+\*\*", "粗体 **"), (r"^#{1,6}\s", "标题 #"),
                       (r"^\s*-\s+", "列表 -"), (r"`[^`]+`", "反引号"),
                       (r"\[[^\]]+\]\([^)]+\)", "MD 链接")]:
        if re.search(pat, raw, re.M):
            md_hits.append(label)
    results.append(("Markdown 残留", not md_hits, f"命中 {len(md_hits)} 项: {', '.join(md_hits) or '无'}"))

    # 7. 标签闭合与白名单
    stack_ok = not parser.stack and not parser.unclosed
    detail = f"未闭合 {parser.stack or '无'} / 多余闭合 {parser.unclosed or '无'}"
    if parser.illegal_tags:
        stack_ok = False
        detail += f" / 白名单外标签 {sorted(set(parser.illegal_tags))}（微信可能过滤）"
    results.append(("HTML 标签", stack_ok, detail))

    # 8. 外链存活
    all_urls = [u for u in parser.links if u.startswith(("http://", "https://"))]
    if not args.check_links:
        results.append(("外链存活", True, f"跳过（未加 --check-links）；待检 {len(all_urls)} 条"))
    else:
        targets = ([cover] if cover else []) + all_urls
        states = {u: check_url(u) for u in targets}
        dead = [u for u, s in states.items() if s == DEAD]
        unreach = [u for u, s in states.items() if s == UNREACHABLE]
        detail = (f"检查 {len(targets)} 条（首图1+外链{len(all_urls)}）"
                  f"，死链 {len(dead)}，不可达 {len(unreach)}")
        if dead:
            detail += f" | 死链: {dead[:3]}"
        if unreach:
            detail += (f" | 不可达(测量失败，非文章问题): {[u[:40] for u in unreach[:3]]}"
                       f" —— 请换网络环境复核")
        results.append(("外链存活", not dead, detail))

    # 报告
    banner = "【结构层自检报告】"
    if args.exempt:
        banner = "【结构层自检报告 · 标杆豁免模式（仅参考）】"
    print("=" * 62)
    print(banner + f"  mode={args.mode}" + ("  links=on" if args.check_links else "  links=off"))
    print("=" * 62)
    if args.exempt:
        print("[i] 标杆豁免：本篇为真实好文，学招式不学格式。")
        print("    FAIL 项不构成缺陷，禁止据此类判据质疑标杆质量。")
        print("-" * 62)
    failed = 0
    for name, ok, detail in results:
        flag = "PASS" if ok else "FAIL"
        if not ok:
            failed += 1
        print(f"[{flag}] {name:<12} {detail}")
    if notes:
        print("-" * 62)
        for name, detail in notes:
            print(f"[  参考  ] {name:<8} {detail}")
    print("-" * 62)
    if args.exempt:
        print(f"结果：参考模式，{failed} 项未达公众号成稿格式（不阻断）")
        print("注：结构层只判「能不能发/能不能读」，不判「好不好」。")
        print("    实证：benchmark/good/ 6 篇真实好文无一全过，它们是好文，只是体裁不同。")
        sys.exit(0)
    print(f"结果：{'全部通过，可交付' if failed == 0 else f'{failed} 项未通过，回改后再交付'}")
    print("注：结构层为机器判；内容层 rubric 与风格层禁令需另起一轮自评（见专家定义 §9 C/T）")
    print("    回改时禁止为过判据而注水/切段——判据卡下限，不定义质量（红线 6）。")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
