import type { Card } from '../types'

// The board as a standalone HTML page, rewritten on every heartbeat. Ages and
// staleness are worked out in the page from the timestamps, so it stays right
// between rewrites; it reloads itself every 5 s to pick up new cards.

const esc = (s: string | null) => (s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const card = (c: Card) => {
  const line = (label: string, text: string | null, cls = '') => (text ? `<div class="row ${cls}"><span class="k">${label}</span><span>${esc(text)}</span></div>` : '')
  const needs = c.state === 'waiting' ? c.waitingOn ?? c.you : null
  return `<article class="card ${c.state}" data-since="${c.since}" data-heartbeat="${c.heartbeat}">
  <header><span class="dot"></span><h2>${esc(c.title ?? c.folder)}</h2><span class="age"></span></header>
  ${line('goal', c.goal)}${line('now', c.now)}${line('next', c.next)}${line('you', needs, 'you')}
  <footer>${esc(c.folder)}${c.isSummaryStale ? ' · summary stale' : ''}</footer>
</article>`
}

export const renderPage = (cards: Card[], dimAfterMs: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Session Board</title>
<style>
:root{--bg:#f7f6f2;--card:#fff;--ink:#1f1e1b;--mute:#77756e;--line:#e3e1da;--green:#1D9E75;--coral:#D85A30;--grey:#a3a19a;--coral-bg:#fbeee8}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecebe6;--mute:#93918a;--line:#2e2e2b;--grey:#6b6a64;--coral-bg:#2c1d17}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;padding:24px 16px}
main{max-width:1200px;margin:0 auto}
.top{display:flex;align-items:baseline;gap:16px;margin-bottom:18px;flex-wrap:wrap}
h1{font-size:20px;margin:0;letter-spacing:-.01em}
.counts{display:flex;gap:14px;color:var(--mute);font-size:13px}
.counts b{color:var(--ink);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.card header{display:flex;align-items:center;gap:8px}
.card h2{font-size:15px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--grey)}
.working .dot{background:var(--green);box-shadow:0 0 0 3px color-mix(in srgb,var(--green) 22%,transparent)}
.waiting{border-color:var(--coral);background:var(--coral-bg)}
.waiting .dot{background:var(--coral);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--coral) 30%,transparent)}}
.age{color:var(--mute);font-size:12px;white-space:nowrap}
.row{display:grid;grid-template-columns:40px 1fr;gap:8px}
.k{color:var(--mute);font-size:12px;padding-top:1px}
.you span:last-child{color:var(--coral);font-weight:600}
footer{color:var(--mute);font-size:12px;margin-top:2px}
.stale{opacity:.5}
.stale .dot{background:transparent;border:1.5px dashed var(--grey);animation:none;box-shadow:none}
.empty{color:var(--mute);padding:40px 0;text-align:center}
</style></head>
<body><main>
<div class="top"><h1>Sessions</h1><div class="counts" id="counts"></div></div>
<div class="grid">
${cards.length ? cards.map(card).join('\n') : '<p class="empty">No running sessions.</p>'}
</div>
</main>
<script>
const DIM = ${Number(dimAfterMs)}
const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago' }
const label = { working: 'working', waiting: 'needs you', idle: 'idle' }
const n = { working: 0, waiting: 0, idle: 0, stale: 0 }
for (const el of document.querySelectorAll('.card')) {
  const isStale = Date.now() - Number(el.dataset.heartbeat) > DIM
  const state = ['working', 'waiting', 'idle'].find(s => el.classList.contains(s))
  el.classList.toggle('stale', isStale)
  el.querySelector('.age').textContent = isStale ? 'stale · ' + ago(Date.now() - Number(el.dataset.heartbeat)) : label[state] + ' · ' + ago(Date.now() - Number(el.dataset.since))
  n[isStale ? 'stale' : state]++
}
document.getElementById('counts').innerHTML = '<span><b>' + n.waiting + '</b> need you</span><span><b>' + n.working + '</b> working</span><span><b>' + n.idle + '</b> idle</span>' + (n.stale ? '<span><b>' + n.stale + '</b> stale</span>' : '')
document.title = n.waiting ? '(' + n.waiting + ') Session Board' : 'Session Board'
</script>
</body></html>
`
