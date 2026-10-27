/* ops3d.js — bridge between the ops simulator (tools/layout3d/ops) and the layout3d 3D viewer (viewer3d-v3).
   Loaded before viewer.js. Sets window.LAYOUT3D_OPS = { enabled, attach(api), update(dt), camera(dt, mode) }: the viewer then skips its
   own demo trains and lets the ops engine drive every car (same Engine/AI/PlanExec as the 2D game, so the 3D session is the same sim).
   Views: orbit / walk (viewer) + 5 = in-cab first person (engineer's seat, windshield frame, control stand, gauges, short hood, mouse look),
   6 = follow a person or car (click one, V = first person / chase), 7 = chase the selected train. Walkaround throttle: DCC panel (OpsControl).
   URL: ?ops=0 disables, &seed=N, &opsmode=auto|mixed, &rate=4, &ride=<loco addr>|first, &follow=1, &t=<pre-roll seconds>. */
(function () {
'use strict';
const QS = new URLSearchParams(location.search), D = window.OPS_DATA, OE = window.OpsEngine;
const H = window.LAYOUT3D_OPS = { enabled: !!(D && OE && window.THREE) && QS.get('ops') !== '0' };
if (!H.enabled) return;
const TYPE3D = { g32: 'covered_hopper', h51: 'covered_hopper', gbrx: 'tank', tk: 'tank', c60: 'boxcar', rf: 'reefer', c89: 'flat', f68: 'flat', well: 'well', ar: 'autorack', cb: 'centerbeam', gon: 'gondola', coil: 'coil', cp: 'hopper', amfleet: 'amfleet' };
const ROADCOL = { NS: '#1b1b1b', CSX: '#1d3f8a', BNSF: '#e05a1a', UP: '#f2c12e', AMTK: '#c0c4c8', Amtrak: '#c0c4c8', RJC: '#2a5d2a', CR: '#1d4f7a' };
let radio = null;   // ROUND4 two-way radio (ops/audio/radio.js, shared with the 2D game)
if (!window.OpsRadio) { const sc = document.createElement('script'); sc.src = 'ops/audio/radio.js'; sc.onload = () => { if (eng) mkRadio(); }; document.head.appendChild(sc); }
function mkRadio() { if (!window.OpsRadio || !eng) return; const old = radio; if (old) old.setOn(false); radio = OpsRadio.create(eng, { on: old ? old.on : false, chatter: old ? old.chatter : true, level: old ? old.level : 'full', volume: () => audio && audio.getVolume ? audio.getVolume('master') : 0.8 }); H.radio = radio; }
let api, scene, camera, eng, ai, audio = null, thr = null, seed = +(QS.get('seed') || (D.session && D.session.seed) || 1);
let mode = null, sel = null, look = { yaw: 0, pitch: -0.05, drag: null, flip: 0 }, follow = null, fp = false, rate = +(QS.get('rate') || 1), acc = 0, uiT = 0;
const inst = {}; let trucks = null; const T3 = THREE; const _m = new T3.Matrix4(), _q = new T3.Quaternion(), _p = new T3.Vector3(), _s = new T3.Vector3(1, 1, 1), _e = new T3.Euler(), _c = new T3.Color(), ZERO = new T3.Vector3(0, 0, 0);
H.state = () => ({ mode, sel, follow: follow && { kind: follow.kind, i: follow.i }, t: eng && eng.t, jobs: eng && eng.session.jobs.map(j => ({ id: j.id, at: j.exec ? j.exec.i : null, steps: j.plan ? j.plan.steps.length : 0, done: j.exec ? j.exec.done : null, fail: j.exec ? j.exec.fail : null })), violations: eng && eng.violations.slice(-10) });

/* [R30] L3: the engine only models the lift edge, so a train longer than the lift was drawn on the lift's straight line extended across S1-S5 (the
   'diagonal train'). Cars at level 3 are mapped onto the real L3 loop polyline (it runs through the lift): arc = loop arc at the lift centre + the car's
   signed offset along the lift axis, so every truck sits on the rails and coupler spacing is kept (arc length is preserved). */
function l3map(eng, P) { if (!(P.level > 2.5)) return P; const S3 = (window.LAYOUT || {}).l3, l = eng.lift; const LE = l && eng.E[l.edge]; if (!S3 || !LE || !LE.pts || LE.pts.length < 2) return P;
  let M = l3map.M; if (!M) { const lp = (S3.tracks.find(t => /loop/i.test(t.name)) || {}).pts; if (!lp || lp.length < 2) return P; const a = LE.pts[0], b = LE.pts[LE.pts.length - 1];
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, ax = b[0] - a[0], ay = b[1] - a[1], al = Math.hypot(ax, ay) || 1; const c = [0]; for (let k = 1; k < lp.length; k++) c.push(c[k - 1] + Math.hypot(lp[k][0] - lp[k - 1][0], lp[k][1] - lp[k - 1][1]));
    let bd = 1e9, s0 = 0; for (let k = 1; k < lp.length; k++) { const p0 = lp[k - 1], p1 = lp[k], dx = p1[0] - p0[0], dy = p1[1] - p0[1], L2 = dx * dx + dy * dy || 1e-9; const u = Math.max(0, Math.min(1, ((cx - p0[0]) * dx + (cy - p0[1]) * dy) / L2)); const d = Math.hypot(p0[0] + u * dx - cx, p0[1] + u * dy - cy); if (d < bd) { bd = d; s0 = c[k - 1] + u * Math.sqrt(L2); M = { sg: (dx * ax + dy * ay) >= 0 ? 1 : -1 }; } }
    const closed = Math.hypot(lp[0][0] - lp[lp.length - 1][0], lp[0][1] - lp[lp.length - 1][1]) < 0.05; M = Object.assign(M, { lp, c, len: c[c.length - 1], s0, cx, cy, ux: ax / al, uy: ay / al, closed }); l3map.M = M; }
  const u = (P.x - M.cx) * M.ux + (P.y - M.cy) * M.uy; let s = M.s0 + M.sg * u; if (M.closed) s = ((s % M.len) + M.len) % M.len; else s = Math.max(0, Math.min(M.len, s));
  let k = 1; while (k < M.c.length - 1 && M.c[k] < s) k++; const p0 = M.lp[k - 1], p1 = M.lp[k], f = Math.min(1, (s - M.c[k - 1]) / ((M.c[k] - M.c[k - 1]) || 1)), ta = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
  const la = Math.atan2(M.uy, M.ux) , rel = Math.cos(P.a - la) * M.sg >= 0 ? 0 : Math.PI;
  return Object.assign({}, P, { x: p0[0] + (p1[0] - p0[0]) * f, y: p0[1] + (p1[1] - p0[1]) * f, a: ta + rel }); }
function deckY(level) { const d1 = api.LV[0].deck, d2 = api.LV[1] ? api.LV[1].deck : d1; return d1 + (level - 1) * (d2 - d1); }
/* [EXT-RS] Grok rolling-stock glbs (assets/external.js): loco-<model> / car-<type3d>; rigged ones get trucks + wheelsets placed per car */
function extId(c) { const E = window.L3D && L3D.ext; if (!E || !E.rsHas) return null; const id = (c.loco || c.type === 'loco') ? (E.rsId ? E.rsId('loco', c.model, c.rr || c.road) : 'loco-' + String(c.model || '').toLowerCase().replace(/[^a-z0-9]/g, '')) :   /* [RS-ROAD] railroad-aware loco model */ (E.rsId ? E.rsId(TYPE3D[c.type] || c.type3d || 'boxcar', null, E.carRR ? E.carRR(c) : null, c.len) : 'car-' + (TYPE3D[c.type] || c.type3d || 'boxcar')); return E.rsHas(id) ? id : null; }   /* [VARIANT-HOOK] length-picked car variants */
function geoKey(c) { const x = extId(c); if (x) return `X|${x}|${(c.len || 5).toFixed(2)}`; if (c.loco || c.type === 'loco') return `L|${c.model || 'GP38-2'}|${c.road || 'NS'}|${(c.len || 4.45).toFixed(2)}`; const t = TYPE3D[c.type] || c.type3d || 'boxcar'; return `C|${t}|${(c.len || 5).toFixed(1)}|${hash(c.id || '') % 4}`; }
function hash(s) { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
function newSession(s, opsMode) {
  eng = new OE.Engine(D, { dispatch: 'auto', levels: api && api.NLEV }); ai = new OE.AI(eng); H.engine = eng; H.ai = ai; H.fc = (D.session && D.session.fast_clock) || 4; H.rateOf = () => rate;   /* [LOGI] town clock follows the ops session */
  OE.startSession(eng, ai, s, opsMode || QS.get('opsmode') || 'auto'); mkRadio();
  eng.on(ev => { if (!audio) return; const p = ev.pos ? { x: ev.pos.x, y: ev.pos.y, z: deckY(ev.pos.level || 1) } : null;
    if (ev.type === 'turnout' && p) audio.playAt('turnout', p); if (ev.type === 'couple' && p) audio.playAt('coupler', p); if (ev.type === 'uncouple' && p) audio.playAt('airhose', p); if (ev.type === 'violation' && /derail|collid/i.test(ev.text)) audio.playAt('derail', p || listenerPos()); });
  buildCars(); if (audio && audio.started) attachSounds(); if (thr) thr.refreshList();
}
// ------------------------------------------------------------------ rolling stock (InstancedMesh per model)
let _SLOTGEN = 0; /* [CHOCO-SLOTGEN] */
let _GHOSTSIG = null; /* [CHOCO-GHOST] signature of the car set drawn by the last buildCars */
function _carSig() { let n = 0, h = 0; for (const cut of eng.cuts) for (const c of cut.cars) { if (c._gh === undefined) c._gh = hash(String(c.id || c.addr || '')) | 1; n++; h = (h + Math.imul(c._gh, 2654435761)) >>> 0; } return n + ':' + h; }
function buildCars() { _SLOTGEN++; _GHOSTSIG = _carSig();
  for (const k in inst) { scene.remove(inst[k].grp || inst[k].mesh); delete inst[k]; } if (trucks) scene.remove(trucks);
  const cnt = {}, cars = []; for (const cut of eng.cuts) for (const c of cut.cars) { const k = geoKey(c); cnt[k] = (cnt[k] || 0) + 1; cars.push(c); }
  for (const k in cnt) { const [kind, a, b, li] = k.split('|');
    if (kind === 'X') { const grp = new T3.Group(); scene.add(grp); const m = L3D.ext.rsMesh(a, cnt[k] + 2, grp, +b); m.count = cnt[k] + 2; inst[k] = { mesh: m, n: 0, grp, ext: true }; continue; } const g = kind === 'L' ? L3D.rs.locoGeo(a, b, +li) : L3D.rs.carGeo(a, +b, +li || 0);
    const m = new T3.InstancedMesh(g, L3D.mat('livery'), cnt[k] + 2); m.frustumCulled = false; m.castShadow = true; m.instanceMatrix.setUsage(T3.DynamicDrawUsage); scene.add(m); inst[k] = { mesh: m, n: 0 }; }
  for (const c of cars) { c._key = geoKey(c); const e = inst[c._key]; c._slot = [e, e.n++, _SLOTGEN]; e.mesh.setColorAt(c._slot[1], grime(c)); }
  buildLoads(cars);
  trucks = new T3.InstancedMesh(L3D.rs.TRUCK2, L3D.mat('plain'), cars.length * 2 + 4); trucks.frustumCulled = false; trucks.instanceMatrix.setUsage(T3.DynamicDrawUsage); scene.add(trucks);
  for (const k in inst) { const e = inst[k]; for (let i = e.n; i < e.mesh.count; i++) { _m.compose(ZERO, _q.identity(), new T3.Vector3(0, 0, 0)); e.mesh.setMatrixAt(i, _m); if (e.mesh.rig) for (const kk of [0, 1]) e.mesh.setTruckAt(i, kk, _m, 0); } if (e.mesh.instanceColor) e.mesh.instanceColor.needsUpdate = true; }
}
function grime(c) {   // [WEATHER] per-car road grime: freight cars 0-30 % toward a dusty brown, locos 0-10 % (multiplies the livery texture)
  const id = String(c.id || c.num || c.addr || ''); let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); const r = ((h >>> 0) % 1000) / 1000;
  return _c.set('#ffffff').lerp(new T3.Color('#c8bba6'), (c.loco ? 0.1 : 0.3) * r); }
// [LIGHTS] headlight + ditch lights on the leading end of every moving consist (headlight dimmed when stopped, nothing when shoving with cars ahead);
// ditch lights alternate-flash while the horn sounds for a grade crossing. ?lights=0 disables.
const LT = { pool: [], beams: [], tex: null, flash: {}, head: new WeakMap() };
function lightSprite(sz) { if (!LT.tex) { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,246,214,0.95)'); gr.addColorStop(0.45, 'rgba(255,226,160,0.28)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); LT.tex = new T3.CanvasTexture(cv); }
  const sp = new T3.Sprite(new T3.SpriteMaterial({ map: LT.tex, color: 0xfff1d0, blending: T3.AdditiveBlending, depthWrite: false, transparent: true })); sp.scale.setScalar(sz); sp.renderOrder = 5; scene.add(sp); return sp; }
