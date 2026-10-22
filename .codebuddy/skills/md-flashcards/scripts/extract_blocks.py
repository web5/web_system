#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从算法手册 md 中抽出所有 ts 代码块，生成 scripts/.algo_extract.ts 供 node 运行/测试。"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "基础算法题手册.md"
OUT = ROOT / "scripts" / ".algo_extract.ts"

s = SRC.read_text(encoding="utf-8")
blocks = re.findall(r"```ts\n(.*?)```", s, re.S)
OUT.write_text("\n\n".join(blocks), encoding="utf-8")
print(f"提取 {len(blocks)} 个代码块 -> {OUT}")
