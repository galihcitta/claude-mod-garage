# session-board

See every running Claude Code session at a glance, without scrolling back or asking "what's the progress?".

- **Strip above the prompt**: one pill per running session on this Mac. ● working, ◉ needs you, ○ idle, ◌ stale. A session that needs you gets an orange border and a line saying what it needs, with a **Seen** button.
- **`/board` pane**: a card per session with title, goal, now, next and what it needs from you, plus **Seen** and **Dismiss**.
- **Status line**: this session's own `now: … · next: …`.
- **A web page**: `~/.claude/session-board/board.html`, rewritten on every heartbeat and reloading itself every 5 s. Keep it as a pinned browser tab; its title shows how many sessions need you. Open it with `open ~/.claude/session-board/board.html`.

The strip hides itself when only one session is running.

## How it works

Every session writes its own card to `~/.claude/session-board/card-<id>.json` every 10 s and reads everyone's. There is no cross-session API, so that folder is the bus: one file per session, so no write can clobber another.

- **State** comes from hooks: a permission prompt is *needs you*, a prompt or tool call is *working*, the turn ending is *idle*.
- **Words** (title, goal, now, next, needs-you) come from a small model (Haiku by default) reading only the session's prompts and replies, never tool output. It runs after a turn that used tools, at most every 2 minutes, and right away when the last reply contains a question. A reply that asks you something turns the card to *needs you*.
- The goal is derived once from your first prompts and again after a compaction. Pin it yourself with `/board goal <text>`.
- A card with no heartbeat for 10 minutes is dimmed as stale; after 24 h it drops off.

## Commands

| Command | Does |
|---|---|
| `/board` | Open the board pane |
| `/board close` | Close it |
| `/board goal <text>` | Pin this session's goal (`/board goal` alone unpins) |

## Settings

`pluginConfigs["session-board@inline"].options` in `~/.claude/settings.json`:

| Option | Default | |
|---|---|---|
| `summarizerModel` | `haiku` | Model that writes the cards |
| `dimAfterMinutes` | `10` | Minutes without a heartbeat before a card is dimmed |
