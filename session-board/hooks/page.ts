import type { Card } from '../types'

// The board as a standalone HTML page, rewritten on every heartbeat: a flight
// strip board, one strip per session, racked by what it needs from you. Ages,
// staleness and the headline are worked out in the page from the timestamps,
// so they stay right between rewrites; it reloads itself every 5 s. Nothing
// animates on load, since the page reloads that often.

const esc = (s: string | null) => (s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const cap = (s: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const strip = (c: Card) => {
  const ask = cap(c.state === 'waiting' ? c.waitingOn ?? c.you : null)
  const title = c.title ?? c.folder
  // The folder line only earns its place when the title does not already name it
  const where = title.toLowerCase().includes(c.folder.toLowerCase()) ? '' : `<p class="where">${esc(c.folder)}</p>`
  const field = (label: string, text: string | null) => (text ? `<p class="field"><span class="k">${label}</span> ${esc(text)}</p>` : '')
  return `<li class="strip ${c.state}" data-since="${c.since}" data-heartbeat="${c.heartbeat}">
  <div class="holder" aria-hidden="true"></div>
  <div class="call">
    <h3>${esc(title)}</h3>
    ${where}
  </div>
  <div class="fields">
    ${field('Goal', c.goal)}${field('Now', c.now)}${field('Next', c.next)}
    ${c.isSummaryStale ? '<p class="note">Summary is out of date; it refreshes after the next turn.</p>' : ''}
  </div>
  <div class="side">
    ${ask ? `<p class="ask">${esc(ask)}</p>` : ''}
    <p class="age"></p>
  </div>
</li>`
}

const BAYS: { state: Card['state']; name: string; empty: string }[] = [
  { state: 'waiting', name: 'Waiting on you', empty: 'No session is waiting on you.' },
  { state: 'working', name: 'Moving', empty: 'No session is working right now.' },
  { state: 'idle', name: 'Parked', empty: 'No idle sessions.' },
]

export const renderPage = (cards: Card[], dimAfterMs: number) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="5">
<title>Session Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap" rel="stylesheet">
<style>
:root{
  --rack:#E3E8EC; --rail:#C9D2D9; --paper:#FBFCFD; --ink:#16202A; --mute:#5E6B77; --faint:#8795A1;
  --amber:#E8A600; --amber-ink:#7A5200; --amber-wash:#FFF6DA; --cyan:#2C7DA0; --slate:#8795A1;
}
@media (prefers-color-scheme:dark){:root{
  --rack:#141B22; --rail:#25303A; --paper:#1C252E; --ink:#E6ECF1; --mute:#9AA7B2; --faint:#6D7A86;
  --amber:#F2B71F; --amber-ink:#F7CF63; --amber-wash:#2A2413; --cyan:#4BA3C7; --slate:#6D7A86;
}}
*{box-sizing:border-box}
html{background:var(--rack)}
body{margin:0;color:var(--ink);font-family:"Archivo",system-ui,sans-serif;font-variation-settings:"wdth" 100;font-size:15px;line-height:1.45;padding:40px 16px 64px}
main{max-width:1120px;margin:0 auto}
.head{margin:0 0 36px}
h1{font-size:clamp(34px,5.4vw,60px);line-height:1.02;margin:0;font-weight:800;font-variation-settings:"wdth" 68;letter-spacing:-.01em;max-width:18ch}
h1.calm{color:var(--mute)}
.sub{margin:12px 0 0;color:var(--mute);font-size:14px}
.bay{margin:0 0 30px}
.bay h2{display:flex;align-items:baseline;gap:10px;margin:0 0 10px;font-size:15px;font-weight:700;font-variation-settings:"wdth" 88}
.bay h2 .n{color:var(--faint);font-weight:500}
.rack{list-style:none;margin:0;padding:6px;background:var(--rail);border-radius:6px;display:flex;flex-direction:column;gap:5px}
.strip{display:grid;grid-template-columns:10px minmax(170px,1.1fr) 2.2fr minmax(150px,1fr);background:var(--paper);border-radius:3px;min-height:68px}
.holder{border-radius:3px 0 0 3px;background:var(--slate)}
.working .holder{background:var(--cyan)}
.waiting .holder{background:var(--amber)}
.waiting{background:linear-gradient(90deg,var(--amber-wash),var(--paper) 55%)}
.call{padding:12px 14px;border-right:1px dashed var(--rail)}
.call h3{margin:0;font-size:19px;line-height:1.15;font-weight:750;font-variation-settings:"wdth" 72}
.where{margin:4px 0 0;color:var(--faint);font-size:13px}
.fields{padding:10px 14px;display:flex;flex-direction:column;gap:2px;max-width:72ch}
.field{margin:0;display:grid;grid-template-columns:42px 1fr;gap:6px}
.k{color:var(--faint);font-size:13px;padding-top:1px}
.note{margin:4px 0 0;color:var(--faint);font-size:13px}
.side{padding:12px 14px;border-left:1px dashed var(--rail);display:flex;flex-direction:column;justify-content:space-between;gap:8px}
.ask{margin:0;font-weight:650;color:var(--amber-ink)}
.age{margin:0;color:var(--faint);font-size:13px}
.empty{margin:0;padding:14px;color:var(--faint);font-size:14px}
.stale{opacity:.55}
.stale .holder{background:repeating-linear-gradient(45deg,var(--slate) 0 4px,transparent 4px 8px)}
.stale.waiting{background:var(--paper)}
@media (prefers-reduced-motion:no-preference){
  .waiting:not(.stale) .holder{animation:signal 2.4s ease-in-out infinite}
  @keyframes signal{50%{opacity:.35}}
}
@media (max-width:760px){
  .strip{grid-template-columns:8px 1fr}
  .holder{grid-row:1 / span 3}
  .call,.fields,.side{grid-column:2;border:0}
  .call{padding-bottom:0}
  .side{padding-top:2px}
}
</style></head>
<body><main>
<header class="head"><h1 id="headline">Session board</h1><p class="sub" id="sub"></p></header>
${BAYS.map(b => {
  const list = cards.filter(c => c.state === b.state)
  return `<section class="bay" data-state="${b.state}">
<h2>${b.name} <span class="n">${list.length}</span></h2>
${list.length ? `<ol class="rack">${list.map(strip).join('\n')}</ol>` : `<p class="empty">${b.empty}</p>`}
</section>`
}).join('\n')}
</main>
<script>
const DIM = ${Number(dimAfterMs)}
const now = Date.now()
const span = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? 'under a minute' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d' }
const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
let waiting = 0, live = 0
for (const el of document.querySelectorAll('.strip')) {
  const isStale = now - Number(el.dataset.heartbeat) > DIM
  el.classList.toggle('stale', isStale)
  const since = span(now - Number(el.dataset.since))
  el.querySelector('.age').textContent = isStale ? 'No heartbeat for ' + span(now - Number(el.dataset.heartbeat))
    : el.classList.contains('waiting') ? 'Waiting for ' + since
    : el.classList.contains('working') ? 'Working for ' + since : 'Idle for ' + since
  if (!isStale) { live++; if (el.classList.contains('waiting')) waiting++ }
}
const h = document.getElementById('headline')
h.textContent = waiting === 0 ? 'Nothing is waiting on you.' : (words[waiting] ?? waiting) + (waiting === 1 ? ' session is' : ' sessions are') + ' waiting on you.'
h.classList.toggle('calm', waiting === 0)
document.getElementById('sub').textContent = live + (live === 1 ? ' session' : ' sessions') + ' running. Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.'
document.title = waiting ? '(' + waiting + ') Session Board' : 'Session Board'
</script>
</body></html>
`
