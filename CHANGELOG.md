# Changelog

All notable changes to the `task` plugin. Versions follow [semver](https://semver.org/); the version in `plugins/task/.claude-plugin/plugin.json` is what Claude Code uses to detect updates.

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
