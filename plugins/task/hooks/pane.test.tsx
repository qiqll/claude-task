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
  expect(narrow?.text).toContain('一次性快照')
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
