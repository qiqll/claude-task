#!/usr/bin/env bash
# 调度员亲自验收 worker 的测试结果（不信 worker 自报的 TEST_RESULT / 既有失败名单）。
#   用法：verify_tests.sh <start_sha> '<test_cmd>' [timeout_sec=900]
#   在项目根运行。输出最后一行是结论：
#     VERDICT: PASS                       退出码 0
#     VERDICT: PASS_PREEXISTING <n>       有失败但全部在 START 基线里就失败（列出用例）
#     VERDICT: FAIL_NEW <n>               出现基线之外的新失败（列出用例）
#     VERDICT: FAIL_TIMEOUT               超时（外网挂起等），按失败处理
#     VERDICT: REJECT_CMD <原因>          命令不合规（缩小范围 / 吞退出码 / 未覆盖改动的测试文件）
#     VERDICT: FAIL_UNPARSED              失败但解析不出用例名，无法与基线比对，按失败处理
# 兼容 macOS（无 timeout 命令，用 perl alarm）。
set -uo pipefail

start="${1:-}"; cmd="${2:-}"; tmo="${3:-900}"
[[ -n "$start" && -n "$cmd" ]] || { echo "用法: $0 <start_sha> '<test_cmd>' [timeout]" >&2; exit 2; }
root="$(git rev-parse --show-toplevel)" || exit 2
cd "$root"

# ---- 1. 命令合规：只允许「[cd <dir> && ]<单条测试命令>」
cddir="."; body="$cmd"
if [[ "$cmd" =~ ^cd[[:space:]]+([^[:space:];|&]+)[[:space:]]*\&\&[[:space:]]*(.*)$ ]]; then
  cddir="${BASH_REMATCH[1]}"; body="${BASH_REMATCH[2]}"
fi
case "$body" in
  *';'*|*'|'*|*'&'*|*'`'*|*'$('*|*'>'*|*'<'*) echo "VERDICT: REJECT_CMD 只允许单条测试命令（可带 cd X && 前缀），不得含 ; | & \` \$( 重定向"; exit 1 ;;
esac
body_chk="${body//-p no:cacheprovider/}"  # 只关缓存，不缩范围，放行
for bad in ' -k' '--deselect' '--ignore' '--lf' '--last-failed' '--co' '--collect-only' '-p no:' '--exitfirst=0' '--testNamePattern' ' -t ' '--passWithNoTests' 'exit ' ' true' 'echo '; do
  [[ " $body_chk " == *"$bad"* ]] && { echo "VERDICT: REJECT_CMD 含禁止参数「${bad# }」（不得缩小范围或伪造成功）"; exit 1; }
done
[[ -d "$cddir" ]] || { echo "VERDICT: REJECT_CMD cd 目录不存在: $cddir"; exit 1; }

# 改动/新增的测试文件必须落在命令的路径参数之内（无路径参数 = 跑 cd 目录全部，视为覆盖）
test_re='(^|/)(tests?|__tests__|spec)/|(^|/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$'
paths=""
for tok in $body; do
  [[ "$tok" == -* ]] && continue
  tok="${tok%%::*}"
  [[ -e "$cddir/$tok" ]] && paths="$paths $(cd "$cddir" && python3 -c 'import os,sys;print(os.path.relpath(os.path.abspath(sys.argv[1]),sys.argv[2]))' "$tok" "$root")"
done
[[ -z "$paths" ]] && paths="$(python3 -c 'import os,sys;print(os.path.relpath(os.path.abspath(sys.argv[1]),sys.argv[2]))' "$cddir" "$root")"
uncovered=""
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  printf '%s\n' "$f" | grep -qE "$test_re" || continue
  ok=0
  for p in $paths; do
    [[ "$p" == "." || "$f" == "$p" || "$f" == "$p/"* ]] && { ok=1; break; }
  done
  # 前端/其他栈的测试不归这条 pytest 命令管时不强求（只校验与命令同一 cd 目录下的）
  [[ $ok -eq 0 && "$cddir" != "." && "$f" != "${cddir#./}/"* ]] && ok=1
  [[ $ok -eq 0 ]] && uncovered="$uncovered $f"
done < <(git diff --name-only --diff-filter=AMR "$start" HEAD)
[[ -n "$uncovered" ]] && { echo "VERDICT: REJECT_CMD 改动的测试文件不在命令范围内:$uncovered"; exit 1; }

