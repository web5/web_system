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
#   3. **门禁覆盖面会漏**：preflight 只挂在发布链路上时，入口一多就有人从旁边过去 ——
#      `npm run preview` / `npm run upload` 一度直连 scripts/preview.js / upload.js 绕过它。
#      现在这两个 npm 脚本已经是 `node scripts/publish.js <mode>`，**是**过 preflightGate 的
#      （publish.js:665-676；tests/preflight-wiring.test.ts 的绊线钉着 npm 层这条口径）。
#      🔴 别把本段当入口清单：门禁正在下沉到 preview.js / upload.js 本体，哪条路仍绕
#         以 scripts/preflight.js 的入口清单与那条绊线测试为准（条目会变，本段不追）。
#   4. **二维码文件名固定**：`.ci-output/cli-preview-qr.png` 30 分钟内被覆盖 3 次，
#      任何引用该路径的文档/消息瞬间过期（"我扫了怎么还是旧版本"）。
#
#   这个脚本把「目录 / 版本 / sha / CLI / 门禁 / 留证」六件事压成一条命令，
#   并把结论打成**一行机读 JSON**（S6），让下游（人、文档、聊天记录）都能核对同一份事实。
#
# 用法：
#   ./scripts/release-one-shot.sh --mode preview|upload --version 1.0.18 \
#       --require-dir '^web_system-1018-r2$' [选项]
#
#   --mode        preview（出预览码）| upload（上传开发版本）  必填
#   --version     期望版本号，如 1.0.18                        必填
#   --require-dir 本轮发布 worktree 顶层名的正则（ERE）**必填、无默认**。
#                 例：'^web_system-1018-r2$'。同一条正则同时喂给
#                 S1/S4 的 preflight P4 与 S2 目录硬检 —— 一处声明、三处使用。
#                 🔴 别写 '^web_system-1018$' 就了事：那是 1.0.18 旧树（019d282b），
#                    包已提审，从旧树再出码 = 事故。轮次要写死（-r2 / -r3 …）。
#   --expect-sha  期望 HEAD 短 sha，如 47f74ba8                强烈建议
#   --desc        upload 的开发版本描述（原样透传 publish.js）
#   --force-dir   跳过 S2 目录硬检 + 把 P4 降为告警，值为「为什么必须在这个目录出码」的
#                 理由（会写进 S6 的 forcedDir）
#   --no-push     preview 时透传 --no-push（只出码，不推企微群）
#   -h, --help    打印本说明
#
# 流程（任一步失败立刻退出，不继续）：
#   前置 补齐 WECHAT_DEVTOOLS_CLI（未设则回落官方安装路径）并校验可执行
#        —— 必须在 S1 之前。preflight 的 P6 要求「CLI 存在且可执行」，而
#        `WECHAT_DEVTOOLS_CLI` 的默认状态就是「未设置」；先跑 S1 的话 P6 会把
#        「缺环境变量」判成出码失败，S3 永远跑不到，正好复现「缺 env 被读成出码失败」那个旧坑。
#   S0  切到脚本自身所在 app 目录（无视外部 cwd），打印 PWD=
#   S1  node scripts/preflight.js --root . --require-dir <正则> [--expect-sha X] [--expect-version V]，
#       失败即退
#   S2  目录硬检：worktree 顶层名不匹配 --require-dir 的正则 且未传 --force-dir → 直接拒跑
#   S3  确认 CLI 已就绪（前置步骤已补齐，此处只回报结论）
#   S4  node scripts/publish.js <mode> --require-dir <正则> [--desc ...] [--expect-sha ...] [--no-push]
#   S5  实测二维码 sha256 / 有效期（现算剩余分钟），三行固定格式 [QR] ...
#   S6  一行机读结论 JSON（EVIDENCE_LOCKED / reason / qr / requiredDir / forcedDir …）
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
# 前置步骤仍然要求该路径可执行，否则直接退出。
WECHAT_DEVTOOLS_CLI_DEFAULT="${WECHAT_DEVTOOLS_CLI_DEFAULT:-/Applications/wechatwebdevtools.app/Contents/MacOS/cli}"

