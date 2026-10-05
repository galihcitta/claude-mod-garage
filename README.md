# claude-mod-garage

Galih's personal Claude Code mods: plugins of function hooks that add panes, bands, status lines and toasts to Claude Code (terminal and desktop app).

| Mod | What it does |
|---|---|
| [context-guard](context-guard/) | Runway gauge for your context window, with Compact, Hand off and Remind buttons before auto-compact hits |

## Install

Each folder is one mod. List the ones you want in `~/.claude/settings.json`, separated by `:`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/path/to/claude-mod-garage/context-guard" } }
```

Listed folders hot-reload on save in interactive sessions.

## Develop

```bash
claude plugin validate context-guard
claude plugin test context-guard
```

Mods are written against Claude Code's early-access function-hooks API (2.1.286), which may change between releases.
