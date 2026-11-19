import { describe, expect, test } from 'claude-code/testing'

import {
  buildSnapshot,
  cellWidth,
  dispatcherForbidden,
  duration,
  isOpenHumanBlock,
  loopStatusOf,
  parseBacklog,
  parseCurrent,
  parseKv,
  parseProgress,
  parseRunLog,
  parseSession,
  noteClauses,
  percent,
  resolvePath,
  runOutcome,
  normalizeStatus,
  splitRow,
  transitions,
  verifyExpiry,
  verifyTimeoutOf,
  wrapCells,
} from './data'
import { BACKLOG, CURRENT, PROGRESS, RUN_LOG } from './fixtures'

const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime()

describe('parsing', () => {
  test('splitRow keeps pipes inside backticks and escapes', () => {
    expect(splitRow('| a | `x|y` | b\\|c |')).toEqual(['a', '`x|y`', 'b|c'])
  })

  test('splitRow with an unbalanced backtick still splits the row', () => {
    expect(splitRow('| T-1 | 改 `foo 的说明 | 模块 | 待开始 |')).toEqual(['T-1', '改 `foo 的说明', '模块', '待开始'])
  })

  test('human block status is the last cell, so a row with an extra date column still closes', () => {
    const md = [
      '## 人工阻塞事项',
      '| 编号 | 描述 | 阻塞的任务 | 状态 |',
      '|------|------|-----------|------|',
      '| H-005 | 磁盘空间不足 | T-087 | 2026-11-03 | 已完成（需求方 2026-11-18 确认） |',
      '| H-006 | 采集现场 | T-107 | 2026-11-04 | 已关闭（需求方放开） |',
      '| H-004 | 自刷是否结算 | T-014 | 已决策 |',
      '| H-008 | 真实账号走通 | T-188 | 待处理 |',
      '| H-009 | 行尾多一格 | T-1 | 已完成 | |',
      '| H-010 | 日期在状态后 | T-2 | 已关闭 | 2026-11-03 |',
      '| H-011 | 说明里提到已完成 | T-3 | 待处理（采购已完成，待安装） |',
    ].join('\n')
    const blocks = parseBacklog(md).humanBlocks
    expect(blocks.map(b => b.status)).toEqual([
      '已完成（需求方 2026-11-18 确认）', '已关闭（需求方放开）', '已决策', '待处理', '已完成', '已关闭', '待处理（采购已完成，待安装）',
    ])
    expect(blocks.filter(isOpenHumanBlock).map(b => b.id)).toEqual(['H-008', 'H-011'])
  })

  test('backlog tasks by priority section, decisions and human blocks', () => {
    const b = parseBacklog(BACKLOG)
    expect(b.tasks.map(t => t.id)).toEqual(['T-071', 'T-105', 'T-107', 'T-110', 'T-111'])
    expect(b.tasks[0]).toMatchObject({ priority: 'P1', status: '进行中', module: '后端/池', acceptance: 'pytest tests/test_pool.py 通过' })
    expect(b.tasks[1]?.note).toBe('用 `a|b` 拆分')
    expect(b.tasks[2]).toMatchObject({ priority: 'P2', derivedFrom: 'T-104', deps: 'T-071', acceptance: '用例不依赖当天' })
    expect(b.decisions).toEqual([{ task: 'T-105', question: '超限怎么处理？', options: 'A. 扩列（推荐）；B. 拒绝', since: '2026-11-03' }])
    expect(b.humanBlocks).toEqual([{ id: 'H-022', desc: '生产库核对三列', blocks: 'T-096', status: '待处理' }])
  })

  test('a note splits into clauses on ；, ; and · , and its first 验收 clause is the acceptance', () => {
    expect(noteClauses('来源：需求方；验收：pytest x · 自动交付：commits abc; 假设：— ；—')).toEqual(['来源：需求方', '验收：pytest x', '自动交付：commits abc', '假设：—'])
    expect(noteClauses('—')).toEqual([])
    const md = '## P1 — 重要\n\n| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |\n|--|--|--|--|--|--|\n| T-1 | a | m | 待验证 | — | 验收：pytest x · 自动交付：commits abc；验收：31 项全绿 |\n'
    expect(parseBacklog(md).tasks[0]?.acceptance).toBe('pytest x')
  })

  test('status suffixes normalize to the base status', () => {
    expect(normalizeStatus('待验证✗验证失败')).toBe('待验证')
    expect(normalizeStatus('`待验证◐部分已验`')).toBe('待验证')
    expect(normalizeStatus('已关闭')).toBe('已取消')
    expect(normalizeStatus('自定义')).toBe('自定义')
  })

  test('multi-line halt_note continues; free-text keys are not split', () => {
    expect(parseKv('task=T-1\nhalt_note=abc x=y\n  M src/a.py\nphase=halted')).toEqual({ task: 'T-1', halt_note: 'abc x=y M src/a.py', phase: 'halted' })
  })

  test('decision rows naming several tasks keep the first id', () => {
    const md = '## 待决策\n\n| 任务 | 问题 | 选项 | 时间 |\n|--|--|--|--|\n| T-105/T-106 | 问 | A | 2026-11-03 |\n'
    expect(parseBacklog(md).decisions[0]?.task).toBe('T-105')
  })

  test('kv files, one pair per line or several on one line', () => {
    expect(parseKv('a=1\nb=x y')).toEqual({ a: '1', b: 'x y' })
    expect(parseKv('run_started=1 max=10 hours=8')).toEqual({ run_started: '1', max: '10', hours: '8' })
    const cur = parseCurrent(CURRENT)
    expect(cur).toMatchObject({ task: 'T-071', phase: 'running', worker: 'worker-T-071', started: new Date(2026, 10, 15, 11, 33, 0).getTime() })
    expect(parseCurrent('')).toBeNull()
    expect(parseSession(CURRENT, undefined)).toEqual({ runStarted: new Date(2026, 10, 15, 10, 0, 0).getTime(), max: 10, hours: 8, done: 2, noprog: 0 })
    expect(parseSession(undefined, undefined)).toBeNull()
  })

  test('run.log task lines and START/STOP lines', () => {
    const events = parseRunLog(RUN_LOG)
    expect(events).toHaveLength(8)
    expect(events[0]).toMatchObject({ subject: 'START', event: 'START', detail: 'max=10 hours=8' })
    expect(events[2]).toMatchObject({ subject: 'T-068', event: 'DONE→待验证', detail: 'commits 5 | ~30m | 衍生 2 | 统计页' })
  })

  test('dev-progress counts real entries, not the template', () => {
    const a = parseProgress(PROGRESS)
    expect(a.ids).toEqual(['T-068', 'T-032'])
    expect(a.dates).toHaveLength(2)
  })
})

