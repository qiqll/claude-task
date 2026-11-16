#!/usr/bin/env bash
# 检查 <base>..<head> 之间是否有「测试被改弱」的迹象。供 /task:loop 调度员在 worker 交付后机器判定，不信 agent 自述。
#   用法：check_test_weakening.sh <base_sha> [head=HEAD]
#   输出：每条疑点一行 "WARN: ..."；无疑点输出 "OK"
#   退出码：0=无疑点  1=有疑点  2=用法/参数错误（调度员按「有疑点」处理）
# 疑点不等于违规（合法重构也可能删测试），只是要求人确认。
# 已知盲区（机器识别不了，靠 code-reviewer 和人）：断言放宽（toBe(1)→toBeTruthy()、== → in）、
#   按测试输入特判返回值、mock 掉被测逻辑。
# 兼容 macOS bash 3.2 + BSD 工具。
set -uo pipefail

base="${1:-}"; head="${2:-HEAD}"
[[ -n "$base" ]] || { echo "用法: $0 <base_sha> [head]" >&2; exit 2; }
git rev-parse --verify -q "$base^{commit}" >/dev/null || { echo "无效 base: $base" >&2; exit 2; }
git rev-parse --verify -q "$head^{commit}" >/dev/null || { echo "无效 head: $head" >&2; exit 2; }

test_re='(^|/)(tests?|__tests__|spec)/|(^|/)test_[^/]*$|_test\.[a-z]+$|\.(test|spec)\.[a-z]+$|(^|/)conftest\.py$'
cfg_re='(^|/)(pytest\.ini|pyproject\.toml|setup\.cfg|tox\.ini|\.coveragerc|Makefile|package\.json|(vitest|vite|jest|playwright|karma)\.config\.[a-z]+)$'
name_re='(def (test_[A-Za-z0-9_]+))|((it|test|describe)(\.[a-z]+)?\((["'"'"'`])[^"'"'"'`]+)'
assert_re='\bassert\b|expect\(|assert[A-Z][A-Za-z]*\(|pytest\.raises|self\.fail\('
skip_re='pytest\.mark\.(skip|skipif|xfail)|pytest\.(skip|xfail)\(|unittest\.skip|\.(skip|only|todo)\(|\b(xit|xdescribe|xtest|fit|fdescribe)\('
comment_re='^[+-][[:space:]]*(#|//|/\*|\*)'
warn=0
say() { echo "WARN: $*"; warn=1; }

# 取 diff 中某一侧的非注释代码行（$1 = '-' 或 '+'）
side() { grep -E "^\\$1[^$1]" | grep -vE "$comment_re" || true; }
names() { grep -oE "$name_re" | sed -E 's/^def //; s/^(it|test|describe)(\.[a-z]+)?\(.//' | sort -u; }

# 1. 删除的测试文件；重命名：移出测试路径 = 删除，测试路径内重命名按旧/新路径成对比较
pairs=""
while IFS=$'\t' read -r st a b; do
  [[ -z "$st" ]] && continue
  case "$st" in
    D) printf '%s\n' "$a" | grep -qE "$test_re" && say "删除了测试文件 $a" ;;
    R*) if printf '%s\n' "$a" | grep -qE "$test_re"; then
          if printf '%s\n' "$b" | grep -qE "$test_re"; then pairs="$pairs$a"$'\t'"$b"$'\n'
          else say "测试文件被移出测试路径 $a → $b"; fi
        fi ;;
    M) printf '%s\n' "$a" | grep -qE "$test_re" && pairs="$pairs$a"$'\t'"$a"$'\n' ;;
  esac
done < <(git diff --name-status -M "$base" "$head")

# 2. 测试文件内：消失的用例名、新增跳过标记、断言净减少（注释行不计）
while IFS=$'\t' read -r old new; do
  [[ -z "$old" ]] && continue
  diff=$(git diff -U0 "$base:$old" "$head:$new")
  gone=$(comm -23 <(printf '%s\n' "$diff" | side - | names) <(printf '%s\n' "$diff" | side + | names) | grep -v '^$' || true)
  [[ -n "$gone" ]] && say "$new 消失的用例: $(echo $gone)"
  commented=$(printf '%s\n' "$diff" | grep -E '^\+[[:space:]]*(#|//)' | grep -cE "$name_re|$assert_re" || true)
  [[ "${commented:-0}" -gt 0 ]] && say "$new 有 ${commented} 行用例/断言被注释掉"
  skips=$(printf '%s\n' "$diff" | side + | grep -cE "$skip_re" || true)
  [[ "${skips:-0}" -gt 0 ]] && say "$new 新增 ${skips} 处 skip/xfail/only 标记"
  rm_a=$(printf '%s\n' "$diff" | side - | grep -cE "$assert_re" || true)
  add_a=$(printf '%s\n' "$diff" | side + | grep -cE "$assert_re" || true)
  [[ "${rm_a:-0}" -gt "${add_a:-0}" ]] && say "$new 断言净减少（-${rm_a} +${add_a}）"
done < <(printf '%s' "$pairs")

# 3. 测试配置里新增的忽略/反选
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  printf '%s\n' "$f" | grep -qE "$cfg_re|(^|/)conftest\.py$" || continue
  hits=$(git diff -U0 "$base" "$head" -- "$f" | side + | grep -E -- '--deselect|--ignore|-k |collect_ignore|addopts|exclude|testPathIgnorePatterns|testIgnore|skip|xfail' || true)
  [[ -n "$hits" ]] && say "$f 新增测试忽略/筛选配置: $(echo "$hits" | head -3 | tr '\n' ' ')"
done < <(git diff --name-only "$base" "$head")

[[ $warn -eq 0 ]] && echo "OK"
exit $warn
