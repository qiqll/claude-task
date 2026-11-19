export type Task = {
  id: string
  title: string
  module: string
  /** Normalized: one of 待开始 / 进行中 / 待验证 / 阻塞 / 待决策 / 打回 / 已完成 / 已取消, or the raw text. */
  status: string
  /** As written in backlog.md (`待验证✗验证失败`). */
  statusLabel: string
  priority: string
  deps: string
  note: string
  acceptance: string
  derivedFrom: string
  /** `怎么验：…` — how to check a delivered task, ≤3 steps. */
  howToVerify: string
  /** `待验证起：YYYY-MM-DD` — the day it entered 待验证; '' when not recorded. */
  verifySince: string
  /** `超时预告：YYYY-MM-DD` — the day the dispatcher warned it would pass by default; '' when not warned. */
  expiryNotice: string
}

export type Decision = { task: string; question: string; options: string; since: string }

export type HumanBlock = { id: string; desc: string; blocks: string; status: string }

export type LogEvent = { time: string; at: number; subject: string; event: string; detail: string }

export type Current = {
  task: string
  phase: string
  worker: string
  started: number | null
  nonce: string
  startSha: string
  haltNote: string
}

export type Session = {
  runStarted: number | null
  max: number | null
  hours: number | null
  done: number
  noprog: number
}

export type LoopStatus = 'uninitialized' | 'idle' | 'waiting' | 'running' | 'halted' | 'stopped' | 'stale'

export type Counts = { total: number; archived: number; [status: string]: number }

export type Metrics = {
  completed: number
  total: number
  completionRate: number | null
  /** (archived + 待验证) / total */
  deliveryRate: number | null
  delivered: number
  firstPassRate: number | null
  redo: number
  delivered7d: number
  archived7d: number
  /** Tasks closed with nobody looking: `DONE→已完成（自动验收）` ends plus `TIMEOUT_PASS` lines. Left out of first pass. */
  autoClosed: number
  medianCycleMs: number | null
  /** Runs ended in 待决策 / 阻塞 plus rejections (`REJECTED` lines); null with nothing in run.log to count. */
  interventions: number | null
  /** Median 待决策 → answer (next `DECIDED`, else next `DISPATCH` incl. queueing) over answered decisions. */
  decisionWaitMs: number | null
  /** `ROLLBACK` lines: FAILED runs actually reset to their start (kept in `refs/auto-failed/*`). */
  rollbacks: number
  /** rollbacks / ended runs */
  rollbackRate: number | null
}

/** The raw text of the pool's files; `undefined` where a file is missing. */
export type PoolFiles = {
  backlog?: string
  progress?: string
  current?: string
  session?: string
  runLog?: string
  hasStopFile: boolean
  inbox: number
}

export type Snapshot = {
  root: string | null
  initialized: boolean
  readAt: number
  loop: LoopStatus
  stopRequested: boolean
  current: Current | null
  currentTitle: string
  session: Session | null
  tasks: Task[]
  decisions: Decision[]
  humanBlocks: HumanBlock[]
  counts: Counts
  metrics: Metrics
  events: LogEvent[]
  inbox: number
  /** `待验证超时：N 天` in backlog.md, 7 when absent; 0 turns default pass off. */
  verifyTimeoutDays: number
}

export type AgentRow = {
  id: string
  label: string
  type: string
  task: string | null
  status: 'running' | 'done'
  startedAt: number
  endedAt: number | null
  summary: string
}

declare module 'claude-code' {
  interface PluginState {
    task: {
      snapshot: Snapshot | null
      filter: string
      openTask: string | null
      agents: AgentRow[]
      /** This session's main turn under way (its id and start); null while it waits for the user. */
      busy: { turnId: string; since: number } | null
      statusHidden: boolean
      now: number
      error: string | null
      lang: 'zh' | 'en' | null
    }
  }
}
