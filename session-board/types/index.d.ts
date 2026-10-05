export type SessionState = 'working' | 'waiting' | 'idle'

/** One session's card, as written to ~/.claude/session-board/card-<id>.json */
export type Card = {
  v: 1
  id: string
  folder: string
  title: string | null
  goal: string | null
  isGoalPinned: boolean
  now: string | null
  next: string | null
  you: string | null
  state: SessionState
  waitingOn: string | null
  since: number
  heartbeat: number
  summarizedAt: number | null
  isSummaryStale: boolean
  /** Set when the session ended cleanly; the board drops the card */
  isEnded?: boolean
}

/** Marks any session may set on a card: written to marks-<id>.json */
export type Marks = { isDismissed: boolean; seenSince: number | null }

/** A card as the board draws it */
export type Row = Card & { isMe: boolean; isStale: boolean; isSeen: boolean }

declare module 'claude-code' {
  interface PluginState {
    'session-board': { rows: Row[]; now: number; isBoardOpen: boolean }
  }
}
