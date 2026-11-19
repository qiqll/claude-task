import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { AgentRow, PoolFiles, Snapshot, Task } from '../types'
import {
  buildSnapshot,
  cellWidth,
  clauseAcceptance,
  dispatcherForbidden,
  duration,
  isOpenHumanBlock,
  loopStatusOf,
  noteClauses,
  VERIFY_CLAUSE,
  verifyOrder,
  verifyExpiry,
  parseCurrent,
  parseRunLog,
  parseSession,
  percent,
  taskIdIn,
  transitions,
  wrapCells,
} from './data'
import { firstAppleLanguage, pickLang, STRINGS, statusLabel } from './i18n'
import type { Lang, Strings } from './i18n'

const PANE = 'task-dash'
const REFRESH_MS = 5000
const READ_TIMEOUT_MS = 4000
const ROOT_CACHE_MS = 30_000
const MAX_AGENTS = 20
/** Below this the terminal cannot dock a pane beside the transcript. */
const DOCK_MIN_COLUMNS = 110
const SYSTEM_LANG_TIMEOUT_MS = 1500

const snapshot = atom({ plugin: 'task', key: 'snapshot' } as const, null)
const filter = atom({ plugin: 'task', key: 'filter' } as const, 'active')
const openTask = atom({ plugin: 'task', key: 'openTask' } as const, null)
const agents = atom({ plugin: 'task', key: 'agents' } as const, [])
const statusHidden = atom({ plugin: 'task', key: 'statusHidden' } as const, false)
type Busy = { turnId: string; since: number } | null
/** This session's main turn (user prompt to answer); null between turns. */
const busyTurn = atom({ plugin: 'task', key: 'busy' } as const, null)
/** Clock of the last read; ticks while a task runs so elapsed times move without rewriting the snapshot. */
const nowAtom = atom({ plugin: 'task', key: 'now' } as const, 0)
const lastError = atom({ plugin: 'task', key: 'error' } as const, null)
/** UI language as detected at session start (or forced by the `language` setting). */
const langAtom = atom({ plugin: 'task', key: 'lang' } as const, null)

/** The runtime's own guess, used until detection has run. */
function runtimeLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

/** The strings of the current draw or read; set from langAtom before each use. */
let L: Strings = STRINGS[pickLang('auto', { env: [], runtime: runtimeLocale() })]

async function currentStrings($: EngineInterface): Promise<Strings> {
  L = STRINGS[(await read($, langAtom)) ?? pickLang('auto', { env: [], runtime: runtimeLocale() })]
  return L
}

/** Setting → LC_ALL → macOS AppleLanguages → LC_MESSAGES / LANG → runtime. */
async function envLocales($: EngineInterface): Promise<(string | undefined)[]> {
  return Promise.all([
    $.env.get('LC_ALL').catch(() => undefined),
    $.env.get('LC_MESSAGES').catch(() => undefined),
    $.env.get('LANG').catch(() => undefined),
  ])
}

/** The macOS language list's first entry; null elsewhere or when `defaults` is slow. */
async function systemLocale($: EngineInterface): Promise<string | null> {
  return $.process
    .run(['defaults', 'read', '-g', 'AppleLanguages'], { timeoutMs: SYSTEM_LANG_TIMEOUT_MS })
    .then(r => (r.exitCode === 0 ? firstAppleLanguage(r.stdout) : null))
    .catch(() => null)
}

async function setLang($: EngineInterface, lang: Lang) {
  if ((await read($, langAtom)) !== lang) await update($, langAtom, () => lang)
  L = STRINGS[lang]
}

let langDetected: Promise<void> | null = null

/**
 * Detects the UI language. `quick`: settle on setting/env/runtime now and ask the
 * OS list in the background (session start must not wait on `defaults`).
 */
function ensureLang($: EngineInterface, options: PluginOptions, { force = false, quick = false } = {}): Promise<void> {
  if (langDetected && !force) return langDetected
  const setting = options.language
  langDetected = (async () => {
    if (setting === 'zh' || setting === 'en') return setLang($, setting)
    const env = await envLocales($)
    const full = async () => setLang($, pickLang(setting, { system: await systemLocale($), env, runtime: runtimeLocale() }))
    if (!quick) return full()
    await setLang($, pickLang(setting, { env, runtime: runtimeLocale() }))
    void full().catch(() => undefined)
  })()
  return langDetected
}

const ACTIVE = new Set(['进行中', '打回', '待决策', '阻塞', '待验证'])
const FILTERS: { key: string; match: (t: Task) => boolean }[] = [
  { key: 'active', match: t => ACTIVE.has(t.status) },
  { key: 'todo', match: t => t.status === '待开始' },
  { key: 'verify', match: t => t.status === '待验证' },
  { key: 'decision', match: t => t.status === '待决策' },
  { key: 'blocked', match: t => t.status === '阻塞' || t.status === '打回' },
  { key: 'all', match: () => true },
]

const STATUS_COLOR: Record<string, string> = {
  进行中: 'claude',
  待验证: 'warning',
  待决策: 'warning',
  阻塞: 'error',
  打回: 'error',
  已完成: 'success',
}
const PRIORITY_COLOR: Record<string, string> = { P0: 'error', P1: 'warning' }
const LOOP_COLOR: Record<string, string> = {
  running: 'claude',
  waiting: 'success',
  halted: 'error',
  stale: 'warning',
  uninitialized: 'warning',
}

// ---------------------------------------------------------------- reading

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

let rootCache: { cwd: string; root: string | null; at: number } | null = null

/** The nearest directory at or above cwd holding `.claude/backlog.md`; cached per cwd. */
async function findRoot($: EngineInterface, now: number): Promise<string | null> {
  const cwd = (await $.session.cwd()).replace(/\/+$/, '') || '/'
  if (rootCache && rootCache.cwd === cwd && (rootCache.root !== null || now - rootCache.at < ROOT_CACHE_MS)) {
    return rootCache.root
  }
  let root: string | null = null
  let dir = cwd
  for (;;) {
    if (await $.fs.exists(`${dir}/.claude/backlog.md`).catch(() => false)) {
      root = dir
      break
    }
    const parent = dir.replace(/\/[^/]+$/, '') || '/'
    if (parent === dir) break
    dir = parent
  }
  rootCache = { cwd, root, at: now }
  return root
}

