---
name: md-flashcards
description: 把 Markdown 题库/笔记/面试材料转成可交互刷题卡片 HTML（本地搜索 + 掌握进度 localStorage + 打印自动展开）；若 md 含代码块，可用 Node 自动跑语法校验与单元测试。当用户说「把这份 md 做成刷题卡片」「面试/复习刷题页」「从笔记生成问答卡片」时使用。
agent_created: true
version: 1.0.0
---

# md-flashcards：Markdown → 可交互刷题卡片

## 何时用

- 用户有一份结构化 md（面试题、知识点整理、学习笔记、术语表），想要一个能刷的页面
- 用户要求「卡片形式」「刷题页」「可搜索 / 可标记掌握」
- md 里有大量代码，需要验证代码能跑

## 快速生成

```bash
python3 <skill>/scripts/build_cards.py \
  --src 输入.md --out 输出.html \
  --title 页面标题 --subtitle 副标题 \
  --key 唯一-storage-key
```

生成后用 `present_files` 打开（HTML 会进预览 panel 并作为卡片列出）。

## md 组织约定（决定卡片切分）

| md 标记 | 产物 |
| --- | --- |
| `## Part X ｜ 标题` | 一个 tab 分区 |
| `### Q1.2 题目名` | 一张卡片（自动提取 `Q1.2` 作为角标，也支持 `S1` `P1` 等前缀） |
| `### 任意标题` | 同上一张卡片（无编号角标） |
| 该 Part 无 `###` 但有正文 | 整个 Part 打包成一张卡片 |
| 代码块 ```lang | 渲染为 `<pre class="code">` |
| `\| a \| b \|` 表格 | 渲染为 HTML table（自动跳过分隔行） |
| `- [ ] x` | 渲染为复选框样式 |

## 代码正确性校验（强烈建议，含代码块时）

```bash
python3 <skill>/scripts/extract_blocks.py        # 抽所有 ``` 代码块 -> scripts/.algo_extract.ts
# 把单元测试追加到 .algo_extract.ts 后面 -> .algo_run.ts
node --experimental-strip-types scripts/.algo_run.ts
```

- **不要用 `node --check`**：它走 CJS loader，不支持 TS 类型语法，会误报。用 `--experimental-strip-types` 直接运行（只 strip 类型，不做类型检查）。
- Node 22.x 已支持 type stripping；Python 用 `~/.workbuddy/binaries/python/versions/3.13.12/bin/python3`，Node 用 `~/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`（绝对路径，勿用 bare 命令）。
- 定义重复的夹具类型（如 `ListNode`/`TreeNode`）可以放在测试文件顶部：strip 后只剩运行时定义，与 md 里的类型标注不冲突。

## 踩过的坑

1. **`n = len(text)` 写成字符数不是行数** → 表格/列表解析 IndexError。必须 `lines_ = text.split("\n"); n = len(lines_)`。
2. **`finalize_item()` 里无条件清空 buf** → 没有 `###` 子节的 Part 正文会被吞掉。只在 `cur_item is not None` 时清。
3. **HTML 是 f-string，静态 CSS 里的 `{}` 要写成 `{{ }}`**；新增模板变量时用 `{args.xxx}`。
4. **每个题库必须给不同 `--key`**，否则 localStorage 掌握进度串味。
5. md 代码块里若写「伪代码」片段（如 `a ^ a = 0`），必须改成注释形式，否则 node 解析失败。
6. 交付前跑一次标签平衡检查（`html.parser` 统计 unclosed/mismatch），确保 0 错误。

## JS/算法内容本身的高频 bug（写算法手册时务必自查）

`[a[i], a[j]] = [a[j], a[i++]]` 是**错的**：JS 先求值右侧（i 已自增）再解析左侧目标 → 索引错位。自增必须单独一句。这是快排 partition 的经典翻车点。
