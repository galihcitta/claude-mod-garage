import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Gauge } from '../types'

const gauge = atom({ plugin: 'context-guard', key: 'gauge' } as const, null)
const snooze = atom({ plugin: 'context-guard', key: 'snooze' } as const, 0)
const samples = atom({ plugin: 'context-guard', key: 'samples' } as const, [])
const lastTurnTokens = atom({ plugin: 'context-guard', key: 'lastTurnTokens' } as const, null)
const autoAt = atom({ plugin: 'context-guard', key: 'autoAt' } as const, null)
const eater = atom({ plugin: 'context-guard', key: 'eater' } as const, null)
const isPast = atom({ plugin: 'context-guard', key: 'isPast' } as const, false)
const isQueued = atom({ plugin: 'context-guard', key: 'isQueued' } as const, false)
const isHandoffPending = atom({ plugin: 'context-guard', key: 'isHandoffPending' } as const, false)
const handoffPath = atom({ plugin: 'context-guard', key: 'handoffPath' } as const, null)

const GREEN = '#1D9E75'
const AMBER = '#EF9F27'
const CORAL = '#D85A30'
const RED = '#E24B4A'
const TRACK = '#888780'
const LOG_KEY = 'log'
const HANDOFF_RE = /\.claude\/handoffs\/[\w.-]+\.md/

const k = (n: number) => `${Math.round(n / 1000)}k`

type Opts = { line: number; margin: number; step: number; instructions: string }

type Runway = { turns: number | null; target: 'line' | 'auto' }

async function log($: any, action: string) {
  const g: Gauge | null = await read($, gauge)
  const prior = ((await $.store.get(LOG_KEY)) as unknown[] | undefined) ?? []
  const row = { at: await $.clock.now(), action, tokens: g?.tokens ?? null, line: g?.line ?? null }
  await $.store.set(LOG_KEY, [...prior, row].slice(-300))
}

async function learnAutoAt($: any) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  const at = b && b.isAutoCompactEnabled && b.autoCompactThreshold ? b.autoCompactThreshold : null
  // 0 records "auto-compact is off" so it is not looked up again on every response
  await update($, autoAt, () => at ?? 0)

  return at
}

async function learnEater($: any) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b || b.totalTokens <= 0) return
  const used = b.categories.filter((c: any) => c.kind === 'used')
  const top = used.reduce((a: any, c: any) => (c.tokens > a.tokens ? c : a), used[0])
  if (!top) return
  await update($, eater, () => `${top.name} ${Math.round((top.tokens / b.totalTokens) * 100)}%`)
}

async function runway($: any, g: Gauge): Promise<Runway> {
  const target = g.tokens < g.line ? 'line' : 'auto'
  const goal = target === 'line' ? g.line : g.autoAt
  const list: number[] = await read($, samples)
  if (goal === null || list.length < 2) return { turns: null, target }
  const burn = list.reduce((a, b) => a + b, 0) / list.length
  if (burn <= 0) return { turns: null, target }

  return { turns: Math.max(0, Math.floor((goal - g.tokens) / burn)), target }
}

function statusText(g: Gauge | null) {
  if (!g) return 'ctx —'
  if (g.tokens >= g.line) return `▲ ctx ${k(g.tokens)} · past your ${k(g.line)} line`
  if (g.tokens >= g.warnFrom) return `◆ ctx ${k(g.tokens)} · ${k(g.line - g.tokens)} to your line`
  const filled = Math.min(8, Math.round((g.tokens / g.line) * 8))

  return `ctx ${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)} ${k(g.tokens)}`
}

async function refresh($: any, opts: Opts, tokens: number | undefined) {
  if (tokens === undefined) {
    await update($, gauge, () => null)
    $.ui.status(statusText(null))
    return
  }
  const known: number | null = await read($, autoAt)
  const at = known === null ? await learnAutoAt($) : known || null
  const base = at === null ? opts.line : Math.min(opts.line, at - opts.margin)
  const line = base + (await read($, snooze))
  const g: Gauge = { tokens, line, warnFrom: line - opts.margin, autoAt: at }
  await update($, gauge, () => g)
  $.ui.status(statusText(g))

  const wasPast = await read($, isPast)
  const nowPast = tokens >= line
  if (nowPast && !wasPast) {
    $.ui.toast(`Context ${k(tokens)}, past your ${k(line)} line`)
    await learnEater($)
    await log($, 'crossed')
  }
  if (nowPast !== wasPast) await update($, isPast, () => nowPast)
}