function trainLights() {
  if (QS.get('lights') === '0' || window.L3D_LIGHTS_OFF) { for (const sp of LT.pool) sp.visible = false; return; } let n = 0; const now = performance.now() / 1000;
  const TK = (window.L3D && L3D.ambience && L3D.ambience.k) || 0, KS = 1 + 0.9 * TK; let nb = 0;   /* [AMBIENCE] evening/night: brighter, bigger lights + a beam on the rails */
  const put = (x, y, z, sz, op, col) => { const sp = LT.pool[n] || (LT.pool[n] = lightSprite(sz)); n++; sp.visible = op > 0.01; sp.position.set(x, y, z); sp.scale.setScalar(sz); sp.material.opacity = op; sp.material.color.setHex(col || 0xfff1d0); };
  const beam = (x, y, z, a, op) => { if (TK < 0.3 || LOWQ) return; const m = LT.beams[nb] || (LT.beams[nb] = beamMesh()); nb++; m.visible = true; m.position.set(x, y, z); m.rotation.set(-Math.PI / 2, 0, -a); m.material.opacity = op * TK; };
  for (const cut of eng.cuts) { const cs = cut.cars; if (!cs.length || !cs.some(c => c.loco || c.type === "loco") || !cs[0]._pose) continue;
    const a = cs[0]._pose, b = cs[cs.length - 1]._pose; let hd = LT.head.get(cut) || null;
    const mv = cs[0]._mv; if (mv && Math.hypot(mv[0], mv[1]) > 1e-4) { const k = cs.length > 1 ? ((mv[0] * (a.x - b.x) + mv[1] * (a.y - b.y)) > 0 ? 0 : 1) : (mv[0] * Math.cos(a.a) + mv[1] * Math.sin(a.a) > 0 ? 0 : 1); hd = { k, d: [mv[0], mv[1]] }; LT.head.set(cut, hd); }
    if (!hd) continue; const lead = hd.k === 0 ? cs[0] : cs[cs.length - 1]; if (!(lead.loco || lead.type === 'loco') || !lead._pose) continue;   /* [R34] a trailing MU unit (loco:false) leading after a reversal gets the headlight */
    const P = lead._pose, dl = Math.hypot(hd.d[0], hd.d[1]) || 1; let ux = hd.d[0] / dl, uz = hd.d[1] / dl; const ca = Math.cos(P.a), sa = Math.sin(P.a), sg = ux * ca + uz * sa >= 0 ? 1 : -1; ux = ca * sg; uz = sa * sg;
    const half = (lead.len || 4.4) / 2 + 0.04, fx = P.x + ux * half, fz = P.y + uz * half, y = lead._y, mph = Math.abs(OE.MPH(cut.v || 0)), moving = mph > 0.5;
    put(fx, y + 0.74, fz, (moving ? 0.42 : 0.26) * KS, moving ? 0.95 : 0.4); if (moving) beam(fx + ux * 2.1, y + 0.012, fz + uz * 2.1, Math.atan2(uz, ux), 0.55);
    const fl = LT.flash[lead.addr] > now, ph = Math.floor(now * 3) % 2;
    for (const sd of [1, -1]) { const on = moving && (!fl || (sd > 0) === (ph === 0)); put(fx - uz * 0.15 * sd, y + 0.33, fz + ux * 0.15 * sd, 0.22 * KS, on ? 0.9 : 0); } }
  if (TK > 0.3) for (const a of AG) if (a.kind === 'car' && a.x !== undefined) { const c = Math.cos(a.h), sn = Math.sin(a.h), hl = a.hl || 0.5, hy = a.z + (a.ly || 0.13);   /* [AMBIENCE] road vehicles: head + tail lights after dark */
    for (const sd of [1, -1]) { put(a.x + c * hl - sn * 0.085 * sd, hy, a.y + sn * hl + c * 0.085 * sd, 0.17 * KS, 0.95); put(a.x - c * hl - sn * 0.09 * sd, hy + 0.01, a.y - sn * hl + c * 0.09 * sd, 0.11 * KS, 0.85, 0xff2a14); } }
  for (let i = n; i < LT.pool.length; i++) LT.pool[i].visible = false; for (let i = nb; i < LT.beams.length; i++) LT.beams[i].visible = false; }
