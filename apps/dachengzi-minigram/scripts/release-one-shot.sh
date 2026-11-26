#!/usr/bin/env bash
#
# release-one-shot.sh —— 大橙子小程序「唯一发布入口」
#
# 🔴 为什么要有这个脚本（本轮 1.0.18-r2 发布实证的四种失效）：
#   1. **文档里的命令会过期**：`14-出码链路探活与可执行命令单.md` 尾部的出码命令写的是
#      `cd .../web_system-1018/...`（1.0.18 第一版 019d282b），而实际要发的是 r2（47f74ba8）。
#      照抄 = 从旧树出旧包。命令一旦被复制到别处，就再也追不上代码。
#   2. **站错目录**：工作区里 `web_system-dachengzi`（分支 devtools/dachengzi-preview，
#      内容 1.0.14，包根有真实 private.key）名字最像「该出码的地方」。已有人在那改过文件。
#   3. **门禁能被绕过**：`npm run preview` / `npm run upload` 直连 scripts/preview.js /
#      scripts/upload.js，不经过 scripts/publish.js 里的 preflight 检查。
#   4. **二维码文件名固定**：`.ci-output/cli-preview-qr.png` 30 分钟内被覆盖 3 次，
#      任何引用该路径的文档/消息瞬间过期（"我扫了怎么还是旧版本"）。
#
#   这个脚本把「目录 / 版本 / sha / CLI / 门禁 / 留证」六件事压成一条命令，
#   并把结论打成**一行机读 JSON**（S6），让下游（人、文档、聊天记录）都能核对同一份事实。
#
# 用法：
#   ./scripts/release-one-shot.sh --mode preview|upload --version 1.0.18 [选项]
#
#   --mode        preview（出预览码）| upload（上传开发版本）  必填
#   --version     期望版本号，如 1.0.18                        必填
#   --expect-sha  期望 HEAD 短 sha，如 47f74ba8                强烈建议
#   --desc        upload 的开发版本描述（原样透传 publish.js）
#   --force-dir   跳过 S2 目录硬检，值为「为什么必须在这个目录出码」的理由（会写进 S6）
#   --no-push     preview 时透传 --no-push（只出码，不推企微群）
#   -h, --help    打印本说明
#
# 六步流程（任一步失败立刻退出，不继续）：
#   S0  切到脚本自身所在 app 目录（无视外部 cwd），打印 PWD=
#   S1  node scripts/preflight.js --root . [--expect-sha X] [--expect-version V]，失败即退
#   S2  目录硬检：路径不含 web_system-1018 且未传 --force-dir → 直接拒跑
#   S3  补齐 WECHAT_DEVTOOLS_CLI（未设则回落官方安装路径），并校验可执行
#   S4  node scripts/publish.js <mode> [--desc ...] [--expect-sha ...] [--no-push]
#   S5  实测二维码 sha256 / 有效期（现算剩余分钟），三行固定格式 [QR] ...
#   S6  一行机读结论 JSON（EVIDENCE_LOCKED / reason / qr / forcedDir …）
#
# 边界：本脚本只到「出预览码 / 上传开发版本」为止。设为体验版、提交审核、发布正式版
#      微信不向自建小程序开放接口，必须人工在公众平台操作 —— 脚本不代做、也不自称已推进。
#
# 兼容：macOS 自带 bash 3.2（不用 bash 4 才有的语法）；零第三方依赖，只用 node / git / shasum。

set -euo pipefail

# ---------------------------------------------------------------- 常量与状态

# S0 的锚点：脚本自身位置，不受调用方 cwd 影响。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 官方安装路径。仅当环境变量 WECHAT_DEVTOOLS_CLI 为空时才用。
# WECHAT_DEVTOOLS_CLI_DEFAULT 只是「换一个安装位置」的提示，不是绕过门禁的开关：
# S3 仍然要求该路径可执行，否则直接退出。
WECHAT_DEVTOOLS_CLI_DEFAULT="${WECHAT_DEVTOOLS_CLI_DEFAULT:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"

# 目录硬检的判据子串。发布 worktree 一律用任务号命名（web_system-1018 / web_system-1018-r2）。
RELEASE_DIR_TOKEN="web_system-1018"

