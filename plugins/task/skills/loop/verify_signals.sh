#!/usr/bin/env bash
# 待验证任务的「后续使用迹象」：只读，纯 git + 文本匹配，不靠 AI 判断。供到期检查排预告顺序、/task:status 排清单用。
#
#   bash verify_signals.sh <项目根> <T-0NN>
#
# 输出（每项一行，没有填 —）：
#   COMMITS  <短 sha …>          本任务的交付提交（message 含 ID，非 docs(task):）
#   VISIBLE  yes|no|unknown      改动是否用户可见（UI / CLI / 对外接口 / 文档路径；无提交 = unknown）
#   LATER    <T-ID …>            之后又改过同一批文件、且现已归档或待验证的其他任务
#   DOWNSTREAM <T-ID …>          依赖它 / 衍生自它、且现已归档或待验证的任务
#   TIER     1|2|3               1 = 无迹象且用户可见（最该看）· 2 = 无迹象 · 3 = 有迹象（✓）
set -uo pipefail

root="${1:?项目根}"; id="${2:?任务 ID}"
cd "$root" || exit 2
backlog=.claude/backlog.md; progress=.claude/dev-progress.md
[[ -f "$backlog" ]] || { echo "无 backlog" >&2; exit 2; }
bound="$id([^0-9]|$)"

shas="$(git log --format='%H %s' -E --grep="$bound" HEAD 2>/dev/null | grep -v ' docs(task):' | awk '{print $1}')"

# 现已归档（dev-progress 有记录）或待验证（backlog 状态格）的任务
settled() {
  local t="$1"
  [[ -f "$progress" ]] && grep -qE "^###[[:space:]]+$t([^0-9]|$)" "$progress" && return 0
  awk -F'|' -v t="$t" '{ i=$2; s=$5; gsub(/[[:space:]`]/,"",i); gsub(/[[:space:]`]/,"",s); if (i==t && s ~ /^待验证/) f=1 } END { exit !f }' "$backlog"
}

files=""; later=""
if [[ -n "$shas" ]]; then
  files="$(for s in $shas; do git show --name-only --format= "$s"; done | sort -u | grep -v '^$' | grep -v '^\.claude/' || true)"
  newest="$(printf '%s\n' "$shas" | head -1)"
  if [[ -n "$files" ]]; then
    paths=(); while IFS= read -r f; do paths+=("$f"); done <<<"$files"
    others="$(git log --format='%s' "$newest"..HEAD -- "${paths[@]}" 2>/dev/null | grep -v '^docs(task):' | grep -oE 'T-[0-9]+' | sort -u | grep -vx "$id" || true)"
    for t in $others; do settled "$t" && later="$later $t"; done
  fi
fi

# 依赖 / 衍生：backlog 行（依赖列或备注含「衍生自 ID」）与 dev-progress 记录正文里提到它的其他任务
cands="$(awk -F'|' -v re="$bound" '$2 ~ /T-[0-9]+/ && ($6 ~ re || $0 ~ ("衍生自[[:space:]]*" re)) { i=$2; gsub(/[[:space:]`]/,"",i); print i }' "$backlog")"
if [[ -f "$progress" ]]; then
  cands="$cands
$(awk -v re="$bound" '/^###[[:space:]]+T-[0-9]+/ { cur=$2; next } /^#/ { cur="" } cur != "" && $0 ~ re { print cur }' "$progress")"
fi
down=""
for t in $(printf '%s\n' "$cands" | grep -E '^T-[0-9]+$' | sort -u | grep -vx "$id" || true); do settled "$t" && down="$down $t"; done

visible=unknown
if [[ -n "$files" ]]; then
  visible=no
  grep -qiE '(^|/)(frontend|web|ui|app|pages|components|views|templates|static|public|cli|bin|cmd|api|routes|handlers|controllers|docs?)/|\.(tsx|jsx|vue|svelte|html|css|scss)$|(^|/)README' <<<"$files" && visible=yes
fi

tier=2
[[ -n "$later$down" ]] && tier=3
[[ "$tier" == 2 && "$visible" != no ]] && tier=1

out() { local v="${2# }"; v="${v% }"; echo "$1 ${v:-—}"; }
out COMMITS "$(for s in $shas; do printf '%s ' "${s:0:7}"; done)"
out VISIBLE "$visible"
out LATER "$later"
out DOWNSTREAM "$down"
out TIER "$tier"