function beamMesh() { const m = new T3.Mesh(new T3.PlaneGeometry(4.2, 1.1), new T3.MeshBasicMaterial({ map: LT.tex, color: 0xffe8b8, blending: T3.AdditiveBlending, depthWrite: false, transparent: true, polygonOffset: true, polygonOffsetFactor: -4 })); m.renderOrder = 4; scene.add(m); return m; }
// [AMBIENCE 2026-10-18] diesel exhaust: soft grey puffs from the stack, faint at idle, darker when notching up (only locos near the camera; off with ?q=low or ?smoke=0)
const SM = { pool: [], tex: null, acc: new WeakMap(), i: 0 }; const LOWQ = QS.get('q') === 'low';
function exhaust(dt) { if (LOWQ || QS.get('smoke') === '0' || !eng || dt <= 0) { for (const p of SM.pool) p.visible = false; return; }
  if (!SM.tex) { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); SM.tex = new T3.CanvasTexture(cv); }
  dt = Math.min(dt, 0.1); const cp = camera.position;
  for (const L of locos()) { const c = L.car, P = c._pose; if (!P || Math.hypot(P.x - cp.x, P.y - cp.z) > 45) continue; const t = eng.throttles[L.addr] || {}, mph = Math.abs(OE.MPH(L.cut.v || 0)), notch = Math.min(8, (t.speed || 0) / 65 * 8), hard = (t.speed || 0) > mph + 4;
    const rate = hard ? 8 : mph < 0.5 ? 2.5 : 3 + notch * 0.6, op = hard ? 0.75 : mph < 0.5 ? 0.5 : 0.52 + notch * 0.03; let ac = (SM.acc.get(c) || 0) + dt * rate;
    const ca = Math.cos(c._ang || P.a), sa = Math.sin(c._ang || P.a), len = c.len || 4.4;
    while (ac >= 1) { ac -= 1; let sp = SM.pool[SM.i]; if (!sp) { sp = SM.pool[SM.i] = new T3.Sprite(new T3.SpriteMaterial({ map: SM.tex, color: 0x6a6a68, depthWrite: false, transparent: true })); sp.renderOrder = 6; scene.add(sp); } SM.i = (SM.i + 1) % 140;
      sp.position.set(P.x + ca * len * 0.12, c._y + 1.22, P.y + sa * len * 0.12);   /* N-scale hood top is ~1.16 in above the rail */ sp.userData = { age: 0, life: hard ? 3.2 : 2.4, op, v: [(Math.random() - 0.5) * 0.06 - 0.05, 0.28 + Math.random() * 0.1, (Math.random() - 0.5) * 0.06] }; sp.material.color.setHex(hard ? 0x262624 : 0x3e4042); sp.visible = true; }
    SM.acc.set(c, ac); }
  for (const sp of SM.pool) { if (!sp.visible) continue; const u = sp.userData; u.age += dt; if (u.age > u.life) { sp.visible = false; continue; } const f = u.age / u.life; sp.position.x += u.v[0] * dt; sp.position.y += u.v[1] * dt * (1 - f * 0.6); sp.position.z += u.v[2] * dt; sp.scale.setScalar(0.14 + f * 0.7); sp.material.opacity = u.op * Math.min(1, u.age * 8) * (1 - f * f); } }
H.carBoxes = function () {   // [FLYPED] pedestrian collision boxes [x, z, angle, halfLen, halfWid, levelIndex]
  const out = []; if (!eng) return out; for (const cut of eng.cuts) for (const c of cut.cars) if (c._pose) out.push([c._pose.x, c._pose.y, c._pose.a, (c.len || 5) / 2, 0.38, Math.round(c._pose.level) - 1]);
  for (const a of AG) if (a.x !== undefined) out.push(a.kind === 'car' ? [a.x, a.y, a.h, (a.hl || 0.5) + 0.05, a.mk === 'car:veh-boxtruck' ? 0.26 : 0.22, a.lv] : [a.x, a.y, a.h, 0.03, 0.03, a.lv]); return out; };
/* [LOADS 2026-10-19] car loads that are not baked into the glb: loaded 68 ft flats (car-flat, deck 0.29 in above the rail) carry four strapped
   lumber bundles (load-lumber-stack.glb, 1.2 x 0.6 x 0.6 in). The well and centerbeam glbs already carry their containers / lumber.
   Loaded = car.load 'loaded' (session cars), empty = 'empty', unknown (through trains) = every other car by id. Needs both glbs, else nothing. */
const LD = { parts: null, cars: [] }; const LD_RULES = { 'car-flat': { id: 'load-lumber-stack', deck: 0.292, at: [-1.875, -0.625, 0.625, 1.875] } };
function buildLoads(cars) { const E = L3D.ext; if (LD.grp) scene.remove(LD.grp); LD.grp = null; LD.parts = null; LD.cars = []; if (!E || !E.has) return;
  for (const c of cars) { const x = extId(c), r = x && LD_RULES[x]; if (r && E.has(r.id)) LD.cars.push({ c, r }); } if (!LD.cars.length) return;
  const n = LD.cars.reduce((t, q) => t + q.r.at.length, 0); LD.grp = new T3.Group(); scene.add(LD.grp); LD.parts = E.instance(LD.grp, LD.cars[0].r.id, Array.from({ length: n }, () => new T3.Matrix4().makeScale(0, 0, 0)));
  LD.parts.forEach(m => m.instanceMatrix.setUsage(T3.DynamicDrawUsage)); }
const ldLoaded = c => c.load === 'loaded' ? true : c.load === 'empty' ? false : hash(c.id || '') % 2 === 0;
function placeLoads() { if (!LD.parts) return; let k = 0; const hideAddr = mode === 'cab' && sel != null ? sel : null;
  for (const { c, r } of LD.cars) { const P = c._pose, on = P && ldLoaded(c); for (const off of r.at) { if (on) { const a = c._ang; _p.set(P.x + Math.cos(a) * off, c._y + r.deck, P.y + Math.sin(a) * off); _q.setFromEuler(_e.set(0, -a, 0)); _s.setScalar(1); _m.compose(_p, _q, _s); } else _m.makeScale(0, 0, 0);
      for (const m of LD.parts) m.setMatrixAt(k, _m); k++; } }
  for (const m of LD.parts) m.instanceMatrix.needsUpdate = true; }
H._loads = LD;
/* [R36 P7] carwork: boxcar/reefer side doors slide open, covered-hopper roof hatches lift, and a visible cargo volume fills/empties (load fraction 0..1)
   while a car is WORKED: standing (cut speed 0), no locomotive in its cut, at an industry (c.ind) for > 20 s. A set-out car is worked toward the
   opposite state over CW.work sim-seconds (loaded -> empty, empty -> loaded); pickups / through cars keep their state. Doors close at 1/s as soon as a
   loco couples; if the cut moves while a door is still open the door is snapped shut and counted (CW.st.forced). carchk reads H.carwork. */
const CW = { work: +(QS.get('cwwork') || 1200), n: 0, g: null, m: {}, st: { forced: 0, nonmono: 0, outside: 0, worked: 0, frames: 0, openMoving: 0 } };
const CWT = { boxcar: { door: 1, h: 0.72, fl: 0.34, hw: 0.36, cargo: 0x8a6a3a }, reefer: { door: 1, h: 0.72, fl: 0.34, hw: 0.36, cargo: 0xd8d8d0 }, gondola: { h: 0.30, fl: 0.24, hw: 0.34, cargo: 0x6b5a4a, open: 1 }, coil: { h: 0.22, fl: 0.26, hw: 0.28, cargo: 0x9aa0a6, open: 1 }, covered_hopper: { hatch: 1, h: 0, fl: 0, hw: 0.34, cargo: 0 } };
for (const [k, v] of Object.entries({ c60: 'boxcar', c50: 'boxcar', x: 'boxcar', rf: 'reefer', gon: 'gondola', g32: 'covered_hopper', h51: 'covered_hopper' })) CWT[k] = CWT[v];   /* [CHOCO-COALHATCH] cp = open-top coal hopper: no roof hatches (they floated above the car as white squares) */   // ops roster codes
function cwBuild() { if (CW.g) scene.remove(CW.g); CW.g = new T3.Group(); CW.g.name = 'carwork'; scene.add(CW.g); const N = 600, box = new T3.BoxGeometry(1, 1, 1);
  const mk = (name, col, n) => { const m = new T3.InstancedMesh(box, new T3.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: name === 'door' ? 0.3 : 0 }), n); m.name = 'cw-' + name; m.frustumCulled = false; m.instanceMatrix.setUsage(T3.DynamicDrawUsage); m.count = 0; CW.g.add(m); return m; };
  CW.m = { dark: mk('dark', 0x0c0c0c, N), door: mk('door', 0x5a2a22, N), cargo: mk('cargo', 0xffffff, N), hatch: mk('hatch', 0x9a9a9a, N * 2) }; CW.m.cargo.instanceColor = new T3.InstancedBufferAttribute(new Float32Array(N * 3), 3); }
