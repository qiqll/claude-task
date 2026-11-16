---
name: init
description: "在当前项目初始化任务待办池机制 — 创建 .claude/backlog.md / dev-plan.md / dev-progress.md 三个数据文件（已存在则跳过），之后即可用 /task:add /task:next /task:status。Usage: /task:init"
user-invocable: true
---

# 初始化任务待办池

在当前项目根目录下创建异步开发模式所需的三个数据文件。**已存在的文件一律不动**，只补缺失的。

模板位于本 skill 目录下的 `templates/`（即 `${CLAUDE_PLUGIN_ROOT}/skills/init/templates/`）：

| 模板 | 目标路径 | 作用 |
|------|---------|------|
| `templates/backlog.md` | `.claude/backlog.md` | 待办池（需求方唯一入口），含状态机 / 优先级定义 / P0-P3 表 / 人工阻塞事项 / ID 分配规则 |
| `templates/dev-plan.md` | `.claude/dev-plan.md` | AI 维护的排期：当前批次 / 进行中任务 / 技术前置分析 |
| `templates/dev-progress.md` | `.claude/dev-progress.md` | 已完成任务归档流水 |

---

## 执行

1. 确认当前目录是项目根（有 `.git` 或 `CLAUDE.md`）。不是则问需求方要在哪里初始化，不要猜。
2. 若 `.claude/` 不存在则创建。
3. 对三个文件逐个检查：存在 → 跳过并在回执里说明；不存在 → 用 Read 读对应模板，原样写入目标路径。写 `dev-plan.md` 时把 `YYYY-MM-DD` 换成今天日期；`dev-progress.md` 里的 `## YYYY-MM` 换成当月。
4. **自动循环运行目录**：创建 `.claude/inbox/` 与 `.claude/auto/`；若 `.gitignore` 未忽略它们，追加两行 `.claude/inbox/`、`.claude/auto/`（这是运行时状态，不入版本库）。已存在的 `backlog.md` 若缺「待决策」章节，按 `${CLAUDE_PLUGIN_ROOT}/skills/loop/SKILL.md` 文末模板补上。
5. **检查项目 `CLAUDE.md`** 是否已说明异步开发模式。若没有，在回执里给出可直接粘贴的片段（见文末），不要自行改 `CLAUDE.md`。
6. 回执：列出创建了哪些、跳过了哪些，提示下一步用 `/task:add` 录第一条需求，或 `/task:loop` 开启自动循环。

不要 commit —— 由需求方决定是否纳入版本管理（通常应纳入）。

## 建议追加到项目 `CLAUDE.md` 的片段

```markdown
### 异步开发模式

需求方把需求放入 `.claude/backlog.md`，AI 逐个消化。工作流由 `task` 插件的技能执行（`/task:add` `/task:next` `/task:loop` `/task:status`），进度看 `/task-dash` 面板：

| 触发场景 | 调用 |
|---------|------|
| 需求方描述新需求/Bug（不要求立刻做） | `/task:add` 录入待办池（终端装了 `qtask` 的可用 `qtask "描述"` 投递，见插件 README） |
| 需求方说"自动跑/挂机/开启自动模式" | `/task:loop` 调度员 + 后台 worker 连续消化 |
| 需求方说"继续/下一个/开始开发/接着做" | 自动循环运行中 → 交给调度员；否则 `/task:next` 单步 |
| 需求方问"进度如何/还有什么没做/待办清单" | `/task:status` |

**核心纪律：**
- 手动模式（`/task:next`）一次只做一个任务，做完停止；自动模式（`/task:loop`）连续消化，但停机条件、验收、衍生上限按 skill 执行。
- 待办池空了就报告空，**禁止自己发明需求**。
- 需求方直接口述"帮我改 XX"（明确要求立刻做）时正常处理，不必强制走待办池；改完建议补录一条到 `dev-progress.md`。
- 任务完成态是「待验证」，需求方确认后才转「已完成」并归档。
```
