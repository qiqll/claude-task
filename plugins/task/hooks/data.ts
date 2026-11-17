/**
 * Read-only snapshot of a Claude task pool (`.claude/backlog.md` and friends).
 *
 * Pure functions over file text: the hooks module reads the files and hands
 * them in, so everything here is testable without a filesystem. Nothing here
 * writes to the pool.
 */
import type {
  Counts,
  Current,
  Decision,
  HumanBlock,
  LogEvent,
  LoopStatus,
  Metrics,
  PoolFiles,
  Session,
  Snapshot,
  Task,
} from '../types'
import type { Transition } from './i18n'

export const STATUS_ORDER = ['进行中', '打回', '待决策', '阻塞', '待验证', '待开始', '已完成', '已取消'] as const

const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
const DAY_MS = 24 * 60 * 60 * 1000
/** No current/run.log activity for this long while the loop claims to run → the dispatcher likely died. */
export const STALE_MS = 3 * 60 * 60 * 1000

/**
 * Splits one markdown table row into trimmed cells; `|` inside backticks or escaped stays.
 * An unbalanced backtick would swallow the rest of the row, so the row is then split ignoring backticks.
 */
export function splitRow(line: string, honorCode = true): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let inCode = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '\\' && body[i + 1] === '|') {
      cell += '|'
      i++
    } else if (ch === '`' && honorCode) {
      inCode = !inCode
      cell += ch
    } else if (ch === '|' && !inCode) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  if (inCode) return splitRow(line, false)
  cells.push(cell.trim())
  return cells
}

/** `待验证✗验证失败` → `待验证`; `已关闭` → `已取消`; unknown text is kept as is. */
export function normalizeStatus(raw: string): string {
  const text = raw.replace(/`/g, '').trim()
  const known = STATUS_ORDER.find(s => text.startsWith(s))
  if (known) return known
  if (/关闭/.test(text)) return '已取消'
  return text
}

/** What separates a note's clauses (`来源：…；验收：… · 自动交付：…`). */
const NOTE_SEP = /\s*(?:[；;\n]| · )\s*/

/** A note split into its clauses, blanks and `—` dropped. */
export function noteClauses(note: string): string[] {
  return note
    .split(NOTE_SEP)
    .map(c => c.trim())
    .filter(c => c && c !== '—')
}

/** The acceptance a clause states (`验收：…`), or '' when it states none. */
export function clauseAcceptance(clause: string): string {
  return /验收[：:]\s*(.+)/.exec(clause)?.[1]?.trim() ?? ''
}

/** The task's acceptance: the first clause of its note that states one. */
function acceptanceOf(note: string): string {
  for (const c of noteClauses(note)) {
    const a = clauseAcceptance(c)
    if (a) return a
  }
  return ''
}

function derivedFromOf(note: string): string {
  return /衍生自\s*(T-\d+)/.exec(note)?.[1] ?? ''
}

export type Backlog = { tasks: Task[]; decisions: Decision[]; humanBlocks: HumanBlock[] }

export function parseBacklog(md: string): Backlog {
  const tasks: Task[] = []
  const decisions: Decision[] = []
  const humanBlocks: HumanBlock[] = []
  let section: 'task' | 'decision' | 'human' | 'other' = 'other'
  let priority = ''
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      const title = heading[1] ?? ''
      const p = /^(P[0-3])\b/.exec(title)
      if (p) {
        section = 'task'
        priority = p[1] ?? ''
      } else if (title.startsWith('待决策')) section = 'decision'
      else if (title.startsWith('人工阻塞')) section = 'human'
      else section = 'other'
      continue
    }
    if (!line.startsWith('|')) continue
    const cells = splitRow(line)
    const id = cells[0] ?? ''
    if (section === 'task' && /^T-\d+$/.test(id)) {
      const note = cells.slice(5).join(' | ')
      tasks.push({
        id,
        title: cells[1] ?? '',
        module: cells[2] ?? '',
        status: normalizeStatus(cells[3] ?? ''),
        statusLabel: (cells[3] ?? '').replace(/`/g, ''),
        priority,
        deps: cells[4] ?? '',
        note,
        acceptance: acceptanceOf(note),
        derivedFrom: derivedFromOf(note),
      })
    } else if (section === 'decision' && /^T-\d+/.test(id)) {
      decisions.push({ task: taskIdIn(id) ?? id, question: cells[1] ?? '', options: cells[2] ?? '', since: cells[3] ?? '' })
    } else if (section === 'human' && /^H-\d+$/.test(id)) {
      humanBlocks.push({ id, desc: cells[1] ?? '', blocks: cells[2] ?? '', status: cells[3] ?? '' })
    }
  }
  tasks.sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.id.localeCompare(b.id),
  )
  return { tasks, decisions, humanBlocks }
}

