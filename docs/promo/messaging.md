# 对外文案基线（Messaging）

所有对外文案（README、插件市场描述、落地页、社媒帖子）都从这里取词，改口径先改这里。

- 安装命令：`/plugin install task --marketplace qiqll/claude-task`
- 仓库：https://github.com/qiqll/claude-task
- 落地页：https://qiqll.github.io/claude-task/ （GitHub Pages，`main` 分支 `/docs` 目录）

## 一句话

| | 中文 | English |
|---|---|---|
| 标题 | 把 Claude Code 从助理变成交付团队 | Turn Claude Code from an assistant into a delivery team |
| 副标题 | 需求一股脑丢进任务池就去忙别的。调度员把每个任务派给全新上下文的 worker，亲自重跑测试，机器验收通过才算交付。 | Dump requirements into a backlog and walk away. A dispatcher hands each task to a fresh worker agent, re-runs your tests itself, and only calls it delivered when the machine agrees. |
| 市场短描述（≤120 字符） | 异步任务流水线：需求进任务池，后台 agent 逐个交付、机器验收，面板实时看进度 | Async task pipeline for Claude Code: backlog in, reviewed & test-verified commits out, live progress pane |

## 四个卖点 + 一个护城河

### 1. 从助理到团队 / From assistant to team
- 中：主会话只做三件事——听你说、派活、验收。具体实现交给全新上下文的后台 worker，代码审查交给 `code-reviewer` / `security-analyst`。你面对的是一个项目经理，而不是一个埋头敲代码、顾不上理你的助理。
- EN: Your main session only listens, dispatches and accepts. Implementation goes to a background worker with a fresh context; review goes to `code-reviewer` / `security-analyst`. You talk to a project lead, not to an assistant too busy coding to listen.

### 2. 需求即任务，按工程标准交付 / Every request is a ticket, delivered to engineering standards
- 中：一句口语需求 → 规范任务（ID、优先级、验收标准）→ 实施 → 审查门禁 → 调度员亲自重跑测试 → 「待验证」→ 你确认后归档。每一步都落在仓库里的 Markdown 文件中，可追溯、可 diff。
- EN: A casual request becomes a ticket (ID, priority, acceptance criteria) → implementation → review gate → the dispatcher re-runs the tests itself → "awaiting verification" → archived only after you confirm. Every step lives in plain Markdown in your repo — traceable and diffable.

### 3. 全异步：想到就丢 / Fully async: fire and forget
- 中：不用再和 agent 同频，不用等它做完一件才提下一件。随时在会话里插话，或在任意终端 `qtask "描述"` 投递；当前任务不受打扰。需要你拍板的挂进「待决策」，其余按最保守的做法继续推进。
- EN: No more waiting for one thing to finish before asking for the next. Speak up any time, or `qtask "…"` from any terminal — the current task is never interrupted. Anything that needs your call goes to a decision queue; everything else keeps moving with the most conservative choice.

### 4. 进度一目了然 / Everything visible at a glance
- 中：右侧面板 + 输入框下方状态行实时显示：正在做什么、做完了什么、还剩什么、等你决定什么；任务进入待验证 / 待决策 / 阻塞时弹提醒。完成率、一次通过率、中位周期一并给出。
- EN: A side pane and a status line show what's running, what's done, what's left and what's waiting on you; toasts fire when a task needs verification or a decision, or gets blocked. Completion rate, first-pass rate and median cycle time included.

### 护城河：敢放手的护栏 / Guardrails that let you walk away
- 中：
  - 不信 worker 自述：调度员亲自重跑测试才算完成。
  - 防作弊：自动检测测试被改弱（删用例、加 skip、断言变少）。
  - 高风险领域（schema/迁移、认证/加密、计费、删数据、对外 API、部署、依赖）有多种做法时停下来问你。
  - 失败自动回滚，并保留 `refs/auto-failed/*` 供你复盘；失败两次转阻塞。
  - 不在 main/master 上跑，从不 push；`STOP` 文件、任务数 / 时长预算、连续无进展三重停机。
- EN:
  - Never trusts the worker's word: the dispatcher re-runs the tests itself.
  - Catches cheating: detects weakened tests (deleted cases, new skips, fewer assertions).
  - Stops and asks on high-risk choices: schema/migrations, auth/crypto, billing, data deletion, public APIs, deployment, dependencies.
  - Failed attempts are rolled back and kept under `refs/auto-failed/*` for review; two failures → blocked.
  - Never runs on main/master, never pushes; stops on a `STOP` file, task/time budgets, or three rounds without progress.

## 诚实边界（文案不要越过）

- worker 一次只跑一个（串行），不要宣传「并行团队」。
- 完成态是「待验证」，最终确认在人；不要说「全自动上线」。
- 右侧停靠面板需要全屏布局（`CLAUDE_CODE_NO_FLICKER=1`）且终端 ≥110 列，否则输出文字快照。
- `/task:loop` 需要 git 仓库与非 main 分支。

## 典型场景（用于帖子开头）

> 下面的数字是示意。发帖前换成你自己真实跑出来的数字（run.log / `/task:status`），并配截图。

- 中：下班前把一周攒下的 10 条需求丢进去，`/task:loop`，第二天早上看到 7 条「待验证」、2 条「待决策」、1 条阻塞说明。
- EN: Before logging off, dump the week's ten requests and run `/task:loop`. Next morning: seven tasks awaiting verification, two decisions waiting for you, one blocker explained.