# ---- 2. 运行
run() {  # $1=工作目录 $2=输出文件 [$3=命令体，默认 $body]
  ( cd "$1/$cddir" && perl -e 'alarm shift; exec @ARGV' "$tmo" bash -c "${3:-$body}" ) >"$2" 2>&1
}
base_body() {  # 基线版本里不存在的路径参数（本任务新增的测试文件）要剔除，否则整条命令在基线上报「文件不存在」而解析不出失败名单
  local out="" tok p
  for tok in $body; do
    p="${tok%%::*}"
    if [[ "$tok" != -* && "$tok" == */* && -e "$root/$cddir/$p" && ! -e "$1/$cddir/$p" ]]; then continue; fi
    out="$out $tok"
  done
  printf '%s' "${out# }"
}
failed_ids() {  # pytest / vitest / jest / go test / node --test 的失败用例名
  {
    # pytest / vitest / jest
    grep -oE '^(FAILED|ERROR) [^ ]+|^ *(FAIL|×|✗) .+' "$1" | sed -E 's/^(FAILED|ERROR) //; s/^ *(FAIL|×|✗) //; s/ - .*$//'
    # go test：子测试与顶层用例（--- FAIL: TestX/sub (0.01s)）
    grep -oE '^[[:space:]]*--- FAIL: [^ ]+' "$1" | sed -E 's/^[[:space:]]*--- FAIL: /go:/'
    # go test：包级失败但没有任何 --- FAIL（编译错误 / panic / 超时 / TestMain 失败）→ 以包名为失败单位
    awk '/^[[:space:]]*--- FAIL: /{f=1} /^FAIL[[:space:]]+[^ ]+[[:space:]]/{ if(!f) print "gopkg:" $2; f=0 } /^(ok|---)[[:space:]]/ && !/--- FAIL/{}' "$1"
    # node --test：✖ 用例名 (耗时)
    grep -E '^[[:space:]]*✖ ' "$1" | grep -vE '✖ failing tests:' | sed -E 's/^[[:space:]]*✖ //; s/ \([0-9.]+ms\)$//'
  } | grep -v '^$' | sort -u
}
out=$(mktemp); run "$root" "$out"; rc=$?
tail -n 15 "$out"
[[ $rc -eq 0 ]] && { echo "VERDICT: PASS"; rm -f "$out"; exit 0; }
[[ $rc -eq 142 ]] && { echo "VERDICT: FAIL_TIMEOUT（${tmo}s）"; rm -f "$out"; exit 1; }
now=$(failed_ids "$out")
# 解析不出用例名（如 node 检查脚本）：以「最后一条 Error/AssertionError 行」作为失败签名，与基线比对
[[ -z "$now" ]] && now="SIG: $(grep -E '(Error|assert)' "$out" | grep -vE '^[[:space:]]+at ' | tail -1 | sed -E 's#(/[^ :]*/)?(frontend|backend|src|tests?)/#\2/#g')"
rm -f "$out"
[[ "$now" == "SIG: " ]] && { echo "VERDICT: FAIL_UNPARSED rc=$rc"; exit 1; }

# ---- 3. 有失败：在 START 的临时 worktree 跑基线比对（软链未跟踪的环境目录）
wt=$(mktemp -d)/base
git worktree add -q --detach "$wt" "$start" || { echo "VERDICT: FAIL_UNPARSED 无法建基线 worktree"; exit 1; }
for d in venv .venv backend/venv backend/.venv node_modules frontend/node_modules; do
  [[ -e "$root/$d" && ! -e "$wt/$d" ]] && ln -s "$root/$d" "$wt/$d"
done
bout=$(mktemp); run "$wt" "$bout" "$(base_body "$wt")"; brc=$?
base_fail=$(failed_ids "$bout")
[[ "$now" == SIG:* ]] && base_fail="SIG: $(grep -E '(Error|assert)' "$bout" | grep -vE '^[[:space:]]+at ' | tail -1 | sed -E 's#(/[^ :]*/)?(frontend|backend|src|tests?)/#\2/#g')"
rm -f "$bout"
git worktree remove --force "$wt" >/dev/null 2>&1
new=$(comm -23 <(printf '%s\n' "$now") <(printf '%s\n' "$base_fail") | grep -v '^$' || true)
if [[ -n "$new" ]]; then
  echo "$new" | sed 's/^/  NEW: /'
  echo "VERDICT: FAIL_NEW $(printf '%s\n' "$new" | wc -l | tr -d ' ')"; exit 1
fi
[[ $brc -eq 142 ]] && { echo "VERDICT: FAIL_TIMEOUT（基线超时，无法比对）"; exit 1; }
echo "$now" | sed 's/^/  PREEXISTING: /'
echo "VERDICT: PASS_PREEXISTING $(printf '%s\n' "$now" | wc -l | tr -d ' ')"; exit 0
