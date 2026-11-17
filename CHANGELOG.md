# Changelog

All notable changes to the `task` plugin. Versions follow [semver](https://semver.org/); the version in `plugins/task/.claude-plugin/plugin.json` is what Claude Code uses to detect updates.

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