# 目录判据：**一处定义、三处使用**（S1/S4 的 preflight P4 + S2 目录硬检）。
# 由 --require-dir 必填注入，脚本**不提供默认值** —— 发布轮次是人的决定，脚本不猜。
# 唯一注入点是 REQUIRE_DIR 这个变量；下面不再有第二份判据（旧版的 RELEASE_DIR_TOKEN
# 子串常量已删除：它和 preflight P4 的正则是两套规矩，同一条规矩写两份必漂）。
REQUIRE_DIR=""

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
RESOLVED_CLI=""
QR_PATH=""
QR_SHA=""
QR_EXPIRE=""

usage() {
  sed -n '2,120p' "${BASH_SOURCE[0]}" | sed -n '/^# 用法：/,/^# 边界：/p' | sed 's/^# \{0,1\}//'
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
  ROS_REQUIRED_DIR="$REQUIRE_DIR" \
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
      requiredDir: e.ROS_REQUIRED_DIR || null,
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
    --require-dir) need_value "$1" "$#"; REQUIRE_DIR="$2"; shift 2 ;;
    --require-dir=*) REQUIRE_DIR="${1#*=}"; shift ;;
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

# 🔴 --require-dir 必填、无默认：目录判据必须是人的显式决定。
#    不给默认值的两个理由：
#      1. 任何「内置默认」都会让脚本替人做发布决策，且默认值一旦写进文档就再也追不上轮次
#         （本轮实证：文档里的 web_system-1018 指向 1.0.18 旧树 019d282b）。
#      2. 脚本**没有能力**从 --version 推出任务号/轮次（1.0.18 → 1018 只是巧合，
#         工作区里还有 web_system-9027 这种不以版本号命名的 worktree），猜错比不猜更危险。
if [ -z "$REQUIRE_DIR" ]; then
  die "缺少 --require-dir（本轮发布 worktree 顶层名的正则，例：--require-dir '^web_system-1018-r2$'）。
本脚本不接受默认值。常见写法：'^web_system-1018-r2\$'。
🔴 不要写 '^web_system-1018\$'：那是 1.0.18 旧树（019d282b），包已提审，从旧树再出码 = 事故。"
fi

# 正则先在这里编译一次：否则非法正则会一路走到 preflight 的 new RegExp 抛异常，
# 报错信息是 JS 堆栈而不是「你的正则写错了」。
if ! node -e 'new RegExp(process.argv[1]);' "$REQUIRE_DIR" 2>/dev/null; then
  die "--require-dir 不是合法正则：${REQUIRE_DIR}（这是 ERE/JS 正则，例：^web_system-1018-r2\$）"
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

# ---------------------------------------------------------------- 前置：CLI 补齐
#
# 🔴 必须在 S1 之前：preflight 的 P6 要求「WECHAT_DEVTOOLS_CLI 存在且可执行」，
#    而该变量的默认状态就是「未设置」。若把这段放在 S1 之后，第一次出码必然在 P6 红，
#    人看到的是「出码前检查未通过」，真实原因却只是「环境变量没设」—— 这就是
#    「缺 env 被读成出码失败」那个旧坑（来源：oneshot 树的未提交 WIP，本轮落地为正式顺序）。

if [ -z "${WECHAT_DEVTOOLS_CLI:-}" ]; then
  WECHAT_DEVTOOLS_CLI="$WECHAT_DEVTOOLS_CLI_DEFAULT"
  export WECHAT_DEVTOOLS_CLI
  echo "[CLI] WECHAT_DEVTOOLS_CLI 未设置，回落官方安装路径：$WECHAT_DEVTOOLS_CLI"
  if [ ! -x "$WECHAT_DEVTOOLS_CLI" ]; then
    die "CLI 前置：回落的开发者工具 CLI 不可执行：${WECHAT_DEVTOOLS_CLI}（装好微信开发者工具，或用 WECHAT_DEVTOOLS_CLI=<路径> 显式指定）"
  fi
