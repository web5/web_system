#!/usr/bin/env python3
# ============================================================
# scan-design-drift.py — D3 实现一致性机检（P1）
#
# 设计：specs/design-reviewer/design.md §3.6（D3-a 机检层）/ §3.7.1（存量过渡）
# 判据：docs/ui/design-system.md §3.2 锚点约定 A1–A4、§7 反模式 X4/X5
#
# 用法:
#   python3 scripts/redline/scan-design-drift.py anchors [range]   # 原型锚点 vs 实现锚点
#   python3 scripts/redline/scan-design-drift.py lint <path...>    # 可机检视觉条目（本地巡检）
#
# 输出：TSV 行 —— <LEVEL>\t<规则>\t<定位>\t<说明>
#   LEVEL: MISSING / EXTRA / SKIP / ERR / INFO
# 退出码：恒 0 —— 严重级由调用方（scan-rules.sh check_r11b）按 DESIGN_ANCHOR_MODE 决定。
#   原因：本脚本同时服务 CI（严格）与本地巡检（宽松），级别不该由扫描器定。
#
# 锚点匹配口径：**按 key 全局匹配，不按文件映射**。
#   原型里 data-dr="chat.input" 只要在本 app 任一实现文件中出现即算存在——
#   避免维护「原型文件 ↔ 页面文件」映射表（维护成本高于收益，且易腐）。
# ============================================================
import os
import re
import subprocess
import sys

ANCHOR_RE = re.compile(r'data-dr="([^"]+)"')
# 可机检视觉条目
HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')
RGBA_RE = re.compile(r'rgba?\([^)]*\)')
IMPORTANT_RE = re.compile(r'!important')
WEIGHT_RE = re.compile(r'font-weight:\s*([0-9]+|bold|normal)')
EMOJI_RE = re.compile('[\U0001F300-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF]')
SPACING_RE = re.compile(r'\b(margin|padding)(-top|-right|-bottom|-left)?:\s*([^;]+);')
# 间距阶梯（admin px / 品牌端 rpx）：放宽集合，边框 1-2 与 0 不计
SPACE_OK_PX = {0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64}
SPACE_OK_RPX = {0, 2, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80}

UI_EXTS = ('.vue', '.wxml', '.wxss')
IMPL_EXTS = ('.vue', '.wxml')


def run(args, cwd=None):
    try:
        p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=30)
        return (p.returncode, p.stdout)
    except Exception:
        return (1, '')


def git_top():
    rc, out = run(['git', 'rev-parse', '--show-toplevel'])
    if rc != 0 or not out.strip():
        return os.getcwd()
    return out.strip()


