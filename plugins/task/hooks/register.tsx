import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { AgentRow, PoolFiles, Snapshot, Task } from '../types'
import { buildSnapshot, duration, percent, taskIdIn, transitions } from './data'
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

function statusLine(snap: Snapshot, now: number): string | undefined {
  const loopText = L.loop[snap.loop]
  if (!snap.initialized) return undefined
  const c = snap.counts
  const cur = snap.current
  const parts = [`${L.title} ● ${loopText}`]
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

let refreshing: Promise<void> | null = null
let again = false
let lastSignature = ''
let lastStatus: string | undefined

async function showStatus($: EngineInterface, snap: Snapshot | null, now: number) {
  await currentStrings($)
  const text = snap && !(await read($, statusHidden)) ? statusLine(snap, now) : undefined
  if (text !== lastStatus) {
    lastStatus = text
    $.ui.status(text)
  }
}

async function readOnce($: EngineInterface) {
  const now = await $.clock.now()
  const root = await findRoot($, now)
  const files: PoolFiles = root ? await readPool($, root) : { hasStopFile: false, inbox: 0 }
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
  await showStatus($, snap, now)
  if (await read($, lastError)) await update($, lastError, () => null)
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
    void update($, lastError, () => L.readTimeout(READ_TIMEOUT_MS / 1000))
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
        await readOnce($)
      } catch (err) {
        await update($, lastError, () => (err instanceof Error ? err.message : String(err)))
      }
    } while (again && mine === generation)
    if (mine === generation) refreshing = null
  })()
  refreshing = run
  return run
}

// ---------------------------------------------------------------- agents

/** Agent tool calls' `name` by their `description`, to label the subagent `$.agent.list` reports. */
const namesByDescription = new Map<string, string>()

function upsertAgent(list: AgentRow[], row: AgentRow): AgentRow[] {
  const rest = list.filter(a => a.id !== row.id)
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
      <Text bold>{title}</Text>
      {extra ? <Text dimColor> {extra}</Text> : null}
    </Box>
  )
}

function Stat({ els, label, value, color }: { els: Els; label: string; value: string; color?: string }) {
  const { Box, Text } = els
  return (
    <Box marginRight={2}>
      <Text dimColor>{label} </Text>
      <Text bold color={color}>
        {value}
      </Text>
    </Box>
  )
}