describe('snapshot', () => {
  test('metrics and counts', () => {
    const snap = buildSnapshot('/proj', { backlog: BACKLOG, progress: PROGRESS, current: CURRENT, runLog: RUN_LOG, hasStopFile: false, inbox: 1 }, NOW)
    expect(snap.loop).toBe('running')
    expect(snap.currentTitle).toBe('人工放行池管理')
    expect(snap.counts).toMatchObject({ total: 5, archived: 2, 进行中: 1, 待验证: 1, 待决策: 1 })
    // 2 archived; open = 4 (cancelled excluded)
    expect(snap.metrics.completed).toBe(2)
    expect(snap.metrics.total).toBe(6)
    expect(snap.metrics.delivered).toBe(2)
    expect(snap.metrics.firstPassRate).toBe(0.5)
    expect(snap.metrics.delivered7d).toBe(2)
    // cycles: 30m, 10m, 50m → median 30m
    expect(snap.metrics.medianCycleMs).toBe(30 * 60 * 1000)
    expect(snap.metrics.archived7d).toBe(1)
    // 2 archived + 1 待验证 of 6
    expect(snap.metrics.deliveryRate).toBe(0.5)
  })

  test('median cycle ends a run on a FAILED with a bracketed reason too', () => {
    const cycle = (log: string) => buildSnapshot('/proj', { backlog: BACKLOG, runLog: log, hasStopFile: false, inbox: 0 }, NOW).metrics.medianCycleMs
    // T-071: 11:33 → FAILED（超时）→阻塞 at 14:33 (180m); cycles 10m, 30m, 50m, 180m → upper median 50m.
    expect(cycle(`${RUN_LOG}2026-11-15 14:33:00 | T-071 | FAILED（超时）→阻塞 | commits 2 | 3h | 衍生 0 | 超时\n`)).toBe(50 * 60 * 1000)
    // The first bracketed FAILED ends the run (10m); a later one with no DISPATCH before it adds nothing (not 170m).
    expect(
      cycle(
        '2026-11-15 10:00:00 | T-001 | DISPATCH | nonce=a\n2026-11-15 10:10:00 | T-001 | FAILED（停滞：IDLE）→待开始 | commits 0\n2026-11-15 13:00:00 | T-001 | FAILED（超时）→阻塞 | commits 0\n',
      ),
    ).toBe(10 * 60 * 1000)
  })

  test('loop status', () => {
    const T0 = new Date(2026, 10, 15, 11, 30, 0).getTime()
    const start = parseRunLog('2026-11-15 10:00:00 | START | max=1')
    const stopped = parseRunLog('2026-11-15 10:00:00 | START | max=1\n2026-11-15 11:00:00 | STOP | 池空')
    expect(loopStatusOf(false, null, null, [], false, T0)).toBe('uninitialized')
    expect(loopStatusOf(true, null, null, [], false, T0)).toBe('idle')
    expect(loopStatusOf(true, null, null, start, false, T0)).toBe('waiting')
    expect(loopStatusOf(true, null, null, start, true, T0)).toBe('stopped')
    expect(loopStatusOf(true, null, null, stopped, false, T0)).toBe('stopped')
    expect(loopStatusOf(true, parseCurrent('task=T-1\nphase=halted'), null, [], false, T0)).toBe('halted')
    // Dispatcher gone quiet for hours while claiming to run → stale.
    expect(loopStatusOf(true, null, null, start, false, T0 + 4 * 3600_000)).toBe('stale')
    const running = parseCurrent(`task=T-1\nphase=running\nstarted=${Math.floor(T0 / 1000)}`)
    expect(loopStatusOf(true, running, null, start, false, T0 + 60_000)).toBe('running')
    expect(loopStatusOf(true, running, null, start, false, T0 + 4 * 3600_000)).toBe('stale')
  })

  test('no pool', () => {
    const snap = buildSnapshot(null, { hasStopFile: false, inbox: 0 }, NOW)
    expect(snap.initialized).toBe(false)
    expect(snap.loop).toBe('uninitialized')
  })

  test('transitions only report entering verify / decision / blocked', () => {
    const files = { backlog: BACKLOG, hasStopFile: false, inbox: 0 }
    const before = buildSnapshot('/proj', files, NOW)
    const after = buildSnapshot('/proj', { ...files, backlog: BACKLOG.replace('| 进行中 |', '| 待验证 |').replace('| 待开始 |', '| 进行中 |') }, NOW)
    expect(transitions(null, after)).toEqual([])
    expect(transitions(before, after)).toEqual([{ id: 'T-071', kind: 'move', status: '待验证', title: '人工放行池管理' }])
    // A task recorded straight as 待决策 is announced; a new 待开始 one is not.
    const added = buildSnapshot('/proj', { ...files, backlog: BACKLOG.replace('| T-111 |', '| T-120 | 新问题 | 后端 | 待决策 | — | — |\n| T-121 | 普通 | 后端 | 待开始 | — | — |\n| T-111 |') }, NOW)
    expect(transitions(before, added)).toEqual([{ id: 'T-120', kind: 'new', status: '待决策', title: '新问题' }])
    // A duplicated row of a task does not toast again on an unrelated edit.
    const dup = BACKLOG.replace('| T-111 |', '| T-071 | 重复行 | 后端 | 阻塞 | — | — |\n| T-111 |')
    const d1 = buildSnapshot('/proj', { ...files, backlog: dup }, NOW)
    const d2 = buildSnapshot('/proj', { ...files, backlog: dup.replace('| 想法 |', '| 想法2 |') }, NOW)
    expect(transitions(d1, d2)).toEqual([])
  })

  test('human metrics from the fixture log: a decision and a rejection, nothing rolled back or answered yet', () => {
    const m = buildSnapshot('/proj', { backlog: BACKLOG, progress: PROGRESS, current: CURRENT, runLog: RUN_LOG, hasStopFile: false, inbox: 0 }, NOW).metrics
    // NEEDS_DECISION→待决策 (T-105) + the 打回 redelivery (T-107).
    expect(m.interventions).toBe(2)
    // T-105 is still in the 待决策 table: unanswered waits are not counted.
    expect(m.decisionWaitMs).toBeNull()
    expect(m.rollbacks).toBe(0)
    expect(m.rollbackRate).toBe(0)
  })

  test('human metrics: answered decisions, ROLLBACK lines as rollbacks, a rejection still in 打回; old rates unchanged', () => {
    const log = `${RUN_LOG}2026-11-15 12:00:00 | T-071 | FAILED（超时）→待开始 | commits 2 | 3h | 衍生 0 | 超时
2026-11-15 12:00:05 | T-071 | ROLLBACK | refs/auto-failed/T-071-1
2026-11-15 12:30:00 | T-105 | DECIDED | 选 A
2026-11-15 12:31:00 | T-105 | DISPATCH | nonce=ee
2026-11-15 12:51:00 | T-105 | BLOCKED→阻塞 | commits 0 | 20m | 衍生 0 | 缺凭据
2026-11-15 13:00:00 | T-111 | DISPATCH | nonce=ff
2026-11-15 13:10:00 | T-111 | NEEDS_DECISION→待决策 | commits 0 | 10m | 衍生 0 | 两方案
2026-11-15 15:10:00 | T-111 | DISPATCH | nonce=gg
2026-11-15 15:20:00 | T-111 | FAILED→待决策 | commits 1 | 10m | 衍生 0 | 区间有他人提交，未回滚
2026-11-15 15:21:00 | T-068 | WATCHDOG | IDLE | 已催促
`
    const backlog = BACKLOG.replace('| T-107 | 日期炸弹改相对时间 | 测试 | 待验证 |', '| T-107 | 日期炸弹改相对时间 | 测试 | 打回 |')
    const base = { backlog: BACKLOG, progress: PROGRESS, runLog: log, hasStopFile: false, inbox: 0 }
    const m = buildSnapshot('/proj', base, NOW).metrics
    // Ended runs: DONE, NEEDS_DECISION, DONE（打回重做）, FAILED（超时）, BLOCKED, NEEDS_DECISION, FAILED = 7;
    // only T-071's FAILED was reset (its ROLLBACK line), T-111's was left in place.
    expect(m.rollbacks).toBe(1)
    expect(m.rollbackRate).toBe(1 / 7)
    // 待决策 ×3 (FAILED→待决策 included) + 阻塞 ×1 + one 打回 redelivery (an old log: no REJECTED line).
    expect(m.interventions).toBe(5)
    // T-105: 10:41 → DECIDED 12:30 (109m); T-111: 13:10 → next DISPATCH 15:10 (120m); upper median of two.
    expect(m.decisionWaitMs).toBe(120 * 60 * 1000)
    // WATCHDOG / DECIDED / ROLLBACK lines and FAILED runs leave the existing rates as they were.
    const before = buildSnapshot('/proj', { ...base, runLog: RUN_LOG }, NOW).metrics
    expect(m.firstPassRate).toBe(before.firstPassRate)
    expect(m.deliveryRate).toBe(before.deliveryRate)
    expect(m.delivered).toBe(before.delivered)
    // An old log's task in 打回 after its redelivery adds one more.
    expect(buildSnapshot('/proj', { ...base, backlog }, NOW).metrics.interventions).toBe(6)
  })

  test('decision wait: DECIDED wins over the DISPATCH after it, each round counts, stray lines are ignored', () => {
    const wait = (log: string) => buildSnapshot('/proj', { backlog: BACKLOG, runLog: log, hasStopFile: false, inbox: 0 }, NOW).metrics.decisionWaitMs
    // Only T-105: DECIDED at 12:30 is the answer (109m), not the DISPATCH a minute later (110m).
    expect(wait(`${RUN_LOG}2026-11-15 12:30:00 | T-105 | DECIDED | 选 A\n2026-11-15 12:31:00 | T-105 | DISPATCH | nonce=ee\n`)).toBe(109 * 60 * 1000)
    // Without DECIDED the first DISPATCH after it is the answer; a second one adds nothing.
    expect(wait(`${RUN_LOG}2026-11-15 12:31:00 | T-105 | DISPATCH | nonce=ee\n2026-11-15 12:41:00 | T-105 | DISPATCH | nonce=ff\n`)).toBe(110 * 60 * 1000)
    // Two rounds of 待决策 → DECIDED on one task: 10m and 30m, both counted (upper median 30m; 10m alone would give 10m).
    const two = `2026-11-15 10:00:00 | T-200 | DISPATCH | nonce=a
2026-11-15 10:10:00 | T-200 | NEEDS_DECISION→待决策 | commits 0
2026-11-15 10:20:00 | T-200 | DECIDED | 选 A
2026-11-15 10:21:00 | T-200 | DISPATCH | nonce=b
2026-11-15 10:30:00 | T-200 | NEEDS_DECISION→待决策 | commits 0
2026-11-15 11:00:00 | T-200 | DECIDED | 选 B
`
    expect(wait(two)).toBe(30 * 60 * 1000)
    expect(wait(two.split('\n').slice(0, 3).join('\n'))).toBe(10 * 60 * 1000)
    // A DECIDED with no 待决策 before it, or for another task, is no wait.
    expect(wait('2026-11-15 10:00:00 | T-200 | DECIDED | 选 A\n2026-11-15 10:10:00 | T-200 | DONE→待验证 | commits 1\n')).toBeNull()
  })

  test('rejections: REJECTED lines count and stay counted after the redispatch; a 打回 never delivered does not', () => {
    const metric = (log: string, backlog = BACKLOG) => buildSnapshot('/proj', { backlog, runLog: log, hasStopFile: false, inbox: 0 }, NOW).metrics.interventions
    const log = `2026-11-15 10:00:00 | T-071 | DISPATCH | nonce=a
2026-11-15 10:10:00 | T-071 | DONE→待验证 | commits 1
2026-11-15 11:00:00 | T-071 | REJECTED | 日期不对
`
    const rejectedNow = BACKLOG.replace('| T-071 | 人工放行池管理 | 后端/池 | 进行中 |', '| T-071 | 人工放行池管理 | 后端/池 | 打回 |')
    // In 打回 now with a REJECTED line: counted once, not twice.
    expect(metric(log, rejectedNow)).toBe(1)
    // Redispatched (进行中 again) and redelivered: the rejection does not drop out.
    expect(metric(`${log}2026-11-15 11:05:00 | T-071 | DISPATCH | nonce=b\n2026-11-15 11:30:00 | T-071 | DONE→待验证 | commits 1\n`)).toBe(1)
    // Rejected twice: two.
    expect(metric(`${log}2026-11-15 11:30:00 | T-071 | DONE→待验证 | commits 1\n2026-11-15 12:00:00 | T-071 | REJECTED | 还不对\n`)).toBe(2)
    // A task in 打回 that run.log never delivered (rejected outside the loop) is not counted.
    expect(metric('2026-11-15 10:00:00 | T-105 | DISPATCH | nonce=a\n2026-11-15 10:10:00 | T-105 | DONE→待验证 | commits 1\n', rejectedNow)).toBe(0)
  })

  test('first pass: a REJECTED task stays rejected after the redispatch; a REJECTED never delivered does not count', () => {
    const first = (log: string, backlog = BACKLOG) => buildSnapshot('/proj', { backlog, runLog: log, hasStopFile: false, inbox: 0 }, NOW).metrics
    const log = `2026-11-15 10:00:00 | T-071 | DISPATCH | nonce=a
2026-11-15 10:10:00 | T-071 | DONE→待验证 | commits 1
2026-11-15 10:20:00 | T-105 | DISPATCH | nonce=b
2026-11-15 10:30:00 | T-105 | DONE→待验证 | commits 1
`
    expect(first(log)).toMatchObject({ delivered: 2, redo: 0, firstPassRate: 1 })
    const rejected = `${log}2026-11-15 11:00:00 | T-071 | REJECTED | 日期不对\n`
    expect(first(rejected)).toMatchObject({ delivered: 2, redo: 1, firstPassRate: 0.5 })
    // Redispatched (进行中 again, not 打回) and redelivered without 打回 in the line: still not a first pass.
    const redelivered = `${rejected}2026-11-15 11:05:00 | T-071 | DISPATCH | nonce=c\n2026-11-15 11:30:00 | T-071 | DONE→待验证 | commits 1\n`
    expect(first(redelivered)).toMatchObject({ delivered: 2, redo: 1, firstPassRate: 0.5 })
    // Rejected twice is still one task that came back; REJECTED plus 打回 now counts it once.
    const rejectedNow = BACKLOG.replace('| T-071 | 人工放行池管理 | 后端/池 | 进行中 |', '| T-071 | 人工放行池管理 | 后端/池 | 打回 |')
    expect(first(`${redelivered}2026-11-15 12:00:00 | T-071 | REJECTED | 还不对\n`, rejectedNow)).toMatchObject({ redo: 1, firstPassRate: 0.5 })
    // A REJECTED for a task run.log never delivered changes nothing.
    expect(first(`${log}2026-11-15 11:00:00 | T-200 | REJECTED | 不对\n`)).toMatchObject({ delivered: 2, redo: 0, firstPassRate: 1 })
  })

  test('closed with nobody looking (auto-accepted, timeout pass) is counted apart and left out of first pass', () => {
    const first = (log: string) => buildSnapshot('/proj', { backlog: BACKLOG, runLog: log, hasStopFile: false, inbox: 0 }, NOW).metrics
    const log = `2026-11-15 10:00:00 | T-071 | DISPATCH | nonce=a
2026-11-15 10:10:00 | T-071 | DONE→待验证 | commits 1
2026-11-15 10:20:00 | T-105 | DISPATCH | nonce=b
2026-11-15 10:30:00 | T-105 | DONE→已完成（自动验收） | commits 1
2026-11-15 10:40:00 | T-107 | DISPATCH | nonce=c
2026-11-15 10:50:00 | T-107 | DONE→待验证 | commits 1
2026-11-15 11:00:00 | T-107 | TIMEOUT_PASS | 7 天无人打回
`
    expect(first(log)).toMatchObject({ delivered: 3, autoClosed: 2, redo: 0, firstPassRate: 1 })
    // Closed, rejected, closed again by timeout: one task, counted once; rejected and still open: not counted.
    expect(first(`${log}2026-11-15 11:10:00 | T-107 | REJECTED | 不对\n2026-11-15 11:20:00 | T-107 | TIMEOUT_PASS | 7\n`).autoClosed).toBe(2)
    // Only T-071 was judged by a person; once it is rejected the rate says so, not 2/3.
    expect(first(`${log}2026-11-15 11:10:00 | T-071 | REJECTED | 不对\n`)).toMatchObject({ redo: 1, firstPassRate: 0 })
    // An auto-closed task rejected afterwards is judged after all: it came back.
    expect(first(`${log}2026-11-15 11:10:00 | T-105 | REJECTED | 不对\n`)).toMatchObject({ redo: 1, firstPassRate: 0.5, autoClosed: 1 })
    // Nothing judged by a person: no rate rather than 100%.
    expect(first('2026-11-15 10:30:00 | T-105 | DONE→已完成（自动验收） | commits 1\n').firstPassRate).toBeNull()
  })

  test('verify clauses: 怎么验 / 待验证起 / 超时预告, the last one written wins', () => {
    const md = '## P1 — 重要\n\n| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |\n|--|--|--|--|--|--|\n| T-1 | a | m | 待验证 | — | 验收：pytest x；待验证起：2026-11-01；怎么验：老步骤；打回：日期不对；待验证起：2026-11-10；怎么验：跑 `bun test a\\|b` 看 3 项通过；超时预告：2026-11-16 09:30 |\n'
    const t = parseBacklog(md).tasks[0]!
    expect(t).toMatchObject({ verifySince: '2026-11-10', howToVerify: '跑 `bun test a|b` 看 3 项通过', expiryNotice: '2026-11-16' })
    expect(parseBacklog(BACKLOG).tasks[2]).toMatchObject({ howToVerify: '', verifySince: '', expiryNotice: '' })
    // A later empty 怎么验 clears the earlier one.
    expect(parseBacklog(md.replace('；超时预告', '；怎么验：；超时预告')).tasks[0]?.howToVerify).toBe('')
  })

  test('the 待验证 timeout: 7 days unless backlog.md says otherwise, 0 is off; days left count local days', () => {
    expect(verifyTimeoutOf('')).toBe(7)
    expect(verifyTimeoutOf('**待验证超时：** 3 天（0 = 关闭）')).toBe(3)
    expect(verifyTimeoutOf('待验证超时: 0')).toBe(0)
    const now = new Date(2026, 10, 15, 23, 30).getTime()
    const t = (verifySince: string, expiryNotice = '', note = '') => ({ verifySince, expiryNotice, note })
    expect(verifyExpiry(t('2026-11-10'), 7, now)).toEqual({ due: '2026-11-17', left: 2, noticed: false, hold: false })
    expect(verifyExpiry(t('2026-11-09', '2026-11-15'), 7, now)).toEqual({ due: '2026-11-16', left: 1, noticed: true, hold: false })
    expect(verifyExpiry(t('2026-10-01'), 7, now)?.left).toBeLessThan(0)
    expect(verifyExpiry(t('2026-11-10'), 0, now)).toBeNull()
    expect(verifyExpiry(t(''), 7, now)).toBeNull()
    // Across a month end.
    expect(verifyExpiry(t('2026-10-28'), 7, now)?.due).toBe('2026-11-04')
    for (const note of ['默认通过：否', '⚠ 高风险区域改动：src/auth.py', '⚠ 测试有改动：删 1 例']) expect(verifyExpiry(t('2026-11-10', '', note), 7, now)?.hold).toBe(true)
  })

  test('human metrics with no run.log are empty and render as —', () => {
    const m = buildSnapshot('/proj', { backlog: BACKLOG, progress: PROGRESS, hasStopFile: false, inbox: 0 }, NOW).metrics
    expect(m).toMatchObject({ interventions: null, decisionWaitMs: null, rollbacks: 0, rollbackRate: null })
    expect(duration(m.decisionWaitMs)).toBe('—')
    expect(percent(m.rollbackRate)).toBe('—')
    // A log with dispatches but no ended run has nothing to count either.
    const started = buildSnapshot('/proj', { backlog: BACKLOG, runLog: '2026-11-15 10:00:00 | START | max=1\n2026-11-15 10:00:10 | T-071 | DISPATCH | nonce=a\n', hasStopFile: false, inbox: 0 }, NOW).metrics
    expect(started).toMatchObject({ interventions: null, decisionWaitMs: null, rollbacks: 0, rollbackRate: null })
  })

  test('runOutcome reads result and state, and only from task lines', () => {
    const [a, b, c, d] = parseRunLog(
      '2026-11-15 10:00:00 | T-1 | FAILED（停滞：IDLE）→阻塞 | commits 0\n2026-11-15 10:00:00 | T-2 | DONE→待验证（打回重做） | x\n2026-11-15 10:00:00 | T-3 | DISPATCH | nonce=a\n2026-11-15 10:00:00 | STOP | 池空 → 停',
    )
    expect(runOutcome(a!)).toEqual({ result: 'FAILED', state: '阻塞' })
    expect(runOutcome(b!)).toEqual({ result: 'DONE', state: '待验证（打回重做）' })
    expect(runOutcome(c!)).toBeNull()
    expect(runOutcome(d!)).toBeNull()
  })
})