async function readPool($: EngineInterface, root: string): Promise<PoolFiles> {
  const base = `${root}/.claude`
  const [backlog, progress, current, session, runLog, hasStopFile, inboxEntries] = await Promise.all([
    readText($, `${base}/backlog.md`),
    readText($, `${base}/dev-progress.md`),
    readText($, `${base}/auto/current`),
    readText($, `${base}/auto/session`),
    readText($, `${base}/auto/run.log`),
    $.fs.exists(`${base}/auto/STOP`).catch(() => false),
    $.fs.list(`${base}/inbox`).catch(() => []),
  ])
  const inbox = inboxEntries.filter(e => e.kind === 'file' && !e.name.startsWith('.')).length
  return { backlog, progress, current, session, runLog, hasStopFile, inbox }
}

/** Cheap content signature: unchanged files → no snapshot write, no redraw. */
function signatureOf(root: string | null, files: PoolFiles): string {
  let hash = 0x811c9dc5
  const parts = [root ?? '', files.backlog, files.progress, files.current, files.session, files.runLog]
  for (const part of parts) {
    const text = part ?? '\u0000'
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
    hash = Math.imul(hash ^ 0x7c, 16777619)
  }
  return `${hash >>> 0}:${files.hasStopFile ? 1 : 0}:${files.inbox}`
}

/**
 * Work outside the loop: this session's main turn and the subagents it runs while
 * no loop task does, so the dashboard does not read 空闲 with work under way. A
 * running loop's own dispatcher and worker are already the current task. Where no
 * pool is set up the busy session goes unsaid: every turn of every project would
 * otherwise light up the status line.
 */
function directWork(snap: Snapshot, agentList: AgentRow[], busy: Busy): string | undefined {
  if (snap.loop === 'running' || snap.loop === 'waiting') return undefined
  const running = agentList.filter(a => a.status === 'running' && !parked.has(a.id)).length
  const parts = [busy && snap.initialized ? L.sessionBusy : null, running ? L.directAgents(running) : null]
  return parts.filter(Boolean).join(' · ') || undefined
}

function statusLine(snap: Snapshot, agentList: AgentRow[], busy: Busy, now: number): string | undefined {
  const loopText = L.loop[snap.loop]
  const direct = directWork(snap, agentList, busy)
  if (!snap.initialized) return direct ? `${L.title} ● ${direct}` : undefined
  const c = snap.counts
  const cur = snap.current
  const parts = [`${L.title} ● ${loopText}`]
  if (direct) parts.push(direct)
  if (cur) {
    const title = snap.currentTitle.length > 24 ? `${snap.currentTitle.slice(0, 24)}…` : snap.currentTitle
    parts.push(`${cur.task} ${title}`.trim())
    if (cur.started !== null) parts.push(duration(now - cur.started))
  }
  for (const status of ['待验证', '待决策', '阻塞']) if (c[status]) parts.push(L.countOf(status, c[status]!))
  if (!cur && c['待开始']) parts.push(L.countOf('待开始', c['待开始']))
  parts.push('/task-dash')
  return parts.join(' · ')
}

const REPORT_TASKS = 15

/** The whole dashboard as plain text: printed into the transcript where no pane can dock. */
function reportText(snap: Snapshot, agentList: AgentRow[], busy: Busy, now: number, all: boolean): string {
  if (!snap.initialized) return `${L.title}\n${L.noPool}\n${L.runInit}`
  const out: string[] = []
  const name = snap.root?.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const s = snap.session
  const session = s
    ? [L.delivered(s.done, s.max), s.runStarted !== null ? L.elapsed(`${duration(now - s.runStarted)}${s.hours !== null ? `/${s.hours}h` : ''}`) : null, s.noprog ? L.noprog(s.noprog) : null]
        .filter(Boolean)
        .join(' · ')
    : ''
  const direct = directWork(snap, agentList, busy)
  out.push(`${L.title} [${name}] ● ${L.loop[snap.loop]}${snap.stopRequested && snap.loop === 'running' ? L.stopAfter : ''}${snap.loop === 'stale' ? L.staleHint : ''}${direct ? ` · ${direct}` : ''}`)
  if (session) out.push(session)
  const cur = snap.current
  out.push('', `■ ${L.currentTask}`)
  if (cur) {
    out.push(`  ${cur.task} ${snap.currentTitle || L.noTitle}`)
    out.push(`  ${[L.phase(cur.phase || '—'), cur.worker || null, L.elapsed(duration(cur.started === null ? null : now - cur.started)), cur.startSha ? L.baseline(cur.startSha.slice(0, 8)) : null].filter(Boolean).join(' · ')}`)
    if (cur.haltNote) out.push(`  ${L.halt(cur.haltNote)}`)
  } else out.push(`  ${L.noCurrent}`)
  if (snap.inbox) out.push(`  ${L.inboxPending(snap.inbox)}`)
  const m = snap.metrics
  const c = snap.counts
  out.push(
    '',
    [
      `${L.stats.completion} ${percent(m.completionRate)}`,
      `${L.stats.delivery} ${percent(m.deliveryRate)}`,
      `${L.stats.firstPass} ${percent(m.firstPassRate)}`,
      `${L.stats.delivered7d} ${m.delivered7d}`,
      `${L.stats.medianCycle} ${duration(m.medianCycleMs)}`,
      `${L.stats.interventions} ${m.interventions ?? '—'}`,
      `${L.stats.decisionWait} ${duration(m.decisionWaitMs)}`,
      `${L.stats.rollback} ${percent(m.rollbackRate)}`,
      `${L.stats.wip} ${c['进行中'] ?? 0}`,
      `${L.stats.verify} ${c['待验证'] ?? 0}`,
      `${L.stats.autoClosed} ${m.autoClosed}`,
      `${L.stats.archived} ${c.archived}`,
    ].join(' · '),
  )
  const open = snap.tasks.filter(t => t.status !== '已完成' && t.status !== '已取消')
  const order = (t: Task) => { const i = ['进行中', '打回', '待决策', '阻塞', '待验证', '待开始'].indexOf(t.status); return i < 0 ? 9 : i }
  const tasks = verifyOrder([...open].sort((a, b) => order(a) - order(b)))
  const shown = all ? tasks : tasks.slice(0, REPORT_TASKS)
  out.push('', `■ ${L.tasks} ${L.count(open.length)}`)
  for (const t of shown) {
    out.push(`  ${t.priority || '—'} ${t.id} [${statusLabel(L, t.status, t.statusLabel)}] ${t.title}${t.deps && t.deps !== '—' ? `  (${L.deps(t.deps)})` : ''}`)
    if (t.status !== '待验证') continue
    const expiry = verifyExpiry(t, snap.verifyTimeoutDays, now)
    const parts = [t.howToVerify ? L.pair(L.fields.howToVerify, t.howToVerify) : null, expiry ? (expiry.hold ? L.hold : L.expiry(expiry.left, expiry.due, expiry.noticed)) : null].filter(Boolean)
    if (parts.length) out.push(`      ${parts.join(' · ')}`)
  }
  if (shown.length < tasks.length) out.push(`  ${L.more(tasks.length - shown.length)}`)
  if (snap.decisions.length) {
    out.push('', `■ ${L.decisions} ${L.decisionsExtra(snap.decisions.length)}`)
    for (const d of snap.decisions) out.push(`  ${d.task} ${d.question}`, `      ${d.options}`)
  }
  const blocks = snap.humanBlocks.filter(isOpenHumanBlock)
  if (blocks.length) {
    out.push('', `■ ${L.humanBlocks}`)
    for (const b of blocks) out.push(`  ${b.id} ${b.desc} → ${b.blocks}`)
  }
  if (agentList.length) {
    out.push('', `■ ${L.agents} ${L.runningCount(agentList.filter(a => a.status === 'running').length)}`)
    for (const a of [...agentList].reverse().slice(0, 8)) out.push(`  ${a.status === 'running' ? '●' : '○'} ${a.label} · ${a.status === 'running' ? L.agentRunning : L.agentDone} ${duration((a.endedAt ?? now) - a.startedAt)}`)
  }
  if (snap.events.length) {
    out.push('', `■ ${L.events}`)
    for (const e of [...snap.events].slice(-8).reverse()) out.push(`  ${e.time.slice(5, 16)} ${e.subject} ${e.subject === e.event ? e.detail : `${e.event} ${e.detail}`}`)
  }
  return out.join('\n')
}

