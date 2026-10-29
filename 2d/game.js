/* Ops game — top-down operating session on the plan's real track graph. Data: window.OPS_DATA (build_ops.py). */
(function () {
'use strict';
const D = window.OPS_DATA, OE = window.OpsEngine, Q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id), cv = $('cv'), cx = cv.getContext('2d');
const TEST = Q.has('test'), errs = [];
let eng, ai, audio = window.OpsAudio ? OpsAudio.create() : null, thr, view = { mode: 'both', zoom: 1, px: 0, py: 0 }, sel = { addr: null, agent: null }, rate = 1, myJob = null;
const W = D.extent[0], H = D.extent[1];
const COL = { main: '#3c3c3c', siding: '#4d5a6a', spur: '#6b5a44', lift: '#888' };
const CARCOL = { h51: '#9aa3a8', g32: '#b9b2a2', rf: '#e8e8e8', tk: '#222', gbrx: '#333', cb: '#a2562a', c60: '#7a2e24', gon: '#4e3b2c', coil: '#3b4a5e', f68: '#5a4632', c89: '#5a4632', well: '#555c66', ar: '#7d8288', cp: '#3a2d26', amfleet: '#c8ccd2' };
const LONG = new Set(['rf', 'cb', 'c89', 'ar', 'amfleet']);   // > 68 ft: not allowed on #4 ladders
const clockStart = 6 * 3600, FAST = (D.session && D.session.fast_clock) || 4;

// --------------------------------------------------------------------------- session
function newSession(seed, mode) {
  eng = new OE.Engine(D, { dispatch: mode === 'manual' ? 'manual' : 'auto', levels: +(Q.get('levels') || 0) || undefined }); ai = new OE.AI(eng); eng.on(onEvent);
  OE.startSession(eng, ai, seed, mode);
  if (window.OpsRadio) { const old = radio; if (old) old.setOn(false); radio = OpsRadio.create(eng, { on: old ? old.on : false, chatter: old ? old.chatter : true, level: old ? old.level : 'full', volume: () => audio ? audio.getVolume('master') : 0.8 }); }   // ROUND4 two-way radio
  myJob = eng.session.jobs[0]; sel.addr = myJob ? myJob.addr : null;
  if (audio) attachSounds();
  fillJobs(); thr && thr.refreshList(); if (thr && sel.addr) thr.select(sel.addr);
  blueFlags();
}
function keyOf(c) { const m = { covered_hopper: c.len < 4 ? 'g32' : 'h51', tank: c.len > 4.5 ? 'gbrx' : 'tk', boxcar: 'c60', reefer: 'rf', flat: c.len > 6 ? 'c89' : 'f68', well: 'well', autorack: 'ar', centerbeam: 'cb', gondola: 'gon', coil: 'coil', hopper: 'cp', amfleet: 'amfleet' }; return m[c.type] || c.type; }
function dirClockwise(eid) { const e = eng.E[eid], p = e.pts, a = p[0], b = p[p.length - 1], cxm = W / 2, cym = H / 2;
  const cross = (a[0] - cxm) * (b[1] - a[1]) - (a[1] - cym) * (b[0] - a[0]); return cross > 0 ? 1 : -1; }   // screen y down: cross>0 = clockwise
function startAI(j) { return OE.startJobAI(eng, ai, j); }
let blue = [];
function blueFlags() { blue = []; for (const i of D.industries) { const lv = D.scene[eng.trk[i.tid].level - 1]; const t = eng.trk[i.tid]; const n = eng.N[t.a];
    if ((lv.labels || []).some(l => /blue flag/i.test(l.text || '') && Math.hypot(l.x - n.x, l.y - n.y) < 25)) blue.push({ tid: i.tid, until: 20 * 60 }); } }

// --------------------------------------------------------------------------- events -> sound, toasts
function onEvent(ev) {
  if (audio && ev.pos) { const p = { x: ev.pos.x, y: ev.pos.y, z: 0 };
    if (ev.type === 'couple') audio.playAt(ev.speed > 4 ? 'clank' : 'coupler', p); if (ev.type === 'uncouple') audio.playAt('airhose', p);
    if (ev.type === 'turnout') audio.playAt('turnout', p); if (ev.type === 'collision') audio.playAt('derail', p); }
  if (audio && ev.type === 'lift') audio.playAt('liftmotor', { x: 128, y: 60, z: 0 });
  if (ev.type === 'violation') toast(ev.text);
}
function toast(t) { const el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => el.style.display = 'none', 3500); }
function attachSounds() {
  for (const c of eng.cuts) for (const car of c.cars) if (car.loco) {
    const a = car.addr; audio.attachToTrain('loco' + a, () => { const cut = eng.locoCut(a); if (!cut) return null; const i = cut.cars.findIndex(x => x.addr === a); const p = eng.carPose(cut, i); const th = eng.throttles[a];
      const sp = OE.MPH(Math.abs(cut.v)); const notch = th ? Math.min(8, Math.round((th.speed > OE.MPH(Math.abs(cut.v)) + 1 ? 3 : 1) + sp / 6)) : 0;
      return { x: p.x, y: p.y, z: 0, speedMph: sp, notch: th && th.speed ? notch : 0, braking: th && th.speed < sp - 1, curve: curv(cut) }; }, { model: /ET44|ES44|P42/.test(car.model || '') ? 'GE' : 'EMD' }); }
}
function curv(cut) { const a = eng.posAt(cut, 0).a, b = eng.posAt(cut, Math.min(cut.len, 6)).a; let d = Math.abs(b - a) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d > 0.12 ? 1 : 0; }

// --------------------------------------------------------------------------- agents (people, vehicles)
const agents = [];
function initAgents() {
  agents.length = 0; const r = OE.rng(7);
  D.scene.forEach((lv, li) => {
    for (const rd of (lv.roads || [])) { if (!rd.pts || rd.pts.length < 2) continue; const n = Math.max(1, Math.floor(len(rd.pts) / 40));
      for (let i = 0; i < n && agents.length < 60; i++) agents.push({ kind: 'vehicle', level: li + 1, pts: rd.pts, s: r() * len(rd.pts), dir: r() < .5 ? 1 : -1, v: 2.4 + r() * 0.8, name: ['pickup', 'sedan', 'farm truck', 'semi', 'UPS van'][Math.floor(r() * 5)], col: ['#c33', '#36c', '#ddd', '#2a2', '#963'][Math.floor(r() * 5)] }); }
    for (const p of (lv.people || []).slice(0, 25)) { const rd = nearestRoad(lv, p); agents.push({ kind: 'person', level: li + 1, home: p, pts: rd ? rd.pts : null, s: rd ? projS(rd.pts, p) : 0, dir: r() < .5 ? 1 : -1, v: 0.33, off: 0.9, name: ['shopper', 'railfan', 'farmer', 'kid', 'dog walker', 'carman'][Math.floor(r() * 6)], col: '#fc8' }); }
  });
  // road/track crossings
  crossings = []; D.scene.forEach((lv, li) => { for (const rd of lv.roads || []) for (const e of eng.E) { if (e.level !== li + 1 || !e.pts) continue; const x = segX(rd.pts, e.pts); if (x) crossings.push({ level: li + 1, x: x[0], y: x[1], e: e.id, on: false }); } });
}
let crossings = [];
function len(P) { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; }
function at(P, s) { for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (s <= l || i === P.length - 1) { const f = Math.max(0, Math.min(1, s / (l || 1))); return [P[i - 1][0] + f * (P[i][0] - P[i - 1][0]), P[i - 1][1] + f * (P[i][1] - P[i - 1][1]), Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0])]; } s -= l; } return [P[0][0], P[0][1], 0]; }
function nearestRoad(lv, p) { let b = null, bd = 30; for (const rd of lv.roads || []) for (const q of rd.pts || []) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; b = rd; } } return b; }
function projS(P, p) { let s = 0, best = 0, bd = 1e9; for (let i = 0; i < P.length; i++) { if (i) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); const d = Math.hypot(P[i][0] - p[0], P[i][1] - p[1]); if (d < bd) { bd = d; best = s; } } return best; }
function segX(A, B) { for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j += 1) { const p = A[i - 1], q = A[i], r = B[j - 1], s = B[j]; const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (!d) continue;
  const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; } return null; }
function tickAgents(dt) {
  for (const x of crossings) { const was = x.on; x.on = eng.cuts.some(c => { const o = eng.occupancy(c); if (o[x.e]) return true; const h = eng.posAt(c, c.len), t = eng.posAt(c, 0); return Math.abs(c.v) > 0.2 && Math.min(Math.hypot(h.x - x.x, h.y - x.y), Math.hypot(t.x - x.x, t.y - x.y)) < 18 && Math.round(h.level) === x.level; });
    if (audio && was !== x.on) audio.crossing(x.x + ',' + x.y, { x: x.x, y: x.y, z: 0 }, x.on); }
  for (const a of agents) { if (!a.pts) continue; const L = len(a.pts); let v = a.v;
    const [px, py] = at(a.pts, a.s); const ahead = at(a.pts, a.s + a.dir * 4);
    if (crossings.some(x => x.on && x.level === a.level && Math.hypot(x.x - ahead[0], x.y - ahead[1]) < 3.5 && Math.hypot(x.x - px, x.y - py) > 1)) v = 0;   // stop for the crossing
    if (a.kind === 'vehicle' && agents.some(b => b !== a && b.kind === 'vehicle' && b.pts === a.pts && b.dir === a.dir && (b.s - a.s) * a.dir > 0 && (b.s - a.s) * a.dir < 3)) v = 0;  // no overlap
    a.s += a.dir * v * dt; if (a.s < 0 || a.s > L) { a.dir = -a.dir; a.s = Math.max(0, Math.min(L, a.s)); } a.moving = v > 0; }
}
function agentPos(a) { if (!a.pts) return { x: a.home[0], y: a.home[1], a: 0 }; const [x, y, ang] = at(a.pts, a.s); const o = a.kind === 'person' ? a.off : (a.dir > 0 ? 0.35 : -0.35); return { x: x - Math.sin(ang) * o, y: y + Math.cos(ang) * o, a: a.dir > 0 ? ang : ang + Math.PI }; }
/* [CHOCO-LIFE 2026-10-25] PHASE3-PLAN.md step 1: people, vehicles and animals from the rev6h plan tables (lot counts, fleets, sites).
   DRAWING ONLY: own RNG, reads eng state (car poses) and never writes it, so ops timing is untouched.
   Rules: everything stays on benchwork (boards + polys, >= 0.32 in); vehicles use the road graph, lots, aprons and lanes only;
   STOP where a private drive meets a public road; full stop at a grade crossing and go only when no car stands or moves on the
   crossed track within 300 ft scale (22.5 in); never more parked vehicles than the lot's stalls; nothing walks across track.
   Replaces the old random road agents (initAgents / tickAgents / agentPos redefined below; later declarations win). */
