import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Card, Marks, Row, SessionState } from '../types'
import { renderPage } from './page'

// Every session writes its own card to ~/.claude/session-board/card-<id>.json
// on a heartbeat and reads everyone's. There is no cross-session API, so the
// folder is the bus: one file per session (no lost writes), polled every 10 s.
//
// State comes from hooks: a permission prompt is "waiting", the turn ending is
// "idle", any prompt or tool call is "working". The words on the card (title,
// goal, now, next, what it needs from you) come from a small model reading the
// session's own prompts and replies, at most every 2 minutes.

const HEARTBEAT_MS = 10_000
const SUMMARY_EVERY_MS = 120_000
const DROP_AFTER_MS = 24 * 3600_000
const PANE = 'session-board'

const GREEN = '#1D9E75'
const AMBER = '#EF9F27'
const CORAL = '#D85A30'
const GREY = '#888780'

const LOOK: Record<SessionState, { glyph: string; color: string; label: string }> = {
  working: { glyph: '●', color: GREEN, label: 'working' },
  waiting: { glyph: '◉', color: CORAL, label: 'needs you' },
  idle: { glyph: '○', color: GREY, label: 'idle' },
}

const rows = atom({ plugin: 'session-board', key: 'rows' } as const, [])
const clockNow = atom({ plugin: 'session-board', key: 'now' } as const, 0)
const isBoardOpen = atom({ plugin: 'session-board', key: 'isBoardOpen' } as const, false)

type Opts = { model: string; dimAfterMs: number }

// This session's own card; module state is rebuilt from the card file on reload
let me: Card | null = null
let timer: { cancel: () => void } | undefined
let toolsThisTurn = 0
let isSummarizing = false

const dirOf = async ($: any) => `${await $.env.get('HOME')}/.claude/session-board`
const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

// Needs you first (longest wait first), then working (latest first), then idle, then stale; this session last
export const order = (list: Row[]): Row[] => {
  const rank = (r: Row) => (r.isStale ? 3 : r.state === 'waiting' && !r.isSeen ? 0 : r.state === 'working' ? 1 : r.state === 'waiting' ? 0.5 : 2)
  return [...list].sort((a, b) =>
    Number(a.isMe) - Number(b.isMe)
    || rank(a) - rank(b)
    || (a.state === 'waiting' ? a.since - b.since : b.since - a.since))
}

async function loadMe($: any): Promise<Card> {
  if (me) return me
  const dir = await dirOf($)
  const id = await $.session.id()
  const now = await $.clock.now()
  try {
    const saved = JSON.parse(await $.fs.read(`${dir}/card-${id}.json`))
    if (saved?.v === 1) me = saved
  } catch {}
  me ??= {
    v: 1, id, folder: baseName(await $.session.cwd()),
    title: null, goal: null, isGoalPinned: false, now: null, next: null, you: null,
    state: 'idle', waitingOn: null, since: now, heartbeat: now, summarizedAt: null, isSummaryStale: false,
  }
  return me
}

async function writeMe($: any) {
  const card = await loadMe($)
  card.heartbeat = await $.clock.now()
  await $.fs.write(`${await dirOf($)}/card-${card.id}.json`, JSON.stringify(card))
}

async function readMarks($: any, dir: string, id: string): Promise<Marks> {
  try { return JSON.parse(await $.fs.read(`${dir}/marks-${id}.json`)) } catch { return { isDismissed: false, seenSince: null } }
}

