import { expect, mock, test } from 'claude-code/testing'

const PROPS: any = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: {}, view: {} }

const usage = (tokens: number) => ({
  startedAt: 0,
  rateLimits: [],
  context: {
    tokens,
    window: 1000000,
    percent: Math.round(tokens / 10000),
    breakdown: {
      categories: [
        { name: 'Messages', tokens: tokens - 40000, color: '', isDeferred: false, kind: 'used' },
        { name: 'System tools', tokens: 40000, color: '', isDeferred: false, kind: 'used' },
        { name: 'Free space', tokens: 500000, color: '', isDeferred: false, kind: 'free' },
      ],
      totalTokens: tokens,
      isAutoCompactEnabled: true,
      autoCompactThreshold: 967000,
    },
  },
})

const setup = ($: any, on: any, tokens: number) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  const commands: string[] = []
  on('session.usage', () => ({ value: usage(tokens) }))
  on('ui.render', ($$: any, e: any) => { const { Box } = $$.ui.resolve(e); return <Box /> })
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('command.run', (_$: any, e: any) => {
    commands.push(e.command)
    return { text: '' }
  })
  on('tool.call', () => {
    const out = 'Created handoff: /Users/x/Works/tada/.claude/handoffs/2026-10-05-143022-context-guard.md'
    return { result: { stdout: out, stderr: '', interrupted: false }, text: out }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  return commands
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band past the line, handoff path, clear (${surface})`, { options: { lineTokens: 350000 } }, async ($: any, on: any) => {
    const commands = setup($, on, 370000)
    await $.session.measure({ context: { tokens: 370000, window: 1000000, percent: 37 }, rateLimits: [], changed: [] })

    const band = await $.ui.mount({ plugin: 'context-guard', surface, component: 'AbovePrompt', props: PROPS })
    expect((await band.find({ text: /20k past your line/ }))?.text).toContain('auto-compact at 967k')
    expect((await band.find({ text: /biggest: Messages/ }))?.text).toContain('Messages 89%')

    if (surface === 'desktop') {
      const svg = await band.find({ type: 'Svg' })
      expect(svg?.props.width).toBeUndefined()
      expect(svg?.props.height).toBe(10)
      expect(String(svg?.props.source)).toContain('viewBox="0 0 1000 10"')
    }

    await band.press({ key: 'handoff' })
    expect(commands).toContain('creating-handoffs')

    await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'python scripts/create_handoff.py context-guard' })
    await band.redraw({ ...PROPS, isWorking: true })
    expect((await band.find({ text: /Writing handoff/ }))?.text).toContain('.claude/handoffs/')
    expect(await band.find({ key: 'clear' })).toBeUndefined()

    await band.redraw(PROPS)
    expect((await band.find({ text: /Handoff saved/ }))?.text).toContain('.claude/handoffs/2026-10-05-143022-context-guard.md')

    await band.press({ key: 'clear' })
    expect(commands).toContain('clear')

    await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} })
    await band.redraw(PROPS)
    expect(await band.find({ text: /Handoff saved|past your line/ })).toBeUndefined()
  })
}
