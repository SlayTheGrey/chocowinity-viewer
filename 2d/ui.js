/* [UI 2026-10-16] ops sim shell: session flow (start card, run/pause, speed), train cards, log filter, hide-UI (Tab / eye) and panel minimise.
   Talks to game.js through window.__opsGame and the existing element ids. State in localStorage 'ops.ui'. */
(function () { 'use strict';
const $ = id => document.getElementById(id), G = window.__opsGame, Q = new URLSearchParams(location.search); if (!G) return;
let st = {}; try { st = JSON.parse(localStorage.getItem('ops.ui') || '{}') || {}; } catch (e) {} const save = () => { try { localStorage.setItem('ops.ui', JSON.stringify(st)); } catch (e) {} };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const relayout = () => dispatchEvent(new Event('resize'));
let started = !!Q.has('test') || Q.get('start') === '1';
// session status + run/pause + speed
function sync() { const E = G.engine, p = E.paused, s = $('ss-status');
  s.textContent = !started ? 'Ready' : p ? 'Paused' : 'Running'; s.className = 'ss-pill ' + (!started ? 'ready' : p ? 'paused' : 'run');
  $('pause').innerHTML = p ? (started ? '&#9654; Resume' : '&#9654; Start') : '&#9208; Pause'; $('pause').classList.toggle('paused', started && p);
  document.querySelectorAll('#rates [data-rate]').forEach(b => b.classList.toggle('on', +b.dataset.rate === G.rate)); }
window.OpsUI = { sync };
$('pause').addEventListener('click', () => { if (!started) { started = true; $('ss').classList.add('hidden'); } sync(); });
$('rates').onclick = e => { const b = e.target.closest('[data-rate]'); if (!b) return; $('rate').value = b.dataset.rate; $('rate').dispatchEvent(new Event('change')); b.blur(); sync(); };
// start card
function jobsSummary() { const E = G.engine; $('ss-jobs').innerHTML = 'Jobs this session: ' + E.session.jobs.map(j => `<b>${esc(j.name)}</b> (${E.session.cards.filter(c => c.job === j.id).length} cars)`).join(' · '); }
function openCard() { $('ss-title').textContent = 'Operating session — ' + G.D.name; jobsSummary(); $('ss').classList.remove('hidden'); $('ss-start').innerHTML = started ? '&#10003; Done' : '&#9654; Start session'; }
$('sessb').onclick = () => { $('sessb').blur(); openCard(); };
let base = { mode: $('mode').value, seed: $('seed').value };
$('new').addEventListener('click', () => { base = { mode: $('mode').value, seed: $('seed').value }; G.engine.paused = !started; jobsSummary(); sync(); });
$('mode').addEventListener('change', () => { base = { mode: $('mode').value, seed: $('seed').value }; G.engine.paused = !started; jobsSummary(); sync(); });
$('ss-start').onclick = () => { if ($('seed').value !== base.seed || $('mode').value !== base.mode) { G.restart(); base = { mode: $('mode').value, seed: $('seed').value }; }
  if (!started) { started = true; G.engine.paused = false; } $('ss').classList.add('hidden'); sync(); };
$('ss-help').onclick = () => { $('help').classList.remove('hidden'); };
$('ss').addEventListener('click', e => { if (e.target === $('ss') && started) $('ss').classList.add('hidden'); });
if (!started) openCard();
// train cards: every loco consist; Drive selects it on the throttle, Ride follows it on the map
function trainCards() { const E = G.engine, sc = G.scoreState(), sel = G.sel.addr;
  const jobs = {}; for (const j of E.session.jobs) jobs[j.addr] = j;
  const html = E.cuts.filter(c => c.cars.some(x => x.loco)).map(c => { const L = c.cars.find(x => x.loco), j = jobs[L.addr], mph = Math.abs(window.OpsEngine.MPH(c.v));
    const n = j ? E.session.cards.filter(k => k.job === j.id) : [], d = n.filter(k => sc[k.car]).length, you = !L.ai;
    const stt = c.derailed ? '<span class="tc-st fail">Derailed</span>' : j && j.exec ? (j.exec.done ? '<span class="tc-st">&#10003; Job done</span>' : j.exec.fail ? `<span class="tc-st fail">&#10007; ${esc(String(j.exec.fail).slice(0, 60))}</span>` : `<span class="tc-st">AI crew: step ${j.exec.i + 1}/${j.exec.steps.length}</span>`) : `<span class="tc-st">${mph < 0.2 ? 'Stopped' : 'Moving'}</span>`;
    return `<div class="tc${L.addr === sel ? ' sel' : ''}"><div class="tc-h"><b title="${esc(E.cutName(c))}">${esc(E.cutName(c))}</b><span class="tc-who${you ? ' you' : ''}">${you ? 'You' : 'AI'}</span></div>
      <div class="tc-m"><span>Speed <b>${mph.toFixed(0)}</b> smph</span><span>Cars <b>${c.cars.filter(x => !x.loco).length}</b></span><span>DCC <b>${L.addr}</b></span></div>
      ${j ? `<div class="tc-bar" title="${d}/${n.length} cars worked"><i style="width:${n.length ? d / n.length * 100 : 0}%"></i></div>` : ''}${stt}
      <div class="tc-b"><button data-drive="${L.addr}" title="Put this loco on the throttle">&#127918; Drive</button><button data-ride="${L.addr}" title="Ride along on the map">&#128065; Ride</button></div></div>`; }).join('') || '<div class="small">No trains.</div>';
  if (html !== trainCards.last) { trainCards.last = html; $('traincards').innerHTML = html; } }
$('traincards').onclick = e => { const d = e.target.closest('[data-drive]'), r = e.target.closest('[data-ride]'); if (d) G.selectLoco(+d.dataset.drive); if (r) { G.selectLoco(+r.dataset.ride); G.setView('ride'); } trainCards(); };
setInterval(() => { try { trainCards(); sync(); } catch (e) { G.errs.push('ui: ' + e.message); } }, 500);
// log filter
$('logf').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; window.OPS_LOGFILTER = st.logf = b.dataset.f; save(); document.querySelectorAll('#logf button').forEach(x => x.classList.toggle('on', x === b)); };
if (st.logf) { window.OPS_LOGFILTER = st.logf; document.querySelectorAll('#logf button').forEach(x => x.classList.toggle('on', x.dataset.f === st.logf)); }
// collapsible sections, panel minimise, hide all UI
st.sec = st.sec || {}; document.querySelectorAll('details.sec').forEach(d => { const k = d.dataset.sec; if (k in st.sec) d.open = st.sec[k]; d.addEventListener('toggle', () => { st.sec[k] = d.open; save(); }); });
function setMin(m) { st.min = !!m; $('side').classList.toggle('min', st.min); $('side-min').textContent = st.min ? '+' : '\u2013'; save(); relayout(); }
$('side-h').onclick = () => setMin(!st.min); $('side-min').onclick = e => { e.stopPropagation(); setMin(!st.min); e.currentTarget.blur(); };
function setHidden(h) { st.hidden = !!h; document.body.classList.toggle('hideui', st.hidden); $('ui-eye').title = (st.hidden ? 'Show' : 'Hide') + ' all panels [Tab]'; save(); relayout(); }
$('ui-eye').onclick = e => { setHidden(!st.hidden); e.currentTarget.blur(); };
addEventListener('keydown', e => { if (e.key !== 'Tab' || /input|select|textarea/i.test(e.target.tagName || '')) return; e.preventDefault(); setHidden(!st.hidden); }, true);
setMin(!!st.min); setHidden(!!st.hidden && !Q.has('test')); sync();
})();
