/**
 * UI language: the dashboard's own words in Chinese or English. Pool data
 * (titles, notes) is shown as written; status values are translated as labels.
 */
import type { LoopStatus } from '../types'

export type Lang = 'zh' | 'en'

/** One locale tag (`zh-Hans-CN`, `zh_CN.UTF-8`, `en_US`) → a UI language, or null when it says nothing. */
export function langOf(tag: string | undefined | null): Lang | null {
  const t = (tag ?? '').trim().replace(/^"|"$/g, '').toLowerCase()
  if (!t || t === 'c' || t === 'posix' || t.startsWith('c.')) return null
  return t.startsWith('zh') ? 'zh' : 'en'
}

/** The first entry of `defaults read -g AppleLanguages` output, `(\n    "zh-Hans-CN",\n ...)`. */
export function firstAppleLanguage(output: string): string | null {
  return /^\s*"?([A-Za-z]{2,3}[-_A-Za-z0-9]*)"?,?\s*$/m.exec(output.replace(/^\s*\(\s*/, ''))?.[1] ?? null
}

/**
 * The setting wins unless `auto`; then LC_ALL (an explicit override), the OS's
 * own language list (macOS), LC_MESSAGES, LANG, and the runtime's locale.
 * The OS list comes before LANG: a terminal often says `en_US` on a Chinese system.
 * `env` is [LC_ALL, LC_MESSAGES, LANG].
 */
export function pickLang(setting: unknown, sources: { system?: string | null; env: (string | undefined)[]; runtime?: string }): Lang {
  if (setting === 'zh' || setting === 'en') return setting
  const [lcAll, lcMessages, lang] = sources.env
  return langOf(lcAll) ?? langOf(sources.system) ?? langOf(lcMessages) ?? langOf(lang) ?? langOf(sources.runtime) ?? 'en'
}

const STATUS_EN: Record<string, string> = {
  待开始: 'To do',
  进行中: 'In progress',
  待验证: 'To verify',
  待决策: 'Decision',
  阻塞: 'Blocked',
  打回: 'Rejected',
  已完成: 'Done',
  已取消: 'Cancelled',
}

export type Transition = { id: string; kind: 'new' | 'move'; status: string; title: string }

const zh = {
  title: '任务流水线',
  loop: {
    running: '运行中',
    waiting: '循环中·等待任务',
    halted: '已叫停',
    stopped: '已停止',
    idle: '空闲',
    uninitialized: '未初始化',
    stale: '疑似中断',
  } as Record<LoopStatus, string>,
  status: (s: string) => s,
  filters: { active: '活跃', todo: '待开始', verify: '待验证', decision: '待决策', blocked: '阻塞', all: '全部' } as Record<string, string>,
  noCurrent: '当前没有执行中的任务',
  inboxPending: (n: number) => `inbox 待合并 ${n} 条`,
  phase: (p: string) => `阶段 ${p}`,
  elapsed: (d: string) => `已运行 ${d}`,
  baseline: (sha: string) => `基线 ${sha}`,
  noTitle: '（backlog 中未找到标题）',
  halt: (n: string) => `断点：${n}`,
  deps: (d: string) => `依赖 ${d}`,
  derivedFrom: (id: string) => `衍生自 ${id}`,
  acceptance: (a: string) => `验收：${a}`,
  noNote: '无备注',
  agentRunning: '运行中',
  agentDone: '已结束',
  stopAfter: '（本任务后停机）',
  staleHint: '（调度会话可能已退出，说「继续」或 /task:loop 恢复）',
  refresh: '刷新',
  loading: '加载任务池…',
  noPool: '当前工作区（及上级目录）没有 .claude/backlog.md。',
  runInit: '运行 /task:init 初始化任务池。',
  delivered: (done: number, max: number | null) => (max !== null ? `已交付 ${done}/${max}` : `已交付 ${done}`),
  noprog: (n: number) => `无进展 ${n}`,
  currentTask: '当前任务',
  stats: {
    completion: '完成率',
    delivery: '交付率',
    firstPass: '一次通过',
    delivered7d: '7日交付',
    medianCycle: '中位周期',
    wip: 'WIP',
    verify: '待验证',
    archived: '已归档',
  },
  tasks: '任务',
  count: (n: number) => `${n} 条`,
  noneInFilter: '这个筛选下没有任务。',
  decisions: '待决策',
  decisionsExtra: (n: number) => `${n} 条 · 在会话里说「T-0NN 选 A」答复`,
  humanBlocks: '人工阻塞',
  agents: 'Agent',
  runningCount: (n: number) => `${n} 运行中`,
  noAgents: '本会话还没有派发子 agent。/task:loop 派 worker 后会出现在这里。',
  events: '最近流水',
  noEvents: '还没有运行记录。',
  footer: (sec: number) => `只读 · 每 ${sec}s 刷新 · 数据来自 .claude/backlog.md 与 .claude/auto/`,
  readTimeout: (sec: number) => `读取任务池超时（>${sec}s），已放弃本次读取`,
  toast: (t: Transition) => `任务流水线：${t.id} ${t.kind === 'new' ? '新录入' : '→'} ${t.status}：${t.title.slice(0, 40)}`,
  countOf: (status: string, n: number) => `${status} ${n}`,
  cmdDescription: '任务流水线：全屏时右侧面板，否则输出完整快照；report [all] 只输出快照；inline 强制内嵌；off / on 隐藏或恢复状态行',
  statusOff: '已隐藏输入框下方的任务流水线状态行。',
  statusOn: '已恢复输入框下方的任务流水线状态行。',
  narrow: (cols: number, min: number) => `终端只有 ${cols} 列，停靠到右侧至少需要 ${min} 列`,
  notFullscreen: '当前不是全屏布局，面板只能内嵌在输入框上方，会挡住输出',
  notOpened: (why: string) =>
    `${why}，所以没有打开面板。摘要已显示在输入框下方的状态行。\n要右侧停靠：用全屏布局启动（CLAUDE_CODE_NO_FLICKER=1 claude，tmux 里默认不是全屏）并把终端拉宽；仍想内嵌就用 /task-dash inline。`,
  openedDock: '任务流水线面板已在右侧打开（Esc 或 ctrl+x x 关闭）。',
  openedInline: '任务流水线面板已内嵌打开。',
  reportHint: '（非全屏：以上为一次性快照，随对话滚动；全屏布局下 /task-dash 停靠右侧，/task-dash inline 临时内嵌面板）',
  more: (n: number) => `… 另有 ${n} 条，/task-dash report all 查看全部`,
}

export type Strings = typeof zh

const en: Strings = {
  title: 'Task Pipeline',
  loop: {
    running: 'Running',
    waiting: 'Looping · waiting',
    halted: 'Halted',
    stopped: 'Stopped',
    idle: 'Idle',
    uninitialized: 'Not initialized',
    stale: 'Possibly interrupted',
  },
  status: s => STATUS_EN[s] ?? s,
  filters: { active: 'Active', todo: 'To do', verify: 'To verify', decision: 'Decision', blocked: 'Blocked', all: 'All' },
  noCurrent: 'No task is running',
  inboxPending: n => `inbox ${n} to merge`,
  phase: p => `phase ${p}`,
  elapsed: d => `running ${d}`,
  baseline: sha => `base ${sha}`,
  noTitle: '(title not found in backlog)',
  halt: n => `Breakpoint: ${n}`,
  deps: d => `depends on ${d}`,
  derivedFrom: id => `derived from ${id}`,
  acceptance: a => `Acceptance: ${a}`,
  noNote: 'No notes',
  agentRunning: 'running',
  agentDone: 'finished',
  stopAfter: ' (stops after this task)',
  staleHint: ' (dispatcher may have exited; say "continue" or run /task:loop)',
  refresh: 'Refresh',
  loading: 'Loading task pool…',
  noPool: 'No .claude/backlog.md in this workspace or its parents.',
  runInit: 'Run /task:init to create a task pool.',
  delivered: (done, max) => (max !== null ? `delivered ${done}/${max}` : `delivered ${done}`),
  noprog: n => `no progress ${n}`,
  currentTask: 'Current task',
  stats: {
    completion: 'Done',
    delivery: 'Delivered',
    firstPass: 'First pass',
    delivered7d: '7d delivered',
    medianCycle: 'Median cycle',
    wip: 'WIP',
    verify: 'To verify',
    archived: 'Archived',
  },
  tasks: 'Tasks',
  count: n => `${n}`,
  noneInFilter: 'No tasks under this filter.',
  decisions: 'Decisions',
  decisionsExtra: n => `${n} · answer in chat, e.g. "T-0NN pick A"`,
  humanBlocks: 'Human blockers',
  agents: 'Agents',
  runningCount: n => `${n} running`,
  noAgents: 'No subagents yet this session. Workers sent by /task:loop show up here.',
  events: 'Recent log',
  noEvents: 'No runs logged yet.',
  footer: sec => `Read-only · refreshes every ${sec}s · from .claude/backlog.md and .claude/auto/`,
  readTimeout: sec => `Reading the task pool timed out (>${sec}s); this read was dropped`,
  toast: t => `Task Pipeline: ${t.id} ${t.kind === 'new' ? 'added as' : '→'} ${STATUS_EN[t.status] ?? t.status}: ${t.title.slice(0, 40)}`,
  countOf: (status, n) => `${STATUS_EN[status] ?? status} ${n}`,
  cmdDescription: 'Task pipeline: docked pane in fullscreen, otherwise a full snapshot; report [all] prints the snapshot; inline forces an inline pane; off / on hides or restores the status line',
  statusOff: 'Task pipeline status line hidden.',
  statusOn: 'Task pipeline status line restored.',
  narrow: (cols, min) => `The terminal is ${cols} columns wide; docking needs at least ${min}`,
  notFullscreen: 'Not in the fullscreen layout, so the pane could only sit above the prompt and cover the output',
  notOpened: why =>
    `${why}, so the pane was not opened. The summary is in the status line under the prompt.\nTo dock it on the right, start in the fullscreen layout (CLAUDE_CODE_NO_FLICKER=1 claude; tmux is not fullscreen by default) and widen the terminal; use /task-dash inline to open it inline anyway.`,
  openedDock: 'Task pipeline pane opened on the right (Esc or ctrl+x x closes it).',
  openedInline: 'Task pipeline pane opened inline.',
  reportHint: '(Not fullscreen: this is a one-off snapshot that scrolls with the chat; in the fullscreen layout /task-dash docks on the right, /task-dash inline opens a temporary inline pane)',
  more: n => `… ${n} more, /task-dash report all shows everything`,
}

export const STRINGS: Record<Lang, Strings> = { zh, en }

/** A status as written (`待验证✗验证失败`) in the UI language: base status translated, suffix kept. */
export function statusLabel(s: Strings, base: string, raw: string): string {
  const label = raw || base
  return label.startsWith(base) ? s.status(base) + label.slice(base.length) : s.status(label)
}