let refreshing: Promise<void> | null = null
let again = false
let lastSignature = ''
/**
 * The line this module last pinned. Starts as one no line equals, so a freshly
 * (re)loaded module always pins its own first, clearing what an earlier load left.
 */
let lastStatus: string | undefined = '\u0000'

let statusSeq = 0

async function showStatus($: EngineInterface, snap: Snapshot | null, now: number) {
  // Callers overlap (a turn starting during a timed read): only the latest call writes.
  const mine = ++statusSeq
  await currentStrings($)
  const [hidden, agentList, busy, err] = await Promise.all([read($, statusHidden), read($, agents), read($, busyTurn), read($, lastError)])
  if (mine !== statusSeq) return
  let text = snap && !hidden ? statusLine(snap, agentList, busy, now) : undefined
  // A failed read says so rather than passing off the last snapshot as current.
  if (err && !hidden) text = `${text ?? L.title} · ⚠ ${L.readFailed}`
  if (text !== lastStatus) {
    lastStatus = text
    $.ui.status(text)
  }
}

/** `mine`: the refresh this read belongs to; one abandoned meanwhile writes nothing. */
async function readOnce($: EngineInterface, mine: number) {
  const now = await $.clock.now()
  const root = await findRoot($, now)
  const files: PoolFiles = root ? await readPool($, root) : { hasStopFile: false, inbox: 0 }
  if (mine !== generation) return
  if (root && files.backlog === undefined) rootCache = null // pool removed: look again next time
  const signature = signatureOf(root, files)
  const prev = await read($, snapshot)
  let snap = prev
  if (signature !== lastSignature || !prev) {
    snap = buildSnapshot(root, files, now)
    const strings = await currentStrings($)
    for (const note of transitions(prev, snap)) $.ui.toast(strings.toast(note))
    await update($, snapshot, () => snap)
    lastSignature = signature
  }
  if (snap?.current || signature !== lastSignature) await update($, nowAtom, () => now)
  if (await read($, lastError)) await update($, lastError, () => null)
  await showStatus($, snap, now)
}

let ticker: { cancel: () => void } | null = null
let lastTickAt = 0

/**
 * Starts the periodic read once per module load. A reload cancels the old
 * module's timers and resets this state, so any hook of the new one (not only
 * session.start, which an update may not raise again) brings the timer back;
 * so does a timer silent for three periods (a refused period ends an interval).
 */
function ensureTicking($: EngineInterface) {
  if (ticker && Date.now() - lastTickAt < REFRESH_MS * 3) return
  ticker?.cancel()
  lastTickAt = Date.now()
  ticker = $.clock.every(REFRESH_MS, () => {
    lastTickAt = Date.now()
    void refresh($)
  })
}

let refreshStartedAt = 0
let generation = 0

/**
 * Re-reads the pool; a request during a read runs once more after it.
 * A read hung past READ_TIMEOUT_MS is abandoned by the next request, so one stuck
 * `$.fs` call cannot freeze the dashboard.
 */
function refresh($: EngineInterface): Promise<void> {
  if (refreshing && Date.now() - refreshStartedAt > READ_TIMEOUT_MS) {
    refreshing = null
    void (async () => {
      const strings = await currentStrings($)
      await update($, lastError, () => strings.readTimeout(READ_TIMEOUT_MS / 1000))
      await showStatus($, await read($, snapshot), await $.clock.now())
    })().catch(() => undefined)
  }
  if (refreshing) {
    again = true
    return refreshing
  }
  const mine = ++generation
  refreshStartedAt = Date.now()
  const run = (async () => {
    do {
      again = false
      try {
        await readOnce($, mine)
      } catch (err) {
        if (mine === generation) await update($, lastError, () => (err instanceof Error ? err.message : String(err))).catch(() => undefined)
      }
      // Apart from the pool read, so a failing read does not leave 运行中 standing.
      await settleAgents($).catch(() => undefined)
    } while (again && mine === generation)
    if (mine === generation) refreshing = null
  })()
  refreshing = run
  return run
}