const LIFE = (() => {
  const MPH = m => m * 17.6 / 160, H = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let seed = 90017; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const SC = D.scene, TRIPS = [], ENT = [], SPAWN = [], NOTES = [], STAT = { through: 0, visits: 0, crossWaits: 0, crossings: 0, despawn: 0 };
  let T = 0, idn = 0, lastScan = -9, CARS = { 1: [], 2: [] };
  const inPoly = (p, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const on1 = (li, x, y) => { const S = SC[li - 1]; for (const b of S.boards || []) if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return true; for (const P of S.polys || []) if (inPoly([x, y], P)) return true; return false; };
  const onB = (li, x, y, m = 0.32) => on1(li, x, y) && on1(li, x + m, y) && on1(li, x - m, y) && on1(li, x, y + m) && on1(li, x, y - m);
  const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1e-9; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L; t = Math.max(0, Math.min(1, t)); return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy), t]; };
  const segX = (p, q, r, s) => { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (!d) return null;
    const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null; };
  /* ---- track index (grid, 2 in cells) per level */
  const TG = { 1: new Map(), 2: new Map() }, GK = (x, y) => (Math.floor(x / 2) * 1000 + Math.floor(y / 2));
  for (const e of eng.E) { if (!e.pts || !(e.level === 1 || e.level === 2) || e.lift) continue; for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1], b = e.pts[i];
    const x0 = Math.floor(Math.min(a[0], b[0]) / 2) - 1, x1 = Math.floor(Math.max(a[0], b[0]) / 2) + 1, y0 = Math.floor(Math.min(a[1], b[1]) / 2) - 1, y1 = Math.floor(Math.max(a[1], b[1]) / 2) + 1;
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = gx * 1000 + gy; if (!TG[e.level].has(k)) TG[e.level].set(k, []); TG[e.level].get(k).push([a, b, e.id]); } } }
  const trackD = (li, p) => { const L = TG[li] && TG[li].get(GK(p[0], p[1])); let m = 9; if (L) for (const [a, b] of L) m = Math.min(m, segD(p, a, b)[0]); return m; };
  const LIFT = D.graph.lift; const liftD = p => LIFT ? segD(p, LIFT.pts[0], LIFT.pts[LIFT.pts.length - 1])[0] : 9;
  const tidOf = {}; for (const t of D.tracks) for (const e of t.edges) tidOf[e] = t.id;
  const inStruct = (li, p, m = 0) => (SC[li - 1].structures || []).some(s => p[0] > s.r[0] + m && p[0] < s.r[2] - m && p[1] > s.r[1] + m && p[1] < s.r[3] - m);
  /* ---- road graph per level: roads split at T-junctions (an endpoint within half a road width of another road) */
  const CLS = n => /NC-\d|Weyerhaeuser|US-17/.test(n) && !/Yard Rd/.test(n) ? 'pub' : /Main St/.test(n) ? 'town' : /fuel/.test(n) ? 'lane' : /Yard Rd/.test(n) ? 'yard' : 'ind';
  const VMAX = { pub: MPH(45), town: MPH(25), ind: MPH(15), yard: MPH(10), lane: MPH(10), lot: MPH(5), rev: MPH(4) };
  const G = {};
  for (const li of [1, 2]) { const R = (SC[li - 1].roads || []).filter(r => r.pts && r.pts.length > 1); const cuts = R.map(r => r.pts.slice(1).map(() => [])), links = [];
    R.forEach((r, k) => [0, r.pts.length - 1].forEach(ei => { const q = r.pts[ei]; R.forEach((o, i) => { if (i === k) return; for (let j = 1; j < o.pts.length; j++) { const [d, t] = segD(q, o.pts[j - 1], o.pts[j]);
      if (d < Math.max(0.35, (o.w || 1.6) / 2 + 0.15)) { cuts[i][j - 1].push(t); const pp = [o.pts[j - 1][0] + t * (o.pts[j][0] - o.pts[j - 1][0]), o.pts[j - 1][1] + t * (o.pts[j][1] - o.pts[j - 1][1])]; if (d > 0.05) links.push([q, pp, r]); return; } } }); }));
    const N = [], adj = [], E = [], node = p => { let i = N.findIndex(q => H(q, p) < 0.35); if (i < 0) { N.push(p); adj.push([]); i = N.length - 1; } return i; };
    const add = (p, q, r) => { const a = node(p), b = node(q); if (a === b) return; const e = { a, b, pts: [N[a], N[b]], len: H(N[a], N[b]), cls: CLS(r.name), w: r.w || 1.6, name: r.name, id: E.length }; E.push(e); adj[a].push(e); adj[b].push(e); };
    R.forEach((r, i) => { for (let j = 1; j < r.pts.length; j++) { const a = r.pts[j - 1], b = r.pts[j], ts = [0, 1, ...cuts[i][j - 1]].sort((x, y) => x - y); for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 1e-4) add([a[0] + ts[k - 1] * (b[0] - a[0]), a[1] + ts[k - 1] * (b[1] - a[1])], [a[0] + ts[k] * (b[0] - a[0]), a[1] + ts[k] * (b[1] - a[1])], r); } });
    for (const [q, pp, r] of links) add(q, pp, r);
    const EX = []; N.forEach((p, i) => { if (adj[i].length !== 1) return; const e = adj[i][0], o = N[e.a === i ? e.b : e.a], L = H(o, p), d = [(p[0] - o[0]) / L, (p[1] - o[1]) / L];
      if (!on1(li, p[0] + d[0] * 0.8, p[1] + d[1] * 0.8) || /off layout|runs off|toward|fascia/.test(e.name)) EX.push({ n: i, p, d, cls: e.cls, name: e.name }); });
    G[li] = { N, adj, E, EX }; }
  const dijk = (li, starts, goals) => { const g = G[li], dist = new Map(), prev = new Map(), Q = []; for (const [n, d, seg] of starts) if (!dist.has(n) || d < dist.get(n)) { dist.set(n, d); prev.set(n, ['start', seg]); Q.push(n); }
    const done = new Set(); while (Q.length) { Q.sort((a, b) => dist.get(a) - dist.get(b)); const u = Q.shift(); if (done.has(u)) continue; done.add(u);
      for (const e of g.adj[u]) { const v = e.a === u ? e.b : e.a, d = dist.get(u) + e.len * (e.cls === 'lane' ? 3 : 1); if (!dist.has(v) || d < dist.get(v)) { dist.set(v, d); prev.set(v, [u, e]); Q.push(v); } } }
    let best = null, bd = 1e9; for (const [n, extra, seg] of goals) if (dist.has(n) && dist.get(n) + extra < bd) { bd = dist.get(n) + extra; best = [n, seg]; }
    if (!best) return null; const out = []; let v = best[0]; while (true) { const pv = prev.get(v); if (pv[0] === 'start') { if (pv[1]) out.unshift(pv[1]); out.unshift({ p: G[li].N[v], e: out.length ? out[0].e : null }); /* [CHOCO-LIFE] keep the first node: no shortcut across the room */ break; } out.unshift({ p: G[li].N[v], e: pv[1] }); v = pv[0]; }
    if (best[1]) out.push(best[1]); return { pts: out, len: bd }; };
  const proj = (li, p, cls) => { let b = null; for (const e of G[li].E) { if (cls && !cls(e)) continue; const [d, t] = segD(p, e.pts[0], e.pts[1]); if (!b || d < b.d) b = { e, t, d, q: [e.pts[0][0] + t * (e.pts[1][0] - e.pts[0][0]), e.pts[0][1] + t * (e.pts[1][1] - e.pts[0][1])] }; } return b; };
  /* route as a list of {p, e} vertices (e = road edge used to reach p) from point A (on road) to point B (on road); A/B from proj() or exit nodes */
  const route = (li, A, B) => { const g = G[li];
    if (A.e && B.e && A.e === B.e) return [{ p: A.q, e: A.e }, { p: B.q, e: A.e }];
    const st = A.n !== undefined ? [[A.n, 0, null]] : [[A.e.a, A.e.len * A.t, null], [A.e.b, A.e.len * (1 - A.t), null]];
    const gl = B.n !== undefined ? [[B.n, 0, null]] : [[B.e.a, B.e.len * B.t, { p: B.q, e: B.e }], [B.e.b, B.e.len * (1 - B.t), { p: B.q, e: B.e }]];
    const r = dijk(li, st, gl); if (!r) return null; return [{ p: A.n !== undefined ? g.N[A.n] : A.q, e: A.e || null }].concat(r.pts); };
  /* ---- trip: polyline with per-segment speed, lane offset, reverse flag; markers: STOP (private -> public) and grade crossings */
  const mkTrip = (li, legs, veh) => { const P = [], S = []; let last = null;
    for (const lg of legs) for (const v of lg) { if (last && H(last.p, v.p) < 1e-3) continue; if (last) S.push({ v: v.v || (v.e ? VMAX[v.e.cls] : VMAX.lot), off: v.off !== undefined ? v.off : (v.e ? Math.min(0.45, v.e.w / 4) : 0), rev: !!v.rev, cls: v.e ? v.e.cls : 'lot', w: v.e ? v.e.w : 0 }); P.push(v.p); last = v; }
    if (P.length < 2) return null;
    /* offset polyline (right-hand traffic), miter at vertices */
    const O = P.map((p, i) => { const sa = S[Math.max(0, i - 1)], sb = S[Math.min(S.length - 1, i)]; const n = q => { const a = P[q], b = P[q + 1], L = H(a, b) || 1; return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]; };
      if (i === 0) { const k = n(0); return [p[0] - k[0] * sb.off, p[1] - k[1] * sb.off]; } if (i === P.length - 1) { const k = n(i - 1); return [p[0] - k[0] * sa.off, p[1] - k[1] * sa.off]; }
      const k1 = n(i - 1), k2 = n(i), off = Math.min(sa.off, sb.off), m = [k1[0] + k2[0], k1[1] + k2[1]], ml = Math.hypot(m[0], m[1]) || 1, cs = Math.max(0.5, (m[0] * k1[0] + m[1] * k1[1]) / ml); return [p[0] - m[0] / ml * off / cs, p[1] - m[1] / ml * off / cs]; });
    const C = [0]; for (let i = 1; i < O.length; i++) C.push(C[i - 1] + H(O[i - 1], O[i]));
    const tr = { li, P: O, S, C, L: C[C.length - 1], mk: [], P0c: P[0], P1c: P[P.length - 1] };
    for (let i = 1; i < P.length; i++) { /* STOP at a private -> public junction */
      if (i < S.length && S[i - 1].cls !== 'pub' && S[i - 1].cls !== 'lot' && S[i].cls === 'pub') tr.mk.push({ k: 'stop', s: C[i] - (S[i].w / 2 + 0.25) - veh.len / 2, node: P[i] });
      if (i < S.length && S[i - 1].cls === 'lot' && (S[i].cls === 'pub' || S[i].cls === 'town')) tr.mk.push({ k: 'stop', s: C[i] - 0.2 - veh.len / 2, node: P[i] }); }
    for (let i = 1; i < O.length; i++) { const a = O[i - 1], b = O[i]; const seen = new Set();
      for (const [k, L] of TG[li]) for (const [r, s, eid] of L) { const t = segX(a, b, r, s); if (t === null) continue; const sx = C[i - 1] + t * (C[i] - C[i - 1]); if (tr.mk.some(m => m.k === 'xing' && Math.abs(m.sx - sx) < 0.6)) continue;
        tr.mk.push({ k: 'xing', sx, s: sx - 1.13 - veh.len / 2, pt: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], e: eid, tid: tidOf[eid] }); } }
    tr.mk.sort((x, y) => x.s - y.s); return tr; };
  const poseOn = (tr, s) => { s = Math.max(0, Math.min(tr.L, s)); let i = 1; while (i < tr.C.length - 1 && tr.C[i] < s) i++; const a = tr.P[i - 1], b = tr.P[i], f = (s - tr.C[i - 1]) / ((tr.C[i] - tr.C[i - 1]) || 1);
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, h: Math.atan2(b[1] - a[1], b[0] - a[0]), seg: tr.S[i - 1] }; };
  /* ---- vehicle types (N scale, in): length, width, colour */
  const VT = { ups: [1.6, 0.68, ['#5a3a1c']], car: [1.13, 0.45, ['#b33', '#36c', '#ddd', '#444', '#9a9', '#c90', '#eee', '#335']], pickup: [1.35, 0.5, ['#a22', '#ccc', '#262', '#333', '#fff']], box: [2.0, 0.6, ['#eee']], spreader: [2.2, 0.6, ['#c62']],
    fuel: [2.4, 0.6, ['#ddd']], bobtail: [2.0, 0.6, ['#eee']], repair: [1.8, 0.6, ['#e8e8e8']], reefer: [4.9, 0.6, ['#f2f2f2']], van53: [5.3, 0.6, ['#e6e6e6']], flat: [4.9, 0.6, ['#777']], bulk: [4.9, 0.6, ['#bbb']],
    tanker: [4.6, 0.6, ['#ccc']], chem: [3.4, 0.6, ['#d8d8d8']] /* [CHOCO-GCFTANK] 45 ft straight chem tank truck */, reefer28: [3.4, 0.6, ['#f2f2f2']], tractor: [0.9, 0.55, ['#2a7a2a', '#c33']], forklift: [0.6, 0.32, ['#e6c000']], service: [1.35, 0.5, ['#fff']] };
  const mkVeh = (type, li, name) => { const [l, w, cols] = VT[type]; const a = { id: ++idn, kind: 'vehicle', type, len: l, w, col: cols[Math.floor(rnd() * cols.length)], level: 0, li, name: name || type, x: 0, y: 0, a: 0, v: 0, s: 0 }; ENT.push(a); return a; };
  const park = (a, x, y, h) => { a.x = x; a.y = y; a.a = h; a.level = a.li; a.mode = 'park'; a.tr = null; };
  /* ---- lots: stalls 9 x 18 ft (0.675 x 1.35 in); 2 rows + 20 ft aisle when deep enough, else 1 row on the side away from the road */
  const byName = (li, re, key = 'lots') => (SC[li - 1][key] || []).find(l => re.test(l.name));
  const LOTS = [];
  const mkLot = (li, re, target, opts = {}) => { const l = byName(li, re); if (!l) { NOTES.push('lot not found: ' + re); return null; }
    const r = l.r, wx = r[2] - r[0], wy = r[3] - r[1], alongX = wx >= wy, Lg = alongX ? wx : wy, Dp = alongX ? wy : wx, rd = proj(li, [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]);
    const c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], roadSide = alongX ? Math.sign(rd.q[1] - c[1]) : Math.sign(rd.q[0] - c[0]);
    const rows = Dp >= 2 * 1.35 + 1.5 ? [-1, 1] : Dp >= 1.35 ? [-roadSide] : [], n = Math.floor((Lg - 0.2) / 0.675), stalls = [];
    for (const side of rows) for (let k = 0; k < n; k++) { const u = (alongX ? r[0] : r[1]) + 0.1 + 0.675 * (k + 0.5), vv = side < 0 ? (alongX ? r[1] : r[0]) + 0.675 : (alongX ? r[3] : r[2]) - 0.675;
      const p = alongX ? [u, vv] : [vv, u], h = alongX ? Math.PI / 2 : 0; const hx = alongX ? 0.34 : 0.7, hy = alongX ? 0.7 : 0.34; const bad = (SC[li - 1].lots || []).some(o => o !== l && p[0] + hx > o.r[0] && p[0] - hx < o.r[2] && p[1] + hy > o.r[1] && p[1] - hy < o.r[3]) /* [CHOCO-LIFE] no stall on a walk, driveway or other lot */ || inStruct(li, p, -0.3);
      if (!bad && onB(li, p[0], p[1], 0.32)) stalls.push({ p, h: alongX ? (side < 0 ? -Math.PI / 2 : Math.PI / 2) : (side < 0 ? Math.PI : 0), side, occ: null }); }
    const aisle = rows.length === 2 ? (alongX ? [[r[0] + 0.3, c[1]], [r[2] - 0.3, c[1]]] : [[c[0], r[1] + 0.3], [c[0], r[3] - 0.3]]) : rows.length ? (alongX ? [[r[0] + 0.3, c[1] + roadSide * (Dp / 2 - Math.min(0.9, (Dp - 1.35) / 2))], [r[2] - 0.3, c[1] + roadSide * (Dp / 2 - Math.min(0.9, (Dp - 1.35) / 2))]] : [[c[0] + roadSide * (Dp / 2 - Math.min(0.9, (Dp - 1.35) / 2)), r[1] + 0.3], [c[0] + roadSide * (Dp / 2 - Math.min(0.9, (Dp - 1.35) / 2)), r[3] - 0.3]]) : null;
    const L = { li, name: l.name, r, target, cap: stalls.length, stalls, aisle, rd, alongX, type: opts.type || 'car', mix: opts.mix || ['car', 'car', 'pickup'], churn: opts.churn || 0 }; LOTS.push(L);
    const k0 = Math.min(target, stalls.length); const order = stalls.map((s, i) => i).sort(() => rnd() - 0.5);
    for (let i = 0; i < k0; i++) { const s = stalls[order[i]], ty = L.mix[Math.floor(rnd() * L.mix.length)], a = mkVeh(ty, li, (opts.who || 'staff') + ' ' + ty + ' (' + l.name + ')'); s.occ = a; a.lot = L; a.stall = s; park(a, s.p[0], s.p[1], s.h); }
    return L; };
  /* path in/out of a stall: stall -> aisle -> lot entrance (aisle point nearest the road) -> road */
  const lotLeg = (L, s, out) => { const ap = L.aisle ? (L.alongX ? [s.p[0], L.aisle[0][1]] : [L.aisle[0][0], s.p[1]]) : s.p; const ent = L.aisle ? (H(L.aisle[0], L.rd.q) < H(L.aisle[1], L.rd.q) ? L.aisle[0] : L.aisle[1]) : s.p;
    const entP = L.aisle ? (L.alongX ? [ent[0], ent[1]] : [ent[0], ent[1]]) : s.p; const ex = proj(L.li, entP);
    const pts = out ? [{ p: s.p }, { p: ap, rev: true }, { p: entP }, { p: ex.q }] : [{ p: ex.q }, { p: entP }, { p: ap }, { p: s.p }]; return { pts, road: ex }; };
  /* ---- slots on aprons / courts / pads (one vehicle each): back-in to a dock face if a building abuts the lot, else drive in */
  const SLOTS = [];
  const mkSlot = (li, re, type, opts = {}) => { const l = byName(li, re); if (!l) { NOTES.push('slot lot not found: ' + re); return null; } const r = l.r, [len, w] = VT[type];
    const c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], rd = proj(li, c); const S = SC[li - 1].structures || [];
    const face = opts.dock !== false && S.map(s => { const sides = [[s.r[2], 'x', 1], [s.r[0], 'x', -1], [s.r[3], 'y', 1], [s.r[1], 'y', -1]];
      for (const [v, ax, sg] of sides) { const lotEdge = ax === 'x' ? (sg > 0 ? r[0] : r[2]) : (sg > 0 ? r[1] : r[3]); const ov = ax === 'x' ? Math.min(r[3], s.r[3]) - Math.max(r[1], s.r[1]) : Math.min(r[2], s.r[2]) - Math.max(r[0], s.r[0]);
        if (Math.abs(lotEdge - v) < 0.3 && ov > w + 0.4) return { ax, v, sg, lo: ax === 'x' ? Math.max(r[1], s.r[1]) : Math.max(r[0], s.r[0]), hi: ax === 'x' ? Math.min(r[3], s.r[3]) : Math.min(r[2], s.r[2]), st: s }; } return null; }).find(Boolean);
    let A, B, rev = false; const k = opts.k || 0;
    if (face) { const u = (face.lo + face.hi) / 2 + (k - (opts.n || 1) / 2 + 0.5) * Math.min(1.6, (face.hi - face.lo) / (opts.n || 1));
      const far = face.ax === 'x' ? (face.sg > 0 ? r[2] : r[0]) : (face.sg > 0 ? r[3] : r[1]), dockP = face.ax === 'x' ? [face.v + face.sg * (0.15 + len / 2), u] : [u, face.v + face.sg * (0.15 + len / 2)];
      const depth = Math.abs(far - face.v); if (depth < len + 0.3) { NOTES.push(`${type} does not fit ${l.name} (depth ${depth.toFixed(2)} < ${len + 0.3})`); return null; }
      const pull = 0.1 + len / 2, outP = face.ax === 'x' ? [far - face.sg * pull, u] : [u, far - face.sg * pull]; /* [CHOCO-LIFE] whole truck stays on the court while it lines up */ A = outP; B = dockP; rev = true; }
    else { const alongX = (r[2] - r[0]) >= (r[3] - r[1]), Lg = alongX ? r[2] - r[0] : r[3] - r[1], Dp = alongX ? r[3] - r[1] : r[2] - r[0]; if (Lg < len + 0.4 || Dp < w + 0.1) { NOTES.push(`${type} does not fit ${l.name}`); return null; }
      const side = opts.far ? -1 : 1, roadSide = alongX ? Math.sign(rd.q[1] - c[1]) || 1 : Math.sign(rd.q[0] - c[0]) || 1, off = side * roadSide * Math.max(0, Dp / 2 - w / 2 - 0.3) * (opts.edge ? 1 : 0);
      const e0 = alongX ? [r[0] + 0.2 + len / 2, c[1] + off] : [c[0] + off, r[1] + 0.2 + len / 2], e1 = alongX ? [r[2] - 0.2 - len / 2, c[1] + off] : [c[0] + off, r[3] - 0.2 - len / 2];
      if (opts.at) { A = B = opts.at; } else if (opts.mid) { B = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2]; A = H(proj(li, B).q, B) < len ? (opts.enter === 'e0' ? e0 : e1) : B; /* [CHOCO-LIFE] lane runs through the pad: line up along it */ } else { const q = proj(li, c).q; if (H(q, e0) <= H(q, e1)) { A = e0; B = e1; } else { A = e1; B = e0; } } }
    if (opts.path) { A = opts.path.A; B = opts.path.B; rev = !!opts.path.rev; }
    const sl = { li, name: l.name, r, type, A, B, rev, via: (opts.path && opts.path.via) || [], rd: proj(li, A), busy: null, face: !!face };
    if (opts.pull && !face && !opts.mid && !opts.at && !opts.path && H(A, B) > 0.5) { const u = [(B[0] - A[0]) / H(A, B), (B[1] - A[1]) / H(A, B)]; /* [CHOCO-LIFE] apron along the road: ease in from behind and pull through ahead, no square turns */
      const pa = [A[0] - u[0] * len * 0.8, A[1] - u[1] * len * 0.8], pb = [B[0] + u[0] * len * 0.8, B[1] + u[1] * len * 0.8], ra = proj(li, pa), rb = proj(li, pb); /* only when the road really runs alongside the apron */
      if (H(ra.q, pa) < 2.0 && H(rb.q, pb) < 2.0 && ra.e && rb.e && ra.e.name === rb.e.name && ra.e.name === sl.rd.e.name) { sl.rd = ra; sl.rdOut = rb; } }
    SLOTS.push(sl); return sl; };
  /* ---- visits: a vehicle comes in from the nearest public exit, works the slot or lot, and leaves */
  const exitsFor = (li, p, kinds) => { const ex = G[li].EX.filter(x => kinds.includes(x.cls)); return ex; };
  const roadTo = (li, fromExit, to) => route(li, { n: fromExit.n }, to), roadFrom = (li, from, toExit) => route(li, from, { n: toExit.n });
  const pickExit = (li, from, kinds = ['pub', 'yard', 'town', 'ind']) => { const c = G[li].EX.filter(x => kinds.includes(x.cls)).map(x => { const r = roadFrom(li, from, x); return r ? [x, r.reduce((s, v, i) => i ? s + H(r[i - 1].p, v.p) : 0, 0)] : null; }).filter(Boolean);
    if (!c.length) return null; c.sort((a, b) => a[1] - b[1]); const ok = c.filter(x => x[1] <= c[0][1] * 1.6 + 5); return ok[Math.floor(rnd() * ok.length)][0]; };
  const VISITS = [];
  const visit = (sl, n, dwell, label, opts = {}) => { if (!sl) return; for (let i = 0; i < n; i++) VISITS.push({ sl, t: (i + 0.25 + 0.5 * rnd()) * 7200 / n + (opts.t0 || 0), dwell: dwell * (0.8 + 0.4 * rnd()), label, kinds: opts.kinds, when: opts.when, stay: opts.stay, leaveRev: opts.leaveRev, done: false }); };
  const startTrip = (a, legs, then) => { const tr = mkTrip(a.li, legs, a); if (!tr) { NOTES.push('no trip for ' + a.name); return false; } a.tr = tr; a.s = 0; a.v = 0; const isEx = p => G[a.li].EX.some(x => H(x.p, p) < 0.8); if (isEx(tr.P0c)) a.s = Math.min(tr.L, 0.7 + a.len / 2); tr.Lend = isEx(tr.P1c) ? Math.max(a.s, tr.L - 0.7 - a.len / 2) : tr.L; const fits = s => { const q = poseOn(tr, s), c = Math.cos(q.h), sn = Math.sin(q.h), l = a.len / 2 + 0.05, w = a.w / 2; return [[l, w], [l, -w], [-l, -w], [-l, w]].every(([u, v]) => on1(a.li, q.x + u * c - v * sn, q.y + u * sn + v * c)); }; /* [CHOCO-LIFE] appear/vanish only with the whole body on the benchwork */ if (isEx(tr.P0c)) while (a.s < tr.L - 0.1 && !fits(a.s)) a.s += 0.1; if (isEx(tr.P1c)) while (tr.Lend > a.s + 0.1 && !fits(tr.Lend)) tr.Lend -= 0.1; if (!a.level) { const q0 = poseOn(tr, a.s); if (ENT.some(b => b !== a && b.level === a.li && (b.kind === 'vehicle' || b.kind === 'machine') && ((b.mode === 'park' ? Math.abs((b.x - q0.x) * Math.cos(q0.h) + (b.y - q0.y) * Math.sin(q0.h)) < (a.len + b.len) / 2 + 1.0 && Math.abs(-(b.x - q0.x) * Math.sin(q0.h) + (b.y - q0.y) * Math.cos(q0.h)) < (a.w + b.len) / 2 + 0.2 : H([b.x, b.y], [q0.x, q0.y]) < (a.len + b.len) / 2 + 1.0) /* [CHOCO-VAN53] a car parked beside the road (not on the entry lane) does not hold a long truck off-layout forever */ || (b.mode === 'drive' && H([b.x, b.y], [q0.x, q0.y]) < (a.len + b.len) / 2 + 5.0 && (q0.x - b.x) * Math.cos(b.hd) + (q0.y - b.y) * Math.sin(b.hd) > 0)))) { /* [CHOCO-LIFE] also wait for traffic heading toward the entry */ SPAWN.push({ t: T + 15, f: () => startTrip(a, legs, then) }); return true; } } /* [CHOCO-LIFE] wait off-layout until the entry is clear */ a.mode = 'drive'; a.level = a.li; if (TRIPS.length < 4000) TRIPS.push({ a, tr, s0: a.s }); /* [CHOCO-LIFE] step 2 gate log */ a.mi = 0; a.then = then; a.wait = 0; Object.assign(a, poseXY(a)); return true; };
  const poseXY = a => { const q = poseOn(a.tr, a.s), l = a.len * 0.45, f = poseOn(a.tr, a.s + l), r = poseOn(a.tr, a.s - l), d = Math.hypot(f.x - r.x, f.y - r.y); /* [CHOCO-LIFE] body rides the path chord (front/rear axle on the path): no swinging over the fascia at corners */
    const h = d > 0.2 ? Math.atan2(f.y - r.y, f.x - r.x) : q.h, x0 = d > 0.2 ? (f.x + r.x) / 2 : q.x, y0 = d > 0.2 ? (f.y + r.y) / 2 : q.y, off = Math.hypot(x0 - q.x, y0 - q.y), kk = off > 0.25 ? 0.25 / off : 1, x = q.x + (x0 - q.x) * kk, y = q.y + (y0 - q.y) * kk; /* [CHOCO-LIFE] off-tracking capped at 0.25 in (~3.5 ft): trucks swing wide, they do not cut the inside of a corner by 20 ft */
    const ok = (x, y, h) => { if (!a.li || !a.w) return true; const c = Math.cos(h), sn = Math.sin(h), l = a.len / 2, w = a.w / 2; return [[l, w], [l, -w], [-l, -w], [-l, w]].every(([u, v]) => on1(a.li, x + u * c - v * sn, y + u * sn + v * c)); };
    const C = [[x, y, h], [q.x, q.y, h], [(x + q.x) / 2, (y + q.y) / 2, (h + q.h) / 2 + (Math.abs(h - q.h) > Math.PI ? Math.PI : 0)], [q.x, q.y, q.h], ...[0.5, 0.75, 1.0, 1.5].filter(m => m < off).map(m => [q.x + (x0 - q.x) * m / off, q.y + (y0 - q.y) * m / off, h]), ...[0.2, -0.2, 0.4, -0.4, 0.6, -0.6].map(o => [x - o * Math.sin(h), y + o * Math.cos(h), h]), ...[0.25, -0.25, 0.5, -0.5].flatMap(d => [0, 0.3, -0.3].map(o => [x - o * Math.sin(h), y + o * Math.cos(h), h + d])), [x0, y0, h]] /* [CHOCO-LIFE] last resort: swing wide across the other lane, as a truck driver does at a tight corner */.find(c => ok(...c)) || [x, y, h]; /* [CHOCO-LIFE] at tight corners by the fascia take the body line that stays on the wood */
    return { x: C[0], y: C[1], a: C[2] + (q.seg && q.seg.rev ? Math.PI : 0), hd: C[2] }; };
  const roadLeg = r => r.map(v => ({ p: v.p, e: v.e }));
  const runVisit = V => { const sl = V.sl, li = sl.li; if (sl.busy || (V.when && !V.when())) { V.t += 120; return; } const ex = pickExit(li, sl.rd, V.kinds || ['pub']); if (!ex) { NOTES.push('no exit for ' + sl.name); V.done = true; return; }
    const r = roadTo(li, ex, sl.rd); if (!r) { V.done = true; NOTES.push('no route to ' + sl.name); return; } const a = mkVeh(sl.type, li, V.label + ' (' + sl.name + ')'); sl.busy = a; V.done = true; STAT.visits++;
    const into = sl.rev ? [{ p: sl.rd.q, e: sl.rd.e }, { p: sl.A, v: VMAX.lot }, ...sl.via.map(p => ({ p, v: VMAX.rev, rev: true })), { p: sl.B, v: VMAX.rev, rev: true }] : [{ p: sl.rd.q, e: sl.rd.e }, { p: sl.A, v: VMAX.lot }, { p: sl.B, v: VMAX.lot }];
    const go = startTrip(a, [roadLeg(r).map((v, i) => i === 0 ? { p: v.p, e: v.e, v: VMAX.pub } : v), into.map((v, i) => i === 0 ? { p: v.p, e: v.e } : v)], () => {
      park(a, a.x, a.y, a.a); a.until = T + V.dwell; a.stay = V.stay; a.onDone = V.onDone; a.after = () => { const rdO = sl.rdOut || sl.rd; let ex2 = pickExit(li, rdO, V.kinds || ['pub']); if (sl.rdOut) { const u = [sl.B[0] - sl.A[0], sl.B[1] - sl.A[1]], fwd = x => { const r = roadFrom(li, rdO, x); if (!r) return false; const q = r.find(v => H(v.p, rdO.q) > 0.3); return q && (q.p[0] - rdO.q[0]) * u[0] + (q.p[1] - rdO.q[1]) * u[1] > 0; }; const ok = G[li].EX.filter(x => (V.kinds || ['pub']).includes(x.cls) && fwd(x)); if (ok.length) ex2 = ok[Math.floor(rnd() * ok.length)]; } /* [CHOCO-LIFE] no U-turn after a pull-through */ const r2 = roadFrom(li, rdO, ex2);
        const out = V.leaveRev ? [{ p: sl.B, v: VMAX.rev, rev: true }, { p: sl.A, v: VMAX.rev, rev: true }, { p: sl.rd.q, v: VMAX.rev, rev: true }] : sl.outVia ? [{ p: sl.B, v: VMAX.lot }, ...sl.outVia.map(p => ({ p, v: VMAX.lot })), { p: rdO.q, v: VMAX.lot }] : sl.rev ? [{ p: sl.B, v: VMAX.lot }, ...sl.via.slice().reverse().map(p => ({ p, v: VMAX.lot })), { p: sl.A, v: VMAX.lot }, { p: sl.rd.q, v: VMAX.lot }] : [{ p: sl.B, v: VMAX.lot }, { p: [sl.B[0] + (sl.B[0] - sl.A[0]) * 0.001, sl.B[1] + (sl.B[1] - sl.A[1]) * 0.001], v: VMAX.lot }, { p: rdO.q, v: VMAX.lot }];
        const back = V.leaveRev ? roadLeg(r2).map(v => ({ p: v.p, e: v.e, rev: v.e && v.e.cls === 'lane', v: v.e && v.e.cls === 'lane' ? VMAX.rev : undefined })) : roadLeg(r2);
        startTrip(a, [out, back], () => { despawn(a); sl.busy = null; if (V.onDone) V.onDone(); }); }; });
    if (!go) { despawn(a); sl.busy = null; if (V.onDone) V.onDone(); } };
  const despawn = a => { a.level = 0; a.mode = 'gone'; a.tr = null; STAT.despawn++; };
  /* lot churn: a parked car leaves for an exit; later an arrival takes a free stall (never above the stall count) */
  const churn = (L, n) => { for (let i = 0; i < n; i++) { const t = (i + 0.2 + 0.6 * rnd()) * 7200 / n; const this_f = () => { const occ = L.stalls.filter(s => s.occ && s.occ.mode === 'park'); if (!occ.length) return; const s = occ[Math.floor(rnd() * occ.length)], a = s.occ, a0 = a;
      if (ENT.some(b => b.mode === 'drive' && b !== a0 && b.lot === L && ((b.lotIn && b.inLot) || b.lotOut))) { SPAWN.push({ t: T + 10, f: this_f }); return; } /* [CHOCO-LIFE] wait while someone is pulling in */ const lg = lotLeg(L, s, true), ex = pickExit(L.li, lg.road, ['pub', 'yard', 'town']); if (!ex) return; const r = roadFrom(L.li, lg.road, ex); if (!r) return; s.occ = 'leaving'; a.lotOut = true;
      startTrip(a, [lg.pts.map((v, k) => ({ p: v.p, rev: v.rev, v: v.rev ? VMAX.rev : VMAX.lot })), roadLeg(r)], () => { despawn(a); s.occ = null; }); }; SPAWN.push({ t, f: this_f });
    SPAWN.push({ t: t + 400 + 600 * rnd(), f: () => { const free = L.stalls.filter(s => !s.occ); if (!free.length) return; const s = free[Math.floor(rnd() * free.length)], lg = lotLeg(L, s, false), ex = pickExit(L.li, lg.road, ['pub', 'yard', 'town']); if (!ex) return;
      const r = roadTo(L.li, ex, lg.road); if (!r) return; const ty = L.mix[Math.floor(rnd() * L.mix.length)], a = mkVeh(ty, L.li, 'arriving ' + ty + ' (' + L.name + ')'); s.occ = a; a.lot = L; a.stall = s; a.lotIn = true; a.gateP = lg.road.q;
      startTrip(a, [roadLeg(r), lg.pts.map(v => ({ p: v.p, rev: v.rev, v: v.rev ? VMAX.rev : VMAX.lot }))], () => { a.lotIn = false; park(a, s.p[0], s.p[1], a.a); }); } }); } };
  /* ---- through traffic on public roads: exit -> exit pairs whose route is mostly public road */
  const THRU = [];
  for (const li of [1, 2]) { const ex = G[li].EX; for (const a of ex) for (const b of ex) { if (a === b) continue; const r = route(li, { n: a.n }, { n: b.n }); if (!r) continue; let L = 0, P = 0; for (let i = 1; i < r.length; i++) { const d = H(r[i - 1].p, r[i].p); L += d; if (r[i].e && r[i].e.cls === 'pub') P += d; }
    if (L > 10 && P / L >= 0.8) THRU.push({ li, a, b, r, L }); } }
  const thruNext = {}; THRU.forEach((x, i) => thruNext[i] = 20 + rnd() * 120);
  /* ---- people: walk paths (clipped to the part that is on board, off structures and clear of track) */
  const WALK = [];
  const walkers = (li, re, n, label, opts = {}) => { const l = byName(li, re); if (!l) { NOTES.push('walk not found: ' + re); return; } const r = l.r, alongX = r[2] - r[0] >= r[3] - r[1], c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
    const a0 = alongX ? [r[0], c[1]] : [c[0], r[1]], a1 = alongX ? [r[2], c[1]] : [c[0], r[3]], L = H(a0, a1), ok = []; for (let s = 0; s <= L; s += 0.05) { const p = [a0[0] + (a1[0] - a0[0]) * s / L, a0[1] + (a1[1] - a0[1]) * s / L];
      ok.push(onB(li, p[0], p[1], 0.2) && !inStruct(li, p, 0.05) && (opts.catwalk || trackD(li, p) >= 0.55) && liftD(p) > 1); }
    let best = [0, -1], cur = -1; ok.forEach((v, i) => { if (v) { if (cur < 0) cur = i; if (i - cur > best[1] - best[0]) best = [cur, i]; } else cur = -1; });
    if (best[1] - best[0] < 4) { NOTES.push('walk too short after clipping: ' + l.name); return; } const p0 = [a0[0] + (a1[0] - a0[0]) * best[0] * 0.05 / L, a0[1] + (a1[1] - a0[1]) * best[0] * 0.05 / L], p1 = [a0[0] + (a1[0] - a0[0]) * best[1] * 0.05 / L, a0[1] + (a1[1] - a0[1]) * best[1] * 0.05 / L];
    for (let i = 0; i < n; i++) { const a = { id: ++idn, kind: 'person', type: opts.type || 'person', len: 0.25, w: 0.25, col: opts.col || ['#fc8', '#f84', '#8cf', '#ff6', '#fff'][Math.floor(rnd() * 5)], level: 0, li, name: label, x: p0[0], y: p0[1], a: 0, walk: { p0, p1, L: H(p0, p1), xwalk: /crosswalk/.test(l.name) }, s: 0, dir: 1, mode: 'in', until: 60 + rnd() * 900 }; ENT.push(a); WALK.push(a); } };
  /* ---- forklifts / machines working pads: move only while there is work (a stopped car spotted within 2 in, or a truck in the pad's slot) */
  const MACH = [];
  const machine = (li, re, type, label, opts = {}) => { const l = byName(li, re); if (!l) { NOTES.push('pad not found: ' + re); return; } const r = l.r, alongX = r[2] - r[0] >= r[3] - r[1], c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], Dp = alongX ? r[3] - r[1] : r[2] - r[0];
    const off = opts.off || 0, a0 = alongX ? [r[0] + 0.4, c[1] + off] : [c[0] + off, r[1] + 0.4], a1 = alongX ? [r[2] - 0.4, c[1] + off] : [c[0] + off, r[3] - 0.4];
    const L = H(a0, a1), ok = []; for (let s = 0; s <= L; s += 0.05) { const p = [a0[0] + (a1[0] - a0[0]) * s / L, a0[1] + (a1[1] - a0[1]) * s / L]; ok.push(onB(li, p[0], p[1], 0.32) && !inStruct(li, p, -0.2) && trackD(li, p) >= 0.6); }
    let best = [0, -1], cur = -1; ok.forEach((v, i) => { if (v) { if (cur < 0) cur = i; if (i - cur > best[1] - best[0]) best = [cur, i]; } else cur = -1; }); if (best[1] - best[0] < 6) { NOTES.push('no clear lane for ' + label); return; }
    const P0 = [a0[0] + (a1[0] - a0[0]) * best[0] * 0.05 / L, a0[1] + (a1[1] - a0[1]) * best[0] * 0.05 / L], P1 = [a0[0] + (a1[0] - a0[0]) * best[1] * 0.05 / L, a0[1] + (a1[1] - a0[1]) * best[1] * 0.05 / L];
    const a = mkVeh(type, li, label); a.kind = 'machine'; a.m = { P0, P1, L: H(P0, P1), r, slot: opts.slot, always: opts.always, ph: rnd() * 100 }; park(a, P0[0], P0[1], Math.atan2(P1[1] - P0[1], P1[0] - P0[0])); MACH.push(a); };
  /* ---- animals [PROPOSED in PHASE3-PLAN.md; the plan has none] */
  const ANI = [];
  const animal = (li, type, spots, label, opts = {}) => { const good = spots.filter(p => onB(li, p[0], p[1], 0.4) && trackD(li, p) >= 1.2 && !inStruct(li, p, -0.3) && !(SC[li - 1].roads || []).some(r => r.pts.some((q, i) => i && segD(p, r.pts[i - 1], q)[0] < (r.w || 1.6) / 2 + 0.4)));
    for (let i = 0; i < (opts.n || 1) && good.length; i++) { const h = good.splice(Math.floor(rnd() * good.length), 1)[0]; const a = { id: ++idn, kind: 'animal', type, len: opts.len || 0.4, w: opts.w || 0.15, col: opts.col || '#8b5a2b', level: li, li, name: label, x: h[0], y: h[1], a: rnd() * 6.28, home: h, spots: good.slice(), fly: !!opts.fly, r: opts.r || 0, ph: rnd() * 6.28, rect: opts.rect, wpts: opts.wpts, graze: opts.graze, s: 0 }; ENT.push(a); ANI.push(a); } };
  const grid = (r, step, m = 0.2) => { const o = []; for (let x = r[0] + m; x <= r[2] - m; x += step) for (let y = r[1] + m; y <= r[3] - m; y += step) o.push([x, y]); return o; };

  /* ================= the plan (rev6h README element checklist + PHASE3-PLAN.md section 1) ================= */
  // L1 lots (plan counts; capped by stalls)
