import { expect, test } from 'claude-code/testing'

import { BACKLOG, CURRENT, PROGRESS, RUN_LOG } from './fixtures'

const FILES: Record<string, string> = {
  '/proj/.claude/backlog.md': BACKLOG,
  '/proj/.claude/dev-progress.md': PROGRESS,
  '/proj/.claude/auto/current': CURRENT,
  '/proj/.claude/auto/run.log': RUN_LOG,
}

const RUN = {
  command: 'task-dash',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

const PANE_PROPS = {
  title: '任务流水线',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

test('pane draws the pool and filters on every surface', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/proj/backend' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  on('fs.exists', (_$, e) => ({ value: e.path in FILES }))
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '(\n    "zh-Hans-CN"\n)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'en_US.UTF-8' : undefined }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const text = FILES[e.path]
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })

  expect(await $.command.run(RUN)).toMatchObject({ text: expect.stringContaining('右侧打开') })
  // The summary sits under the prompt, not above it.
  expect(statuses.at(-1)).toContain('T-071 人工放行池管理')
  expect(statuses.at(-1)).toContain('待验证 1')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task', surface, component: 'Pane', requestId: 'task-dash', props: PANE_PROPS })
    // Root found from a subdirectory; current task and loop state shown.
    expect(await ui.find({ type: 'Text', text: /运行中/ })).toBeDefined()
    // The pane names the project whose pool it shows (found above cwd here).
    expect(await ui.find({ type: 'Text', text: '[proj] ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /人工放行池管理/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /超限怎么处理/ })).toBeDefined()
    // Default filter is 活跃: the 待开始 task is hidden until 全部.
    expect(await ui.find({ type: 'Text', text: '想法' })).toBeUndefined()
    await ui.press({ key: 'filter:all' })
    expect(await ui.find({ type: 'Text', text: '想法' })).toBeDefined()
    await ui.press({ key: 'filter:active' })
    // Expanding a row shows its acceptance criteria.
    await ui.press({ key: 'task:T-071' })
    expect(await ui.find({ type: 'Text', text: /验收：pytest/ })).toBeDefined()
    await ui.press({ key: 'task:T-071' })
    await ui.unmount()
  }
})

test('pane says how to start when there is no pool', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/empty' }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '(\n    "zh-Hans"\n)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('env.get', () => ({ value: undefined }))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'task', surface: 'terminal', component: 'Pane', requestId: 'task-dash', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: /task:init/ })).toBeDefined()
  await ui.unmount()
})