async function resetAfterCompact($: any) {
  await update($, samples, () => [])
  await update($, lastTurnTokens, () => null)
  await update($, snooze, () => 0)
  await update($, eater, () => null)
  await update($, isPast, () => false)
  await update($, isQueued, () => false)
  await update($, autoAt, () => null)
}

async function compact($: any, opts: Opts) {
  try {
    const done = await $.session.compact({ instructions: opts.instructions })
    if (done.skip) $.ui.toast('Compact was vetoed by another hook')
    await log($, 'compact')
  } catch {
    await update($, isQueued, () => true)
    await log($, 'compact-queued')
  }
}

async function handoff($: any) {
  try {
    await $.command.run({ command: 'creating-handoffs' })
    await update($, isHandoffPending, () => true)
    await log($, 'handoff')
  } catch {
    $.ui.toast('Could not start /creating-handoffs')
  }
}

export const register: Register = (on, options) => {
  const opts: Opts = {
    line: Number(options.lineTokens ?? 350000),
    margin: Number(options.marginTokens ?? 50000),
    step: Number(options.snoozeTokens ?? 50000),
    instructions: String(options.compactInstructions ?? ''),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-guard-log', description: 'Show the last context-guard actions (for tuning the line)' })
    const { context } = await $.session.usage()
    await refresh($, opts, context.tokens)

    return next(e)
  })

  on('command.run', { command: 'context-guard-log' }, async $ => {
    const rows = ((await $.store.get(LOG_KEY)) as any[] | undefined) ?? []
    if (rows.length === 0) return { text: 'No context-guard actions logged yet.' }
    const lines = rows.slice(-20).map(r => `${new Date(r.at).toISOString().slice(0, 16)}  ${r.action.padEnd(15)} ${r.tokens === null ? '—' : k(r.tokens)} (line ${r.line === null ? '—' : k(r.line)})`)

    return { text: lines.join('\n') }
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await refresh($, opts, e.context.tokens)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const { context } = await $.session.usage()
    const now = context.tokens
    const prev = await read($, lastTurnTokens)
    if (now !== undefined && prev !== null && now > prev) {
      await update($, samples, list => [...list, now - prev].slice(-5))
    }
    await update($, lastTurnTokens, () => now ?? null)
    if (await read($, isQueued)) {
      await update($, isQueued, () => false)
      $.clock.after(0, () => void compact($, opts))
    }

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!result.skip && e.trigger !== 'precompute' && !e.agentId) {
      await resetAfterCompact($)
      await update($, gauge, () => null)
      $.ui.status(statusText(null))
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isHandoffPending)) {
      let seen = ''
      try { seen = JSON.stringify(e) + JSON.stringify(result) } catch {}
      const hit = seen.match(HANDOFF_RE)
      if (hit) {
        await update($, handoffPath, () => hit[0])
        await update($, isHandoffPending, () => false)
      }
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAfterCompact($)
      await update($, handoffPath, () => null)
      await update($, isHandoffPending, () => false)
      await update($, gauge, () => null)
      $.ui.status(statusText(null))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const g: Gauge | null = await read($, gauge)
    const saved: string | null = await read($, handoffPath)
    const queued = await read($, isQueued)
    const { Box, Text, Button, Svg } = $.ui.resolve(e) as any
    const isDesktop = e.surface !== 'terminal'
    // Draw beside other plugins' content in this slot instead of replacing it
    const stack = async (mine: unknown) => (
      <Box flexDirection="column" rowGap={1}>
        {mine}
        {await next(e)}
      </Box>
    )

    if (saved && e.props.isWorking) {
      return stack(<Text dimColor>Writing handoff: {saved}</Text>)
    }

    if (saved) {
      return stack(
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Text color={GREEN}>✓ Handoff saved: {saved}</Text>
          <Button key="clear" label="Clear" hotkey="x" onPress={async () => { await log($, 'clear'); await $.command.run({ command: 'clear' }) }} />
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => update($, handoffPath, () => null)} />
        </Box>
      )
    }

    if (queued) {
      return stack(
        <Box flexDirection="row" gap={1}>
          <Text dimColor>Compact queued. Runs when this turn ends.</Text>
          <Button key="cancel" label="Cancel" hotkey="x" onPress={async () => { await update($, isQueued, () => false); await log($, 'compact-cancel') }} />
        </Box>
      )
    }

    if (!g || g.tokens < g.warnFrom) return next(e)

    const past = g.tokens >= g.line
    const run = await runway($, g)
    const width = Math.max(16, Math.min(40, e.props.bodyColumns - 34))
    const bar = isDesktop ? <Svg source={svgGauge(g)} alt={`Context ${k(g.tokens)} of ${k(g.line)} line`} height={12} /> : textGauge(Text, g, width)
    const turns = run.turns === null ? null : `~${run.turns} turn${run.turns === 1 ? '' : 's'}`

    if (!past) {
      return stack(
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color={AMBER} bold>◆ {k(g.tokens)}</Text>
          <Box flexGrow={1}>{bar}</Box>
          <Text dimColor>{k(g.line - g.tokens)} to your {k(g.line)} line{turns ? ` · ${turns}` : ''}</Text>
        </Box>
      )
    }

    const who: string | null = await read($, eater)
    const detail = [
      `${k(g.tokens - g.line)} past your line`,
      g.autoAt === null ? null : `auto-compact at ${k(g.autoAt)}`,
      who ? `biggest: ${who}` : null,
    ].filter(Boolean).join(' · ')

    return stack(
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color={CORAL} bold>▲ {k(g.tokens)}</Text>
          <Box flexGrow={1}>{bar}</Box>
          {turns && <Text color={CORAL}>{turns} of runway</Text>}
        </Box>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Text dimColor>{detail}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="compact" label="Compact, keep the plan" hotkey="c" onPress={() => compact($, opts)} />
            <Button key="handoff" label="Hand off" hotkey="h" onPress={() => handoff($)} />
            <Button key="snooze" label={`Remind at ${k(g.line + opts.step)}`} hotkey="s" onPress={async () => {
              await update($, snooze, n => n + opts.step)
              await log($, 'snooze')
              await refresh($, opts, g.tokens)
            }} />
          </Box>
        </Box>
      </Box>
    )
  })
}

