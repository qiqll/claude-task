# claude-task

**Claude Code 异步任务流水线**：一个插件装齐——`task:*` 技能维护 `.claude/backlog.md` 任务池（录入、单步交付、后台 worker 自动循环、机器验收），右侧面板和输入框下方状态行实时展示进度。

## 安装

在 Claude Code 终端会话的输入框里：

```text
/plugin install task --marketplace qiqll/claude-task
```

提示 `Add marketplace?` 时按 `y`，选择安装范围（推荐 user），然后**新开一个会话**生效。

## 命令

| 命令 | 作用 |
|---|---|
| `/task:init` | 在项目根建任务池：`.claude/backlog.md` / `dev-plan.md` / `dev-progress.md` + `inbox/` `auto/` 运行目录 |
| `/task:add <需求>` | 口语化需求 → 规范条目（分配 ID、判优先级、写验收标准），只录入不实施 |
| `/task:next [T-NNN]` | 手动单步：挑一个任务实施 → 审查门禁 → 提交 → 转「待验证」后停下 |
| `/task:loop [max=10] [hours=8]` | 自动循环：主会话只调度，每个任务派后台 worker（`/task:auto`），机器重跑测试验收 |
| `/task:status` | 全局视图：各优先级计数、待决策、阻塞、下一步建议 |
| `/task-dash [report [all]\|inline\|off\|on]` | 全屏布局下打开右侧面板，否则把完整快照输出到对话里；`report all` 列出全部任务；`off`/`on` 隐藏或恢复状态行 |
| `qtask "描述"` | 在自己的终端里往运行中的循环投递任务 / 决策（需单独安装，见下） |

状态机：`待开始 → 进行中 → 待验证 → 已完成`，旁路 `阻塞` / `待决策` / `打回`。任务完成态是「待验证」，需求方确认后才归档。

`/task:loop` 需要 git 仓库（记开工 SHA、按提交验收）；`/task:add` `/task:next` `/task:status` 不需要。自动循环运行期间不要升级本插件（技能路径带版本号，升级会让运行中的循环找不到脚本）。

### qtask（可选）

插件的 `bin/` 只在 Claude 的 Bash 工具里可用，你自己的终端里没有。想在终端投递，装一份到 PATH：

```sh
curl -fsSL https://raw.githubusercontent.com/qiqll/claude-task/main/plugins/task/bin/qtask -o ~/.local/bin/qtask && chmod +x ~/.local/bin/qtask
qtask -h
```

不装也行：在调度会话里直接说「加个任务：…」「T-0NN 选 A」，效果相同。

## 面板与状态行

| 位置 | 内容 | 操作 |
|---|---|---|
| 输入框下方状态行 | `任务流水线 ● 运行中 · T-071 标题 · 12m · 待验证 2 · 待决策 1 · /task-dash` | `/task-dash off` / `on` |
| 右侧面板 | 循环状态、当前任务、指标、可筛选任务列表、待决策、人工阻塞、Agent、最近流水 | `/task-dash` 打开；`ctrl+x tab` 聚焦，`r` 刷新，`Esc` 或 `ctrl+x x` 关闭 |
| 提醒 | 任务进入待验证 / 待决策 / 阻塞时弹 toast | — |

**右侧停靠需要 Claude Code 的全屏布局**，且终端至少 110 列：

```sh
CLAUDE_CODE_NO_FLICKER=1 claude      # 或在 ~/.zshrc 里 export
```

不满足时 `/task-dash` 不会把面板插到输入框上方挡住输出，而是把完整快照（当前任务、指标、任务列表、待决策、人工阻塞、Agent、最近流水）作为一条命令输出打进对话，随对话滚动、不占模型 token；想要可交互的面板用 `/task-dash inline`，`Esc` 关闭。

### 界面语言

面板、状态行和提醒跟随操作系统语言（中文系统显示中文，其余英文）。判定顺序：插件设置 `language` → `LC_ALL` → macOS 系统首选语言 → `LC_MESSAGES` → `LANG` → 运行时 locale。系统语言优先于 `LANG`，因为终端常设 `en_US` 而系统是中文；`LC_ALL` 是显式覆盖，排在最前。

固定某种语言：`/config` 里把 task 插件的 `language` 设为 `zh` 或 `en`。任务池内容（标题、备注）按原文显示，不翻译。

### 指标口径

| 指标 | 算法 |
|---|---|
| 完成率 | 已归档 /（已归档 + 未关闭任务） |
| 交付率 | （已归档 + 待验证）/ 同上 |
| 一次通过 | 交付过的任务中，从未出现「打回重做」的比例（按任务计） |
| 7 日交付 | 近 7 天 run.log 中 `DONE→` 事件数 |
| 中位周期 | run.log 中 `DISPATCH` 到结果事件的中位时长 |
| 疑似中断 | 循环在跑或等待任务，但 3 小时无任何活动，或已超出时长预算 3 小时以上 |

## 文件

```text
.claude/
├── backlog.md        # P0–P3 任务表、待决策、人工阻塞、ID 规则（需求方入口）
├── dev-plan.md       # AI 维护的排期与进行中任务
├── dev-progress.md   # 已归档任务（### T-NNN）
├── inbox/            # qtask / 调度员投递，循环单点合并
└── auto/             # current / session / run.log / STOP（运行态，gitignore）
```

## 审查门禁与专业 agent

`/task:next` 与 worker 交付前会派 `code-reviewer`（涉及认证 / 用户输入 / 上传 / 加密时加 `security-analyst`）审查改动。环境里没有这些 agent 时，技能改派 `general-purpose` 子 agent 做同样的只读审查。项目 `CLAUDE.md` 有更严的门禁或测试口径时以项目为准。

## 从旧版迁移

用过本地 `~/.claude/skills/task-*` 或 `task-dash@claude-task-dash` 的：

```sh
claude plugin uninstall task-dash          # 旧面板插件（若装过）
rm -rf ~/.claude/skills/task-{init,add,next,loop,auto,status}
```

再把项目 / 全局 `CLAUDE.md` 里的 `/task-add` `/task-next` `/task-loop` `/task-status` 改成 `/task:add` 等。任务池文件格式不变，已有 `.claude/backlog.md` 直接可用。

## 开发

```sh
claude plugin validate plugins/task
claude plugin test plugins/task
claude --plugin-dir plugins/task     # 从源码加载
```

本仓库自身也用这套任务池管理，见 `.claude/`。

## License

MIT
