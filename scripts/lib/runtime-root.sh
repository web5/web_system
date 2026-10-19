ws_runtime_root() {
  local root="${1:-/data/web_system}"
  while [ "${root%/}" != "$root" ]; do root="${root%/}"; done
  if [[ ! "$root" =~ ^/[A-Za-z0-9_./-]+$ ]] || [[ "$root" == *"/../"* ]] || [[ "$root" == *"/./"* ]] || [ "${root##*/}" != "web_system" ]; then
    printf '%s\n' '运行根必须统一到绝对路径 web_system；旧 web_system_git 需先受控迁移。' >&2
    return 1
  fi
  printf '%s\n' "$root"
}
