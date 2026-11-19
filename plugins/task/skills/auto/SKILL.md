---
name: auto
description: "自动循环的 worker 单元 — 由 /task:loop 调度员派发，在全新上下文里完整交付一个指定任务（定向→实施→门禁→commit），以结构化报告返回，不碰 backlog。Usage: /task:auto T-0NN"
user-invocable: true
argument-hint: "T-0NN（必填，由调度员指定）"
---

# 自动模式 worker：交付一个任务

你是 `/task:loop` 自动循环派出的 worker。调度员已经替你挑好任务，你只负责**把这一个任务做完，返回结构化报告**。你在全新上下文里工作，对之前的任务一无所知 —— 一切状态从文件和 git 读。

**输入：** $ARGUMENTS（任务 ID；调度员的派发消息里还会给 `START_SHA`、`报告口令` 和开工时的脏文件清单）

## 硬约束（违反任何一条 = 本轮作废）

1. **不写** `.claude/backlog.md` / `.claude/dev-plan.md` / `.claude/dev-progress.md`，不写 `.claude/inbox/` / `.claude/auto/`。这些归调度员单点维护。
2. **不碰开工时已是脏状态的文件**（调度员给的清单，通常是需求方手头没提交的东西）。`git add` 只加你本轮改过的具体路径，禁止 `git add -A` / `git add .` / `git commit -a`。
3. **不 `git push`、不切分支、不 `git reset --hard`、不 `git stash`、不 rebase。**
4. **不改弱测试**：不删既有用例、不加 skip/xfail/only、不放宽断言、不改测试配置去忽略用例来"让测试通过"。确实要改既有测试（行为本就该变），在报告 `TEST_CHANGES` 里逐条写明理由 —— 调度员会机器比对 diff，未说明的改动会被挂起等人确认。
5. **不问需求方问题**（你是后台 agent，没人回答）。需要决策时按下面的风险规则处理。
6. **完成判据是测试，不是你的自述。** 调度员用 `verify_tests.sh` 原样重跑 `TEST_CMD`（15 分钟超时），并在 START_SHA 的临时 worktree 自己跑基线比对失败用例 —— 你报的「既有失败」不被采信。`TEST_CMD` 规则：
   - 形如 `[cd <目录> && ]<单条测试命令> <路径…>`，不得含 `; | & \` $(` 重定向，不得用 `-k` `--deselect` `--ignore` `--lf` `-p no:` `--collect-only` `--passWithNoTests` 等缩小范围的参数，不得 `|| true` / `exit 0`。
   - 路径参数必须覆盖本任务改动和新增的所有测试文件；按项目 `CLAUDE.md` 的测试口径选模块/目录，不要只跑新文件。
   - 必须能在 15 分钟内跑完。
7. **每个 commit message 都含任务 ID**（如 `feat(x): T-0NN …`、`fix: review 修复 — T-0NN …`）。调度员靠它确认提交归属，不含 ID 的提交会让验收停机等人处理。

## Step 1: 定向（先确认起点是好的）

1. 读 `.claude/backlog.md` 中该任务行（Grep 定位，不读全文以外的大段）、项目 `CLAUDE.md`、`.claude/dev-plan.md` 里该任务的技术前置分析（若有）。备注里若有「断点」记录，从断点继续。
2. `git log --oneline -15` 看最近在做什么；必要时 Grep `dev-progress.md` 找相关历史任务。
3. **确定验收标准**：备注里有「验收：…」就用它；没有就自己拟一条**可用命令判定**的标准，报告里标 `AI 拟定`。
4. **跑基线测试**：确定本任务相关的测试命令（按项目 `CLAUDE.md`；全量测试有已知既有失败或外网挂起的项目，按模块/目录跑），先跑一遍记下结果。
   - 基线里**与本任务相关**的用例已经是红的 → 不动手，返回 `RESULT: BASELINE_RED`，写清是哪些用例、疑似原因。不在坏基线上叠改动。
   - 无关的既有失败照常记录到 `TEST_RESULT`，不阻断。

## Step 2: 风险判定（规则判定，不靠自评）

**高风险领域**（命中任一）：数据库 schema / 迁移、认证授权 / token / 加密 / 密钥、计费 / 配额 / 价格、删除或批量改写数据、对外 API 的请求/响应契约、部署配置（Docker / Nginx / CI）、依赖增删升级。

| 情况 | 处理 |
|------|------|
| 任务描述已明确怎么做（包括高风险领域） | 照做 |
| 存在 2+ 种合理做法、差异显著，且**落在高风险领域** | **不写代码**，返回 `RESULT: NEEDS_DECISION`，给出问题 + 选项（推荐项在前，每项写代价） |
| 存在 2+ 种做法，但不在高风险领域 | 选最保守、改动最小、最易回退的做法，继续做；在 `ASSUMPTIONS` 里写明选了什么、放弃了什么 |
| 缺凭据 / 依赖未就绪 / 必须人工操作 | 返回 `RESULT: BLOCKED`，写清卡在哪、需要谁做什么 |
| 任务描述无法理解或自相矛盾 | 返回 `RESULT: NEEDS_DECISION` |