/* [CHOCO-GCFTANK] in-memory lane lot so no staff stall sits on the gated truck lane */ if (!(SC[1].lots || []).some(o => /GCF chemical truck lane/.test(o.name))) (SC[1].lots = SC[1].lots || []).push({ name: 'GCF chemical truck lane (gated)', r: [57.2, 106.25, 58.6, 108.6], kind: 'court' });
  const ccf = mkLot(1, /^CCF staff parking/, 20, { churn: 4 }), tl = mkLot(1, /^TL staff parking/, 6, { churn: 2 }), psr = mkLot(1, /^PSR customer/, 5, { churn: 2, mix: ['pickup', 'pickup', 'car'] }),
    ff = mkLot(1, /^FF staff \+ farmer/, 5, { churn: 3, mix: ['pickup', 'pickup', 'car'] }), crew = mkLot(1, /^Marsden crew parking/, 12, { churn: 4, who: 'crew' }), grill = mkLot(1, /^Pamlico Grill parking/, 4, { churn: 4, who: 'customer' });
  // L2 lots
  const nut = mkLot(2, /^Nutrien staff parking/, 14, { churn: 3 }), gcf = mkLot(2, /^GCF staff parking/, 8, { churn: 2 }), wl = mkLot(2, /^WL staff parking/, 25, { churn: 4 }),
    church = mkLot(2, /^Church parking/, 3, { churn: 2, who: 'visitor' }), hw = mkLot(2, /^Hardware parking/, 3, { churn: 4, who: 'customer', mix: ['pickup', 'car'] });
  for (const L of LOTS) churn(L, L.churn);
  // static parked: tractors on display, tire shop, house driveways, RIP truck, Nutrien service truck
  { const l = byName(2, /Coastal Tractor display/); if (l) { const r = l.r; for (let i = 0; i < 4; i++) { const a = mkVeh('tractor', 2, 'display tractor (Coastal Tractor)'); park(a, r[0] + 1.0 + i * 1.4, (r[1] + r[3]) / 2, -Math.PI / 2 + 0.3); } } }
  { const l = byName(2, /Tire & Auto apron/); if (l) { const r = l.r; for (let i = 0; i < 2; i++) { const a = mkVeh('car', 2, 'car in for tyres (Pamlico Tire & Auto)'); park(a, r[0] + 0.75 + i * 1.4, (r[1] + r[3]) / 2, 0); } } }
  for (const [li, re] of [[2, /Mill house 1 /], [2, /Mill house 2 /], [2, /Mill house 4 /], [2, /Mill house 5 /], [2, /Mill house 7 /], [2, /Ranch NC-306 W/], [2, /Ranch NC-306 E/], [2, /Ranch behind hardware/]]) {
    const l = byName(li, re); if (!l) continue; const r = l.r, a = mkVeh(rnd() < 0.5 ? 'pickup' : 'car', li, 'resident car (' + l.name + ')'); park(a, (r[0] + r[2]) / 2, r[3] - a.len / 2 - 0.15, Math.PI / 2); }
  const TEST = { badOrderY6: false }; /* [CHOCO-LIFE] test-page hook only (window.__life.TEST): ops has no bad-order flag */
  const y6Bad = () => { if (TEST.badOrderY6) return true; if (T - lastScan > 2) scanCars(); return (CARS[1] || []).some(c => !c.mv && c.x > 84.9 && c.x < 104.6 && Math.abs(c.y - 15.863) < 0.3); }; /* plan: Y6 is the RIP / bad-order track (rev6h README: 'Y6 RIP / bad order'); any car standing on it is a bad order */
  { const sl = mkSlot(1, /RIP repair-truck pad/, 'repair', { dock: false, mid: true }); if (sl) { let pend = false; /* [CHOCO-LIFE] plan: the RIP truck is on the pad only while a bad-order car is on Y6 */
    SPAWN.push({ t: 30, f: function chk() { if (!sl.busy && !pend && y6Bad()) { pend = true; VISITS.push({ sl, t: T, dwell: 1e6, label: 'mobile car-repair truck', kinds: ['yard', 'pub'], stay: y6Bad, done: false, onDone: () => { pend = false; } }); } SPAWN.push({ t: T + 30, f: chk }); } }); } }
  { const sl = mkSlot(2, /Nutrien tank-yard service apron/, 'service', { dock: false, mid: true }); if (sl) { const a = mkVeh('service', 2, 'Nutrien tank-yard service pickup'); park(a, sl.B[0], sl.B[1], 0); sl.busy = a; } }
  // truck visits (per 2 h session) [counts PROPOSED within plan fleets]
  const noCrew = tid => () => { const tk = eng.trk[tid]; if (!tk) return true; return !eng.cuts.some(c => c.cars.some(k => k.loco) && Object.keys(eng.occupancy(c)).some(e => tk.edges.includes(+e))); }; /* [CHOCO-TRUCK-F6-CF] */ visit(mkSlot(1, /CCF truck court/, 'reefer28', { n: 2, k: 0 }), 2, 1500, '28 ft reefer pup (93 ft court: no 48/53 ft as default)', { when: noCrew('T20'), stay: noCrew('T20') }); visit(mkSlot(1, /CCF truck court/, 'reefer28', { n: 2, k: 1 }), 1, 1500, '28 ft reefer pup', { t0: 900, when: noCrew('T20'), stay: noCrew('T20') }); /* [CHOCO-WLIN] WL planer mill inbound: flatbeds bring rough green lumber from area sawmills to the storage yard (forklift unloads to the kilns); 3 per 2 h session, pull-through along the road edge */ visit(mkSlot(2, /WL lumber storage yard/, 'flat', { dock: false, pull: true, edge: true }), 3, 1200, 'flatbed: rough green lumber in (WL)');
  const tlS = mkSlot(1, /TL transload pad/, 'flat', { dock: false, edge: true }); /* [CHOCO-TRUCK-F1] direct car<->truck transload: a flatbed comes only while a coil car or flat stands spotted on T21 and no crew is switching it (else it retries in 2 min) */
  const tlWork = () => { const tk = eng.trk.T21; if (!tk) return true; const on = c => Object.keys(eng.occupancy(c)).some(e => tk.edges.includes(+e)); const cs = eng.cuts.filter(on); return !cs.some(c => c.cars.some(k => k.loco)) && cs.some(c => Math.abs(c.v) <= 0.05 && c.cars.some(k => /coil|f68|flat/.test(k.type + ' ' + (k.kind || '') + ' ' + (k.key || '')))); };
  visit(tlS, 2, 1200, 'flatbed (coil/pipe)', { when: tlWork, stay: tlWork }); /* [CHOCO-TRUCK-F1b] pulls out when a crew comes to switch T21 */
  { const psS = mkSlot(1, /PSR shed truck apron/, 'flat', { dock: false }); visit(psS, 1, 1200, 'flatbed (baled scrap)'); visit(psS, 4, 420, 'roll-off truck (inbound scrap)'); } /* [CHOCO-TRUCK-F5] scrap comes in by truck, leaves by the T22 gons */
  visit(mkSlot(1, /FF warehouse truck apron/, 'box'), 2, 900, 'box truck (bagged feed)', { when: noCrew('T24'), stay: noCrew('T24') }); visit(mkSlot(1, /FF bin load-out apron/, 'spreader', { dock: false, mid: true }), 2, 600, 'bulk spreader truck', { when: noCrew('T24'), stay: noCrew('T24') });
  /* [CHOCO-NUT-D] E-1 DTL fuel truck removed: dead-end lane would need a long reverse over the crossing; E-1 fuels from its fuel crane */
  visit(mkSlot(1, /Quick Mart pump apron/, 'car', { dock: false, at: [114.85, 102.0] }), 8, 180, 'customer car at the pumps', { kinds: ['pub'] });
  visit(mkSlot(2, /Nutrien dome (load-out apron|truck load-out pull-off)/, 'bulk', { dock: false, pull: true }), 3, 600, 'bulk hopper semi', { kinds: ['pub'] });
  visit(mkSlot(2, /GCF truck court/, 'van53', { n: 2, k: 0 }), 1, 1500, '53 ft van'); visit(mkSlot(2, /GCF truck court/, 'van53', { n: 2, k: 1 }), 1, 1500, '53 ft van', { t0: 1800 });
  /* [CHOCO-GCFTANK] gated lane off Weyerhaeuser Rd (rendered by choco_bldg C): straight chem tanker pulls in nose-first to the fill pad and backs out */ { const ln = byName(2, /GCF chemical truck lane/); const gs = ln && mkSlot(2, /^GCF staff parking/, 'chem', { dock: false, path: { A: [57.9, 107.0], B: [57.9, 108.1] } }); if (gs) { gs.rd = proj(2, [57.9, 105.05]); gs.name = 'GCF chemical-tank fill pad via gated lane'; gs.via = []; } if (gs) visit(gs, 2, 1200, 'GCF chemical tank truck', { t0: 900, leaveRev: true }); else NOTES.push('GCF lane lot missing'); }
  const wlS = mkSlot(2, /WL lumber storage yard/, 'flat', { dock: false, edge: true }); if (wlS) { const S0 = wlS.A[1] < wlS.B[1] ? wlS.A : wlS.B, N0 = wlS.A[1] < wlS.B[1] ? wlS.B : wlS.A, mr = e => /Mill Rd/.test(e.name), Aq = proj(2, [wlS.r[2] + 1, S0[1] - 4.6], mr).q; wlS.rd = proj(2, [wlS.r[2] + 1, S0[1] + 1.5], mr); wlS.A = Aq; wlS.via = [[(S0[0] + Aq[0]) / 2 + 0.15, S0[1] - 2.3], S0]; wlS.B = [S0[0], S0[1] + 2.4]; /* backs straight on up the lane so the whole rig is square in the lane before it stops */ wlS.rev = true; wlS.outVia = [N0]; wlS.rdOut = proj(2, [wlS.r[2] + 1, N0[1] + 3.1], mr); } /* [CHOCO-LIFE] Mill Rd dead-ends at the PR yard, so no turnaround: the flatbed comes down Mill Rd, pulls past the yard, backs ~3 in (~45 ft) into its south end, works, then drives up the truck lane and angles out at the north end */ const wlWork = () => { const tk = eng.trk.T38; if (!tk) return true; const cs = eng.cuts.filter(c => Object.keys(eng.occupancy(c)).some(e => tk.edges.includes(+e))); return !cs.some(c => c.cars.some(k => k.loco)) && cs.some(c => Math.abs(c.v) <= 0.05 && c.cars.length); }; visit(wlS, 2, 1200, 'flatbed (packaged lumber)', { when: wlWork, stay: wlWork }); /* [CHOCO-TRUCK-F6-WL] */
  visit(mkSlot(2, /Gas & Grocery apron/, 'car', { dock: false, mid: true }), 6, 240, 'customer car', { kinds: ['pub'] });
  // PR propane: 2 bobtails in the fenced yard; each makes one delivery run: yard -> bobtail rack (fill) -> Mill Rd -> out; back later
  { const l = byName(2, /PR bobtail \+ staff parking/), lane = byName(2, /PR yard lane to bobtail rack/); if (l && lane) { const r = l.r, lx = (lane.r[0] + lane.r[2]) / 2;
    for (let i = 0; i < 4; i++) { const a = mkVeh('car', 2, 'PR staff car'); park(a, r[2] - 1.35 / 2 - 0.25, r[1] + 0.35 + i * 0.6, 0); }
    for (let i = 0; i < 2; i++) { const a = mkVeh('bobtail', 2, 'propane bobtail (Pamlico Propane)'), bx = r[0] + 0.4 + i * 0.75, by = r[1] + 0.25 + 1.0; /* [CHOCO-LIFE] clear of the exit row */ park(a, bx, by, Math.PI / 2); const t0 = 900 + i * 3600; /* [CHOCO-LIFE] second run after the first bobtail is back in the yard */
      const rack = [lx, lane.r[1] + 6.0], laneEnd = [lx, lane.r[3] - 0.3], yRow = r[3] - 0.35, mill = proj(2, [lane.r[2] + 1, lane.r[3] - 0.3], e => /Mill Rd/.test(e.name)), millN = proj(2, [lane.r[2] + 1, yRow], e => /Mill Rd/.test(e.name));
      SPAWN.push({ t: t0, f: () => startTrip(a, [[{ p: [bx, by] }, { p: [bx, yRow], v: VMAX.lot }, { p: [lx, yRow], v: VMAX.lot }, { p: rack, v: VMAX.lot }]], () => { park(a, rack[0], rack[1], Math.PI / 2); a.until = T + 600; a.after = () => {
        const ex = pickExit(2, mill, ['pub']), rr = ex && roadFrom(2, mill, ex); if (!rr) return; startTrip(a, [[{ p: rack }, { p: laneEnd, v: VMAX.lot }, { p: mill.q, v: VMAX.lot }], roadLeg(rr)], () => { a.level = 0; a.mode = 'away';
          SPAWN.push({ t: T + 1800, f: () => { const rr2 = roadTo(2, ex, millN); if (!rr2) return; startTrip(a, [roadLeg(rr2), [{ p: millN.q }, { p: [lx, yRow], v: VMAX.lot }, { p: [bx, yRow], v: VMAX.lot }, { p: [bx, by], v: VMAX.rev, rev: true }]], () => park(a, bx, by, Math.PI / 2)); } }); }); }; }) }); }
    animal(2, 'dog', grid([r[0] + 0.2, r[1] + 0.15, r[0] + 1.6, r[1] + 0.6], 0.3, 0), 'yard dog (PR fenced yard)', { len: 0.22, w: 0.1, col: '#3a2a1a', rect: [r[0] + 0.15, r[1] + 0.12, r[0] + 1.7, r[1] + 0.62] }); } }
  // people (visible outside only; the rest are indoors)
  walkers(1, /^CCF staff path lot -> cold-store/, 1, 'CCF worker'); walkers(1, /^CCF staff path \(lot leg\)/, 1, 'CCF worker'); walkers(1, /^CCF rack path/, 1, 'CCF tank-rack operator');
  /* [CHOCO-LIFE 11:10] train crews (PHASE3-PLAN.md): on duty at the Marsden yard office 10 min before each L1 job that starts in the yard, walk path 21
     (office -> lead walkway, then the walkway 11 ft clear of the lead), cross the lead only at the walkway when nothing is on the lead within 300 ft scale, then ride hidden aboard. */
  const CREWS = []; { const P = byName(1, /^crew path office -> lead/), W = byName(1, /^crew walkway along yard lead/);
    if (P && W) { const px = (P.r[0] + P.r[2]) / 2, wy = (W.r[1] + W.r[3]) / 2, door = [px, P.r[3] - 0.1], LEADY = 6.06;
      SPAWN.push({ t: 1, f: () => { const DJ = (typeof D !== 'undefined' && D.jobs) || []; for (const j of (eng.session && eng.session.jobs) || []) { const dj = DJ.find(y => y.id === j.id); if (!dj || j.level !== 1 || /from L3/.test(j.name)) continue; /* CLNA 120 arrives with its crew aboard */
        const t0 = (dj.start_min || 0) * 60 * 0.6; /* engine compresses timetable minutes x0.6 (engine.js [R34]) */
        ['engineer', 'conductor'].forEach((role, k) => { const a = { id: ++idn, kind: 'person', type: 'crew', len: 0.25, w: 0.25, col: k ? '#f60' : '#fa0', level: 0, li: 1, name: 'train crew: ' + role + ' (' + j.id + ')', x: door[0] + (k ? 0.3 : 0), y: door[1], a: 0, crew: { j, t0, ph: 0, k, after: dj.after || [] }, mode: 'off' }; ENT.push(a); CREWS.push(a); }); } } });
      const leadClear = (x) => { if (T - lastScan > 0.45) scanCars(); return !(CARS[1] || []).some(c => Math.hypot(c.x - x, c.y - LEADY) < 22.5 && (c.mv || Math.abs(c.y - LEADY) < 0.3 && Math.abs(c.x - x) < 1.2)); };
      const locoX = j => { for (const c of eng.cuts) for (let i = 0; i < c.cars.length; i++) if (c.cars[i].loco && c.cars[i].addr === j.addr) return eng.carPose(c, i).x; return null; };
      var stepCrew = (a, dt) => { const C = a.crew, v = MPH(3) * dt, go = (q) => { const d = H(q, [a.x, a.y]); if (d <= v) { a.x = q[0]; a.y = q[1]; return true; } a.a = Math.atan2(q[1] - a.y, q[0] - a.x); a.x += (q[0] - a.x) / d * v; a.y += (q[1] - a.y) / d * v; return false; };
        if (C.ph === 0) { const _ai = eng.ai, _pre = C.after.filter(id => !(_ai && _ai.execs || []).some(x => x.job.id === id && (x.done || x.fail))); /* [CHOCO-LIFE item5] on duty only once the jobs it follows are off duty (engine [CHOCO-AFTER]), not at the timetable minute */ if (C.t0 - T <= 600 && !_pre.length) { C.ph = 1; a.level = 1; a.mode = 'office'; C.walkAt = Math.max(T + 30, C.t0 - 150); } return; } /* on duty: appears at the office door */
        if (C.ph === 1) { if (T >= C.walkAt) C.ph = 2; return; }
        if (C.ph === 2) { a.mode = 'walk'; if (go([px + (C.k ? 0.12 : -0.12), wy])) { const lx = locoX(C.j); C.wx = Math.max(W.r[0] + 0.3, Math.min(W.r[2] - 0.3, lx == null ? W.r[2] : lx)) + (C.k ? 0.3 : 0); C.ph = 3; } return; }
        if (C.ph === 3) { if (go([C.wx, wy])) C.ph = 4; return; }
        if (C.ph === 4) { a.mode = 'wait'; if (leadClear(C.wx)) { C.ph = 5; a.xc = true; STAT.crewX = (STAT.crewX || 0) + 1; } else STAT.crewWaits = (STAT.crewWaits || 0) + dt; return; } /* waits at the walkway for a clear lead */
        if (C.ph === 5) { a.mode = 'cross'; if (!leadClear(C.wx) && a.y > LEADY + 0.6) { C.ph = 4; a.xc = false; return; } if (go([C.wx, LEADY + 0.45])) { C.ph = 6; a.level = 0; a.mode = 'aboard'; a.xc = false; } } }; /* steps to the lead and boards (hidden while the train moves) */
    } else NOTES.push('crew paths not found'); }
  walkers(1, /^crew path lot -> office/, 1, 'engineer', { col: '#f60' });
  walkers(1, /^TL path lot/, 1, 'TL clerk'); walkers(1, /^PSR path lot/, 1, 'PSR customer'); walkers(1, /^TL crosswalk/, 1, 'TL worker'); walkers(1, /^PSR crosswalk/, 1, 'PSR worker'); walkers(1, /^FF crosswalk/, 1, 'FF worker');
  walkers(2, /^Nutrien path lot -> control/, 1, 'Nutrien operator'); walkers(2, /^Nutrien path control room -> pipe-bridge catwalk/, 1, 'Nutrien rack operator', { catwalk: true, col: '#ff0' }); walkers(2, /^Nutrien path road -> (unloading shed|spout\/pit sheds)/, 1, 'Nutrien shed operator', { col: '#ff0' });
  walkers(2, /^WL path lot/, 1, 'WL clerk'); walkers(2, /^PR path office -> riser/, 1, 'PR riser operator', { col: '#ff0' }); walkers(2, /^GCF path lot/, 1, 'GCF warehouse worker');
  // machines
  machine(1, /^TL transload pad/, 'forklift', 'coil-ram forklift (TL pad)', { off: 1.3, slot: tlS }); machine(1, /^PSR prepared-scrap piles/, 'forklift', 'scrap material handler (PSR)', {});
  machine(2, /^WL forklift lane kilns/, 'forklift', 'WL forklift (kilns -> shed)', { always: true }); machine(2, /^WL lumber storage yard/, 'forklift', 'WL yard forklift', { off: -0.6, slot: wlS });
  // animals
  { const w = byName(2, /Blounts Creek/, 'water'); if (w) { const xs = w.pts.map(p => p[0]), ys = w.pts.map(p => p[1]); animal(2, 'deer', grid([Math.min(...xs) - 1.5, Math.min(...ys) - 1.5, Math.max(...xs) + 1.5, Math.max(...ys) + 1.5], 0.5).filter(p => !inPoly(p, w.pts) && w.pts.some((q, i) => i && segD(p, w.pts[i - 1], q)[0] < 1.2)) /* [CHOCO-LIFE] on the creek bank, not in the water */, 'white-tailed deer (Blounts Creek swamp, dawn/dusk)', { wpts: w.pts, n: 3, len: 0.42, w: 0.14, col: '#9a6a3a' });
    animal(2, 'heron', grid([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 0.3).filter(p => inPoly(p, w.pts) && w.pts.some((q, i) => i && segD(p, w.pts[i - 1], q)[0] < 0.6)) /* [CHOCO-BL] wades the shallows at the bank, not mid-creek */, 'great blue heron (Blounts Creek)', { n: 1, len: 0.3, w: 0.08, col: '#9ab' }); } }
  { const w = byName(2, /Pamlico River edge/, 'water'); if (w) animal(2, 'gull', grid([99.5, 8, 103.5, 14], 1.0), 'laughing gull (Pamlico River)', { n: 3, fly: true, r: 1.2, len: 0.22, w: 0.06, col: '#f4f4f4' }); }
  { const l = byName(1, /^PSR prepared-scrap piles/); if (l) animal(1, 'vulture', [[(l.r[0] + l.r[2]) / 2, (l.r[1] + l.r[3]) / 2]], 'turkey vulture (over PSR)', { n: 1, fly: true, r: 2.0, len: 0.3, w: 0.08, col: '#222' }); }

  /* [CHOCO-UPS] BK.3 package cars (UPS brown): 2 parked in the lot behind the 933-3863 hub; 2 runs/session each; curbside stops (90-180 s) only where the car clears every track by >1.5 in (no crossing fouls); back in on return */
  { const lot = byName(1, /^UPS package-car lot/); const ind = e => /Industrial Dr/.test(e.name); const A = lot && proj(1, [39.5, 105.6], ind);
    if (lot && A) { const RC = /NC-33|Industrial Dr|CCF Plant Dr|Main St|Marsden Yard Rd/, ok = S => { if (!S || S.d > 1.5) return false; const e = S.e, dx = e.pts[1][0] - e.pts[0][0], dy = e.pts[1][1] - e.pts[0][1], L = Math.hypot(dx, dy) || 1; return [-1.0, 0, 1.0].every(k => trackD(1, [S.q[0] + k * dx / L, S.q[1] + k * dy / L]) > 1.5); };
      const CARS2 = [{ xs: 37.0, row: 112.4, t: [900, 4200], stops: [[39.5, 102.4], [61.8, 105.5], [78.3, 105.5], [101.0, 105.5], [117.0, 98.6]] }, { xs: 34.6, row: 111.5, t: [1500, 4800], stops: [[22.95, 66.0], [29.5, 20.6]] }];
      for (const c of CARS2) { const a = mkVeh('ups', 1, 'UPS package car'); park(a, c.xs, c.row, 0); const SP = c.stops.map(p => proj(1, p, e => RC.test(e.name))).filter(ok);
        const out = [{ p: [c.xs, c.row] }, { p: [38.8, c.row], v: VMAX.lot }, { p: [39.4, c.row - 1.1], v: VMAX.lot }, { p: [39.4, 106.3], v: VMAX.lot }, { p: A.q, v: VMAX.lot }];
        const home = () => { const r = route(1, a.cur, A); if (!r) { park(a, c.xs, c.row, 0); return; } startTrip(a, [roadLeg(r), [{ p: A.q }, { p: [39.4, 106.3], v: VMAX.lot }, { p: [39.3, c.row - 1.0], v: VMAX.lot }, { p: [40.4, c.row], v: VMAX.lot }], [{ p: [40.4, c.row] }, { p: [c.xs, c.row], v: VMAX.rev, rev: true }]], () => park(a, c.xs, c.row, 0)); };
        const hop = i => { if (i >= SP.length) return home(); const r = route(1, a.cur, SP[i]); if (!r) return hop(i + 1); startTrip(a, [roadLeg(r)], () => { a.cur = SP[i]; park(a, a.x, a.y, a.a); a.until = T + 90 + 90 * rnd(); a.after = () => hop(i + 1); }); };
        for (const t0 of c.t) SPAWN.push({ t: t0, f: () => { if (a.mode !== 'park' || !SP.length) return; const r = route(1, A, SP[0]); if (!r) return; startTrip(a, [out, roadLeg(r)], () => { a.cur = SP[0]; park(a, a.x, a.y, a.a); a.until = T + 90 + 90 * rnd(); a.after = () => hop(1); }); } }); } } }
  /* [CHOCO-HFARM] BK.1 horse farm animals (L1, off Main St): paddock herd grazes and walks short legs inside the board fence; goats + chickens in the pen */
  { const pad = [13.85, 31.25, 20.35, 37.55], pen = [13.85, 41.2, 16.95, 42.4], G = r => grid(r, 0.3, 0.3) /* body length clear of the fence */;
    for (const [t, lb, o] of [['horse', 'bay horse (horse farm paddock)', { len: 0.6, w: 0.17, col: '#6b3e1f' }], ['horse', 'chestnut horse (horse farm paddock)', { len: 0.6, w: 0.17, col: '#8b4a22' }], ['horse', 'gray mare (horse farm paddock)', { len: 0.58, w: 0.17, col: '#a3a19b' }],
      ['pony', 'pony (horse farm paddock)', { len: 0.42, w: 0.14, col: '#c9b48a' }], ['cow', 'Angus cow (horse farm paddock)', { len: 0.6, w: 0.22, col: '#1e1e1e' }]]) animal(1, t, G(pad), lb, Object.assign({ rect: pad, graze: 1 }, o));
    animal(1, 'goat', G(pen), 'goat (horse farm pen)', { n: 2, len: 0.3, w: 0.1, col: '#e2ddd0', rect: pen, graze: 1 });
    animal(1, 'chicken', grid(pen, 0.2, 0), 'chicken (horse farm pen)', { n: 3, len: 0.1, w: 0.06, col: '#b5651d', rect: pen, graze: 1 }); }

  /* ================= stepping ================= */
  const scanCars = () => { CARS = { 1: [], 2: [] }; for (const c of eng.cuts) for (let i = 0; i < c.cars.length; i++) { const q = eng.carPose(c, i), lv = Math.round(q.level); if (CARS[lv] && Math.abs(q.level - lv) < 0.05) CARS[lv].push({ x: q.x, y: q.y, mv: Math.abs(c.v) > 0.05, cut: c, len: c.cars[i].len }); } lastScan = T; };
  const xingClear = m => { if (T - lastScan > 0.45) scanCars(); const tk = eng.trk[m.tid]; const near = (CARS[eng.E[m.e].level] || []).filter(c => Math.hypot(c.x - m.pt[0], c.y - m.pt[1]) < 22.5);
    if (!near.length) return true; const edges = tk ? tk.edges : [m.e]; return !near.some(c => edges.some(eid => { const P = eng.E[eid].pts; for (let i = 1; i < P.length; i++) if (segD([c.x, c.y], P[i - 1], P[i])[0] < 0.35) return true; return false; }) || (c.mv && Math.hypot(c.x - m.pt[0], c.y - m.pt[1]) < 22.5)); };
  const blockedBy = (a, look) => { const hd = a.hd, cs = Math.cos(hd), sn = Math.sin(hd); let best = 1e9; const inAisle = a.tr && poseOn(a.tr, a.s + 0.01).seg.cls === 'lot';
    for (const b of ENT) { if (b === a || b.level !== a.level || b.kind === 'animal') continue; if (inAisle && b.mode === 'park' && b.stall !== a.stall && !(b.kind === 'machine')) continue; /* [CHOCO-LIFE] STOP sign: only moving traffic counts (no jam deadlock) ; cars in their stalls are beside the aisle, not in it */ const dx = b.x - a.x, dy = b.y - a.y; if (Math.abs(dx) > look + 6 || Math.abs(dy) > look + 6) continue;
      const lon = dx * cs + dy * sn, lat = -dx * sn + dy * cs; const half = (a.len + b.len) / 2; if (lon <= 0.05 || lon > look + half) continue; if (Math.abs(lat) > (a.w + b.w) / 2 + 0.08) continue; if (b.mode === 'park' && a.tr) { /* [CHOCO-LIFE] parked: test its real rotated footprint against the path ahead (not the body heading, which swings at corners) */ const cb = Math.cos(b.a || 0), sb = Math.sin(b.a || 0), hl = b.len / 2, hw = b.w / 2, cl = a.w / 2 + 0.08; let hit = -1; for (let k = 0; k <= look; k += 0.1) { const p = poseOn(a.tr, a.s + a.len / 2 + k), ux = p.x - b.x, uy = p.y - b.y, u = Math.abs(ux * cb + uy * sb) - hl, v = Math.abs(-ux * sb + uy * cb) - hw; if (Math.hypot(Math.max(u, 0), Math.max(v, 0)) < cl) { hit = k; break; } } if (hit < 0) continue; const g2 = hit - 0.25; if (g2 < best) { best = g2; a.blkBy = b.id; } continue; }
      if (b.mode === 'drive' && b.blk === a.id && b.id > a.id) continue; const gap = lon - half - 0.25; if (gap < best) { best = gap; a.blkBy = b.id; } } return best; };
  const stepVeh = (a, dt) => { const tr = a.tr; let vmax = poseOn(tr, a.s + 0.01).seg.v; a.blk = 0;
    // markers
    let lim = 1e9; for (let i = a.mi; i < tr.mk.length; i++) { const m = tr.mk[i]; if (m.ok) continue; if (m.s < a.s - 0.05) { if (m.k === 'xing' && !m.ok) { m.ok = true; } continue; }
      lim = Math.min(lim, m.s - a.s); if (m.s - a.s < 0.06 && a.v < 0.05) { if (!m.t0) m.t0 = T; if (T - m.t0 >= 2.0) { if (m.k === 'stop') { const busy = ENT.some(b => b !== a && b.mode === 'drive' && b.v > 0.05 && b.level === a.level && b.tr && poseOn(b.tr, b.s).seg.cls === 'pub' && Math.hypot(b.x - m.node[0], b.y - m.node[1]) < 9);
        if (!busy) m.ok = true; } else { if (xingClear(m)) { m.ok = true; STAT.crossings++; } else if (!m.cw) { m.cw = 1; STAT.crossWaits++; } } } } break; }
    if (a.lot) { const r = a.lot.r, dR = (x, y, m) => Math.hypot(Math.max(r[0] - m - x, 0, x - r[2] - m), Math.max(r[1] - m - y, 0, y - r[3] - m)); /* [CHOCO-LIFE] one-at-a-time lot entrance */
      if (a.lotOut && dR(a.x, a.y, 0) > a.len / 2 + 1.0) a.lotOut = false;
      if (a.lotIn && !a.inLot && a.gateP) { const g = H([a.x, a.y], a.gateP); if (g < 0.5 || dR(a.x, a.y, 0) < 0.05) a.inLot = true; /* committed: past the turn-in point */ else if (g < a.len / 2 + 1.0 && ENT.some(b => b !== a && b.mode === 'drive' && b.lot === a.lot && b.lotOut)) lim = 0; /* wait on the road before turning in */ } }
    const gap = blockedBy(a, a.len / 2 + 0.6 + a.v * 1.5); if (gap < 1e9) { lim = Math.min(lim, gap); a.blk = a.blkBy; }
    const vt = Math.min(vmax, Math.sqrt(Math.max(0, 2 * 1.5 * Math.max(0, lim)))); a.v = vt > a.v ? Math.min(vt, a.v + 1.0 * dt) : vt; if (lim <= 0.001) a.v = 0;
    a.s = Math.min(tr.Lend, a.s + Math.min(a.v * dt, Math.max(0, lim))); Object.assign(a, poseXY(a));
    if (a.s >= tr.Lend - 1e-3) { const f = a.then; a.tr = null; a.mode = 'park'; if (f) f(); } };
  const stepWalk = (a, dt) => { const w = a.walk; if (a.mode === 'in') { if (T >= a.until) { a.mode = 'walk'; a.dir = rnd() < 0.5 ? 1 : -1; a.s = a.dir > 0 ? 0 : w.L; a.level = a.li; } else return; }
    if (a.mode === 'dwell') { if (T >= a.until) { a.mode = 'walk'; a.dir = -a.dir; } }
    if (a.mode === 'walk') { let v = MPH(3);
      if (w.xwalk && (a.s <= 0.01 || a.s >= w.L - 0.01) && ENT.some(b => b.mode === 'drive' && b.level === a.level && Math.hypot(b.x - a.x, b.y - a.y) < 5)) v = 0;   // wait at the kerb for traffic
      a.s += a.dir * v * dt; if (a.s >= w.L || a.s <= 0) { a.s = Math.max(0, Math.min(w.L, a.s)); if (a.back) { a.mode = 'in'; a.level = 0; a.back = false; a.until = T + 300 + rnd() * 1500; } else { a.mode = 'dwell'; a.back = true; a.until = T + 15 + rnd() * 120; } } }
    const f = a.s / w.L; a.x = w.p0[0] + (w.p1[0] - w.p0[0]) * f; a.y = w.p0[1] + (w.p1[1] - w.p0[1]) * f; a.a = Math.atan2(w.p1[1] - w.p0[1], w.p1[0] - w.p0[0]) + (a.dir < 0 ? Math.PI : 0); };
  const stepMach = (a, dt) => { const m = a.m; let work = m.always; if (!work && m.slot && m.slot.busy && m.slot.busy.mode === 'park') work = true;
    if (!work) { if (T - lastScan > 2) scanCars(); const r = m.r; work = (CARS[a.li] || []).some(c => !c.mv && c.x > r[0] - 2 && c.x < r[2] + 2 && c.y > r[1] - 2 && c.y < r[3] + 2); }
    a.working = work; if (!work) return; m.ph += dt * MPH(5) / Math.max(1, m.L); const f = 0.5 - 0.5 * Math.cos(m.ph * Math.PI); a.x = m.P0[0] + (m.P1[0] - m.P0[0]) * f; a.y = m.P0[1] + (m.P1[1] - m.P0[1]) * f;
    a.a = Math.atan2(m.P1[1] - m.P0[1], m.P1[0] - m.P0[0]) + (Math.sin(m.ph * Math.PI) < 0 ? Math.PI : 0); };
  const deerSeg = (a, p) => { const L = H(p, [a.x, a.y]) || 1e-6; for (let k = 1; k <= Math.ceil(L / 0.1); k++) { const f = Math.min(1, k * 0.1 / L), q = [a.x + (p[0] - a.x) * f, a.y + (p[1] - a.y) * f]; if (!onB(a.li, q[0], q[1], 0.25) || (a.wpts && inPoly(q, a.wpts)) || trackD(a.li, q) < 0.9 || inStruct(a.li, q, -0.2)) return false; } return true; };
  const stepAni = (a, dt) => { if (a.type === 'deer') { const dusk = T < 1800 || T > 5400; if (!dusk) { a.level = 0; return; } a.level = a.li;
      if (T - lastScan > 2) scanCars(); const tr = (CARS[a.li] || []).filter(c => c.mv && Math.hypot(c.x - a.x, c.y - a.y) < 22.5);
      if (tr.length && !a.flee) { const d0 = Math.min(...tr.map(c => Math.hypot(c.x - a.x, c.y - a.y))); /* [CHOCO-LIFE 10:25] bolt along a line that stays on the board, out of the water, off track and out of walls */
        const segOk = p => deerSeg(a, p), _u = p => { const L = H(p, [a.x, a.y]); for (let k = 1; k <= Math.ceil(L / 0.1); k++) { const f = k * 0.1 / L, q = [a.x + (p[0] - a.x) * Math.min(1, f), a.y + (p[1] - a.y) * Math.min(1, f)]; if (!onB(a.li, q[0], q[1], 0.25) || (a.wpts && inPoly(q, a.wpts)) || trackD(a.li, q) < 0.9 || inStruct(a.li, q, -0.2)) return false; } return true; };
        const far = a.spots.map(p => [p, Math.min(...tr.map(c => Math.hypot(c.x - p[0], c.y - p[1])))]).filter(x => x[1] > d0 + 1 && H(x[0], [a.x, a.y]) < 6).sort((x, y) => y[1] - x[1]).find(x => segOk(x[0])); if (far) { a.flee = far[0]; a.bolt = T; STAT.deerBolts = (STAT.deerBolts || 0) + 1; } }
      const tgt = a.flee || (a.wTo && T < a.wT ? a.wTo : null); if (!tgt) { if (rnd() < dt / 40) { const c = a.spots.filter(p => H(p, [a.x, a.y]) < 1.6 && deerSeg(a, p)); /* [CHOCO-LIFE 10:25] wander lines also stay out of the water */ if (c.length) { a.wTo = c[Math.floor(rnd() * c.length)]; a.wT = T + 60; } } return; }
      const d = H(tgt, [a.x, a.y]), v = (a.flee ? MPH(30) : MPH(2)) * dt; if (d <= v) { a.x = tgt[0]; a.y = tgt[1]; a.flee = null; a.wTo = null; return; } a.a = Math.atan2(tgt[1] - a.y, tgt[0] - a.x); a.x += (tgt[0] - a.x) / d * v; a.y += (tgt[1] - a.y) / d * v; return; }
    if (a.type === 'heron') { if (T - lastScan > 2) scanCars(); const near = (CARS[a.li] || []).some(c => c.mv && Math.hypot(c.x - a.x, c.y - a.y) < 15); if (near && !a.gone) { a.gone = T + 600; a.level = 0; } if (a.gone && T > a.gone) { a.gone = 0; a.level = a.li; } return; }
    if (a.fly) { a.ph += dt * MPH(20) / Math.max(0.5, a.r); let x = a.home[0] + Math.cos(a.ph) * a.r, y = a.home[1] + Math.sin(a.ph) * a.r; if (!onB(a.li, x, y, 0.2)) { a.ph -= dt * MPH(20) / Math.max(0.5, a.r); return; } a.x = x; a.y = y; a.a = a.ph + Math.PI / 2; return; }
    if (a.graze) { const ck = a.type === 'chicken'; if (!a.wTo) { if (rnd() < dt / (ck ? 8 : 50)) { const c = a.spots.filter(p => H(p, [a.x, a.y]) < (ck ? 0.8 : 2.4)); if (c.length) a.wTo = c[Math.floor(rnd() * c.length)]; } return; } /* [CHOCO-HFARM] graze in place, then a short walk to a new spot inside the fenced rect */
      const d = H(a.wTo, [a.x, a.y]), v = MPH(ck ? 1.2 : 2.5) * dt; if (d <= v) { a.x = a.wTo[0]; a.y = a.wTo[1]; a.wTo = null; return; } a.a = Math.atan2(a.wTo[1] - a.y, a.wTo[0] - a.x); a.x += (a.wTo[0] - a.x) / d * v; a.y += (a.wTo[1] - a.y) / d * v; return; }
    if (a.type === 'dog') { if (!a.wTo || H(a.wTo, [a.x, a.y]) < 0.02) { if (rnd() < dt / 20) a.wTo = a.spots.length ? a.spots[Math.floor(rnd() * a.spots.length)] : null; if (!a.wTo) return; }
      const d = H(a.wTo, [a.x, a.y]), v = MPH(4) * dt; if (d <= v) { a.x = a.wTo[0]; a.y = a.wTo[1]; a.wTo = null; return; } a.a = Math.atan2(a.wTo[1] - a.y, a.wTo[0] - a.x); a.x += (a.wTo[0] - a.x) / d * v; a.y += (a.wTo[1] - a.y) / d * v; } };
  let acc = 0;
  const step = dt => { acc += dt; if (acc < 0.25) return; const h = acc; acc = 0; T = eng.t;
    for (const s of SPAWN) if (!s.done && T >= s.t) { s.done = true; s.f(); }
    for (const V of VISITS) if (!V.done && T >= V.t) runVisit(V);
    THRU.forEach((x, i) => { if (T < thruNext[i]) return; const p0 = x.r[0].p, busy = ENT.some(b => b.level === x.li && b.kind === 'vehicle' && Math.hypot(b.x - p0[0], b.y - p0[1]) < 3.5);
      if (busy) { thruNext[i] = T + 5; return; } thruNext[i] = T + (x.li === 1 ? 70 : 80) * (0.6 + 0.8 * rnd()) * THRU.filter(y => y.li === x.li).length / 2;
      const ty = ['car', 'car', 'pickup', 'pickup', 'car', 'box'][Math.floor(rnd() * 6)], a = mkVeh(ty, x.li, 'through traffic ' + ty + ' (' + x.a.name.split(' (')[0] + ' -> ' + x.b.name.split(' (')[0] + ')'); STAT.through++;
      startTrip(a, [x.r.map(v => ({ p: v.p, e: v.e || x.r[1].e }))], () => despawn(a)); });
    for (const a of ENT) { if (a.mode === 'park' && a.after && a.stay && !a.stay()) a.until = T; /* [CHOCO-LIFE] leaves once the bad order is gone */ if (a.mode === 'park' && a.after && a.until !== undefined && T >= a.until) { const f = a.after; a.after = null; f(); } }
    for (const a of ENT) { if (a.mode === 'drive' && a.tr) stepVeh(a, h); else if (a.crew) stepCrew(a, h); else if (a.kind === 'person') stepWalk(a, h); else if (a.kind === 'machine') stepMach(a, h); else if (a.kind === 'animal') stepAni(a, h); }
    for (let i = ENT.length - 1; i >= 0; i--) if (ENT[i].mode === 'gone') ENT.splice(i, 1); };
  const draw = (a, p) => { cx.save(); cx.translate(a.x, a.y); cx.rotate(a.a); const l = a.len, w = a.w;
    if (a.kind === 'vehicle' || a.kind === 'machine') { if (/reefer|van53|flat|bulk|tanker/.test(a.type)) { cx.fillStyle = a.type === 'flat' ? '#555' : a.col; cx.fillRect(-l / 2, -w / 2, l - 1.35, w); cx.fillStyle = '#246'; cx.fillRect(l / 2 - 1.3, -w / 2, 1.3, w); if (a.type === 'flat' && a.mode === 'park') { cx.fillStyle = '#89a'; cx.fillRect(-l / 2 + 0.4, -w / 2 + 0.08, l - 2.2, w - 0.16); } }
      else { cx.fillStyle = a.col; cx.fillRect(-l / 2, -w / 2, l, w); cx.fillStyle = 'rgba(0,0,0,0.35)'; cx.fillRect(l / 2 - Math.min(0.45, l * 0.3), -w / 2 + 0.05, 0.12, w - 0.1); if (a.type === 'fuel' || a.type === 'bobtail') { cx.fillStyle = '#c00'; cx.fillRect(-l / 2 + 0.1, -0.05, l - 0.8, 0.1); } }
      if (a.kind === 'machine' && a.working) { cx.fillStyle = '#f80'; cx.fillRect(l / 2, -0.12, 0.25, 0.24); } }
    else if (a.kind === 'person') { cx.fillStyle = a.col; cx.beginPath(); cx.arc(0, 0, 0.13, 0, 7); cx.fill(); }
    else { cx.fillStyle = a.col; if (a.fly) { cx.beginPath(); cx.moveTo(-w, -l); cx.lineTo(0, 0); cx.lineTo(-w, l); cx.lineWidth = 0.07; cx.strokeStyle = a.col; cx.stroke(); } else { cx.beginPath(); cx.ellipse(0, 0, l / 2, w / 2 + 0.03, 0, 0, 7); cx.fill(); } }
    if (a === sel.agent) { cx.strokeStyle = '#ff0'; cx.lineWidth = 0.1; cx.strokeRect(-l / 2 - 0.2, -w / 2 - 0.2, l + 0.4, w + 0.4); } cx.restore(); };
  const snap = () => ENT.filter(a => a.level).map(a => ({ id: a.id, kind: a.kind, type: a.type, li: a.li, x: +a.x.toFixed(3), y: +a.y.toFixed(3), a: +a.a.toFixed(3), len: a.len, w: a.w, mode: a.mode, name: a.name, s: a.tr ? +a.s.toFixed(2) : null, L: a.tr ? +a.tr.L.toFixed(2) : null, fly: !!a.fly, xc: !!a.xc, cat: !!(a.walk && /catwalk/.test(a.name)) || a.name === 'Nutrien rack operator' }));
  const gateDump = () => { const out = []; for (const { a, tr, s0 } of TRIPS) { const Le = tr.Lend || tr.L; for (let s = s0; s <= Le + 1e-6; s += 0.25) { const q = poseXY({ tr, s, len: a.len, w: a.w, li: a.li }); out.push([a.li, a.kind, a.name, +q.x.toFixed(3), +q.y.toFixed(3), +q.a.toFixed(3), a.len, a.w]); } }
    for (const L of LOTS) for (const st of L.stalls) out.push([L.li, 'stall', L.name, st.p[0], st.p[1], st.h, 1.13, 0.45]);
    for (const e of ENT) if (e.walk) for (let f = 0; f <= 1.0001; f += 0.05) out.push([e.li, 'walk', e.name, e.walk.p0[0] + (e.walk.p1[0] - e.walk.p0[0]) * f, e.walk.p0[1] + (e.walk.p1[1] - e.walk.p0[1]) * f, 0, 0.25, 0.25]);
    return { trips: TRIPS.length, pts: out }; };
  return { ENT, TEST, step, draw, snap, gateDump, T: () => T, report: () => ({ lots: LOTS.map(L => ({ li: L.li, name: L.name, target: L.target, cap: L.cap, now: L.stalls.filter(s => s.occ && s.occ.mode === 'park').length })), slots: SLOTS.map(s => ({ li: s.li, name: s.name, type: s.type, back: s.rev, busy: !!s.busy })), notes: NOTES, stat: STAT, thru: THRU.map(x => [x.li, x.a.name, x.b.name, +x.L.toFixed(1)]), exits: [1, 2].map(li => G[li].EX.map(x => [li, x.name, x.cls, x.p.map(v => +v.toFixed(2))])), counts: ENT.reduce((m, a) => { const k = a.kind + ':' + a.type; m[k] = (m[k] || 0) + (a.level ? 1 : 0); return m; }, {}) }), CARS: () => CARS, scanCars, xingClear };
});
let LIFE3 = null;
function initAgents() { agents.length = 0; seedCross(); try { LIFE3 = window.__life = LIFE(); } catch (e) { console.error('[CHOCO-LIFE] init failed', e); LIFE3 = null; } }
function seedCross() { crossings = []; D.scene.forEach((lv, li) => { for (const rd of lv.roads || []) for (const e of eng.E) { if (e.level !== li + 1 || !e.pts) continue; const x = segX(rd.pts, e.pts); if (x) crossings.push({ level: li + 1, x: x[0], y: x[1], e: e.id, on: false }); } }); }
function tickAgents(dt) {
  if (!LIFE3) return; LIFE3.step(dt); agents.length = 0; for (const a of LIFE3.ENT) if (a.level) agents.push(a);
  tickAgents.k = (tickAgents.k || 0) + 1; if (tickAgents.k % 10 === 0) for (const x of crossings) { const was = x.on; x.on = eng.cuts.some(c => { const o = eng.occupancy(c); if (o[x.e]) return true; const h = eng.posAt(c, c.len), t = eng.posAt(c, 0); return Math.abs(c.v) > 0.2 && Math.min(Math.hypot(h.x - x.x, h.y - x.y), Math.hypot(t.x - x.x, t.y - x.y)) < 18 && Math.round(h.level) === x.level; });
    if (audio && was !== x.on) audio.crossing(x.x + ',' + x.y, { x: x.x, y: x.y, z: 0 }, x.on); } }
