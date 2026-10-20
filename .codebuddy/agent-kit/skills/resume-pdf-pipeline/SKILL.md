---
name: resume-pdf-pipeline
description: 将求职简历 markdown 一键转为 A4 专业排版 PDF（投递版）。内置简历专用 CSS（深蓝主色 + 橙色点缀 + 技术标签 chips + 求职意向高亮 + 章节色条），自动处理联系方式表格净化、短标签横向化、v2 草稿类带内部批注的投递净化。适用于需要快速把 markdown 简历转成可直接投递的 PDF、或批量生成多方向简历 PDF（前端架构师 / AI 智能体 / AI 方案顾问等）。当用户要求"把简历 markdown 转 PDF"、"生成简历投递版"、"批量出多份简历 PDF"时触发本技能。
agent_created: true
version: 1.0.0
---

# 简历 markdown → A4 投递 PDF 流水线

## 适用场景

- 把已经写好的求职简历 markdown（含联系方式 / 工作经历表格 / 项目经历 bullet / 技术标签）转成 A4 专业排版 PDF，直接拿去投递
- 一次性出多份"不同岗位方向"的简历 PDF（前端架构师 / AI 智能体 / AI 方案顾问 等），共享同一份简历但偏重不同
- 把含 v2 草稿批注的 md 源文件做"投递净化"——去文首改造说明 + 文末"待确认/禁忌"使用说明

## 工具链

| 步骤 | 工具 | 说明 |
|---|---|---|
| ① md → HTML | Python `markdown 3.10+` + 自写 CSS 模板 | A4 排版，PingFang SC 中文字体 |
| ② HTML → PDF | **puppeteer-core** 驱动系统 Chrome | **不要用 Chrome `--headless=new` 命令行直跑，会卡死 3 分钟无输出**（macOS 142+ 的已知问题） |

> ⚠️ 关键技术决策：所有官方"简单"的 Chrome headless CLI 方案在 macOS 142+ 都会卡住。**唯一可靠方式是用 puppeteer-core 编程控制**。

## 实施步骤

### 1. 安装 puppeteer-core

```bash
mkdir -p /Users/geekwen/.workbuddy/binaries/node/workspace
cd /Users/geekwen/.workbuddy/binaries/node/workspace
/Users/geekwen/.workbuddy/binaries/node/versions/22.22.2-2/bin/npm install puppeteer-core
```

### 2. Python 渲染脚本 `/tmp/resume_pdf/md2html.py`（核心逻辑）

```python
import re, pathlib, markdown

CSS = """
@page { size: A4; margin: 11mm 12mm 13mm; }
body { font-family: "PingFang SC","Hiragino Sans GB",sans-serif; color:#23272f; font-size:10pt; line-height:1.58; }
.resume-header { display:flex; align-items:baseline; justify-content:space-between; border-bottom:2.5px solid #1e3a5f; padding-bottom:8px; }
.name { font-size:21pt; font-weight:800; color:#1e3a5f; letter-spacing:3px; }
.name .dot { color:#F97316; }
.sub { font-size:11pt; color:#F97316; font-weight:700; }
.intent { background:#fdf2e7; border:1px solid #f6d9b8; border-radius:6px; padding:6px 10px; margin:6px 0 10px; color:#7c3a0c; }
.intent b { color:#c2410c; }
h2 { font-size:12.5pt; color:#1e3a5f; margin:13px 0 7px; padding:0 0 3px 9px; border-left:4px solid #F97316; border-bottom:1px solid #e2e6ec; page-break-after:avoid; }
h3 { font-size:10.8pt; color:#1e3a5f; margin:10px 0 3px; page-break-after:avoid; }
li { page-break-inside:avoid; } li::marker { color:#F97316; }
table { width:100%; border-collapse:collapse; font-size:9.6pt; }
th, td { padding:3px 8px; border-bottom:1px dashed #d9dee7; }
table.kv { width:auto; } table.kv td { border-bottom:none; }
table.kv td:first-child { color:#5b6472; width:100px; padding-right:14px; }
table.kv td:last-child { font-weight:600; }
blockquote { background:#f7f9fc; border-left:3px solid #1e3a5f; padding:7px 12px; border-radius:0 6px 6px 0; }
ul.tags { list-style:none; padding:0; display:flex; flex-wrap:wrap; gap:5px; }
ul.tags li { background:#eef2f7; border:1px solid #d9e1ec; border-radius:20px; padding:2px 11px; font-size:8.8pt; color:#33415c; margin:0; }
"""

def render(md_text, subtitle, is_consultant=False):
    md_text = re.sub(r'^# .+\n', '', md_text, count=1).lstrip('\n')  # ⚠️ 删 h1 后必须 lstrip
    if is_consultant:  # v2 草稿类投递净化
        md_text = re.sub(r'^> 基于 [\s\S]*?\n> 改动要点：[^\n]*\n', '', md_text, count=1)
        md_text = re.sub(r'^---\s*\n+## 📌[\s\S]*$', '', md_text, flags=re.M)
    html = markdown.markdown(md_text, extensions=['tables', 'sane_lists'])
    html = re.sub(r'<table>\s*<thead>.*?</thead>', '<table class="kv">', html, count=1, flags=re.S)
    html = re.sub(r'<p><strong>求职意向</strong>：([^<]*)</p>', r'<div class="intent">🎯 <b>求职意向</b>：<b>\1</b></div>', html)
    # 短标签列表转 chips
    def to_tags(m):
        items = re.findall(r'<li>([^<]{1,34})</li>', m.group(0))
        if items and all(len(t.strip()) <= 34 and not re.search(r'[，。；：、（）]', t) for t in items):
            return '<ul class="tags">' + ''.join(f'<li>{t.strip()}</li>' for t in items) + '</ul>'
        return m.group(0)
    html = re.sub(r'<ul>(.*?)</ul>', to_tags, html, flags=re.S)
    return f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>{CSS}</style></head><body><header class="resume-header"><div class="name">文追<span class="dot">.</span></div><div class="sub">{subtitle}</div></header>{html}</body></html>'
```

