/* labels3d.js — [CHOCO-LABELS] + [CHOCO-RADIOICON] train / car tags for the 3D ops viewer (LABELS-STATS-DIAG.md §4, §8).
   Locos: "NS 351 W" + current activity. Cars: ● loaded / ○ EMPTY + commodity (assets/choco-commodity.js). 📻 above a loco while its crew is on the radio.
   Toggle: the Labels checkbox / L key (#labels), off by default. Perf: pooled sprites, texture redrawn only when its text changes,
   distance cull (locos 250 in, cars 60 in) + caps (24 locos, 60 cars), nearest first, re-sorted every 0.25 s, text refreshed at 2 Hz.
   Read-only on the engine: never writes engine state. Hook: ops3d.js H.update calls L3D_LABELS.update(H, dt). */
(function () {
'use strict';
const T3 = window.THREE; if (!T3) return;
const CAP = { loco: 24, car: 60 }, RANGE = { loco: 250, car: 60 }, PX = 15, RADIO_S = 5;
const CM = () => window.CHOCO_COMMODITY || { ind: {}, train: [], type: {}, none: ['loco'] };
const MPH = ips => ips * 160 / 17.6;
const S = { on: false, g: null, pool: [], used: 0, sortT: 0, txtT: 0, list: [], lastLog: -1, radioAt: {}, stats: { loco: 0, car: 0, radio: 0, redraw: 0 } };
function short(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function mkSprite() { const cv = document.createElement('canvas'); cv.width = 384; cv.height = 72; const tx = new T3.CanvasTexture(cv); tx.minFilter = T3.LinearFilter; tx.generateMipmaps = false;
  const m = new T3.SpriteMaterial({ map: tx, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }); const sp = new T3.Sprite(m); sp.renderOrder = 999; sp.center.set(0.5, 0); sp.userData = { cv, tx, key: null }; sp.visible = false; S.g.add(sp); return sp; }
function draw(sp, lines, kind) { const key = kind + '|' + lines.join('|'); if (sp.userData.key === key) return; sp.userData.key = key; S.stats.redraw++;
  const { cv, tx } = sp.userData, x = cv.getContext('2d'); const fs = 26, lh = 30; x.font = `600 ${fs}px system-ui,sans-serif`;
  const w = Math.min(384, Math.ceil(Math.max(...lines.map(l => x.measureText(l).width)) + 16)), h = lines.length * lh + 8; x.clearRect(0, 0, cv.width, cv.height);
  if (kind === 'radio') { x.fillStyle = '#f59e0b'; x.beginPath(); x.roundRect ? x.roundRect(0, 0, w, h, 10) : x.rect(0, 0, w, h); x.fill(); } else { x.fillStyle = kind === 'locoR' ? 'rgba(180,83,9,0.92)' : kind === 'loco' ? 'rgba(15,23,42,0.85)' : 'rgba(15,23,42,0.72)'; const r = 8; x.beginPath(); x.roundRect ? x.roundRect(0, 0, w, h, r) : x.rect(0, 0, w, h); x.fill(); }
  lines.forEach((l, i) => { x.font = `${i === 0 ? 700 : 500} ${i === 0 ? fs : fs - 4}px system-ui,sans-serif`;
    x.fillStyle = kind[0] === 'l' && kind !== 'loco' ? (i === 0 ? '#fff' : '#fef3c7') : kind === 'loco' ? (i === 0 ? '#fde68a' : '#e2e8f0') : kind === 'radio' ? '#111827' : (l[0] === '●' ? '#86efac' : l[0] === '◐' ? '#fcd34d' : '#cbd5e1'); x.fillText(l, 8, 4 + (i + 1) * lh - 8); });
  tx.repeat.set(w / cv.width, h / cv.height); tx.offset.set(0, 1 - h / cv.height); tx.needsUpdate = true; sp.userData.w = w; sp.userData.h = h; }
function place(sp, x, y, z, cam, yOffPx) { sp.position.set(x, y, z); const k = PX / 30 / (cam.isPerspectiveCamera ? innerHeight * 0.0011 * 1000 / 1000 : 1);
  const hh = (sp.userData.h / 30) * 0.034, ww = hh * sp.userData.w / sp.userData.h; sp.scale.set(ww, hh, 1); sp.center.set(0.5, yOffPx || 0); sp.visible = true; }
/* activity text for a loco cut (inferred: the engine has no state enum) */
function activity(H, eng, ai, cut, loco) { const addr = loco.addr; const v = Math.abs(cut.v || 0), mph = Math.round(MPH(v));
  const job = (eng.session && eng.session.jobs || []).find(j => j.addr === addr && j.exec && !j.exec.done) || (eng.session && eng.session.jobs || []).find(j => j.addr === addr);
  const tr = ai && (ai.trains || []).find(t => t.addr === addr);
  if (job && job.exec && !(tr && tr.sym && !job.exec.done && false)) { const ex = job.exec;
    if (ex.done) return [job.id, 'work complete']; if (ex.fail) return [job.id, 'stopped: ' + short(ex.fail, 18)];
    const st = ex.steps && ex.steps[ex.i]; const ph = ex.phase;
    if (st && (ph === 'go' || ph === 'back' || v > 0.05)) return [job.id, short(`${st.kind} ${st.frm}→${st.to}` + (v > 0.05 ? ` ${mph} mph` : ''), 24)];
    const last = ex.log && ex.log[ex.log.length - 1]; if (last && /holding|waiting|granted/i.test(last)) return [job.id, short(last.replace(/^holding\s*-\s*/i, 'holding: '), 24)];
    return [job.id, st ? short(`switching ${st.to}`, 24) : 'switching']; }
  if (tr) { const sym = tr.sym || ('#' + addr);
    if (tr.npc) return [sym, short('clearing for ' + (tr.npc.hi || tr.npc.job || 'a meet'), 24)];
    if (tr.wantLift && !tr.lifted && v < 0.05) return [sym, 'waiting for the lift'];
    if (eng.lift && cut.path && cut.path.some(p => p.e === eng.lift.edge)) return [sym, 'on the lift'];
    if (v > 0.05) return [sym, `running ${mph} mph`];
    if ((tr.held || 0) > 2) return [sym, short('holding' + (tr.lastWhy ? ': ' + String(tr.lastWhy).replace(/^.*?(reserved|granted|track time|for)/i, '$1') : ''), 24)];
    return [sym, 'stopped']; }
  return ['#' + addr, v > 0.05 ? `running ${mph} mph` : 'stopped']; }
function symOfCut(eng, ai, cut) { for (const c of cut.cars) if (c.addr != null) { const tr = ai && (ai.trains || []).find(t => t.addr === c.addr); if (tr && tr.sym) return tr.sym; } return ''; }
/* [CHOCO-COMMODITY] + [CHOCO-LOADSTATE] car chip */
function carTag(c, sym) { const M = CM(); if (c.loco || c.type === 'loco' || (M.none || []).includes(c.type)) return null;
  let com = c.com, load = c.load;
  if (!com) for (const [re, lab, ld] of M.train || []) if (re.test(sym)) { com = lab; if (!load) load = ld; break; }
  if (!com && c.ind) { const g = String(c.ind).replace(/[^A-Z0-9]/g, ''); const R = (M.ind[c.ind] || M.ind[g] || {})[c.type]; if (R) { com = R[0]; if (!load && c.status) load = (R[1] === 'in') === (c.status === 'setout') ? 'loaded' : 'empty'; } }
  if (!com) com = (M.type || {})[c.type] || c.type;
  const w = c._cw; if (w && w.dir) return `◐ ${w.dir > 0 ? 'loading' : 'unloading'} ${short(com, 10)} ${Math.round(w.f * 100)}%`;
  let L = load === 'loaded' ? true : load === 'empty' ? false : null; if (L == null && w) L = w.f > 0.5; if (L == null) L = true;
  return L ? '● ' + short(com, 15) : '○ EMPTY ' + short(com, 12); }
/* [CHOCO-RADIOSRC] viewer-side speaker match: AI lines carry "🤖 JOB:", dispatcher lines name the train sym */
function scanRadio(eng, ai) { const log = eng.log || []; const now = performance.now() / 1000; const jobs = (eng.session && eng.session.jobs) || [], trs = (ai && ai.trains) || [];
  for (const e of log) { if (e.t < S.lastLog || (e.t === S.lastLog && e._seen)) continue; if (e._seen) continue; e._seen = 1; if (e.kind !== 'radio' && e.kind !== 'ai') continue;
    const m = /^🤖 ([^:]+):/.exec(e.text); let addr = null; if (m) { const j = jobs.find(j => j.id === m[1]); if (j) addr = j.addr; }
    else { const t = trs.filter(t => t.sym && e.text.indexOf(t.sym) >= 0).sort((a, b) => e.text.indexOf(a.sym) - e.text.indexOf(b.sym) || b.sym.length - a.sym.length)[0]; if (t) addr = t.addr; }
    if (addr != null) { S.radioAt[addr] = now; S.stats.radio++; } }
  if (log.length) S.lastLog = log[log.length - 1].t; }
const _v = new T3.Vector3(), _fr = new T3.Frustum(), _pm = new T3.Matrix4();
function update(H, dt) { const cb = document.getElementById('labels'); const on = !!(cb && cb.checked); const eng = H.engine, ai = H.ai, api = H._api;
  if (!eng || !api) return; if (!S.g) { S.g = new T3.Group(); S.g.name = 'choco-labels'; api.scene.add(S.g); }
  if (eng.log) scanRadio(eng, ai);
  if (!on) { if (S.on) { for (const sp of S.pool) sp.visible = false; S.on = false; S.stats.loco = S.stats.car = 0; } return; } S.on = true;
  const cam = api.camera, cp = cam.position; S.sortT -= dt; S.txtT -= dt;
  if (S.sortT <= 0 || !S.list.length) { S.sortT = 0.25; _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); const L = [], C = [];
    for (const cut of eng.cuts) { const sym = symOfCut(eng, ai, cut);
      for (const c of cut.cars) { const P = c._pose; if (!P || c._y == null) continue; _v.set(P.x, c._y + 1, P.y); const d = _v.distanceTo(cp); const isL = c.loco || c.type === 'loco';
        if (d > (isL ? RANGE.loco : RANGE.car) || !_fr.containsPoint(_v)) continue; (isL ? L : C).push({ c, cut, d, sym }); } }
    L.sort((a, b) => a.d - b.d); C.sort((a, b) => a.d - b.d); const seen = new Set(); S.list = [];
    for (const o of L) { if (seen.has(o.cut)) continue; const lead = o.cut.cars.find(x => x.addr != null && (x.loco || x.type === 'loco')); if (lead && lead !== o.c) continue; seen.add(o.cut); S.list.push({ ...o, k: 'loco' }); if (S.list.length >= CAP.loco) break; }
    for (const o of C.slice(0, CAP.car)) S.list.push({ ...o, k: 'car' }); }
  const refresh = S.txtT <= 0; if (refresh) S.txtT = 0.5; const now = performance.now() / 1000; let i = 0; S.stats.loco = S.stats.car = 0;
  const get = () => S.pool[i] || (S.pool[i] = mkSprite());
  for (const o of S.list) { const c = o.c, P = c._pose; if (!P) continue;
    if (o.k === 'loco') { const sp = get(); i++; const onR = now - (S.radioAt[c.addr] || -99) < RADIO_S; /* [CHOCO-RADIOICON] radio badge drawn into the loco tag (one sprite) */
      if (refresh || !sp.userData.key || sp.userData.for !== c || sp.userData.r !== onR) { const A = (o.act = refresh || !o.act ? activity(H, eng, ai, o.cut, c) : o.act); draw(sp, onR ? ['((•)) ' + A[0], A[1]] : A, onR ? 'locoR' : 'loco'); sp.userData.for = c; sp.userData.r = onR; }
      place(sp, P.x, c._y + 1.3, P.y, cam, 0); S.stats.loco++; if (onR) S.stats.radioOn = (S.stats.radioOn || 0) + 1; }
    else { const t = refresh || !get().userData.key || get().userData.for !== c ? carTag(c, o.sym) : null; const sp = get(); i++; if (t) { draw(sp, [t], 'car'); sp.userData.for = c; } else if (sp.userData.for !== c) { sp.visible = false; continue; } place(sp, P.x, c._y + 0.9, P.y, cam, 0); S.stats.car++; } }
  for (let k = i; k < S.pool.length; k++) S.pool[k].visible = false; S.used = i; }
window.L3D_LABELS = { update, state: S, activity, carTag };
})();
