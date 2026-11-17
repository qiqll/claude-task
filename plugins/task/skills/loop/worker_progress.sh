#!/usr/bin/env bash
# 判断后台 worker 是否还在实质推进。供 /task:loop 心跳调用，只看文件时间戳，不读 transcript、不写任何文件。
#   用法：worker_progress.sh <current 文件> [idle_min=30] [spin_min=60]（在项目根目录执行）
#   两个信号：
#     out  = worker output 文件多久没增长（每次工具调用都会写入；不增长 = 卡在某一步或已挂）
#     tree = 工作区多久没变（本任务的新提交、非开工脏文件的改动；output 在长而 tree 不变 = 可能原地打转）
#   输出一行：OK|IDLE|SPIN out=<分钟>m tree=<分钟>m
#     IDLE：out ≥ idle_min      SPIN：out 正常但 tree ≥ spin_min
#   退出码：0=OK  1=IDLE/SPIN（调度员需进一步判断）  2=用法/字段错误
#
#   worker_progress.sh --recent <output 文件> [n=15]
#     摘出 transcript 最近 n 条动作（工具名 + 参数/结果开头），供调度员判断是否原地打转；每条一行、截断到 200 字。
# 兼容 macOS bash 3.2 + BSD 工具，也兼容 GNU。
set -uo pipefail

if [[ "${1:-}" == "--recent" ]]; then
  out="${2:-}"; n="${3:-15}"
  [[ -n "$out" && -e "$out" ]] || { echo "用法: $0 --recent <output 文件> [n]" >&2; exit 2; }
  # transcript 是 JSONL，单行常超过几 KB：只取尾部 256KB，丢掉第一条半截行，逐行解析
  if command -p python3 -c '' 2>/dev/null; then
    tail -c 262144 "$out" | command -p python3 -I -c '
import json, sys
n = int(sys.argv[1]); lines = sys.stdin.read().split("\n")[1:]; acts = []
def clip(v): return " ".join(str(v).split())[:200]
for ln in lines:
    try: e = json.loads(ln)
    except Exception: continue
    c = (e.get("message") or {}).get("content")
    if isinstance(c, str): acts.append("SAY " + clip(c)); continue
    for b in c or []:
        if not isinstance(b, dict): continue
        t = b.get("type")
        if t == "tool_use": acts.append("TOOL " + str(b.get("name")) + " " + clip(json.dumps(b.get("input"), ensure_ascii=False)))
        elif t == "tool_result":
            r = b.get("content"); r = " ".join(x.get("text", "") for x in r if isinstance(x, dict)) if isinstance(r, list) else r
            acts.append(("ERR " if b.get("is_error") else "RESULT ") + clip(r))
        elif t == "text": acts.append("SAY " + clip(b.get("text")))
print("\n".join(acts[-n:]) or "（无可解析的动作）")
' "$n"
  else
    tail -n "$n" "$out" | cut -c1-200
  fi
  exit 0
fi

cur="${1:-}"; idle_min="${2:-30}"; spin_min="${3:-60}"
[[ -n "$cur" && -f "$cur" ]] || { echo "用法: $0 <current 文件> [idle_min] [spin_min]" >&2; exit 2; }
field() { sed -n "s/^$1=//p" "$cur" | head -n 1; }
start_sha="$(field start_sha)"; started="$(field started)"; output="$(field output)"; dirty="$(field dirty)"
[[ "$started" =~ ^[0-9]+$ ]] || { echo "current 缺少 started" >&2; exit 2; }
git rev-parse --verify -q "${start_sha:-x}^{commit}" >/dev/null || { echo "current 的 start_sha 无效: $start_sha" >&2; exit 2; }

# -L：output 是指向 transcript 的符号链接，要的是目标文件的时间。先试 GNU 的 -c（BSD 不认，只报错到 stderr）；
# 反过来不行 —— GNU 会把 -f 当「查文件系统」往 stdout 打一堆信息
mtime() { stat -L -c %Y "$1" 2>/dev/null || stat -L -f %m "$1" 2>/dev/null; }
now="$(date +%s)"

out_at="$started"
if [[ -n "$output" && -e "$output" ]]; then t="$(mtime "$output")"; [[ "$t" =~ ^[0-9]+$ ]] && (( t > out_at )) && out_at="$t"; fi

tree_at="$started"
bump() { [[ "$1" =~ ^[0-9]+$ ]] && (( $1 > tree_at )) && tree_at="$1"; return 0; }
[[ "$(git rev-parse HEAD)" != "$(git rev-parse "$start_sha")" ]] && bump "$(git log -1 --format=%ct HEAD)"
# porcelain -z：每条 "XY path\0"，重命名/复制后面多一条原路径 "\0"
# --no-optional-locks：不刷新 index、不抢 index.lock，避免和 worker 同时 commit 撞锁
skip_next=0
while IFS= read -r -d '' entry; do
  if (( skip_next )); then skip_next=0; continue; fi
  st="${entry:0:2}"; path="${entry:3}"
  [[ "$st" == *R* || "$st" == *C* ]] && skip_next=1
  case "$path" in .claude/auto/*|.claude/inbox/*) continue ;; esac
  case ",$dirty," in *",$path,"*) continue ;; esac
  [[ "$PWD/$path" == "$output" ]] && continue
  [[ -e "$path" ]] && bump "$(mtime "$path")"  # 删除没有 mtime，不计；提交后由 HEAD 时间体现
done < <(git --no-optional-locks status --porcelain -z -uall)

out_m=$(( (now - out_at) / 60 )); tree_m=$(( (now - tree_at) / 60 ))
if (( out_m >= idle_min )); then v=IDLE
elif (( tree_m >= spin_min )); then v=SPIN
else v=OK; fi
echo "$v out=${out_m}m tree=${tree_m}m"
[[ "$v" == OK ]]