function agentPos(a) { return { x: a.x, y: a.y, a: a.a }; }

// --------------------------------------------------------------------------- view transform
let VW = 0, VH = 0;
function resize() { VW = cv.width = cv.clientWidth * devicePixelRatio; VH = cv.height = cv.clientHeight * devicePixelRatio; }
function panels() {
  if (view.mode === 'both') { const s = Math.min(VW / 2 / (W + 8), VH / (H + 8)) * view.zoom; return [1, 2].map(l => ({ level: l, s, ox: (l - 1) * VW / 2 + 4 * s + view.px, oy: 4 * s + view.py, rot: 0 })); }
  if (view.mode === '1' || view.mode === '2' || view.mode === '3') { const s = Math.min(VW / (W + 8), VH / (H + 8)) * view.zoom; return [{ level: +view.mode, s, ox: 4 * s + view.px, oy: 4 * s + view.py, rot: 0 }]; }
  // ride / follow: centred on the subject, heading up
  let subj = null;
  if (view.mode === 'ride') { const cut = sel.addr && eng.locoCut(sel.addr); if (cut) { const i = cut.cars.findIndex(x => x.addr === sel.addr); const p = eng.carPose(cut, i); const lo = cut.cars[i]; const th = eng.throttles[sel.addr];
    const mv = (th && th.dir || 1) * (lo.fwd || 1); subj = { x: p.x, y: p.y, a: p.a + (mv < 0 ? Math.PI : 0), level: Math.round(p.level) }; } }
  else if (sel.agent) { const p = agentPos(sel.agent); subj = { x: p.x, y: p.y, a: p.a, level: sel.agent.level }; }
  if (!subj) subj = { x: W / 2, y: H / 2, a: -Math.PI / 2, level: 1 };
  const s = 14 * view.zoom * devicePixelRatio; return [{ level: subj.level, s, cx: subj.x, cy: subj.y, rot: -subj.a - Math.PI / 2, follow: true }];
}
function apply(p) { cx.setTransform(1, 0, 0, 1, 0, 0); if (p.follow) { cx.translate(VW / 2, VH * 0.62); cx.rotate(p.rot); cx.scale(p.s, p.s); cx.translate(-p.cx, -p.cy); } else { cx.translate(p.ox, p.oy); cx.scale(p.s, p.s); } }
function toWorld(p, mx, my) { const m = cx.getTransform(); apply(p); const inv = cx.getTransform().inverse(); cx.setTransform(m); const q = inv.transformPoint(new DOMPoint(mx, my)); return { x: q.x, y: q.y }; }
function inPanel(p, mx, my) { if (p.follow) return true; return mx >= p.ox - 4 * p.s && mx <= p.ox + (W + 4) * p.s && my >= p.oy - 4 * p.s && my <= p.oy + (H + 4) * p.s; }

