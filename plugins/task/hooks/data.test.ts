import { describe, expect, test } from 'claude-code/testing'

import {
  buildSnapshot,
  loopStatusOf,
  parseBacklog,
  parseCurrent,
  parseKv,
  parseProgress,
  parseRunLog,
  parseSession,
  noteClauses,
  normalizeStatus,
  splitRow,
  transitions,
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
})