async function poll($: any, opts: Opts) {
  await writeMe($)
  const dir = await dirOf($)
  const now = await $.clock.now()
  const entries = await $.fs.list(dir).catch(() => [])
  const out: Row[] = []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.startsWith('card-') || now - f.mtimeMs > DROP_AFTER_MS) continue
    try {
      const card: Card = JSON.parse(await $.fs.read(`${dir}/${f.name}`))
      if (card.v !== 1 || card.isEnded) continue
      const marks = await readMarks($, dir, card.id)
      if (marks.isDismissed) continue
      out.push({ ...card, isMe: card.id === me?.id, isStale: now - card.heartbeat > opts.dimAfterMs, isSeen: marks.seenSince === card.since })
    } catch {}
  }
  const sorted = order(out)
  await update($, rows, () => sorted)
  await update($, clockNow, () => now)
  // The same board as a page; every session writes the same content, so the last writer wins harmlessly
  await $.fs.write(`${dir}/board.html`, renderPage(order(sorted.map(r => ({ ...r, isMe: false }))), opts.dimAfterMs)).catch(() => {})
  showStatus($)
}

function showStatus($: any) {
  if (!me) return
  if (me.now) $.ui.status(clip(`now: ${me.now}${me.next ? ` · next: ${me.next}` : ''}`, 90))
  else $.ui.status(undefined)
}

async function setState($: any, opts: Opts, state: SessionState, waitingOn: string | null) {
  const card = await loadMe($)
  if (card.state === state && card.waitingOn === waitingOn) return
  card.state = state
  card.waitingOn = waitingOn
  card.since = await $.clock.now()
  await poll($, opts).catch(() => {})
}

const SYSTEM = `You keep a one-glance progress card for a coding session so its owner, Galih, can see where it stands without reading the transcript.
Reply with JSON only, no prose, no code fence:
{"title": string, "goal": string, "now": string, "next": string, "you": string | null}
- title: at most 5 words, the repo or epic plus the topic, e.g. "bridge · SIKA PH split".
- goal: at most 12 words, what the whole session is for.
- now: at most 10 words, what the session is doing or just finished.
- next: at most 10 words, the next concrete step.
- you: if the last assistant reply asks Galih a question or needs a decision, approval or input from him, say what in at most 12 words; otherwise null.
Always write in English, even when the session is in Indonesian. Keep ticket and code terms as written. No markdown.`