// --------------------------------------------------------------------------- drawing
function draw() {
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#1b2a1f'; cx.fillRect(0, 0, VW, VH);
  for (const p of panels()) drawLevel(p);
}
// [FIX-20 2026-10-17] L3 staging (layout.l3, drawn only: the engine despawns trains when they ride the lift up to L3)
function drawL3(p) { apply(p); const s = p.s; cx.fillStyle = '#2f3d4a'; for (const b of (D.scene[1] || {}).boards || []) cx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); /* [CHOCO-L3WEDGE] */
  for (const pg of (D.scene[1] || {}).polys || []) { cx.beginPath(); pg.forEach((q, i) => i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1])); cx.closePath(); cx.fill(); }
  const APP = window.__l3APP = window.__l3APP || (() => { const lp = (D.l3.tracks || []).find(t => /^L3 loop/.test(t.name)), lf = D.graph.lift.pts, n = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05;
    const E2 = D.graph.edges.filter(e => e.level === 2 && e.pts && e.pts.length >= 2), ends = e => [e.pts[0], e.pts[e.pts.length - 1]];
    const chain = (from, to) => { /* loop end -> curve -> straight (x const) -> lift end, all L2 edges, endpoints matched to 0.05 in */
      const c = E2.find(e => ends(e).some(q => n(q, from)) && ends(e).some(q => Math.abs(q[0] - to[0]) < 0.01 && !n(q, to)));
      if (!c) return null; const cp = n(c.pts[0], from) ? c.pts : c.pts.slice().reverse(), m = cp[cp.length - 1];
      const st = E2.find(e => e !== c && ends(e).some(q => n(q, m)) && ends(e).some(q => n(q, to)) && e.pts.every(q => Math.abs(q[0] - to[0]) < 0.01));
      if (!st) return null; const sp = n(st.pts[0], m) ? st.pts : st.pts.slice().reverse(); return cp.concat(sp.slice(1)); };
    return { N: chain(lp.pts[0], lf[0]), S: chain(lp.pts[lp.pts.length - 1], lf[lf.length - 1]) }; })();
  cx.lineCap = 'round'; for (const k of ['N', 'S']) if (APP[k]) { line(APP[k], '#151515', 1.0); line(APP[k], '#8a8a8a', 0.55); } for (const t of D.l3.tracks || []) { line(t.pts, '#151515', 1.0); line(t.pts, t.type === 'main' ? '#8a8a8a' : '#6d8fb0', 0.55);
    if (/^S\d/.test(t.name)) { const q = t.pts[Math.floor(t.pts.length * 0.3)]; text(t.name, q[0] + 0.6, q[1] - 0.5, 1.6, '#cde'); } }
  for (const t of D.l3.turnouts || []) { const n = t.thr[0]; cx.beginPath(); cx.arc(n[0], n[1], Math.max(0.5, 4 / s), 0, 7); cx.fillStyle = '#9ab'; cx.fill(); }
  const L = eng.lift; if (L) { const e = eng.E[L.edge], here = !L.moving && L.level === 3; line(e.pts, here ? '#c9b458' : '#776', 1.1); }
  /* [CHOCO-L3DRAW 2026-10-24] draw ops-staged trains (ai.stage3: real consists, real car lengths) parked on S1-S5, packed end-to-end
     from the lift end (double-ended FIFO); a track is kept while the train is staged; cuts standing on the lift at L3 are drawn too.
     [L3ANIM 2026-10-25] drawing only (ops timing untouched): an arriving train runs in from the south loop end over the south ladder
     (L3-06..10) and up its S track to its spot; the next train due out pulls forward over the north ladder (L3-01..05) to the north loop
     end ahead of its due time and waits there until the ops sim lifts it. 10 smph, one train per ladder at a time, no passing through parked trains. */
  { const P3 = window.__l3park = window.__l3park || new Map(), ST = window.__l3ST = window.__l3ST || (D.l3.tracks || []).filter(t => /^S\d/.test(t.name)).map(t0 => { const t = { name: t0.name, pts: t0.pts[0][1] < t0.pts[t0.pts.length - 1][1] ? t0.pts.slice().reverse() : t0.pts };   /* [L3ANIM2] d=0 at the S (departure) end, per STAGING.md block 1 */
      const c = [0]; for (let i = 1; i < t.pts.length; i++) c.push(c[i - 1] + Math.hypot(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1])); return { t, c, len: c[c.length - 1] }; });
    const mk = pts => { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { t: { pts }, c, len: c[c.length - 1] }; };
    const at = (S, d) => { d = Math.max(0, Math.min(S.len, d)); let i = 1; while (i < S.c.length - 1 && S.c[i] < d) i++; const a = S.t.pts[i - 1], b = S.t.pts[i], f = (d - S.c[i - 1]) / ((S.c[i] - S.c[i - 1]) || 1);
      return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, a: Math.atan2(b[1] - a[1], b[0] - a[0]) }; };
    const sub = (S, d0, d1) => { const n = Math.max(2, Math.ceil(Math.abs(d1 - d0) / 0.5)); const r = []; for (let i = 0; i <= n; i++) { const q = at(S, d0 + (d1 - d0) * i / n); r.push([q.x, q.y]); } return r; };
    /* ladder graph: turnout throat/diverging legs + ladder tracks, endpoints joined within 0.3 in; path from an S-track end to a loop end */
    const LG = window.__l3LG = window.__l3LG || (() => { const ed = []; for (const t of D.l3.tracks || []) if (t.name === 'ladder') ed.push(t.pts); for (const x of D.l3.turnouts || []) { if (!/^L3-(0\d|10)$/.test(x.id)) continue; ed.push(x.thr); ed.push(x.div); }
      const N = [], key = p => { let i = N.findIndex(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3); if (i < 0) { N.push(p); i = N.length - 1; } return i; };
      return { N, E: ed.map(p => ({ p, a: key(p[0]), b: key(p[p.length - 1]), l: mk(p).len })), key }; })();
    const route = (from, to) => { const s = LG.key(from), g = LG.key(to), dist = { [s]: 0 }, prev = {}, Q = [s], done = new Set();
      while (Q.length) { Q.sort((a, b) => dist[a] - dist[b]); const u = Q.shift(); if (done.has(u)) continue; done.add(u); if (u === g) break;
        for (const e of LG.E) { const v = e.a === u ? e.b : e.b === u ? e.a : -1; if (v < 0 || done.has(v)) continue; const d = dist[u] + e.l; if (dist[v] === undefined || d < dist[v]) { dist[v] = d; prev[v] = [u, e]; Q.push(v); } } }
      if (dist[g] === undefined) return null; const out = []; let v = g; while (v !== s) { const [u, e] = prev[v]; out.unshift(e.a === u ? e.p : e.p.slice().reverse()); v = u; } return [].concat(...out); };
    const APN = window.__l3APP && window.__l3APP.N && window.__l3APP.N.slice().reverse(), APS = window.__l3APP && window.__l3APP.S;   /* [L3ANIM2] lift N end -> loop N end (arrivals), loop S end -> lift S end (departures) */
    const NEND = [113.076, 1.282], SEND = [113.076, 119.945], IPS = 10 * 17.6 / 160;   // loop ends at the lift (north / south); 10 smph in HO inches per second
    const G3 = window.__opsGame, q3 = (G3 && G3.ai && G3.ai.stage3) || [], live = new Set(q3), now = eng.t; for (const k of [...P3.keys()]) if (!live.has(k)) P3.delete(k);
    const used = ST.map(S => 1.0 + [...P3.values()].filter(v => v.S === S).reduce((m, v) => Math.max(m, v.o + v.L), 0));
    for (const st of q3) { if (P3.has(st)) continue; const L = st.cars.reduce((s, c) => s + c.len, 0);
      let k = ST.findIndex((S, i) => used[i] === 1.0 && S.len >= L + 2); if (k < 0) k = ST.findIndex((S, i) => S.len - used[i] >= L + 1); if (k < 0) k = used.indexOf(Math.min(...used));
      const v = { S: ST[k], o: used[k], L, t0: now };
      if (now > 5) { const r = route(NEND, v.S.t.pts[v.S.t.pts.length - 1]); if (r) { v.arr = mk((APN || []).concat(r.slice(APN ? 1 : 0)).concat(sub(v.S, v.S.len, v.o).slice(1))); v.arrT = v.arr.len / IPS; } }   // runs in from the south loop end, head car first
      P3.set(st, v); used[k] += L + 1.0; }
    /* the next train due out pulls down the south ladder + SE curve to the lift S end when nothing stands ahead of it on its track and the north ladder is free */
    const busyN = [...P3.values()].some(v => v.dep), busyS = [...P3.values()].some(v => v.arr && now - v.t0 < v.arrT);
    if (!busyN) { const nx = q3.slice().sort((a, b) => a.until - b.until).find(st => P3.has(st)); const v = nx && P3.get(nx);
      if (v && !(v.arr && now - v.t0 < v.arrT) && ![...P3.values()].some(w => w !== v && w.S === v.S && w.o < v.o)) { const r = route(v.S.t.pts[0], SEND);
        if (r) { const pth = mk(sub(v.S, v.o + v.L, 0).concat(r.slice(1)).concat(APS ? APS.slice(1) : [])); const T = (pth.len - v.L) / IPS; if (now >= nx.until - T) { v.dep = pth; v.depT0 = now; } } } }
    const POS = []; const drawCar = (car, q, who) => { POS.push([who, +q.x.toFixed(2), +q.y.toFixed(2)]); cx.save(); cx.translate(q.x, q.y); cx.rotate(q.a); const w = 0.62, l = car.len - 0.18; cx.fillStyle = car.loco ? '#c22' : (CARCOL[car.type] || '#777'); cx.fillRect(-l / 2, -w / 2, l, w); cx.restore(); };
    for (const [st, v] of P3) { let path = null, head = 0, rev = false;
      if (v.arr && now - v.t0 < v.arrT) { path = v.arr; head = Math.min(path.len, (now - v.t0) * IPS); }
      else if (v.dep) { path = v.dep; head = Math.min(path.len - 0.4, v.L + (now - v.depT0) * IPS); }
      if (path) { let o = 0; for (const car of st.cars) { const d = head - o - car.len / 2; o += car.len; if (d < 0) continue; drawCar(car, at(path, d), st.tr.sym); } const q = at(path, Math.max(0, head - 0.5)); text(st.tr.sym + (v.dep ? ' (pulling up)' : ' (arriving)'), q.x, q.y - 0.9, 1.3, '#ff8'); continue; }
      let o = v.o; for (const car of st.cars) { const q = at(v.S, o + car.len / 2); o += car.len; drawCar(car, q, st.tr.sym); }
      const q = at(v.S, v.o); text(st.tr.sym + ' (' + st.cars.length + ')', q.x, q.y - 0.9, 1.3, '#fff'); }
    for (const c of eng.cuts) for (let i = 0; i < c.cars.length; i++) { const car = c.cars[i], q = eng.carPose(c, i); if (Math.abs(q.level - 3) > 0.5) continue; drawCar(car, q, 'lift'); }
    window.__l3drawn = { pos: POS, staged: q3.length, parked: [...P3.entries()].map(([st, v]) => [st.tr.sym, v.S.t.name, st.cars.length, +v.L.toFixed(1), +v.o.toFixed(1), +v.S.len.toFixed(1), v.dep ? 'dep' : (v.arr && now - v.t0 < v.arrT) ? 'arr' : 'park']) }; }
  text('L3 STAGING - S1-S5 double-ended FIFO (STAGING.md)', 6, 30, 2.2, '#fd6'); }
