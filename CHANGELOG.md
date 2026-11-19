# Changelog

All notable changes to the `task` plugin. Versions follow [semver](https://semver.org/); the version in `plugins/task/.claude-plugin/plugin.json` is what Claude Code uses to detect updates.

## 0.3.12 — 2026-11-19

Fewer tasks waiting on you in 待验证 (to verify):

- Auto acceptance: when the loop's machine checks all pass (`PASS`, no test-weakening warning at all, no high-risk path, no new decision, no assumptions), a task that only touched tests (rule a), or a P2 / P3 task tagged `验收方式：自动` by `/task:add` with acceptance criteria the requester gave (rule b), is archived as 已完成 straight away. `run.log` logs `DONE→已完成（自动验收）`; the brief still goes out, without a notification. `/task:next` has no auto acceptance.
- Default pass on timeout: a task in 待验证 for `**待验证超时：** N 天` (7 when the backlog doesn't say; `0` turns it off) is announced a day ahead in one notification, then archived as passed if nobody rejected it in the next 24 hours. Before closing, the dispatcher checks that the delivered commits are still on the branch and not reverted; if they aren't, the task goes to 待决策 instead. Older tasks get their start date from their commits on the first check (`· 存量`). High-risk changes, changes to tests and notes saying `默认通过：否` never pass by default. The loop runs the check after merging the inbox and when idle on a heartbeat; `/task:next` runs it when no loop is running. `run.log` logs `TIMEOUT_PASS`.
- Every task entering 待验证 gets `待验证起` and `怎么验` (≤3 steps, a command or URL first) in its note; the worker report has a new `VERIFY` field. Redelivery replaces the old clauses.
- Rejecting an archived task (`qtask -d T-0NN "打回：…"`) reopens it. `dev-progress.md` records say how each task was closed: by the requester, by auto acceptance or by timeout.
- `qtask`: `-d T-1,T-2 "…"` answers several tasks at once; `qtask --pass [IDs]` confirms all (or the given) tasks in 待验证, and `--except T-x` leaves some out. A stale pass for a task no longer in 待验证 is skipped. A loop counts as running while its last START / STOP line is START.
- Pane: a 待验证 card shows 怎么验 and when it passes by default (or that it won't); a new 免验关闭 (Auto-closed) tile counts tasks closed without anyone looking, which are left out of the first-pass rate. `/task:status` lists tasks in 待验证 with days waiting, steps and due date, plus the `qtask --pass` command.
- Look-first order: `skills/loop/verify_signals.sh` uses git only to rank each task in 待验证 by signs of use: did a later task, now archived or in 待验证, change the same files (shared files touched by 4+ tasks, tests, version files and changelogs don't count), and has a task that depends on it or derives from it been delivered. The expiry notice, `/task:status` and the pane's 待验证 filter list tasks with no sign and a user-visible change first, and tasks with signs of use (✓) last; within a tier, the one waiting longest comes first. This changes the order only, never whether a task closes.
- Rules shared by the loop and `/task:next` are in `skills/loop/VERIFY.md`.

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