# 状态（set -u 下必须先初始化，die() 可能在 S0 之前被调用）
MODE=""
VERSION=""
EXPECT_SHA=""
DESC=""
FORCE_DIR=""
FORCE_DIR_GIVEN=0
NO_PUSH=0
HEAD_SHA=""
PREFLIGHT_RESULT="not-run"
QR_PATH=""
QR_SHA=""
QR_EXPIRE=""

usage() {
  sed -n '2,60p' "${BASH_SOURCE[0]}" | sed -n '/^# 用法：/,/^# 边界：/p' | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------- 机读结论（S6）

# 用 node 拼 JSON：bash 手写转义在路径含空格/引号/中文时容易出错，
# 而 node 本来就是这个脚本的硬依赖。
emit_s6() {
  local locked="$1" reason="$2"
  ROS_LOCKED="$locked" \
  ROS_REASON="$reason" \
  ROS_PREFLIGHT="$PREFLIGHT_RESULT" \
  ROS_MODE="$MODE" \
  ROS_VERSION="$VERSION" \
  ROS_SHA="$HEAD_SHA" \
  ROS_QR_PATH="$QR_PATH" \
  ROS_QR_SHA="$QR_SHA" \
  ROS_QR_EXPIRE="$QR_EXPIRE" \
  ROS_FORCED="$FORCE_DIR" \
  node -e '
    const e = process.env;
    const out = {
      EVIDENCE_LOCKED: e.ROS_LOCKED === "true",
      mode: e.ROS_MODE || null,
      version: e.ROS_VERSION || null,
      gitSha: e.ROS_SHA || null,
      qr: e.ROS_QR_PATH
        ? { path: e.ROS_QR_PATH, sha256: e.ROS_QR_SHA || null, expireAt: e.ROS_QR_EXPIRE || null }
        : null,
      preflight: e.ROS_PREFLIGHT || "not-run",
      forcedDir: e.ROS_FORCED ? e.ROS_FORCED : null,
    };
    if (e.ROS_REASON) out.reason = e.ROS_REASON;
    process.stdout.write(JSON.stringify(out) + "\n");
  '
}

# 任何一步失败都走这里：打人读原因 + 打机读结论（EVIDENCE_LOCKED:false），然后退出 1。
die() {
  local reason="$1"
  if [ -z "$HEAD_SHA" ]; then HEAD_SHA="$(head_sha8 || true)"; fi
  echo "[ONE-SHOT] ❌ ${reason}" >&2
  emit_s6 "false" "$reason" >&2
  exit 1
}

# 当前 HEAD 前 8 位。读不到就给 unknown（不阻断：git 身份由 S1 的 P3 负责判定）。
head_sha8() {
  git -C "$APP_ROOT" rev-parse --short=8 --verify HEAD 2>/dev/null || echo "unknown"
}

# 真算 sha256（不从文件名/时间猜）。
sha256_of() {
  local f="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | awk '{print $1}'
  else
    die "S5 找不到 shasum 或 sha256sum，无法实测二维码摘要"
  fi
}

# ---------------------------------------------------------------- 参数解析

need_value() { # $1=flag  $2=剩余参数个数
  if [ "$2" -lt 2 ]; then die "参数 $1 缺少取值"; fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode)        need_value "$1" "$#"; MODE="$2"; shift 2 ;;
    --mode=*)      MODE="${1#*=}"; shift ;;
    --version)     need_value "$1" "$#"; VERSION="$2"; shift 2 ;;
    --version=*)   VERSION="${1#*=}"; shift ;;
    --expect-sha)  need_value "$1" "$#"; EXPECT_SHA="$2"; shift 2 ;;
    --expect-sha=*) EXPECT_SHA="${1#*=}"; shift ;;
    --desc)        need_value "$1" "$#"; DESC="$2"; shift 2 ;;
    --desc=*)      DESC="${1#*=}"; shift ;;
    --force-dir)   need_value "$1" "$#"; FORCE_DIR="$2"; FORCE_DIR_GIVEN=1; shift 2 ;;
    --force-dir=*) FORCE_DIR="${1#*=}"; FORCE_DIR_GIVEN=1; shift ;;
    --no-push)     NO_PUSH=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

case "$MODE" in
  preview|upload) ;;
  "") die "缺少 --mode（preview|upload）" ;;
  *)  die "未知 --mode「${MODE}」，仅支持 preview|upload" ;;
esac