function drawLevel(p) {
  if (p.level === 3) { if (D.l3) drawL3(p); return; }
  const lv = D.scene[p.level - 1]; apply(p); const s = p.s, px1 = 1 / s;
  cx.fillStyle = '#3f5a3c'; for (const b of lv.boards || []) cx.fillRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
  for (const pg of lv.polys || []) poly(pg, '#3f5a3c');
  for (const w of lv.water || []) if (w.pts) poly(w.pts, '#2f5a7a');
  cx.lineCap = 'round';
  for (const r of lv.roads || []) if (r.pts) line(r.pts, '#555', r.w || 1.6);
  for (const l of lv.lots || []) if (l.r) { cx.fillStyle = l.kind === 'parking' ? '#4a4a4a' : '#6b6658'; cx.fillRect(l.r[0], l.r[1], l.r[2] - l.r[0], l.r[3] - l.r[1]); }
  for (const st of lv.structures || []) { const r = st.r; cx.fillStyle = st.color || '#8a7a6a'; cx.globalAlpha = 0.85; cx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); cx.globalAlpha = 1; }
  // track
  for (const e of eng.E) { if (e.lift ? false : e.level !== p.level) continue; const lg = eng.legOf[e.id];
    line(e.pts, '#151515', 1.0); line(e.pts, lg ? '#5c5c5c' : COL[e.type] || '#555', 0.55); }
  for (const b of blue) if (eng.t < b.until && eng.trk[b.tid].level === p.level) for (const e of eng.trk[b.tid].edges) line(eng.E[e].pts, '#2a5bd8', 0.3);
  if (GUIDE && GUIDE.tid && eng.trk[GUIDE.tid] && eng.trk[GUIDE.tid].level === p.level) { const k = 0.55 + 0.45 * Math.sin(Date.now() / 260); cx.globalAlpha = 0.35 + 0.5 * k;   // [UX] next-move target
    for (const e of eng.trk[GUIDE.tid].edges) line(eng.E[e].pts, '#ffe14d', 1.6); cx.globalAlpha = 1; const E0 = eng.E[eng.trk[GUIDE.tid].edges[0]], m = E0.pts[E0.pts.length >> 1]; text('NEXT', m[0] + 1, m[1] - 1.2, Math.max(1.6, 13 * px1), '#ffe14d');
    for (const [id, leg] of GUIDE.turnouts || []) { const t = eng.T[id]; if (!t || t.level !== p.level) continue; const n = eng.N[t.P]; cx.beginPath(); cx.arc(n.x, n.y, Math.max(1.0, 9 * px1), 0, 7); cx.lineWidth = Math.max(0.2, 2.5 * px1); cx.strokeStyle = t.state === leg ? '#3f3' : '#f33'; cx.stroke(); } }
  // lift
  const L = eng.lift; if (L) { const e = eng.E[L.edge], here = !L.moving && L.level === p.level; cx.globalAlpha = here ? 1 : 0.35; line(e.pts, here ? '#c9b458' : '#776', 1.1); line(e.pts, '#333', 0.4); cx.globalAlpha = 1;
    const mid = e.pts[0]; text(L.moving ? `LIFT ${L.from}→${L.to} ${(L.p * 100 | 0)}%` : `LIFT @ L${L.level}`, 124, 60, 2.4, here ? '#fd6' : '#999', -Math.PI / 2); }
  // turnouts
  for (const t of Object.values(eng.T)) { if (t.level !== p.level) continue; const n = eng.N[t.P]; const r = Math.max(0.55, 5 * px1);
    cx.beginPath(); cx.arc(n.x, n.y, r, 0, 7); cx.fillStyle = t.state === 'N' ? '#3c3' : '#f90'; cx.fill(); if (eng.reserve['T:' + t.id]) { cx.lineWidth = 2 * px1; cx.strokeStyle = '#ff0'; cx.stroke(); }
    const lg = t.state === 'N' ? t.legN : t.legD; line(eng.E[lg].pts, t.state === 'N' ? '#3c3' : '#f90', 0.18);
    if (s > 9) text(t.id, n.x + 0.8, n.y - 0.8, 0.9, '#cfc'); }
  // block signals (click = CTC hold / clear)
  if (eng.signals && s > 2.2) for (const sg of eng.signals) { if (sg.level !== p.level) continue; const r = Math.max(0.35, 3.5 * px1);
    cx.beginPath(); cx.arc(sg.x, sg.y, r, 0, 7); cx.fillStyle = sg.aspect === 'G' ? '#2f2' : sg.aspect === 'Y' ? '#fd2' : '#f22'; cx.fill();
    cx.lineWidth = 1.5 * px1; cx.strokeStyle = eng.sigHold[sg.id] ? '#fff' : '#000'; cx.stroke(); }
  // crossings
  for (const x of crossings) if (x.level === p.level) { cx.fillStyle = x.on && (Date.now() / 300 | 0) % 2 ? '#f22' : '#999'; cx.fillRect(x.x - 0.4, x.y - 0.4, 0.8, 0.8); }
  // cars
  for (const c of eng.cuts) {
    for (let i = 0; i < c.cars.length; i++) { const car = c.cars[i], q = eng.carPose(c, i); if (Math.round(q.level) !== p.level && !(eng.lift && eng.lift.moving)) continue;
      if (eng.lift && eng.lift.moving && Math.abs(q.level - p.level) > 0.5) continue;
      cx.save(); cx.translate(q.x, q.y); cx.rotate(q.a); const w = 0.62, l = car.len - 0.18;
      cx.fillStyle = car.loco ? (car.ai ? '#c22' : '#111') : (CARCOL[car.type] || '#777'); cx.fillRect(-l / 2, -w / 2, l, w);
      if (car.loco) { cx.fillStyle = car.ai ? '#fff' : '#fc0'; cx.fillRect((car.fwd > 0 ? 1 : -1) * l / 2 - (car.fwd > 0 ? 0.6 : -0.0), -w / 2, 0.6, w); }
      if (car.status === 'setout' || car.status === 'pickup') { cx.fillStyle = car.status === 'setout' ? '#4af' : '#f4a'; cx.fillRect(-0.4, -0.15, 0.8, 0.3); }
      if (c.derailed) { cx.strokeStyle = '#f00'; cx.lineWidth = 0.15; cx.strokeRect(-l / 2, -w / 2, l, w); }
      if (car.addr && car.addr === sel.addr) { cx.strokeStyle = '#ff0'; cx.lineWidth = 0.18; cx.strokeRect(-l / 2 - 0.2, -w / 2 - 0.2, l + 0.4, w + 0.4); }
      cx.restore(); }
    if (Math.abs(c.v) < 0.02) for (let k = 1; k < c.cars.length; k++) { const q = eng.couplerPos(c, k); if (Math.round(q.level) !== p.level) continue; cx.beginPath(); cx.arc(q.x, q.y, Math.max(0.22, 3 * px1), 0, 7); cx.fillStyle = '#fff'; cx.fill(); }
  }
  for (const a of agents) { if (a.level !== p.level) continue; if (LIFE3) LIFE3.draw(a, p); }   /* [CHOCO-LIFE] */
  for (const l of (lv.labels || [])) if (s > 6 && l.kind === 'industry') text(l.text, l.x, l.y, 1.0, '#eee');
  if (!p.follow) { cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#fd6'; cx.font = `${14 * devicePixelRatio}px system-ui`; cx.fillText(p.level === 1 ? 'L1 Pamlico Jct (deck 38 in)' : 'L2 Riverton (deck 56 in)', p.ox + 4, p.oy + 16 * devicePixelRatio); }
  else { cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#fd6'; cx.font = `${15 * devicePixelRatio}px system-ui`; cx.fillText(view.mode === 'ride' ? `Cab ride — ${sel.addr} (track ahead is up)` : `Following ${sel.agent ? sel.agent.name : '…'} (click a person/vehicle)`, 12, 22 * devicePixelRatio); }
}
function poly(P, c) { cx.beginPath(); P.forEach((q, i) => i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1])); cx.closePath(); cx.fillStyle = c; cx.fill(); }
function line(P, c, w) { cx.beginPath(); P.forEach((q, i) => i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1])); cx.strokeStyle = c; cx.lineWidth = w; cx.stroke(); }
function text(t, x, y, sz, c, rot) { cx.save(); cx.translate(x, y); if (rot) cx.rotate(rot); cx.font = `${sz}px system-ui`; cx.fillStyle = c; cx.fillText(t, 0, 0); cx.restore(); }

