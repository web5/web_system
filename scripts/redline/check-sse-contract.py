#!/usr/bin/env python3
# ============================================================
# check-sse-contract.py — SSE 事件类型契约一致性检查（CI R16）
#
# 设计：specs/rd-process-model/design.md §3.7 · 判据源 docs/api/contracts.md C2
# 背景：'card' 事件由服务端推送、被 portal 与小程序各自手写联合类型，而共享类型未登记
#       → 消费方漏分支时没有任何检查能发现（小程序音乐卡片实时不下发）。
#       反方向同样会炸：真相源删掉一个类型时，别处仍 import 它的 switch case 会编译失败
#       （2026-09-24 实测：删 'token' → admin AgentPlayground.vue 的 `case 'token'` TS2678）。
#       手工对齐只解决当下，本脚本解决复发。
#
# 三类检查：
#   A. 手写联合比对（消费方未 import 共享类型，只能对齐）  MISSING / EXTRA / LOOSE
#   B. import 共享类型的消费者，其 switch case 必须 ⊆ 真相源  EXTRA（死 case / 已删类型）
#   C. 裸 `| string` 兜底                                   LOOSE（类型检查失效）
#
# 输出：TSV  <LEVEL>\t<rule>\t<loc>\t<msg>
#   注意：msg 内**不得出现 `|`** —— scan-rules.sh 的 add_warn 用 `|` 拼四段再按 `|` 拆，
#        消息里带 `|` 会导致字段错位（评审 2026-09-24 指出）。
# 无第三方依赖；任何异常一律 exit 0，绝不阻断正常提交。
# ============================================================
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 真相源：唯一有权定义 SSE 事件类型集合的地方
SOURCE_FILE = 'packages/agent-core/src/interfaces/runtime.interface.ts'
SOURCE_MARKER = 'export type StreamEventType'

# A. 手写联合的消费方（未依赖共享类型包，只能靠对齐 + 机检）
UNION_CONSUMERS = [
    ('portal', 'apps/portal/src/api/agent.ts', 'AgentStreamEvent'),
    ('kedou-ai-minigram', 'apps/kedou-ai-minigram/services/agent-stream.ts', 'StreamEvent'),
]

# B. import 共享类型的消费者：其 switch case 必须落在真相源集合内
CASE_CONSUMERS = [
    ('admin', 'apps/admin/src/views/Agents/AgentPlayground.vue'),
]

RULE = 'R16'
MEM = r"[a-z0-9_]+"          # 事件名允许下划线与数字


def read_rel(rel):
    try:
        with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ''


def union_block(text, marker):
    """取 marker 之后到第一个分号之间的文本（联合类型体）。"""
    i = text.find(marker)
    if i < 0:
        return ''
    j = text.find(';', i)
    return text[i:j if j > 0 else len(text)]


def members(block):
    """提取联合成员：`| 'xxx'` 形式，并兼容首行内联 `type: 'xxx' | ...`。"""
    got = set(re.findall(r"\|\s*'(" + MEM + r")'", block))
    got |= set(re.findall(r"type:\s*'(" + MEM + r")'", block))
    return got


def is_loose(block):
    """裸 `| string`（非 `(string & {})`）——类型检查形同虚设。

    陷阱：不能用 `\\|\\s*string\\s*;` —— block 由 union_block 截到首个分号之前，
    末尾分号已被吃掉，带分号的模式永远不匹配（实测静默漏报）。
    `(string & {})` 因竖线后紧跟 ` (` 而天然不匹配，无需额外排除。
    """
    return re.search(r"\|\s*string\b", block) is not None


def emit(level, loc, msg):
    sys.stdout.write('%s\t%s\t%s\t%s\n' % (level, RULE, loc, msg))


def check_unions(src):
    for name, rel, marker in UNION_CONSUMERS:
        text = read_rel(rel)
        if not text:
            continue
        body = union_block(text, marker)
        if not body:
            continue
        block = union_block(body, 'type:') or body
        got = members(block)
        if not got:
            continue
        missing = sorted(src - got)
        extra = sorted(got - src)
        if missing:
            emit('MISSING', name + ' 缺 ' + str(len(missing)) + ' 项',
                 '手写 SSE 类型缺：' + ', '.join(missing))
        if extra:
            emit('EXTRA', name + ' 多 ' + str(len(extra)) + ' 项',
                 '手写 SSE 类型多出（死类型或本地事件混入契约）：' + ', '.join(extra))
        if is_loose(block):
            # 消息内不得出现竖线（见文件头说明）
            emit('LOOSE', name,
                 '用裸 string 兜底：类型检查失效，应改为「已知联合 + (string & {})」')


def check_cases(src):
    for name, rel in CASE_CONSUMERS:
        text = read_rel(rel)
        if not text:
            continue
        # 只取 `case 'xxx':` 形式，避免误收普通字符串比较
        cases = set(re.findall(r"case\s*'(" + MEM + r")'\s*:", text))
        if not cases:
            continue
        dead = sorted(cases - src)
        if dead:
            emit('EXTRA', name + ' 有 ' + str(len(dead)) + ' 个未登记 case',
                 'switch case 不在真相源集合内（类型已删或从未登记）：' + ', '.join(dead))


def main():
    src_text = read_rel(SOURCE_FILE)
    src_block = union_block(src_text, SOURCE_MARKER)
    if not src_block:
        return 0  # 取不到真相源就不检查（fail-open）
    src = members(src_block)
    if not src:
        return 0

    check_unions(src)
    check_cases(src)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write('check-sse-contract error (fail-open): %s\n' % e)
        sys.exit(0)
