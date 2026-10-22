#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 Markdown 题库解析成可交互刷题卡片 HTML。

用法：
  python3 scripts/build_cards.py                       # 默认：主题库 md -> 面试刷题卡片.html
  python3 scripts/build_cards.py --src 基础算法题手册.md --out 算法刷题卡片.html \
      --title 算法刷题卡片 --subtitle TypeScript 实现 \
      --key algo-cards-learned
"""
import re, json, html, pathlib, datetime, argparse

ROOT = pathlib.Path(__file__).resolve().parent.parent

ap = argparse.ArgumentParser()
ap.add_argument("--src", default="面试技术知识题库与答案.md")
ap.add_argument("--out", default="面试刷题卡片.html")
ap.add_argument("--title", default="面试刷题卡片")
ap.add_argument("--subtitle", default="AI 应用 / 智能体平台 / 前端架构")
ap.add_argument("--key", default="interview-cards-learned")
args = ap.parse_args()

SRC = ROOT / args.src
OUT = ROOT / args.out

raw = SRC.read_text(encoding="utf-8")
lines = raw.split("\n")

PARTS = []
cur_part = None
cur_item = None
buf = []


def finalize_item():
    global cur_item, buf
    if cur_item is not None:
        cur_item["body"] = "\n".join(buf).strip("\n")
        if cur_item["body"] or cur_item["title"]:
            cur_part["items"].append(cur_item)
        cur_item = None
        buf = []


def finalize_part():
    global cur_part, buf
    finalize_item()
    if cur_part is not None:
        body = "\n".join(buf).strip("\n")
        if not cur_part["items"] and body:
            cur_part["items"].append({"id": "", "title": cur_part["title"], "body": body})
        PARTS.append(cur_part)
    cur_part = None
    buf = []


for line in lines:
    if line.startswith("## "):
        finalize_part()
        cur_part = {"title": line[3:].strip(), "items": []}
    elif line.startswith("### "):
        finalize_item()
        head = line[4:].strip()
        m = re.match(r"^(Q\d+\.\d+|S\d+|P\d+|[A-Z]-\d+)\s+(.*)$", head)
        if m:
            cur_item = {"id": m.group(1), "title": m.group(2)}
        else:
            cur_item = {"id": "", "title": head}
        cur_item = cur_item or {"id": "", "title": head}
    elif cur_part is not None:
        if line.startswith("> ") and "题库结构" not in line and False:
            pass
        buf.append(line)
finalize_part()

# 丢掉头部元信息（第一个 Part 之前的内容已被忽略），移除空的 Part
PARTS = [p for p in PARTS if p["items"]]


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    return s


def md_to_html(text):
    out = []
    lines_ = text.split("\n")
    i, n = 0, len(lines_)
    while i < n:
        ln = lines_[i]
        # 代码块
        if ln.strip().startswith("```"):
            lang = ln.strip()[3:].strip()
            i += 1
            code = []
            while i < n and not lines_[i].strip().startswith("```"):
                code.append(lines_[i])
                i += 1
            i += 1
            out.append(f'<pre class="code"><code>{html.escape(chr(10).join(code))}</code></pre>')
            continue
        # 表格
        if ln.strip().startswith("|"):
            rows = []
            while i < n and lines_[i].strip().startswith("|"):
                cells = [c.strip() for c in lines_[i].strip().strip("|").split("|")]
                rows.append(cells)
                i += 1
            head = rows[0]
            body = [r for r in rows[1:] if not re.match(r"^[\s\-:|]+$", "".join(r))]
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            trs = "".join(
                "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in body
            )
            out.append(f'<div class="tw"><table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>')
            continue
        # 引用
        if ln.startswith("> "):
            quote = []
            while i < n and lines_[i].startswith("> "):
                quote.append(lines_[i][2:])
                i += 1
            out.append(f'<blockquote>{md_to_html("\n".join(quote))}</blockquote>')
            continue
        # 列表
        if re.match(r"^\s*[-*]\s+", ln) or re.match(r"^\s*\d+\.\s+", ln):
            items = []
            ordered = bool(re.match(r"^\s*\d+\.\s+", ln))
            while i < n and (re.match(r"^\s*[-*]\s+", lines_[i]) or re.match(r"^\s*\d+\.\s+", lines_[i]) or (items and lines_[i].startswith("   ") and lines_[i].strip())):
                cur = lines_[i]
                m = re.match(r"^\s*(?:[-*]|\d+\.)\s+(.*)$", cur)
                if m:
                    body_txt = m.group(1)
                    cb = re.match(r"^\[ \]\s*(.*)$", body_txt)
                    if cb:
                        items.append(f'<li class="cb">{inline(cb.group(1))}</li>')
                    else:
                        items.append(f"<li>{inline(body_txt)}</li>")
                elif items:
                    items[-1] = items[-1][:-5] + " " + inline(cur.strip()) + "</li>"
                else:
                    items.append(f"<li>{inline(cur.strip())}</li>")
                i += 1
            tag = "ol" if ordered else "ul"
            out.append(f'<{tag}>' + "".join(items) + f'</{tag}>')
            continue
        # 目录省略 / 水平线
        if ln.strip() in ("---", "***", "") :
            i += 1
            continue
        if ln.startswith("#### "):
            out.append(f"<h5>{inline(ln[5:])}</h5>")
            i += 1
            continue
        out.append(f"<p>{inline(ln)}</p>")
        i += 1
    return "\n".join(out)


total = sum(len(p["items"]) for p in PARTS)

tabs = []
bodies = []
for pi, part in enumerate(PARTS):
    pid = f"tab-{pi}"
    short = part["title"].split("｜")[-1].strip() if "｜" in part["title"] else part["title"]
    if len(short) > 16:
        short = short[:15] + "…"
    label = part["title"]
    active = " active" if pi == 0 else ""
    tabs.append(f'<button class="tab{active}" data-target="{pid}">{html.escape(short)}</button>')
    cards = []
    for it in part["items"]:
        body = md_to_html(it["body"])
        eid = it["id"] or "n"
        cards.append(f'''
      <article class="card" data-id="{eid}" data-search="{html.escape((it['title'] + ' ' + it['body'])[:400])}">
        <header class="card-head" onclick="toggleCard(this)">
          <span class="qid">{html.escape(it['id'])}</span>
          <h3>{inline(it['title'])}</h3>
          <span class="chev">▾</span>
        </header>
        <div class="card-body">{body}
          <div class="card-actions">
            <button class="mark-btn" onclick="markLearned(this, event)">标记已掌握</button>
          </div>
        </div>
      </article>''')
    bodies.append(f'<section class="panel{active}" id="{pid}"><h2 class="part-title">{html.escape(part["title"])}<span class="cnt">{len(part["items"])} 题</span></h2>' + "\n".join(cards) + "</section>")

HTML = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{args.title} · AI 应用 / 智能体 / 前端架构</title>
<style>
  :root {{
    --bg:#0A0A0D; --bg2:#12121A; --card:#16161F; --card2:#1B1B26;
    --white:#FFF8F0; --muted:#9B9BAA; --orange:#F97316; --teal:#4ECDC4;
    --line:rgba(255,255,255,.08);
    --shadow: 0 10px 30px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05);
  }}
  * {{ box-sizing:border-box; }}
  body {{
    margin:0; background:var(--bg); color:var(--white);
    font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Inter,sans-serif;
    line-height:1.75; font-size:15px;
    background-image: radial-gradient(900px 500px at 15% -10%, rgba(249,115,22,.14), transparent 60%),
                      radial-gradient(800px 500px at 100% 0%, rgba(78,205,196,.10), transparent 55%);
  }}
  .wrap {{ max-width: 980px; margin:0 auto; padding: 28px 20px 80px; }}
  header.top {{ position:sticky; top:0; z-index:20; backdrop-filter:blur(14px);
    background:linear-gradient(180deg, rgba(10,10,13,.94), rgba(10,10,13,.72));
    border-bottom:1px solid var(--line); padding:14px 0 12px; }}
  .top-inner {{ max-width:980px; margin:0 auto; padding:0 20px; }}
  .title-row {{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; }}
  h1 {{ font-size:19px; margin:0; letter-spacing:.3px; }}
  h1 .dot {{ color:var(--orange); }}
  .stat {{ margin-left:auto; font-size:13px; color:var(--muted); }}
  .stat b {{ color:var(--teal); font-size:15px; }}
  .search {{ margin-top:10px; display:flex; gap:8px; }}
  .search input {{ flex:1; background:var(--card); border:1px solid var(--line); border-radius:14px;
    padding:10px 14px; color:var(--white); font-size:14px; outline:none; }}
  .search input:focus {{ border-color:rgba(249,115,22,.6); box-shadow:0 0 0 3px rgba(249,115,22,.14); }}
  .search button {{ background:var(--card2); border:1px solid var(--line); color:var(--muted);
    border-radius:14px; padding:0 14px; cursor:pointer; font-size:13px; }}
  .tabs {{ display:flex; gap:8px; overflow-x:auto; padding:14px 0 4px; scrollbar-width:none; }}
  .tabs::-webkit-scrollbar {{ display:none; }}
  .tab {{ flex:0 0 auto; background:var(--card); border:1px solid var(--line); color:var(--muted);
    border-radius:999px; padding:7px 15px; font-size:13px; cursor:pointer; transition:.18s; }}
  .tab:hover {{ color:var(--white); border-color:rgba(249,115,22,.35); }}
  .tab.active {{ background:linear-gradient(135deg,var(--orange),#FB923C); color:#201106; border-color:transparent; font-weight:600; }}
  .panel {{ display:none; animation:fade .25s ease; }}
  .panel.active {{ display:block; }}
  @keyframes fade {{ from {{opacity:0; transform:translateY(6px);}} to {{opacity:1; transform:none;}} }}
  .part-title {{ font-size:16px; margin:18px 0 14px; color:var(--white); display:flex; align-items:center; gap:10px; }}
  .cnt {{ font-size:12px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:2px 10px; }}
  .card {{ background:var(--card); border:1px solid var(--line); border-radius:18px;
    margin-bottom:12px; box-shadow:var(--shadow); overflow:hidden; transition:.2s; }}
  .card.open {{ border-color:rgba(249,115,22,.35); }}
  .card.learned {{ border-color:rgba(78,205,196,.45); }}
  .card.learned .card-head h3::after {{ content:" ✓"; color:var(--teal); }}
  .card-head {{ display:flex; align-items:center; gap:12px; padding:15px 18px; cursor:pointer; }}
  .card-head:hover {{ background:rgba(255,255,255,.03); }}
  .qid {{ flex:0 0 auto; font-size:12px; color:var(--orange); background:rgba(249,115,22,.12);
    border-radius:8px; padding:2px 8px; font-variant-numeric:tabular-nums; }}
  .card-head h3 {{ font-size:15px; margin:0; font-weight:600; flex:1; }}
  .chev {{ color:var(--muted); transition:.2s; }}
  .card.open .chev {{ transform:rotate(180deg); color:var(--orange); }}
  .card-body {{ display:none; padding:2px 20px 20px; border-top:1px solid var(--line); color:#DEDEE6; }}
  .card.open .card-body {{ display:block; }}
  .card-body p, .card-body li {{ font-size:14.5px; }}
  .card-body ul, .card-body ol {{ padding-left:22px; }}
  .card-body li {{ margin:5px 0; }}
  li.cb {{ list-style:none; margin-left:-18px; }}
  li.cb::before {{ content:"☐"; color:var(--orange); margin-right:6px; }}
  code {{ background:rgba(255,255,255,.07); padding:1px 6px; border-radius:6px; font-size:13px;
    font-family:"SF Mono",Menlo,Consolas,monospace; color:var(--teal); }}
  pre.code {{ background:#0d0d14; border:1px solid var(--line); border-radius:14px; padding:14px 16px;
    overflow:auto; font-size:12.8px; line-height:1.65; }}
  pre.code code {{ background:none; padding:0; color:#CFCFE0; }}
  blockquote {{ margin:12px 0; padding:10px 16px; border-left:3px solid var(--orange);
    background:rgba(249,115,22,.06); border-radius:0 12px 12px 0; color:#E7E7EF; }}
  .tw {{ overflow-x:auto; margin:12px 0; }}
  table {{ border-collapse:collapse; width:100%; font-size:13.5px; min-width:420px; }}
  th, td {{ border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }}
  th {{ background:rgba(255,255,255,.05); color:var(--white); font-weight:600; }}
  tr:nth-child(even) td {{ background:rgba(255,255,255,.02); }}
  h5 {{ font-size:14px; margin:16px 0 6px; color:var(--teal); }}
  .card-actions {{ margin-top:16px; display:flex; gap:8px; }}
  .mark-btn {{ background:var(--card2); border:1px solid var(--line); color:var(--muted);
    border-radius:12px; padding:6px 14px; font-size:13px; cursor:pointer; transition:.18s; }}
  .mark-btn:hover {{ color:var(--white); border-color:rgba(78,205,196,.5); }}
  .card.learned .mark-btn {{ color:#0c1a18; background:var(--teal); border-color:transparent; font-weight:600; }}
  .empty {{ color:var(--muted); padding:30px; text-align:center; }}
  footer {{ color:var(--muted); font-size:12.5px; text-align:center; padding:24px 0 0; }}
  @media print {{ body {{ background:#fff; color:#000; }} .card-body {{ display:block !important; }} header.top, .tabs, .card-actions {{ display:none; }} }}
</style>
</head>
<body>
<header class="top">
  <div class="top-inner">
    <div class="title-row">
      <h1><span class="dot">●</span> {args.title} <span style="color:var(--muted);font-size:13px">{args.subtitle}</span></h1>
      <div class="stat">已掌握 <b id="learned">0</b> / {total}</div>
    </div>
    <div class="search">
      <input id="q" placeholder="搜索关键词，如 SSE / MCP / 闭包 / 微前端…" autocomplete="off">
      <button onclick="clearSearch()">清除</button>
    </div>
  </div>
</header>
<div class="wrap">
  <nav class="tabs" id="tabs">{"".join(tabs)}</nav>
  <main id="panels">{"".join(bodies)}</main>
  <footer>共 {total} 题 · 卡片 fetch 于 {datetime.date.today().isoformat()} · 源文件：面试技术知识题库与答案.md</footer>
</div>
<script>
const KEY='{args.key}';
let learned=new Set(JSON.parse(localStorage.getItem(KEY)||'[]'));
function save(){{localStorage.setItem(KEY,JSON.stringify([...learned]));
  document.getElementById('learned').textContent=learned.size;}}
function toggleCard(el){{const c=el.parentElement; c.classList.toggle('open');}}
function markLearned(btn,ev){{
  ev.stopPropagation();
  const card=btn.closest('.card'); const id=card.dataset.id;
  if(learned.has(id)){{learned.delete(id); card.classList.remove('learned'); btn.textContent='标记已掌握';}}
  else{{learned.add(id); card.classList.add('learned'); btn.textContent='✓ 已掌握';}}
  save();
}}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); document.getElementById(t.dataset.target).classList.add('active');
}}));
document.querySelectorAll('.card').forEach(card=>{{
  if(learned.has(card.dataset.id)){{card.classList.add('learned');
    card.querySelector('.mark-btn').textContent='✓ 已掌握';}}
}});
document.getElementById('learned').textContent=learned.size;
const input=document.getElementById('q');
input.addEventListener('input',()=>{{
  const kw=input.value.trim().toLowerCase();
  document.querySelectorAll('.card').forEach(c=>{{
    const hit=!kw||c.dataset.search.toLowerCase().includes(kw);
    c.style.display=hit?'':'none';
  }});
  if(kw){{document.querySelectorAll('.card').forEach(c=>{{c.classList.remove('open');}});}}
}});
function clearSearch(){{ input.value=''; input.dispatchEvent(new Event('input')); }}
</script>
</body>
</html>
"""

OUT.write_text(HTML, encoding="utf-8")
print(f"OK -> {OUT}")
print(f"parts={len(PARTS)} total={total}")
for p in PARTS:
    print(f"  {p['title'][:40]} -> {len(p['items'])}")
