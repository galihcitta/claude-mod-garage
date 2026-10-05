export type Gauge = {
  tokens: number
  line: number
  warnFrom: number
  autoAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-guard': {
      gauge: Gauge | null
      snooze: number
      samples: number[]
      lastTurnTokens: number | null
      autoAt: number | null
      eater: string | null
      isPast: boolean
      isQueued: boolean
      isHandoffPending: boolean
      handoffPath: string | null
    }
  }
}