const _cwc = new T3.Color();
function placeCarwork() { if (!eng) return; if (!CW.g) cwBuild(); const dt = Math.max(0, Math.min(30, eng.t - (CW.lastT != null ? CW.lastT : eng.t))); CW.lastT = eng.t;  /* sim seconds */ const M = CW.m, cnt = { dark: 0, door: 0, cargo: 0, hatch: 0 }, now = eng.t; CW.st.frames++; CW.cars = [];
  const put = (k, x, y, z, a, sx, sy, sz) => { const i = cnt[k]++; if (i >= M[k].instanceMatrix.count) return -1; _p.set(x, y, z); _q.setFromEuler(_e.set(0, -a, 0)); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); M[k].setMatrixAt(i, _m); return i; };
  for (const cut of eng.cuts) { const moving = Math.abs(cut.v || 0) > 0.01, hasLoco = cut.cars.some(c => c.loco || c.type === 'loco');
    let _off = 0; for (const c of cut.cars) { const _o = _off; _off += c.len || 0; const T = CWT[c.type]; if (!T || !c._pose || c._y == null) continue; const w = c._cw || (c._cw = { f: ldLoaded(c) ? 1 : 0, door: 0, still: 0, dir: 0, spot: null });
      /* [CHOCO-ONSPOT 2026-10-27] a car is only worked when its centre stands on its own industry's spot track (waybill industry tid); parked elsewhere it holds its % and shows its plain load label */
      const _it = c.ind && (CW.indTrk || (CW.indTrk = Object.fromEntries((eng.D.industries || []).map(i => [i.id, i.tid]))))[c.ind]; let onSpot = false; if (_it && !moving && !hasLoco) { try { const l = eng.locate(cut, _o + (c.len || 0) / 2); onSpot = !!l && eng.e2t[l.e] === _it; } catch (e) { onSpot = false; } }
      w.still = moving ? 0 : w.still + dt; const workable = !moving && !hasLoco && !!c.ind && onSpot && w.still > 20; if (!workable && !moving && w.dir) { w.dir = 0; w.spot = null; }
      if (workable && w.spot == null) { w.spot = now; /* [CHOCO-ONSPOT resume] a partly worked car re-spotted resumes the same direction */ w.dir = c.status === 'setout' ? (w.wdir && w.f > 0 && w.f < 1 ? w.wdir : (w.f > 0.5 ? -1 : 1)) : 0; if (w.dir) { w.wdir = w.dir; CW.st.worked++; } } if (moving) { w.spot = null; w.dir = 0; }
      const tgt = (workable && (w.dir || c.status === 'pickup' || c.status === 'stay')) ? 1 : 0; w.door += Math.sign(tgt - w.door) * Math.min(Math.abs(tgt - w.door), dt * 1.0);
      if (moving && w.door > 0.02) { CW.st.forced++; w.door = 0; } if (moving && w.door > 0.02) CW.st.openMoving++;
      if (workable && w.dir && w.door > 0.9) { const f0 = w.f; w.f = Math.max(0, Math.min(1, w.f + w.dir * dt / CW.work)); if ((w.f - f0) * w.dir < -1e-9) CW.st.nonmono++; if (w.f === 0 || w.f === 1) { w.dir = 0; w.wdir = 0; /* [CHOCO-LOADSTATE] viewer-side only; the engine never reads .load */ if (w.f === 1) c.load = 'loaded'; else { c.load = 'empty'; c.wasCom = c.com || true; } } }
      const P = c._pose, a = c._ang, ca = Math.cos(a), sa = Math.sin(a), L = c.len || 4, y0 = c._y; CW.cars.push({ id: c.id, type: c.type, f: w.f, door: w.door, moving, x: P.x, z: P.y });
      if (T.door) { const dw = Math.min(0.75, L * 0.17), dh = 0.74; for (const sd of [-1, 1]) { const nx = -sa * sd, nz = ca * sd, off = T.hw + 0.06;
          if (w.door > 0.01) { put('dark', P.x + nx * (off + 0.004), y0 + T.fl + dh / 2 + 0.02, P.y + nz * (off + 0.004), a, dw * w.door, dh, 0.006);
            const ph = dh * 0.92 * w.f; if (ph > 0.01) { const i = put('cargo', P.x + nx * (off + 0.008), y0 + T.fl + 0.02 + ph / 2, P.y + nz * (off + 0.008), a, dw * w.door * 0.86, ph, 0.004); if (i >= 0) M.cargo.setColorAt(i, _cwc.setHex(T.cargo)); } }   // doorway view of the stacked load (height = load fraction)
          const sl = dw * w.door; put('door', P.x + nx * (off + 0.016) + ca * sl, y0 + T.fl + dh / 2 + 0.02, P.y + nz * (off + 0.016) + sa * sl, a, dw, dh + 0.03, 0.012); } }
      if (T.hatch) { const lift = Math.min(1, w.door); for (let k = -3; k <= 3; k += 2) { const ox = k * L / 8; put('hatch', P.x + ca * ox, y0 + 1.18 + 0.05 * lift, P.y + sa * ox, a, 0.16, 0.012, 0.16); } }
      if (T.cargo !== 0 && w.f > 0.01 && (T.open || w.door > 0.05)) { const il = (L - 0.5) * (T.open ? 1 : Math.min(1, w.f * 1.15)), ih = T.h * (T.open ? w.f : 0.85), iw = T.hw * 2 - 0.1;   /* inside the body: length L-0.5, width 2*hw-0.1, height <= wall */
        if (il > L - 0.4 || iw > T.hw * 2 || ih > T.h + 1e-6) CW.st.outside++; const i = put('cargo', P.x, y0 + T.fl + ih / 2, P.y, a, il, Math.max(0.01, ih), iw); if (i >= 0) M.cargo.setColorAt(i, _cwc.setHex(T.cargo)); } } }
  for (const k in M) { M[k].count = cnt[k]; M[k].instanceMatrix.needsUpdate = true; if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true; } }