def read_at(root, rel, ref='HEAD'):
    """读 git 中某版本的文件内容；未纳入 git 时回退工作区文件。"""
    rc, out = run(['git', 'show', '%s:%s' % (ref, rel)], cwd=root)
    if rc == 0:
        return out
    try:
        with open(os.path.join(root, rel), 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except Exception:
        return ''


def anchors_in(text):
    return set(ANCHOR_RE.findall(text or ''))


def emit(level, rule, loc, msg):
    sys.stdout.write('%s\t%s\t%s\t%s\n' % (level, rule, loc, msg))


# ---------------- anchors ----------------

def ls_files(root, patterns):
    rc, out = run(['git', 'ls-files', '--'] + patterns, cwd=root)
    if rc != 0:
        return []
    return [l.strip() for l in out.splitlines() if l.strip()]


def diff_files(root, rng):
    args = ['git', 'diff', '--name-only', '--no-renames']
    if rng:
        args.append(rng)
    rc, out = run(args, cwd=root)
    if rc != 0:
        return []
    return [l.strip() for l in out.splitlines() if l.strip()]


def is_ui(rel):
    if rel.endswith(UI_EXTS):
        return True
    for pat in ('apps/*/pages/*', 'apps/*/components/*', 'apps/*/src/*.vue',
                'packages/ui/*', 'app.json', 'apps/*/app.json'):
        if re.match('^' + pat.replace('*', '[^/]*').replace('.', r'\.') + '$', rel):
            return True
    return False


def app_of(rel):
    if rel.startswith('apps/'):
        parts = rel.split('/')
        if len(parts) >= 2:
            return parts[1]
    return ''


def cmd_anchors(root, rng):
    files = diff_files(root, rng) or ls_files(root, ['apps'])
    apps = sorted({a for a in (app_of(f) for f in files if is_ui(f)) if a})
    if not apps:
        emit('SKIP', 'R11b', '-', '本次 diff 无 UI 源码，跳过锚点比对')
        return 0
    for app in apps:
        proto_files = ls_files(root, ['apps/%s/prototype' % app, 'docs/ui/prototypes'])
        proto_files = [f for f in proto_files if app in f or f.startswith('apps/%s/prototype' % app)]
        impl_files = [f for f in ls_files(root, ['apps/%s' % app])
                      if f.endswith(IMPL_EXTS) and '/prototype/' not in f]
        if not proto_files:
            emit('SKIP', 'R11b', app, '无原型文件，跳过（原型缺失不是锚点漂移）')
            continue
        proto_keys, impl_keys = set(), set()
        for f in proto_files:
            proto_keys |= anchors_in(read_at(root, f))
        for f in impl_files:
            impl_keys |= anchors_in(read_at(root, f))
        if not proto_keys:
            emit('SKIP', 'R11b', app, '原型未打 data-dr（存量未回填），跳过比对 —— 未回填≠已漂移（§3.7.1）')
            continue
        missing = sorted(proto_keys - impl_keys)
        extra = sorted(impl_keys - proto_keys)
        for k in missing:
            emit('MISSING', 'R11b', '%s · %s' % (app, k), '原型锚点在实现中缺失（判据 A3 / 反模式 X9）')
        for k in extra:
            emit('EXTRA', 'R11b', '%s · %s' % (app, k), '实现锚点不在原型中 —— 新增/改名须在评审报告登记（A3）')
        if not missing and not extra:
            emit('INFO', 'R11b', app, '锚点集合一致（%d 个）' % len(proto_keys))
    return 0


# ---------------- lint（本地巡检，可机检视觉条目）----------------

def is_token_definition(line):
    s = line.strip()
    return s.startswith('--') or s.startswith('$') or s.startswith(':root') or s.startswith('page {')


def cmd_lint(root, paths):
    for rel in paths:
        full = os.path.join(root, rel)
        if not os.path.isfile(full):
            continue
        try:
            with open(full, 'r', encoding='utf-8', errors='ignore') as f:
                lines = f.readlines()
        except Exception:
            continue
        for i, line in enumerate(lines, 1):
            loc = '%s:%d' % (rel, i)
            s = line.strip()
            if not s or s.startswith('//') or s.startswith('*') or s.startswith('/*'):
                continue
            if not is_token_definition(s):
                if HEX_RE.search(s) or RGBA_RE.search(s):
                    emit('ERR', 'G1', loc, '裸 hex/rgba —— 须引 token（--ws-* / --brand* / --t1..t3）')
                if IMPORTANT_RE.search(s):
                    emit('ERR', 'X4', loc, '新增 !important（全仓库清零目标）')
            if EMOJI_RE.search(s):
                emit('ERR', 'X5', loc, 'emoji 当图标 —— 用 SVG / tabler')
            m = WEIGHT_RE.search(s)
            if m:
                v = m.group(1)
                ok = (v in ('400', '500', '600')) or (
                    v == 'normal' or (v.isdigit() and v in ('400', '500', '600')))
                if not ok:
                    emit('ERR', 'E3', loc, '字重越界（%s）—— 只允许 400/500/600' % v)
            m = SPACING_RE.search(s)
            if m:
                for tok in re.split(r'[\s]+', m.group(3).strip()):
                    mm = re.match(r'^(\d+)(px|rpx)$', tok)
                    if not mm:
                        continue
                    num, unit = int(mm.group(1)), mm.group(2)
                    ok_set = SPACE_OK_PX if unit == 'px' else SPACE_OK_RPX
                    if num not in ok_set:
                        emit('INFO', 'F1', loc, '间距 %s 不在阶梯（%s）—— 新稿须归阶梯，存量可就近归拢' % (tok, unit))
    return 0


def main():
    if len(sys.argv) < 2:
        sys.stderr.write(__doc__ or '用法: scan-design-drift.py anchors [range] | lint <path...>\n')
        return 2
    root = git_top()
    os.chdir(root)
    cmd = sys.argv[1]
    if cmd == 'anchors':
        return cmd_anchors(root, sys.argv[2] if len(sys.argv) > 2 else '')
    if cmd == 'lint':
        paths = sys.argv[2:]
        return cmd_lint(root, paths or ls_files(root, ['apps', 'packages/ui']))
    sys.stderr.write('未知子命令: %s\n' % cmd)
    return 2


if __name__ == '__main__':
    sys.exit(main())