/** Marks this session's main turn begun (a subagent's run raises no turn.start). */
async function turnStarted($: EngineInterface, turnId: string) {
  const since = await $.clock.now()
  await update($, busyTurn, () => ({ turnId, since }))
  await showStatus($, await read($, snapshot), since)
}

/**
 * Ends the busy mark: on the main loop's turn.complete (no agentId), or on the
 * one carrying the marked turn's id, so no other loop's start can leave it standing.
 */
async function turnEnded($: EngineInterface, turnId: string, agentId: string | undefined) {
  const busy = await read($, busyTurn)
  if (!busy || (agentId && busy.turnId !== turnId)) return
  await update($, busyTurn, () => null)
  await showStatus($, await read($, snapshot), await $.clock.now())
}

// ---------------------------------------------------------------- agents

/** Agent tool calls' `name` by their `description`, to label the subagent `$.agent.list` reports. */
const namesByDescription = new Map<string, string>()
const ENDED = new Set(['completed', 'failed', 'killed'])
const PARKED = new Set(['idle', 'waiting'])
/** A row this young may not be listed yet; it is not ended for being missing. */
const SETTLE_GRACE_MS = 5000
/** Running rows the engine reports idle or waiting (a teammate between messages): not counted as work. */
let parked = new Set<string>()

/**
 * Ends rows whose SubagentStop never came: the engine says the agent is over, or
 * has dropped it from its list. Then redraws the status line.
 */
async function settleAgents($: EngineInterface) {
  const list = await read($, agents)
  if (list.some(a => a.status === 'running')) {
    const infos = await $.agent.list().catch(() => null)
    if (infos) {
      const now = await $.clock.now()
      const live = new Map(infos.map(i => [i.id, i.status as string]))
      const isOver = (a: AgentRow) => {
        const status = live.get(a.id)
        return status === undefined ? now - a.startedAt > SETTLE_GRACE_MS : ENDED.has(status)
      }
      parked = new Set(infos.filter(i => PARKED.has(i.status)).map(i => i.id))
      if (list.some(a => a.status === 'running' && isOver(a))) {
        await update($, agents, rows =>
          rows.map(a => (a.status === 'running' && isOver(a) ? { ...a, status: 'done' as const, endedAt: now } : a)),
        )
      }
    }
  }
  await showStatus($, await read($, snapshot), await $.clock.now())
}

/** Rows worth a line: one with neither a label nor a type (left by an older version) is skipped. */
function namedAgents(list: AgentRow[]): AgentRow[] {
  return list.filter(a => a.label.trim() || a.type.trim())
}

function upsertAgent(list: AgentRow[], row: AgentRow): AgentRow[] {
  // Blank rows an older version stored go on the next write, so they never take a place of the MAX_AGENTS.
  const rest = namedAgents(list).filter(a => a.id !== row.id)
  return [...rest, row].slice(-MAX_AGENTS)
}

// ---------------------------------------------------------------- drawing

type Els = ReturnType<EngineInterface['ui']['resolve']>

function Rule({ els, cols }: { els: Els; cols: number }) {
  const { Text } = els
  return <Text dimColor>{'─'.repeat(Math.max(4, cols))}</Text>
}

function Heading({ els, title, extra }: { els: Els; title: string; extra?: string }) {
  const { Box, Text } = els
  return (
    <Box>
      <Text bold color="claude">
        {title}
      </Text>
      {extra ? <Text dimColor> {extra}</Text> : null}
    </Box>
  )
}

/** A tile's border and left padding take three of its cells. */
const TILE_CHROME = 3

/**
 * Metrics as tiles, four to a row, only while each tile holds its longest label
 * whole; otherwise as plain `label value` text, which keeps a narrow pane short.
 */
function tileWidth(cols: number, labels: string[]): number | null {
  const tile = Math.floor(cols / 4)
  return tile - TILE_CHROME >= Math.max(...labels.map(cellWidth)) ? tile : null
}

/** One metric: a framed tile (label above, value below) when given a width, else a text pair. */
function Stat({ els, label, value, color, width }: { els: Els; label: string; value: string; color?: string; width: number | null }) {
  const { Box, Text } = els
  if (width === null) {
    return (
      <Box marginRight={2}>
        <Text dimColor>{label} </Text>
        <Text bold color={color}>
          {value}
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor="subtle" paddingLeft={1}>
      <Text dimColor wrap="truncate-end">
        {label}
      </Text>
      <Text bold color={color} wrap="truncate-end">
        {value}
      </Text>
    </Box>
  )
}

/**
 * A status as a coloured tag, right-aligned at the end of a task row. It never
 * shrinks: on a narrow pane the title gives way, not the tag (which would wrap
 * a character to a line and make the row several rows tall).
 */
function StatusTag({ els, status, label, tagKey, width }: { els: Els; status: string; label: string; tagKey: string; width: number }) {
  const { Box, Text } = els
  const color = STATUS_COLOR[status]
  return (
    <Box key={tagKey} flexShrink={0} width={width}>
      <Text wrap="truncate-end">
        {' '}
        {color ? (
          <Text backgroundColor={color} color="black" bold>
            {` ${label} `}
          </Text>
        ) : (
          <Text color="subtle">{` ${label} `}</Text>
        )}
      </Text>
    </Box>
  )
}

function CurrentCard({ els, snap, now }: { els: Els; snap: Snapshot; now: number }) {
  const { Box, Text } = els
  const cur = snap.current
  if (!cur) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
        <Text dimColor>{L.noCurrent}</Text>
        {snap.inbox ? <Text dimColor>{L.inboxPending(snap.inbox)}</Text> : null}
      </Box>
    )
  }
  const meta = [
    L.phase(cur.phase || '—'),
    cur.worker || null,
    L.elapsed(duration(cur.started === null ? null : now - cur.started)),
    cur.startSha ? L.baseline(cur.startSha.slice(0, 8)) : null,
    snap.inbox ? `inbox ${snap.inbox}` : null,
  ].filter(Boolean)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
      <Box>
        <Text color="claude" bold>
          {cur.task}{' '}
        </Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">{snap.currentTitle || L.noTitle}</Text>
        </Box>
      </Box>
      <Text dimColor wrap="wrap">
        {meta.join(' · ')}
      </Text>
      {cur.haltNote ? <Text color="error" wrap="wrap">{L.halt(cur.haltNote)}</Text> : null}
    </Box>
  )
}

