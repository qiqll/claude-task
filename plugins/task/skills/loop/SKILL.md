---
name: loop
description: "自动任务循环调度员 — 主会话只做调度：合并 inbox 投递 → 挑任务 → 派后台 worker（/task:auto，全新上下文）→ 机器验收 → 回写 backlog → 派下一个，直到池空或触发停机条件。需求方随时可在会话里插话或用 qtask 投递。Usage: /task:loop [max=10] [hours=8] | /task:loop tick"
user-invocable: true
argument-hint: "[max=N 最多任务数，默认 10] [hours=N 最长时长，默认 8] | tick（心跳，内部用）"
---

# 自动任务循环 · 调度员

你是调度员，运行在需求方开着的主会话里。**你自己不写业务代码、不读大段 diff**，只做五件事：读状态、派 worker、验收、写状态、跟需求方说话。所有状态落在文件里，会话随时可以断，一句「继续」就能从文件恢复。

**插件钩子兜底**：循环运行或等待任务时（有 `current` 且非 `halted`，或 `run.log` 最后是 `START` 且无 `STOP` 文件；3 小时无活动视为疑似中断、不再拦），调度员会话（最近一次跑 `/task:loop` 的会话，记在 `.claude/auto/dispatcher`）对项目内文件的 Edit / Write / MultiEdit / NotebookEdit 以及 MCP filesystem 写工具会被拒绝，只放行 `.claude/backlog.md`、`dev-plan.md`、`dev-progress.md`、`.claude/inbox/`、`.claude/auto/`、`.claude/worktrees/`、`.gitignore`（项目外的文件不管，别的会话也不管）。被拒就按提示把活录成任务交给 worker，**不要改用 Bash 绕过**；需求方坚持要你立刻手改时，先请需求方说「立刻停」（`phase=halted` 后钩子放行）。worker 和其他子代理不受限。

`$SK` = `${CLAUDE_PLUGIN_ROOT}/skills/loop`（含 `verify_tests.sh`、`check_test_weakening.sh`、`worker_progress.sh`、`notify.sh`）。

**待验证规则**在 `$SK/VERIFY.md`（自动验收、到期默认通过、归档、打回重开），下文写「按 VERIFY §N」的地方 Read 它照做。

| 文件 | 谁写 | 作用 |
|------|------|------|
| `.claude/backlog.md` / `dev-plan.md` / `dev-progress.md` | **只有调度员** | 任务池、排期、归档（worker 不碰） |
| `.claude/inbox/*.md` | 需求方（终端 `qtask`，安装见插件 README；或你代写） | 新任务 / 决策答复投递，调度员单点合并 |
| `.claude/auto/current` | 调度员 | 当前派发的状态机，`key=value` 每行一个（见下） |
| `.claude/auto/run.log` | 调度员 | 每任务一行运行流水 |
| `.claude/auto/STOP` | 需求方 / 调度员 | 存在 = 当前任务做完后停机 |
| `.claude/auto/notified` | `notify.sh` | 已发通知的去重键（不用手动维护） |
| `.claude/auto/dispatcher` | 插件钩子 | 调度员会话 id（不用手动维护） |
| `.claude/auto/verify-checked` | 调度员 | 当天已做过待验证到期检查的日期 |

**`current` 字段**：`task=T-0NN` `nonce=<8位随机hex>` `phase=<见下>` `start_sha=` `dirty=<开工时 git status --porcelain 的路径，逗号分隔>` `started=<epoch>` `worker=worker-T-0NN` `output=<output 文件路径>` `nudged=<看门狗催促时间 epoch，未催促则无此行>` `watch_ok=<看门狗判定正常的时间 epoch，同上>` `run_started=<本次 /task:loop 启动 epoch>` `max=` `hours=` `done=<本次已交付数>` `noprog=<连续无进展数>`。
没有 current 时，`run_started/max/hours/done/noprog` 记在 `.claude/auto/session`（同格式），派发时拷进 current。