// --------------------------------------------------------------------------- picking
function pick(mx, my) {
  for (const p of panels()) { if (!inPanel(p, mx, my)) continue; const w = toWorld(p, mx, my), tol = Math.max(0.5, 8 * devicePixelRatio / p.s);
    for (const c of eng.cuts) if (Math.abs(c.v) < 0.02) for (let k = 1; k < c.cars.length; k++) { const q = eng.couplerPos(c, k); if (Math.round(q.level) === p.level && Math.hypot(q.x - w.x, q.y - w.y) < tol * 0.7) return { kind: 'coupler', cut: c, k }; }
    for (const t of Object.values(eng.T)) { if (t.level !== p.level) continue; const n = eng.N[t.P]; if (Math.hypot(n.x - w.x, n.y - w.y) < tol) return { kind: 'turnout', t }; }
    for (const sg of eng.signals || []) { if (sg.level !== p.level) continue; if (Math.hypot(sg.x - w.x, sg.y - w.y) < tol * 0.8) return { kind: 'signal', sg }; }
    for (const c of eng.cuts) for (let i = 0; i < c.cars.length; i++) { const q = eng.carPose(c, i); if (Math.round(q.level) !== p.level) continue; if (Math.hypot(q.x - w.x, q.y - w.y) < c.cars[i].len / 2) return { kind: 'car', cut: c, car: c.cars[i] }; }
    for (const a of agents) { if (a.level !== p.level) continue; const q = agentPos(a); if (Math.hypot(q.x - w.x, q.y - w.y) < Math.max(0.8, tol)) return { kind: 'agent', a }; }
    for (const st of D.scene[p.level - 1].structures || []) { const r = st.r; if (w.x >= r[0] && w.x <= r[2] && w.y >= r[1] && w.y <= r[3]) return { kind: 'structure', st }; }
    return { kind: 'none', w, p };
  }
  return null;
}
function describe(h) {
  if (!h) return '';
  if (h.kind === 'coupler') return `Coupler between ${h.cut.cars[h.k - 1].id} and ${h.cut.cars[h.k].id} — click to uncouple by hand`;
  if (h.kind === 'turnout') { const t = h.t; return `${t.id} ${t.part} — ${t.state === 'N' ? 'normal' : 'reverse'}${eng.reserve['T:' + t.id] ? ' (lined for ' + eng.reserve['T:' + t.id] + ')' : ''} — click to throw`; }
  if (h.kind === 'car') { const c = h.car; if (c.loco) return `${c.id} ${c.model || c.type} addr ${c.addr} ${c.ai ? '(AI ' + c.train + ')' : ''} — ${OE.MPH(Math.abs(h.cut.v)).toFixed(1)} smph — click to select`;
    const ind = c.ind && D.industries.find(i => i.id === c.ind); return `${c.id} — ${c.type} ${c.len} in — ${c.status === 'setout' ? 'SET OUT at ' + (ind ? ind.groups.find(g => g.id === c.grp).name : '?') : c.status === 'pickup' ? 'PICK UP (' + (c.load || '') + ') from ' + (ind ? ind.name : '') : c.status === 'stay' ? 'stays at ' + (ind ? ind.name : '') : (c.home || '')}`; }
  if (h.kind === 'signal') return `Signal ${h.sg.id} (${h.sg.tid} end ${h.sg.end}) — ${{ G: 'clear', Y: 'approach', R: 'stop' }[h.sg.aspect]}${eng.sigHold[h.sg.id] ? ' (held by CTC)' : ''} — click to ${eng.sigHold[h.sg.id] ? 'clear' : 'hold'}`;
  if (h.kind === 'agent') return `${h.a.name} — click to follow`;
  if (h.kind === 'structure') return h.st.name;
  return '';
}
cv.addEventListener('mousemove', e => { const h = pick(e.offsetX * devicePixelRatio, e.offsetY * devicePixelRatio); const d = describe(h), tip = $('tip'); if (d) { tip.textContent = d; tip.style.display = 'block'; tip.style.left = e.clientX + 14 + 'px'; tip.style.top = e.clientY + 10 + 'px'; } else tip.style.display = 'none';
  if (drag) { view.px += (e.offsetX - drag.x) * devicePixelRatio; view.py += (e.offsetY - drag.y) * devicePixelRatio; drag = { x: e.offsetX, y: e.offsetY, moved: true }; } });
