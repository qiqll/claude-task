# claude-task-dash

**Claude Code 任务流水线面板**：把 `.claude/backlog.md` 任务池、自动循环的当前 worker、交付指标和运行流水，放进 Claude Code 的右侧面板和输入框下方的状态行。

它是 `task-*` 技能体系（`/task-init` `/task-add` `/task-next` `/task-loop` `/task-status`）的只读仪表盘：只读文件，从不修改任务池。

> **前提**：面板只负责展示，任务池由 `task-*` 技能维护，这些技能**不包含在本仓库**。没有它们也能用：按下文「最小任务池」手写 `.claude/backlog.md` 即可看到面板。

## 安装

在 Claude Code 终端会话的输入框里：

```text
/plugin install task-dash --marketplace qiqll/claude-task-dash
```

提示 `Add marketplace?` 时按 `y`，然后选择安装范围（推荐 user）。安装后**新开一个会话**生效（`/task-dash` 命令和定时刷新在会话启动时注册）。

## 使用

| 位置 | 内容 | 操作 |
|---|---|---|
| 输入框下方状态行 | `任务流水线 ● 运行中 · T-071 标题 · 12m · 待验证 2 · 待决策 1 · /task-dash`（无当前任务时显示「待开始 N」） | `/task-dash off` 隐藏，`/task-dash on` 恢复 |
| 右侧面板 | 循环状态、当前任务、指标、可筛选任务列表、待决策、人工阻塞、Agent、最近流水 | `/task-dash` 打开；`ctrl+x tab` 聚焦，`r` 刷新，`Esc` 或 `ctrl+x x` 关闭 |
| 提醒 | 任务进入待验证 / 待决策 / 阻塞时弹 toast | — |

**右侧停靠需要 Claude Code 的全屏布局**，并且终端至少 110 列：

```sh
CLAUDE_CODE_NO_FLICKER=1 claude      # 或在 ~/.zshrc 里 export
```

不满足时 `/task-dash` 不会把面板插到输入框上方挡住输出，只给出提示；确实想内嵌就用 `/task-dash inline`。

## 数据来源

从会话目录向上找到第一个含 `.claude/backlog.md` 的目录，读取：

```text
.claude/
├── backlog.md        # P0–P3 任务表、待决策、人工阻塞
├── dev-progress.md   # 已归档任务（### T-NNN）
├── inbox/            # 待合并投递（只计数）
└── auto/
    ├── current       # 当前派发：task / phase / worker / started …
    ├── session       # 循环计数：run_started / max / hours / done / noprog
    ├── run.log       # 时间 | T-NNN | 事件 | …
    └── STOP          # 停机标记
```

每 5 秒、每轮对话结束、每个子 agent 结束时刷新；内容没变不重绘。

### 最小任务池

没有 `task-*` 技能时，手写一个 `.claude/backlog.md` 就能用（`auto/`、`dev-progress.md` 都可省略）：

```markdown
## P1 — 重要

| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |
|----|------|------|------|------|------|
| T-001 | 给登录接口加限流 | backend | 进行中 | — | 验收：pytest tests/test_auth.py 通过 |
| T-002 | 统一错误码 | backend | 待开始 | T-001 | — |

## 待决策

| 任务 | 问题 | 选项（推荐在前） | 挂起时间 |
|------|------|-----------------|---------|
```

- 优先级标题以 `P0`–`P3` 开头；任务 ID 形如 `T-NNN`。
- 状态取值：`待开始` `进行中` `待验证` `待决策` `阻塞` `打回` `已完成` `已取消`（可带后缀，如 `待验证✗验证失败`）。
- 备注里的 `验收：…` 会显示为验收标准，`衍生自 T-NNN` 显示来源。

### 指标口径

| 指标 | 算法 |
|---|---|
| 完成率 | 已归档 /（已归档 + 未关闭任务） |
| 交付率 | （已归档 + 待验证）/ 同上 |
| 一次通过 | 交付过的任务中，从未出现「打回重做」的比例（按任务计） |
| 7 日交付 | 近 7 天 run.log 中 `DONE→` 事件数 |
| 中位周期 | run.log 中 `DISPATCH` 到结果事件的中位时长 |
| 疑似中断 | 循环在跑或等待任务，但 3 小时无任何活动，或已超出时长预算 3 小时以上 |

## 开发

```sh
claude plugin validate plugins/task-dash
claude plugin test plugins/task-dash
claude --plugin-dir plugins/task-dash     # 从源码加载
```

本仓库自身也用 `task-*` 体系管理，任务池在 `.claude/`。

## License

MIT
