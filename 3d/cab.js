/* [CAB 2026-10-16] cab control stand for Cab mode (viewer trains and the 3D ops session): 8 throttle notches, automatic (train) brake,
   independent (loco) brake, horn and bell, speed in mph and km/h. Physics: assets/physics.js (shared with the ops engine).
   Keys in Cab: W / S notch up / down · ; / ' automatic brake release / apply · , / . independent release / apply · Space horn · V bell.
   The stand takes over the selected train when you first touch a control; leaving Cab hands it back to its normal (speed-setpoint) driver. */
(function () { 'use strict';
const $ = id => document.getElementById(id), P = window.L3DPhysics;
function wait() { const S = window.__layout3d; if (!S || !S.ready || !S.api) return setTimeout(wait, 250); init(S.api); } wait();
function init(A) { if (!P) return;
  const el = document.createElement('div'); el.id = 'cabstand'; el.className = 'hidden';
  el.innerHTML = `<div class="cs-spd"><b id="cs-mph">0</b><small>mph</small><span id="cs-kmh">0 km/h</span></div>
   <div class="cs-grp" title="Throttle notch [W / S]"><label>Throttle</label><div class="cs-notch" id="cs-notch"></div></div>
   <div class="cs-grp" title="Automatic (train) brake: brake-pipe reduction [; release / ' apply]"><label>Auto brake</label><div class="cs-bar"><i id="cs-ab"></i></div><small id="cs-abt">release</small></div>
   <div class="cs-grp" title="Independent (loco) brake [, release / . apply]"><label>Indep.</label><div class="cs-bar"><i id="cs-ib"></i></div><small id="cs-ibt">off</small></div>
   <div class="cs-grp cs-btns"><button id="cs-horn" title="Horn [Space]">&#128227; Horn</button><button id="cs-bell" title="Bell [V]">&#128276; Bell</button></div>
   <div class="cs-msg" id="cs-msg">W/S notch · ; ' auto brake · , . indep · Space horn · V bell</div>`;
  document.body.appendChild(el);
  let audio = null; const OU = () => window.__ops3d && window.__ops3d.uiApi && !A.trains.length ? window.__ops3d.uiApi : null;
  const ctl = () => { const O = OU(); if (O) { const th = O.throttle(); return th || null; } const t = A.trains[A.getSel()]; if (!t) return null; return t.ctl || (t.ctl = { cab: false, notch: 0, auto: 0, ind: 0 }); };
  const take = k => { if (!k.cab) { k.cab = true; k.notch = 0; const O = OU(); if (O) { k.auto = 0; k.ind = 0; } else { const t = A.trains[A.getSel()]; k.notch = t && t.v > 0.05 ? 4 : 0; k.auto = 0; k.ind = 0; } } };
  const inCab = () => { const O = OU(); return O ? O.getMode() === 'cab' : A.getMode() === 'cab'; };
  const horn = () => { const O = OU(); if (O) return O.horn(); if (window.OpsAudio) { audio = audio || OpsAudio.create(); audio.start(); audio.horn({ x: A.camera.position.x, y: A.camera.position.z, z: A.camera.position.y }, 'long'); } };
  let bell = false; const setBell = on => { bell = on; $('cs-bell').classList.toggle('on', on); const O = OU(); if (O) O.bell(on); else if (window.OpsAudio) { audio = audio || OpsAudio.create(); audio.start(); audio.bell('viewer', on); } };
  const act = (what, d) => { const k = ctl(); if (!k) return; take(k);
    if (what === 'notch') { if (d > 0 && k.auto > 0.05) { msg('Release the automatic brake first'); return; } k.notch = Math.max(0, Math.min(8, (k.notch || 0) + d)); }
    if (what === 'auto') { k.auto = Math.max(0, Math.min(1, Math.round(((k.auto || 0) + d) * 10) / 10)); if (k.auto > 0) k.notch = 0; }
    if (what === 'ind') k.ind = Math.max(0, Math.min(1, Math.round(((k.ind || 0) + d) * 10) / 10)); draw(); };
  let mt = 0; const msg = t => { $('cs-msg').textContent = t; mt = performance.now(); };
  addEventListener('keydown', e => { if (!inCab() || /input|select|textarea/i.test(e.target.tagName || '')) return; const c = e.code; let h = true;
    if (c === 'KeyW') act('notch', 1); else if (c === 'KeyS') act('notch', -1); else if (c === 'Quote') act('auto', 0.1); else if (c === 'Semicolon') act('auto', -0.1);
    else if (c === 'Period') act('ind', 0.2); else if (c === 'Comma') act('ind', -0.2); else if (c === 'Space') { if (!e.repeat) horn(); } else if (c === 'KeyV') setBell(!bell); else h = false;
    if (h) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  $('cs-horn').onclick = e => { horn(); e.currentTarget.blur(); }; $('cs-bell').onclick = e => { setBell(!bell); e.currentTarget.blur(); };
  $('cs-notch').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; const k = ctl(); if (!k) return; take(k); k.notch = +b.dataset.n; if (k.notch) k.auto = 0; draw(); };
  $('cs-notch').innerHTML = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button data-n="${n}" title="Notch ${n}">${n ? n : 'I'}</button>`).join('');
  let was = false;
  function draw() { const on = inCab(); el.classList.toggle('hidden', !on);
    if (!on) { if (was) { const k = ctl(); if (k) k.cab = false; setBell(false); } was = false; return; } was = true;
    const k = ctl() || {}, O = OU(), t = A.trains[A.getSel()], mph = O ? O.speed() : t ? (t.mph != null ? t.mph : P.MPH(t.v)) : 0;
    $('cs-mph').textContent = mph.toFixed(0); $('cs-kmh').textContent = (mph * 1.609).toFixed(0) + ' km/h';
    [...$('cs-notch').children].forEach((b, i) => b.classList.toggle('on', k.cab && (k.notch || 0) === i));
    const ab = k.cab ? (k.abc != null ? k.abc : k.auto || 0) : 0, ib = k.cab ? (k.ibc != null ? k.ibc : k.ind || 0) : 0;
    $('cs-ab').style.width = ab * 100 + '%'; $('cs-abt').textContent = !k.cab ? 'auto driver' : (k.auto || 0) === 0 ? (ab > 0.01 ? 'releasing' : 'release') : (k.auto >= 1 ? 'full service' : Math.round(k.auto * 100) + ' %');
    $('cs-ib').style.width = ib * 100 + '%'; $('cs-ibt').textContent = !k.cab ? '—' : (k.ind || 0) ? Math.round(k.ind * 100) + ' %' : 'off';
    if (t && t.prot) msg('Train protection: emergency stop (occupied block ahead)'); else if (performance.now() - mt > 4000) $('cs-msg').textContent = k.cab ? 'W/S notch · ; \' auto brake · , . indep · Space horn · V bell' : 'Press W or a notch to take the controls · W/S notch · ; \' auto brake · , . indep · Space horn · V bell'; }
  setInterval(draw, 120); }
})();