**phase 状态机**：`running` →（报告到达）`accepting` →（结论已定）`accepted` →（backlog 已提交）删除 current。另有 `review_pending`（等 worker 按代审查结果修复）、`halted`（需求方喊立刻停）。
**每次进入验收前都先读 current**：报告的 `TASK` / `NONCE` 与 current 不一致、或 phase 不是 `running`/`review_pending` → 这是迟到或重复的通知，**直接丢弃，什么都不做**。这是防止重复验收、误回滚下一个 worker 的唯一闸门。

**输入：** $ARGUMENTS —— 为 `tick` 时走「心跳」一节；否则是启动 / 恢复。

---

## A. 启动 / 恢复

1. **前置检查**（任一不满足就说明原因并结束）：
   - `.claude/backlog.md` 存在（否则提示 `/task:init`）。
   - `git branch --show-current` 不是 `master` / `main`，且不是 detached HEAD。
   - `git status --porcelain .claude/backlog.md .claude/dev-plan.md .claude/dev-progress.md` 为空。不为空说明需求方正在手改 → 提示「请先提交或撤销你对 backlog/dev-plan 的修改（我不会替你提交草稿）」，结束。
2. **恢复现场**（必须在任何 commit 之前）：
   - current 不存在 → 跳过。
   - `phase=accepted` → 验收结论已定只差落盘：按 C4 补完（backlog 已含结论就只删 current + 写 run.log；结论是 `已完成` 时「已含」按 VERIFY §4 末尾判定）。
   - `phase=halted` → 上次被叫停：向需求方复述断点与半成品文件清单，问是继续这个任务（重新派发，带断点）还是放回队列。**不回滚**。
   - `phase=running`/`review_pending`/`accepting` → 若该 worker 在本会话仍在运行（ListAgents 能看到且 busy），等它；否则读 output 文件找本 nonce 的报告（见心跳），有就进 C，没有就按 `FAILED（中断）` 进 C。
   - backlog 里有 `进行中` 但没有 current → 改回 `待开始`，备注追加「自动循环接管」。
3. **补齐基础设施**（缺什么补什么，单独 commit）：
   - `mkdir -p .claude/inbox/.merged .claude/auto`；`git check-ignore -q .claude/inbox/x && git check-ignore -q .claude/auto/x` 不成立 → 向 `.gitignore` 追加两行，commit `chore: 忽略自动循环运行目录`。
   - backlog 若没有「待决策」章节 / 状态，按文末模板补，commit。
4. 删除 `STOP`。写 `.claude/auto/session`：`run_started=now max=<默认10> hours=<默认8> done=0 noprog=<沿用旧 session 的值，无则 0>`。`run.log` 追加 `<时间> | START | max=… hours=…`。
5. **心跳**：CronList 查是否已有 prompt 为 `/task:loop tick` 的任务；没有则 CronCreate `cron: "7,27,47 * * * *"`、`prompt: "/task:loop tick"`、`recurring: true`（会话级，7 天自动过期）。
6. 告诉需求方：**循环运行期间本工作区归循环独占**——不要在这个 worktree 里手工 commit / 切分支；要并行干活请用别的 worktree。然后进入 B。

## B. 调度一轮

