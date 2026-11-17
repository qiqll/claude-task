# 社媒帖子草稿

口径来自 [messaging.md](messaging.md)。发帖前：
1. 把 `【】` 里的内容换成你真实跑出来的数字和截图。
2. 链接统一用落地页 https://qiqll.github.io/claude-task/ （想统计来源可以加 `?ref=v2ex` 这类参数）。
3. 配图优先级：演示 GIF > 面板截图 > og 卡片。

---

## 中文

### V2EX（分享创造）/ 掘金 —— 长文

**标题：** 我写了个 Claude Code 插件：把需求丢进任务池就去睡觉，第二天早上收验收过的提交

用 Claude Code 久了，最累的不是写代码，而是陪它写代码：它做一件，我等一件；我想到新需求，还得等它忙完才能说。

所以我做了 claude-task，把 agent 从「助理」变成「交付团队」：

1. **主会话只当项目经理。** 它只听你说、派活、验收。具体实现交给全新上下文的后台 worker，审查交给 code-reviewer / security-analyst 子 agent。
2. **每个需求都是一张工单。** 口语需求会自动变成带 ID、优先级、验收标准的任务，经过实施、审查门禁和测试，进入「待验证」，你确认后才归档。全部记录在仓库里的 Markdown 中，可以直接 diff。
3. **全异步。** 想到就丢，可以在会话里插话，也可以在任意终端 `qtask "描述"`，正在做的任务不受打扰。需要拍板的事项进「待决策」，其余按最保守的做法继续。
4. **进度一目了然。** 右侧面板和状态行实时显示在做什么、做完什么、还剩什么、等你决定什么。

我最在意的是**敢不敢放手**，所以加了这些护栏：
- 不信 worker 自述，调度员亲自重跑测试；
- 自动检测测试被改弱（删用例、加 skip、断言变少）；
- schema、认证、计费、删数据、对外 API、部署、依赖这类改动，只要有多种做法就停下来问；
- 失败自动回滚，保留 `refs/auto-failed/*` 供复盘；
- 不在 main 上跑，从不 push。

【实测：一晚跑了 N 个任务，X 个待验证，Y 个待决策。附截图】

安装（在 Claude Code 里输入）：
```
/plugin install task --marketplace qiqll/claude-task
```
然后新开会话，`/task:init` → `/task:add …` → `/task:loop`。

主页：https://qiqll.github.io/claude-task/
GitHub：https://github.com/qiqll/claude-task（MIT，欢迎提 issue）

### 即刻 / 朋友圈 —— 短帖

做了个 Claude Code 插件 claude-task：需求一股脑丢进任务池就去忙别的，后台 agent 一个个交付，调度员亲自重跑测试才算完成，面板上实时看进度。不碰 main、从不 push，高风险改动先问你。
【配 GIF】
👉 https://qiqll.github.io/claude-task/

### 小红书 —— 图文

**标题：** 让 Claude Code 自己加班｜我做了个任务池插件
**图：** ① og 卡片 ② 面板截图 ③ 「需求 → 工单 → worker → 审查 → 重跑测试 → 待验证」流程图 ④ 护栏列表 ⑤ 安装命令
**正文：**
以前用 AI 写代码要一直盯着，现在把需求丢进任务池就能去睡觉 😴
✅ 主会话当项目经理，后台 agent 干活
✅ 每个需求按工单交付，测试由调度员亲自重跑
✅ 想到就丢，不用等它做完
✅ 面板实时看进度
✅ 不碰 main、不 push，高风险改动先问你
安装：在 Claude Code 里输入 `/plugin install task --marketplace qiqll/claude-task`
#ClaudeCode #AI编程 #程序员效率 #开源

---

## English

### X / Twitter —— thread

1/ I built a Claude Code plugin that turns it from an assistant into a delivery team.

Dump requests into a backlog, run `/task:loop`, walk away. Come back to reviewed, test-verified commits waiting for your OK. 🧵
【GIF】

2/ The main session only listens, dispatches and accepts. Each task goes to a background worker with a fresh context, then through code review.

3/ The part I care about most: it doesn't trust the worker. The dispatcher re-runs your tests itself, and flags weakened tests (deleted cases, new skips, fewer assertions).

4/ High-risk choices (schema, auth, billing, data deletion, public APIs, deploy, deps) go to a decision queue instead of being guessed. Failures roll back. Never runs on main, never pushes.

5/ Fully async: add tasks any time, from the chat or `qtask "…"` in any terminal. A side pane + status line shows what's running, done, and waiting on you.

6/ Install inside Claude Code:
`/plugin install task --marketplace qiqll/claude-task`
https://qiqll.github.io/claude-task/ (MIT)

### Reddit（r/ClaudeAI, r/ClaudeCode）

**Title:** I made a Claude Code plugin that works through a backlog overnight, and re-runs the tests itself before accepting anything

**Body:**
I got tired of babysitting Claude Code one request at a time, so I built **claude-task**.

- You add requests in plain language (`/task:add …`, or `qtask "…"` from any terminal). Each becomes a ticket with an ID, a priority and acceptance criteria.
- `/task:loop` makes your session a dispatcher. It sends each task to a fresh background worker, runs a review gate, **re-runs the tests itself**, and checks that tests weren't weakened.
- Finished tasks land in "to verify"; nothing is archived until you confirm.
- Risky choices (migrations, auth, billing, deletes, public APIs, deploy, deps) go to a decision queue. Failed attempts are rolled back and kept under `refs/auto-failed/*`. It never runs on main and never pushes.
- A side pane and status line show progress live.

【Real numbers from one night + screenshot】

Install: `/plugin install task --marketplace qiqll/claude-task`
Repo: https://github.com/qiqll/claude-task. Feedback welcome, especially on the guardrails.

### Hacker News —— Show HN

**Title:** Show HN: Claude-task – a backlog loop for Claude Code that verifies its own work
**URL:** https://github.com/qiqll/claude-task
**First comment:**
Hi HN. claude-task is a Claude Code plugin that keeps a Markdown backlog in your repo and works through it with background worker agents, one task at a time. The design goal was being able to walk away safely: the dispatcher never takes the worker's word for it, re-runs the tests, diffs for weakened tests, rolls back failures, asks before high-risk changes, and never touches main or pushes. Everything is plain files under `.claude/`, so you can read and edit the state yourself. Happy to answer questions about the guardrails or where they fall short.

---

## Awesome 列表 PR 用的条目

```markdown
- [claude-task](https://github.com/qiqll/claude-task) - Backlog-driven autonomous loop: a dispatcher sends each task to a fresh worker agent, re-runs tests, detects weakened tests, and shows progress in a live pane. Never pushes or runs on main.
```
