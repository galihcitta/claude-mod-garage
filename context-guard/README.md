# context-guard

A Claude Code mod that warns you before your context gets too big, and gives you one-click ways out.

- **Status line**: `ctx ▰▰▰▱▱▱▱▱ 142k`, then `◆` when approaching and `▲` when past your line.
- **Band above the prompt** once you're past the line: a runway gauge (your line, auto-compact point), an estimate of turns left at your recent burn rate, the biggest context category, and three buttons:
  - **Compact, keep the plan**: compacts with an instruction to preserve goal, plan, decisions, open questions, file refs and next step.
  - **Hand off**: runs `/creating-handoffs`, then offers **Clear** once the handoff file is saved.
  - **Remind at N**: snoozes the warning by 50k for this session.
- Works in the terminal (colored text gauge, hotkeys `c` `h` `s` after focusing the band with ctrl+x tab) and the desktop app (SVG gauge).
- When you cross the line: a 10-second toast inside Claude Code, plus a macOS notification banner so you notice it while Claude Code is in the background.
- Never acts on its own: it only warns and offers buttons.

## The line

The warning line is the lower of **350k** and **auto-compact threshold − 50k**, so it always fires before Claude Code compacts on its own. A yellow chip appears 50k before the line.

## Install

Point Claude Code at the folder in `~/.claude/settings.json` (works for terminal and desktop-app sessions):

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/path/to/claude-mod-garage/context-guard" } }
```

Or for one session: `claude --plugin-dir ~/path/to/claude-mod-garage/context-guard`.

The **Hand off** button expects a `creating-handoffs` skill; without one it shows a toast instead.

## Configure

Override any option in `~/.claude/settings.json`:

```json
{ "pluginConfigs": { "context-guard@inline": { "options": { "lineTokens": 300000 } } } }
```

| Option | Default | Meaning |
|---|---|---|
| `lineTokens` | 350000 | Cap for the warning line |
| `marginTokens` | 50000 | Gap below auto-compact, and the yellow zone length |
| `snoozeTokens` | 50000 | How far one snooze raises the line |
| `macNotification` | true | Also post a macOS notification banner when you cross the line |
| `compactInstructions` | preserve goal, plan, … | What the Compact button asks the summary to keep |

`/context-guard-log` lists past crossings and clicks, useful for tuning the line.

## Develop

Folders in `CLAUDE_CODE_PLUGIN_DIRS` hot-reload on save in interactive sessions.

```bash
claude plugin validate .
claude plugin test .
```

Requires a Claude Code build with function hooks (written against 2.1.286; the API is early access).