H.carwork = CW; H._placeCars = () => placeCars();
const _cpv = new T3.Vector3();
function placeCars() {
  if (_carSig() !== _GHOSTSIG) { buildCars(); }   /* [CHOCO-GHOST] a train taken out of the sim (meet/track-time staging) leaves eng.cuts: rebuild so its bodies, trucks and loads are not left drawn frozen on the main */
  let ti = 0; const hideAddr = mode === 'cab' && sel != null ? sel : null;
  for (const cut of eng.cuts) for (let i = 0; i < cut.cars.length; i++) { const c = cut.cars[i]; if (!c._slot || c._slot[2] !== _SLOTGEN) { buildCars(); return; }
    const P = l3map(eng, eng.carPose(cut, i)), y = deckY(P.level) + api.RAILTOP; let ang = P.a; if (c._pose) c._mv = [P.x - c._pose.x, P.y - c._pose.y]; if ((c.loco || c.type === 'loco') && (c.fwd || 1) < 0) ang += Math.PI; /* [R34] trailing MU units carry type 'loco' but loco:false (only the lead is the throttle car) -> their fwd -1 flip was ignored: the NS 211 ET44s faced the same way */ if (c.rear && !c.loco) ang += Math.PI; /* [REVIEW1] rear cab unit faces out */ c._pose = P; c._ang = ang; c._y = y;
    _p.set(P.x, y, P.y); _q.setFromEuler(_e.set(0, -ang, 0)); const hid = hideAddr != null && c.loco && c.addr === hideAddr; _s.setScalar(hid ? 0 : 1); _m.compose(_p, _q, _s);
    const [e, k] = c._slot; e.mesh.setMatrixAt(k, _m); e.mesh.instanceMatrix.needsUpdate = true;
    if (e.ext) { const RG = e.mesh.rig ? e.mesh : null;   // glb carries its own trucks: hide the procedural ones; rigged: place truck_front/rear + spin wheelsets
      if (c._px !== undefined) { const dx = P.x - c._px, dy = P.y - c._py, sgn = (dx * Math.cos(ang) + dy * Math.sin(ang)) >= 0 ? 1 : -1; c._spin = (c._spin || 0) + sgn * Math.hypot(dx, dy) / ((RG && RG.wheelR) || 0.021); }   /* [R30] wheels roll the right way on a reversed (fwd -1) unit or when backing */ c._px = P.x; c._py = P.y;
      if (RG) { /* [RV2] each truck yaws to the track tangent at its own centre pin; couplers swing toward the mating knuckle on the track */
        let o0 = 0; for (let j = 0; j < i; j++) o0 += cut.cars[j].len; const flip = Math.abs(Math.atan2(Math.sin(ang - P.a), Math.cos(ang - P.a))) > 1.5, sc = hid ? 0 : 1;
        for (const kk of [0, 1]) { const ins = kk === 0 ? RG.insetFront : RG.insetRear, off = (kk === 0) !== flip ? o0 + c.len - ins : o0 + ins, A = eng.posAt(cut, off - 0.15), B = eng.posAt(cut, off + 0.15), Cc = eng.posAt(cut, off);
          const ta = Math.atan2(B.y - A.y, B.x - A.x) + (flip ? Math.PI : 0); _p.set(Cc.x, y, Cc.y); _q.setFromEuler(_e.set(0, -ta, 0)); _s.setScalar(sc); _m.compose(_p, _q, _s); RG.setTruckAt(k, kk, _m, c._spin || 0); }
        if (RG.setCouplerAt) { _p.set(P.x, y, P.y); _q.setFromEuler(_e.set(0, -ang, 0)); _s.setScalar(sc); _m.compose(_p, _q, _s); for (const kk of [0, 1]) { const pv = RG.couplerPivot(kk, _m, _cpv); if (!pv) continue; const K = eng.posAt(cut, (kk === 0) !== flip ? o0 + c.len : o0);
            let a = Math.atan2(K.y - pv.z, K.x - pv.x) - (ang + (kk === 0 ? 0 : Math.PI)); a = Math.atan2(Math.sin(a), Math.cos(a)); RG.setCouplerAt(k, kk, _m, -a); } } }
      for (let q = 0; q < 2; q++) { _m.compose(ZERO, _q.identity(), new T3.Vector3(0, 0, 0)); trucks.setMatrixAt(ti++, _m); } continue; }
    const inset = Math.min(0.62, c.len * 0.13); for (const sgn of [1, -1]) { const tx = P.x + Math.cos(P.a) * sgn * (c.len / 2 - inset), tz = P.y + Math.sin(P.a) * sgn * (c.len / 2 - inset);
      _p.set(tx, y, tz); _q.setFromEuler(_e.set(0, -P.a, 0)); _s.setScalar(1); _m.compose(_p, _q, _s); trucks.setMatrixAt(ti++, _m); } }
  for (; ti < trucks.count; ti++) { _m.compose(ZERO, _q.identity(), new T3.Vector3(0, 0, 0)); trucks.setMatrixAt(ti, _m); }
  trucks.instanceMatrix.needsUpdate = true; placeLoads(); try { placeCarwork(); } catch (e) { CW.err = e.message; }
  const lm = api.liftMesh(); if (lm && eng.lift) { const l = eng.lift; const lv = l.moving ? l.from + (l.to - l.from) * l.p : l.level; lm.position.y = deckY(lv); }
}
function locos() { const L = []; for (const cut of eng.cuts) for (const c of cut.cars) if (c.loco) L.push({ addr: c.addr, label: `${c.train || ''} ${c.road || ''} ${c.num || c.id || ''}`.trim(), car: c, cut }); return L; }
function locoByAddr(a) { return locos().find(l => l.addr === a); }
// ------------------------------------------------------------------ cab interior (N-scale inches, loco frame: +x forward, +y up, +z right)
let cab = null;
function buildCab() {
  const g = new T3.Group(); const M = c => new T3.MeshBasicMaterial({ color: c }); const dark = M('#2b2f33'), mid = M('#454b52'), black = M('#0d0f10'), face = M('#e9e6d8'), red = M('#d23a2a'), grn = M('#2ecc71'), amb = M('#f0a020');
  const box = (w, h, d, x, y, z, m) => { const b = new T3.Mesh(new T3.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  const X = 0.15, W = 0.37;   // windshield plane, half cab width (eye at z = +0.17, the engineer's side)
  box(0.02, 0.10, 2 * W, X, 0.20, 0, dark);             // header above the windshields
  box(0.02, 0.30, 2 * W, X, -0.20, 0, dark);            // sill / nose wall below
  box(0.02, 0.22, 0.05, X, 0.04, 0, dark);              // centre post
  box(0.02, 0.22, 0.04, X, 0.04, -W + 0.02, dark); box(0.02, 0.22, 0.04, X, 0.04, W - 0.02, dark);
  box(0.50, 0.02, 2 * W, -0.10, 0.25, 0, mid);          // roof
  for (const s of [-1, 1]) { box(0.50, 0.12, 0.02, -0.10, 0.19, s * W, dark); box(0.50, 0.26, 0.02, -0.10, -0.22, s * W, dark); box(0.04, 0.16, 0.02, -0.33, 0.03, s * W, dark); box(0.03, 0.16, 0.02, -0.02, 0.03, s * W, dark); }
  box(0.02, 0.5, 2 * W, -0.35, 0, 0, black);            // back wall
  box(0.12, 0.05, 0.62, X - 0.06, -0.08, 0, mid);       // dash / console under the windshield
  for (let i = 0; i < 4; i++) { const r = new T3.Mesh(new T3.CircleGeometry(0.014, 20), face); r.position.set(X - 0.125, -0.05, 0.08 + i * 0.045); r.rotation.y = -Math.PI / 2; r.rotation.x = 0; g.add(r);
    const n = new T3.Mesh(new T3.PlaneGeometry(0.002, 0.012), red); n.position.set(X - 0.126, -0.05, 0.08 + i * 0.045); n.rotation.y = -Math.PI / 2; n.userData.needle = i; g.add(n); }
  box(0.10, 0.11, 0.09, -0.02, -0.17, 0.02, mid);       // control stand (left of the engineer): throttle, reverser, brake valves
  const thrH = box(0.012, 0.05, 0.012, -0.02, -0.095, -0.01, amb); thrH.userData.throttle = true;
  box(0.012, 0.04, 0.012, -0.02, -0.10, 0.05, black); const led = box(0.01, 0.01, 0.01, 0.03, -0.11, 0.02, grn); led.userData.led = true;
  box(0.16, 0.03, 0.14, -0.12, -0.32, 0.17, mid);       // engineer's seat
  const hood = box(0.95, 0.2, 0.46, X + 0.5, -0.28, 0, M('#1b1b1b')); hood.userData.hood = true;   // short hood ahead
  box(0.06, 0.03, 0.03, X + 0.95, -0.17, 0.12, M('#ffd23a')); box(0.06, 0.03, 0.03, X + 0.95, -0.17, -0.12, M('#ffd23a'));  // number boards / ditch lights
  g.visible = false; scene.add(g); return g;
}
function cabCamera(dt) {
  const L = locoByAddr(sel); if (!L || !L.car._pose) return false; const c = L.car, P = c._pose;
  const ang = c._ang + look.flip, fx = Math.cos(ang), fz = Math.sin(ang), rx = -fz, rz = fx;
  const half = c.len / 2, ex = P.x + fx * (half - 1.25) + rx * 0.17, ez = P.y + fz * (half - 1.25) + rz * 0.17, ey = c._y + 0.92;
  if (!cab) cab = buildCab(); cab.visible = true; cab.position.set(ex - rx * 0.17 + fx * 0.15, ey, ez - rz * 0.17 + fz * 0.15); cab.rotation.set(0, -ang + 0, 0);
  const hood = cab.children.find(o => o.userData.hood); if (hood) hood.material.color.set(ROADCOL[c.road] || '#1b1b1b');
  const sp = Math.abs(OE.MPH(L.cut.v)); for (const o of cab.children) { if (o.userData.needle !== undefined) o.rotation.x = -1.2 + Math.min(2.4, (o.userData.needle === 0 ? sp / 40 : o.userData.needle === 1 ? 0.8 + 0.2 * Math.sin(eng.t) : 0.6) * 2.4);
    if (o.userData.throttle) { const t = eng.throttles[sel]; o.rotation.z = -0.6 * ((t && t.speed) || 0) / 65; } }
  const yaw = ang + look.yaw, pitch = look.pitch; camera.position.set(ex, ey, ez); camera.up.set(0, 1, 0);
  camera.lookAt(ex + Math.cos(yaw) * Math.cos(pitch), ey + Math.sin(pitch), ez + Math.sin(yaw) * Math.cos(pitch));
  if (camera.near !== 0.02 || camera.fov !== 72) { camera.near = 0.02; camera.fov = 72; camera.updateProjectionMatrix(); } return true;
}
function chaseCamera(dt) {
  const L = locoByAddr(sel); if (!L || !L.car._pose) return false; const c = L.car, P = c._pose, ang = c._ang + look.yaw;
  const tx = P.x - Math.cos(ang) * 14, tz = P.y - Math.sin(ang) * 14; _p.set(tx, c._y + 5 + look.pitch * 10, tz); camera.position.lerp(_p, Math.min(1, dt * 3)); camera.lookAt(P.x, c._y + 0.6, P.y); return true;
}
// ------------------------------------------------------------------ people and road vehicles (agents), crossing rules, follow camera
const AG = []; let agMesh = {}; let xings = [];
function initAgents() {
  for (const k in agMesh) scene.remove(agMesh[k]); agMesh = {}; AG.length = 0;
  if (window.L3D && L3D.logistics && L3D.logistics.active) return;   // [LOGI] the goal-driven town (logistics.js) supplies the road traffic and people
  const lvls = api.LV; let id = 0;
  lvls.forEach((o, li) => { const roads = (o.L.roads || []).filter(r => r.pts && r.pts.length > 1 && r.kind !== 'over'); roads.sort((a, b) => plen(b.pts) - plen(a.pts));
    roads.slice(0, 8).forEach((r, ri) => { const len = plen(r.pts); if (len < 12) return;
      for (let k = 0; k < (len > 60 ? 2 : 1); k++) AG.push({ id: id++, kind: 'car', lv: li, path: r.pts, w: r.w || 0.6, s: (k * 0.5 + ri * 0.13) * len % len, dir: k % 2 ? -1 : 1, v: 0, vmax: 1.6 + 0.6 * ((ri + k) % 3), len });
      for (let k = 0; k < 2; k++) AG.push({ id: id++, kind: 'person', lv: li, path: r.pts, w: r.w || 0.6, s: (0.3 + 0.37 * k + ri * 0.07) * len % len, dir: k % 2 ? 1 : -1, v: 0, vmax: 0.28 + 0.05 * k, len });   /* [REAL] 2.5-3 scale mph walking (was 0.8 mph) */ }); });
  const cars = AG.filter(a => a.kind === 'car'), ppl = AG.filter(a => a.kind === 'person');
  const mk = (geo, n, key) => { if (!n) return null; if (!geo.attributes.color) L3D.vcol(geo, L3D.WHITE); const m = new T3.InstancedMesh(geo, L3D.mat(key), n); m.frustumCulled = false; m.instanceMatrix.setUsage(T3.DynamicDrawUsage); scene.add(m); return m; };
  const VM = [['veh-sedan', 0.5], ['veh-suv', 0.52], ['veh-sedan', 0.5], ['veh-pickup', 0.55], ['veh-sedan', 0.5], ['veh-suv', 0.52], ['veh-boxtruck', 0.72, 0.2]];   /* [AMBIENCE] mixed road traffic (was all sedans) */
  cars.forEach((a, i) => { const v = VM[(i * 5 + 3) % VM.length]; a.mk = 'car:' + v[0]; a.hl = v[1]; a.ly = v[2] || 0.13; }); const byM = {}; for (const a of cars) (byM[a.mk] = byM[a.mk] || []).push(a);
  for (const k in byM) { agMesh[k] = mk(L3D.geo(k.slice(4)), byM[k].length, 'glossy'); agMesh[k].userData.mk = k; } agMesh.person = mk(L3D.geo('person-walk'), ppl.length, 'plain'); if (agMesh.person) agMesh.person.userData.mk = 'person';
  const CC = ['#b22222', '#1f4e8c', '#e8e8e8', '#333', '#c9a227', '#2f6f3e'], PC = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#f39c12', '#ecf0f1'];
  for (const k in byM) byM[k].forEach((a, i) => { a.slot = i; agMesh[k].setColorAt(i, _c.set(k === 'car:veh-boxtruck' ? ['#e8e8e8', '#f0c020', '#c8c8c8'][i % 3] : CC[(i + a.id) % CC.length])); }); ppl.forEach((a, i) => { a.slot = i; agMesh.person.setColorAt(i, _c.set(PC[i % PC.length])); });
  for (const k in agMesh) if (agMesh[k] && agMesh[k].instanceColor) agMesh[k].instanceColor.needsUpdate = true;
  // road/track crossings (grade crossings): bells + gates logic and AI horn
  if (L3D.crossings && L3D.crossings.built) { xings = L3D.crossings.list.map(c => ({ lv: c.lv, x: c.x, y: c.y, on: false, horn: {}, ref: c })); return; } // [XING] viewer crossings drive bells/horns/stops
  xings = []; for (const [li, o] of lvls.entries()) for (const r of o.L.roads || []) for (const e of D.graph.edges) { if (e.level !== li + 1) continue; const p = segX(r.pts, e.pts); if (p && !xings.some(x => x.lv === li && Math.hypot(x.x - p[0], x.y - p[1]) < 3)) xings.push({ lv: li, x: p[0], y: p[1], on: false, horn: {} }); }
}
function plen(P) { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; }
function at(P, s) { for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (s <= l || i === P.length - 1) { const f = Math.max(0, Math.min(1, s / (l || 1))); return [P[i - 1][0] + f * (P[i][0] - P[i - 1][0]), P[i - 1][1] + f * (P[i][1] - P[i - 1][1]), Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0])]; } s -= l; } return [P[0][0], P[0][1], 0]; }
function segX(A, B) { for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) { const p = A[i - 1], q = A[i], r = B[j - 1], s = B[j]; const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (!d) continue;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; } return null; }
function trainNear(lv, x, y, r) { for (const cut of eng.cuts) for (const c of cut.cars) { const P = c._pose; if (P && Math.round(P.level) === lv + 1 && Math.hypot(P.x - x, P.y - y) < r) return cut; } return null; }
function stepAgents(dt) {
  for (const x of xings) { const near = x.ref ? x.ref.on : trainNear(x.lv, x.x, x.y, 9); const on = !!near; if (on !== x.on) { x.on = on; audio && audio.crossing('x' + x.lv + ':' + x.x.toFixed(0) + ',' + x.y.toFixed(0), { x: x.x, y: x.y, z: deckY(x.lv + 1) }, on); } }
  for (const a of AG) {
    const ahead = at(a.path, Math.max(0, Math.min(a.len, a.s + a.dir * (a.kind === 'car' ? 2.2 : 0.6)))); let stop = false;
    let line = null; if (xings.length && xings[0].ref) { line = L3D.crossings.stopFor(a.lv, a.path, a.s, a.dir, a.kind); if (line !== null) { const left = a.dir * (line - a.s); if (left < 0.6 + a.v * 0.6) stop = true; } } // [XING] stop line
    if (!(xings.length && xings[0].ref)) for (const x of xings) if (x.lv === a.lv && x.on && Math.hypot(x.x - ahead[0], x.y - ahead[1]) < (a.kind === 'car' ? 2.0 : 0.9) && Math.hypot(x.x - at(a.path, a.s)[0], x.y - at(a.path, a.s)[1]) > 0.8) stop = true;
    a.v += Math.max(-dt * 2, Math.min(dt * 1, (stop ? 0 : a.vmax) - a.v)); a.wait = stop;
    a.s += a.dir * a.v * dt; if (line !== null && a.dir * (a.s - line) > 0 && a.dir * (a.s - a.dir * a.v * dt - line) <= 0.001) { a.s = line; a.v = 0; } { const lim = xings.length && xings[0].ref ? L3D.crossings.limits(a.lv, a.path, a.len) : [0, a.len]; if (a.s > lim[1]) { a.s = lim[1]; a.dir = -1; } if (a.s < lim[0]) { a.s = lim[0]; a.dir = 1; } } /* [XING] crossing at a road end: turn back before it */
    const p = at(a.path, a.s), off = a.kind === 'car' ? a.w * 0.22 * a.dir : (a.w / 2 + 0.12) * a.dir, h = p[2] + (a.dir < 0 ? Math.PI : 0);
    a.x = p[0] - Math.sin(p[2]) * off; a.y = p[1] + Math.cos(p[2]) * off; a.h = h; a.z = deckY(a.lv + 1) + 0.012;
    _p.set(a.x, a.z, a.y); _q.setFromEuler(_e.set(0, -h, 0)); _s.setScalar(1); _m.compose(_p, _q, _s); const m = agMesh[a.mk || a.kind]; if (m) { m.setMatrixAt(a.slot, _m); m.instanceMatrix.needsUpdate = true; } }
}
function followCamera(dt) {
  const a = follow; if (!a || a.x === undefined) return false;
  if (fp) { const eh = a.kind === 'person' ? 0.40 : 0.28, yaw = a.h + look.yaw; camera.position.set(a.x + Math.cos(a.h) * (a.kind === 'car' ? 0.1 : 0.05), a.z + eh, a.y + Math.sin(a.h) * (a.kind === 'car' ? 0.1 : 0.05));
    camera.lookAt(camera.position.x + Math.cos(yaw) * Math.cos(look.pitch), camera.position.y + Math.sin(look.pitch), camera.position.z + Math.sin(yaw) * Math.cos(look.pitch)); if (camera.near !== 0.02) { camera.near = 0.02; camera.updateProjectionMatrix(); } return true; }
  const yaw = a.h + Math.PI + look.yaw, d = a.kind === 'person' ? 3.2 : 4.5; _p.set(a.x + Math.cos(yaw) * d, a.z + (a.kind === 'person' ? 2.6 : 3.2) - look.pitch * 3, a.y + Math.sin(yaw) * d);
  camera.position.lerp(_p, Math.min(1, dt * 4)); camera.lookAt(a.x, a.z + 0.25, a.y); return true;
}
// ------------------------------------------------------------------ audio
function listenerPos() { return { x: camera.position.x, y: camera.position.z, z: camera.position.y }; }
function attachSounds() { for (const L of locos()) { const id = 'loco' + L.addr; audio.detachTrain(id);
  audio.attachToTrain(id, () => { const l = locoByAddr(L.addr); if (!l || !l.car._pose) return null; const t = eng.throttles[L.addr] || {}; const v = OE.MPH(l.cut.v);
    return { x: l.car._pose.x, y: l.car._pose.y, z: l.car._y, speedMph: v, notch: Math.round(Math.min(8, (t.speed || 0) / 65 * 8 + (Math.abs(v) > 0.5 ? 1 : 0))), curve: 0, braking: Math.abs(v) > 2 && (t.speed || 0) < Math.abs(v) - 3 }; }, { model: /GE|ES|AC44|Dash/i.test(L.car.model || '') ? 'GE' : 'EMD' }); } }
