import { expect, mock, test } from 'claude-code/testing'

const T0 = Date.parse('2026-10-05T10:00:00Z')
const DIR = '/home/galih/.claude/session-board'
const PROPS: any = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: {}, view: {} }

const card = (id: string, over: Record<string, unknown>) => ({
  v: 1, id, folder: id, title: null, goal: null, isGoalPinned: false, now: null, next: null, you: null,
  state: 'idle', waitingOn: null, since: T0, heartbeat: T0, summarizedAt: T0, isSummaryStale: false, ...over,
})

const setup = (on: any, reply = '') => {
  mock.store(on)
  mock.env(on, { HOME: '/home/galih' })
  const clock = mock.clock(on, { now: T0 })
  const files = new Map<string, string>()
  const put = (c: any) => files.set(`${DIR}/card-${c.id}.json`, JSON.stringify(c))
  put(card('idle-one', { title: 'loyalty · XP reward', since: T0 - 600_000 }))
  put(card('worker', { title: 'runners · lib mirror', state: 'working', since: T0 - 60_000, now: 'hashing lib/ against bridge' }))
  put(card('asker', { title: 'bridge · SIKA PH split', state: 'waiting', waitingOn: 'approve Bash', since: T0 - 300_000 }))
  put(card('gone', { title: 'old session', heartbeat: T0 - 3600_000 }))
  const statuses: (string | undefined)[] = []

  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: '/Users/galih/Works/tada' }))
  on('session.messages', () => ({ value: [
    { role: 'user', text: 'triage the SIKA PH points split QA finding', toolUses: [] },
    { role: 'assistant', text: 'Root cause found. Should I open the MR on develop?', toolUses: [{ name: 'Bash' }] },
  ] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: reply, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('fs.write', (_$: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.read', (_$: any, e: any) => {
    if (!files.has(e.path)) throw new Error('ENOENT')
    return { value: files.get(e.path) }
  })
  on('fs.list', (_$: any, e: any) => ({
    value: [...files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => ({
      name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: JSON.parse(files.get(p)!).heartbeat ?? T0, isLink: false,
    })),
  }))
  on('ui.status', (_$: any, e: any) => { statuses.push(e.text); return { value: undefined } })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.render', ($$: any, e: any) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  on('command.register', () => ({ value: undefined }))
  on('session.start', (_$: any, e: any) => e)
  on('classic.Stop', (_$: any, e: any) => ({}))

  return { clock, files, statuses }
}

const start = async ($: any) => {
  await $.session.start({ cwd: '/Users/galih/Works/tada', surface: null, isInteractive: false })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`strip orders sessions, flags the one that needs you, Seen quiets it (${surface})`, async ($: any, on: any) => {
    const { files } = setup(on)
    await start($)

    const strip = await $.ui.mount({ plugin: 'session-board', surface, component: 'AbovePrompt', props: PROPS })
    const pills = (await strip.findAll({ type: 'Text', text: /·|old session|loyalty|runners|bridge|tada/ })).map((n: any) => n.text)
    const at = (s: string) => pills.findIndex((t: string) => t.includes(s))
    // Needs you, then working, then idle, then stale, this session last
    expect(at('bridge · SIKA PH split')).toBeLessThan(at('runners · lib mirror'))
    expect(at('runners · lib mirror')).toBeLessThan(at('loyalty · XP reward'))
    expect(at('loyalty · XP reward')).toBeLessThan(at('old session'))
    expect(at('old session')).toBeLessThan(at('tada · you'))

    expect((await strip.find({ text: /↳/ }))?.text).toContain('bridge · SIKA PH split: approve Bash')
    await strip.press({ key: 'seen-asker' })
    expect(JSON.parse(files.get(`${DIR}/marks-asker.json`)!).seenSince).toBe(T0 - 300_000)
    await strip.redraw(PROPS)
    expect(await strip.find({ text: /↳/ })).toBeUndefined()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`board pane shows cards, dims stale ones, dismiss hides a card (${surface})`, async ($: any, on: any) => {
    const { files } = setup(on)
    await start($)
    await $.command.run({ command: 'board', args: '' })

    const pane = await $.ui.mount({ plugin: 'session-board', surface, component: 'Pane', requestId: 'session-board', props: {} as any })
    expect((await pane.find({ text: /needs you · 5m ago/ }))?.text).toBeDefined()
    expect((await pane.find({ text: /hashing lib\/ against bridge/ }))?.text).toBeDefined()
    expect((await pane.find({ text: /stale · 1h ago/ }))?.text).toBeDefined()
    expect((await pane.find({ text: /this session/ }))?.text).toBeDefined()

    await pane.press({ key: 'dismiss-gone' })
    expect(JSON.parse(files.get(`${DIR}/marks-gone.json`)!).isDismissed).toBe(true)
    await pane.redraw({} as any)
    expect(await pane.find({ text: /old session/ })).toBeUndefined()
  })
}

test('a reply asking Galih something turns the card to waiting with the summary', async ($: any, on: any) => {
  const reply = '{"title":"bridge · SIKA PH split","goal":"Fix the SIKA PH points split QA finding","now":"Root cause found in disbursement","next":"Open the MR on develop","you":"Approve opening the MR on develop"}'
  const { files, clock, statuses } = setup(on, reply)
  await start($)
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Root cause found. Should I open the MR on develop?' })
  await clock.settle()

  const mine = JSON.parse(files.get(`${DIR}/card-me.json`)!)
  expect(mine.state).toBe('waiting')
  expect(mine.waitingOn).toBe('Approve opening the MR on develop')
  expect(mine.goal).toBe('Fix the SIKA PH points split QA finding')
  expect(statuses.at(-1)).toBe('now: Root cause found in disbursement · next: Open the MR on develop')
})

test('an unreadable summary keeps the old card and marks it stale', async ($: any, on: any) => {
  const { files, clock } = setup(on, 'sorry, no JSON here')
  await start($)
  await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done?' })
  await clock.settle()

  const mine = JSON.parse(files.get(`${DIR}/card-me.json`)!)
  expect(mine.isSummaryStale).toBe(true)
  expect(mine.state).toBe('idle')
})

test('board.html lists the session that needs you first and escapes card text', async ($: any, on: any) => {
  const { files } = setup(on)
  files.set(`${DIR}/card-odd.json`, JSON.stringify(card('odd', { title: 'fix <script> tag', state: 'working', since: T0 - 30_000 })))
  await start($)
  await $.command.run({ command: 'board', args: 'goal pin it' })

  const page = files.get(`${DIR}/board.html`)!
  expect(page.indexOf('bridge · SIKA PH split')).toBeLessThan(page.indexOf('runners · lib mirror'))
  expect(page).toContain('fix &lt;script&gt; tag')
  expect(page).not.toContain('fix <script> tag')
  expect(page).toContain('approve Bash')
})