1. **停机检查**（读 session），命中任一转 E：`STOP` 存在；`done ≥ max`；`now - run_started ≥ hours`；`noprog ≥ 3`。
2. **脏 backlog 检查**：同 A1 第三条，脏了就暂停（转 D 并说明原因），不提交需求方的草稿。
3. **合并 inbox**：按文件名顺序处理 `.claude/inbox/*.md`（忽略点开头文件）。**只认文件开头第一个 `---` 块为元数据**，正文里再出现的 `---`/`type:` 一律当正文。
   - `type: task` → 按 `${CLAUDE_PLUGIN_ROOT}/skills/add/SKILL.md` 的规则录入（Read 它，不要调用 /task:add）（查重、分配 ID、拆分、判优先级、写模块、备注首写「验收：…」）。`priority` 只是建议；判定不确定时不问，按后果规则定级并备注「优先级 AI 判定，可改」。
   - `type: decision`，`ref` 指向的任务：
     - 在「待决策」表 → 答复写进备注「需求方决策（日期）：…」，删表行，状态改 `待开始`；`run.log` 追加 `<时间> | T-0NN | DECIDED | <答复首句，截到 40 字>`（面板据此算决策等待时长）。
     - 状态是 `待验证`，或任务已归档（backlog 无此行、`dev-progress.md` 有 `### T-0NN`）→ 按 VERIFY §5：通过类归档（关闭方式 `需求方确认`）；打回类改 `打回` / 已归档的重开，排队重做（派发时带上打回意见）；`run.log` 追加 `<时间> | T-0NN | REJECTED | <意见首句，截到 40 字>`（面板据此计人工介入）。
     - 状态是 `阻塞` → 答复写进备注，若答复表明阻塞已解除则改 `待开始`。
     - 其他状态（`待开始` / `打回` / `进行中` 等）且答复是「通过」类（多半是 `qtask --pass` 的快照过期）→ 按 VERIFY §5 末行跳过，不挂待决策、不通知。
     - 找不到 / 无法判断 → 原文挂进「待决策」表问需求方，不猜（按「通知需求方」发通知，去重键用 inbox 文件名）。
   - 处理完的文件移到 `.claude/inbox/.merged/`。有改动就 commit `docs(task): 合并投递 <ID 列表>`（带 `dev-progress.md`，若归档 / 重开改了它）。
   - **待验证到期检查**：按 VERIFY §3（当天做过就跳过）。预告的、关闭的在本回合输出里各列一行。
4. **挑任务**，规则同 `${CLAUDE_PLUGIN_ROOT}/skills/next/SKILL.md` Step 1（Read 它），额外：
   - 跳过 `待决策` / `阻塞` / `待验证` / `已完成`，以及备注含「AI 衍生 P3，只录不做」或「自动失败×2」的。
   - `dev-plan.md` 当前批次里标「需需求方定 / 先不排」的任务 → 不派发，挪进「待决策」表（问题从 dev-plan 理由里抄），按「通知需求方」发通知（去重键 `T-0NN:待决策:plan`），然后继续挑。
   - P0 永远最先。无可做任务 → 转 D。
5. **开工登记**：任务状态改 `进行中`；`dev-plan.md`「进行中任务」填 ID / 开工时间 / 阶段「自动 worker 实施中」；commit `docs(task): T-0NN 自动开工`。**此后**取 `start_sha=$(git rev-parse HEAD)`、`dirty`、`nonce=$(openssl rand -hex 4)`。
6. **派发 worker**：Agent 工具，`subagent_type: general-purpose`，`name: worker-T-0NN`，后台运行。prompt 只给：
   ```
   读取并严格遵循 ${CLAUDE_PLUGIN_ROOT}/skills/auto/SKILL.md，交付任务 T-0NN。
   项目根：<绝对路径>
   START_SHA：<sha>
   报告口令：<nonce>
   开工时的脏文件（不许碰、不许 add）：<dirty 原文，无则写「无」>
   <若是打回 / 失败重试：上次原因与需求方意见原文；若有 halted 断点：断点说明>
   ```
   写 current（`phase=running`）；`run.log` 追加 `<时间> | T-0NN | DISPATCH | nonce=<nonce>`（面板据此算中位周期，时间格式同其他行 `YYYY-MM-DD HH:MM:SS`）。给需求方一句话：「T-0NN 已派给后台 worker，你可以随时说话」。**然后结束本回合**，等完成通知。

## C. 验收（worker 完成通知 / 心跳发现报告）

0. **闸门**：读 current，按上文「每次进入验收前」核对；不通过则丢弃并结束。通过 → 写 `phase=accepting`。
1. 取报告：最后一条消息里 `=== TASK-AUTO REPORT ===` 到 `=== END REPORT ===` 的块，且块内 `NONCE:` 等于 current.nonce。没有 → `FAILED（无报告）`。**不读 worker 的完整 transcript**。