### 3. Node puppeteer 打印脚本

```javascript
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  for (const job of JOBS) {
    const page = await browser.newPage();
    await page.goto('file://' + job.htmlPath, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.emulateMediaType('print');
    await page.pdf({
      path: job.pdfPath,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '11mm', right: '12mm', bottom: '13mm', left: '12mm' },
    });
    await page.close();
  }
  await browser.close();
})();
```

### 4. 跑起来

```bash
NODE_PATH=/Users/geekwen/.workbuddy/binaries/node/workspace/node_modules \
  /Users/geekwen/.workbuddy/binaries/node/versions/22.22.2-2/bin/node /tmp/resume_pdf/pdf.js
```

## 踩坑沉淀（必须记住）

1. **Chrome `--headless=new --print-to-pdf` 直跑会卡死 3 分钟**（macOS 142+ 已知问题）。唯一可靠方式：puppeteer-core 编程控制。
2. **删 h1 后必须 `.lstrip('\n')`**：删除 `# 文追·...` 行后剩余文本前可能留空行，导致后续 `^` 锚定正则匹配不到引用块。
3. **第一个表格去 thead** 改成 `.kv` 样式：联系方式表头"联系方式|信息"看着多余，渲染完 HTML 用正则 `<table>\s*<thead>.*?</thead>` 替换为 `<table class="kv">`（只第一个表）。
4. **同一 browser 串行多 page**：避免并行 user-data-dir 冲突，puppeteer 一份 browser 多 page 跑 3 份 PDF 约 14 秒。
5. **求职意向块用 `<div class="intent">`** 单独样式（橙色 highlight），别用普通 `<p>`。
6. **v2 草稿投递净化顺序**：(a) 删 h1 (b) `^> 基于 [\s\S]*?\n> 改动要点：[^\n]*\n` 删文首 (c) `^---\s*\n+## 📌[\s\S]*$` flags=re.M 删文末。

## 设计取舍

- **深蓝（#1e3a5f）+ 橙（#F97316）配色**：稳重专业 + 用户品牌色点缀。回避纯灰（太冷淡）/ 纯橙（不专业）。
- **技术标签 chips 化**：节省约 30% 纵向空间，让技术栈从 5 行变 2 行。
- **章节色条 + 浅灰下划线**：h2 视觉锚定，比单纯加粗/加大字号更适合 A4 扫描式阅读。
- **`page-break-inside: avoid` 给 li**：防止项目 bullet 在分页处被切碎。
- **不加页码**：简历一般 3-4 页，页码意义不大且分散注意力；如要加，Chromium 不支持 `@page` margin box，改用 `headerTemplate`（不推荐）。

## 验收清单

- [ ] 顶部 header 姓名 + 方向 sub 正确显示
- [ ] 联系方式表是 3 行 kv 形式（无表头）
- [ ] 求职意向是橙色高亮块（不是普通 p）
- [ ] 章节 h2 左侧 4px 橙条 + 底部 1px 浅灰线
- [ ] 技术栈短标签全部转 chips 横向（无中文标点）
- [ ] 中文不出现"口口"乱码（确认 PingFang SC 生效）
- [ ] emoji 彩色正常（📱✉️📍🎯）
- [ ] 项目经历 bullet 不在分页处被切断
- [ ] v2 草稿的"基于/改动要点/使用说明/待你确认/禁忌"在 PDF 中**不存在**

## 输出位置约定

默认与 md 源文件同目录，命名 `求职简历-<方向>.pdf`：
- `求职简历-前端架构师.md` → `求职简历-前端架构师.pdf`
- `求职简历-AI智能体方向.md` → `求职简历-AI智能体方向.pdf`
- `求职简历-AI方案顾问v2草稿.md` → `求职简历-AI方案顾问.pdf`（**投递版不带 v2 草稿字样**）