function CurrentCard({ els, snap, now }: { els: Els; snap: Snapshot; now: number }) {
  const { Box, Text } = els
  const cur = snap.current
  if (!cur) {
    return (
      <Box flexDirection="column">
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
    <Box flexDirection="column">
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

function taskRow($: EngineInterface, els: Els, task: Task, isOpen: boolean, isCurrent: boolean) {
  const { Box, Text, Button } = els
  const meta = [
    task.module || '—',
    task.deps && task.deps !== '—' ? L.deps(task.deps) : null,
    task.derivedFrom ? L.derivedFrom(task.derivedFrom) : null,
  ].filter(Boolean)
  return (
    <Box key={`row:${task.id}`} flexDirection="column">
      <Box>
        <Text color={PRIORITY_COLOR[task.priority] ?? 'subtle'}>{task.priority || '—'} </Text>
        <Button
          plain
          key={`task:${task.id}`}
          label={`${isOpen ? '▾' : '▸'} ${task.id}`}
          onPress={() => update($, openTask, v => (v === task.id ? null : task.id))}
        />
        <Text> </Text>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end" bold={isCurrent}>
            {task.title}
          </Text>
        </Box>
        <Text color={STATUS_COLOR[task.status] ?? 'subtle'}> {statusLabel(L, task.status, task.statusLabel)}</Text>
      </Box>
      {isOpen ? (
        <Box flexDirection="column" paddingLeft={4} marginBottom={1}>
          <Text dimColor wrap="wrap">
            {meta.join(' · ')}
          </Text>
          {task.acceptance ? <Text wrap="wrap">{L.acceptance(task.acceptance)}</Text> : null}
          <Text dimColor wrap="wrap">
            {task.note || L.noNote}
          </Text>
        </Box>
      ) : null}
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
  const header = (
    <Box>
      <Box flexGrow={1}>
        <Text bold>{L.title} </Text>
        {snap?.root ? <Text dimColor>[{snap.root.split(/[\\/]/).filter(Boolean).pop() ?? snap.root}] </Text> : null}
        {snap ? (
          <Text color={LOOP_COLOR[snap.loop] ?? 'subtle'}>
            ● {L.loop[snap.loop]}
            {snap.stopRequested && snap.loop === 'running' ? L.stopAfter : ''}
            {snap.loop === 'stale' ? L.staleHint : ''}
          </Text>
        ) : null}
      </Box>
      <Button key="refresh" hotkey="r" label={L.refresh} onPress={() => refresh($)} />
    </Box>
  )

  if (!snap) {
    return (
      <Box flexDirection="column" width={cols}>
        {header}
        <Text dimColor>{L.loading}</Text>
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
  const [agentList, filterKey, opened] = await Promise.all([read($, agents), read($, filter), read($, openTask)])
  const active = FILTERS.find(f => f.key === filterKey) ?? FILTERS[0]!
  const shown = snap.tasks.filter(active.match)
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
      <Rule els={els} cols={cols} />

      <Box flexWrap="wrap">
        <Stat els={els} label={L.stats.completion} value={percent(m.completionRate)} color="success" />
        <Stat els={els} label={L.stats.delivery} value={percent(m.deliveryRate)} color="claude" />
        <Stat els={els} label={L.stats.firstPass} value={percent(m.firstPassRate)} color={m.firstPassRate === null ? undefined : 'success'} />
        <Stat els={els} label={L.stats.delivered7d} value={`${m.delivered7d}`} color="claude" />
        <Stat els={els} label={L.stats.medianCycle} value={duration(m.medianCycleMs)} />
        <Stat els={els} label={L.stats.wip} value={`${c['进行中'] ?? 0}`} color={(c['进行中'] ?? 0) > 1 ? 'error' : 'success'} />
        <Stat els={els} label={L.stats.verify} value={`${c['待验证'] ?? 0}`} color={c['待验证'] ? 'warning' : undefined} />
        <Stat els={els} label={L.stats.archived} value={`${c.archived}`} />
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
        shown.map(t => taskRow($, els, t, opened === t.id, snap.current?.task === t.id))
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
                <Text color="warning">{d.task}</Text> {d.question}
              </Text>
              <Text dimColor wrap="wrap">
                {d.options}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {snap.humanBlocks.filter(b => !/已解决|已完成|关闭/.test(b.status)).length ? (
        <Box flexDirection="column">
          <Rule els={els} cols={cols} />
          <Heading els={els} title={L.humanBlocks} />
          {snap.humanBlocks
            .filter(b => !/已解决|已完成|关闭/.test(b.status))
            .map((b, i) => (
              <Box key={`human:${b.id}:${i}`}>
                <Text wrap="wrap">
                <Text color="error">{b.id}</Text> {b.desc} <Text dimColor>→ {b.blocks}</Text>
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
              <Text dimColor>{e.time.slice(5, 16)} </Text>
              <Text color={e.subject === 'STOP' ? 'error' : e.subject === 'START' ? 'success' : 'claude'}>{e.subject} </Text>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
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

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await ensureLang($, options, { force: true, quick: true })
    await $.command.register({
      name: 'task-dash',
      description: L.cmdDescription,
      argumentHint: '[inline|off|on]',
    })
    $.clock.every(REFRESH_MS, () => void refresh($))
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'task-dash' }, async ($, e) => {
    const arg = e.args.trim()
    await ensureLang($, options)
    if (arg === 'off' || arg === 'on') {
      await update($, statusHidden, () => arg === 'off')
      lastStatus = '\u0000'
      await showStatus($, await read($, snapshot), await $.clock.now())
      return { text: arg === 'off' ? L.statusOff : L.statusOn }
    }
    await refresh($)
    const canDock = e.presentation.isFullscreen && e.presentation.columns >= DOCK_MIN_COLUMNS
    if (!canDock && arg !== 'inline') {
      const why = e.presentation.isFullscreen
        ? L.narrow(e.presentation.columns, DOCK_MIN_COLUMNS)
        : L.notFullscreen
      return { text: L.notOpened(why) }
    }
    await $.ui.open({ id: PANE, title: L.title, focus: true })
    return { text: canDock ? L.openedDock : L.openedInline }
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
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
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, agents, list => {
      const row = list.find(a => a.id === e.agent_id)
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
    void refresh($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    return drawPane($, els, Math.max(20, e.props.bodyColumns))
  })
}