export const transcriptFor = (messages: { role: string; text: string; toolUses?: { name?: string }[] }[], goal: string | null) => {
  const firstPrompts = messages.filter(m => m.role === 'user' && m.text.trim()).slice(0, 3).map(m => `- ${clip(m.text.trim(), 500)}`)
  const recent = messages.filter(m => m.text.trim()).slice(-10).map(m => `${m.role === 'user' ? 'Galih' : 'Assistant'}: ${clip(m.text.trim(), 600)}`)
  const tools = messages.flatMap(m => (m.toolUses ?? []).map(t => t.name).filter(Boolean)).slice(-5)
  return [
    goal ? `Known goal (keep it): ${goal}` : `Opening prompts (derive the goal from these):\n${firstPrompts.join('\n')}`,
    `Recent conversation, oldest first:\n${recent.join('\n\n')}`,
    tools.length ? `Last tools used: ${tools.join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
}

export const parseCard = (text: string) => {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0])
    const s = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? clip(v.trim(), n) : null)
    return { title: s(j.title, 48), goal: s(j.goal, 120), now: s(j.now, 100), next: s(j.next, 100), you: s(j.you, 120) }
  } catch { return null }
}

async function summarize($: any, opts: Opts) {
  if (isSummarizing) return
  isSummarizing = true
  try {
    const card = await loadMe($)
    const messages = await $.session.messages()
    if (!Array.isArray(messages) || messages.length === 0) return
    const r = await $.model.complete({ model: opts.model, system: SYSTEM, prompt: transcriptFor(messages, card.goal), maxTokens: 300, timeoutMs: 30_000 })
    const got = r.isAnswered ? parseCard(r.text) : null
    card.summarizedAt = await $.clock.now()
    if (!got) {
      card.isSummaryStale = true
      return
    }
    card.isSummaryStale = false
    card.title = got.title ?? card.title
    if (!card.isGoalPinned) card.goal = card.goal ?? got.goal
    card.now = got.now
    card.next = got.next
    card.you = got.you
    // A question in the last reply counts as waiting, unless a permission prompt already says what
    if (card.state === 'idle' && got.you) {
      card.state = 'waiting'
      card.waitingOn = got.you
      card.since = card.summarizedAt
    }
  } finally {
    isSummarizing = false
    await poll($, opts).catch(() => {})
  }
}

async function mark($: any, opts: Opts, id: string, change: Partial<Marks>) {
  const dir = await dirOf($)
  const marks = { ...(await readMarks($, dir, id)), ...change }
  await $.fs.write(`${dir}/marks-${id}.json`, JSON.stringify(marks))
  await poll($, opts)
}

export const register: Register = (on, options) => {
  const opts: Opts = {
    model: String(options.summarizerModel ?? 'haiku'),
    dimAfterMs: Number(options.dimAfterMinutes ?? 10) * 60_000,
  }

  on('session.start', async ($, e, next) => {
    me = null
    await $.command.register({ name: 'board', description: 'Open the session board; `/board goal <text>` pins this session\'s goal; `/board close`' })
    timer?.cancel()
    timer = $.clock.every(HEARTBEAT_MS, () => void poll($, opts).catch(() => {}))
    void poll($, opts).catch(() => {})
    if (await read($, isBoardOpen)) void $.ui.open({ id: PANE, title: 'Sessions' })
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    toolsThisTurn = 0
    await setState($, opts, 'working', null)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // Background loops (subagents, prompt suggestions) carry an agentId and say nothing about the main turn
    if (e.agentId !== undefined) return next(e)
    toolsThisTurn += 1
    // A tool that runs after a permission prompt means the wait is over
    if (me && me.state !== 'working') await setState($, opts, 'working', null)
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    await setState($, opts, 'waiting', `approve ${e.tool_name}`)
    return next(e)
  })

  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt' && me?.state !== 'waiting') await setState($, opts, 'waiting', 'approve a tool')
    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    await setState($, opts, 'idle', null)
    const card = await loadMe($)
    const now = await $.clock.now()
    const isDue = card.summarizedAt === null || now - card.summarizedAt >= SUMMARY_EVERY_MS
    const lastReply = e.last_assistant_message ?? ''
    // Summaries are throttled, but a reply that may be asking Galih something is checked at once
    if ((toolsThisTurn > 0 && isDue) || card.goal === null || lastReply.includes('?')) void summarize($, opts)
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    // The opening prompts are gone after a compaction; derive the goal again from the summary
    if (e.agentId === undefined && me && !me.isGoalPinned) {
      me.goal = null
      void summarize($, opts)
    }
    return done
  })

  on('command.run', { command: 'board' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'close') {
      await update($, isBoardOpen, () => false)
      await $.ui.close({ id: PANE })
      return { text: 'Session board closed.' }
    }
    if (args.startsWith('goal')) {
      const goal = args.slice(4).trim()
      const card = await loadMe($)
      card.goal = goal || null
      card.isGoalPinned = goal.length > 0
      await poll($, opts)
      return { text: goal ? `Goal pinned: ${goal}` : 'Goal unpinned; it will be derived again.' }
    }
    await update($, isBoardOpen, () => true)
    await $.ui.open({ id: PANE, title: 'Sessions' })
    void summarize($, opts)
    return { text: 'Session board opened.' }
  })

  // The pane closed from its own close control counts as /board close, so a reload does not reopen it
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, isBoardOpen, () => false)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // /clear ends the conversation but not the session, and no session.start follows: start the card over
    if (e.reason === 'clear') {
      if (me) Object.assign(me, { title: null, goal: null, isGoalPinned: false, now: null, next: null, you: null, state: 'idle', waitingOn: null, summarizedAt: null })
      return next(e)
    }
    timer?.cancel()
    // A clean exit drops the card at once; a killed process leaves it to go stale
    if (me) {
      me.isEnded = true
      await writeMe($).catch(() => {})
      me = null
    }
    return next(e)
  })

  // The strip above the prompt: one pill per session, then a line per session that needs you
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list: Row[] = await read($, rows)
    if (!list.some(r => !r.isMe)) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    const needsYou = list.filter(r => !r.isMe && !r.isStale && r.state === 'waiting' && !r.isSeen)

    const pill = (r: Row) => {
      const look = LOOK[r.state]
      const isLoud = r.state === 'waiting' && !r.isSeen && !r.isStale
      return (
        <Box key={`p-${r.id}`} flexDirection="row" gap={1} paddingX={1} borderStyle="round" borderColor={isLoud ? CORAL : GREY} borderDimColor={!isLoud} flexShrink={0}>
          <Text color={r.isStale ? GREY : look.color}>{r.isStale ? '◌' : look.glyph}</Text>
          <Text bold={isLoud} dimColor={r.isMe || r.isStale} wrap="truncate">{clip(r.title ?? r.folder, 28)}{r.isMe ? ' · you' : ''}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
          {list.map(pill)}
        </Box>
        {needsYou.map(r => (
          <Box key={`w-${r.id}`} flexDirection="row" gap={1} alignItems="center">
            <Box flexShrink={1} minWidth={0}><Text color={CORAL} wrap="truncate">↳ {clip(r.title ?? r.folder, 28)}: {r.waitingOn ?? r.you ?? 'needs you'}</Text></Box>
            <Box flexShrink={0}><Button key={`seen-${r.id}`} label="Seen" onPress={() => mark($, opts, r.id, { seenSince: r.since })} /></Box>
          </Box>
        ))}
        {await next(e)}
      </Box>
    )
  })

  // The /board pane: a card per session
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list: Row[] = await read($, rows)
    const now: number = await read($, clockNow)
    const { Box, Text, Button } = $.ui.resolve(e) as any
    if (list.length === 0) return <Text dimColor>No sessions yet.</Text>

    const card = (r: Row) => {
      const look = LOOK[r.state]
      const isLoud = r.state === 'waiting' && !r.isSeen && !r.isStale
      const line = (label: string, text: string | null, color?: string) => text && (
        <Box flexDirection="row" gap={1}>
          <Box width={5} flexShrink={0}><Text dimColor>{label}</Text></Box>
          <Box flexShrink={1} minWidth={0}><Text color={color} wrap="wrap">{text}</Text></Box>
        </Box>
      )
      return (
        <Box key={`c-${r.id}`} flexDirection="column" paddingX={1} borderStyle="round" borderColor={isLoud ? CORAL : GREY} borderDimColor={!isLoud}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={r.isStale ? GREY : look.color}>{r.isStale ? '◌' : look.glyph}</Text>
            <Box flexGrow={1} flexShrink={1} minWidth={0}><Text bold dimColor={r.isStale} wrap="truncate">{r.title ?? r.folder}</Text></Box>
            <Box flexShrink={0}><Text dimColor>{r.isMe ? 'this session · ' : ''}{r.isStale ? `stale · ${ago(now - r.heartbeat)}` : `${look.label} · ${ago(now - r.since)}`}</Text></Box>
          </Box>
          {line('goal', r.goal)}
          {line('now', r.now)}
          {line('next', r.next)}
          {r.state === 'waiting' && line('you', r.waitingOn ?? r.you, isLoud ? CORAL : AMBER)}
          {r.isSummaryStale && <Text dimColor>summary stale; retries after the next turn</Text>}
          {!r.isMe && (
            <Box flexDirection="row" gap={1}>
              {isLoud && <Button key={`seen-${r.id}`} label="Seen" onPress={() => mark($, opts, r.id, { seenSince: r.since })} />}
              <Button key={`dismiss-${r.id}`} label="Dismiss" role="dismiss" onPress={() => mark($, opts, r.id, { isDismissed: true })} />
            </Box>
          )}
        </Box>
      )
    }

    return <Box flexDirection="column" gap={1}>{list.map(card)}</Box>
  })
}