/** Cells a status tag takes: a space before it and one either side of the label. */
const tagCells = (label: string) => cellWidth(label) + 3

/** Columns left to a task title once the row's fixed parts are drawn, below which a long status drops its suffix. */
const MIN_TITLE_CELLS = 8

/** The card's indent under the row, its border and its horizontal padding, in cells. */
const DETAIL_INDENT = 2
const DETAIL_CHROME = DETAIL_INDENT + 4
/** Below this many cells beside the label column, a field puts its label above its value instead. */
const MIN_VALUE_CELLS = 12

/**
 * The note's clauses, one per line, less the clause the acceptance field already
 * shows. Only that one is dropped: a later 验收 (a delivery's own) stays in the note.
 */
function noteLines(task: Task): string[] {
  // 怎么验 / 待验证起 / 超时预告 have fields of their own on a 待验证 card; elsewhere they stay in the note.
  const clauses = noteClauses(task.note).filter(c => task.status !== '待验证' || !VERIFY_CLAUSE.test(c))
  const shown = clauses.findIndex(c => /^验收[：:]/.test(c) && clauseAcceptance(c) === task.acceptance)
  return shown < 0 ? clauses : clauses.filter((_, i) => i !== shown)
}

type Expiry = ReturnType<typeof verifyExpiry>

/** Bullet before each clause of a field of several. */
const BULLET_CELLS = 2

/**
 * One labelled field of an expanded row. Labels sit in a column of one width,
 * so every value starts at the same cell and wraps under itself, not under the label.
 * Values come pre-wrapped to `valueCells` (see wrapCells): the host wraps at spaces only,
 * which would move a whole Chinese run down a line and leave the line before half empty.
 */
function Field({ els, fieldKey, label, labelCells, valueCells, stacked, lines, dim }: { els: Els; fieldKey: string; label: string; labelCells: number; valueCells: number; stacked: boolean; lines: string[]; dim?: boolean }) {
  const { Box, Text } = els
  const values = (
    <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} paddingLeft={stacked ? 2 : 0}>
      {lines.map((line, i) =>
        lines.length > 1 ? (
          <Box key={`${fieldKey}:${i}`}>
            <Box flexShrink={0}>
              <Text dimColor>· </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap="wrap" dimColor={dim}>
                {wrapCells(line, valueCells - BULLET_CELLS).join('\n')}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box key={`${fieldKey}:${i}`}>
            <Text wrap="wrap" dimColor={dim}>
              {wrapCells(line, valueCells).join('\n')}
            </Text>
          </Box>
        ),
      )}
    </Box>
  )
  return (
    // Keyed again here: the component's own key is React's list key and never reaches the host tree.
    <Box key={fieldKey} flexDirection={stacked ? 'column' : 'row'}>
      <Box flexShrink={0} width={stacked ? undefined : labelCells}>
        <Text dimColor>{label}</Text>
      </Box>
      {values}
    </Box>
  )
}

/** An open task row: the whole title, then module / deps / origin / acceptance / notes as aligned fields, in a card like the current task's. */
function TaskDetail({ els, task, isCurrent, cols, expiry }: { els: Els; task: Task; isCurrent: boolean; cols: number; expiry: Expiry }) {
  const { Box, Text } = els
  const F = L.fields
  const fields: { name: string; label: string; lines: string[]; dim?: boolean }[] = [
    { name: 'module', label: F.module, lines: [task.module || '—'] },
  ]
  if (task.deps && task.deps !== '—') fields.push({ name: 'deps', label: F.deps, lines: [task.deps] })
  if (task.derivedFrom) fields.push({ name: 'derivedFrom', label: F.derivedFrom, lines: [task.derivedFrom] })
  if (task.acceptance) fields.push({ name: 'acceptance', label: F.acceptance, lines: [task.acceptance] })
  if (task.status === '待验证') {
    fields.push({ name: 'howToVerify', label: F.howToVerify, lines: [task.howToVerify || L.noHowToVerify], dim: !task.howToVerify })
    if (expiry) fields.push({ name: 'expiry', label: F.expiry, lines: [(expiry.hold ? L.hold : L.expiry(expiry.left, expiry.due, expiry.noticed))] })
    if (task.signs) fields.push({ name: 'signs', label: F.signs, lines: [task.signs], dim: task.signTier === 2 })
  }
  const notes = noteLines(task)
  fields.push({ name: 'note', label: F.note, lines: notes.length ? notes : [L.noNote], dim: true })
  // Sized for every label, not just this card's, so values start at one column in every open row.
  const labelCells = Math.max(...Object.values(F).map(cellWidth)) + 2
  const stacked = cols - DETAIL_CHROME - labelCells < MIN_VALUE_CELLS
  // A stacked value sits under its label, indented by two.
  const valueCells = stacked ? cols - DETAIL_CHROME - 2 : cols - DETAIL_CHROME - labelCells
  return (
    <Box key={`detail:${task.id}`} paddingLeft={DETAIL_INDENT}>
      <Box flexDirection="column" flexGrow={1} minWidth={0} borderStyle="round" borderColor={isCurrent ? 'claude' : 'subtle'} paddingX={1}>
        <Box key={`detail-title:${task.id}`}>
          <Text bold wrap="wrap">
            {wrapCells(task.title, cols - DETAIL_CHROME).join('\n')}
          </Text>
        </Box>
        {fields.map(f => (
          <Field key={`field:${task.id}:${f.name}`} els={els} fieldKey={`field:${task.id}:${f.name}`} label={f.label} labelCells={labelCells} valueCells={valueCells} stacked={stacked} lines={f.lines} dim={f.dim} />
        ))}
      </Box>
    </Box>
  )
}