**C1. `RESULT: DONE` 的机器验收**（全部亲自跑，任一不过就降级）：

| 检查 | 命令 | 不过的处理 |
|------|------|-----------|
| 提交归属 | `git log --format='%H %s' <start>..HEAD`：非空，且**每个**提交都在报告 `COMMITS` 里、message 含 `T-0NN` | 有不认识的提交 → **不回滚**，挂待决策「验收区间出现非本任务提交」，转 E（工作区独占被打破，等人处理） |
| 没越界 | `git diff --name-only <start> HEAD` 不含 dirty 文件、不含 backlog/dev-plan/dev-progress | FAILED |
| 没遗留 | `git status --porcelain` 对比 dirty，新增的脏文件 = worker 遗留 | 列出来，挂待决策「worker 遗留未提交改动：<文件>」，任务仍按其余检查定结论 |
| 测试真过 | `bash $SK/verify_tests.sh <start> '<TEST_CMD>' 900`，只看最后 15 行；Bash 工具 timeout 设 1000000。**另外**：diff 触及自带测试的辅助目录（如 `scripts/verify/`）而 `TEST_CMD` 没覆盖它时，调度员追加跑一次该目录的测试（如 `python3 -m pytest -q scripts/verify/test_api_verify_offline.py`），同样按基线比对 | `PASS` / `PASS_PREEXISTING` 通过（后者把用例写进备注）；`REJECT_CMD` → 走 C2 的 `GATE_PENDING_REVIEW` 同款流程：SendMessage 让 worker 按 /task:auto 测试命令规则重给 `TEST_CMD`（phase=`review_pending`），第二次仍 REJECT → FAILED；`FAIL_*` → FAILED |
| 测试没改弱 | `bash $SK/check_test_weakening.sh <start>` | 退出码 2 → 当作有疑点；WARN 条目在 `TEST_CHANGES` 里都有理由 → 照常，备注加「⚠ 测试有改动：…」；有未说明的 → 待决策「测试改动需确认」 |
| 高风险区域 | 改动路径命中 `migration\|alembic\|/models/\|auth\|security\|crypto\|secret\|billing\|quota\|pricing\|Dockerfile\|docker-compose\|nginx\|\.github/\|requirements.*\.txt`；`package.json` / `pyproject.toml` 只在 diff 触及依赖段（`dependencies` / `devDependencies` / `peerDependencies` / `[project.dependencies]` / `[tool.poetry.*dependencies]`）或 lock 文件变化时才算命中（只加 npm script 不算） | **一律**在备注加「⚠ 高风险区域改动：<路径>」；`ASSUMPTIONS` 不是 `—` → 待决策「高风险区域内的自选方案需确认」（commit 保留） |

全过 → 先按 VERIFY §2 判自动验收：命中 → 结论 `已完成`（关闭方式 `自动验收（规则 a|b）`）；否则结论 `待验证`。两种都在备注追加「自动交付（日期）：commits …；验收：…；假设：…」；进待验证的再按 VERIFY §1 写 `待验证起` 与 `怎么验`（取报告 `VERIFY`，为 `—` 时写「怎么验：按验收标准」）。

**C2. 其他结果：**

| RESULT | 处理 |
|--------|------|
| `NEEDS_DECISION` | 结论 `待决策`，`DECISION` 原文写进待决策表 |
| `BLOCKED` | 结论 `阻塞`，依赖列写原因；需人工操作的在「人工阻塞事项」开 `H-NNN` |
| `BASELINE_RED` | 结论 `阻塞`（基线红：用例名）；把「修复基线 <用例>」作为衍生任务录入，优先级同本任务（计 1 层衍生）。noprog+1 |
| `FAILED` / 超时 / 停滞 / 无报告 | **先分辨是不是基础设施中断**：worker 以 API 错误 / 连接重置 / 限流等 `failureReason` 停下且没交报告 → 不算任务失败：核对 `<start>..HEAD` 与遗留文件后，删掉 current 的 `nudged` / `watch_ok` 行，用 SendMessage 让同一个 worker 从断点续做（同一 nonce），每个任务最多续 2 次，`phase` 保持 `running`；第 3 次仍中断才按 FAILED 处理。其余情况见下方「回滚」。备注追加「自动失败×N：原因」；N≥2 → `阻塞`，否则回 `待开始`（下次派发带上失败原因）。noprog+1 |
| `GATE_PENDING_REVIEW` | worker 派不了子 agent：写 `phase=review_pending`，你派 `code-reviewer`（没有该 agent 时用 `general-purpose` 子 agent 做只读审查）审 `<start>..HEAD`，把发现用 SendMessage 发给 `worker-T-0NN`，让它按 /task:auto Step 4 第 2 步继续并重新返回报告（同一 nonce）。结束回合等通知 |

