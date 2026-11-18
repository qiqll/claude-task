#!/usr/bin/env bash
# 主动通知需求方：自动循环到了要人接手的节点（待决策 / 待验证 / 阻塞 / 停机）。供 /task:loop 调度员调用。
#   用法：notify.sh <项目根> <去重键> <消息>
#     去重键：同一个键只通知一次（记在 <项目根>/.claude/auto/notified），如 T-012:待决策:<nonce>、STOP:<run_started>
#     消息：一句话 + 回复命令，超过 100 字截断
#   渠道（先命中先用）：
#     TASK_NOTIFY=off              不通知
#     TASK_NOTIFY_CMD="<命令>"     自定义，追加两个参数：标题、消息（如 ntfy / 企业微信 webhook 脚本）
#     macOS osascript → Linux notify-send → 都没有则跳过
#   标题：task · <项目目录名>
#   发送最多等 10 秒（卡住的 webhook 不拖住循环），超时记 FAIL。
#   输出一行：SENT <渠道> | SKIP <原因> | FAIL <渠道>；总是退出 0（通知失败不影响循环），参数缺失退出 2。
# 兼容 macOS bash 3.2 + BSD 工具，也兼容 GNU。
set -uo pipefail

root="${1:-}"; key="${2:-}"; msg="${3:-}"
[[ -n "$root" && -n "$key" && -n "$msg" && -d "$root" ]] || { echo "用法: $0 <项目根> <去重键> <消息>" >&2; exit 2; }

[[ "${TASK_NOTIFY:-}" == "off" ]] && { echo "SKIP off"; exit 0; }

log="$root/.claude/auto/notified"
mkdir -p "$root/.claude/auto"
if [[ -f "$log" ]] && grep -Fxq -- "$key" "$log"; then echo "SKIP dup"; exit 0; fi

# 按字符截断：perl 不依赖当前 locale；没有 perl 时退回 bash 切片（非 UTF-8 locale 下可能切坏末字）
msg="$(printf '%s' "$msg" | tr '\n\t' '  ')"
if command -v perl >/dev/null 2>&1; then
  msg="$(perl -CSA -e 'my $m = $ARGV[0]; print length($m) > 100 ? substr($m, 0, 99) . "…" : $m' "$msg")"
elif (( ${#msg} > 100 )); then
  msg="${msg:0:99}…"
fi
title="task · $(basename "$root")"

# 限时执行：有 perl 用 alarm（exec 后计时保留，超时 SIGALRM 结束进程）；没有则不限时
limit() { if command -v perl >/dev/null 2>&1; then perl -e 'alarm 10; exec @ARGV or exit 127' "$@"; else "$@"; fi; }

# 标题、消息一律作为参数传入，不拼进脚本文本（消息里可能有引号）
if [[ -n "${TASK_NOTIFY_CMD:-}" ]]; then
  channel="cmd"; limit sh -c "$TASK_NOTIFY_CMD \"\$@\"" task-notify "$title" "$msg" >/dev/null 2>&1
elif [[ "$(uname -s)" == "Darwin" ]] && command -v osascript >/dev/null 2>&1; then
  channel="osascript"
  limit osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"' -e 'end run' \
    "$title" "$msg" >/dev/null 2>&1
elif command -v notify-send >/dev/null 2>&1; then
  channel="notify-send"; limit notify-send -- "$title" "$msg" >/dev/null 2>&1
else
  echo "SKIP no-channel"; exit 0
fi
rc=$?
(( rc == 0 )) || { echo "FAIL $channel (exit $rc)"; exit 0; }

# 只留最近 200 个键；临时文件带 PID，并发调用不互相覆盖
tmp="$log.$$"
{ [[ -f "$log" ]] && tail -n 199 "$log"; printf '%s\n' "$key"; } > "$tmp" && mv "$tmp" "$log"
echo "SENT $channel"