else
  echo "[CLI] WECHAT_DEVTOOLS_CLI=${WECHAT_DEVTOOLS_CLI}（来自环境变量）"
  if [ ! -x "$WECHAT_DEVTOOLS_CLI" ]; then
    die "CLI 前置：WECHAT_DEVTOOLS_CLI 指向的文件不可执行：$WECHAT_DEVTOOLS_CLI"
  fi
fi
RESOLVED_CLI="$WECHAT_DEVTOOLS_CLI"
echo "[CLI] CLI 就绪：${RESOLVED_CLI}（P6 会用同一个变量再核一次）"

# ---------------------------------------------------------------- 目录判据（唯一注入点）
#
# --force-dir 的语义要保住：它跳过 S2，并把 P4 降为告警（否则 S1 的 P4 会先把它拦掉，
# 「跳过」就变成假的）。两个方向都从这一个决定出发 —— 不再有第二份判据。
if [ "$FORCE_DIR_GIVEN" -eq 1 ]; then
  dir_gate_args=(--allow-any-dir)
else
  dir_gate_args=(--require-dir "$REQUIRE_DIR")
fi

# ---------------------------------------------------------------- S1 preflight

echo "[S1] 出码前预检（preflight）…"
echo "[S1] 目录判据（同时给 P4 与 S2 用）：/${REQUIRE_DIR}/"
# 提醒：这条正则如果也覆盖 1.0.18 旧树，就等于把「已提审的旧包」放回了白名单。
if [[ "web_system-1018" =~ $REQUIRE_DIR ]]; then
  echo "[S1] 提示：本次 --require-dir 也匹配 web_system-1018（1.0.18 旧树 019d282b，包已提审）；"
  echo "[S1]       若本轮不该从旧树出码，请把轮次写死（如 '^web_system-1018-r2\$'）。"
fi

preflight_args=(--root .)
if [ -n "$EXPECT_SHA" ]; then preflight_args+=(--expect-sha "$EXPECT_SHA"); fi
# 版本也交给 preflight 判：package.json 与 utils/version.ts 的 APP_VERSION 都必须等于 --version。
# 少这一项，「包 1.0.19、关于页显示 1.0.18」这类错位就只能靠人眼看出来。
preflight_args+=(--expect-version "$VERSION")
# 目录判据：与 S2 同一条正则（一处定义、两处使用）。
preflight_args+=("${dir_gate_args[@]}")

if ! node scripts/preflight.js "${preflight_args[@]}"; then
  PREFLIGHT_RESULT="fail"
  die "S1 preflight 未通过（失败项见上方 [Preflight] 输出；本脚本不提供跳过开关，--skip-preflight 也不透传）。
若失败项是 [P4] 目录，两条正常出路：① 换到本轮发布 worktree；② 确认必须在这个目录出码，
用 --force-dir \"为什么只能在这里\"（会写进 S6 的 forcedDir，并跳过 S2 目录硬检）。"
fi
PREFLIGHT_RESULT="pass"
echo "[S1] preflight 通过"

# ---------------------------------------------------------------- S2 目录硬检

# 判 worktree **顶层名**，不是包目录名（apps/dachengzi-minigram 在每个 worktree 里都一样，判它等于不判）。
# 取法与 preflight 的 pickProjectName 一致：优先 git toplevel，读不到再按 apps/<pkg> 上两级算。
WORKTREE_TOP="$(git -C "$APP_ROOT" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$WORKTREE_TOP" ]; then
  WORKTREE_TOP="$(cd "${APP_ROOT}/../.." && pwd)"
fi
WORKTREE_NAME="$(basename "$WORKTREE_TOP")"