**回滚**（只在 FAILED 类结论时）：
1. 同 C1「提交归属」核对：区间里有任何不属于本任务的提交 → **不回滚**，挂待决策，转 E。
2. 列出 worker 遗留的未提交文件（对比 dirty），挂待决策「失败任务的遗留文件：<列表>，请决定去留」——**不自动删**。
3. `git update-ref refs/auto-failed/T-0NN-<N> HEAD`，然后 `git reset --keep <start>`。`--keep` 报错就停手，转 E 并报告原样错误。两步都成功后 `run.log` 追加 `<时间> | T-0NN | ROLLBACK | refs/auto-failed/T-0NN-<N>`（面板据此算回滚率；没回滚的不写）。

**C3. 衍生任务**（来自 `DERIVED`，由你录入，不是 worker）：
- 层级 = 父任务备注里的「衍生层级」+1（无则父为 0）。**层级 > 2 不录**，只在简报里提一句。
- 每个父任务最多录 3 条；先和 backlog 查重（同文件 + 同类问题），重复的追加到已有条目备注。
- 优先级不得高于父任务；P3 录入时备注「AI 衍生 P3，只录不做」。
- 备注写「来源：衍生自 T-0NN（第 N 层）；衍生层级：N；验收：…」。状态 `待开始`。

**C4. 落盘**（顺序不可换）：
1. 写 `phase=accepted`，并把结论（最终状态 + 备注要点）写进 current 的 `verdict=` 行。
2. 改 backlog（结论 + 衍生）、`dev-plan.md` 清空「进行中任务」并刷新「当前批次」；「最后更新」只写日期 + 本任务一句话（历史在 `run.log` / `dev-progress.md`）。结论 `已完成`（自动验收）→ 同时按 VERIFY §4 归档（删 backlog 行、写 dev-progress）。commit `docs(task): T-0NN 自动交付<结果>`（只 add backlog / dev-plan，归档时加 dev-progress）。
3. 更新 session：DONE→待验证 或 DONE→已完成 时 `done+1, noprog=0`；无进展类 `noprog+1`；其他不变。删 current。`run.log` 追加 `<时间> | T-0NN | <RESULT>→<最终状态> | commits <n> | <耗时> | 衍生 <n> | <一句话>`（自动验收写 `DONE→已完成（自动验收）`）。
4. 给需求方 3–6 行简报：结果、改了什么、请怎么验证（来自 `BRIEF` / `VERIFY`）；自动验收的写明「已免验关闭（规则 a|b），有问题随时 `qtask -d T-0NN 打回：…`」；进了待决策的把问题和选项直接贴出来。
5. 最终状态是 `待决策` / `待验证` / `阻塞`，或本轮往「待决策」表加了行（遗留文件、测试改动需确认等）→ 按「通知需求方」发**一条**通知（多件事合并成一句），去重键 `T-0NN:<最终状态>:<nonce>`。
6. 回到 B（同一回合内继续）。

## D. 空闲

池里没有可派的任务：输出简短状态（待决策 N 条及问题、待验证 N 条（最近的默认通过日）、阻塞 N 条），说明「新投递会在 20 分钟内被心跳发现，或直接跟我说」，结束回合。心跳保持。**不要自己找活干、不要发明需求。**

