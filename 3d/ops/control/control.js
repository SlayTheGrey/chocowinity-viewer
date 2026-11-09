/* OpsControl — reusable DCC handheld throttle (NCE/Digitrax style) for the ops game and the layout3d viewer.
   const th = OpsControl.throttle(containerEl, { engine, audio, getLocos: () => [{addr, label}], onSelect(addr) })
   Engine contract: engine.throttles[addr] = {speed (smph), dir (+1/-1), steps (28|128), step, cv3, cv4, f:{0..12}, estop, mu:[addrs]}
   Keys (when the page has focus): ↑/↓ or wheel = speed step, R = reverse, Space = stop (step 0), E = emergency stop (all),
   0..9 = F0..F9 (F0 headlight, F1 bell, F2 horn crossing pattern, F3 short horn, F4 dynamic brake, F5 dim, F8 mute engine sound). */
(function (root) {
'use strict';
const TOP = 65;   // decoder top speed (smph) at full throttle; the physics caps by track limits/acceleration
function throttle(el, o) {
  const eng = o.engine; let addr = null;
  el.classList.add('dcc'); el.innerHTML = `
    <div class="dcc-head"><select class="dcc-addr" title="Loco address (roster)"></select><span class="dcc-steps" title="speed steps (click: 28/128)">28</span></div>
    <div class="dcc-lcd"><div class="dcc-spd">0</div><div class="dcc-dir">FWD</div><div class="dcc-real" title="actual scale speed">0 smph</div></div>
    <div class="dcc-knob" title="Speed knob: drag or mouse wheel (↑/↓)"><div class="dcc-ind"></div></div>
    <div class="dcc-row"><button data-a="rev" title="Reverse (R)">⇄ DIR</button><button data-a="stop" title="Stop: step 0 (Space)">STOP</button><button data-a="estop" class="estop" title="Emergency stop all (E)">E-STOP</button></div>
    <div class="dcc-f"></div>
    <div class="dcc-row small"><label title="CV3 acceleration momentum">CV3 <input type="number" min="0" max="31" value="4" class="cv3"></label><label title="CV4 deceleration momentum">CV4 <input type="number" min="0" max="31" value="4" class="cv4"></label></div>
    <div class="dcc-row small"><button data-a="mu" title="Add another loco to this one's consist (MU)">+ MU</button><span class="dcc-mu"></span></div>`;
  const $ = s => el.querySelector(s);
  const FN = ['F0 light', 'F1 bell', 'F2 horn', 'F3 short', 'F4 dyn brk', 'F5 dim', 'F6', 'F7', 'F8 mute'];
  $('.dcc-f').innerHTML = FN.map((n, i) => `<button data-f="${i}" title="${n}">${n}</button>`).join('');
  function th() { return addr != null ? eng.throttles[addr] : null; }
  function refreshList() { const L = o.getLocos(); const s = $('.dcc-addr'); const cur = s.value; s.innerHTML = L.map(l => `<option value="${l.addr}">${l.addr} · ${l.label}</option>`).join(''); if (cur) s.value = cur; if (addr == null && L.length) select(L[0].addr); }
  function select(a) { addr = +a; $('.dcc-addr').value = addr; const t = th(); if (t) { t.steps = t.steps || 28; t.step = t.step || 0; t.f = t.f || {}; $('.cv3').value = t.cv3; $('.cv4').value = t.cv4; } o.onSelect && o.onSelect(addr); draw(); }
  function setStep(s) { const t = th(); if (!t || t.estop) { if (t) t.estop = false; } if (!t) return; t.step = Math.max(0, Math.min(t.steps, s)); t.speed = t.step / t.steps * TOP; for (const m of t.mu || []) Object.assign(eng.throttles[m], { speed: t.speed, dir: t.dir, step: t.step }); draw(); }
  function draw() { const t = th(); if (!t) return; $('.dcc-spd').textContent = t.estop ? 'E-STOP' : `${t.step || 0}/${t.steps}`; $('.dcc-dir').textContent = t.dir > 0 ? 'FWD' : 'REV'; $('.dcc-steps').textContent = t.steps;
    $('.dcc-ind').style.transform = `rotate(${-135 + 270 * (t.step || 0) / t.steps}deg)`; el.querySelectorAll('[data-f]').forEach(b => b.classList.toggle('on', !!t.f[b.dataset.f]));
    $('.dcc-mu').textContent = (t.mu || []).length ? 'MU: ' + t.mu.join(', ') : ''; }
  function act(a) { const t = th(); if (!t) return;
    if (a === 'rev') { if ((t.step || 0) > 0 && Math.abs(o.getSpeed ? o.getSpeed(addr) : 0) > 0.5) { o.toast && o.toast('Stop before reversing'); return; } t.dir = -t.dir; for (const m of t.mu || []) eng.throttles[m].dir = t.dir; }
    if (a === 'stop') setStep(0);
    if (a === 'estop') { for (const k in eng.throttles) { eng.throttles[k].estop = true; eng.throttles[k].step = 0; eng.throttles[k].speed = 0; } o.toast && o.toast('EMERGENCY STOP (all)'); }
    if (a === 'mu') { const other = prompt('Address of the loco to add to the consist (MU):'); if (other && eng.throttles[+other] && +other !== addr) { t.mu = (t.mu || []).concat(+other); eng.throttles[+other].muLead = addr; } }
    draw(); }
  function fn(i) { const t = th(); if (!t) return; t.f[i] = !t.f[i]; const A = o.audio;
    if (i === 1 && A) A.bell('loco' + addr, !!t.f[1]);
    if (i === 2 && A) { A.horn('loco' + addr, 'crossing'); t.f[2] = false; }
    if (i === 3 && A) { A.horn('loco' + addr, 'short'); t.f[3] = false; }
    draw(); o.onFunction && o.onFunction(addr, i, t.f[i]); }
  el.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.a) act(b.dataset.a); if (b.dataset.f) fn(+b.dataset.f); });
  $('.dcc-steps').addEventListener('click', () => { const t = th(); if (!t) return; const r = (t.step || 0) / t.steps; t.steps = t.steps === 28 ? 128 : 28; t.step = Math.round(r * t.steps); draw(); });
  $('.dcc-addr').addEventListener('change', e => select(e.target.value));
  $('.cv3').addEventListener('change', e => { const t = th(); if (t) t.cv3 = +e.target.value; }); $('.cv4').addEventListener('change', e => { const t = th(); if (t) t.cv4 = +e.target.value; });
  const knob = $('.dcc-knob'); let drag = null;
  knob.addEventListener('wheel', e => { e.preventDefault(); const t = th(); if (t) setStep((t.step || 0) + (e.deltaY < 0 ? 1 : -1) * (t.steps === 128 ? 4 : 1)); }, { passive: false });
  knob.addEventListener('pointerdown', e => { drag = { y: e.clientY, s: (th() || {}).step || 0 }; knob.setPointerCapture(e.pointerId); });
  knob.addEventListener('pointermove', e => { if (!drag) return; const t = th(); if (t) setStep(Math.round(drag.s + (drag.y - e.clientY) / (t.steps === 128 ? 1 : 4))); });
  knob.addEventListener('pointerup', () => drag = null);
  function key(e) { if (/input|select|textarea/i.test(e.target.tagName)) return false; const t = th(); if (!t) return false; const k = e.key;
    if (k === 'ArrowUp') setStep((t.step || 0) + (t.steps === 128 ? 4 : 1)); else if (k === 'ArrowDown') setStep((t.step || 0) - (t.steps === 128 ? 4 : 1));
    else if (k === 'r' || k === 'R') act('rev'); else if (k === ' ') act('stop'); else if (k === 'e' || k === 'E') act('estop'); else if (/^[0-8]$/.test(k)) fn(+k); else return false; e.preventDefault(); return true; }
  return { refreshList, select, setStep, draw, key, get addr() { return addr; } };
}
/* control modes shared by game + viewer: 'manual' (you drive, CTC by you), 'auto' (AI drives + automated dispatcher), 'mixed' (you drive your job, AI the rest), 'ride' (cab view on any train) */
const MODES = ['manual', 'mixed', 'auto'];
const API = { throttle, MODES, TOP };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.OpsControl = API;
})(typeof window !== 'undefined' ? window : globalThis);
