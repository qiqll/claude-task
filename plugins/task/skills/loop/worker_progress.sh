#!/usr/bin/env bash
# 判断后台 worker 是否还在实质推进。供 /task:loop 心跳调用，只看文件时间戳，不读 transcript、不写任何文件。
#   用法：worker_progress.sh <current 文件> [idle_min=30] [spin_min=60]（在项目根目录执行）
#   两个信号：
#     out  = worker output 文件多久没增长（每次工具调用都会写入；不增长 = 卡在某一步或已挂）
#     tree = 工作区多久没变（本任务的新提交、非开工脏文件的改动；output 在长而 tree 不变 = 可能原地打转）
#   输出一行：OK|IDLE|SPIN out=<分钟>m tree=<分钟>m
#     IDLE：out ≥ idle_min      SPIN：out 正常但 tree ≥ spin_min
#   退出码：0=OK  1=IDLE/SPIN（调度员需进一步判断）  2=用法/字段错误
# 兼容 macOS bash 3.2 + BSD 工具。
set -uo pipefail

cur="${1:-}"; idle_min="${2:-30}"; spin_min="${3:-60}"
[[ -n "$cur" && -f "$cur" ]] || { echo "用法: $0 <current 文件> [idle_min] [spin_min]" >&2; exit 2; }
field() { sed -n "s/^$1=//p" "$cur" | head -n 1; }
start_sha="$(field start_sha)"; started="$(field started)"; output="$(field output)"; dirty="$(field dirty)"
[[ "$started" =~ ^[0-9]+$ ]] || { echo "current 缺少 started" >&2; exit 2; }
git rev-parse --verify -q "${start_sha:-x}^{commit}" >/dev/null || { echo "current 的 start_sha 无效: $start_sha" >&2; exit 2; }

mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null; }
now="$(date +%s)"

out_at="$started"
if [[ -n "$output" && -e "$output" ]]; then t="$(mtime "$output")"; [[ "$t" =~ ^[0-9]+$ ]] && (( t > out_at )) && out_at="$t"; fi

tree_at="$started"
bump() { [[ "$1" =~ ^[0-9]+$ ]] && (( $1 > tree_at )) && tree_at="$1"; return 0; }
[[ "$(git rev-parse HEAD)" != "$(git rev-parse "$start_sha")" ]] && bump "$(git log -1 --format=%ct HEAD)"
# porcelain -z：每条 "XY path\0"，重命名/复制后面多一条原路径 "\0"
skip_next=0
while IFS= read -r -d '' entry; do
  if (( skip_next )); then skip_next=0; continue; fi
  st="${entry:0:2}"; path="${entry:3}"
  [[ "$st" == R* || "$st" == C* ]] && skip_next=1
  case "$path" in .claude/auto/*|.claude/inbox/*) continue ;; esac
  case ",$dirty," in *",$path,"*) continue ;; esac
  [[ "$PWD/$path" == "$output" ]] && continue
  [[ -e "$path" ]] && bump "$(mtime "$path")"
done < <(git status --porcelain -z -uall)

out_m=$(( (now - out_at) / 60 )); tree_m=$(( (now - tree_at) / 60 ))
if (( out_m >= idle_min )); then v=IDLE
elif (( tree_m >= spin_min )); then v=SPIN
else v=OK; fi
echo "$v out=${out_m}m tree=${tree_m}m"
[[ "$v" == OK ]]