let drag = null;
cv.addEventListener('mousedown', e => drag = { x: e.offsetX, y: e.offsetY });
cv.addEventListener('mouseup', e => { const was = drag && drag.moved; drag = null; if (!was) click(e.offsetX * devicePixelRatio, e.offsetY * devicePixelRatio); });
cv.addEventListener('wheel', e => { e.preventDefault(); view.zoom = Math.max(0.5, Math.min(12, view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); }, { passive: false });
cv.addEventListener('dblclick', () => { view.zoom = 1; view.px = view.py = 0; });
function click(mx, my) {
  audio && audio.start(); const h = pick(mx, my); if (!h) return;
  if (h.kind === 'coupler') eng.uncouple(h.cut, h.k, 'player');
  else if (h.kind === 'turnout') { if (eng.dispatchMode !== 'manual' && eng.reserve['T:' + h.t.id] && !String(eng.reserve['T:' + h.t.id]).match(/^(P20|R6|YARD)/)) { toast(`${h.t.id} is lined for ${eng.reserve['T:' + h.t.id]} — ask the dispatcher (Manual CTC mode lets you)`); return; } eng.throwTurnout(h.t.id, null, 'player'); }
  else if (h.kind === 'signal') toggleSignal(h.sg.id);
  else if (h.kind === 'car' && h.car.loco) { sel.addr = h.car.addr; thr.select(h.car.addr); }
  else if (h.kind === 'agent') { sel.agent = h.a; view.mode = 'follow'; $('view').value = 'follow'; }
}
// --------------------------------------------------------------------------- UI panels
function fillJobs() { const s = $('job'); s.innerHTML = eng.session.jobs.map(j => `<option value="${j.id}">${j.name}</option>`).join(''); if (myJob) s.value = myJob.id; cards(); }
$('job').onchange = e => { myJob = eng.session.jobs.find(j => j.id === e.target.value); sel.addr = myJob.addr; thr.select(myJob.addr); cards(); };
$('autojob').onclick = () => { if (myJob) startAI(myJob); };
/* [UX 2026-10-18] next-move coach: one plain-language instruction for your job, the target track glowing on the map and the planned
   turnouts for that move (green tick = already set). Click a car card to focus the coach on that car; click it again to clear. */
let GUIDE = null, FOCUS = null;
function whereCar(id) { for (const c of eng.cuts) { let o = 0; for (const car of c.cars) { const l = eng.locate(c, o + car.len / 2); o += car.len; if (car.id === id) return { cut: c, tid: eng.e2t[l.e] }; } } return null; }
function trackLabel(tid) { if (!tid) return 'the track'; const ind = D.industries.find(i => i.tid === tid); const t = eng.trk[tid]; return ind ? ind.name : `${t ? t.type : 'track'} ${tid}${t ? ' (L' + t.level + ')' : ''}`; }
function planTurnouts(tid) { const P = myJob && myJob.plan; if (!P) return []; const s = P.steps.find(x => x.to === tid) || P.steps.find(x => (x.via || []).includes(tid)); return s ? s.turnouts || [] : []; }
function nextMove() { if (!myJob) return null; const C = eng.session.cards.filter(c => c.job === myJob.id), st = scoreState(), cut = eng.locoCut(myJob.addr);
  const inTrain = id => !!(cut && cut.cars.some(x => x.id === id)), indT = id => (D.industries.find(i => i.id === id) || {}).tid;
  if (myJob.exec && !myJob.exec.done && !myJob.exec.fail) { const S = myJob.exec.steps[myJob.exec.i] || {}; return { who: 'ai', tid: S.to, text: `AI crew is working ${myJob.name}: move ${myJob.exec.i + 1} of ${myJob.exec.steps.length} — ${S.kind || 'move'} to ${trackLabel(S.to)}${S.cars && S.cars.length ? ' with ' + S.cars.length + ' car(s)' : ''}.`, turnouts: S.turnouts || [] }; }
  const todo = C.filter(c => !st[c.car]); const f = FOCUS && todo.find(c => c.car === FOCUS);
  if (!todo.length) return { who: 'you', done: true, tid: myJob.stops && myJob.stops[0] && myJob.stops[0].tid, text: `Switch list complete ✓ — take ${myJob.name} back to ${trackLabel(myJob.stops && myJob.stops[0] && myJob.stops[0].tid)} and tie down.`, turnouts: [] };
  const so = todo.filter(c => c.kind === 'set out'), pu = todo.filter(c => c.kind === 'pick up');
  const loose = so.filter(c => !inTrain(c.car));
  if (!f && loose.length && cut && loose.length === so.length) { const w = whereCar(loose[0].car); const tid = w && w.tid; return { who: 'you', tid, text: `Couple to your block first: ${loose.length} set-out car(s) are standing on ${trackLabel(tid)}. Line the route, ease in at ≤ 4 smph to couple.`, turnouts: planTurnouts(tid), cars: loose.map(c => c.car) }; }
  const pickOrder = f ? [f] : so.length ? so : pu; const c0 = pickOrder[0], tid = indT(c0.spot), nm = c => c.kind === 'set out' ? c.to : c.from, same = (f ? [f] : (c0.kind === 'set out' ? so : pu)).filter(c => c.spot === c0.spot && nm(c) === nm(c0));
  if (c0.kind === 'set out') return { who: 'you', tid, text: `Spot ${same.length} car(s) at ${nm(c0)}: ${same.map(c => c.car).join(', ')}. Pull onto the glowing track, stop, then click the white coupler dot to cut them off.`, turnouts: planTurnouts(tid), cars: same.map(c => c.car) };
  return { who: 'you', tid, text: `Pick up ${same.length} car(s) at ${nm(c0)}: ${same.map(c => c.car).join(', ')}. Ease onto them at ≤ 4 smph to couple, then pull out.`, turnouts: planTurnouts(tid), cars: same.map(c => c.car) }; }
function guideUI() { const el = $('nextmove'); if (!el) return; GUIDE = nextMove(); const g = GUIDE;
  const html = !g ? '' : `<div class="nm ${g.done ? 'done' : g.who}"><div class="nm-h">${g.who === 'ai' ? '&#129302; AI crew' : g.done ? '&#9989; Done' : '&#10145;&#65039; Next move'}${FOCUS ? ' <button class="nm-x" data-unfocus="1" title="Back to the full switch list">show all</button>' : ''}</div><div class="nm-t">${esc(g.text)}</div>${g.turnouts && g.turnouts.length ? `<div class="nm-to">Turnouts: ${g.turnouts.map(([id, leg]) => { const ok = eng.T[id] && eng.T[id].state === leg; return `<span class="${ok ? 'ok' : 'bad'}" title="${ok ? 'already set' : 'click this turnout on the map to throw it'}">${esc(id)} ${leg === 'N' ? 'normal' : 'reverse'} ${ok ? '&#10003;' : '&#10007;'}</span>`; }).join(' ')}</div>` : ''}${g.tid ? '<div class="nm-hint">Target track glows yellow on the map.</div>' : ''}</div>`;
  if (html !== guideUI.last) { guideUI.last = html; el.innerHTML = html; } }
function cards() { if (!myJob) return; const C = eng.session.cards.filter(c => c.job === myJob.id); const st = scoreState();
  const done = C.filter(c => st[c.car]).length, pct = C.length ? Math.round(done / C.length * 100) : 0;
  const grp = (kind, ic, lab) => { const L = C.filter(c => c.kind === kind); if (!L.length) return ''; return `<div class="sl-h">${ic} ${lab} <span>${L.filter(c => st[c.car]).length}/${L.length}</span></div><table class="sl">${L.map(c => `<tr data-car="${esc(c.car)}" class="${st[c.car] ? 'done' : ''}${FOCUS === c.car ? ' focus' : ''}" title="${esc(c.kind + ' ' + c.car + ' (' + c.type + ')')} — click to focus the next-move coach on this car"><td class="ck">${st[c.car] ? '&#10003;' : '&#9744;'}</td><td class="cc"><div><span class="car-id">${esc(c.car)}</span> <small class="ty">${esc(c.type)}</small></div><div class="dest">${st[c.car] ? (kind === 'set out' ? 'spotted ✓' : 'in train ✓') : (kind === 'set out' ? '→ ' : '← from ') + esc(kind === 'set out' ? c.to : c.from)}</div></td></tr>`).join('')}</table>`; };
  const html = `<div class="sl-prog" title="${done} of ${C.length} cars worked"><i style="width:${pct}%"></i><span>${done}/${C.length} cars · ${pct}%</span></div>${grp('set out', '&#11015;', 'Set out')}${grp('pick up', '&#11014;', 'Pick up')}${C.length ? '' : '<div class="small">No cars on this job.</div>'}
  <div class="small">${myJob.plan ? `Planner: ${myJob.plan.steps.length} moves, ~${Math.round(myJob.plan.t / 60)} min${myJob.plan.failures.length ? ' — ' + esc(myJob.plan.failures.join('; ')) : ''}` : 'no precomputed plan for this seed'}${myJob.exec ? ' · AI crew: ' + (myJob.exec.done ? 'done' : myJob.exec.fail ? 'FAILED ' + esc(myJob.exec.fail) : 'step ' + (myJob.exec.i + 1)) : ''}</div>`;
  if (html !== cards.last) { cards.last = html; $('cards').innerHTML = html; } guideUI(); }
$('cards').addEventListener('click', e => { const r = e.target.closest('tr[data-car]'); if (!r) return; FOCUS = FOCUS === r.dataset.car ? null : r.dataset.car; cards.last = ''; cards(); });
$('nextmove') && $('nextmove').addEventListener('click', e => { if (e.target.closest('[data-unfocus]')) { FOCUS = null; cards.last = ''; cards(); } });
function scoreState() { const m = {}; const indTrk = {}; for (const i of D.industries) indTrk[i.id] = i.tid;
  for (const c of eng.cuts) { let o = 0; for (const car of c.cars) { const l = eng.locate(c, o + car.len / 2); o += car.len;
    if (car.status === 'setout') m[car.id] = eng.e2t[l.e] === indTrk[car.ind] && !c.cars.some(x => x.loco); if (car.status === 'pickup') m[car.id] = c.cars.some(x => x.loco && !x.ai); } } return m; }
function ui() {
  const t = clockStart + eng.t * FAST; $('clock').textContent = `${String((t / 3600 | 0) % 24).padStart(2, '0')}:${String((t / 60 | 0) % 60).padStart(2, '0')}`;
  const L = eng.lift; $('liftst').textContent = L.moving ? `moving ${L.from}→${L.to}` : `at L${L.level}`;
  const sc = OE.scoreSession(eng); $('score').innerHTML = `Spotted ${sc.spotted}/${sc.setouts} · pulled ${sc.pulled}/${sc.pickups}<br>Violations ${sc.violations} · <b>${sc.points} pts</b>`;
  const LF = window.OPS_LOGFILTER || 'all', TAG = { disp: 'DISP', warn: 'WARN', radio: 'RADIO', ai: 'AI', info: 'INFO', yard: 'YARD', move: 'MOVE', player: 'YOU' }; const lg = eng.log.filter(l => LF === 'all' || (LF === 'warn' ? l.kind === 'warn' : LF === 'disp' ? /disp|yard/.test(l.kind) : l.kind !== 'radio' || LF === 'radio')).slice(-80).reverse(); const lh = lg.map(l => `<div class="le ${l.kind}"><time>${fmt(l.t)}</time><em>${TAG[l.kind] || esc(l.kind || '')}</em><span>${esc(l.text)}</span></div>`).join('') || '<div class="small">Nothing yet.</div>'; if (lh !== ui.lh) { ui.lh = lh; $('log').innerHTML = lh; }
  const cut = sel.addr && eng.locoCut(sel.addr); $('locoinfo').textContent = cut ? `${OE.MPH(Math.abs(cut.v)).toFixed(1)} smph · ${cut.cars.length - 1} cars` : '';
  cards(); thr && thr.draw(); panelsUI(); voice();
  if (audio && audio.started) { const ps = panels()[0]; const c = ps.follow ? { x: ps.cx, y: ps.cy } : { x: W / 2, y: H / 2 }; audio.setListener(c.x, c.y, ps.follow ? 2 : 60, ps.follow ? -ps.rot - Math.PI / 2 : -Math.PI / 2);
    audio.setAmbient({ hour: (t / 3600) % 24, water: (D.scene[0].water || []).flatMap(w => (w.pts || []).filter((_, i) => i % 6 === 0).map(p => ({ x: p[0], y: p[1] }))), industry: D.industries.map(i => eng.N[eng.trk[i.tid].a]) }); }
}
const fmt = s => { const t = clockStart + s * FAST; return `${String((t / 3600 | 0) % 24).padStart(2, '0')}:${String((t / 60 | 0) % 60).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;');
// --------------------------------------------------------------------------- CTC panel, yardmaster screen, radio voice
function toggleSignal(id) { eng.sigHold[id] = !eng.sigHold[id]; eng.say(`CTC: signal ${id} ${eng.sigHold[id] ? 'held at stop' : 'released'}`, 'disp'); }
const ASP = { G: '🟢', Y: '🟡', R: '🔴' };
function trackCars() { const m = {}; for (const c of eng.cuts) { let o = 0; for (const car of c.cars) { const l = eng.locate(c, o + car.len / 2); o += car.len; const t = eng.e2t[l.e] || 'turnouts'; (m[t] = m[t] || []).push(car); } } return m; }
function panelsUI() {
  if (!$('ctc').classList.contains('hidden')) {
    const tks = D.tracks.filter(t => t.type !== 'spur' || D.industries.some(i => i.tid === t.id));
    if (!$('ctcfrom').options.length) { const o = tks.map(t => { const ind = D.industries.find(i => i.tid === t.id); return `<option value="${t.id}">${t.id} L${t.level} ${t.type}${ind ? ' — ' + ind.name : ''}</option>`; }).join(''); $('ctcfrom').innerHTML = o; $('ctcto').innerHTML = o; }
    const occ = ai.occ || {};
    $('ctcT').innerHTML = [1, 2].map(lv => `<div><b>L${lv}</b> ` + Object.values(eng.T).filter(t => t.level === lv).map(t => { const r = eng.reserve['T:' + t.id]; const o = occ['T:' + t.id] && occ['T:' + t.id].size;
      return `<button class="tb ${t.state === 'N' ? 'n' : 'r'}${o ? ' occ' : ''}" data-t="${t.id}" title="${t.part || ''}${r ? ' lined for ' + r : ''}${o ? ' — occupied' : ''}">${t.id} ${t.state === 'N' ? 'N' : 'R'}${r ? '•' : ''}</button>`; }).join('') + '</div>').join('');
    $('ctcS').innerHTML = (eng.signals || []).map(sg => `<button class="sb${eng.sigHold[sg.id] ? ' held' : ''}" data-s="${sg.id}" title="${sg.tid} end ${sg.end} L${sg.level}">${ASP[sg.aspect]} ${sg.id}</button>`).join('');
    $('ctcB').innerHTML = Object.entries(occ).filter(([, v]) => v.size).map(([b, v]) => `<span class="blk">${b}: ${[...v].map(c => eng.cutName(c)).join(', ')}</span>`).join(' ');
  }
  if (!$('ym').classList.contains('hidden')) {
    const tc = trackCars(); const C = eng.session.cards; const st = scoreState();
    const rows = D.industries.map(i => { const t = eng.trk[i.tid]; const cars = (tc[i.tid] || []).filter(x => !x.loco); const used = cars.reduce((a, x) => a + x.len, 0);
      const inb = C.filter(c => c.kind === 'set out' && c.to && (c.to.includes(i.name) || c.ind === i.id)); const outb = C.filter(c => c.kind === 'pick up' && c.from && c.from.includes(i.name));
      return `<tr><td>${i.name}</td><td>${i.tid}</td><td>${used.toFixed(1)}/${t.len.toFixed(1)}″</td><td>${cars.map(x => `<span class="car" title="${x.id} ${x.type}">${x.type.slice(0, 4)}</span>`).join('')}</td><td>${inb.map(c => `<span class="${st[c.car] ? 'done' : ''}">⬇${c.car}</span>`).join(' ')}</td><td>${outb.map(c => `<span class="${st[c.car] ? 'done' : ''}">⬆${c.car}</span>`).join(' ')}</td></tr>`; }).join('');
    const jobs = eng.session.jobs.map(j => { const n = C.filter(c => c.job === j.id); const d = n.filter(c => st[c.car]).length;
      return `<tr><td>${j.name}</td><td>${j.addr}</td><td>${d}/${n.length}</td><td>${j.exec ? (j.exec.done ? '✅ done' : j.exec.fail ? '❌ ' + esc(j.exec.fail) : 'step ' + (j.exec.i + 1) + '/' + j.exec.steps.length) : 'crew: you'}</td></tr>`; }).join('');
    $('ymbody').innerHTML = `<h3>Jobs</h3><table><tr><th>Job</th><th>Loco</th><th>Cards</th><th>Status</th></tr>${jobs}</table><h3>Industry & yard tracks</h3><table><tr><th>Customer</th><th>Track</th><th>Used</th><th>On spot</th><th>Inbound</th><th>Outbound</th></tr>${rows}</table>`;
  }
}
let radio = null;   // ROUND4: audio/radio.js (dispatcher, crews, yardmaster, detectors; queued voices + squelch)
function voice() { if (!radio) return; radio.poll(); const h = radio.html(40); if (h !== voice.last) { voice.last = h; const el = $('radiofeed'); el.innerHTML = h; el.scrollTop = el.scrollHeight; } }
function creditsHTML() { const C = window.OpsAudioCredits || [];
  return `<p>Recorded sounds (licenses: audio/SOURCES.md):</p><table>${C.map(c => `<tr><td><b>${esc(c[0])}</b></td><td>${esc(c[1])}${c[2] ? ` — <a href="${c[2]}" target="_blank" rel="noopener">source</a>` : ''}</td></tr>`).join('')}</table><p class="small">CC BY 4.0: creativecommons.org/licenses/by/4.0 · CC BY-SA 3.0: creativecommons.org/licenses/by-sa/3.0 · CC0: creativecommons.org/publicdomain/zero/1.0</p>`; }
function setupCTC() {
  $('ctcb').onclick = () => $('ctc').classList.toggle('hidden'); $('ymb').onclick = () => $('ym').classList.toggle('hidden');
  $('voiceb').onclick = () => { if (!radio) return; radio.setOn(!radio.on); $('voiceb').classList.toggle('on', radio.on); if (!window.speechSynthesis) toast('No Web Speech voice in this browser — radio feed is text only'); };
  $('chatb').onclick = () => { if (!radio) return; radio.chatter = !radio.chatter; $('chatb').classList.toggle('on', radio.chatter); $('chatb').textContent = radio.chatter ? 'Chatter on' : 'Chatter off'; };
  $('radlvl').onchange = e => { if (radio) radio.level = e.target.value; };
  $('ctcline').onclick = () => { const r = OE.lineRoute(eng, $('ctcfrom').value, $('ctcto').value, 'ctc'); toast(r.ok ? 'Route lined' : 'Route refused: ' + r.why); };
  $('ctcclear').onclick = () => { for (const k in eng.sigHold) eng.sigHold[k] = false; toast('All signals released'); };
  $('ctcT').onclick = e => { const id = e.target.dataset && e.target.dataset.t; if (!id) return; const r = eng.reserve['T:' + id]; if (r && eng.dispatchMode !== 'manual') return toast(`${id} is lined for ${r} (Manual CTC mode lets you)`); eng.throwTurnout(id, null, 'player'); };
  $('ctcS').onclick = e => { const id = e.target.dataset && e.target.dataset.s; if (id) toggleSignal(id); };
  $('credb').onclick = () => { $('credbody').innerHTML = creditsHTML(); $('cred').classList.toggle('hidden'); };
  const POPS = ['ctc', 'ym', 'cred', 'help'];
  for (const d of POPS) $(d).querySelector('.x').addEventListener('click', e => { e.stopPropagation(); $(d).classList.add('hidden'); });
  $('help').addEventListener('click', e => { if (e.target === $('help')) $('help').classList.add('hidden'); });   // click on the dim backdrop
  addEventListener('pointerdown', e => { for (const d of ['ctc', 'ym', 'cred']) { const el = $(d); if (el.classList.contains('hidden') || el.contains(e.target)) continue;
    if (e.target.closest && e.target.closest('#top')) continue;   // toolbar buttons toggle their own panel
    el.classList.add('hidden'); } }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape') { let any = false; for (const d of POPS) if (!$(d).classList.contains('hidden')) { $(d).classList.add('hidden'); any = true; } if (any) { e.preventDefault(); e.stopImmediatePropagation(); } } }, true);
}
// --------------------------------------------------------------------------- rules not in the engine core: #4 long cars, blue flags
function rules() {
  for (const c of eng.cuts) { if (c.derailed || Math.abs(c.v) < 0.01) continue;
    for (const p of c.path) { const lg = eng.legOf[p.e]; if (!lg || lg[1] !== 'D' || !/#4/.test(lg[0].part)) continue;   /* ROUND3: only the diverging route of a #4 is too sharp */ const o = eng.occupancy(c)[p.e]; if (!o) continue;
      const bad = c.cars.find(x => LONG.has(x.type)); if (bad) { eng.violation('long-car-#4', `${bad.id} (${bad.type}, over 68 ft) derailed on #4 turnout ${lg[0].id}`, 'player'); c.derailed = true; } }
    for (const b of blue) if (eng.t < b.until && eng.occupancy(c)[eng.trk[b.tid].edges[eng.trk[b.tid].edges.length - 1]] && c.cars.some(x => x.loco)) { eng.violation('blue-flag', `${eng.cutName(c)} entered blue-flag protected track ${b.tid}`, 'player'); b.until = 0; }
  }
}
// --------------------------------------------------------------------------- main loop
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  try { if (!eng.paused) { acc += dt * rate; let n = 0; while (acc > 0.05 && n++ < 400) { eng.tick(0.05); tickAgents(0.05); acc -= 0.05; } if (frame.k++ % 4 === 0) rules(); }
    draw(); if (frame.k % 10 === 0) ui(); } catch (e) { errs.push(String(e && e.stack || e)); console.error(e); }
  requestAnimationFrame(frame);
}
frame.k = 0;
// --------------------------------------------------------------------------- controls
function setup() {
  $('title').textContent = 'Ops — ' + D.name; document.title = 'Ops session — ' + D.name;
  resize(); addEventListener('resize', resize);
  thr = OpsControl.throttle($('throttle'), { engine: eng, audio, getLocos: () => eng.cuts.flatMap(c => c.cars.filter(x => x.loco && (!x.ai || eng.dispatchMode === 'manual' || view.mode === 'ride')).map(x => ({ addr: x.addr, label: (x.train || '') + ' ' + x.id }))),
    onSelect: a => { sel.addr = a; }, getSpeed: a => { const c = eng.locoCut(a); return c ? OE.MPH(Math.abs(c.v)) : 0; }, toast });
  $('mode').onchange = () => restart(); $('new').onclick = () => restart();
  $('view').onchange = e => { view.mode = e.target.value; view.zoom = 1; view.px = view.py = 0; if (view.mode === 'ride') thr.refreshList(); };
  $('pause').onclick = () => { eng.paused = !eng.paused; $('pause').textContent = eng.paused ? '▶ Run' : '⏸ Pause'; if (window.OpsUI) OpsUI.sync(); };
  $('rate').onchange = e => rate = +e.target.value;
  $('lift1').onclick = () => eng.requestLift(1); $('lift2').onclick = () => eng.requestLift(2);
  $('save').onclick = () => { localStorage.setItem('ops-save-' + D.name, JSON.stringify({ seed: +$('seed').value, mode: $('mode').value, eng: eng.save() })); toast('Saved'); };
  $('load').onclick = () => { const s = localStorage.getItem('ops-save-' + D.name); if (!s) return toast('Nothing saved'); const o = JSON.parse(s); $('seed').value = o.seed; $('mode').value = o.mode; newSession(o.seed, o.mode); eng.load(o.eng); thr.refreshList(); toast('Loaded'); };
  $('sound').onclick = () => { if (!audio) return; audio.start(); const m = audio.toggleMute(); $('sound').textContent = m ? '🔇' : '🔊'; };
  $('helpb').onclick = () => $('help').classList.toggle('hidden');
  $('vols').innerHTML = ['master', 'engines', 'horns', 'effects', 'ambient'].map(k => `<label>${k} <input type="range" min="0" max="1" step="0.05" value="${audio ? audio.getVolume(k) : 0}" data-k="${k}"></label>`).join('');
  $('vols').oninput = e => audio && audio.setVolume(e.target.dataset.k, +e.target.value);
  addEventListener('keydown', e => { if (thr.key(e)) return; const k = e.key.toLowerCase();
    if (k === 'c') $('ctcb').click(); else if (k === 'y') $('ymb').click(); else if (k === 'v') $('voiceb').click();
    else if (k === 'p') $('pause').click(); else if (k === 'h' || k === '?') $('helpb').click(); else if (k === 'm' && audio) { audio.start(); $('sound').textContent = audio.toggleMute() ? '🔇' : '🔊'; } });
  addEventListener('pointerdown', () => audio && audio.start(), { once: true });
}
function restart() { const seed = 1; $('seed').value = 1;   /* [CHOCO-SEED1] only seed 1 has local-job plans */ newSession(seed, $('mode').value); thr.refreshList(); if (myJob) thr.select(myJob.addr); initAgents(); }
window.addEventListener('error', e => errs.push(String(e.message)));
newSession(+(Q.get('seed') || 1), Q.get('mode') || (TEST ? 'auto' : 'mixed')); $('seed').value = +(Q.get('seed') || 1); if (Q.get('mode') || TEST) $('mode').value = Q.get('mode') || 'auto';
setup(); setupCTC(); thr.refreshList(); if (myJob) thr.select(myJob.addr); initAgents();
if (Q.get('view')) { view.mode = Q.get('view'); $('view').value = view.mode; }
if (!TEST && Q.get('start') !== '1') eng.paused = true;   // [UI] session starts from the start card (ui.js)
requestAnimationFrame(frame);
// hook for tests and for the layout3d viewer (see README: window.__opsGame)
window.__opsGame = { get engine() { return eng; }, get ai() { return ai; }, audio, errs, setRate: r => rate = r, D, get rate() { return rate; }, get myJob() { return myJob; }, get sel() { return sel; }, scoreState: () => scoreState(), restart: () => restart(),
  selectLoco(a) { sel.addr = a; if (thr) { thr.refreshList(); thr.select(a); } const j = eng.session.jobs.find(x => x.addr === a); if (j) { myJob = j; $('job').value = j.id; cards(); } }, viewAt(m, wx, wy, z) { view.mode = String(m); view.zoom = z; const s = Math.min(VW / (W + 8), VH / (H + 8)) * z; view.px = VW / 2 - wx * s - 4 * s; view.py = VH / 2 - wy * s - 4 * s; $('view').value = String(m); draw(); }, /* [CHOCO-LIFE] test view */ setView(m) { view.mode = m; view.zoom = 1; view.px = view.py = 0; $('view').value = m; if (m === 'ride' && thr) thr.refreshList(); }, fmt: s => fmt(s),
  run(seconds) { for (let i = 0; i < seconds / 0.05; i++) { eng.tick(0.05); tickAgents(0.05); if (i % 4 === 0) rules(); } draw(); ui(); },
  status() { return { t: eng.t, jobs: eng.session.jobs.map(j => ({ id: j.id, steps: j.plan ? j.plan.steps.length : 0, at: j.exec ? j.exec.i : null, done: j.exec ? j.exec.done : null, fail: j.exec ? j.exec.fail : null })), score: OE.scoreSession(eng), violations: eng.violations.slice(-20), errs }; }, ready: true };
})();
