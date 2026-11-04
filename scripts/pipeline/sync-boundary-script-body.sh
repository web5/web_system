#!/usr/bin/env bash
# ============================================================
# 边界脚本正文巡检 / 同步（upload-remote.sh / clean-remote.sh → deploy_pipeline_step_commands）
#
# 背景（Phase 2 CDN 化）：
#   仓库里的 upload-remote.sh / clean-remote.sh 是「模板副本」，真正执行的正文在 DB
#   （deploy_pipeline_step_commands，nodeKey=upload/cleanup）。改模板不改 DB = 线上仍按旧布局，
#   是过往最容易踩的坑（方案 §5「DB 脚本是数据」）。
#   本脚本回答两件事：① 两库现在有没有 upload/cleanup 脚本正文、跟模板是否一致（巡检）；
#   ② 发布窗口时把模板正文安全地同步进 DB（base64 规避转义，人工审 SQL 后执行）。
#
# 用法：
#   ./sync-boundary-script-body.sh --check    只读巡检（默认）
#   ./sync-boundary-script-body.sh --gen-sql  生成同步 SQL 到 /tmp（不执行）
#   ./sync-boundary-script-body.sh --apply    仅提示人工审 SQL，不自动执行线上写
#
# 凭证：只读远端 `.env` 里的 DB 连接（与 verify-phase2.sh 同源），不打印、不落盘。
# ============================================================
set -euo pipefail

MODE="${1:---check}"
KEY="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519_servers}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_OUT="${SYNC_SQL_OUT:-/tmp/sync-boundary-script-body.sql}"
UPLOAD_TPL="$SCRIPT_DIR/upload-remote.sh"
CLEAN_TPL="$SCRIPT_DIR/clean-remote.sh"

log() { echo "[sync:boundary] $*"; }
die() { echo "[sync:boundary] $*" >&2; exit 1; }

# ── 只读巡检：ssh 到目标机 → 读 .env → 发现库 → 查 upload/cleanup 正文 ──────
# 输出 NODE 行（db + node_key 分布）与 DETAIL 行（upload/cleanup 的 pipeline_id + sha256）。
# 不打印任何凭证 / 正文。
check_host() {
  local alias="$1"
  ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 "$alias" 'python3 - <<"PY"
import os,re,subprocess,hashlib
cfg={}
for f in ["/data/web_system/.env.production","/data/web_system/.env"]:
    try:
        for line in open(f,encoding="utf-8",errors="replace"):
            if line.lstrip().startswith("#"): continue
            m=re.match(r"^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$",line)
            if m: cfg.setdefault(m.group(1), m.group(2).strip().strip("\"").strip("\x27"))
    except IOError: pass
host=cfg.get("DB_HOST") or cfg.get("MYSQL_HOST") or cfg.get("DEPLOY_DB_HOST") or "127.0.0.1"
port=cfg.get("DB_PORT") or cfg.get("MYSQL_PORT") or cfg.get("DEPLOY_DB_PORT") or "3306"
user=cfg.get("DB_USERNAME") or cfg.get("MYSQL_USER") or cfg.get("DEPLOY_DB_USER") or "root"
pwd=cfg.get("DB_PASSWORD") or cfg.get("MYSQL_PASSWORD") or cfg.get("DEPLOY_DB_PASSWORD") or ""
env=dict(os.environ); env["MYSQL_PWD"]=pwd
q0="SELECT table_schema FROM information_schema.tables WHERE table_name=\"deploy_pipeline_step_commands\""
r0=subprocess.run(["mysql","-h",host,"-P",str(port),"-u",user,"-N","-e",q0],env=env,
                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
dbs=[x for x in r0.stdout.decode("utf-8","replace").strip().splitlines() if x]
for db in dbs:
    q=("SELECT node_key, COUNT(*), SUM(LENGTH(command)), SUM(actions IS NOT NULL), SUM(enabled) "
       "FROM %s.deploy_pipeline_step_commands GROUP BY node_key ORDER BY node_key")%db
    try:
        r=subprocess.run(["mysql","-h",host,"-P",str(port),"-u",user,db,"-N","-e",q],env=env,
                         stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
        out=r.stdout.decode("utf-8","replace").strip()
        for line in out.splitlines():
            f=line.split("\t")
            print("NODE\t%s\t%s\t%s"%(db,f[0],"\t".join(f[1:]) if len(f)>1 else ""))
        for nk in ("upload","cleanup"):
            q2=("SELECT pipeline_id, command FROM %s.deploy_pipeline_step_commands "
                "WHERE node_key=\"%s\" ORDER BY pipeline_id")%(db,nk)
            r2=subprocess.run(["mysql","-h",host,"-P",str(port),"-u",user,db,"-N","-e",q2],env=env,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
            for line in r2.stdout.decode("utf-8","replace").strip().splitlines():
                parts=line.split("\t")
                if len(parts)>=2:
                    h=hashlib.sha256(parts[1].encode("utf-8")).hexdigest()[:16]
                    print("DETAIL\t%s\t%s\t%s\t%s"%(db,nk,parts[0],h))
    except Exception as e:
        print("EXC\t%s\t%s"%(db,e))
PY'
}

tpl_sha() { shasum -a 256 "$1" | cut -c1-16; }

case "$MODE" in
  --check)
    log "只读巡检：两库 upload/cleanup 脚本正文现状"
    for a in kedou-dev kedou-prod; do
      echo "===== $a ====="
      check_host "$a"
    done
    echo ""
    log "模板正文 sha256：upload=$(tpl_sha "$UPLOAD_TPL")  clean=$(tpl_sha "$CLEAN_TPL")"
    log "判读：NODE 行若没有 upload/cleanup，说明该库 upload/cleanup 走平台内置执行体，无脚本正文需同步。"
    log "      DETAIL 行的 sha256 与模板一致 = 已同步；不一致 = 待同步（发布窗口 --gen-sql 后审 SQL）。"
    ;;
  --gen-sql)
    log "生成同步 SQL（base64 规避转义，不执行）"
    { echo "-- 边界脚本正文同步（生成于 $(date '+%F %T')）"
      echo "-- 语义：把 upload/cleanup 节点正文统一为仓库模板（base64 解码后写入）"
      echo "-- ⚠️ 发布窗口人工审后执行；当前两库无 upload/cleanup 记录时 UPDATE 影响 0 行（幂等安全）"
      echo ""
      for tpl in "upload:upload-remote.sh" "clean:clean-remote.sh"; do
        nk="${tpl%%:*}"; f="${tpl##*:}"
        b64=$(base64 < "$SCRIPT_DIR/$f" | tr -d '\n')
        echo "-- ${nk} ← ${f}"
        echo "UPDATE deploy_pipeline_step_commands SET command = FROM_BASE64('${b64}'), actions = NULL, updated_by = 'sync-boundary-script-body', updated_at = NOW() WHERE node_key = '${nk}';"
        echo ""
      done
    } > "$SQL_OUT"
    log "已生成：$SQL_OUT"
    ;;
  --apply)
    [ -f "$SQL_OUT" ] || die "未找到 $SQL_OUT，请先 --gen-sql"
    die "本脚本不自动执行线上 SQL。请人工审 $SQL_OUT 后在目标库执行，再复跑 --check 验证两库一致。"
    ;;
  *) die "未知模式：$MODE（--check / --gen-sql / --apply）" ;;
esac