# 为什么 S1 已经用同一正则判过了，S2 还要再判一次：
#   脚本会被拷到别的 worktree 里跑，那边的 scripts/preflight.js 可能还是**没有 P4 硬拦 /
#   不认 --require-dir 的旧版本** —— 那种情况下 S1 会静默放过未知参数，只剩 S2 兜。
#   两道用的是同一条正则（唯一注入点 REQUIRE_DIR），所以不会各说各话。
if [ "$FORCE_DIR_GIVEN" -eq 0 ] && ! [[ "$WORKTREE_NAME" =~ $REQUIRE_DIR ]]; then
  cat >&2 <<EOF

[Dir] ❌ 目录硬检未通过，已拒绝出码
[Dir]    当前 worktree 顶层名：${WORKTREE_NAME}
[Dir]    当前目录：$PWD
[Dir]    判据：顶层名必须匹配 /${REQUIRE_DIR}/（与 S1 的 preflight P4 同一条正则）
[Dir]
[Dir]    为什么这条线必须硬：
[Dir]      /Users/geekwen/workspace/web_system-dachengzi 这个目录，分支叫
[Dir]      devtools/dachengzi-preview（名字最像「给大橙子出预览码的地方」），
[Dir]      但内容是 1.0.14（比当前基线差 112 个文件），包根还躺着一个真实 private.key。
[Dir]      在那里出码 = 发出去 1.0.14 旧包（微信不支持回退已发版本）+ 私钥随包外发。
[Dir]      分支名好听不代表代码是对的，目录名好听也不代表。
[Dir]
[Dir]    正确做法：切到本轮发布 worktree（如 web_system-1018-r2）再跑本脚本，
[Dir]               并用 --require-dir 把轮次写死（如 '^web_system-1018-r2\$'）。
[Dir]    确认必须在当前目录硬出：加 --force-dir "为什么只能在这里"，
[Dir]    该理由会写进 S6 机读结论的 forcedDir 字段，事后可追。
EOF
  die "S2 目录硬检未通过：worktree 顶层名 ${WORKTREE_NAME} 不匹配 /${REQUIRE_DIR}/，且未传 --force-dir"
fi

if [ "$FORCE_DIR_GIVEN" -eq 1 ]; then
  echo "[S2] ⚠️⚠️ 目录硬检已被 --force-dir 跳过（S1 的 P4 同时降为告警）"
  echo "[S2] ⚠️⚠️ 理由：${FORCE_DIR}"
  echo "[S2] ⚠️⚠️ 该理由会写进 S6 的 forcedDir 字段。发布后若发现站错目录，据此追责。"
else
  echo "[S2] 目录硬检通过：${WORKTREE_NAME} 匹配 /${REQUIRE_DIR}/"
fi

# ---------------------------------------------------------------- S3 CLI 确认

# 补齐/校验已在「前置」做完，这里只把结论再报一次（不改任何状态），
# 让日志里仍有一个显式的「CLI 就绪」锚点。
if [ -z "$RESOLVED_CLI" ]; then
  die "S3 内部错误：CLI 前置步骤没有跑（RESOLVED_CLI 为空）"
fi
if [ ! -x "$RESOLVED_CLI" ]; then
  die "S3 CLI 在 S1/S2 执行期间变得不可执行：$RESOLVED_CLI"
fi
echo "[S3] CLI 就绪：$RESOLVED_CLI"

# ---------------------------------------------------------------- S4 publish

pub_args=("$MODE")
if [ -n "$DESC" ]; then pub_args+=(--desc "$DESC"); fi
# preflight 再核一次 sha：S1 与 S4 之间理论上不可能变，但同一条命令里两道锁没有代价。
if [ -n "$EXPECT_SHA" ]; then pub_args+=(--expect-sha "$EXPECT_SHA"); fi
# 目录判据跟着一起下去：publish.js 的 preflightGate 会再跑一遍 P4，
# 不给它同一条正则的话，S1 放行的目录（比如任务号不在默认白名单里的）会在 S4 被二次判红。
pub_args+=("${dir_gate_args[@]}")
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
    die "S5 找不到二维码元信息：${QR_META}（剩余有效期无法计算，拒绝编造）"
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