const scaleOf = (g: Gauge) => g.autoAt ?? Math.max(g.line * 1.15, g.tokens * 1.05)

const colorAt = (g: Gauge, t: number) => (t < g.warnFrom ? GREEN : t < g.line ? AMBER : CORAL)

const textGauge = (Text: any, g: Gauge, width: number) => {
  const max = scaleOf(g)
  const cells: { ch: string; color: string }[] = []
  const lineAt = Math.min(width - 1, Math.round((g.line / max) * width))
  const fillTo = Math.min(width, Math.round((g.tokens / max) * width))
  for (let i = 0; i < width; i++) {
    const t = ((i + 0.5) / width) * max
    if (i === lineAt) cells.push({ ch: '┃', color: '' })
    else if (i === fillTo - 1 && g.tokens >= g.line) cells.push({ ch: '●', color: CORAL })
    else if (i < fillTo) cells.push({ ch: '━', color: colorAt(g, t) })
    else cells.push({ ch: '━', color: TRACK })
  }
  if (g.autoAt !== null) cells.push({ ch: '▌', color: RED })
  const runs: { text: string; color: string }[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === c.color) last.text += c.ch
    else runs.push({ text: c.ch, color: c.color })
  }

  return (
    <Text>
      {runs.map(r => (r.color === TRACK ? <Text dimColor>{r.text}</Text> : r.color ? <Text color={r.color}>{r.text}</Text> : <Text>{r.text}</Text>))}
    </Text>
  )
}

const svgGauge = (g: Gauge) => {
  const W = 1000
  const max = scaleOf(g)
  const x = (t: number) => Math.min(W, Math.max(0, (t / max) * W))
  const seg = (from: number, to: number, color: string) => (to > from ? `<rect x="${x(from)}" y="3" width="${x(to) - x(from)}" height="6" fill="${color}"/>` : '')
  const tick = (t: number, color: string, w: number) => `<rect x="${Math.min(W - w, Math.max(0, x(t) - w / 2))}" y="0" width="${w}" height="12" fill="${color}"/>`
  const now = g.tokens
  const bar = [
    `<rect x="0" y="3" width="${W}" height="6" fill="${TRACK}" fill-opacity="0.22"/>`,
    seg(0, Math.min(now, g.warnFrom), GREEN),
    seg(g.warnFrom, Math.min(now, g.line), AMBER),
    seg(g.line, now, CORAL),
  ].join('')
  const ticks = tick(g.line, TRACK, 3) + (g.autoAt === null ? '' : tick(g.autoAt, RED, 4))

  // width="4000" asks for more than any slot, so the surface caps it to the full row
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} 12" preserveAspectRatio="none" width="4000" height="12">`
    + `<defs><clipPath id="round"><rect x="0" y="3" width="${W}" height="6" rx="3"/></clipPath></defs>`
    + `<g clip-path="url(#round)">${bar}</g>${ticks}</svg>`
}