test('without a dock the command does not open an inline pane over the transcript', async ($, on) => {
  const opened: string[] = []
  on('session.cwd', () => ({ value: '/proj' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  on('fs.exists', (_$, e) => ({ value: e.path in FILES }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (FILES[e.path] === undefined ? { deny: 'ENOENT' } : { value: FILES[e.path]! }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  const narrow = await $.command.run({ ...RUN, presentation: { isFullscreen: false, columns: 200 } })
  // Without a dock the whole dashboard is printed into the transcript.
  expect(narrow).toMatchObject({ text: expect.stringContaining('■ 当前任务') })
  expect(narrow?.text).toContain('T-071 人工放行池管理')
  expect(narrow?.text).toContain('超限怎么处理')
  expect(narrow?.text).toContain('想法')
  expect(narrow?.text).toContain('当前不是全屏布局')
  const thin = await $.command.run({ ...RUN, presentation: { isFullscreen: true, columns: 90 } })
  expect(thin?.text).toContain('终端只有 90 列')
  // report prints the snapshot even where the pane could dock; spacing and case are loose.
  const report = await $.command.run({ ...RUN, args: '  Report   ALL ' })
  expect(report?.text).toContain('■ 任务')
  expect(report?.text).not.toContain('一次性快照')
  expect(opened).toEqual([])
  expect(opened).toEqual([])
  await $.command.run({ ...RUN, args: 'inline', presentation: { isFullscreen: false, columns: 200 } })
  expect(opened).toEqual(['task-dash'])
})

test('an English system draws the pane and status line in English', async ($, on) => {
  const statuses: (string | undefined)[] = []
  on('session.cwd', () => ({ value: '/proj' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  on('fs.exists', (_$, e) => ({ value: e.path in FILES }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (FILES[e.path] === undefined ? { deny: 'ENOENT' } : { value: FILES[e.path]! }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  // System says English even though LANG says Chinese: the system wins.
  on('process.run', () => ({ value: { exitCode: 0, stdout: '(\n    "en-US"\n)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  expect(await $.command.run(RUN)).toMatchObject({ text: expect.stringContaining('opened on the right') })
  expect(statuses.at(-1)).toContain('Task Pipeline ● Running')
  expect(statuses.at(-1)).toContain('To verify 1')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'task', surface, component: 'Pane', requestId: 'task-dash', props: PANE_PROPS })
    expect(await ui.find({ type: 'Text', text: 'Current task' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / In progress/ })).toBeDefined()
    // Pool data stays as written.
    expect(await ui.find({ type: 'Text', text: /人工放行池管理/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the language setting overrides the system', { options: { language: 'en' } }, async ($, on) => {
  on('session.cwd', () => ({ value: '/empty' }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '("zh-Hans")', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('env.get', () => ({ value: 'zh_CN.UTF-8' }))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'task', surface: 'terminal', component: 'Pane', requestId: 'task-dash', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: /task:init to create/ })).toBeDefined()
  await ui.unmount()
})

test('the report caps the task list and speaks the UI language', async ($, on) => {
  const rows = Array.from({ length: 20 }, (_, i) => `| T-2${String(i).padStart(2, '0')} | 任务${i} | 后端 | 待开始 | — | — |`).join('\n')
  const backlog = `## P2 — 增强\n\n| ID | 任务 | 模块 | 状态 | 依赖 | 备注 |\n|--|--|--|--|--|--|\n${rows}\n`
  on('session.cwd', () => ({ value: '/big' }))
  on('clock.now', () => ({ value: 0 }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/big/.claude/backlog.md' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (e.path === '/big/.claude/backlog.md' ? { value: backlog } : { deny: 'ENOENT' }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'en_US.UTF-8' : undefined }))
  const short = await $.command.run({ ...RUN, args: 'report' })
  expect(short?.text).toContain('■ Tasks 20')
  expect(short?.text).toContain('… 5 more')
  const all = await $.command.run({ ...RUN, args: 'report all' })
  expect(all?.text).toContain('T-219')
  expect(all?.text).not.toContain('more,')
})

test('direct subagents show while no loop runs, and a missed stop does not stick', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let agentStatus = 'running'
  const idle = { ...FILES }
  // No loop at all: no worker, no run log.
  delete idle['/proj/.claude/auto/current']
  delete idle['/proj/.claude/auto/run.log']
  on('session.cwd', () => ({ value: '/proj' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  on('fs.exists', (_$, e) => ({ value: e.path in idle }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (idle[e.path] === undefined ? { deny: 'ENOENT' } : { value: idle[e.path]! }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'review diff', type: 'code-reviewer', status: agentStatus as 'running' }],
  }))
  on('classic.SubagentStart', () => ({}))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  await $.command.run(RUN)
  expect(statuses.at(-1)).not.toContain('子代理')
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'code-reviewer' })
  expect(statuses.at(-1)).toContain('子代理 1 个运行中')
  const ui = await $.ui.mount({ plugin: 'task', surface: 'terminal', component: 'Pane', requestId: 'task-dash', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: /子代理 1 个运行中/ })).toBeDefined()
  await ui.unmount()
  expect((await $.command.run({ ...RUN, args: 'report' }))?.text).toContain('子代理 1 个运行中')
  // A teammate waiting for a message is not work under way.
  agentStatus = 'idle'
  await $.command.run({ ...RUN, args: 'report' })
  expect(statuses.at(-1)).not.toContain('子代理')
  agentStatus = 'running'
  await $.command.run({ ...RUN, args: 'report' })
  expect(statuses.at(-1)).toContain('子代理 1 个运行中')
  // The engine says it is over though no SubagentStop arrived: the next read settles it.
  agentStatus = 'completed'
  await $.command.run({ ...RUN, args: 'report' })
  expect(statuses.at(-1)).not.toContain('子代理')
})

test('a subagent dropped from the engine list without a stop is settled, even when the pool read fails', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let t = new Date(2026, 10, 15, 12, 0, 0).getTime()
  let listed = true
  on('session.cwd', () => ({ value: '/proj' }))
  on('clock.now', () => ({ value: t }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('agent.list', () => ({ value: listed ? [{ id: 'a1', description: 'x', type: 'Explore', status: 'running' as const }] : [] }))
  on('classic.SubagentStart', () => ({}))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  await $.command.run(RUN)
  await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
  // No pool here: the status line still says work is under way.
  expect(statuses.at(-1)).toContain('子代理 1 个运行中')
  // Gone from the list, but too young to be judged missing.
  listed = false
  await $.command.run({ ...RUN, args: 'report' })
  expect(statuses.at(-1)).toContain('子代理 1 个运行中')
  t += 10_000
  await $.command.run({ ...RUN, args: 'report' })
  expect(statuses.at(-1)).toBeUndefined()
})

test('a failed first read is shown, not left as loading, and the status line says the data is stale', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let broken = true
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  on('fs.exists', (_$, e) => ({ value: e.path in FILES }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (FILES[e.path] === undefined ? { deny: 'ENOENT' } : { value: FILES[e.path]! }))
  // The first read fails outright (the engine refuses the cwd), then recovers.
  on('session.cwd', () => (broken ? { deny: 'cwd unavailable' } : { value: '/proj' }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('agent.list', () => ({ value: [] }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  const first = await $.command.run({ ...RUN, args: 'report' })
  expect(first?.text).toContain('cwd unavailable')
  expect(first?.text).not.toContain('加载任务池')
  expect(statuses.at(-1)).toContain('⚠ 读取失败')
  const ui = await $.ui.mount({ plugin: 'task', surface: 'terminal', component: 'Pane', requestId: 'task-dash', props: PANE_PROPS })
  expect(await ui.find({ type: 'Text', text: /cwd unavailable/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '加载任务池…' })).toBeUndefined()
  // Retry from the pane once the cause is gone: the pool shows, the warning leaves.
  broken = false
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /人工放行池管理/ })).toBeDefined()
  await ui.unmount()
  expect(statuses.at(-1)).toContain('待验证 1')
  expect(statuses.at(-1)).not.toContain('⚠')
})

test('a hidden status line stays hidden on a failed read, and the timer starts once without session.start', async ($, on) => {
  const statuses: (string | undefined)[] = []
  let timers = 0
  on('session.cwd', () => ({ deny: 'cwd unavailable' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  // A refused period ends the interval, so each count is one start.
  on('clock.every', () => {
    timers++
    return { deny: 'no timers in tests' }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('agent.list', () => ({ value: [] }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  await $.command.run({ ...RUN, args: 'off' })
  await $.command.run({ ...RUN, args: 'report' })
  expect(statuses.length).toBeGreaterThan(0)
  expect(statuses.every(t => t === undefined)).toBe(true)
  expect(timers).toBe(1)
})

test('the pane frames the current task and shows metrics as tiles only where labels fit', async ($, on) => {
  on('session.cwd', () => ({ value: '/proj' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  on('fs.exists', (_$, e) => ({ value: e.path in FILES }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (FILES[e.path] === undefined ? { deny: 'ENOENT' } : { value: FILES[e.path]! }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run(RUN)
  // 中位周期 / 一次通过 take 8 cells; a tile adds 3 of chrome, so four tiles need 44 columns.
  for (const [cols, tiled] of [[80, true], [44, true], [43, false], [20, false]] as const) {
    const ui = await $.ui.mount({ plugin: 'task', surface: 'terminal', component: 'Pane', requestId: 'task-dash', props: { ...PANE_PROPS, bodyColumns: cols } })
    const boxes = await ui.findAll({ type: 'Box' })
    // The current task sits in an accent-framed card at any width.
    expect(boxes.some(b => b.props.borderStyle === 'round' && b.props.borderColor === 'claude')).toBe(true)
    const tiles = boxes.filter(b => b.props.borderStyle === 'round' && b.props.borderColor === 'subtle')
    expect(tiles).toHaveLength(tiled ? 8 : 0)
    // Every label is drawn whole either way.
    for (const label of ['完成率', '一次通过', '中位周期', '已归档']) expect(await ui.find({ type: 'Text', text: label })).toBeDefined()
    // The running task's status is a filled tag with dark text; a status with no colour is a plain tag.
    const tags = await ui.findAll({ type: 'Text', text: /进行中/ })
    expect(tags.some(t => t.props.backgroundColor === 'claude' && t.props.color === 'black')).toBe(true)
    await ui.unmount()
  }
  await $.command.run({ ...RUN, args: '' })
  const ui = await $.ui.mount({ plugin: 'task', surface: 'terminal', component: 'Pane', requestId: 'task-dash', props: PANE_PROPS })
  await ui.press({ key: 'filter:all' })
  const todo = await ui.findAll({ type: 'Text', text: / 待开始 / })
  expect(todo.some(t => t.props.color === 'subtle' && t.props.backgroundColor === undefined)).toBe(true)
  await ui.unmount()
})

test('on a narrow pane a status tag stays one line and the title gives way; no refresh button', async ($, on) => {
  on('session.cwd', () => ({ value: '/proj' }))
  on('clock.now', () => ({ value: new Date(2026, 10, 15, 12, 0, 0).getTime() }))
  on('fs.exists', (_$, e) => ({ value: e.path in FILES }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (FILES[e.path] === undefined ? { deny: 'ENOENT' } : { value: FILES[e.path]! }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', () => ({ deny: 'not macOS' }))
  on('env.get', (_$, e) => ({ value: e.name === 'LANG' ? 'zh_CN.UTF-8' : undefined }))
  on('agent.list', () => ({ value: [] }))
  await $.command.run(RUN)
  // ~46 columns is where 待验证 used to wrap a character to a line.
  for (const cols of [46, 30, 80]) {
    const ui = await $.ui.mount({ plugin: 'task', surface: 'terminal', component: 'Pane', requestId: 'task-dash', props: { ...PANE_PROPS, bodyColumns: cols } })
    // The pane re-reads by itself: no refresh button in the heading.
    expect(await ui.find({ key: 'refresh' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /刷新/ })).toBeUndefined()
    for (const id of ['T-071', 'T-107']) {
      const tag = await ui.find({ key: `tag:${id}` })
      expect(tag?.props.flexShrink).toBe(0)
      // The ID and priority keep their width too; only the title shrinks.
      expect((await ui.find({ key: `lead:${id}` }))?.props.flexShrink).toBe(0)
      const title = await ui.find({ key: `title:${id}` })
      expect(title?.props.flexShrink).toBe(1)
      expect(title?.props.minWidth).toBe(0)
    }
    // The tag's text is whole, on one line.
    const tag = await ui.find({ key: 'tag:T-107' })
    expect(tag?.text).toContain(' 待验证 ')
    expect(tag?.text).not.toContain('\n')
    await ui.unmount()
  }
})