if [ -z "$VERSION" ]; then
  die "缺少 --version（例：--version 1.0.18）"
fi

if [ -n "$FORCE_DIR" ] && [ "${#FORCE_DIR}" -lt 4 ]; then
  die "--force-dir 的理由太短（「${FORCE_DIR}」）：至少写 4 个字，说清为什么必须在这个目录出码"
fi

# ---------------------------------------------------------------- S0 锚定目录

cd "$APP_ROOT"
echo "[S0] PWD=$PWD"
echo "[S0] 版本=${VERSION} 模式=${MODE} 期望sha=${EXPECT_SHA:-（未声明）}"
HEAD_SHA="$(head_sha8)"
echo "[S0] HEAD=${HEAD_SHA}"

# ---------------------------------------------------------------- S1 preflight

echo "[S1] 出码前预检（preflight）…"
preflight_args=(--root .)
if [ -n "$EXPECT_SHA" ]; then preflight_args+=(--expect-sha "$EXPECT_SHA"); fi
# 版本也交给 preflight 判：package.json 与 utils/version.ts 的 APP_VERSION 都必须等于 --version。
# 少这一项，「包 1.0.19、关于页显示 1.0.18」这类错位就只能靠人眼看出来。
preflight_args+=(--expect-version "$VERSION")

if ! node scripts/preflight.js "${preflight_args[@]}"; then
  PREFLIGHT_RESULT="fail"
  die "S1 preflight 未通过（失败项见上方 [Preflight] 输出；本脚本不提供跳过开关，--skip-preflight 也不透传）"
fi
PREFLIGHT_RESULT="pass"
echo "[S1] preflight 通过"

# ---------------------------------------------------------------- S2 目录硬检

if [ "$FORCE_DIR_GIVEN" -eq 0 ] && [[ "$PWD" != *"$RELEASE_DIR_TOKEN"* ]]; then
  cat >&2 <<EOF

[Dir] ❌ 目录硬检未通过，已拒绝出码
[Dir]    当前目录：$PWD
[Dir]    判据：路径必须包含「${RELEASE_DIR_TOKEN}」（发布 worktree 一律用任务号命名）
[Dir]
[Dir]    为什么这条线必须硬：
[Dir]      /Users/geekwen/workspace/web_system-dachengzi 这个目录，分支叫
[Dir]      devtools/dachengzi-preview（名字最像「给大橙子出预览码的地方」），
[Dir]      但内容是 1.0.14（比当前基线差 112 个文件），包根还躺着一个真实 private.key。
[Dir]      在那里出码 = 发出去 1.0.14 旧包（微信不支持回退已发版本）+ 私钥随包外发。
[Dir]      分支名好听不代表代码是对的，目录名好听也不代表。
[Dir]
[Dir]    正确做法：切到 web_system-1018 / web_system-1018-r2 这类发布 worktree 再跑本脚本。
[Dir]    确认必须在当前目录硬出：加 --force-dir "为什么只能在这里"，
[Dir]    该理由会写进 S6 机读结论的 forcedDir 字段，事后可追。
EOF
  die "S2 目录硬检未通过：$PWD 不含 ${RELEASE_DIR_TOKEN}，且未传 --force-dir"
fi

if [ "$FORCE_DIR_GIVEN" -eq 1 ]; then
  echo "[S2] ⚠️⚠️ 目录硬检已被 --force-dir 跳过"
  echo "[S2] ⚠️⚠️ 理由：${FORCE_DIR}"
  echo "[S2] ⚠️⚠️ 该理由会写进 S6 的 forcedDir 字段。发布后若发现站错目录，据此追责。"
else
  echo "[S2] 目录硬检通过：$PWD"
fi

# ---------------------------------------------------------------- S3 CLI 二进制

if [ -z "${WECHAT_DEVTOOLS_CLI:-}" ]; then
  WECHAT_DEVTOOLS_CLI="$WECHAT_DEVTOOLS_CLI_DEFAULT"
  export WECHAT_DEVTOOLS_CLI
  echo "[S3] WECHAT_DEVTOOLS_CLI 未设置，回落官方安装路径：$WECHAT_DEVTOOLS_CLI"
  if [ ! -x "$WECHAT_DEVTOOLS_CLI" ]; then
    die "S3 回落的 CLI 不可执行：$WECHAT_DEVTOOLS_CLI（装好微信开发者工具，或用 WECHAT_DEVTOOLS_CLI=<路径> 显式指定）"
  fi