describe('wrapping', () => {
  test('a Chinese run after a space fills the line it starts on instead of moving down whole', () => {
    // The case from the panel: a space-only wrap would put everything after "~46" on the next line.
    const text = '窄面板（如截图 ~46 列）下状态标签单行完整显示且不换行，任务行保持一行高'
    const lines = wrapCells(text, 30)
    for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(30)
    // Every line but the last is full, short only by a unit that would not fit (at most one CJK cell pair or a word).
    for (const line of lines.slice(0, -1)) expect(cellWidth(line)).toBeGreaterThanOrEqual(26)
    expect(lines.join(' ').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
  })

  test('latin words stay whole, punctuation keeps its side, and a word wider than a line is cut', () => {
    expect(wrapCells('pytest tests/test_pool.py 全绿', 12)).toEqual(['pytest tests', '/test_pool.p', 'y 全绿'])
    expect(wrapCells('Acceptance criteria are met', 12)).toEqual(['Acceptance', 'criteria are', 'met'])
    // 。 never starts a line; （ never ends one.
    for (const line of wrapCells('一二三四五。六七八九（十）', 10)) {
      expect(line.startsWith('。')).toBe(false)
      expect(line.endsWith('（')).toBe(false)
    }
    expect(wrapCells('短', 10)).toEqual(['短'])
    expect(wrapCells('a\tb\nc', 10)).toEqual(['a b c'])
    expect(wrapCells('', 10)).toEqual([''])
  })

  test('emoji and CJK beyond the BMP take two cells and break like CJK', () => {
    expect(cellWidth('𠮷')).toBe(2)
    expect(cellWidth('✅')).toBe(2)
    expect(cellWidth('😀')).toBe(2)
    expect(cellWidth('⚠')).toBe(1)
    expect(wrapCells('𠮷𠮷𠮷𠮷𠮷𠮷', 6)).toEqual(['𠮷𠮷𠮷', '𠮷𠮷𠮷'])
    for (const line of wrapCells('修复✅完成任务😀好', 11)) expect(cellWidth(line)).toBeLessThanOrEqual(11)
  })
})

describe('dispatcher guard', () => {
  test('resolvePath makes a path absolute and resolves dots', () => {
    expect(resolvePath('src/a.ts', '/proj/backend')).toBe('/proj/backend/src/a.ts')
    expect(resolvePath('/proj/./x//y/../z.ts', '/elsewhere')).toBe('/proj/x/z.ts')
    expect(resolvePath('../../..', '/a')).toBe('/')
  })

  test('the pool files, the run dirs and .gitignore stay writable; the rest of the project does not', () => {
    for (const ok of ['.claude/backlog.md', '.claude/dev-plan.md', '.claude/dev-progress.md', '.claude/inbox/1.md', '.claude/auto/current', '.gitignore']) {
      expect(dispatcherForbidden('/proj', `/proj/${ok}`, '/proj')).toBeNull()
    }
    expect(dispatcherForbidden('/proj', '/proj/src/app.py', '/proj')).toBe('src/app.py')
    expect(dispatcherForbidden('/proj/', 'app.py', '/proj/backend')).toBe('backend/app.py')
    // Lookalikes and escapes through .. are judged by where they land.
    expect(dispatcherForbidden('/proj', '/proj/.claude/backlog.md.bak', '/proj')).toBe('.claude/backlog.md.bak')
    expect(dispatcherForbidden('/proj', '/proj/.claude/settings.json', '/proj')).toBe('.claude/settings.json')
    expect(dispatcherForbidden('/proj', '/proj/.claude/auto/../../src/x.ts', '/proj')).toBe('src/x.ts')
    expect(dispatcherForbidden('/proj', '/proj/src/x/../../.claude/inbox/2.md', '/proj')).toBeNull()
    // A worktree nested under .claude/worktrees/ is another checkout.
    expect(dispatcherForbidden('/proj', '/proj/.claude/worktrees/fix/src/a.ts', '/proj')).toBeNull()
  })

  test('files outside the project are not the guard\'s business', () => {
    expect(dispatcherForbidden('/proj', '/home/u/.claude/memory/a.md', '/proj')).toBeNull()
    expect(dispatcherForbidden('/proj', '/project2/src/a.ts', '/proj')).toBeNull()
    expect(dispatcherForbidden('/proj', '/tmp/scratch.txt', '/proj')).toBeNull()
  })
})