function hornLogic() { if (!audio) return; for (const L of locos()) { const v = Math.abs(OE.MPH(L.cut.v)); if (v < 6 || !L.car._pose) continue; const P = L.car._pose;
  for (const x of xings) { if (Math.round(P.level) !== x.lv + 1) continue; const d = Math.hypot(P.x - x.x, P.y - x.y); const k = L.addr; if (d < 16 && d > 6 && !(x.horn[k] > eng.t)) { x.horn[k] = eng.t + 40; audio.horn('loco' + k, 'crossing'); LT.flash[k] = performance.now() / 1000 + 14; } } } }
// ------------------------------------------------------------------ UI
function ui() {
  const css = document.createElement('style'); css.textContent = `#ops3d{position:fixed;left:8px;bottom:8px;width:250px;background:rgba(15,20,26,.88);color:#dde;font:12px system-ui;padding:8px;border-radius:8px;z-index:20;max-height:80vh;overflow:auto}
#ops3d button,#ops3d select{background:#2a3440;color:#eee;border:1px solid #456;border-radius:4px;padding:2px 6px;margin:1px;font-size:11px}#ops3d button.on{background:#d90;color:#000}
#ops3d .log{font:11px monospace;color:#9cf;max-height:90px;overflow:hidden;white-space:pre-wrap}#ops3d .dcc{background:#11161b;border-radius:8px;padding:6px;margin-top:6px}.dcc-head{display:flex;justify-content:space-between}.dcc-steps{cursor:pointer;color:#8cf}
.dcc-lcd{background:#9bb07a;color:#122;font:bold 13px monospace;padding:4px;border-radius:4px;margin:4px 0;display:flex;justify-content:space-between}.dcc-knob{width:64px;height:64px;border-radius:50%;margin:3px auto;background:radial-gradient(#555,#222);position:relative;cursor:ns-resize;border:2px solid #666}
.dcc-ind{position:absolute;left:29px;top:5px;width:4px;height:27px;background:#fc3;transform-origin:2px 27px;border-radius:2px}.dcc-row{display:flex;gap:3px;margin:3px 0;flex-wrap:wrap}.dcc-row.small{font-size:10px}.dcc-row input{width:3em}.estop{background:#a22!important}
.dcc-f{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}.dcc-f button{font-size:9px;padding:1px}.dcc-f button.on{background:#d90;color:#000}#ops3dtag{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;font:bold 13px system-ui;text-shadow:0 0 4px #000;pointer-events:none;display:none}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.id = 'ops3d'; el.innerHTML = `<b>Ops session</b> <span id="o3clock"></span><br>
   <select id="o3mode" title="Auto: AI runs every train incl. the locals. Mixed: AI runs through trains, you run the locals with the throttle."><option value="auto">AI runs the session</option><option value="mixed">Mixed (you run locals)</option></select>
   <select id="o3rate" title="sim speed"><option>1</option><option>2</option><option>4</option><option>8</option></select>× <button id="o3new" title="Restart the planned session from the start">New session</button><br>
   <select id="o3loco" style="width:150px"></select><br>
   <button id="o3cab" title="3: engineer's seat, drag to look, B = look back">🚂 Cab [3]</button><button id="o3chase" title="4">Chase [4]</button><button id="o3fol" title="7: follow the nearest person/car (7 again = next); or click one">👤 Follow [7]</button><button id="o3walk" title="2">Walk [2]</button>
   <button id="o3cred" title="Sound credits / licenses">Credits</button>
   <div id="o3credbox" style="display:none;max-width:320px;font-size:11px;background:#0008;padding:4px"></div>
   <button id="o3radio" title="Two-way radio: dispatcher, crews, yardmaster, detectors each with their own voice">📻 Radio</button><button id="o3chat" title="Crew chatter on/off">Chatter on</button><select id="o3rlvl"><option value="full">full</option><option value="essential">essential</option></select>
   <div id="o3jobs" style="margin-top:4px"></div><div id="o3feed" style="font:11px system-ui,sans-serif;max-height:120px;overflow-y:auto;background:#0006;padding:2px 4px;margin-top:3px"></div><div class="log" id="o3log"></div><div id="o3thr"></div>`;
  if (QS.get('ui') === '0') el.style.display = 'none';
  document.body.appendChild(el); const tag = document.createElement('div'); tag.id = 'ops3dtag'; document.body.appendChild(tag);
  const $ = id => document.getElementById(id);
  $('o3mode').value = QS.get('opsmode') || 'auto'; $('o3rate').value = String(rate);
  $('o3rate').onchange = e => rate = +e.target.value; $('o3new').onclick = () => { seed = 1; newSession(seed, $('o3mode').value); fillLocos(); };   /* [CHOCO-SEED1] always restart the planned session; seeds 2/3 have no local-job plans (locals stand by) */
  $('o3mode').onchange = e => newSession(seed, e.target.value);
  $('o3loco').onchange = e => { sel = +e.target.value; thr && thr.select(sel); };
  $('o3cred').onclick = () => { const b = $('o3credbox'); b.style.display = b.style.display === 'none' ? 'block' : 'none';
    b.innerHTML = '<button class="o3x" title="Close (Esc)" style="float:right;cursor:pointer">✕</button>' + (window.OpsAudioCredits || []).map(c => `<div><b>${c[0]}</b>: ${c[1]}${c[2] ? ` <a href="${c[2]}" target="_blank" rel="noopener" style="color:#9cf">source</a>` : ''}</div>`).join(''); };
  $('o3credbox').addEventListener('click', e => { if (e.target.classList.contains('o3x')) { e.stopPropagation(); $('o3credbox').style.display = 'none'; } });
  addEventListener('keydown', e => { if (e.key === 'Escape' && $('o3credbox').style.display !== 'none') { $('o3credbox').style.display = 'none'; e.stopImmediatePropagation(); } }, true);
  addEventListener('pointerdown', e => { const b = $('o3credbox'); if (b.style.display !== 'none' && !b.contains(e.target) && e.target !== $('o3cred')) b.style.display = 'none'; }, true);
  $('o3radio').onclick = () => { if (!radio) return; radio.setOn(!radio.on); $('o3radio').style.background = radio.on ? '#365' : ''; };
  $('o3chat').onclick = () => { if (!radio) return; radio.chatter = !radio.chatter; $('o3chat').textContent = radio.chatter ? 'Chatter on' : 'Chatter off'; };
  $('o3rlvl').onchange = e => { if (radio) radio.level = e.target.value; };
  $('o3cab').onclick = () => setOpsMode('cab'); $('o3chase').onclick = () => setOpsMode('chase'); $('o3fol').onclick = () => setOpsMode('follow'); $('o3walk').onclick = () => { setOpsMode(null); api.setMode('walk'); };
  if (window.OpsControl) thr = OpsControl.throttle($('o3thr'), { engine: eng, audio: { bell: (...a) => audio && audio.bell(...a), horn: (...a) => audio && audio.horn(...a) }, getLocos: () => locos().map(l => ({ addr: l.addr, label: l.label })), onSelect: a => { sel = a; $('o3loco').value = a; }, getSpeed: a => { const l = locoByAddr(a); return l ? OE.MPH(l.cut.v) : 0; } });
  fillLocos();
}
function fillLocos() { const s = document.getElementById('o3loco'); if (!s) return; const L = locos(); s.innerHTML = L.map(l => `<option value="${l.addr}">${l.label}</option>`).join(''); if (sel == null || !locoByAddr(sel)) sel = L.length ? L[0].addr : null; s.value = sel; thr && thr.refreshList(); }
function refreshUI() { const $ = id => document.getElementById(id); if (!$('o3clock')) return; const fc = (D.session && D.session.fast_clock) || 4, tm = 6 * 3600 + eng.t * fc; $('o3clock').textContent = `${String(Math.floor(tm / 3600) % 24).padStart(2, '0')}:${String(Math.floor(tm / 60) % 60).padStart(2, '0')} (4:1)`;
  $('o3jobs').innerHTML = eng.session.jobs.map(j => `${j.id}: ${j.exec ? (j.exec.done ? '✔ done' : j.exec.fail ? '✖ ' + j.exec.fail.slice(0, 40) : `${j.exec.i}/${j.exec.steps.length}`) : 'player'}`).join('<br>');
  $('o3log').textContent = eng.log.filter(l => l.kind !== 'radio').slice(-3).map(l => l.text).join('\n');
  if (radio) { const h = radio.html(8); if (h !== refreshUI.rh) { refreshUI.rh = h; $('o3feed').innerHTML = h; $('o3feed').scrollTop = 1e6; } }
  const tag = $('ops3dtag'); tag.style.display = mode === 'follow' && follow ? 'block' : 'none'; if (follow) tag.textContent = '';
  for (const [id, m] of [['o3cab', 'cab'], ['o3chase', 'chase'], ['o3fol', 'follow']]) $(id).classList.toggle('on', mode === m); }
function setOpsMode(m) { mode = m; look.yaw = 0; look.pitch = m === 'cab' ? -0.05 : 0; look.flip = 0; if (cab) cab.visible = false;
  if (m) { if (api.getMode() === 'walk' && api.plc.isLocked) api.plc.unlock(); api.setMode('cab'); api.orbit.enabled = false; }
  if (m === 'follow' && !follow) follow = nearestAgent(); if (!m) { camera.near = 0.1; camera.fov = 60; camera.updateProjectionMatrix(); } }
function nearestAgent() { let b = null, bd = 1e9; for (const a of AG) { if (a.x === undefined) continue; const d = Math.hypot(a.x - camera.position.x, a.y - camera.position.z); if (d < bd) { bd = d; b = a; } } return b || AG[0]; }
function bindInput() {
  const dom = api.renderer.domElement; let down = null;
  dom.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; look.drag = [e.clientX, e.clientY]; audio && audio.start(); });
  addEventListener('pointermove', e => { if (!look.drag || !mode) return; const dx = e.clientX - look.drag[0], dy = e.clientY - look.drag[1]; look.drag = [e.clientX, e.clientY]; look.yaw += dx * 0.005; look.pitch = Math.max(-1.2, Math.min(1.0, look.pitch - dy * 0.005)); });
  addEventListener('pointerup', e => { look.drag = null; if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) pick(e); down = null; });
  addEventListener('keydown', e => { if (/input|select|textarea/i.test(e.target.tagName)) return; const k = e.code;
    if (k === 'Digit7') { follow = mode === 'follow' ? AG[(AG.indexOf(follow) + 1) % AG.length] : (follow || nearestAgent()); setOpsMode('follow'); }   /* [FLYPED] 5 = Fly, 6 = Pedestrian (viewer); ops cab = 3, chase = 4 */
    else if (/Digit[1-6]/.test(k)) { setOpsMode(null); }
    else if (k === 'KeyV' && mode === 'follow') fp = !fp; else if (k === 'KeyB' && mode === 'cab') look.flip = look.flip ? 0 : Math.PI;
    else if (k === 'BracketRight' || k === 'BracketLeft') { const L = locos(); const i = L.findIndex(l => l.addr === sel); sel = L[(i + (k === 'BracketRight' ? 1 : L.length - 1)) % L.length].addr; fillLocos(); }
    else if (mode === 'cab' && thr && thr.key && !/Digit|Space/.test(k)) thr.key(e); });
}
function pick(e) {
  const r = new T3.Raycaster(), v = new T3.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); r.setFromCamera(v, camera);
  const objs = [...Object.values(agMesh), ...Object.values(inst).map(x => x.mesh)].filter(Boolean); const hit = r.intersectObjects(objs, false)[0]; if (!hit) return;
  if (hit.object.userData.mk) { const mkk = hit.object.userData.mk; follow = AG.find(a => (a.mk || a.kind) === mkk && a.slot === hit.instanceId); setOpsMode('follow'); return; }
  for (const L of locos()) if (L.car._slot && L.car._slot[0].mesh === hit.object && L.car._slot[1] === hit.instanceId) { sel = L.addr; fillLocos(); return; }
}
// ------------------------------------------------------------------ hook API used by viewer.js
H.attach = function (a) {
  api = a; scene = a.scene; camera = a.camera; H._api = a; /* [CHOCO-LABELS] */
  newSession(seed, QS.get('opsmode') || 'auto'); initAgents(); ui(); bindInput();
  if (window.OpsAudio) { audio = OpsAudio.create(); H.audio = audio; addEventListener('pointerdown', () => { if (audio.start()) attachSounds(); }, { once: true }); }
  const pre = +(QS.get('t') || 0); for (let k = 0; k < pre / 0.05; k++) { eng.tick(0.05); }
  placeCars(); stepAgents(0);
  const ride = QS.get('ride'); if (ride) { if (ride !== 'first') sel = +ride; setOpsMode('cab'); } if (QS.get('follow')) { stepAgents(0.01); follow = AG[+(QS.get('follow')) % Math.max(1, AG.length)]; fp = QS.get('fp') === '1'; setOpsMode('follow'); }
  if (QS.get('chase')) setOpsMode('chase');
  H.agents = AG; window.__ops3d = H; H.slotGen = () => _SLOTGEN; H.inst = () => inst; /* [CHOCO-OVERLAPGATE] read-only probe hook */ if (window.L3D_LIFE3) L3D_LIFE3.attach(H); /* [CHOCO-LIFE3D] */ /* [UI] viewer shell (app/ui.js) train list */ H.uiApi = { locos: () => locos().map(l => ({ addr: l.addr, label: l.label, train: l.car.train || '', road: l.car.road || '', mph: Math.abs(OE.MPH(l.cut.v)), pos: l.car._pose ? { x: l.car._pose.x, y: l.car._pose.y, level: Math.round(l.car._pose.level) } : null })), select: a => { sel = a; if (thr) thr.select(a); const s = document.getElementById('o3loco'); if (s) s.value = a; }, setOpsMode, getMode: () => mode, getSel: () => sel, throttle: () => sel != null && eng.throttles[sel], speed: () => { const l = locoByAddr(sel); return l ? Math.abs(OE.MPH(l.cut.v)) : 0; }, consist: () => { const l = locoByAddr(sel); return l && eng.consistOf ? eng.consistOf(l.cut) : null; }, horn: () => audio && audio.horn('loco' + sel, 'long'), bell: on => audio && audio.bell('loco' + sel, on) }; // H.agents: read-only test hook (crossing stop-line check)
};
H.lookAtCar = function (pred, dist = 14, h = 6) {   // test/screenshot helper: park an orbit-style camera beside the first car matching pred
  for (const cut of eng.cuts) for (const c of cut.cars) if (c._pose && pred(c)) { setOpsMode(null); const P = c._pose, y = c._y; const nx = -Math.sin(P.a), nz = Math.cos(P.a);
    H.fixedCam = { x: P.x + nx * dist + Math.cos(P.a) * dist * 0.4, y: y + h, z: P.y + nz * dist + Math.sin(P.a) * dist * 0.4, tx: P.x, ty: y + 0.5, tz: P.y }; return true; } return false; };
H._fx = function (dt) { trainLights(); exhaust(dt); }; H._sm = SM;   // screenshot/test helper: lights + exhaust only (engine frozen)
H.update = function (dt) {
  if (!eng) return; acc += dt * rate; let n = 0; while (acc >= 0.05 && n++ < 400) { eng.tick(0.05); acc -= 0.05; }
  placeCars(); stepAgents(dt * Math.min(rate, 4)); trainLights(); exhaust(dt); hornLogic(); if (radio) radio.poll(); if (window.L3D_LABELS) try { L3D_LABELS.update(H, dt); } catch (e) { if (!H._lblErr) { H._lblErr = 1; console.warn('labels', e); } } /* [CHOCO-LABELS] */
  if (audio && audio.started) { const yaw = Math.atan2(camera.getWorldDirection(_p).z, _p.x); audio.setListener(camera.position.x, camera.position.z, camera.position.y, yaw);
    const fc = (D.session && D.session.fast_clock) || 4; if (!H._water) H._water = api.LV.flatMap(o => (o.water || []).map(P => ({ x: P.reduce((t, q) => t + q[0], 0) / P.length, y: P.reduce((t, q) => t + q[1], 0) / P.length })));   /* [REAL] frogs near the river / ponds */
    audio.setAmbient({ hour: (6 + eng.t * fc / 3600) % 24, water: H._water, industry: D.industries.slice(0, 6).map(i => { const t = eng.trk[i.tid], nd = eng.N[t.a]; return { x: nd.x, y: nd.y }; }) }); }
  if ((uiT += dt) > 0.4) { uiT = 0; refreshUI(); }
  if ((H._xt = (H._xt || 0) + dt) > 2) { H._xt = 0; if (eng.cuts.some(cut => cut.cars.some(c => c._key !== undefined && c._key !== geoKey(c)))) buildCars(); }   // [EXT-RS] glbs load async: swap in when ready
};
H.camera = function (dt, viewerMode) {
  if (H.fixedCam) { const f = H.fixedCam; camera.position.set(f.x, f.y, f.z); camera.lookAt(f.tx, f.ty, f.tz); return true; }
  if (!mode) { if (cab) cab.visible = false; return false; }
  if (viewerMode !== 'cab') { setOpsMode(null); return false; }
  if (mode === 'cab') return cabCamera(dt) || (setOpsMode(null), false);
  if (cab) cab.visible = false;
  if (mode === 'chase') return chaseCamera(dt);
  if (mode === 'follow') return followCamera(dt);
  return false;
};
})();