else
  echo "[S3] WECHAT_DEVTOOLS_CLI=${WECHAT_DEVTOOLS_CLI}（来自环境变量）"
  if [ ! -x "$WECHAT_DEVTOOLS_CLI" ]; then
    die "S3 WECHAT_DEVTOOLS_CLI 指向的文件不可执行：$WECHAT_DEVTOOLS_CLI"
  fi
fi
echo "[S3] CLI 就绪：$WECHAT_DEVTOOLS_CLI"

# ---------------------------------------------------------------- S4 publish

pub_args=("$MODE")
if [ -n "$DESC" ]; then pub_args+=(--desc "$DESC"); fi
# preflight 再核一次 sha：S1 与 S4 之间理论上不可能变，但同一条命令里两道锁没有代价。
if [ -n "$EXPECT_SHA" ]; then pub_args+=(--expect-sha "$EXPECT_SHA"); fi
if [ "$NO_PUSH" -eq 1 ]; then pub_args+=(--no-push); fi

echo "[S4] 执行：node scripts/publish.js ${pub_args[*]}"
if ! node scripts/publish.js "${pub_args[@]}"; then
  die "S4 publish.js ${MODE} 失败（退出码非 0，详见上方 [Publish] 输出）"
fi
echo "[S4] publish.js ${MODE} 成功"

# ---------------------------------------------------------------- S5 留证（真算）

if [ "$MODE" = "preview" ]; then
  # cli 模式固定写 cli-preview-qr.png；--mode ci 那一路写 preview-qr.png。
  # 本脚本不透传 --mode，正常只会命中前者；后者作为兜底，避免「码出了却报失败」。
  if [ -f ".ci-output/cli-preview-qr.png" ]; then
    QR_PATH="$PWD/.ci-output/cli-preview-qr.png"
  elif [ -f ".ci-output/preview-qr.png" ]; then
    QR_PATH="$PWD/.ci-output/preview-qr.png"
  else
    die "S5 出码成功但找不到二维码文件（已找 .ci-output/cli-preview-qr.png 与 .ci-output/preview-qr.png）"
  fi
  QR_META="${QR_PATH%.png}.meta.json"
  if [ ! -f "$QR_META" ]; then
    die "S5 找不到二维码元信息：$QR_META（剩余有效期无法计算，拒绝编造）"
  fi

  QR_SHA="$(sha256_of "$QR_PATH")"

  # expireAtText / expireAtMs 由 publish.js 写入；remaining 在这里**现算**，
  # 不写死、不抄文档 —— 30 分钟内被覆盖 3 次的教训就是「文档里的分钟数一定过期」。
  meta_line="$(node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const ms = Number(m.expireAtMs || 0);
    const rem = ms ? Math.round((ms - Date.now()) / 60000) : NaN;
    process.stdout.write(
      String(m.expireAtText || m.expireAt || "?") + "\t" +
      String(m.version || "") + "\t" +
      (Number.isFinite(rem) ? String(rem) : "?")
    );
  ' "$QR_META")"
  IFS=$'\t' read -r QR_EXPIRE META_VERSION REMAINING_MIN <<<"$meta_line" || true

  if [ -n "${META_VERSION:-}" ] && [ "$META_VERSION" != "$VERSION" ]; then
    die "S5 二维码版本(${META_VERSION}) 与 --version(${VERSION}) 不一致，拒绝出具结论"
  fi

  echo "[QR] path=${QR_PATH}"
  echo "[QR] sha256=${QR_SHA}"
  echo "[QR] expireAt=${QR_EXPIRE} remaining=${REMAINING_MIN:-?}"
  echo "[QR] 归档提示：把这个 sha256 连同结论 JSON 一起留档；不要把 .ci-output/ 的固定路径当凭证（会被下次出码覆盖）"
else
  echo "[S5] upload 已完成：版本 ${VERSION} · HEAD ${HEAD_SHA} · 描述=${DESC:-（默认格式）}"
  echo "[S5] 后续「设为体验版 / 提交审核 / 发布正式版」须人工在微信公众平台操作，本脚本不代做"
fi

# ---------------------------------------------------------------- S6 机读结论

echo "[S6] 机读结论（单行 JSON）："
emit_s6 "true" ""
exit 0
