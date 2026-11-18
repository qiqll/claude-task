# Changelog

All notable changes to the `task` plugin. Versions follow [semver](https://semver.org/); the version in `plugins/task/.claude-plugin/plugin.json` is what Claude Code uses to detect updates.

## 0.3.11 — 2026-11-18

- Pane, human blockers: the status is the first status-like cell from the fourth column on, so a row with an extra date or note column, or a trailing empty cell, still reads 已完成 / 已关闭 and leaves the blocker list. 已决策 and 取消 also count as closed. Closed is judged from the start of the status only: 待处理（采购已完成，待安装） stays a blocker.

## 0.3.10 — 2026-11-18

- `/task:status T-0NN` (T-013): one task's timeline, oldest first — its `run.log` lines (dispatch, result, watchdog), the branch's commits that mention it (dispatcher bookkeeping marked as such, plus hashes listed in `dev-progress.md`), `refs/auto-failed/*`, decisions, rejections and inbox replies, human blockers and archiving, with parent and derived tasks. An unknown ID says so and gives the ID range; no argument keeps the overview.
- Human metrics (T-014): the pane's metric tiles and `/task:status` add 人工介入 (runs ending in 待决策 / 阻塞, plus rejections), 决策等待 (median from 待决策 to the answer) and 回滚率 (rolled-back runs over finished runs). `—` without data; narrow panes fall back to text pairs. The loop now logs `DECIDED`, `REJECTED` and `ROLLBACK` lines; older logs still read, with the earlier rules.
- First pass rate (T-015): a rejection counts from its `REJECTED` line, so a redispatched task no longer drops out of the count.
- Median cycle (T-016): results with a bracketed reason, such as `FAILED（超时）→阻塞`, now end a run.

## 0.3.9 — 2026-11-18

- The dispatcher doesn't write code: while a loop runs or waits for work, a `tool.call` hook refuses the dispatcher session's Edit / Write / MultiEdit / NotebookEdit and MCP filesystem writes to project files. Still writable: `.claude/backlog.md`, `dev-plan.md`, `dev-progress.md`, `.claude/inbox/`, `.claude/auto/`, `.claude/worktrees/`, `.gitignore`, and anything outside the project. The dispatcher is the session that last ran `/task:loop` (kept in `.claude/auto/dispatcher`); other sessions, workers and subagents are not touched, and a halted, stopped or stale loop guards nothing.
- Notifications: new `skills/loop/notify.sh`. The loop sends one system notification when a task lands in 待决策 / 待验证 / 阻塞 and when it stops, at most 100 characters with the `qtask` reply command, deduplicated per event; dispatches and idle stay quiet. `osascript` on macOS, `notify-send` on Linux; `TASK_NOTIFY=off` turns it off, `TASK_NOTIFY_CMD` picks another channel (10-second limit).

## 0.3.8 — 2026-11-17

- Loop watchdog: each heartbeat runs `worker_progress.sh`, which reads file timestamps only. `IDLE` means the worker's output has not grown for 30 minutes. `SPIN` means output is still growing, but the repo has had no new commit and no file change for 60 minutes. On either, the dispatcher reads the worker's last 15 actions (`worker_progress.sh --recent`, tool names plus the start of inputs and results, parsed from the transcript): a legitimate long step (a test suite, a review) is left alone for an hour; repetition or drift gets one `SendMessage` nudge; still stalled 40 minutes after the nudge, the worker is stopped and handled as `FAILED（停滞）`. Each check is logged as a `WATCHDOG` line in `run.log`. The 3-hour timeout stays as the backstop. Not applied in `review_pending`, where the worker is waiting on purpose.

## 0.3.7 — 2026-11-17

- Subagent list: no more blank `○ · 已结束 0s` rows. A SubagentStop with no start seen and no agent type no longer adds a row; blank rows stored by an older version are skipped in the pane and report and dropped on the next write.

## 0.3.6 — 2026-11-17

- Expanded task details (T-012): long text wraps to fill each line. The host wraps at spaces only, so a Chinese run after a space used to move down whole and leave the line before half empty; titles, field values and note clauses are now pre-wrapped to their column (CJK breaks between any two characters, Latin words stay whole, closing punctuation never starts a line). Emoji and CJK beyond the BMP count as two cells.

## 0.3.5 — 2026-11-17

- Recent log on a narrow pane: the date-time and task ID keep their width on one line; only the detail is truncated (long `DONE→待验证` rows used to wrap the time and ID onto two lines).

## 0.3.4 — 2026-11-17

- Task rows on a narrow pane (T-011): the status tag keeps one line at its full width and the title is truncated instead, so each row stays one line tall; a suffixed status drops its suffix where it does not fit. The header's refresh button is gone (the pane refreshes every 5s); a retry button and `r` remain only on the first-read error screen.
- Expanded task details (T-012): a framed card like the current task, with the full title, then module / deps / derived from / acceptance / notes in an aligned label column; notes are split one per line and the acceptance clause is not repeated.
- Direct work shows (T-009): with no loop running, while the main session is handling a turn the status line, pane header and report read `Idle · session working` (中文「空闲 · 会话执行中」), alongside any running subagents; it clears when the turn ends, is interrupted or errors.
- Chinese UI: the `WIP` metric is now 「进行中」 and the Agent section is 「子代理」.

## 0.3.3 — 2026-11-17

- Pane restyled (T-010): the current task sits in a framed card; metrics are framed tiles, four to a row where each tile fits its longest label, plain text otherwise; task statuses are filled colour tags; section headings use the accent colour.
- Docs: README now shows the pane, the docked layout, the text snapshot and how to open each.

## 0.3.2 — 2026-11-17

- Pane and status line show subagents this session runs while no loop task does (`Idle · 1 subagent running`), so direct work no longer reads as idle; a subagent whose stop event never arrives is settled from the engine's agent list (T-009).
- After a plugin update or reload the status line is rewritten from the current pool instead of keeping the old instance's snapshot; a failed or timed-out first read shows the error and a retry hint instead of an endless "Loading task pool…", and the status line flags it with ⚠; the refresh timer restarts from any hook, not only session start (T-008).

## 0.3.1 — 2026-11-17

- Docs: English README (default) with Chinese version in `README.zh-CN.md`; new "Why", guardrails, quick start and "Update" sections.
- Docs: landing page at https://qiqll.github.io/claude-task/ and promo copy in `docs/promo/`.
- Marketplace: clearer English/Chinese descriptions, keywords and homepage.
- Fix: `/task:loop` now logs a `DISPATCH` event when it sends a worker, so the pane's median cycle time is computed (it always showed `—` before).
- Docs: quick start includes moving off `main` and committing the task pool before `/task:loop`; `/task:next` documented as needing git.
- Repo: issue templates and a CI check that the plugin version is bumped when plugin files change.

## 0.3.0 — 2026-11-16

- `/task-dash` prints a full text snapshot into the conversation when the layout isn't fullscreen or the terminal is narrower than 110 columns (T-007).
- `report` argument matches case- and whitespace-insensitively.

## 0.2.0 — 2026-11-16

- Skills and pane merged into one `task` plugin: `/task:init` `/task:add` `/task:next` `/task:loop` `/task:auto` `/task:status` plus `/task-dash` (T-005).
- Interface language follows the OS (plugin setting → `LC_ALL` → macOS preferred language → `LC_MESSAGES` → `LANG`) (T-006).

## 0.1.0 — 2026-11-16

- First release as the separate `task-dash` plugin: task pipeline pane and status line (T-001–T-003), marketplace manifest (T-004).
