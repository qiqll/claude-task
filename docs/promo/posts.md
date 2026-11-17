# 社媒帖子（可直接复制发布）

口径来自 [messaging.md](messaging.md)。图片都在 [assets/](assets/)，每个帖子下方写了配哪几张。

- 链接统一用落地页 https://qiqll.github.io/claude-task/ （想统计来源可以加 `?ref=v2ex` 这类参数）。
- 面板图是插件**真实渲染的输出**，但用的是演示任务池（图上已标注）。等你自己跑过一晚，可以把图换成真实截图，文案里加一句真实结果，效果更好。
- 帖子里的「这个插件是用它自己开发的」是真实的：仓库 `.claude/dev-progress.md` 里 T-001～T-007 都经过任务池和审查门禁。

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `assets/xhs-1-cover.png` … `xhs-5-install.png` | 1080×1440 | 小红书 / 即刻 / 朋友圈（3:4） |
| `assets/x-1-hero.png` … `x-4-guardrails.png` | 1600×900 | X / Reddit / 掘金头图 / V2EX（16:9） |
| `assets/x-zh-1-hero.png` … `x-zh-4-guardrails.png` | 1600×900 | 中文 16:9（掘金 / V2EX / 中文 README） |
| `assets/dash-wide-{en,zh}.png` | 1600 宽 | `/task-dash` 完整文字快照横版（README 面板一节） |
| `assets/dash-dock-{en,zh}.png` / `dash-pane-{en,zh}.png` | 1600 宽 / 820 宽 | 右侧面板示意图：整窗停靠 / 面板单图（源：`assets-src/pane.py`） |
| `assets/landing-hero-{zh,en}.png` | 1440×900 | 落地页首屏截图 |
| `assets/landing-full-{zh,en}.png` | 1440×全页 | 落地页长图 |
| `assets/landing-mobile-{zh,en}.png` | 390×844 | 手机端截图 |
| `../assets/og.png` | 1200×630 | 链接预览卡片（已自动生效） |

图片源文件是 `assets-src/cards.html`，改文字后运行 `python3 docs/promo/assets-src/gen.py .`，再截图即可。

---

## V2EX（分享创造 / Claude Code 节点）

**标题：**
```
[开源] 让 Claude Code 自己加班：需求丢进任务池，后台 agent 逐个交付，测试由调度员亲自重跑
```

**正文：**
```
用 Claude Code 久了，最累的不是写代码，而是陪它写代码：它做一件，我等一件；想到新需求，还得等它忙完才能说。

所以我做了 claude-task，把 agent 从「助理」变成「交付团队」：

1. 主会话只当项目经理：听你说、派活、验收。具体实现交给全新上下文的后台 worker，审查交给 code-reviewer / security-analyst 子 agent。
2. 每个需求都是一张工单：口语需求自动变成带 ID、优先级、验收标准的任务，经过实施 → 审查门禁 → 调度员重跑测试 → 「待验证」，你确认后才归档。全部记录在仓库里的 Markdown 中，可以直接 diff。
3. 全异步：想到就丢，在会话里插话或在任意终端 `qtask "描述"`，正在做的任务不受打扰。需要拍板的进「待决策」，其余按最保守的做法继续。
4. 进度一目了然：右侧面板和状态行实时显示在做什么、做完什么、还剩什么、等你决定什么。

我最在意的是「敢不敢放手」，所以加了这些护栏：
- 不信 worker 自述，调度员亲自重跑测试；
- 自动检测测试被改弱（删用例、加 skip、断言变少）；
- schema、认证、计费、删数据、对外 API、部署、依赖这类改动，有多种做法就停下来问；
- 失败自动回滚，保留 refs/auto-failed/* 供复盘；
- 不在 main 上跑，从不 push。

这个插件本身就是用它自己开发的：7 个任务都走了任务池和审查门禁，审查发现的 High 问题全部修复后才交付。

安装（在 Claude Code 输入框里）：
/plugin install task --marketplace qiqll/claude-task

主页：https://qiqll.github.io/claude-task/?ref=v2ex
GitHub：https://github.com/qiqll/claude-task （MIT，欢迎提 issue）
```

