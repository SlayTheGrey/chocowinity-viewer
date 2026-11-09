/* logistics-core.js - goal-driven road traffic + pedestrians for layout3d (Owner, 2026-10-19). No THREE: runs in the viewer, the ops game and node tests.
   Data: <plan>/logistics.json (tools/layout3d/logistics_build.py + <plan>/tools/gen_logistics.py) = road/lot/dock graph per level, places, agents with
   timed legs (in / off / none / cab / stand / walk / drive), vehicles, rail triggers, horses.
   Runtime rules: legs start at their nominal clock time (or as soon as the previous leg is done); drive legs wait at the gate while their dock / bay /
   station (or one it excludes) is busy, take the dock-apron lock before pulling up or backing, stop at stop signs (then yield), obey the signal,
   wait at grade crossings while the lights / gates are on, follow the vehicle ahead and stop for people; after 30 s stuck behind another vehicle they
   ghost past (deadlock breaker). People cross track only at crossings (the walk graph) and wait there while a train is near.
   Clock: sim.clock (seconds of day). Motion runs at scale speed x (fast clock / 4). */
(function (root) {
'use strict';
const C = {};
const BR = 2.2, AC = 1.1, GHOST_AFTER = 30, GHOST_FOR = 6, STOP_HOLD = 1.0, SIG_GREEN = 20, SIG_CLEAR = 3, GEAR = 0.8;

C.create = function (D, env) {
  env = env || {};
  const S = { D, nar: {}, sweep: {}, forced: 0, clock: D.clock.start, rt: 0, fc: 4, agents: [], veh: {}, occ: {}, resv: {}, locks: {}, excl: {}, log: [], stats: { legsDone: 0, drives: 0, walks: 0, ghosts: 0, backups: 0, hardStops: 0, maxWait: 0, waits: 0 }, railHeld: false, clones: 0, spotted: {} };
  const P = D.places, SPD = D.speed, VL = D.veh_len, VW = D.veh_w;
  for (const pid in P) for (const q of (P[pid].group_excl || [])) { (S.excl[pid] = S.excl[pid] || new Set()).add(q); (S.excl[q] = S.excl[q] || new Set()).add(pid); }
  for (const v of D.vehicles) S.veh[v.id] = { v, id: v.id, model: v.model, len: VL[v.model] || 1.3, w: VW[v.model] || 0.5, state: 'off', at: null, x: 0, y: 0, h: 0, lv: 0, vis: false, mv: false, spd: 0 };
  // junction boxes: nodes where 3+ edges meet and at least one is a street / drive / lane (lot-aisle stall splits excluded)
  const JN = {}; for (const lv in D.nets) { const net = D.nets[lv], deg = {}, st = {}; net.edges.forEach(e => { for (const n of [e.a, e.b]) { deg[n] = (deg[n] || 0) + 1; if (e.k !== 'lot' && e.k !== 'man') st[n] = 1; } });
    JN[lv] = {}; for (const n in deg) if (deg[n] >= 3 && st[n]) JN[lv][n] = 1; }
  S.jlock = {}; const JR = 2.2;   // [FIX2] was 1.5: box trucks turning out of a lot swept the car waiting at the box edge
  // ---------------------------------------------------------------- paths
  function compose(L, vlen) {
    if (L._p && L._p.jx) return L._p; const net = D.nets[L.lv], R = L.R; const X = [], Y = [], Sx = [], O = [], RV = [], SP = [], endS = [], startS = []; let s = 0, prevOff = 0;
    for (let k = 0; k < R.length; k++) { const e = net.edges[R[k][0]], fwd = R[k][1] > 0, pts = fwd ? e.pts : e.pts.slice().reverse(); startS.push(s);
      const elen = e.len || 0.001; let ramp = Math.min(0.9, elen / 2), o1 = (e.k === 'lot' || e.k === 'man') ? Math.min(0.12, e.off || 0) : ((e.k === 'road' || e.k === 'collector') && e.off ? Math.max(e.off, 0.39) : (e.off || 0)), o0 = k === 0 ? 0 : prevOff; let sl = 0; if ((e.k === 'road' || e.k === 'collector') && o1 - o0 > 0.2) ramp = Math.min(ramp, 0.3);   // [FIX2] turning onto a street: get into my lane right away (was driving down the centre line)
      for (let j = 0; j < pts.length; j++) { if (j) { const d = Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]);
          if (Math.abs(o1 - o0) > 0.01 && sl < ramp && sl + d > ramp + 0.05) { const f = (ramp - sl) / d;   // [FIX2] finish the lane-offset ramp where it should end, not at the far end of a long straight
            X.push(pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f); Y.push(pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f); Sx.push(s + ramp - sl); O.push(o1); RV.push(e.rev ? 1 : 0); SP.push(SPD[e.k] || 1); }
          s += d; sl += d; } else if (k) continue;
        X.push(pts[j][0]); Y.push(pts[j][1]); Sx.push(s); O.push(o0 + (o1 - o0) * Math.min(1, sl / (ramp || 1))); RV.push(e.rev ? 1 : 0); SP.push(SPD[e.k] || 1); }
      endS.push(s); prevOff = o1; }
    const n = X.length, tot = s;
    for (let i = 0; i < n; i++) if (tot - Sx[i] < 0.9) O[i] *= Math.max(0, (tot - Sx[i]) / 0.9);   // back onto the centre line at the place
    const OX = new Float64Array(n), OY = new Float64Array(n);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); let tx = X[b] - X[a], ty = Y[b] - Y[a]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l; OX[i] = X[i] - ty * O[i]; OY[i] = Y[i] + tx * O[i]; }
    // stops: controls, crossings, reversals, locks
    const stops = [];
    for (const c of (L.ctl || [])) { const nd = net.nodes[c[2]]; stops.push({ s: endS[c[0]] - vlen / 2 - 0.3, kind: c[1], major: c[3], x: nd[0], y: nd[1], node: c[2] }); }
    for (let k = 0; k < R.length; k++) { const e = net.edges[R[k][0]]; for (const h of (e.xs || [])) { const sh = startS[k] + (R[k][1] > 0 ? h[0] : (e.len - h[0])); stops.push({ s: sh - 1.25 - vlen / 2, kind: 'xing', x: h[1], y: h[2], sh }); } }
    for (let i = 1; i < n; i++) if (RV[i] !== RV[i - 1]) stops.push({ s: Sx[i - 1], kind: 'gear' });
    const jx = []; for (let k = 0; k < R.length - 1; k++) { const e = net.edges[R[k][0]], nd = R[k][1] > 0 ? e.b : e.a; if (!JN[L.lv][nd]) continue;
      // through movement along the street (no turn) vs a turn in / out
      const f = net.edges[R[k + 1][0]], pe = R[k][1] > 0 ? e.pts : e.pts.slice().reverse(), pf = R[k + 1][1] > 0 ? f.pts : f.pts.slice().reverse();
      const h1 = Math.atan2(pe[pe.length - 1][1] - pe[pe.length - 2][1], pe[pe.length - 1][0] - pe[pe.length - 2][0]), h2 = Math.atan2(pf[1][1] - pf[0][1], pf[1][0] - pf[0][0]);
      const street = k2 => k2 === 'road' || k2 === 'collector';
      jx.push({ s: endS[k], node: L.lv + ':' + nd, thr: street(e.k) && street(f.k) && Math.cos(h2 - h1) > 0.9, x: net.nodes[nd][0], y: net.nodes[nd][1] }); }
    stops.sort((a, b) => a.s - b.s);
    let lock = null, lockOut = null;
    if (L.lock) lock = { s0: startS[L.lock[0]] - vlen / 2 - 0.3, s1: tot, g: L.lock[2] };
    if (L.lockOut) lockOut = { s1: endS[L.lockOut[1]] + vlen / 2 + 0.2, g: L.lockOut[2] };
    // [FIX2] one-lane stretches: two-way lot aisles / manoeuvre / narrow drives where two bodies cannot pass side by side -> taken one direction at a time
    const runs = []; let cur = null;
    for (let k = 0; k < R.length; k++) { const e = net.edges[R[k][0]], o = (e.k === 'lot' || e.k === 'man') ? Math.min(0.12, e.off || 0) : (e.off || 0);
      // [RV1] a tight street bend (< 4.2 in = 56 ft centre-line radius): a semi off-tracks across both lanes there, so it takes the bend one way at a time against trucks
      if (e._tight == null) { let rmin = 1e9; const q = e.pts; for (let i = 1; i + 1 < q.length; i++) { const a1 = Math.atan2(q[i][1] - q[i - 1][1], q[i][0] - q[i - 1][0]), a2 = Math.atan2(q[i + 1][1] - q[i][1], q[i + 1][0] - q[i][0]); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 1e-3) rmin = Math.min(rmin, (Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]) + Math.hypot(q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1])) / 2 / d); } e._tight = (e.k === 'road' || e.k === 'collector') && !e.one && rmin < 4.2; }
      const tight = !!e._tight;
      const narrow = tight || (!e.one && e.k !== 'road' && e.k !== 'collector' && 2 * o < 0.66);
      if (narrow && cur && !!cur.tight !== tight) cur = null;
      if (narrow) { if (!cur) { cur = { s0: startS[k], s1: endS[k], es: [], nm: tight ? (e.name || 'bend') + ' bend' : (e.name || e.k), tight }; runs.push(cur); } cur.s1 = endS[k]; cur.es.push([L.lv + ':' + R[k][0], R[k][1] > 0 ? 1 : -1, startS[k], endS[k]]); } else cur = null; }
    // [RV1] a tight bend's one-at-a-time stretch also covers the street edge either side (a semi's off-tracking reaches into the approach lanes)
    for (const r of runs) if (r.tight) { const ks = r.es.map(e => R.findIndex(q => L.lv + ':' + q[0] === e[0])).filter(k => k >= 0); const k0 = Math.min(...ks), k1 = Math.max(...ks);
      for (const k of [k0 - 1, k1 + 1]) if (k >= 0 && k < R.length) { const e = net.edges[R[k][0]]; if (e.k !== 'road' && e.k !== 'collector') continue; r.es.push([L.lv + ':' + R[k][0], R[k][1] > 0 ? 1 : -1, startS[k], endS[k]]); if (k < k0) r.s0 = startS[k]; else r.s1 = endS[k]; } }
    const pp = { X, Y, OX, OY, Sx, RV, SP, n, tot, stops, lock, lockOut, eS: endS, jx, nruns: runs }; Object.defineProperty(L, '_p', { value: pp, enumerable: false, writable: true, configurable: true }); return pp;
  }
  function at(p, s, cur) { let i = Math.max(1, Math.min(cur || 1, p.n - 1)); while (i < p.n - 1 && p.Sx[i] < s) i++; while (i > 1 && p.Sx[i - 1] > s) i--;
    const s0 = p.Sx[i - 1], s1 = p.Sx[i], f = s1 > s0 ? Math.max(0, Math.min(1, (s - s0) / (s1 - s0))) : 1; const x = p.OX[i - 1] + f * (p.OX[i] - p.OX[i - 1]), y = p.OY[i - 1] + f * (p.OY[i] - p.OY[i - 1]);
    let h = Math.atan2(p.OY[i] - p.OY[i - 1], p.OX[i] - p.OX[i - 1]); if (p.RV[i]) h += Math.PI; return [x, y, h, i, p.SP[i], p.RV[i]]; }
  // body pose = chord between the front and rear axle points on the path (trailers / long bodies off-track to the inside like real ones)
  // a body never spans a gear change: beyond the ends of the current forward / reverse run it extends straight along the run's end tangent
  function ext(p, s, r0, r1) { if (s >= r0 && s <= r1) return at(p, s); const e = s < r0 ? r0 : r1, e2 = s < r0 ? Math.min(r1, r0 + 0.05) : Math.max(r0, r1 - 0.05), q = at(p, e), q2 = at(p, e2);
    let hx = q[0] - q2[0], hy = q[1] - q2[1]; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l; const d = Math.abs(s - e); return [q[0] + hx * d, q[1] + hy * d, q[2], q[3], q[4], q[5]]; }
  function runOf(p, s) { if (!p.runs) { const g = p.stops.filter(x => x.kind === 'gear').map(x => x.s); p.runs = [0, ...g, p.tot]; } const R = p.runs; for (let i = 1; i < R.length; i++) if (s <= R[i] + 1e-9) return [R[i - 1], R[i]]; return [R[R.length - 2], R[R.length - 1]]; }
  function bodyAt(p, s, len, cur) { const m = at(p, s, cur), wb = len * 0.36, rr = runOf(p, s); const f = ext(p, s + wb, rr[0], rr[1]), r = ext(p, s - wb, rr[0], rr[1]); let h = Math.atan2(f[1] - r[1], f[0] - r[0]); if (m[5]) h += Math.PI;
    return [(f[0] + r[0]) / 2, (f[1] + r[1]) / 2, Math.hypot(f[0] - r[0], f[1] - r[1]) > 1e-4 ? h : m[2], m[3], m[4], m[5]]; }
  function wpath(L) { if (L._w) return L._w; const P2 = L.pts, Sx = [0]; for (let i = 1; i < P2.length; i++) Sx.push(Sx[i - 1] + Math.hypot(P2[i][0] - P2[i - 1][0], P2[i][1] - P2[i - 1][1]));
    const w = { Sx, tot: Sx[Sx.length - 1] }; Object.defineProperty(L, '_w', { value: w, enumerable: false, writable: true, configurable: true }); return w; }
  function wat(L, s) { const P2 = L.pts, W = wpath(L); for (let i = 1; i < P2.length; i++) if (s <= W.Sx[i] || i === P2.length - 1) { const l = W.Sx[i] - W.Sx[i - 1] || 1, f = Math.max(0, Math.min(1, (s - W.Sx[i - 1]) / l));
    return [P2[i - 1][0] + f * (P2[i][0] - P2[i - 1][0]), P2[i - 1][1] + f * (P2[i][1] - P2[i - 1][1]), Math.atan2(P2[i][1] - P2[i - 1][1], P2[i][0] - P2[i - 1][0])]; } return [P2[0][0], P2[0][1], 0]; }
  // ---------------------------------------------------------------- agents
  function mkAgent(A, clone) { const a = { A, id: A.id, kind: A.kind, legs: A.legs, i: 0, act: false, s: 0, v: 0, x: 0, y: 0, h: 0, lv: A.home ? A.home.lv : 1, vis: false, pose: 'stand', wait: 0, why: '', ghost: 0, held: false, clone: !!clone, cur: 1, st: {} };
    a.rail = A.rail || null; return a; }
  for (const A of D.agents) S.agents.push(mkAgent(A));
  S.byId = {}; for (const a of S.agents) S.byId[a.id] = a;
  const placeVeh = (V, pid) => { const p = P[pid]; if (!p) { V.state = 'off'; V.vis = false; V.at = null; return; }
    V.at = pid; V.lv = p.lv; if (p.kind === 'portal') { V.state = 'off'; V.vis = false; V.at = null; return; }
    if (p.kind === 'inside') { V.state = 'inside'; V.vis = false; S.occ[pid] = null; return; }
    V.state = 'park'; V.vis = true; V.x = p.x; V.y = p.y; V.h = p.a; V.mv = false; V.spd = 0; S.occ[pid] = V.id; };
  // ---------------------------------------------------------------- seek: nominal state at clock t
  S._compose = compose; S._at = at; S._body = bodyAt;
  // [FIX2] a car driven up the ramps (despawn leg with need = the carrier's place) becomes part of that carrier's load; carriers arrive empty
  function loadOn(L) { if (!L.need) return; const hv = S.occ[L.need]; if (hv && S.veh[hv]) S.veh[hv].load = (S.veh[hv].load || 0) + 1; }
  S.seek = function (t) {
    for (const id in S.veh) S.veh[id].load = 0;
    S.clock = t; S.nar = {}; for (const id in S.veh) if (S.veh[id].narR) S.veh[id].narR.clear(); S.occ = {}; S.resv = {}; S.locks = {}; S.sweep = {}; S.jlock = {};
    for (const id in S.veh) { const V = S.veh[id]; V.drv = null; const h = V.v.home; if (h && h !== 'off' && P[h]) placeVeh(V, h); else { V.state = 'off'; V.vis = false; V.at = null; } }
    // vehicles: replay nominal drive legs that ended before t
    const ev = []; for (const a of S.agents) { if (a.held) continue; for (const L of a.legs) if (L.k === 'drive') ev.push([L.t1, L, a]); }
    ev.sort((p, q) => p[0] - q[0]);
    for (const [t1, L] of ev) { if (t1 > t) break; const V = S.veh[L.veh]; if (!V) continue; if (V.at && S.occ[V.at] === V.id) S.occ[V.at] = null; if (L.despawn) { V.state = 'gone'; V.vis = false; V.at = null; loadOn(L); } else placeVeh(V, L.to); }
    for (const a of S.agents) { a.act = false; a.v = 0; a.wait = 0; a.ghost = 0; a.back = null; a.why = ''; a.st = {}; a.i = 0;
      if (a.held) { a.vis = false; continue; }
      while (a.i < a.legs.length - 1 && a.legs[a.i].t1 <= t) a.i++;
      const L = a.legs[a.i];
      if ((L.k === 'drive' || L.k === 'walk') && t > L.t0) { startLeg(a, L, true); const f = (t - L.t0) / Math.max(1, L.t1 - L.t0);
        if (L.k === 'drive') { const p = compose(L, S.veh[L.veh].len); a.s = Math.min(p.tot * 0.999, p.tot * f); placeMoving(a, L); }
        else { a.s = wpath(L).tot * Math.min(0.999, f); } }
      pose(a); }
  };
  function startLeg(a, L, quiet) {
    a.act = true; a.s = 0; a.v = 0; a.wait = 0; a.ghost = 0; a.back = null; a.nyield = 0; a.why = ''; a.st = { done: new Set() }; a.cur = 1;
    if (L.k === 'drive') { const V = S.veh[L.veh]; if (!V) return; if (V.at && S.occ[V.at] === V.id) S.occ[V.at] = null; V.at = null; V.state = 'drive'; V.vis = true; V.drv = a.id; V.lv = L.lv; V.mv = true; V.spd = 0;
      const tp = P[L.to]; if (tp && tp.kind !== 'portal') S.resv[L.to] = V.id; if (L.sw) for (const q of L.sw) S.sweep[q] = (S.sweep[q] || 0) + 1; a.forcedLog = false; const p = compose(L, V.len); if (p.lockOut) S.locks[p.lockOut.g] = V.id; a.lockOutHeld = !!p.lockOut; a.lockHeld = false; if (!quiet) S.stats.drives++; }
    else if (!quiet) S.stats.walks++;
  }
  function placeMoving(a, L) { const V = S.veh[L.veh], p = compose(L, V.len), q = bodyAt(p, a.s, V.len, a.cur); a.cur = q[3]; V.x = q[0]; V.y = q[1]; V.h = q[2]; V.lv = L.lv; V.mv = true; V.spd = a.v; V.rev = q[5]; V.rk = RANK[(D.nets[L.lv].edges[L.R[Math.min(L.R.length - 1, edgeAt(p, a.s))][0]] || {}).k] || 0; }
  function edgeAt(p, s) { if (!p.eS) return 0; let k = 0; while (k < p.eS.length - 1 && p.eS[k] < s) k++; return k; }
  function endDrive(a, L) { const V = S.veh[L.veh]; if (S.resv[L.to] === V.id) delete S.resv[L.to]; const p = L._p;
    if (p && p.lock && S.locks[p.lock.g] === V.id && !(P[L.to] && P[L.to].group)) delete S.locks[p.lock.g];
    if (p && p.lock && S.locks[p.lock.g] === V.id) delete S.locks[p.lock.g];
    if (p && p.lockOut && S.locks[p.lockOut.g] === V.id) delete S.locks[p.lockOut.g];
    if (L.sw) for (const q of L.sw) S.sweep[q] = Math.max(0, (S.sweep[q] || 0) - 1);
    if (a.jh) { for (const j of a.jh) if (S.jlock[j] === V.id) delete S.jlock[j]; a.jh.clear(); }
    narRelease(V);
    V.drv = null; if (L.despawn) { V.state = 'gone'; V.vis = false; V.at = null; loadOn(L); } else placeVeh(V, L.to); S.stats.legsDone++; }
  // gate: may this drive leg start now?
  function busy(pid, me) { const o = S.occ[pid], r = S.resv[pid]; return (o && o !== me) || (r && r !== me); }
  function gateOK(a, L) { const V = S.veh[L.veh]; if (!V) return false;
    if (L.spawn && V.state !== 'gone' && V.state !== 'off') { a.skipSpawn = true; return true; }
    const tp = P[L.to]; if (!tp) return true;
    // [FIX2] lot-exit priority at an edge portal: an arriving vehicle waits off the board while someone is driving out through that same portal (or its spawn spot is occupied)
    const fp0 = P[L.frm]; if (fp0 && fp0.kind === 'portal') { const p0 = compose(L, V.len), q0 = bodyAt(p0, 0, V.len, 1);
      for (const b of S.agents) { if (b === a || !b.act) continue; const M = b.legs[b.i]; if (!M || M.k !== 'drive' || M.to !== L.frm) continue; const W = S.veh[M.veh]; if (!W || !W.vis || W.lv !== L.lv) continue;
        if (Math.hypot(W.x - fp0.x, W.y - fp0.y) > 9) continue; const pw = compose(M, W.len);
        for (let s2 = b.s; s2 <= Math.min(pw.tot, b.s + 6); s2 += 0.3) { const qw = bodyAt(pw, s2, W.len, b.cur || 1); if (ov(qw[0], qw[1], qw[2], W.len, W.w, q0[0], q0[1], q0[2], V.len, V.w, 0.05)) { a.why = 'waiting for ' + W.id + ' to clear the entrance'; return false; } } } }
    if (L.need && !S.occ[L.need]) { a.why = 'waiting for ' + L.need; return false; }
    if (tp.kind !== 'portal') { if (busy(L.to, V.id)) { a.why = 'waiting: ' + L.to + ' busy'; return false; }
      for (const q of (S.excl[L.to] || [])) if (busy(q, V.id)) { a.why = 'waiting: ' + q + ' in use'; return false; } }
    if (L.sw) for (const q of L.sw) if (busy(q, V.id)) { if (gateLong(a, L)) break; a.why = 'waiting: a vehicle at ' + q + ' is in the way'; return false; }
    if (tp.kind !== 'portal' && (S.sweep[L.to] || 0) > 0 && !gateLong(a, L)) { a.why = 'waiting for a truck to clear'; return false; }
    const p = compose(L, V.len); if (p.lockOut && S.locks[p.lockOut.g] && S.locks[p.lockOut.g] !== V.id) { a.why = 'waiting for the ' + p.lockOut.g + ' apron'; return false; }
    // pulling out: wait until nobody is moving through the first stretch of my way out (drivers take turns at shift change)
    if (P[L.frm] && P[L.frm].kind !== 'portal') { const pp = compose(L, V.len); for (const W of VIS) { if (W === V || !W.mv || W.lv !== L.lv) continue;
        for (let s2 = 0; s2 <= Math.min(3.2, pp.tot); s2 += 0.4) { const q = at(pp, s2); if (Math.hypot(W.x - q[0], W.y - q[1]) < (W.len + V.len) / 2 + 0.7) { a.why = 'waiting to pull out (' + (W.v.label || W.model) + ' passing)'; return false; } } } }
    const fp = P[L.frm]; if (fp && fp.kind === 'portal') { for (const id in S.veh) { const W = S.veh[id]; if (W === V || !W.vis || W.lv !== L.lv) continue; if (Math.hypot(W.x - fp.x, W.y - fp.y) < (W.len + V.len) / 2 + 0.6) { a.why = 'queued off-layout'; return false; } } }
    { const pq = compose(L, V.len); for (const r of pq.nruns) { if (r.s0 - V.len / 2 - 0.35 > 3.0) break; const W = narConflict(V, r); if (W) { a.why = 'waiting for oncoming ' + (W.v.label || W.model) + ' to clear the ' + r.nm; return false; } } }
    return true; }
  // deadlock breaker for sweep gates: after 20 clock minutes at the gate the leg goes anyway (logged; the day test counts these)
  function gateLong(a, L) { if (!a.gate0 || a.gateLeg !== L) { a.gate0 = S.clock; a.gateLeg = L; } if (S.clock - a.gate0 > 1200 && !a.forcedLog) { S.forced++; S.log.push([S.clock, a.id, 'long wait (20+ min) at a sweep gate']); a.forcedLog = true; } return false; }   // [FIX2] never force: keep waiting (forcing drove into the space and gridlocked)
  // ---------------------------------------------------------------- obstacles
  let VIS = [], PEDS = [];
  function blockAhead(a, V, x, y, h, motionH, ghost) {
    const cx = Math.cos(motionH), cy = Math.sin(motionH); let best = 1e9, who = null;
    if (!ghost) for (const W of VIS) { if (W === V || W.lv !== V.lv) continue; if (W.state === 'park') continue;   /* [FIX2] parked vehicles don't move: the exact body test (hardHit) and the sweep gates handle them; the centre-line guess here stopped cars beside parked trucks */ const dx = W.x - x, dy = W.y - y, al = dx * cx + dy * cy; if (al <= 0) continue;
      const lat = Math.abs(-dx * cy + dy * cx), need = (V.len + W.len) / 2; const wh = W.mv ? (W.rev ? W.h + Math.PI : W.h) : W.h; if ((W.mv || W.drv) && Math.cos(wh - motionH) < -0.3) continue;   /* [FIX2] oncoming in its own lane, also while it waits */ if (al > need + 2.6 || lat > (V.w + W.w) / 2 + 0.1) continue; const gap = al - need; if (gap < best) { best = gap; who = W; } }
    for (const q of PEDS) { if (q.lv !== V.lv) continue; const dx = q.x - x, dy = q.y - y, al = dx * cx + dy * cy; if (al <= 0) continue; const lat = Math.abs(-dx * cy + dy * cx);
      if (lat > V.w / 2 + 0.18 || al > V.len / 2 + 1.6) continue; const gap = al - V.len / 2 - 0.25; if (gap < best) { best = gap; who = 'person'; } }
    return [best, who]; }
  // ---------------------------------------------------------------- per-tick motion
  function driveStep(a, L, dt) {
    const V = S.veh[L.veh], p = compose(L, V.len); let sReq = p.tot, why = '';
    // [FIX2] backing up to break a deadlock: reverse along my own path (only into clear space), then hold a few seconds while the others go
    if (a.back) { const B = a.back; if (a.s > B.s + 0.005) { const ns = Math.max(B.s, a.s - 0.35 * dt), nq = bodyAt(p, ns, V.len, a.cur);
        if (clearAt(V, nq, p, a.s)) { a.s = ns; a.v = 0; a.why = 'backing up to let ' + (B.for || 'traffic') + ' through'; } else B.s = a.s; }
      else { B.t -= dt; B.h = (B.h || 0) + dt; if (a.jh && a.jh.size) { for (const j of a.jh) if (S.jlock[j] === V.id) delete S.jlock[j]; a.jh.clear(); }   // [FIX2] hand the junction to the one I'm yielding to (bodies still never overlap: hardHit)
        a.why = 'waiting for ' + (B.for || 'traffic') + ' to pass';
        // [FIX2] keep yielding until the vehicle I made room for has actually moved off (or 2 min, then let the cycle re-decide)
        const F = S.veh[B.for], fa = F && F.drv && S.byId[F.drv], near = F && F.vis && fa && fa.act && Math.hypot(F.x - V.x, F.y - V.y) < (F.len + V.len) / 2 + 0.8 && (B.f0 == null || Math.abs(fa.s - B.f0) < 1.5);
        if (B.f0 == null && fa) B.f0 = fa.s;
        if (fa && B.h > 8 && fa.blk === V.id && fa.v < 0.02 && a.s > 0.02 && (B.ext || 0) < 6) { if (B.lastS != null && Math.abs(a.s - B.lastS) < 0.01) { a.back = null; a.nyield = (a.nyield || 0) + 3; a.wait = 0; placeMoving(a, L); return false; } B.lastS = a.s; B.ext = (B.ext || 0) + 1; B.s = Math.max(0, a.s - 1.0); B.h = 0; B.f0 = fa.s; B.t = Math.max(B.t, 4); }   // [RV2] partner still stuck behind me: give it more room (back further, down to my path start)
        if (B.t <= 0 && (!near || B.h > 120 || (fa && B.h > 15 && Math.abs(fa.s - B.f0) < 0.05))) a.back = null; }   // partner can't use the room either: re-decide (the other side gives way next)
      if (a.jh && a.jh.size) for (const j of p.jx) if (a.jh.has(j.node) && a.s < j.s - JR - V.len / 2 + 0.3) { a.jh.delete(j.node); if (S.jlock[j.node] === V.id) delete S.jlock[j.node]; }   // backed out of the box: give it up
      a.wait = 0; placeMoving(a, L); return false; }
    // controls / crossings / gear changes ahead
    for (const st of p.stops) { if (st.s < a.s - 0.05 || a.st.done.has(st)) continue; if (st.s > a.s + 6) break;
      if (st.kind === 'gear') { if (a.s >= st.s - 0.02 && a.v < 0.05) { a.st.gear = (a.st.gear || 0) + dt; if (a.st.gear > GEAR) { a.st.done.add(st); a.st.gear = 0; continue; } } sReq = Math.min(sReq, st.s); why = why || 'changing gear'; break; }
      if (st.kind === 'stop') { if (a.s >= st.s - 0.06 && a.v < 0.06) { a.st.hold = (a.st.hold || 0) + dt; if (a.st.hold > STOP_HOLD && !crossTraffic(V, st)) { a.st.done.add(st); a.st.hold = 0; continue; } } sReq = Math.min(sReq, st.s); why = 'stop sign'; break; }
      if (st.kind === 'sig') { const ph = (S.rt % (2 * (SIG_GREEN + SIG_CLEAR))), green = st.major ? ph < SIG_GREEN : (ph >= SIG_GREEN + SIG_CLEAR && ph < 2 * SIG_GREEN + SIG_CLEAR);
        if (green || a.s > st.s + 0.05) { a.st.done.add(st); continue; } sReq = Math.min(sReq, st.s); why = 'red signal'; break; }
      if (st.kind === 'xing') { const on = env.xingOn ? env.xingOn(L.lv, st.x, st.y) : false; if (!on) continue; if (a.s > st.s + 0.3) continue; sReq = Math.min(sReq, st.s); why = 'grade crossing'; break; } }
    let nwho = null; for (const r of p.nruns) { if (a.s - V.len / 2 > r.s1 + 0.05) { if (V.narR && V.narR.has(r)) { for (const e of r.es) { const m = S.nar[e[0]]; if (m) m.delete(V.id); } V.narR.delete(r); } continue; }
      if (V.narR && V.narR.has(r)) { narRelease(V, a.s - V.len / 2 - 0.05); continue; } const enterS = r.s0 - V.len / 2 - 0.35; if (a.s < enterS - 3) break;
      const W = narConflict(V, r); if (W) { if (enterS < sReq) { sReq = Math.max(a.s, enterS); why = 'waiting for oncoming ' + (W.v.label || W.model) + ' (one-lane ' + r.nm + ')'; nwho = W; } break; }
      if (a.s >= enterS - 3.0) { narTake(V, r); continue; } break; }   // claim it ~3 in ahead so a vehicle about to pull out the other end waits instead of meeting me
    if (p.lock && !a.lockHeld) { const o = S.locks[p.lock.g]; if (!o || o === V.id) { if (a.s >= p.lock.s0 - 3) { S.locks[p.lock.g] = V.id; a.lockHeld = true; } } else if (p.lock.s0 < sReq) { sReq = Math.max(a.s, p.lock.s0); why = 'waiting for the dock apron'; } }
    if (a.lockOutHeld && a.s > p.lockOut.s1) { if (S.locks[p.lockOut.g] === V.id) delete S.locks[p.lockOut.g]; a.lockOutHeld = false; }
    let blockedY = false; const q = bodyAt(p, a.s, V.len, a.cur), motionH = q[5] ? q[2] + Math.PI : q[2]; const [gap, who] = blockAhead(a, V, q[0], q[1], q[2], motionH, a.ghost > 0);
    // junction box: hold it from just before the front enters until the rear is clear; wait short of it while someone else holds it
    if (!a.jh) a.jh = new Set(); let jwho = null;
    for (const j of p.jx) { const enter = j.s - JR - V.len / 2, leave = j.s + JR + V.len / 2;
      if (a.s > leave) { if (a.jh.has(j.node)) { a.jh.delete(j.node); if (S.jlock[j.node] === V.id) delete S.jlock[j.node]; } continue; }
      if (a.s < enter - 2.5) break;
      const o = S.jlock[j.node];
      if (j.thr) { if (!o || a.s > enter - 0.05) continue; if (a.ghost <= 0 && enter - 0.05 < sReq) { sReq = Math.max(a.s, enter - 0.05); why = 'waiting for a turning vehicle'; jwho = S.veh[o] || null; } break; }
      if (!o || o === V.id) { if (o === V.id) continue; if (a.s >= enter - 0.6 - a.v * 0.6) {
          // turning: yield to street traffic coming through
          let thru = null; for (const W of VIS) { if (W === V || W.lv !== V.lv || !W.mv || W.spd < 0.3) continue; const d = Math.hypot(W.x - j.x, W.y - j.y); if (d > 3.2 || d < 0.4) continue;
            const wh = W.rev ? W.h + Math.PI : W.h; if (((j.x - W.x) * Math.cos(wh) + (j.y - W.y) * Math.sin(wh)) / d > 0.6) { thru = W; break; } }
          if (thru && a.ghost <= 0) { if (enter - 0.05 < sReq) { sReq = Math.max(a.s, enter - 0.05); why = 'yielding to through traffic'; } break; }
          // don't block the box: the space just past the junction must be free before I take it
          const ex = bodyAt(p, Math.min(p.tot, leave), V.len, a.cur); let clear = true;
          for (const W of VIS) { if (W === V || W.lv !== V.lv || (W.state === 'park' && P[W.at] && P[W.at].kind === 'stall')) continue; if (W.drv && S.byId[W.drv] && (S.byId[W.drv].blk === V.id || (S.byId[W.drv].back && S.byId[W.drv].back.for === V.id)) && S.byId[W.drv].v < 0.02) continue;   /* [RV2] it is waiting on me: holding the box for it only gridlocks (bodies still never overlap) */ if (W.mv !== undefined && W.drv && Math.cos((W.rev ? W.h + Math.PI : W.h) - ex[2]) < -0.3 && !ov(ex[0], ex[1], ex[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, -0.02)) continue;   /* [FIX2] oncoming in the other lane only grazing the margin */ if (ov(ex[0], ex[1], ex[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, 0.02)) { clear = false; jwho = W; break; } }
          if (clear) { for (let s2 = Math.max(a.s, enter); s2 < Math.min(p.tot, leave) && clear; s2 += 0.3) { const bq = bodyAt(p, s2, V.len, a.cur);   // [FIX2] the box itself must be empty of anyone sitting in it (don't nose into a queue)
              for (const W of VIS) { if (W === V || W.lv !== V.lv || (W.state === 'park' && P[W.at] && P[W.at].kind === 'stall')) continue; if (W.mv && W.spd > 0.2) continue;
                if (ov(bq[0], bq[1], bq[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, 0.02)) { clear = false; jwho = W; break; } } } }
          if (clear && V.len < 3) for (const W of VIS) { if (W === V || W.lv !== V.lv || W.len < 3 || !W.drv) continue; const b = S.byId[W.drv]; if (!b || !b.act || b.back || (b.v < 0.02 && b.wait > 4)) continue; const M = b.legs[b.i]; if (!M || M.k !== 'drive') continue;
              const pw = compose(M, W.len); if (!pw.jx.some(k => k.node === j.node && b.s < k.s + JR + W.len)) continue; if (Math.hypot(W.x - j.x, W.y - j.y) < W.len / 2 + JR + 1.0) { clear = false; jwho = W; break; } }   // [FIX2] a truck working through this junction has it: cars wait outside the box
          if (clear) for (const r of p.nruns) { if (r.s0 > leave + V.len) break; if (r.s1 < j.s || (V.narR && V.narR.has(r))) continue; const W = narConflict(V, r); if (W) { clear = false; jwho = W; break; } }   // [FIX2] the one-lane stretch past the box must be free too
          if (clear || a.ghost > 0) { S.jlock[j.node] = V.id; a.jh.add(j.node); continue; }
          if (enter - 0.05 < sReq) { sReq = Math.max(a.s, enter - 0.05); why = 'waiting for room past the junction'; } break; } continue; }
      if (a.ghost <= 0 && enter - 0.05 < sReq) { sReq = Math.max(a.s, enter - 0.05); why = 'waiting for the junction to clear'; jwho = S.veh[o] || null; } break; }
    // footprint look-ahead: never move into another vehicle's body (covers merges out of stalls and unsigned lot / yard intersections)
    if (a.ghost <= 0) { const La = Math.min(p.tot, a.s + 0.3 + a.v * 0.7); if (La > a.s + 0.01) { const lq = bodyAt(p, La, V.len, a.cur); V.lx = lq[0]; V.ly = lq[1]; V.lh = lq[2]; V.lk = true;
        for (const W of VIS) { if (W === V || W.lv !== V.lv || (W.state === 'park' && a.s < 0.05)) continue; const stl = W.state === 'park' && P[W.at] && P[W.at].kind === 'stall';
          if (Math.abs(W.x - lq[0]) > 4 || Math.abs(W.y - lq[1]) > 4) continue;
          if (W.mv) { const wh = W.rev ? W.h + Math.PI : W.h; if (Math.cos(wh - motionH) < -0.5 && Math.abs(-(W.x - q[0]) * Math.sin(motionH) + (W.y - q[1]) * Math.cos(motionH)) > 0.33) continue; }   // oncoming, own lane
          if (ov(q[0], q[1], q[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, -0.02)) continue;            // already overlapping (ghost / spawn): let it separate
          const hard = ov(lq[0], lq[1], lq[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, stl ? 0.0 : 0.04);   // the space ahead is someone's body: stop
          if (!hard) { if (!(W.mv && W.lk && W.spd > 0.02 && ov(lq[0], lq[1], lq[2], V.len, V.w, W.lx, W.ly, W.lh, W.len, W.w, 0.04))) continue;   // both want the same space next:
            if (pri(V, q) > pri(W, null)) continue; }                                                       //  the lower right-of-way waits
          sReq = Math.min(sReq, a.s); why = (hard ? 'blocked by ' : 'yielding to ') + W.id + ' ' + (W.state); blockedY = W; break; } } else V.lk = false; }
    let blocked = !!blockedY; let who2 = blockedY || jwho || nwho || null; if (gap < 1e8) { const sObs = a.s + Math.max(0, gap - 0.35); if (sObs < sReq) { sReq = sObs; why = who === 'person' ? 'waiting for a pedestrian' : 'traffic'; blocked = who !== 'person'; } }
    /* [RV2] real-ish rates per class (model in/s^2; 1 m/s^2 real = 0.246): cars 0.75 accel (3 m/s^2) / 1.8 brake (7 m/s^2 firm stop), trucks and
       tractor-trailers 0.45 / 1.2 (1.8 / 4.9 m/s^2). The stopping curve uses the class brake rate, so vehicles start braking earlier for what they see ahead */
    const hv = V.len >= 1.8, ACv = hv ? 0.45 : 0.75, BRv = hv ? 1.2 : 1.8;
    const vmax = (q[4] || 1), dist = Math.max(0, sReq - a.s), vt = Math.min(vmax, Math.sqrt(2 * BRv * dist));
    a.v = Math.max(0, Math.min(a.v + ACv * dt, vt, a.v + BRv * dt * 2)); if (a.v > vt) a.v = vt;   // something appeared closer than the braking curve: brake to it (contact is never allowed)
    { const s0 = a.s, s1 = Math.min(p.tot, a.s + a.v * dt); if (s1 > s0) { const nq = bodyAt(p, s1, V.len, a.cur); let hit = hardHit(V, nq, q); if (hit && grazeOK(V, hit, p, s1, nq)) hit = null; hit = hit || truckWay(V, a, p, s1);
        if (hit) { a.v = 0; S.stats.hardStops++; why = 'blocked by ' + hit.id; blocked = true; who2 = hit; } else a.s = s1; } }   // [FIX2] never move into another body
    a.cur = q[3];
    // who am I waiting on (for deadlock detection): the vehicle in my way, or the one holding the junction I need
    a.blk = (who2 && who2.id) ? who2.id : (who && who.id ? who.id : (jwho && sReq <= a.s + 0.06 ? jwho.id : null));
    if (a.v < 0.02 && a.s < p.tot - 0.01) { a.wait += dt; a.why = why || 'waiting'; if (a.blk && a.wait > GHOST_AFTER) breakDeadlock(V, a) }
    else { if (a.wait > S.stats.maxWait) S.stats.maxWait = a.wait; a.wait = Math.max(0, a.wait - dt * 0.5); a.why = ''; }
    if (a.ghost > 0) a.ghost -= dt;
    placeMoving(a, L);
    return a.s >= p.tot - 0.005; }
  // [FIX2] one-lane resource: S.nar[edge] = Map(vehId -> dir)
  function narConflict(V, r) { for (const [eid, dir] of r.es) { const m = S.nar[eid]; if (!m) continue; for (const [id, d] of m) if (id !== V.id && d !== dir && S.veh[id] && S.veh[id].vis && (!r.tight || V.len >= 3 || S.veh[id].len >= 3)) return S.veh[id]; } return null; }
  function narTake(V, r) { for (const [eid, dir] of r.es) (S.nar[eid] = S.nar[eid] || new Map()).set(V.id, dir); (V.narR = V.narR || new Set()).add(r); }
  function narRelease(V, upto) { if (!V.narR) return; for (const r of [...V.narR]) for (const e of r.es) { if (upto != null && e[3] >= upto) continue; const m = S.nar[e[0]]; if (m) m.delete(V.id); }
    if (upto == null) V.narR.clear(); }
  // [FIX2] exact body test: would this pose put me inside another vehicle that I am not already overlapping (spawn / seek leftovers separate first)?
  function hardHit(V, nq, cur) { for (const W of VIS) { if (W === V || W.lv !== V.lv || !W.vis) continue; if (Math.abs(W.x - nq[0]) > 4 || Math.abs(W.y - nq[1]) > 4) continue;
      if (!ov(nq[0], nq[1], nq[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, 0.01)) continue; if (cur && ov(cur[0], cur[1], cur[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, -0.004)) continue; return W; } return null; }
  // [FIX2] cars yield to a truck that is pulling through: don't drive into where its body will be in the next few inches of its path (unless I'm already there)
  function truckWay(V, a, p, s1) { if (V.len >= 3) return null; const me = bodyAt(p, Math.min(p.tot, s1 + 0.6), V.len, a.cur), now = [V.x, V.y, V.h];
    for (const W of VIS) { if (W === V || W.lv !== V.lv || W.len < 3 || !W.drv || !W.mv) continue; if (Math.hypot(W.x - V.x, W.y - V.y) > W.len + 3) continue; const b = S.byId[W.drv]; if (!b || !b.act || b.back) continue;
      const M = b.legs[b.i]; if (!M || M.k !== 'drive') continue; const pw = compose(M, W.len);
      for (let k = 0.6; k <= 3.0; k += 0.6) { const wq = bodyAt(pw, Math.min(pw.tot, b.s + k), W.len, b.cur || 1);
        if (ov(me[0], me[1], me[2], V.len, V.w, wq[0], wq[1], wq[2], W.len, W.w, 0.05) && !ov(now[0], now[1], now[2], V.len, V.w, wq[0], wq[1], wq[2], W.len, W.w, 0.05)) return W; } }
    return null; }
  // [R28] a parked vehicle that my path only grazes (inside the 0.01 in contact margin, never body-in-body) for a sliver of path: pass by.
  // At 1 fps a car restarting from v=0 takes tiny steps and kept landing in that sliver, so it never got past (MAIN2-N16 at 15:16, DT 1.0)
  function grazeOK(V, W, p, s1, nq) { if (W.state !== 'park' || W.mv) return false; if (ov(nq[0], nq[1], nq[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, 0)) return false;
    for (let d = 0.02; d <= 0.10001; d += 0.02) { const fq = bodyAt(p, Math.min(p.tot, s1 + d), V.len, 0); if (!ov(fq[0], fq[1], fq[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, 0.01)) return true;
      if (ov(fq[0], fq[1], fq[2], V.len, V.w, W.x, W.y, W.h, W.len, W.w, 0)) return false; } return false; }
  function clearAt(V, nq, p, s) { return !hardHit(V, nq, bodyAt(p, s, V.len, 0)); }
  // [FIX2] deadlock: follow the 'waiting on' links; if they loop back to me, the vehicle in the loop with the lowest right of way that has room
  // behind it backs up ~1.2 in along its own path and holds 6 s. A parked vehicle in the way is just waited for (no pass-through, ever).
  // [RV1] a vehicle that has only just come on from an edge portal and is part of a gridlock backs off the board again (queues off-layout) instead of sitting in the lane
  function retract(b) { const L = b.legs[b.i], V = S.veh[L.veh]; endDrive0(b, L); V.vis = false; V.state = 'off'; V.drv = null; V.at = null; V.mv = false; b.act = false; b.s = 0; b.v = 0; b.wait = 0; b.back = null; b.retT = S.clock; S.stats.retracts = (S.stats.retracts || 0) + 1; S.log.push([S.clock, b.id, 'gridlock: backed off-layout to let traffic out']); }
  function endDrive0(a, L) { const V = S.veh[L.veh]; if (S.resv[L.to] === V.id) delete S.resv[L.to]; for (const g in S.locks) if (S.locks[g] === V.id) delete S.locks[g];
    if (L.sw) for (const q of L.sw) S.sweep[q] = Math.max(0, (S.sweep[q] || 0) - 1); if (a.jh) { for (const j of a.jh) if (S.jlock[j] === V.id) delete S.jlock[j]; a.jh.clear(); } narRelease(V); }
  function breakDeadlock(V, a) { const cyc = []; let id = a.blk;
    for (let k = 0; k < 12 && id; k++) { if (id === V.id) { cyc.push(a); break; } const W = S.veh[id]; if (!W || !W.drv) return; const b = S.byId[W.drv]; if (!b || !b.act || b.v > 0.02 || b.back) return; cyc.push(b); id = b.blk; }
    if (!cyc.length || cyc[cyc.length - 1] !== a) return;
    for (const b of cyc) { const L = b.legs[b.i], fp = P[L.frm]; if (fp && fp.kind === 'portal' && b.s < Math.max(4.5, S.veh[L.veh].len + 3.5)) { retract(b); for (const c of cyc) c.wait = 0; return; } }
    const one = b => /^waiting for (oncoming|room past)/.test(b.why || '') ? 0 : 1;   // whoever is waiting to get INTO a one-lane stretch gives way to the one already on it
    const cand = cyc.filter(b => b.s > 0.05).sort((x, y) => (x.nyield || 0) - (y.nyield || 0) || one(x) - one(y) || pri(S.veh[x.legs[x.i].veh], null) - pri(S.veh[y.legs[y.i].veh], null));
    // [RV1] prefer whoever has real room behind (a 0.2 in shuffle just livelocks): measure clear reverse distance, up to 3 in
    const room = b => { const L = b.legs[b.i], W = S.veh[L.veh], p = compose(L, W.len); let s2 = b.s; while (s2 > Math.max(0, b.s - 3)) { const n = Math.max(0, s2 - 0.2); if (!clearAt(W, bodyAt(p, n, W.len, b.cur), p, b.s)) break; s2 = n; } return b.s - s2; };
    for (const b of cand) b._room = room(b); cand.sort((x, y) => ((y._room >= 1.0) - (x._room >= 1.0)) || (one(x) - one(y)) || 0);
    for (const b of cand) { const L = b.legs[b.i], W = S.veh[L.veh], p = compose(L, W.len), back = Math.max(0, b.s - Math.max(1.2, Math.min(3, (b.nyield || 0) * 1.2))), nq = bodyAt(p, Math.max(0, b.s - 0.2), W.len, b.cur);
      if (!clearAt(W, nq, p, b.s)) continue; if (b._room < 0.8 && b.nyield > 2 && S.agents.some(q => q.act && q !== b && q.blk === W.id && q.v < 0.02 && !q.back)) continue;   // [RV2] boxed in by a queue: handled below
      const nxt = cyc[(cyc.indexOf(b) + cyc.length - 1) % cyc.length]; b.back = { s: back, t: 6, for: nxt && S.veh[nxt.legs[nxt.i].veh] ? S.veh[nxt.legs[nxt.i].veh].id : '' };
      for (const c of cyc) c.wait = 0; b.nyield = (b.nyield || 0) + 1; S.stats.backups++; S.log.push([S.clock, b.id, 'deadlock: backed up ' + (b.s - back).toFixed(1) + ' in to let ' + b.back.for + ' through at ' + W.x.toFixed(1) + ',' + W.y.toFixed(1)]); return; }
    // [RV2] the one that should give way is boxed in by a queue behind it: the queue backs up a little too (tail first, each into clear space only)
    for (const b of cand) { if (b.nyield > 40) continue; const tail = []; let cur = b;
      for (let k = 0; k < 4; k++) { const f = S.agents.find(q => q.act && q !== cur && q.blk === S.veh[cur.legs[cur.i].veh].id && q.v < 0.02 && !q.back && q.legs[q.i] && q.legs[q.i].k === 'drive'); if (!f) break; tail.push(f); cur = f; }
      if (!tail.length) continue; const nxt = cyc[(cyc.indexOf(b) + cyc.length - 1) % cyc.length], forId = nxt && S.veh[nxt.legs[nxt.i].veh] ? S.veh[nxt.legs[nxt.i].veh].id : '';
      for (const f of tail) { f.back = { s: Math.max(0, f.s - 2.0), t: 10, for: S.veh[b.legs[b.i].veh].id }; f.nyield = (f.nyield || 0) + 1; }
      b.back = { s: Math.max(0, b.s - 2.0), t: 8, for: forId }; b.nyield = (b.nyield || 0) + 1; for (const c of cyc) c.wait = 0; S.stats.backups++;
      S.log.push([S.clock, b.id, 'deadlock: queue of ' + tail.length + ' backs up so I can let ' + forId + ' through']); return; }
    // [RV2] nobody has room to reverse (two cars backing out of facing stalls): the one that left its stall last goes back into it (its own path start is always clear of others) and holds
    const st = cyc.filter(b => { const fp = P[b.legs[b.i].frm]; return fp && (fp.kind === 'stall' || fp.kind === 'place' || fp.kind === 'dock'); }).sort((x, y) => x.s - y.s)[0];
    if (st && !st.back) { const nxt = cyc[(cyc.indexOf(st) + cyc.length - 1) % cyc.length]; st.back = { s: 0, t: 20, for: nxt && S.veh[nxt.legs[nxt.i].veh] ? S.veh[nxt.legs[nxt.i].veh].id : '' }; st.nyield = (st.nyield || 0) + 1; for (const c of cyc) c.wait = 0; S.stats.backups++; S.log.push([S.clock, st.id, 'deadlock: pulled back into its stall to let ' + st.back.for + ' out']); } }
  function ov(ax, ay, ah, al, aw, bx, by, bh, bl, bw, m) { if (Math.hypot(ax - bx, ay - by) > (al + bl) / 2 + m + 0.1) return false;
    const U = [[Math.cos(ah), Math.sin(ah)], [-Math.sin(ah), Math.cos(ah)], [Math.cos(bh), Math.sin(bh)], [-Math.sin(bh), Math.cos(bh)]], dx = bx - ax, dy = by - ay;
    for (const [ux, uy] of U) { const ra = al / 2 * Math.abs(Math.cos(ah) * ux + Math.sin(ah) * uy) + aw / 2 * Math.abs(-Math.sin(ah) * ux + Math.cos(ah) * uy), rb = bl / 2 * Math.abs(Math.cos(bh) * ux + Math.sin(bh) * uy) + bw / 2 * Math.abs(-Math.sin(bh) * ux + Math.cos(bh) * uy);
      if (Math.abs(dx * ux + dy * uy) > ra + rb + m) return false; } return true; }
  // right of way when two vehicles want the same space: the one on the bigger road, then the one already moving faster, then the lower id
  const RANK = { road: 4, collector: 4, drive: 3, lane: 2, lot: 1, man: 0, portal: 4 };
  function pri(V, q) { return (V.rk || 0) * 10 + Math.min(9, V.spd * 3) + (V.id < 'V' ? 0 : 0) - (+(V.id.replace(/\D/g, '')) || 0) * 1e-4; }
  // a real deadlock: following "waiting on" links from me comes back to me (or ends at a parked vehicle sitting in my path for 2+ min)
  function deadlocked(V, a) { let id = a.blk; for (let k = 0; k < 10 && id; k++) { if (id === V.id) return true; const W = S.veh[id]; if (!W) return false;
      if (!W.drv) return W.state === 'park' && a.wait > 120; const b = S.byId[W.drv]; if (!b || !b.act || b.v > 0.02) return false; id = b.blk; } return false; }
  function crossTraffic(V, st) { for (const W of VIS) { if (W === V || W.lv !== V.lv || !W.mv || W.spd < 0.15) continue; if (Math.hypot(W.x - st.x, W.y - st.y) < 2.2 + W.len / 2) return true; } return false; }
  function walkStep(a, L, dt) { const W = wpath(L), sp = D.clock.walk || 0.33; let go = true;
    for (const h of (L.xs || [])) { if (a.s > h[0] - 2.2 && a.s < h[0] - 0.55) { const tr = env.trainNear ? env.trainNear(L.lv, h[1], h[2], 9) : false; if (tr) { go = false; a.why = 'waiting for the train to pass'; } } }
    if (go) { a.s = Math.min(W.tot, a.s + sp * dt); a.why = ''; } else a.wait += dt; return a.s >= W.tot - 0.001; }
  function pose(a) { const L = a.legs[a.i]; a.vis = false; a.pose = 'stand';
    if (!L) return;
    if (L.k === 'stand') { a.vis = true; a.x = L.x; a.y = L.y; a.lv = L.lv; a.h = L.h || 0; a.pose = 'work'; }
    else if (L.k === 'walk' && a.act) { const q = wat(L, a.s); a.vis = true; a.x = q[0]; a.y = q[1]; a.h = q[2]; a.lv = L.lv; a.pose = 'walk'; }
    else if (L.k === 'drive' && a.act) { const V = S.veh[L.veh]; a.x = V.x; a.y = V.y; a.h = V.h; a.lv = V.lv; a.inVeh = V.id; }
    else if (L.k === 'cab') { const V = S.veh[L.veh]; if (V && V.vis) { a.x = V.x; a.y = V.y; a.lv = V.lv; a.inVeh = V.id; } } }
  // ---------------------------------------------------------------- tick
  S.tick = function (dtReal, opts) {
    opts = opts || {}; const mm = opts.motion != null ? opts.motion : S.fc / 4, dt = Math.min(1.0, dtReal) * mm;   // [RV3] was min(0.25): at low fps vehicles fell behind the clock and PSP-P / TEAM-MJ jammed; the substep loop below keeps each step <= 0.12 s
    if (opts.clock != null) S.clock = opts.clock; else S.clock += dtReal * S.fc;
    if (S.clock >= 86400) { S.clock -= 86400; S.seek(S.clock); S.day = (S.day || 0) + 1; }
    S.rt += dt;
    VIS = []; for (const id in S.veh) { const V = S.veh[id]; if (V.vis) VIS.push(V); }
    PEDS = []; for (const a of S.agents) if (a.vis && a.pose !== 'drive') PEDS.push(a);
    // substeps keep motion stable at high clock rates
    const n = Math.max(1, Math.ceil(dt / 0.12)), h = dt / n;
    for (let k = 0; k < n; k++) for (const a of S.agents) stepAgent(a, h);
    for (const a of S.agents) pose(a);
  };
  function stepAgent(a, dt) {
    if (a.held) { a.vis = false; return; }
    for (let guard = 0; guard < 6; guard++) {
      const L = a.legs[a.i]; if (!L) return;
      if (L.k === 'drive') {
        if (!a.act) { if (S.clock < L.t0) return; if ((a.retT != null && S.clock - a.retT < 120 && S.clock >= a.retT) || !gateOK(a, L)) { a.wait += dt; S.stats.waits++; return; }
          if (a.skipSpawn) { a.skipSpawn = false; a.i++; continue; } startLeg(a, L); }
        if (driveStep(a, L, dt)) { endDrive(a, L); a.act = false; a.i++; continue; } return; }
      if (L.k === 'walk') { if (!a.act) { if (S.clock < L.t0) return; startLeg(a, L); } if (walkStep(a, L, dt)) { a.act = false; a.i++; S.stats.legsDone++; continue; } return; }
      if (S.clock >= L.t1 && a.i < a.legs.length - 1) { a.i++; S.stats.legsDone++; continue; } return; } }
  // ---------------------------------------------------------------- ops tie-in: hold rail-tagged work, run copies when a car is spotted
  S.holdRail = function (on) { S.railHeld = !!on; for (const a of S.agents) if (a.rail && !a.clone) a.held = !!on; S.seek(S.clock); };
  S.trigger = function (key, why) {
    const T = D.triggers[key]; if (!T) return 0; let n = 0; const now = S.clock;
    for (const aid of T.agents) { const src = D.agents.find(x => x.id === aid); if (!src) continue;
      const first = src.legs.find(L => L.k !== 'off' && L.k !== 'none'); if (!first) continue; const shift = (now + 600) - first.t0; S.clones++;
      const vmap = {}; const cl = JSON.parse(JSON.stringify(src)); cl.id = src.id + '#' + S.clones; cl.rail = null; cl.trig = key;
      for (const L of cl.legs) { L.t0 += shift; L.t1 += shift; if (L.veh && src.kind === 'truck') { if (!vmap[L.veh]) { const v0 = S.veh[L.veh].v, nv = Object.assign({}, v0, { id: v0.id + '#' + S.clones }); vmap[L.veh] = nv.id; S.veh[nv.id] = { v: nv, id: nv.id, model: nv.model, len: VL[nv.model] || 1.3, w: VW[nv.model] || 0.5, state: 'off', vis: false }; D.vehicles.push(nv); } L.veh = vmap[L.veh]; } }
      cl.legs[0].t0 = 0; cl.legs[cl.legs.length - 1].t1 = Math.max(86400, cl.legs[cl.legs.length - 1].t1) + 86400;
      D.agents.push(cl); const a = mkAgent(cl, true); a.i = 0; while (a.i < a.legs.length - 1 && a.legs[a.i].t1 <= now) a.i++; S.agents.push(a); S.byId[a.id] = a; n++; }
    S.log.push([now, key, `rail car spotted (${why || key}): ${n} truck job(s) start ~10 min later`]); return n; };
  // ---------------------------------------------------------------- status for HUD / inspect / panels
  S.agentState = function (a) { const L = a.legs[a.i]; if (!L) return 'done';
    const pl = id => P[id] ? (P[id].kind === 'portal' ? 'off-layout' : id) : id;
    if (a.held) return 'held (waits for a rail car to be spotted)';
    if (L.k === 'drive') return a.act ? `driving ${pl(L.frm)} -> ${pl(L.to)}${a.why ? ' (' + a.why + ')' : ''}` : (S.clock < L.t0 ? `leaves ${pl(L.frm)} at ${C.hm(L.t0)}` : `${a.why || 'waiting to leave'} (${pl(L.frm)})`);
    if (L.k === 'walk') return 'walking' + (a.why ? ' (' + a.why + ')' : '');
    if (L.k === 'in') return 'inside ' + L.at + ' until ' + C.hm(L.t1);
    if (L.k === 'stand') return 'working outside until ' + C.hm(L.t1);
    if (L.k === 'cab') return 'at ' + (L.at || 'the truck') + ' (in the cab) until ' + C.hm(L.t1);
    if (L.k === 'off') return (L.note || 'off-layout') + ' until ' + C.hm(L.t1);
    return a.kind === 'task' ? 'not on this task now' : 'off duty'; };
  S.nextLeg = function (a) { for (let j = a.i + 1; j < a.legs.length; j++) { const L = a.legs[j]; if (L.k === 'drive' || L.k === 'walk') return L; } return null; };
  // [LOGI] rail tie-in: delivered (status 'setout') cars standing on their own industry track with no loco attached -> 'ind:grp|car' keys
  S.spotted = function (eng) { const out = [], it = {}; for (const i of eng.D.industries) it[i.id] = i.tid;
    for (const c of eng.cuts || []) { if (c.cars.some(x => x.loco) || Math.abs(c.v || 0) > 0.01) continue; let o = 0;
      for (const car of c.cars) { const mid = o + car.len / 2; o += car.len; if (car.status !== 'setout' || !car.ind || !car.grp) continue;
        const l = eng.locate(c, mid); if (eng.e2t[l.e] !== it[car.ind]) continue; out.push({ key: car.ind + ':' + car.grp, car: car.id || ((car.road || '') + ' ' + (car.num || '')) }); } }
    return out; };
  S.pollRail = function (eng) { S._seen = S._seen || {}; let n = 0; for (const x of S.spotted(eng)) { const ck = x.key + '|' + x.car; if (S._seen[ck]) continue; S._seen[ck] = 1; if (D.triggers[x.key]) n += S.trigger(x.key, x.car) || 0; } return n; };
  S.bizStatus = function (bid) { const out = []; for (const a of S.agents) { if (a.A.biz !== bid || !(a.kind === 'truck' || a.kind === 'task')) continue; const L = a.legs[a.i];
      let st = S.agentState(a); if (a.held) st = 'held'; out.push({ id: a.id, name: a.A.name, what: a.A.carrier || a.A.what || a.A.role, state: st, t: (a.legs.find(x => x.k === 'drive') || {}).t1, clone: a.clone, trig: a.A.trig }); }
    return out; };
  return S;
};
C.hm = t => { t = ((Math.round(t) % 86400) + 86400) % 86400; return String(Math.floor(t / 3600)).padStart(2, '0') + ':' + String(Math.floor(t % 3600 / 60)).padStart(2, '0'); };
if (typeof module !== 'undefined' && module.exports) module.exports = C; else { root.L3D = root.L3D || {}; root.L3D.logiCore = C; }
})(typeof window !== 'undefined' ? window : globalThis);