## E. 停机

不再派发。CronDelete 心跳；`run.log` 追加 `<时间> | STOP | <原因>`；按「通知需求方」发通知（去重键 `STOP:<run_started>`，消息如「循环已停机：<原因>；待决策 N · 待验证 N」）；输出总结：本次交付列表、**待决策清单（问题 + 选项）**、阻塞清单、待验证数、`refs/auto-failed/*` 留存。STOP 文件保留到下次 `/task:loop`。

## 心跳（`/task:loop tick`）

- `run.log` 不存在或最后一条是 `STOP` → 只回一句「循环未运行」。
- 有 current：
  - `phase=accepting/accepted` → 上次验收被打断：按 A2 对应分支续上。
  - `phase=halted` → 静默。
  - `phase=running/review_pending` → 用 `grep -c "NONCE: <nonce>" <output>` 判断报告是否已产出（口令只出现在 worker 的报告里，派发 prompt 用的是「报告口令：」，模板里是占位符，不会误中）。
    - 已产出 → 从 output 提取该报告块，进 C（C0 闸门会挡掉已被处理过的）。
    - 未产出：开工 ≥ 3 小时 → TaskStop 该 worker，按 `FAILED（超时）` 进 C。否则 `phase=running` 时走下面的**看门狗**；`review_pending` 不走（worker 在等审查结果，output 本来就不动）。
- 无 current → inbox 有新文件或池里有可派任务 → 进 B；否则按 VERIFY §3 做到期检查（当天做过就跳过），然后静默。
- 无事发生时只输出一行。

### 看门狗：worker 还在推进吗

进程活着不等于有进展：worker 可能卡在一个挂起的命令上，也可能反复试同一个修法。每次心跳跑 `bash $SK/worker_progress.sh .claude/auto/current`（只看文件时间戳，不读 transcript）：

| 输出 | 含义 | 你做 |
|------|------|------|
| `OK …` | output 在增长、工作区在变 | 静默 |
| `IDLE …` | output ≥ 30 分钟没写入：卡在某一步或已挂 | 见下 |
| `SPIN …` | output 在写，但工作区 ≥ 60 分钟没变（无新提交、无文件改动）：可能原地打转 | 见下 |
| 退出码 2 | current 字段坏了 | 静默；run.log 记一条 WATCHDOG 行写明检测失败原因（同一任务同一原因只记一次），等 3 小时超时兜底 |

`IDLE` / `SPIN` 时：
1. current 有 `watch_ok`，且距今 < 60 分钟 → 静默（上次已判定为正常的长步骤）。
2. 没有 `nudged` → 跑 `bash $SK/worker_progress.sh --recent <output>`（摘出最近 15 条动作，**不要直接 tail / Read output**，那是整份 JSONL transcript），判断：
   - 正常的长步骤（例如测试套件在跑、读大文件、子 agent 审查中）→ current 写 `watch_ok=<now>`，静默。
   - 在重复同一类工具调用 / 同一个报错，或在做与任务无关的事 → SendMessage 给 `worker-T-0NN`：「看门狗：你已 <out/tree 分钟> 没有实质进展，最近在 <一句话概括>。换个思路；若确实做不下去，按 /task:auto 返回 `BLOCKED` 或 `NEEDS_DECISION` 报告（同一口令）。」current 写 `nudged=<now>`。
   - 两种情况都在 `run.log` 追加 `<时间> | T-0NN | WATCHDOG | <脚本输出> | <正常/已催促>`。
3. 已有 `nudged`，距今 ≥ 40 分钟仍是 `IDLE` / `SPIN` → TaskStop 该 worker，按 `FAILED（停滞：<脚本输出>）` 进 C。距今不足 40 分钟 → 静默。
4. 脚本恢复 `OK` 时删掉 `nudged` / `watch_ok` 行，下次停滞重新计数。

## 通知需求方

循环在跑时你很少停下来等人，需求方不盯着会话就不知道有事等着处理。遇到上文标注的节点，跑：