**配图：** `x-1-hero.png`、`x-2-panel.png`（V2EX 插图需要先上传到图床，或者直接贴落地页链接）

---

## 掘金 —— 长文

**标题：**
```
我给 Claude Code 写了个任务池插件：从「陪 AI 写代码」到「给 AI 派活」
```

**正文：** 直接用上面 V2EX 的正文，在开头加一段场景、在「护栏」之后加一段实现思路：
```
## 实现思路

- 状态全在文件里：.claude/backlog.md（任务表）、dev-plan.md（排期）、dev-progress.md（归档）、auto/run.log（流水）。会话随时可以断，一句「继续」就能从文件恢复。
- 调度员和 worker 分离：调度员不写业务代码、不读大段 diff，只负责派发和验收；每个 worker 都是全新上下文，不会被前一个任务的上下文污染。
- 验收不靠自述：worker 交报告时带一次性口令（nonce），调度员核对口令后亲自重跑测试，再用脚本比对测试是否被改弱。迟到或重复的通知直接丢弃，避免误回滚下一个任务。
```
**封面：** `x-1-hero.png`；文中插图：`x-2-panel.png`、`x-3-flow.png`、`x-4-guardrails.png`
**标签：** `Claude Code` `AI 编程` `开源`

---

## 即刻 / 朋友圈 —— 短帖

```
做了个 Claude Code 插件 claude-task：需求一股脑丢进任务池就去忙别的，后台 agent 一个个交付，调度员亲自重跑测试才算完成，面板上实时看进度。不碰 main、从不 push，高风险改动先问你。开源 MIT。
👉 https://qiqll.github.io/claude-task/
```
**配图：** `xhs-1-cover.png`、`xhs-2-panel.png`、`xhs-4-guardrails.png`

---

## 小红书 —— 图文

**标题：**
```
让 Claude Code 自己加班｜我做了个任务池插件
```
**图（按顺序）：** `xhs-1-cover.png` → `xhs-2-panel.png` → `xhs-3-flow.png` → `xhs-4-guardrails.png` → `xhs-5-install.png`

**正文：**
```
以前用 AI 写代码要一直盯着，做完一件才能提下一件。
现在把需求丢进任务池就能去睡觉 😴

✅ 主会话当项目经理，后台 agent 干活
✅ 每个需求按工单交付：ID、优先级、验收标准
✅ 测试由调度员亲自重跑，不信 AI 自述
✅ 想到就丢，不用等它做完
✅ 面板实时看进度，等你拍板的事单独列出
✅ 不碰 main、不 push，高风险改动先问你

这个插件本身就是用它自己开发的～

安装：在 Claude Code 里输入
/plugin install task --marketplace qiqll/claude-task

开源免费，GitHub 搜 qiqll/claude-task

#ClaudeCode #AI编程 #程序员 #效率工具 #开源项目
```

---

## X / Twitter —— thread