/** Keys whose value is free text: never split into several pairs, continuation lines appended. */
const TEXT_KEYS = new Set(['halt_note', 'verdict', 'dirty'])

/**
 * `key=value` per line; a line of several `k=v` tokens is split into pairs;
 * a line that is no `key=` continues the previous value (multi-line `halt_note`).
 */
export function parseKv(text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!text) return out
  let last: string | null = null
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const head = /^([\w.-]+)=(.*)$/.exec(trimmed)
    if (!head) {
      if (last !== null) out[last] = `${out[last]} ${trimmed}`.trim()
      continue
    }
    const key = head[1]!
    const tokens = trimmed.split(/\s+/)
    if (!TEXT_KEYS.has(key) && tokens.length > 1 && tokens.every(t => /^[\w.-]+=/.test(t))) {
      for (const t of tokens) {
        const i = t.indexOf('=')
        out[t.slice(0, i)] = t.slice(i + 1)
      }
      last = null
    } else {
      out[key] = (head[2] ?? '').trim()
      last = key
    }
  }
  return out
}

/** Epoch seconds or milliseconds → ms; anything else → null. */
export function epochMs(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const n = Number(value)
  return n < 1e12 ? n * 1000 : n
}

function num(value: string | undefined): number | null {
  if (value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function parseCurrent(text: string | undefined): Current | null {
  const kv = parseKv(text)
  if (!kv.task) return null
  return {
    task: kv.task,
    phase: kv.phase ?? '',
    worker: kv.worker ?? '',
    started: epochMs(kv.started),
    nonce: kv.nonce ?? '',
    startSha: kv.start_sha ?? '',
    haltNote: kv.halt_note ?? '',
  }
}

export function parseSession(current: string | undefined, session: string | undefined): Session | null {
  // While a task runs the loop counters live in `current`; between tasks in `session`.
  const kv = { ...parseKv(session), ...pickLoopKeys(parseKv(current)) }
  if (kv.run_started === undefined && kv.max === undefined) return null
  return {
    runStarted: epochMs(kv.run_started),
    max: num(kv.max),
    hours: num(kv.hours),
    done: num(kv.done) ?? 0,
    noprog: num(kv.noprog) ?? 0,
  }
}

function pickLoopKeys(kv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['run_started', 'max', 'hours', 'done', 'noprog']) {
    const value = kv[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

/** `YYYY-MM-DD HH:MM:SS` in local time → ms. */
export function localTime(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text)
  if (!m) return null
  const t = new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0)).getTime()
  return Number.isFinite(t) ? t : null
}

/** `<time> | <T-NNN|START|STOP|…> | <event> | <detail…>`; START/STOP lines have no event column. */
export function parseRunLog(text: string | undefined): LogEvent[] {
  const events: LogEvent[] = []
  if (!text) return events
  for (const raw of text.split('\n')) {
    const parts = raw.split(' | ').map(s => s.trim())
    if (parts.length < 2) continue
    const time = parts[0] ?? ''
    const at = localTime(time)
    if (at === null) continue
    const subject = parts[1] ?? ''
    const isTask = /^T-\d+$/.test(subject)
    events.push({
      time,
      at,
      subject,
      event: isTask ? (parts[2] ?? '') : subject,
      detail: (isTask ? parts.slice(3) : parts.slice(2)).join(' | ').slice(0, 240),
    })
  }
  return events
}

export type Archive = { count: number; dates: number[]; ids: string[] }

export function parseProgress(md: string | undefined): Archive {
  const ids: string[] = []
  const dates: number[] = []
  if (!md) return { count: 0, dates, ids }
  let inEntry = false
  for (const line of md.split('\n')) {
    const head = /^###\s+(T-\d+)\b/.exec(line)
    if (head) {
      ids.push(head[1]!)
      inEntry = true
      continue
    }
    if (line.startsWith('#')) inEntry = false
    const done = inEntry ? /完成[：:]\*{0,2}\s*(\d{4}-\d{2}-\d{2})/.exec(line) : null
    if (done) {
      dates.push(localTime(`${done[1]} 00:00`) ?? 0)
      inEntry = false
    }
  }
  return { count: ids.length, dates, ids }
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

/** `DONE→待验证`, `NEEDS_DECISION→待决策`…; not free text that happens to hold an arrow. */
const isOutcome = (e: LogEvent) => /^[A-Z_]+→/.test(e.event)
const isDelivered = (e: LogEvent) => /^DONE→/.test(e.event)

export function metricsOf(tasks: Task[], archive: Archive, events: LogEvent[], now: number): Metrics {
  const reopened = new Set(tasks.filter(t => t.status !== '已完成' && t.status !== '已取消').map(t => t.id))
  const archived = new Set(archive.ids.filter(id => !reopened.has(id)))
  for (const t of tasks) if (t.status === '已完成') archived.add(t.id)
  const open = reopened.size
  const completed = archived.size
  const verify = tasks.filter(t => t.status === '待验证').length
  const total = completed + open

  // First pass is per task: a task that ever came back (打回重做 delivery, or 打回 now) did not pass first time.
  const delivered = new Set<string>()
  const redone = new Set<string>()
  let delivered7d = 0
  const weekAgo = now - 7 * DAY_MS
  for (const e of events) {
    if (!/^T-\d+$/.test(e.subject) || !isDelivered(e)) continue
    delivered.add(e.subject)
    if (/打回/.test(e.event)) redone.add(e.subject)
    if (e.at >= weekAgo) delivered7d++
  }
  for (const t of tasks) if (t.status === '打回' && delivered.has(t.id)) redone.add(t.id)

  const cycles: number[] = []
  const dispatched = new Map<string, number>()
  for (const e of events) {
    if (e.event === 'DISPATCH') dispatched.set(e.subject, e.at)
    else if (isOutcome(e) && dispatched.has(e.subject)) {
      cycles.push(e.at - dispatched.get(e.subject)!)
      dispatched.delete(e.subject)
    }
  }

  return {
    completed,
    total,
    completionRate: total ? completed / total : null,
    deliveryRate: total ? (completed + verify) / total : null,
    delivered: delivered.size,
    firstPassRate: delivered.size ? (delivered.size - redone.size) / delivered.size : null,
    redo: redone.size,
    delivered7d,
    archived7d: archive.dates.filter(d => d >= weekAgo).length,
    medianCycleMs: median(cycles),
  }
}

export function countsOf(tasks: Task[], archive: Archive): Counts {
  const counts: Counts = { total: tasks.length, archived: new Set(archive.ids).size }
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
  return counts
}

export function loopStatusOf(
  initialized: boolean,
  current: Current | null,
  session: Session | null,
  events: LogEvent[],
  hasStopFile: boolean,
  now: number,
): LoopStatus {
  if (!initialized) return 'uninitialized'
  if (current?.phase === 'halted') return 'halted'
  const lastAt = Math.max(current?.started ?? 0, events.at(-1)?.at ?? 0)
  const quiet = lastAt > 0 && now - lastAt > STALE_MS
  const overBudget =
    session?.runStarted != null && session.hours != null && now - session.runStarted > session.hours * 3600_000 + STALE_MS
  if (current) return quiet || overBudget ? 'stale' : 'running'
  const last = [...events].reverse().find(e => e.subject === 'START' || e.subject === 'STOP')
  if (last?.subject === 'START' && !hasStopFile) return quiet || overBudget ? 'stale' : 'waiting'
  if (last?.subject === 'STOP' || hasStopFile) return 'stopped'
  return 'idle'
}

export function buildSnapshot(root: string | null, files: PoolFiles, now: number): Snapshot {
  const initialized = root !== null && files.backlog !== undefined
  const backlog = parseBacklog(files.backlog ?? '')
  const current = parseCurrent(files.current)
  const archive = parseProgress(files.progress)
  const events = parseRunLog(files.runLog)
  const session = parseSession(files.current, files.session)
  const tasks = backlog.tasks.map(t => ({ ...t, note: t.note.slice(0, 400) }))
  return {
    root,
    initialized,
    readAt: now,
    loop: loopStatusOf(initialized, current, session, events, files.hasStopFile, now),
    stopRequested: files.hasStopFile,
    current,
    currentTitle: current ? (tasks.find(t => t.id === current.task)?.title ?? '') : '',
    session,
    tasks,
    decisions: backlog.decisions,
    humanBlocks: backlog.humanBlocks,
    counts: countsOf(tasks, archive),
    metrics: metricsOf(tasks, archive, events, now),
    events: events.slice(-40),
    inbox: files.inbox,
  }
}

/** Status changes worth a toast between two snapshots: entering 待验证 / 待决策 / 阻塞. */
export function transitions(prev: Snapshot | null, next: Snapshot): Transition[] {
  if (!prev || !prev.initialized || prev.root !== next.root) return []
  // A duplicated id keeps its first row on both sides, so one stray row cannot toast on every edit.
  const firstRows = (tasks: Task[]) => [...new Map([...tasks].reverse().map(t => [t.id, t] as const)).values()]
  const before = new Map(firstRows(prev.tasks).map(t => [t.id, t.status]))
  const notes: Transition[] = []
  for (const t of firstRows(next.tasks)) {
    const was = before.get(t.id)
    if (was === t.status) continue
    // A task added straight into 待决策 / 阻塞 needs attention as much as one moving there.
    const watched = was === undefined ? t.status === '待决策' || t.status === '阻塞' : t.status === '待验证' || t.status === '待决策' || t.status === '阻塞'
    if (watched) notes.push({ id: t.id, kind: was === undefined ? 'new' : 'move', status: t.status, title: t.title })
  }
  return notes
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}h ${min % 60}m`
  return `${Math.floor(hour / 24)}d ${hour % 24}h`
}

export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** `worker-T-071` / `T-071 …` → `T-071`. */
export function taskIdIn(text: string): string | null {
  return /\bT-\d{3,}\b/.exec(text)?.[0] ?? null
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
/** Punctuation that never starts a line (it stays with the character before it). */
const NO_LINE_START = /^[，。、；：！？）」』》〉】,.;:!?)\]}%]/
/** Punctuation that never ends a line (it goes down with the character after it). */
const NO_LINE_END = /[（「『《〈【([{]$/

/** Cells a text takes in the terminal: CJK and fullwidth characters take two. */
export function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) n += WIDE.test(ch) ? 2 : 1
  return n
}

/**
 * Lines of at most `width` cells. Breaks between any two CJK characters as well
 * as at spaces, so a long Chinese run after a space fills the line it starts on
 * instead of moving down whole (what a space-only wrap does). Latin words and
 * numbers stay whole unless wider than a line; closing punctuation stays on the
 * line before, opening punctuation goes down with what it opens.
 */
export function wrapCells(text: string, width: number): string[] {
  if (width < 2) return [text]
  // Units that never split: one CJK character, one space, or a run of anything else.
  const units: string[] = []
  for (const ch of text) {
    const last = units.at(-1)
    if (ch !== ' ' && !WIDE.test(ch) && last !== undefined && last !== ' ' && !WIDE.test(last.at(-1)!)) units[units.length - 1] = last + ch
    else units.push(ch)
  }
  // Glue punctuation to its neighbour so no line starts with 。 or ends with （.
  const glued: string[] = []
  for (const u of units) {
    const last = glued.at(-1)
    if (last !== undefined && last !== ' ' && u !== ' ' && (NO_LINE_START.test(u) || NO_LINE_END.test(last))) glued[glued.length - 1] = last + u
    else glued.push(u)
  }
  const lines: string[] = []
  let line = ''
  let used = 0
  const flush = () => {
    lines.push(line.trimEnd())
    line = ''
    used = 0
  }
  for (const u of glued) {
    const w = cellWidth(u)
    if (u === ' ') {
      if (!line) continue
      if (used + 1 > width) flush()
      else {
        line += u
        used += 1
      }
      continue
    }
    if (used + w <= width) {
      line += u
      used += w
      continue
    }
    if (w <= width) {
      if (line.trim()) flush()
      line = u
      used = w
      continue
    }
    // Wider than a whole line (a long path or URL): cut it where the line ends.
    for (const ch of u) {
      const cw = cellWidth(ch)
      if (used + cw > width && line.trim()) flush()
      line += ch
      used += cw
    }
  }
  if (line.trim() || !lines.length) flush()
  return lines
}