function taskRow($: EngineInterface, els: Els, task: Task, isOpen: boolean, isCurrent: boolean, cols: number, expiry: Expiry = null) {
  const { Box, Text, Button } = els
  const leadCells = cellWidth(`${task.priority || '—'} ▸ ${task.id} `)
  // A suffixed status (待验证✗验证失败) keeps only its name where the whole would leave the title no room.
  const full = statusLabel(L, task.status, task.statusLabel)
  const label = leadCells + tagCells(full) + MIN_TITLE_CELLS > cols ? statusLabel(L, task.status, '') : full
  return (
    <Box key={`row:${task.id}`} flexDirection="column">
      <Box>
        <Box key={`lead:${task.id}`} flexShrink={0}>
          <Text color={PRIORITY_COLOR[task.priority] ?? 'subtle'}>{task.priority || '—'} </Text>
          <Button
            plain
            key={`task:${task.id}`}
            label={`${isOpen ? '▾' : '▸'} ${task.id}`}
            onPress={() => update($, openTask, v => (v === task.id ? null : task.id))}
          />
          <Text> </Text>
        </Box>
        <Box key={`title:${task.id}`} flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end" bold={isCurrent}>
            {task.title}
          </Text>
        </Box>
        <StatusTag els={els} tagKey={`tag:${task.id}`} status={task.status} label={label} width={Math.max(0, Math.min(tagCells(label), cols - leadCells))} />
      </Box>
      {isOpen ? <TaskDetail els={els} task={task} isCurrent={isCurrent} cols={cols} expiry={expiry} /> : null}
    </Box>
  )
}

function AgentLine({ els, agent, now }: { els: Els; agent: AgentRow; now: number }) {
  const { Box, Text } = els
  const running = agent.status === 'running'
  const took = (agent.endedAt ?? now) - agent.startedAt
  return (
    <Box>
      <Text color={running ? 'success' : 'subtle'}>{running ? '● ' : '○ '}</Text>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">{agent.label}</Text>
      </Box>
      <Text dimColor>
        {' '}
        {agent.type} · {running ? L.agentRunning : L.agentDone} {duration(took)}
      </Text>
    </Box>
  )
}