**1/**（配图 `x-1-hero.png`）
```
I built a Claude Code plugin that turns it from an assistant into a delivery team.

Dump requests into a backlog, run /task:loop, walk away. Come back to reviewed, test-verified commits waiting for your OK. 🧵
```
**2/**（配图 `x-3-flow.png`）
```
Your main session only listens, dispatches and accepts. Each task goes to a background worker with a fresh context, then through a code-review gate.
```
**3/**
```
The part I care about most: it doesn't trust the worker.

The dispatcher re-runs your tests itself, and flags weakened tests: deleted cases, new skips, fewer assertions.
```
**4/**（配图 `x-4-guardrails.png`）
```
Risky choices (schema, auth, billing, data deletion, public APIs, deploy, deps) go to a decision queue instead of being guessed.

Failures roll back. Never runs on main, never pushes.
```
**5/**（配图 `x-2-panel.png`）
```
Fully async: add tasks any time from the chat, or `qtask "…"` from any terminal. A side pane + status line shows what's running, done, and waiting on you.
```
**6/**
```
I built the plugin with itself: every task went through the backlog and the review gate.

Install inside Claude Code:
/plugin install task --marketplace qiqll/claude-task

https://qiqll.github.io/claude-task/ (MIT)
```

---

## Reddit（r/ClaudeCode 先发；r/ClaudeAI 发前先看版规或问版主）

**Title:**
```
I made a Claude Code plugin that works through a backlog while you're away, and re-runs the tests itself before accepting anything
```
**Body:**
```
I got tired of babysitting Claude Code one request at a time, so I built claude-task.

- Add requests in plain language (`/task:add …`, or `qtask "…"` from any terminal). Each becomes a ticket with an ID, a priority and acceptance criteria.
- `/task:loop` turns your session into a dispatcher. It sends each task to a fresh background worker, runs a review gate, **re-runs the tests itself**, and checks that tests weren't weakened.
- Finished tasks land in "to verify"; nothing is archived until you confirm.
- Risky choices (migrations, auth, billing, deletes, public APIs, deploy, deps) go to a decision queue. Failed attempts are rolled back and kept under `refs/auto-failed/*`. It never runs on main and never pushes.
- A side pane and status line show progress live (screenshot uses a demo task pool).

I built the plugin with itself, so every change went through the same backlog and review gate.

Install: `/plugin install task --marketplace qiqll/claude-task`
Repo: https://github.com/qiqll/claude-task. Feedback welcome, especially on the guardrails and where they fall short.
```
**配图：** `x-2-panel.png`（r/ClaudeAI 如果有 "Built with Claude" 标签就选上）

---

## Hacker News —— Show HN

**Title:**
```
Show HN: Claude-task – a backlog loop for Claude Code that verifies its own work
```
**URL：** `https://github.com/qiqll/claude-task`（HN 不支持图片，链接指向仓库）

**First comment（发完立刻自己评论）：**
```
Hi HN. claude-task is a Claude Code plugin that keeps a Markdown backlog in your repo and works through it with background worker agents, one task at a time.

The design goal was being able to walk away safely: the dispatcher never takes the worker's word for it. It re-runs the tests, diffs for weakened tests (deleted cases, new skips, fewer assertions), rolls back failures, asks before high-risk changes, and never touches main or pushes. All state is plain files under .claude/, so you can read and edit it yourself.

Known limits: workers run serially, the weakened-test check can't catch loosened assertions, and the docked pane needs Claude Code's fullscreen layout. Happy to answer questions.
```

---

## 提交到列表 / 周刊用的文字

**awesome-claude-code（走 Issues 页的 "Recommend a new resource" 表单，不要提 PR）：**
- Name: `claude-task`
- Category: Plugins（没有就选 Workflows）
- Link: `https://github.com/qiqll/claude-task`
- Description（一行，不要 emoji 和营销腔）：
```
Backlog-driven task loop for Claude Code: a dispatcher sends each task to a fresh worker agent, re-runs tests, detects weakened tests, and shows progress in a side pane. Never pushes or runs on main.
```

**HelloGitHub（在 521xueweihan/HelloGitHub 提自荐 issue）：**
```
项目地址：https://github.com/qiqll/claude-task
类别：其它（AI / 效率工具）
项目标题：让 Claude Code 自己加班的任务池插件
项目描述：Claude Code 插件。需求用口语丢进仓库里的 Markdown 任务池，调度员把每个任务派给全新上下文的后台 agent 实施，经代码审查后亲自重跑测试、检测测试是否被改弱，验收通过才算交付；高风险改动先问人，不碰 main、不 push。右侧面板实时展示进度。
亮点：护栏完整，敢挂机；状态全是纯文本文件，可读可改；中英双语界面。
截图：https://raw.githubusercontent.com/qiqll/claude-task/main/docs/promo/assets/xhs-2-panel.png
```

**阮一峰《科技爱好者周刊》（在 ruanyf/weekly 提 issue，周二到周四提交，没选上不要重投）：**
```
标题：claude-task：Claude Code 的任务池插件
链接：https://github.com/qiqll/claude-task
介绍：一个 Claude Code 插件，把需求变成仓库里的 Markdown 工单，由后台 agent 逐个实施，调度员重跑测试验收后才算交付，进度在终端面板里实时显示。（作者自荐）
```