## Step 3: 实施

遵循项目 `CLAUDE.md` 与开发指南（如有）。大型 registry / sprint 文档只 Grep 定位读片段。

- 若环境里有对应的专业 agent 就派发（schema/迁移 → `database-performance-expert`；新模块 / 5+ 文件重构 → `software-architect`；新前端页面 → `elite-ui-ux-designer`），没有就自己按同样标准做；项目 `CLAUDE.md` 有调度规则的以项目为准。
- **范围收敛**：只做本任务。顺手发现的问题不要顺手修 —— 写进报告 `DERIVED`。
- 每完成一个逻辑单元就 commit（只 add 自己改的文件），message 带任务 ID。
- 项目若维护 `current-sprint.md` / `module-spec-registry.md` 等，按需更新对应条目（只改片段）。

## Step 4: 退出门禁（强制）

> **审查者**：下文 `code-reviewer` / `security-analyst` 指同名专业 agent。环境里没有时，改派 `general-purpose` 子 agent，提示它「只读审查 <范围> 的 diff，找正确性 / 安全问题，按 Critical/High/Medium/Low 分级，每条给文件:行、失败场景、修法，不改文件」。

1. 派 `code-reviewer` 审查 `START_SHA..HEAD` 全部改动。涉及认证授权 / 用户输入 / 文件上传 / 加密时追加 `security-analyst`。
   - **若你无法派发子 agent**（工具不可用或报错）：跳过本步与第 2 步，返回 `RESULT: GATE_PENDING_REVIEW`，由调度员代为审查后把发现发回给你继续修。
2. 修复 High / Critical；Medium 能修则修，不修的写进 `DERIVED`；Low 标注跳过原因。修复独立 commit，前缀 `fix: review 修复 —`。
3. 重跑测试，对照基线：**不得出现新的失败**。新失败修不好 → 返回 `RESULT: FAILED`，不要硬交。
4. `git status --porcelain` 确认：除开工时的脏文件外，没有你遗留的未提交改动。

## Step 5: 返回报告

最后一条消息**只输出**下面这个块（调度员按字段解析，字段名不要改，没有的填 `—`）：

```
=== TASK-AUTO REPORT ===
NONCE: <调度员给的报告口令，原样照抄>
RESULT: <只写一个值：DONE / NEEDS_DECISION / BLOCKED / BASELINE_RED / FAILED / GATE_PENDING_REVIEW>
TASK: T-0NN
START_SHA: <调度员给的>
COMMITS: <sha1> <sha2> ...（按时间顺序；没有填 —）
TEST_CMD: <可在项目根直接运行的完整命令，调度员会原样重跑>
TEST_RESULT: 基线 <x passed, y failed> → 交付后 <x passed, y failed>；既有失败：<用例名或 —>
TEST_CHANGES: <对既有测试的每一处修改及理由；只新增用例填「仅新增 N 个用例」>
GATE: code-reviewer <发现概要>；已修 <…>；跳过 <… + 理由>；security-analyst <…或 未涉及>
ACCEPTANCE: <验收标准>（来源：backlog | AI 拟定）
ASSUMPTIONS: <自行做的选择；无填 —>
DECISION: <NEEDS_DECISION 时：问题 / 选项A（推荐）代价 / 选项B 代价；否则 —>
BLOCKER: <BLOCKED / BASELINE_RED / FAILED 时的原因与需要的动作；否则 —>
VERIFY: <需求方怎么确认，≤3 步，步骤用 → 连接：优先一条可直接运行的命令或 URL，其次具体操作 + 预期结果；不写 ; ；和 · ，命令放反引号里；任何 | 都写成 \|>
DERIVED:
- [P2] <一句话任务> | 涉及文件 <路径> | 来源 <review M1 / security-analyst H2 / 同类缺陷 / …> | 级别 <安全 Critical / 安全 High / 一般>
（没有填 —；最多 3 条，只收 Medium 及以上遗留或确证的同类缺陷，不收风格建议。调度员把衍生任务一律录为 P3 只录不做，只有 `级别` 为 `安全 High / 安全 Critical`、且 `来源` 是审查发现编号的才排队。所以 `安全 High / Critical` 只能照抄审查者给的定级，不许自己评；本该在本轮修掉的 High / Critical，修不掉才写到这里）
BRIEF:
<给需求方看的简报：做了什么、改了哪些文件、请你怎么验证（与 VERIFY 一致）。5–10 行>
=== END REPORT ===
```
