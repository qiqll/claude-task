#!/usr/bin/env bash
# 待验证任务的「后续使用迹象」：只读，纯 git + 文本匹配，不靠 AI 判断。供到期检查排预告顺序、/task:status 排清单用。
#
#   bash verify_signals.sh <项目根> <T-0NN>
#
# 输出（每项一行，没有填 —）：
#   COMMITS    <短 sha …>        本任务的交付提交（subject 第一个任务 ID 是它；不含 docs(task): / Revert）
#   VISIBLE    yes|no|unknown    改动是否用户可见（UI / CLI / 对外接口 / 文档路径；查不到提交 = unknown）
#   LATER      <T-ID …>          之后改过本任务「非热点」文件、且现已归档或待验证的其他任务
#   DOWNSTREAM <T-ID …>          依赖它 / 衍生自它、且现已归档或待验证的任务
#   TIER       1|2|3             1 = 无迹象且用户可见或查不到提交（最该看）· 2 = 无迹象 · 3 = 有迹象（✓）
#
# 热点文件（被 ≥ HOT 个不同任务改过，默认 4）和测试 / 版本 / changelog / lock 文件不参与 LATER：它们谁都改，不说明什么。
set -uo pipefail
set -f  # 文件名不做通配展开

root="${1:?项目根}"; id="${2:?任务 ID}"
HOT="${VERIFY_SIGNALS_HOT:-4}"
cd "$root" || exit 2
backlog=.claude/backlog.md; progress=.claude/dev-progress.md
[[ -f "$backlog" ]] || { echo "无 backlog" >&2; exit 2; }
g() { git -c core.quotePath=false "$@"; }
num() { echo "${1#T-}" | sed 's/^0*//'; }
self_n="$(num "$id")"

# 每个提交：sha \t subject 里第一个任务 ID（不规范补零也按数字比）
log_ids() { g log --format='%H%x09%s' "$@" | awk -F'\t' '$2 !~ /^(docs\(task\):|Revert)/ && match($2, /T-[0-9]+/) { t=substr($2, RSTART+2, RLENGTH-2)+0; print $1 "\t" t }'; }

shas="$(log_ids HEAD | awk -F'\t' -v n="$self_n" '$2 == n { print $1 }')"

# backlog 表格行：先去掉反引号段，`|` 才能按列切
strip_awk='{ gsub(/`[^`]*`/, ""); gsub(/\\\|/, "") }'

# 现已归档（dev-progress 有记录）或待验证（backlog 状态格）
settled() {
  local n; n="$(num "$1")"
  [[ -f "$progress" ]] && awk -v n="$n" '/^###/ && match($0, /T-[0-9]+/) && substr($0, RSTART+2, RLENGTH-2)+0 == n { f=1 } END { exit !f }' "$progress" && return 0
  awk -F'|' -v n="$n" "$strip_awk"' { i=$2; s=$5; gsub(/[[:space:]]/,"",i); gsub(/[[:space:]]/,"",s); if (i ~ /^T-[0-9]+$/ && substr(i,3)+0 == n && s ~ /^待验证/) f=1 } END { exit !f }' "$backlog"
}

boring='(^|/)(\.claude/|tests?/|__tests__/)|_test\.|\.test\.|\.spec\.|(^|/)test_[^/]*$|conftest\.py$|(^|/)(CHANGELOG|CHANGES|HISTORY)[^/]*$|(^|/)(package|plugin|marketplace)\.json$|(^|/)(pyproject\.toml|VERSION)$|\.lock$|-lock\.(json|yaml)$'

files=""; later=""; visible=unknown
if [[ -n "$shas" ]]; then
  files="$(for s in $shas; do g show --name-only --format= "$s"; done | grep -v '^$' | sort -u || true)"
  if [[ -n "$files" ]]; then
    visible=no
    grep -qiE '(^|/)(frontend|web|ui|app|pages|components|views|templates|static|public|cli|bin|cmd|api|routes|handlers|controllers|docs?)/|\.(tsx|jsx|vue|svelte|html|css|scss)$|(^|/)README' <<<"$files" && visible=yes
  fi
  newest="$(printf '%s\n' "$shas" | head -1)"
  cand="$(grep -vE "$boring" <<<"$files" || true)"
  for f in $(printf '%s\n' "$cand" | tr ' ' '\001'); do
    f="$(printf '%s' "$f" | tr '\001' ' ')"
    touched="$(g log --format='%H%x09%s' HEAD -- "$f" | awk -F'\t' '$2 !~ /^(docs\(task\):|Revert)/ && match($2, /T-[0-9]+/) { print substr($2, RSTART+2, RLENGTH-2)+0 }' | sort -un)"
    [[ "$(printf '%s\n' "$touched" | grep -c .)" -ge "$HOT" ]] && continue
    for n in $(log_ids "$newest"..HEAD -- "$f" | cut -f2 | sort -un); do
      [[ "$n" == "$self_n" ]] && continue
      t="$(printf 'T-%03d' "$n")"
      case " $later " in *" $t "*) continue ;; esac
      settled "$t" && later="$later $t"
    done
  done
fi

# 依赖 / 衍生：backlog 的依赖列或「衍生自 ID」；dev-progress 记录正文里「依赖 … ID」「衍生自 ID」（不看「遗留：」行——那是父任务指向子任务）。
# 只认编号比本任务大的：依赖它的任务总是后录入。
bound="T-0*${self_n}([^0-9]|$)"
cands="$(awk -F'|' -v re="$bound" "$strip_awk"' $2 ~ /T-[0-9]+/ && ($6 ~ re || $0 ~ ("衍生自[[:space:]]*" re)) { i=$2; gsub(/[[:space:]]/,"",i); print i }' "$backlog")"
if [[ -f "$progress" ]]; then
  cands="$cands
$(awk -v re="$bound" '
  /^###/ { cur=""; if (match($0, /T-[0-9]+/)) cur=substr($0, RSTART, RLENGTH); next }
  /^#/ { cur=""; next }
  cur != "" && $0 !~ /遗留/ && ($0 ~ ("依赖[^。；;]*" re) || $0 ~ ("衍生自[[:space:]]*" re)) { print cur }' "$progress")"
fi
down=""
for t in $(printf '%s\n' "$cands" | grep -E '^T-[0-9]+$' | sort -u || true); do
  [[ "$(num "$t")" -gt "$self_n" ]] || continue
  settled "$t" && down="$down $t"
done

tier=2
[[ -n "$later$down" ]] && tier=3
[[ "$tier" == 2 && "$visible" != no ]] && tier=1

out() { local v="${2# }"; v="${v% }"; echo "$1 ${v:-—}"; }
out COMMITS "$(for s in $shas; do printf '%s ' "${s:0:7}"; done)"
out VISIBLE "$visible"
out LATER "$later"
out DOWNSTREAM "$down"
out TIER "$tier"