async function drawPane($: EngineInterface, els: Els, cols: number) {
  const { Box, Text, Button } = els
  await currentStrings($)
  const snap = await read($, snapshot)
  const err = await read($, lastError)
  const direct = snap ? directWork(snap, await read($, agents), await read($, busyTurn)) : undefined
  // One wrapping line: on a narrow pane the work under way folds onto the next row instead of being cut.
  const header = (
    <Box>
      <Text wrap="wrap">
        <Text bold>{L.title} </Text>
        {snap?.root ? <Text dimColor>[{snap.root.split(/[\\/]/).filter(Boolean).pop() ?? snap.root}] </Text> : null}
        {snap ? (
          <Text color={LOOP_COLOR[snap.loop] ?? 'subtle'}>
            ● {L.loop[snap.loop]}
            {snap.stopRequested && snap.loop === 'running' ? L.stopAfter : ''}
            {snap.loop === 'stale' ? L.staleHint : ''}
          </Text>
        ) : null}
        {direct ? <Text color="claude"> · {direct}</Text> : null}
      </Text>
    </Box>
  )

  if (!snap) {
    // No snapshot yet: a failed or timed-out first read is said, not left as 加载中.
    return (
      <Box flexDirection="column" width={cols}>
        {header}
        {err ? <Text color="error" wrap="wrap">{err}</Text> : <Text dimColor>{L.loading}</Text>}
        {err ? <Text dimColor wrap="wrap">{L.retryHint}</Text> : null}
        {/* The pane re-reads every few seconds; a button is only worth its room while the first read has failed. */}
        {err ? (
          <Box>
            {/* Keyed `refresh` as before: L.retryHint names its hotkey r. */}
            <Button key="refresh" hotkey="r" label={L.retry} onPress={() => refresh($)} />
          </Box>
        ) : null}
      </Box>
    )
  }
  if (!snap.initialized) {
    return (
      <Box flexDirection="column" width={cols}>
        {header}
        {err ? <Text color="error">{err}</Text> : null}
        <Text dimColor>{L.noPool}</Text>
        <Text dimColor>{L.runInit}</Text>
      </Box>
    )
  }

  const m = snap.metrics
  const c = snap.counts
  const s = snap.session
  const now = Math.max(snap.readAt, await read($, nowAtom))
  const [allAgents, filterKey, opened] = await Promise.all([read($, agents), read($, filter), read($, openTask)])
  const agentList = namedAgents(allAgents)
  const active = FILTERS.find(f => f.key === filterKey) ?? FILTERS[0]!
  const tile = tileWidth(cols, Object.values(L.stats))
  // Only the 待验证 filter reorders: in a mixed list it would put a P2 row where a P0 row was.
  const shown = active.key === 'verify' ? verifyOrder(snap.tasks.filter(active.match)) : snap.tasks.filter(active.match)
  const sessionText = s
    ? [
        L.delivered(s.done, s.max),
        s.runStarted !== null ? L.elapsed(`${duration(now - s.runStarted)}${s.hours !== null ? `/${s.hours}h` : ''}`) : null,
        s.noprog ? L.noprog(s.noprog) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <Box flexDirection="column" width={cols}>
      {header}
      <Text dimColor wrap="truncate-start">
        {snap.root}
        {sessionText ? ` · ${sessionText}` : ''}
      </Text>
      {err ? <Text color="error">{err}</Text> : null}
      <Rule els={els} cols={cols} />

      <Heading els={els} title={L.currentTask} />
      <CurrentCard els={els} snap={snap} now={now} />

      <Box flexWrap="wrap">
        <Stat els={els} width={tile} label={L.stats.completion} value={percent(m.completionRate)} color="success" />
        <Stat els={els} width={tile} label={L.stats.delivery} value={percent(m.deliveryRate)} color="claude" />
        <Stat els={els} width={tile} label={L.stats.firstPass} value={percent(m.firstPassRate)} color={m.firstPassRate === null ? undefined : 'success'} />
        <Stat els={els} width={tile} label={L.stats.delivered7d} value={`${m.delivered7d}`} color="claude" />
        <Stat els={els} width={tile} label={L.stats.medianCycle} value={duration(m.medianCycleMs)} />
        <Stat els={els} width={tile} label={L.stats.interventions} value={`${m.interventions ?? '—'}`} color={m.interventions ? 'warning' : undefined} />
        <Stat els={els} width={tile} label={L.stats.decisionWait} value={duration(m.decisionWaitMs)} />
        <Stat els={els} width={tile} label={L.stats.rollback} value={percent(m.rollbackRate)} color={m.rollbackRate ? 'error' : undefined} />
        <Stat els={els} width={tile} label={L.stats.wip} value={`${c['进行中'] ?? 0}`} color={(c['进行中'] ?? 0) > 1 ? 'error' : 'success'} />
        <Stat els={els} width={tile} label={L.stats.verify} value={`${c['待验证'] ?? 0}`} color={c['待验证'] ? 'warning' : undefined} />
        <Stat els={els} width={tile} label={L.stats.autoClosed} value={`${m.autoClosed}`} />
        <Stat els={els} width={tile} label={L.stats.archived} value={`${c.archived}`} />
      </Box>
      <Rule els={els} cols={cols} />

      <Heading els={els} title={L.tasks} extra={L.count(shown.length)} />
      <Box flexWrap="wrap">
        {FILTERS.map(f => (
          <Box key={`filter-box:${f.key}`} marginRight={1}>
            <Button
              key={`filter:${f.key}`}
              label={`${L.filters[f.key]} ${snap.tasks.filter(f.match).length}`}
              variant={f.key === active.key ? 'primary' : undefined}
              onPress={() => update($, filter, () => f.key)}
            />
          </Box>
        ))}
      </Box>
      {shown.length ? (
        shown.map(t => taskRow($, els, t, opened === t.id, snap.current?.task === t.id, cols, t.status === '待验证' ? verifyExpiry(t, snap.verifyTimeoutDays, now) : null))
      ) : (
        <Text dimColor>{L.noneInFilter}</Text>
      )}

      {snap.decisions.length ? (
        <Box flexDirection="column">
          <Rule els={els} cols={cols} />
          <Heading els={els} title={L.decisions} extra={L.decisionsExtra(snap.decisions.length)} />
          {snap.decisions.map((d, i) => (
            <Box key={`decision:${d.task}:${i}`} flexDirection="column" marginBottom={1}>
              <Text wrap="wrap">
                <Text color="warning" bold>
                  {d.task}
                </Text>{' '}
                {d.question}
              </Text>
              <Box paddingLeft={4}>
                <Text dimColor wrap="wrap">
                  {d.options}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}

      {snap.humanBlocks.filter(isOpenHumanBlock).length ? (
        <Box flexDirection="column">
          <Rule els={els} cols={cols} />
          <Heading els={els} title={L.humanBlocks} />
          {snap.humanBlocks
            .filter(isOpenHumanBlock)
            .map((b, i) => (
              <Box key={`human:${b.id}:${i}`}>
                <Text wrap="wrap">
                <Text color="error" bold>
                  {b.id}
                </Text>{' '}
                {b.desc} <Text dimColor>→ {b.blocks}</Text>
                </Text>
              </Box>
            ))}
        </Box>
      ) : null}

      <Rule els={els} cols={cols} />
      <Heading els={els} title={L.agents} extra={L.runningCount(agentList.filter(a => a.status === 'running').length)} />
      {agentList.length ? (
        [...agentList].reverse().map(a => (
            <Box key={`agent:${a.id}`}>
              <AgentLine els={els} agent={a} now={now} />
            </Box>
          ))
      ) : (
        <Text dimColor>{L.noAgents}</Text>
      )}

      <Rule els={els} cols={cols} />
      <Heading els={els} title={L.events} extra={L.count(snap.events.length)} />
      {snap.events.length ? (
        [...snap.events]
          .slice(-12)
          .reverse()
          .map((e, i) => (
            <Box key={`event:${e.at}:${i}`}>
              {/* Time and subject keep their width; only the detail gives way (truncated) on a narrow pane. */}
              <Box key="lead" flexShrink={0}>
                <Text dimColor>{e.time.slice(5, 16)} </Text>
                <Text color={e.subject === 'STOP' ? 'error' : e.subject === 'START' ? 'success' : 'claude'}>{e.subject} </Text>
              </Box>
              <Box key="detail" flexGrow={1} flexShrink={1} minWidth={0}>
                <Text wrap="truncate-end">
                  {e.subject === e.event ? e.detail : `${e.event} ${e.detail}`}
                </Text>
              </Box>
            </Box>
          ))
      ) : (
        <Text dimColor>{L.noEvents}</Text>
      )}
      <Text dimColor>{L.footer(REFRESH_MS / 1000)}</Text>
    </Box>
  )
}

// ---------------------------------------------------------------- dispatcher guard

const BUILTIN_EDIT_ARGS: Record<string, string[]> = {
  Edit: ['file_path'],
  Write: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
}
const MCP_EDIT = /^mcp__.*filesystem__(write_file|edit_file|move_file|create_directory)$/

/**
 * The file-writing tools, by the arguments naming a file: the built-ins and an
 * MCP filesystem server's. Bash goes unchecked: the loop's commit-attribution
 * check covers it.
 */
function editedPaths(e: { tool: string }): string[] {
  const keys = BUILTIN_EDIT_ARGS[e.tool] ?? (MCP_EDIT.test(e.tool) ? ['path', 'source', 'destination'] : [])
  const input = e as unknown as Record<string, unknown>
  return keys.map(k => input[k]).filter((v): v is string => typeof v === 'string')
}

/** Only the last stretch of run.log decides the loop's state; the log only grows. */
const RUN_LOG_TAIL = 65_536

/** A `/task:loop` turn (start, resume or tick) names this session the dispatcher, so other sessions go unguarded. */
async function claimDispatcher($: EngineInterface, text: string) {
  if (!/^\s*\/task:loop(\s|$)/.test(text)) return
  const root = await findRoot($, await $.clock.now())
  if (!root || !(await $.fs.exists(`${root}/.claude/auto`))) return
  const id = await $.session.id()
  if ((await readText($, `${root}/.claude/auto/dispatcher`))?.trim() !== id) await $.fs.write(`${root}/.claude/auto/dispatcher`, `${id}\n`)
}

/**
 * Why this session may not write `path` now, or null when it may. While its
 * loop runs (or waits for work) the dispatcher session's project code is the
 * worker's: a prompt alone does not keep a dispatcher from doing the work
 * itself. A halted, stopped or stale loop guards nothing, nor does another
 * session's loop (one started before the dispatcher was recorded counts as ours).
 */
async function dispatcherDenial($: EngineInterface, path: string): Promise<string | null> {
  const now = await $.clock.now()
  const root = await findRoot($, now)
  if (!root) return null
  const rel = dispatcherForbidden(root, path, await $.session.cwd())
  if (rel === null) return null
  const base = `${root}/.claude/auto`
  const [current, session, runLog, hasStopFile, dispatcher] = await Promise.all([
    readText($, `${base}/current`),
    readText($, `${base}/session`),
    readText($, `${base}/run.log`),
    $.fs.exists(`${base}/STOP`).catch(() => false),
    readText($, `${base}/dispatcher`),
  ])
  const tail = runLog && runLog.length > RUN_LOG_TAIL ? runLog.slice(runLog.indexOf('\n', runLog.length - RUN_LOG_TAIL) + 1) : runLog
  const loop = loopStatusOf(true, parseCurrent(current), parseSession(current, session), parseRunLog(tail), hasStopFile, now)
  if (loop !== 'running' && loop !== 'waiting') return null
  if (dispatcher?.trim() && dispatcher.trim() !== (await $.session.id())) return null
  await currentStrings($)
  return L.dispatcherDeny(rel)
}

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await ensureLang($, options, { force: true, quick: true })
    await $.command.register({
      name: 'task-dash',
      description: L.cmdDescription,
      argumentHint: '[report [all]|inline|off|on]',
    })
    ensureTicking($)
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'task-dash' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const arg = words.join(' ')
    ensureTicking($)
    await ensureLang($, options)
    if (arg === 'off' || arg === 'on') {
      await update($, statusHidden, () => arg === 'off')
      lastStatus = '\u0000'
      await showStatus($, await read($, snapshot), await $.clock.now())
      return { text: arg === 'off' ? L.statusOff : L.statusOn }
    }
    await refresh($)
    const printReport = async (all: boolean) => {
      await currentStrings($)
      const snap = await read($, snapshot)
      if (snap) return reportText(snap, namedAgents(await read($, agents)), await read($, busyTurn), await $.clock.now(), all)
      const err = await read($, lastError)
      return err ? `${L.title}\n${err}\n${L.retryHint}` : L.loading
    }
    if (words[0] === 'report') return { text: await printReport(words[1] === 'all') }
    const canDock = e.presentation.isFullscreen && e.presentation.columns >= DOCK_MIN_COLUMNS
    if (!canDock && arg !== 'inline') {
      // No dock: print the whole dashboard into the transcript instead of covering it.
      const why = e.presentation.isFullscreen ? L.narrow(e.presentation.columns, DOCK_MIN_COLUMNS) : L.notFullscreen
      return { text: `${await printReport(false)}\n\n${L.reportHint(why)}` }
    }
    await $.ui.open({ id: PANE, title: L.title, focus: true })
    return { text: canDock ? L.openedDock : L.openedInline }
  })

  on('turn.start', async ($, e, next) => {
    ensureTicking($)
    if (!(e as { agentId?: string }).agentId) await claimDispatcher($, e.text).catch(() => undefined)
    await turnStarted($, e.turnId)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    // Cleared before the answer settles: the next prompt starts its own turn.
    await turnEnded($, e.turnId, e.agentId).catch(() => undefined)
    const ran = await next(e)
    ensureTicking($)
    void refresh($)
    return ran
  })

  // Subagents (the worker, reviewers) carry agentId and edit freely; only the main loop is checked.
  on('tool.call', async ($, e, next) => {
    for (const path of e.agentId ? [] : editedPaths(e)) {
      const deny = await dispatcherDenial($, path).catch(() => null)
      if (deny) return { deny }
    }
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const input = e as unknown as { name?: string; description?: string }
    if (input.name && input.description) {
      namesByDescription.delete(input.description)
      namesByDescription.set(input.description, input.name)
      while (namesByDescription.size > MAX_AGENTS) namesByDescription.delete(namesByDescription.keys().next().value!)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', async ($, e, next) => {
    const now = await $.clock.now()
    const info = (await $.agent.list().catch(() => [])).find(a => a.id === e.agent_id)
    const description = info?.description ?? ''
    const name = namesByDescription.get(description) ?? ''
    const label = name || description || e.agent_type || 'subagent'
    await update($, agents, list =>
      upsertAgent(list, {
        id: e.agent_id,
        label: name && description ? `${name} · ${description}` : label,
        type: e.agent_type || info?.type || 'subagent',
        task: taskIdIn(name) ?? taskIdIn(description),
        status: 'running',
        startedAt: now,
        endedAt: null,
        summary: '',
      }),
    )
    await showStatus($, await read($, snapshot), now)
    void refresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, agents, list => {
      const row = list.find(a => a.id === e.agent_id)
      // A stop with no start seen and no type names nothing: no row rather than a blank one.
      if (!row && !e.agent_type?.trim()) return list
      const summary = (e.last_assistant_message ?? '').split('\n').find(l => l.trim())?.slice(0, 120) ?? ''
      return upsertAgent(
        list,
        row
          ? { ...row, status: 'done', endedAt: now, summary }
          : {
              id: e.agent_id,
              label: e.agent_type,
              type: e.agent_type,
              task: null,
              status: 'done',
              startedAt: now,
              endedAt: now,
              summary,
            },
      )
    })
    await showStatus($, await read($, snapshot), now)
    void refresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    return drawPane($, els, Math.max(20, e.props.bodyColumns))
  })
}