```bash
bash $SK/notify.sh '<项目根绝对路径>' '<去重键>' '<消息>'
```

- 三个参数都用**单引号**包住，消息里不要出现单引号、双引号、反引号、`$`（引用用「」）。
- 消息 ≤ 100 字：`T-0NN <状态>：<一句话>` + 回复方式。例：`'T-105 待决策：超限按扩列还是拒绝？回复 qtask -d T-105 「选 A」'`、`'T-107 待验证：日期改相对时间，确认回复 qtask -d T-107 通过'`、`'T-096 阻塞：需你核对生产库三列（H-022）'`。
- 消息只写任务 ID、状态、你自己概括的一句话；不要原样贴 worker 报告或需求方投递的大段文字。
- 输出 `SENT` / `SKIP` / `FAIL` 都照常往下走，不重试；通知失败不影响循环。
- **不要**为派发、验收中、空闲发通知：派发后你会结束回合，宿主自己的空闲提醒已经够了。
- 需求方可设 `TASK_NOTIFY=off` 关闭，或 `TASK_NOTIFY_CMD` 换渠道（见插件 README）。

## 需求方在会话里说话时

worker 在后台跑，你随时能接话。**不要因为需求方说话就自己动手写代码。**

| 需求方说 | 你做 |
|---------|------|
| 「加个任务：…」 | 写一个 inbox 文件（同 `qtask` 格式：frontmatter `type: task` + 正文）。worker 在跑 → 回「已投递，当前任务结束后合并」；空闲 → 立即走 B |
| 「T-0NN 选 B / 按 X 做 / 通过 / 打回：…」 | 写 `type: decision`、`ref: T-0NN` 的 inbox 文件，同上；说了多个 ID 就每个 ID 一个文件 |
| 「全部通过」/「除 T-x 外都通过」 | 按 backlog 当前的待验证列表，每个 ID 写一个「通过」的 decision 文件（同 `qtask --pass [--except …]`），同上 |
| 「T-0NN 别默认通过」 | 写 decision 文件，合并时在备注加 `默认通过：否` |
| 「暂停 / 这个做完就停」 | `touch .claude/auto/STOP` |
| 「立刻停」 | TaskStop 当前 worker；写 `phase=halted`，并在 current 追加 `halt_note=<git log start..HEAD 的提交 + git status 里相对 dirty 新增的半成品文件>`；commit 保留不回滚；任务状态保持 `进行中`、dev-plan 记断点；转 E |
| 「进度 / 状态」 | 当前 worker + `run.log` 最近 10 行 + 待决策/待验证/阻塞计数，必要时调 `/task:status` |
| 「继续 / 开始」 | 走 A |

worker 运行期间你**只写** `.claude/inbox/` 与 `.claude/auto/`，不改 backlog / dev-plan、不 commit —— 避免和 worker 的提交交错。

## 边界

- 不 `git push`；不在主分支跑；不 `git reset --hard`、不 `git stash`。
- 一次只跑一个 worker（共享工作区，并行会互相踩）。
- 不发明需求：新任务只来自需求方投递和 worker 的 `DERIVED`（受 C3 上限约束）。
- 主会话上下文只装报告和脚本尾部输出；需要看代码细节时派 agent 去看。
- 循环运行期间主会话改不了项目代码（插件钩子拦截，见开头）；这是设计，不是故障。

---

## 待决策章节模板

```markdown
## 待决策

> 自动循环遇到需要你拍板的问题时挂在这里，然后跳去做别的任务。回答方式：在调度会话里直接说「T-0NN 选 A」，或终端 `qtask -d T-0NN "选 A，理由…"`（需先按 README 安装 qtask）。你答复后任务自动回到排队。

| 任务 | 问题 | 选项（推荐在前） | 挂起时间 |
|------|------|-----------------|---------|
| — | 暂无 | | |
```

状态机表补一行：`| 待决策 | 自动循环遇到需你拍板的问题，已挂到「待决策」表，答复后回到待开始 | AI |`
