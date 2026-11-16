---
name: next
description: "消化待办池里的下一个任务 — 挑任务、实施、过退出门禁、提交、归档进度，然后停下来等需求方确认。Usage: /task:next [可选：指定任务 ID]"
user-invocable: true
argument-hint: "[T-0NN] 可选，指定任务 ID；留空则由 AI 按优先级自动挑选"
---

# 消化下一个任务

你要完整交付**一个**任务：从挑选到提交到归档。做完后**停下来**输出简报，等需求方发话，不要自动开始下一个。

> 这是手动单步模式。需求方要无人值守连续消化时用 `/task:loop`（调度员 + 后台 worker `/task:auto`），两者共用同一套 backlog / dev-plan。若 `.claude/auto/current` 存在，说明自动循环有 worker 在跑，先提示需求方，不要并行开工。

**输入：** $ARGUMENTS（留空 = 自动挑选）

**前置检查：** 若 `.claude/backlog.md` 或 `.claude/dev-plan.md` 不存在，提示需求方先跑 `/task:init`，然后结束。

---

## Step 1: 挑任务

1. 读 `.claude/backlog.md`（全文，它很短）和 `.claude/dev-plan.md`。
2. **若有任务处于「进行中」**：说明上次开工未收尾，读该任务的断点记录，继续做它，不要挑新的。除非需求方指定了别的 ID。
3. **若 $ARGUMENTS 指定了 ID**：做那个。若它状态为「阻塞」，先向需求方确认阻塞是否已解除，不要闷头做。
4. **否则自动挑选**：按 `dev-plan.md` 的「当前批次」顺位取第一个状态为「待开始」的（`待决策` 状态的跳过 —— 它们在等需求方答复，答复写在「待决策」表或备注里则先按答复改回 `待开始`）。若「当前批次」已过期（顺位任务都不在待办池了），按 `backlog.md` 优先级重新生成批次。
5. **待办池全空或全阻塞**：不要找活干，不要自己想需求。输出待办池状态 + 阻塞原因清单，提示需求方录入新需求，然后结束。

## Step 2: 开工登记

1. `backlog.md` 里该任务状态改为 `进行中`。
2. `dev-plan.md` 的「进行中任务」表填入：ID、任务、开工时间、当前阶段（`需求确认`）、下一步。
3. **判断是否需要澄清**。以下情况必须先问需求方，不要自行假设：
   - 任务描述没有可验证的完成标准
   - 有 2 种以上合理实现路径且代价差异显著
   - 需要改数据库 schema / 核心路由 / 认证逻辑
   - 会破坏对外 API 兼容性

   问清后再继续。这是需求方保留决策权的关键节点。

## Step 3: 实施

遵循项目 `CLAUDE.md` 的编码规范；项目若有开发指南（如 `.claude/dev-guide.md`）按其操作步骤执行。

1. **按需读取上下文**。项目里的大型 registry / sprint 文档（通常几十到上百 KB）禁止全文读 —— 用 Grep 定位相关章节再读。
2. **按需派发专业 Agent**：若环境里有对应的专业 agent 就派发（schema/迁移 → `database-performance-expert`；新模块 / 5+ 文件重构 → `software-architect`；新前端页面 → `elite-ui-ux-designer`），没有就自己按同样标准做；项目 `CLAUDE.md` 有调度规则的以项目为准。
3. **实施过程中每完成一个逻辑单元就 commit**，不要攒到最后。禁止 `git push`。
4. 每次推进后更新 `dev-plan.md` 的「当前阶段」，这样中断后能续上。
5. **遇到阻塞**（缺凭据、依赖未就绪、需人工操作）：
   - `backlog.md` 状态改 `阻塞`，依赖列写明卡在什么
   - 若需人工操作，在「人工阻塞事项」表新增 `H-NNN` 条目
   - `dev-plan.md` 清空「进行中任务」
   - 输出简报说明卡点，结束。不要绕过阻塞硬做。

## Step 4: 退出门禁（强制，不可省略）

按下列门禁执行（项目 `CLAUDE.md` 另有更严规定的，以项目为准）：

> **审查者**：下文 `code-reviewer` / `security-analyst` 指同名专业 agent。环境里没有时，改派 `general-purpose` 子 agent，提示它「只读审查 <范围> 的 diff，找正确性 / 安全问题，按 Critical/High/Medium/Low 分级，每条给文件:行、失败场景、修法，不改文件」。


1. 调 `code-reviewer` 审查本轮全部改动。
2. 修复 High / Critical；Medium 酌情；Low 标注跳过原因。
3. 若任务涉及认证授权 / 用户输入 / 文件上传 / 加密，追加 `security-analyst`。
4. 跑项目的回归测试（Python 项目 `pytest -x -q`，其他栈用项目 `CLAUDE.md` 指定的命令）。**测试失败必须处理** —— 若确认是既有失败（与本轮无关），用基线 worktree 验证（`bash ${CLAUDE_PLUGIN_ROOT}/skills/loop/verify_tests.sh <开工 SHA> '<测试命令>'` 会自动在开工版本的临时 worktree 里跑基线并比对；**不要用 `git stash`**，stash 栈跨 worktree 共享）后在简报里注明，不要笼统说"不相关"。
5. 修复项独立 commit，message 前缀 `fix: review 修复 —`。

## Step 5: 归档与交付

1. **`backlog.md`**：状态改 `待验证`（不是「已完成」—— 需求方确认后才算完成）。
2. **`dev-plan.md`**：清空「进行中任务」；刷新「当前批次」。
3. 项目若维护 sprint / 模块索引文档（如 `current-sprint.md`、`module-spec-registry.md`），只更新对应条目，不重写全文；没有则跳过。
4. 最后一次 commit 收尾（文档更新可与代码分开提交）。

**注意** `dev-progress.md` 此时**不写** —— 那是需求方确认后才归档的。

## Step 6: 简报并停止

输出格式：

```
## T-009 修复配额并发扣减 —— 待验证

**做了什么**：quota_service 的扣减改为 SELECT FOR UPDATE 行锁，
消除并发请求同时读到旧余额导致的超额。

**改了哪些文件**：
- backend/app/services/quota_service.py（核心修复）
- backend/tests/test_quota_concurrent.py（新增 6 项并发测试）

**门禁**：code-reviewer 发现 H×1（未处理死锁重试）已修，L×1（日志措辞）跳过
        pytest 全量 462 项全绿

**请你验证**：并发打 20 个请求到同一用户，确认余额不会变负数。

**待办池**：P0×0 P1×1 P2×4 P3×2 · 下一个建议做 T-002（补边界测试）
```

然后**停止**。不要开始下一个任务，不要 `git push`。

---

## 需求方确认后的收尾

需求方回复「T-009 没问题 / 通过 / 验证 OK」时：
1. 从 `backlog.md` 删除该行。
2. 按 `dev-progress.md` 的记录格式追加一条（倒序，加在最上方），更新顶部统计。
3. commit。

需求方回复「T-009 不对 / 打回」时：
1. `backlog.md` 状态改 `打回`，备注追加问题描述。
2. 更新 `dev-progress.md` 的打回次数统计。
3. 重新走 Step 3 —— **先定位为什么第一次做错了**，再改。不要直接改代码。

---

## 边界

- 一次只做一个任务，做完就停。
- 不自己发明需求。待办池空了就说空了。
- 不 `git push`。
- P0 可打断进行中的任务，但必须先把当前任务落到可提交的中间态并在 `dev-plan.md` 记录断点。
