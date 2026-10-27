/* OpsEngine — N-scale operations engine shared by the browser game and node headless tests.
   Track graph from build_ops.py (layout.json -> graph), cuts of cars on edge paths, Kato turnout rules, the elevator lift
   (18 in / 8 s, interlocked), hand uncoupling, auto-coupling, derail/collision/overspeed/run-through detection,
   AI drivers + automated dispatcher (blocks, priorities, sidings, lift), switching-plan executor, scoring, save/load.
   Units: inches, seconds (real). Scale speed: in/s = mph * 17.6 / 160. */
(function (root) {
'use strict';
const IPS = mph => mph * 17.6 / 160, MPH = ips => ips * 160 / 17.6;
/* [PHYSICS 2026-10-16] shared train dynamics (tools/layout3d/assets/physics.js): mass, tractive effort, Davis rolling + curve + grade resistance, air / independent brakes, coupler slack */
const EZ = (typeof root !== 'undefined' && root.L3DEase) || (typeof require !== 'undefined' ? (() => { for (const p of ['../../assets/easement.js', './easement.js', '../easement.js']) { try { return require(p); } catch (e) {} } return null; })() : null);   // [FLEX] main-line easements
const PH = (typeof root !== 'undefined' && root.L3DPhysics) || (typeof require !== 'undefined' ? (() => { for (const p of ['../../assets/physics.js', './physics.js', '../physics.js']) { try { return require(p); } catch (e) {} } return null; })() : null);
const LIMIT = { main: 40, siding: 15, spur: 10, lift: 10 };
const COUPLE_OK = 4, COUPLE_HARD = 8;           // smph
const LIFT_TRAVEL = 18, LIFT_TIME = 8;          // in, s (defaults; plan option layout3d-options.json "lift" overrides via graph.lift)
const D_LIFT_IN = e => (e.D && e.D.graph && e.D.graph.lift && e.D.graph.lift.travel_in) || LIFT_TRAVEL;
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const PRIO = s => { s = s.toLowerCase(); return s.includes('amtrak') ? 1 : s.includes('intermodal') ? 2 : /manifest|unit|phosphate|ethanol|coal/.test(s) ? 3 : 4; };

class Engine {
  constructor(D, opt = {}) {
    this.D = D; this.opt = opt; this.t = 0; this.events = []; this.log = []; this.listeners = [];
    // [FLEX] main-line corners are flex track with clothoid easements: splice the eased curves into the main edges (ends/tangents fixed)
    if (EZ && opt.flex !== false) try { this.flexLog = EZ.easeGraph(D.graph, D.flex || (typeof root !== 'undefined' && root.LAYOUT_FLEX) || null); } catch (e) { this.flexLog = [{ error: e.message }]; }
    this.E = D.graph.edges.map(e => Object.assign({}, e)); this.N = D.graph.nodes;
    for (const e of this.E) this._geom(e);
    this.T = {}; for (const t of D.graph.turnouts) this.T[t.id] = Object.assign({ state: 'N', moving: 0, prefer: null }, t);
    this.inc = {}; for (const e of this.E) { (this.inc[e.a] = this.inc[e.a] || []).push(e.id); (this.inc[e.b] = this.inc[e.b] || []).push(e.id); }
    this.ptsAt = {}; for (const t of Object.values(this.T)) (this.ptsAt[t.P] = this.ptsAt[t.P] || []).push(t);
    this.legOf = {}; for (const t of Object.values(this.T)) { this.legOf[t.legN] = [t, 'N']; this.legOf[t.legD] = [t, 'D']; }
    const L = D.graph.lift;
    this.lift = L ? { level: 1, moving: false, from: 1, to: 1, p: 0, len: L.len, ends: L.ends, edge: this.E.length, time: L.cycle_s || LIFT_TIME } : null;   // [LIFT] plan option
    if (L) { const e = { id: this.E.length, a: L.ends['1'][0], b: L.ends['1'][1], pts: L.pts, level: 0, type: 'lift', lift: true }; this._geom(e); this.E.push(e); }
    // [L3] optional level 3 (future staging) 18 in above L2: only the lift landing exists there (two dead-end nodes); trains bound for staging despawn at L3
    this.levels = +(opt.levels || (D.opts && D.opts.levels) || 2);
    if (L && this.levels >= 3 && L.ends['2']) { this.N = Array.isArray(this.N) ? this.N.slice() : Object.assign({}, this.N); const ids = L.ends['2'].map(n => { const src = this.N[n] || {}; const id = Array.isArray(this.N) ? this.N.length : 'L3-' + n;
        const nn = Object.assign({}, src, { id, level: 3, kind: 'bumper', lift: true }); if (Array.isArray(this.N)) this.N.push(nn); else this.N[id] = nn; return id; });
      this.lift.ends = Object.assign({}, L.ends, { 3: ids }); }
    this.e2t = {}; for (const t of D.tracks) for (const e of t.edges) this.e2t[e] = t.id;
    this.trk = {}; for (const t of D.tracks) this.trk[t.id] = t;
    // preferred (through-running) leg for the AI: the leg whose far side is main
    for (const t of Object.values(this.T)) { const tN = this.E[t.legN].type, tD = this.E[t.legD].type; t.mainLeg = tD === 'main' && tN !== 'main' ? 'D' : 'N'; }
    this.cuts = []; this.nextId = 1; this.violations = []; this.score = { spotted: 0, pulled: 0, wrong: 0 }; this.paused = false;
    this.throttles = {}; this.dispatchMode = opt.dispatch || 'auto'; this.reserve = {}; this.warrants = {};
  }
  // ------------------------------------------------------------------ geometry
  _geom(e) { const P = e.pts, c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); e.cum = c; e.len = c[c.length - 1]; }
  pointOn(eid, s) {
    const e = this.E[eid], c = e.cum, P = e.pts; s = Math.max(0, Math.min(e.len, s));
    let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const f = (s - c[lo]) / ((c[hi] - c[lo]) || 1), x = P[lo][0] + f * (P[hi][0] - P[lo][0]), y = P[lo][1] + f * (P[hi][1] - P[lo][1]);
    return { x, y, a: Math.atan2(P[hi][1] - P[lo][1], P[hi][0] - P[lo][0]), level: this.edgeLevel(eid) };
  }
  edgeLevel(eid) { const e = this.E[eid]; if (!e.lift) return e.level; const l = this.lift; return l.moving ? l.from + (l.to - l.from) * l.p : l.level; }
  liftNodeLevel(n) { const l = this.lift; if (!l) return null; for (const k of Object.keys(l.ends)) if (l.ends[k].includes(n)) return +k; return null; }
  // ------------------------------------------------------------------ topology (Kato rule: stem <-> legs only)
  nexts(eid, n) {
    const l = this.lift;
    if (l && eid === l.edge) { return (this.inc[n] || []).filter(x => x !== eid); }
    for (const t of this.ptsAt[n] || []) {
      if (eid === t.legN || eid === t.legD) return t.stem != null ? [t.stem] : [];
      if (eid === t.stem) return [t.legN, t.legD];
    }
    const r = (this.inc[n] || []).filter(x => x !== eid);
    const lv = this.liftNodeLevel(n);
    if (lv && !l.moving && l.level === lv) r.push(l.edge);
    return r;
  }
  liftEnds() { const l = this.lift; return l.ends[String(l.level)]; }
  endsOf(eid) { const e = this.E[eid]; if (e.lift) { const en = this.liftEnds(); return [en[0], en[1]]; } return [e.a, e.b]; }
  /* choose the edge after element el (moving along el.d); returns {el, err} */
  step(el, forward, check = true) {
    const [a, b] = this.endsOf(el.e); const n = (el.d > 0) === forward ? b : a;
    let c = this.nexts(el.e, n), err = null;
    const pt = (this.ptsAt[n] || []).find(t => t.stem === el.e || t.legN === el.e || t.legD === el.e);
    if (pt) {
      if (el.e === pt.stem) { c = [pt.state === 'D' ? pt.legD : pt.legN]; if (pt.moving > 0) err = { kind: 'derail', why: `points of ${pt.id} were moving` }; }
      else { const leg = el.e === pt.legN ? 'N' : 'D'; if (pt.state !== leg) err = { kind: 'runthrough', why: `ran through ${pt.id} set against the move (trailing ${leg === 'N' ? 'normal' : 'diverging'} leg, points ${pt.state === 'N' ? 'normal' : 'reverse'}; last thrown by ${pt.lastBy || '?'})`, t: pt }; }
    } else if (c.length > 1) c = [c[0]];
    if (!c.length) {
      const lv = this.liftNodeLevel(n);
      if (lv && (this.lift.moving || this.lift.level !== lv)) err = { kind: 'derail', why: 'ran into the open elevator pit (lift not at this level - interlock!)' };
      return { el: null, err, node: n };
    }
    const ne = c[0], [na] = this.endsOf(ne);
    return { el: { e: ne, d: forward ? (na === n ? 1 : -1) : (na === n ? -1 : 1) }, err, node: n };
  }
  // ------------------------------------------------------------------ cuts
  carLen(c) { return c.len; }
  cutLen(cut) { return cut.cars.reduce((s, c) => s + c.len, 0); }
  pathLen(cut) { return cut.path.reduce((s, p) => s + this.E[p.e].len, 0); }
  makeCut(cars, eid, s, d) {   // tail at (eid, s), extending along direction d
    const cut = { id: this.nextId++, cars, path: [{ e: eid, d }], t0: d > 0 ? s : this.E[eid].len - s, v: 0, len: 0, derailed: false };
    cut.len = this.cutLen(cut); this._extend(cut); this.cuts.push(cut); return cut;
  }
  _extend(cut) {  // grow path at head to cover t0+len and at tail to cover t0>=0 (used after placement / moves)
    let guard = 0;
    while (this.pathLen(cut) < cut.t0 + cut.len && guard++ < 200) {
      const r = this.step(cut.path[cut.path.length - 1], true); if (!r.el) return r; cut.path.push(r.el); if (r.err) return r;
    }
    while (cut.t0 < 0 && guard++ < 400) {
      const r = this.step(cut.path[0], false); if (!r.el) return r; cut.path.unshift(r.el); cut.t0 += this.E[r.el.e].len; if (r.err) return r;
    }
    // trim
    while (cut.path.length > 1 && cut.t0 >= this.E[cut.path[0].e].len) { cut.t0 -= this.E[cut.path[0].e].len; cut.path.shift(); }
    while (cut.path.length > 1 && this.pathLen(cut) - this.E[cut.path[cut.path.length - 1].e].len >= cut.t0 + cut.len) cut.path.pop();
    return null;
  }
  locate(cut, dist) {   // dist from tail along the cut -> {e, s, d}
    let x = cut.t0 + dist;
    for (let i = 0; i < cut.path.length; i++) { const p = cut.path[i], L = this.E[p.e].len; if (x <= L || i === cut.path.length - 1) { x = Math.min(x, L); return { e: p.e, s: p.d > 0 ? x : L - x, d: p.d, i }; } x -= L; }
  }
  posAt(cut, dist) { const l = this.locate(cut, dist); const p = this.pointOn(l.e, l.s); if (l.d < 0) p.a += Math.PI; return p; }
  carPose(cut, idx) { let o = 0; for (let i = 0; i < idx; i++) o += cut.cars[i].len; const c = cut.cars[idx]; const a = this.posAt(cut, o + 0.12), b = this.posAt(cut, o + c.len - 0.12);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a: Math.atan2(b.y - a.y, b.x - a.x), level: (a.level + b.level) / 2, ax: a.x, ay: a.y, bx: b.x, by: b.y }; }
  couplerPos(cut, k) { let o = 0; for (let i = 0; i < k; i++) o += cut.cars[i].len; return this.posAt(cut, o); }
  occupancy(cut) {   // edge -> [lo, hi] (edge coords)
    const m = {}; let x = -cut.t0; const lo = 0, hi = cut.len;
    for (const p of cut.path) { const L = this.E[p.e].len; const a = Math.max(lo, x), b = Math.min(hi, x + L);
      if (b > a) { const s1 = a - x, s2 = b - x; const r = p.d > 0 ? [s1, s2] : [L - s2, L - s1]; m[p.e] = m[p.e] ? [Math.min(m[p.e][0], r[0]), Math.max(m[p.e][1], r[1])] : r; } x += L; }
    return m;
  }
  reverseCut(cut) {
    const tot = this.pathLen(cut); cut.path = cut.path.slice().reverse().map(p => ({ e: p.e, d: -p.d })); cut.t0 = tot - (cut.t0 + cut.len);
    cut.cars.reverse(); for (const c of cut.cars) c.fwd = -(c.fwd || 1); cut.v = -cut.v;
  }
  cutOf(car) { return this.cuts.find(c => c.cars.includes(car)); }
  locoCut(addr) { return this.cuts.find(c => c.cars.some(x => x.loco && x.addr === addr)); }
  uncouple(cut, k, who = 'player') {
    if (k <= 0 || k >= cut.cars.length) return false;
    if (Math.abs(cut.v) > IPS(0.6)) { this.violation('uncouple', `tried to uncouple a moving cut (hand uncoupling: stop first)`, who); return false; }
    let off = 0; for (let i = 0; i < k; i++) off += cut.cars[i].len;
    const A = { id: cut.id, cars: cut.cars.slice(0, k), path: cut.path.map(p => ({ ...p })), t0: cut.t0, v: 0, derailed: cut.derailed };
    const B = { id: this.nextId++, cars: cut.cars.slice(k), path: cut.path.map(p => ({ ...p })), t0: cut.t0 + off, v: 0, derailed: cut.derailed };
    A.len = this.cutLen(A); B.len = this.cutLen(B); this._extend(A); this._extend(B);
    this.cuts.splice(this.cuts.indexOf(cut), 1, A, B); this.emit('uncouple', { pos: this.posAt(A, A.len), who }); return true;
  }
  // [LEAVECLEAR] would the part of `cut` left behind by uncouple(cut,k) foul any turnout? side 'A' = cars[0..k), 'B' = cars[k..]
  leftFouls(cut, k, side) {
    if (k <= 0 || k >= cut.cars.length) return null; let off = 0; for (let i = 0; i < k; i++) off += cut.cars[i].len;
    const X = side === 'A' ? { id: -1, cars: cut.cars.slice(0, k), path: cut.path.map(p => ({ ...p })), t0: cut.t0, v: 0 } : { id: -1, cars: cut.cars.slice(k), path: cut.path.map(p => ({ ...p })), t0: cut.t0 + off, v: 0 };
    X.len = this.cutLen(X); this._extend(X); for (const id in this.T) if (this.fouls(id, X)) return id; return null; }
  couple(A, aHead, B, bHead, speed) {
    if (!aHead) this.reverseCut(A); if (bHead) this.reverseCut(B);
    const mA = A.cars.length, mB = B.cars.length, v = (A.v * mA + B.v * mB) / (mA + mB);
    const pa = A.path, pb = B.path, last = pa[pa.length - 1];
    let path = pa.concat(pb[0].e === last.e ? pb.slice(1) : pb);
    const C = { id: A.id, cars: A.cars.concat(B.cars), path, t0: A.t0, v, derailed: A.derailed || B.derailed };
    C.len = this.cutLen(C);
    this.cuts = this.cuts.filter(c => c !== A && c !== B); this.cuts.push(C); this._extend(C);
    this.emit('couple', { pos: this.posAt(C, A.len), speed });
    return C;
  }
  // ------------------------------------------------------------------ turnouts + lift
  fouls(t, c) { if (typeof t === 'string') t = this.T[t]; const o = this.occupancy(c); const st = t.stem != null && o[t.stem];
      const nearP = st && (this.E[t.stem].a === t.P ? st[0] < 0.5 : st[1] > this.E[t.stem].len - 0.5);
      const nearLeg = (le) => { const r = o[le]; if (!r) return false; const E = this.E[le]; const S = t.stem != null ? [this.E[t.stem].a, this.E[t.stem].b] : [t.P];
        const atA = S.includes(E.a) || E.a === t.P, atB = S.includes(E.b) || E.b === t.P; if (!atA && !atB) return true;
        const FL = this.foulLen || 5; /* [R36 P4] fouling point distance from the points (runtime OBB check found standing cars clipped at 2.5) */ return (atA && r[0] < FL) || (atB && r[1] > E.len - FL); };
      return !!(nearLeg(t.legN) || nearLeg(t.legD) || nearP); }
  throwTurnout(id, state, who = 'player') {
    const t = this.T[id]; if (!t) return false; const want = state || (t.state === 'N' ? 'D' : 'N'); if (want === t.state) return true;
    if (who === 'player' && this.dispatchMode === 'auto' && this.reserve['T:' + id] && this.reserve['T:' + id] !== 'player') { this.say(`Dispatcher: ${id} is lined for ${this.reserve['T:' + id]} - request refused`); return false; }
    for (const c of this.cuts) {
      if (this.fouls(t, c)) {
        if (who === 'ai') { this.say(`${id} not thrown: ${this.cutName(c)} is standing on it`, 'warn'); return false; }
        this.violation('throw-under', `threw ${id} under ${this.cutName(c)} - derailment`, who); c.derailed = true; } }
    t.lastBy = `${who}${this._thCtx ? ' ' + this._thCtx : ''} @${Math.round(this.t / 60)}`; t.state = want; t.moving = 0.3; this.emit('turnout', { pos: this.pointOn(t.legN, 0), id, state: want }); return true;
  }
  requestLift(level, who = 'player') {
    const l = this.lift; if (!l || l.moving || l.level === level) return l && l.level === level;
    if (who === 'ai' && l.arrT !== undefined && this.t - l.arrT < 60 && l.callLv === l.level && !this.cuts.some(c => this.occupancy(c)[l.edge])) return false;   /* [R34] lift ping-pong (NS 165 on L2 vs RJC on L1 re-called it every 18 s for 60+ min): after arriving for a caller it waits 60 s for that train to board */
    // interlock: every cut touching the lift edge must be wholly on it and stopped
    for (const c of this.cuts) { const o = this.occupancy(c); if (!o[l.edge]) continue;
      if (c.path.length > 1 || c.path[0].e !== l.edge) { this.say(`Lift interlock: ${this.cutName(c)} is not fully on the lift`); return false; }
      if (Math.abs(c.v) > 0.01) { this.say(`Lift interlock: ${this.cutName(c)} is moving`); return false; } }
    /* [R36b] approach interlock: never pull the lift away from a train that is already inside its braking distance of the lift (Amtrak 38 ran into the open pit at min 286, dt 0.05) */
    for (const c of this.cuts) { if (c.derailed || Math.abs(c.v) < 0.01) continue; const brake = c.v * c.v / (2 * Math.max(0.05, this.decelIps(c) * 0.7)) + 4; const A = this.ahead(c, c.v > 0 ? 1 : -1, brake); const k = A.find(x => x.e === l.edge); if (k && k.from < brake) { this.say(`Lift interlock: ${this.cutName(c)} is approaching the lift`); return false; } }
    l.callLv = level; l.moving = true; l.from = l.level; l.to = level; l.p = 0; this.emit('lift', { level }); this.say(`Lift ${l.from > level ? 'down' : 'up'} to L${level} (${(D_LIFT_IN(this))} in, ${l.time} s)`, who === 'ai' ? 'disp' : 'info'); return true;
  }
  // ------------------------------------------------------------------ violations / log / events
  violation(kind, text, who = 'player') { this.violations.push({ t: this.t, kind, text, who }); this.say('⚠ ' + text, 'warn'); this.emit('violation', { kind, text }); }
  say(text, kind = 'info') { this.log.push({ t: this.t, text, kind }); if (this.log.length > 400) this.log.shift(); }
  emit(type, ev) { ev.type = type; ev.t = this.t; for (const f of this.listeners) f(ev); }
  on(f) { this.listeners.push(f); }
  cutName(c) { const l = c.cars.find(x => x.loco); return l ? (l.train || l.road + ' ' + l.num) : `cut of ${c.cars.length} (${c.cars[0].id}…)`; }
  // ------------------------------------------------------------------ walking ahead (AI, autopilot)
  ahead(cut, dir, maxD) {   // future elements from the leading end. returns [{e, d, from, to}] in distance-from-leading-end coordinates
    const res = []; const lead = dir > 0 ? this.locate(cut, cut.len) : this.locate(cut, 0);
    let el = { e: lead.e, d: dir > 0 ? lead.d : -lead.d }, L = this.E[lead.e].len;
    let rem = el.d > 0 ? L - lead.s : lead.s; res.push({ e: el.e, d: el.d, from: 0, to: rem, s0: lead.s }); let dist = rem, g = 0;
    while (dist < maxD && g++ < 60) { const r = this.step(el, true, false); if (!r.el) { res.end = { dist, node: r.node, err: r.err }; break; }
      if (r.err) res.err = res.err || { dist, ...r.err }; el = r.el; const len = this.E[el.e].len; res.push({ e: el.e, d: el.d, from: dist, to: dist + len }); dist += len; }
    return res;
  }
  obstacle(cut, dir, maxD) {  // distance to the nearest other cut / end of track ahead
    const A = this.ahead(cut, dir, maxD); let best = { dist: maxD, what: null };
    for (const c of this.cuts) { if (c === cut) continue; const o = this.occupancy(c);
      for (const a of A) { const r = o[a.e]; if (!r) continue; let d;
        if (a.from === 0) { const s = a.s0; d = a.d > 0 ? r[0] - s : s - r[1]; if (d < -0.01) continue; }
        else d = a.from + (a.d > 0 ? r[0] : this.E[a.e].len - r[1]);
        if (d < best.dist) best = { dist: d, what: c }; break; } }
    if (A.end && A.end.dist < best.dist) best = { dist: A.end.dist, what: 'end', node: A.end.node };
    return best;
  }
  // ------------------------------------------------------------------ simulation step
  tick(dt) {
    if (this.paused) return; this.t += dt;
    for (const t of Object.values(this.T)) if (t.moving > 0) t.moving = Math.max(0, t.moving - dt);
    const l = this.lift; if (l && l.moving) { l.p += dt / ((l.time || LIFT_TIME) * Math.max(1, Math.abs(l.to - l.from))); if (l.p >= 1) { l.moving = false; l.level = l.to; l.p = 0; l.arrT = this.t; const en = this.liftEnds(); this.E[l.edge].a = en[0]; this.E[l.edge].b = en[1]; this.emit('liftdone', { level: l.level }); } }
    this.ai && this.ai.tick(dt);
    for (const c of this.cuts.slice()) this._move(c, dt);
    this._contacts();
    for (const c of this.cuts) if (c.derailed && Math.abs(c.v) > 0) c.v = 0;
  }
  consistOf(cut) { const k = cut.cars.map(c => c.id).join(','); if (cut._ck !== k) { cut._ck = k; cut._C = PH ? PH.consist(cut.cars) : null; } return cut._C; }
  envOf(cut) { if (!PH) return {}; if (cut._envT != null && this.t - cut._envT < 0.5) return cut._env; cut._envT = this.t;   // curvature under the lead car (radius in model inches); levels are flat (the lift is vertical)
    try { const L = this.pathLen(cut), s = cut.v >= 0 ? Math.min(L - 0.01, cut.t0 + cut.len) : Math.max(0.01, cut.t0), a = this.posAt(cut, Math.max(0, s - 1.5)), b = this.posAt(cut, s), c = this.posAt(cut, Math.min(L, s + 1.5));
      cut._env = { grade: 0, radius: PH.radius3([a.x, a.y], [b.x, b.y], [c.x, c.y]) }; } catch (e) { cut._env = { grade: 0 }; } return cut._env; }
  /* best service deceleration / acceleration for this cut at its speed (model in/s^2): AI crews and the dispatcher plan stops with it */
  decelIps(cut) { const C = this.consistOf(cut); return C ? IPS(PH.caps(C, MPH(Math.abs(cut.v)), this.envOf(cut)).dec) : 0.8; }
  accelIps(cut) { const C = this.consistOf(cut); return C ? IPS(PH.caps(C, MPH(Math.abs(cut.v)), this.envOf(cut)).acc) : 0.35; }
  _move(cut, dt) {
    if (cut.derailed) { cut.v = 0; return; }
    const locos = cut.cars.filter(x => x.loco), C = this.consistOf(cut), env = this.envOf(cut);
    if (C) {   // physics: every move obeys mass, tractive effort, resistance and brakes
      const lead = locos.find(x => this.throttles[x.addr]) || locos[0], th = lead ? (this.throttles[lead.addr] || { speed: 0, dir: 1, cv3: 4, cv4: 4 }) : null;
      const s = th ? th.dir * (lead.fwd || 1) : (cut.v >= 0 ? 1 : -1); let u = MPH(cut.v) * s;   // u: scale mph in the reverser direction
      if (th && (th.cab || th.estop)) {   // cab stand: notch + automatic / independent brakes (cylinder lag); E-stop = emergency application
        th.abc = PH.brakeLag(th.abc || 0, th.estop ? 1 : (th.auto || 0), dt, th.estop ? 2 : 0.25, 0.12); th.ibc = PH.brakeLag(th.ibc || 0, th.ind || 0, dt, 0.6, 0.5);
        u = PH.step(C, u, { notch: th.estop ? 0 : (th.notch || 0), auto: th.abc, ind: th.ibc, emergency: th.estop && th.abc > 0.9, dir: 1 }, env, dt);
      } else if (th) {   // speed setpoint (DCC decoder / AI crew): approach the target within what the train can actually do; CV3 / CV4 add decoder momentum
        const cp = PH.caps(C, Math.abs(u), env), tgt = Math.min(th.speed, C.vmax), up = cp.acc / (1 + (th.cv3 || 0) / 40), dn = cp.dec / (1 + (th.cv4 || 0) / 40);
        const d = tgt - u; u += d > 0 ? Math.min(d, up * dt) : Math.max(d, -dn * dt); if (Math.abs(u) < 0.02 && tgt === 0) u = 0;
      } else u = PH.step(C, u, { dir: 1 }, env, dt);   // free-rolling cut: resistance only
      cut.v = IPS(u) * s; cut.slack = cut.slack || {}; PH.slackUpdate(cut.slack, cut.cars.length, (Math.abs(cut.v) - Math.abs(cut._pv || 0)) / Math.max(dt, 1e-3), dt); cut._pv = cut.v;
      if (Math.abs(cut.v) < 1e-4) { cut.v = 0; return; }
    } else {
    let target = 0, acc = 2.0, dec = 3.0;
    const mass = 1 + 0.06 * cut.cars.filter(x => !x.loco).length;
    if (locos.length) {
      const lead = locos.find(x => this.throttles[x.addr]) || locos[0]; const th = this.throttles[lead.addr] || { speed: 0, dir: 1, cv3: 4, cv4: 4 };
      if (th.estop) { cut.v = 0; return; }
      target = IPS(th.speed) * th.dir * (lead.fwd || 1);
      const power = locos.length; acc = 1.2 * power / mass / (1 + th.cv3 / 6); dec = 1.6 * power / mass / (1 + th.cv4 / 6);
    } else { target = 0; dec = 2.5; }
    const dv = target - cut.v, rate = (Math.sign(dv) === Math.sign(cut.v) || cut.v === 0) ? acc : dec;
    cut.v += Math.sign(dv) * Math.min(Math.abs(dv), rate * dt); }
    if (Math.abs(cut.v) < 1e-4) { cut.v = 0; return; }
    const before = cut.path.map(p => p.e).join(',');
    cut.t0 += cut.v * dt; const r = this._extend(cut);
    if (r) {
      if (r.err) { this.violation(r.err.kind, `${this.cutName(cut)}: ${r.err.why}${(() => { const t = this.ai && this.ai.trains && this.ai.trains.find(x => this.ai.cutOf(x) === cut); return t ? ` [train ${t.backup > 0 ? 'backing' : 'running'}, th.dir ${(this.throttles[t.addr] || {}).dir}]` : ''; })()}`, this._who(cut)); cut.derailed = r.err.kind !== 'runthrough' || Math.abs(cut.v) > IPS(5); if (r.err.kind === 'runthrough' && r.err.t) r.err.t.state = r.err.t.state === 'N' ? 'D' : 'N'; }
      if (!r.el) { const pl = this.pathLen(cut); const sp = MPH(Math.abs(cut.v)); if (cut.v > 0) cut.t0 = pl - cut.len; else cut.t0 = 0;
        if (sp > 3 && !(r.err)) this.violation('bumper', `${this.cutName(cut)} hit the bumper/end of track at ${sp.toFixed(0)} smph`, this._who(cut)); cut.v = 0; }
    }
    if (cut.path.map(p => p.e).join(',') !== before) this._checkSpeed(cut);
    if (this.opt.speedCheck !== false) this._checkSpeed(cut, true);
  }
  _who(cut) { const l = cut.cars.find(x => x.loco); return l && l.ai ? 'ai' : 'player'; }
  _checkSpeed(cut, quick) {
    const sp = MPH(Math.abs(cut.v)); if (sp < 10.5) return;
    for (const p of cut.path) { const e = this.E[p.e]; let lim = LIMIT[e.type] || 10; const lg = this.legOf[p.e];
      if (lg && lg[1] === 'D') lim = Math.min(lim, /#4/.test(lg[0].part) ? 10 : 15);
      if (sp > lim * 1.2) { const key = cut.id + ':' + p.e; this._os = this._os || {}; if (this._os[key] && this.t - this._os[key] < 30) continue; this._os[key] = this.t;
        if (lg && lg[1] === 'D' && sp > lim * 2) { this.violation('derail', `${this.cutName(cut)} derailed: ${sp.toFixed(0)} smph through the diverging route of ${lg[0].id} (${lg[0].part}, limit ${lim})`, this._who(cut)); cut.derailed = true; return; }
        this.violation('overspeed', `${this.cutName(cut)} ${sp.toFixed(0)} smph on ${e.type}${lg ? ' (' + lg[0].id + ')' : ''}, limit ${lim}`, this._who(cut)); } }
  }
  _contacts() {
    const occ = this.cuts.map(c => this.occupancy(c));
    for (let i = 0; i < this.cuts.length; i++) for (let j = i + 1; j < this.cuts.length; j++) {
      const A = this.cuts[i], B = this.cuts[j]; let hit = null; if (A.derailed && B.derailed) continue;
      for (const e in occ[i]) { const a = occ[i][e], b = occ[j][e]; if (b && a[0] < b[1] - 1e-6 && b[0] < a[1] - 1e-6) { hit = +e; break; } }
      if (!hit) { // sideswipe at a frog: cars on both legs near the points
        for (const t of Object.values(this.T)) { const aN = occ[i][t.legN], aD = occ[i][t.legD], bN = occ[j][t.legN], bD = occ[j][t.legD];
          if ((aN && bD && aN[0] < 2.2 && bD[0] < 2.2) || (aD && bN && aD[0] < 2.2 && bN[0] < 2.2)) { this.violation('sideswipe', `${this.cutName(A)} and ${this.cutName(B)} fouled each other at ${t.id}`, 'player'); A.derailed = B.derailed = true; } }
        continue; }
      // which ends touch
      const ends = c => [this.locate(c, 0), this.locate(c, c.len)];
      const [aT, aH] = ends(A), [bT, bH] = ends(B);
      const inB = p => p.e === hit && occ[j][hit] && p.s >= occ[j][hit][0] - 0.3 && p.s <= occ[j][hit][1] + 0.3, inA = p => p.e === hit && p.s >= occ[i][hit][0] - 0.3 && p.s <= occ[i][hit][1] + 0.3;
      const aHead = inB(aH) ? true : inB(aT) ? false : null, bHead = inA(bH) ? true : inA(bT) ? false : null;
      const rel = MPH(Math.abs(A.v - B.v) + (aHead === bHead ? Math.abs(A.v + B.v) - Math.abs(A.v - B.v) : 0));
      const sp = Math.max(MPH(Math.abs(A.v)), MPH(Math.abs(B.v)), rel * 0.5);
      if (aHead === null || bHead === null || sp > COUPLE_HARD) {
        this.violation('collision', `${this.cutName(A)} collided with ${this.cutName(B)} at ${sp.toFixed(0)} smph`, this._who(A)); A.derailed = B.derailed = true; A.v = B.v = 0;
        this.emit('collision', { pos: this.posAt(A, aHead ? A.len : 0) }); return;
      }
      if (sp > COUPLE_OK) this.violation('hard-coupling', `hard coupling at ${sp.toFixed(0)} smph (≤ ${COUPLE_OK})`, this._who(A));
      // back the moving one off the overlap, then couple
      const ov = occ[i][hit][1] - occ[j][hit][0];
      this.couple(A, aHead, B, bHead, sp); return;   // occupancy changed; continue next tick
    }
  }
  // ------------------------------------------------------------------ save / load
  save() { return JSON.stringify({ t: this.t, T: Object.fromEntries(Object.values(this.T).map(t => [t.id, t.state])), lift: this.lift && { level: this.lift.level },
    cuts: this.cuts.map(c => ({ id: c.id, cars: c.cars, path: c.path, t0: c.t0, v: c.v, derailed: c.derailed })), violations: this.violations, throttles: this.throttles, nextId: this.nextId, extra: this.extra || null }); }
  load(s) { const o = typeof s === 'string' ? JSON.parse(s) : s; this.t = o.t; for (const k in o.T) this.T[k].state = o.T[k];
    if (o.lift) { this.lift.level = o.lift.level; this.lift.moving = false; const en = this.liftEnds(); this.E[this.lift.edge].a = en[0]; this.E[this.lift.edge].b = en[1]; }
    this.cuts = o.cuts.map(c => Object.assign({}, c, { len: c.cars.reduce((s, x) => s + x.len, 0) })); this.violations = o.violations; this.throttles = o.throttles; this.nextId = o.nextId; this.extra = o.extra; }
}

// ==================================================================== session (switch lists / car cards)
const ROADS = { h51: ['NAHX', 'ACFX', 'TILX'], rf: ['ARMN', 'UPFE'], tk: ['GATX', 'UTLX'], cb: ['TTZX', 'BCOL'], c60: ['NS', 'CSXT', 'TBOX'], gon: ['NS', 'CSXT'], coil: ['NS', 'CSXT'],
  f68: ['TTPX', 'NS'], well: ['DTTX', 'TTAX'], ar: ['TTGX', 'ETTX'], g32: ['NAHX', 'SHPX'], gp38: ['NS'], mp15: ['NS'], gp40: ['CSXT'], gp15: ['CLNA'], sd40: ['RJC'] };
function carObj(r, type, len, extra) { const rs = ROADS[type] || ['NS']; return Object.assign({ id: rs[Math.floor(r() * rs.length)] + ' ' + (100000 + Math.floor(r() * 899999)), type, len, fwd: 1 }, extra || {}); }
function genSession(D, seed) {
  const pre = (D.sessions || []).find(s => s.seed === seed); const r = rng(seed * 7919 + 13); const ses = {};
  for (const ind of D.industries) for (const g of ind.groups) {
    let c; if (pre && pre.cars[ind.id + ':' + g.id]) c = pre.cars[ind.id + ':' + g.id];
    else { const sp = g.spots, n0 = Math.floor(r() * (sp + 1)), out = n0 ? 1 + Math.floor(r() * n0) : 0, keep = n0 - out; let inn = Math.floor(r() * (sp - keep + 1)); if (!out && !inn) inn = 1; let k2 = keep, o2 = out; const mk = Math.min(g.min_keep || 0, sp); if (k2 < mk) { k2 = mk; o2 = Math.min(o2, sp - k2); inn = Math.min(inn, sp - k2); } if (g.full && sp) { o2 = 1 + Math.floor(r() * sp); k2 = sp - o2; inn = o2; } c = { keep: k2, out: o2, inn }; }   /* [R37] min_keep / full as sim.py */
    ses[ind.id + ':' + g.id] = c;
  }
  return ses;
}
/* place a session: industries' cars on spurs (bumper first), each game job's train on its first stop */
/* equipment pool = roster.json (plan consists): local/turn equipment only; through trains keep their own cars */
function makePool(D, seed) {
  const r = rng(seed * 31 + 7), pool = {}, locos = [];
  const R = D.roster || { cars: [], locos: [] };
  for (const c of R.cars) { if (PRIO(c.home) <= 3) continue; (pool[c.key] = pool[c.key] || []).push(c); }
  for (const k in pool) pool[k].sort(() => r() - 0.5);
  for (const l of R.locos) if (PRIO(l.home) > 3) locos.push(l);
  return { r, pool, locos, take(key, extra) { const a = pool[key]; if (!a || !a.length) return null; const c = a.pop();
      return Object.assign({ id: c.id, type: c.key, len: c.len, fwd: 1, home: c.home }, extra || {}); },
    any(extra, pref) { const LONG = ['rf', 'cb', 'c89', 'ar', 'amfleet'];   // filler cars: never > 68 ft (they could not pass the #4 turnouts)
      const ks = Object.keys(pool).filter(k => pool[k].length && !LONG.includes(k)); if (!ks.length) return null;
      let best = null; for (const k of ks) for (const c of pool[k]) if (pref && c.home.startsWith(pref)) { best = k; break; }
      return this.take(best || ks[Math.floor(r() * ks.length)], extra); } };
}
/* stand cars on a track in planner order (a->b), pushed against the bumper (stub) end when there is one */
function placeOnTrack(eng, cars, trk) {
  const deg = n => eng.E.filter(e => e.a === n || e.b === n).length;
  const tot = cars.reduce((s, c) => s + c.len, 0);
  const start = deg(trk.b) === 1 && deg(trk.a) !== 1 ? Math.max(0.35, trk.len - 0.35 - tot) : 0.35;   // track coordinate of the a-side end of the block
  let node = trk.a, off = 0;
  for (const e of trk.edges) { const E = eng.E[e]; const fwd = E.a === node;
    if (start <= off + E.len || e === trk.edges[trk.edges.length - 1]) { const x = Math.min(start - off, E.len); return eng.makeCut(cars, e, fwd ? x : E.len - x, fwd ? 1 : -1); }
    off += E.len; node = fwd ? E.b : E.a; }
}
function setupSession(eng, seed, jobsWanted) {
  const D = eng.D, r = rng(seed), ses = genSession(D, seed); const cards = []; const jobs = []; const P = makePool(D, seed); eng.missing = [];
  const carObj = (r_, type, len, extra) => { const c = P.take(type, extra); if (!c) eng.missing.push(type); return c; };
  for (const ind of D.industries) {
    const trk = eng.trk[ind.tid]; const cars = [];
    for (const g of ind.groups) { const c = ses[ind.id + ':' + g.id];
      for (let i = 0; i < c.keep; i++) cars.push(carObj(r, g.car, g.len, { ind: ind.id, grp: g.id, status: 'stay', dest: ind.id + ':' + g.id, load: 'loading' }));
      for (let i = 0; i < c.out; i++) cars.push(carObj(r, g.car, g.len, { ind: ind.id, grp: g.id, status: 'pickup', dest: 'TRAIN', load: r() < .5 ? 'loaded' : 'empty' })); }
    for (let i = cars.length - 1; i >= 0; i--) if (!cars[i]) cars.splice(i, 1);
    if (/^NUT/.test(ind.id)) { const na = (D.graph.nodes || []).find(n => n.id === trk.a); if (!na || na.kind !== 'bumper') cars.reverse(); }   /* [CHOCO-E] Nutrien NX-1/2/3: a = ladder leg, kept cars start at the bumper (b) end, matching sim.py */
    if (cars.length) { const e0 = trk.edges[0], d = eng.E[e0].a === trk.a ? 1 : -1; const cut = placeOnTrack(eng, cars, trk); cut.cars.forEach(c => c.fwd = 1); cut.parked = true; }
  }
  for (const job of D.jobs.map((j, i) => [j, i]).sort((x, y) => ((x[0].start_min || 0) - (y[0].start_min || 0)) || (x[1] - y[1])).map(x => x[0])) { /* [CHOCO-YARDMUTEX] place jobs in timetable order (stable), so the jobs[] list order cannot change who owns a shared hold track (gates-m10: YARDA listed first -> CLNA120 'not placed', YARDA plan ran on the wrong yard state) */
    if (jobsWanted && !jobsWanted.includes(job.id)) continue;
    const st = job.stops[0]; const S = [];
    for (const st2 of job.stops) for (const iid of st2.industries) { const ind = D.industries.find(i => i.id === iid);
      for (const g of ind.groups) for (let i = 0; i < ses[iid + ':' + g.id].inn; i++) { const c = carObj(r, g.car, g.len, { dest: iid + ':' + g.id, ind: iid, grp: g.id, status: 'setout', job: job.id, load: 'loaded' }); if (c) S.push(c); } }
    const pre = (D.sessions || []).find(s => s.seed === seed); const nX = pre && pre.fill && pre.fill[job.id] !== undefined ? pre.fill[job.id] : Math.max(0, job.cars - S.length);
    const X = []; for (let i = 0; i < nX; i++) { const c = P.any({ status: 'through', dest: 'TRAIN', job: job.id }, job.id); if (c) X.push(c); }
    const plan = (D.plans || {})[job.id + ':' + seed] || null;
    const block = (plan && plan.block) || 'front';
    const inds = [...new Set(S.map(c => c.ind))]; const Sr = inds.reverse().flatMap(i => S.filter(c => c.ind === i));   // same as sim.py: industry blocks reversed, group order kept
    let order = block === 'front' ? S.concat(X) : X.concat(Sr);
    let rl = P.locos.find(l => l.key === job.loco && l.home.startsWith(job.id)) || P.locos.find(l => l.key === job.loco) || P.locos[0];
    if (rl) P.locos.splice(P.locos.indexOf(rl), 1);
    const loco = { id: rl ? rl.id : job.id + ' power', type: job.loco, model: rl && rl.model, len: rl ? rl.len : (D.carLen[job.loco] || 4.45), loco: true, addr: 20 + jobs.length * 10, fwd: 1, train: job.id, road: rl ? rl.rr : 'NS', num: rl ? rl.id : '' };
    // cars tail -> head; loco at the loco end of the hold track
    const trk = eng.trk[st.tid]; const atA = st.loco_end === 'a';
    const list = [loco].concat(order);            // head-first from the loco end
    const e0 = atA ? trk.edges[0] : trk.edges[trk.edges.length - 1];
    const d = atA ? (eng.E[e0].a === trk.a ? 1 : -1) : (eng.E[e0].b === trk.b ? -1 : 1);
    const tot = list.reduce((s, c) => s + c.len, 0);
    let cut = eng.makeCut(list, e0, 0.6, d); // loco at the tail end, cars extend away from the loco end
    { // verify it sits on the hold track with the loco at the loco end; else try the mirrored placement
      const inTrk = c => Object.keys(eng.occupancy(c)).filter(e => !trk.edges.includes(+e)).length;
      if (inTrk(cut)) { const alt = [[e0, eng.E[e0].len - 0.6, d]]; let best = cut, bs = inTrk(cut);
        for (const [e, s1, d1] of alt) { eng.cuts.splice(eng.cuts.indexOf(best === cut ? cut : best), 0); const c2 = eng.makeCut(list, e, s1, d1); const sc = inTrk(c2);
          const lp = eng.carPose(c2, 0), nd = eng.N[atA ? trk.a : trk.b]; const near = Math.hypot(lp.x - nd.x, lp.y - nd.y) < 8;
          if (sc < bs && near) { eng.cuts.splice(eng.cuts.indexOf(best), 1); best = c2; bs = sc; } else eng.cuts.splice(eng.cuts.indexOf(c2), 1); }
        cut = best; } }
    const oc = eng.occupancy(cut); const clash = eng.cuts.find(c => c !== cut && Object.keys(eng.occupancy(c)).some(e => { const a = oc[e], b = eng.occupancy(c)[e]; return a && b && a[0] < b[1] && b[0] < a[1]; }));
    if (clash) { const cj = (clash.cars.find(x => x.loco) || {}).train, JD = eng.D.jobs, sj = JD.find(x => x.id === cj), me = JD.find(x => x.id === job.id);   /* [R34] P22 (after P20) and C122 (after CLNA) share the earlier job's hold track: their train is built but waits off the layout (pendingStart) until the hold track is clear */
      if (sj && me && (me.start_min || 0) > (sj.start_min || 0)) { eng.say(`${job.id}: shares its hold track with ${cj}; its train waits off the layout until the track is clear`); job._shared = cj; } else
    { eng.cuts.splice(eng.cuts.indexOf(cut), 1); eng.say(`${job.id} not placed: its train would overlap ${eng.cutName(clash)} (run it in another session)`, 'warn'); continue; } }
    loco.fwd = -1;                                // the loco faces the hold-track end (tail)
    eng.throttles[loco.addr] = { speed: 0, dir: 1, steps: 28, cv3: 4, cv4: 4, f: {} };
    jobs.push({ id: job.id, name: job.name, level: job.level, addr: loco.addr, loco, setouts: S.map(c => c.id), plan, stops: job.stops, cut: cut.id, tot });
    for (const c of S) cards.push({ car: c.id, type: c.type, job: job.id, from: job.id + ' train', to: D.industries.find(i => i.id === c.ind).groups.find(g => g.id === c.grp).name, spot: c.ind, kind: 'set out' });
  }
  { const YF = (D.session || {}).yard_fill || {}; /* [CHOCO-YARDFILL] Marsden yard about half full at t=0: storage / bad-order / next-session cars (<= 68 ft, status stay, no job) at the bumper end of yard tracks the plans leave empty there; drawn after the jobs so no job's cars change */
    for (const tid in YF) { const trk = eng.trk[tid]; if (!trk) continue; const cars = []; let g = 0; while (cars.length < YF[tid] && g++ < 60) { const c = P.any({ status: 'stay', dest: 'YARD', load: P.r() < .5 ? 'loaded' : 'empty', yardFill: true }); if (!c) break; if (c.len <= 5.1) cars.push(c); }
      if (!cars.length) continue; const cut = placeOnTrack(eng, cars, trk); cut.cars.forEach(c => c.fwd = 1); cut.parked = true; cut.yardFill = true;
      const oc = eng.occupancy(cut); if (eng.cuts.some(q => q !== cut && Object.entries(eng.occupancy(q)).some(([e, b]) => { const a = oc[e]; return a && a[0] < b[1] && b[0] < a[1]; }))) { eng.cuts.splice(eng.cuts.indexOf(cut), 1); eng.say(`yard fill ${tid}: would overlap, skipped`, 'warn'); } else eng.say(`yard fill: ${cars.length} cars standing on ${tid}`); } }
  for (const c of eng.cuts) for (const car of c.cars) if (car.status === 'pickup') { const job = D.jobs.find(j => j.stops.some(s => s.industries.includes(car.ind)));
    cards.push({ car: car.id, type: car.type, job: job ? job.id : '-', from: D.industries.find(i => i.id === car.ind).name, to: (job ? job.id : 'yard') + ' train', spot: car.ind, kind: 'pick up' }); }
  eng.session = { seed, cards, jobs, ses }; return eng.session;
}
function scoreSession(eng) {
  const s = { spotted: 0, setouts: 0, pulled: 0, pickups: 0, misplaced: 0, violations: eng.violations.filter(v => v.who !== 'ai').length };
  const where = car => { const c = eng.cutOf(car); const l = eng.locate(c, 0); return { cut: c, trk: eng.e2t[l.e], trkH: eng.e2t[eng.locate(c, c.len).e] }; };
  const indTrk = {}; for (const i of eng.D.industries) indTrk[i.id] = i.tid;
  for (const c of eng.cuts.concat(eng.departed || [])) for (const car of c.cars) {   // [START] departed trains still score their pick-ups
    if (car.status === 'setout') { s.setouts++; let o = 0; for (const x of c.cars) { if (x === car) break; o += x.len; } const l = eng.locate(c, o + car.len / 2);
      if (eng.e2t[l.e] === indTrk[car.ind] && !c.cars.some(x => x.loco)) s.spotted++; }
    if (car.status === 'pickup') { s.pickups++; if (c.cars.some(x => x.loco)) s.pulled++; }
  }
  s.points = s.spotted * 10 + s.pulled * 8 - s.violations * 5 - Math.floor(eng.t / 60) * 0.2;
  s.points = Math.round(s.points); return s;
}

// ==================================================================== AI: dispatcher + drivers + plan executor
class AI {
  constructor(eng) { this.eng = eng; this.trains = []; this.radio = []; this.execs = []; eng.ai = this; this.passHold = {}; this.buildSignals(); }
  /* block signals: one at each end of every main/siding track, protecting the block beyond that end.
     aspect: 'R' (next block occupied/claimed, or dispatcher hold), 'Y' (block after next occupied), 'G' clear.
     eng.sigHold[id] = true is the CTC 'stop' (click a signal); AI trains stop at a held or red signal. */
  buildSignals() { const eng = this.eng; eng.signals = []; eng.sigHold = eng.sigHold || {}; this.sigAt = {};
    for (const t of eng.D.tracks) { if (t.type === 'spur' || t.stub) continue;
      for (const end of ['a', 'b']) { const node = t[end]; const nx = eng.N[node]; if (!nx) continue;
        const out = eng.E.filter(e => (e.a === node || e.b === node) && !t.edges.includes(e.id)); if (!out.length) continue;
        // draw the mast 1.2 in back inside the protected-from track, offset to the right
        const e0 = eng.E.find(e => t.edges.includes(e.id) && (e.a === node || e.b === node)); let x = nx.x, y = nx.y;
        if (e0 && e0.pts && e0.pts.length > 1) { const P = e0.a === node ? e0.pts : e0.pts.slice().reverse(); const q = P[Math.min(P.length - 1, 1)]; let dx = q[0] - P[0][0], dy = q[1] - P[0][1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; x = P[0][0] + dx * 1.4 - dy * 0.9; y = P[0][1] + dy * 1.4 + dx * 0.9; }
        const sg = { id: `S${t.id}${end}`, tid: t.id, end, node, level: t.level, x, y, out: out.map(e => e.id), aspect: 'G' };
        eng.signals.push(sg); this.sigAt[t.id + ':' + node] = sg; } } }
  updateSignals() { const eng = this.eng; if (!eng.signals) return;
    const busy = e => { const b = this.blockOf(e); return !!(this.occ[b] && this.occ[b].size) || !!eng.reserve[b]; };
    for (const sg of eng.signals) { let a = 'G';
      if (eng.sigHold[sg.id]) a = 'R';
      else if (sg.out.some(busy)) a = 'R';
      else { // one block further: any edge touching the far node of the next block
        const far = sg.out.flatMap(e => { const E = eng.E[e]; const n = E.a === sg.node ? E.b : E.a; return eng.E.filter(x => x.id !== e && (x.a === n || x.b === n)).map(x => x.id); });
        if (far.some(busy)) a = 'Y'; }
      sg.aspect = a; } }
  signalBetween(e1, e2) { const eng = this.eng, A = eng.E[e1], B = eng.E[e2]; const n = (A.a === B.a || A.a === B.b) ? A.a : A.b; return this.sigAt[(eng.e2t[e1] || '') + ':' + n]; }
  say(text) { this.eng.say('📻 ' + text, 'radio'); this.radio.push({ t: this.eng.t, text }); }
  addThrough(cars, sym, eid, s, d, opts = {}) {
    const eng = this.eng; const addr = 900 + (this._addrN = (this._addrN || 0) + 1);   /* [R28] unique addr (timetable trains come and go) */ cars[cars.length - 1].loco = true; cars[cars.length - 1].addr = addr; cars[cars.length - 1].ai = true; cars[cars.length - 1].train = sym;
    const cut = eng.makeCut(cars, eid, s, d); eng.throttles[addr] = { speed: 0, dir: 1, cv3: 2, cv4: 2 };
    const tr = { sym, addr, prio: PRIO(sym), lift: !!opts.lift, laps: 0, state: 'run', wantLift: !!opts.lift, held: 0, vmax: opts.vmax || 40 };
    this.trains.push(tr); return tr;
  }
  cutOf(tr) { return this.eng.locoCut(tr.addr); }
  /* [L3] staging: a train that reaches L3 on the lift leaves the layout (despawns); after a dwell it comes back on the lift at L3 and rides down to L2 */
  toStaging3(tr, cut) { const eng = this.eng; const p = cut.path[0]; eng.cuts.splice(eng.cuts.indexOf(cut), 1); this.trains.splice(this.trains.indexOf(tr), 1);
    if (tr.tt && tr.ttRuns >= 1 && eng.opt.loopSession !== false && eng._ttP) {   /* [R36] endless session: a train that finished its timetable run goes back into L3 staging and comes down again in the next lap of the 20-train timetable (before: it retired, and once the last timetable train had run the layout went quiet) */
      for (const k in eng.reserve) if (eng.reserve[k] === tr.sym) delete eng.reserve[k]; tr.loopK = (tr.loopK || 0) + 1; this.loopN = Math.max(this.loopN || 0, tr.loopK);
      const due = (tr.ttUntil0 || 0) + eng._ttP * tr.loopK; (this.stage3 = this.stage3 || []).push({ tr, cars: cut.cars, d: p.d, s: p.d > 0 ? cut.t0 : eng.E[p.e].len - cut.t0, until: Math.max(eng.t + (eng.opt.stageDwell || 180), due), lv: tr.ttLv }); tr.toStaging = false;
      this.say(`${tr.sym}: in L3 staging — lap ${tr.loopK + 1} of the timetable at sim minute ${Math.round(Math.max(eng.t + (eng.opt.stageDwell || 180), due) / 60)}`); return; }
    if (tr.tt && tr.ttRuns >= 1) { for (const k in eng.reserve) if (eng.reserve[k] === tr.sym) delete eng.reserve[k]; delete eng.throttles[tr.addr]; (this.retired = this.retired || []).push(tr.sym); this.say(`${tr.sym}: in L3 staging — off the layout (timetable run complete)`); return; }   /* [R28 item 9] one timetable run each */
    (this.stage3 = this.stage3 || []).push({ tr, cars: cut.cars, d: p.d, s: p.d > 0 ? cut.t0 : eng.E[p.e].len - cut.t0, until: eng.t + (eng.opt.stageDwell || 180) }); tr.toStaging = false;
    this.say(`${tr.sym}: in L3 staging`); }
  _lvClosed(lv) { const eng = this.eng; /* [CHOCO-DETOUR] */ if (this._mhp && this._mhp[lv]) return true; if (this.mainTime && this.mainTime[lv] && (eng.D.jobs || []).some(j => j.id === this.mainTime[lv])) return true; if ((this.execs || []).some(x => !x.done && !x.fail && x.askedMain && x.job.level === lv)) return true; return (this.execs || []).some(x => !x.done && !x.fail && x.windowed && x.job.stops && eng.trk[x.job.stops[0].tid] && eng.trk[x.job.stops[0].tid].level === lv); }
  fromStaging3() { const eng = this.eng, l = eng.lift; if (!this.stage3 || !this.stage3.length || !l) return; this.stage3.sort((a, b) => a.until - b.until);   /* [R28 item 9] earliest-due train first */
    if (this.trains.filter(t => t.prio <= 3).length >= 3) return; if (this.trains.length >= (eng.opt.maxRoad || 4)) return;   /* [R36] at most 4 road trains of any priority on the two mains at once: with 5 out, the L1/L2 loops and the lift formed a circular block wait (sim min 238-254) */   /* [R28 item 9] at most 3 through trains out on the layout at once */
    if (eng.cuts.some(c => eng.occupancy(c)[l.edge])) return;   // the lift must be empty
    const lvOK = (st, dl) => { if (st.tr.tt && this._lvClosed(dl)) return false; if (Object.keys(this.occ || {}).some(b => b === 'T:L' + dl + '-LN' || b === 'T:L' + dl + '-LS') || Object.keys(eng.reserve).some(k => k === 'T:L' + dl + '-LN' || k === 'T:L' + dl + '-LS')) return false;   /* [R28] the lift throat must be clear */
      if (st.tr.tt && this.trains.some(t => t.prio <= 3 && t !== st.tr && (() => { const c = this.cutOf(t); return c && Math.round(eng.edgeLevel(c.path[0].e)) === dl; })())) return false;   /* [R28] one through train per level (no meets on single track) */
      { const bz = this._landClaim(st.tr, dl); if (bz) { if (st._hz !== bz) { st._hz = bz; this.say(`⚑ ${st.tr.sym}: holding in L3 staging — L${dl} landing ${bz}`); } return false; } }   /* [CHOCO-LAP6] never send a train up onto a landing another train has reserved/claimed for the lift (lap5 s1: fertilizer vs NS 350 E at L2-LS -> meet removal) */
      if (this._reT && eng.t - (this._reT[dl] || -1e9) < 180) return false; if (this.liftLandingBusy(st.tr, dl)) return false;   /* [R38] the on-deck checks (staging re-entry 180 s, landing clear) are made here, before the train is put on the lift: BNSF ethanol stood 146 s on the parked lift at L3 (min 130) */
      return !((this.mainTime && this.mainTime[dl]) || this.opposed(st.tr, dl)); };   // [DIR] no track time / opposing traffic
    /* [R36] no head-of-line blocking: the first DUE train that can come down onto its timetable level (or the other level) goes; before, one train held
       by its level kept every later train in staging even with the other main empty (staging drained 9 trains in ~125 sim min) */
    let pick = null, dl = 0; for (const st of this.stage3) { if (eng.t < st.until) break; const lv = st.lv || 2; for (const d of [lv, lv === 1 ? 2 : 1]) if (lvOK(st, d)) { pick = st; dl = d; break; } if (pick) break; }
    if (!pick) return; const st = pick;
    if (l.moving) return; if (l.level !== 3) { if (!this.trains.some(t => t.wantLift && t.lifted)) eng.requestLift(3, 'ai'); return; }
    this.stage3.splice(this.stage3.indexOf(st), 1); if (st.tr.tt) st.tr.ttRuns = (st.tr.ttRuns || 0) + 1; eng.makeCut(st.cars, l.edge, st.s, st.d); Object.assign(st.tr, { nextLv: dl, downTo: dl, wantLift: true, lifted: false, liftT: 0, lapDist: 0 }); this.trains.push(st.tr); this.say(`${st.tr.sym}: out of L3 staging, on the lift (to L${dl})`); }
  tick(dt) {
    const eng = this.eng; this.dropLanding(); this.prevRes = this.res || {}; this.res = {}; if (eng._adQ && eng._adQ.length) { const q = eng._adQ[0]; if (eng.t >= q.until) { /* [CHOCO-AD] */ const D = eng.D, at = (D.session && D.session.ad_at) || [60, 3.67];
      { /* [CHOCO-AD2] */ const _L = q.t.cars.reduce((x, c) => x + c.len, 0) + 1; let best = null; for (const T of D.tracks) { if (T.level !== 1 || T.type !== 'siding' || T.len < _L) continue; for (const e of T.edges) for (const p of eng.E[e].pts) { const d = Math.hypot(p[0] - at[0], p[1] - at[1]); if (!best || d < best.d) best = { d, T }; } } this._adT = best.T; }
      const T = this._adT, busy = new Set(); for (const c of eng.cuts) for (const e in eng.occupancy(c)) busy.add(+e);
      if (!T.edges.some(e => busy.has(e)) && !(eng.lift && eng.lift.moving) && !(this.mainTime && this.mainTime[1])) { /* [CHOCO-AD3] */ const cars = q.t.cars.map((c, k) => ({ id: q.sym + '-' + String(k + 1).padStart(2, '0'), type: c.type === 'loco' ? 'loco' : carKey(c), len: c.len, fwd: 1, model: c.model, road: c.rr, rear: !!c.rear })); cars.reverse();
        let _pl = null; for (const e of [T.edges[0], T.edges[T.edges.length - 1]]) for (const s1 of [3, eng.E[e].len - 3, 0.6, eng.E[e].len - 0.6]) /* [CHOCO-AD4] */ for (const d1 of [1, -1]) { if (_pl) break; const tc = eng.makeCut(cars, e, s1, d1); const inside = Object.keys(eng.occupancy(tc)).every(x => T.edges.includes(+x)); eng.cuts.splice(eng.cuts.indexOf(tc), 1); if (inside) _pl = [e, s1, d1]; } if (!_pl) { if (!this._adWarn) { this._adWarn = 1; eng.say(`⚠ ${q.sym}: does not fit wholly on the A/D (${T.id})`, 'warn'); } (eng.adNoFit = eng.adNoFit || []).push(q.sym); eng._adQ.shift(); } if (_pl) { const tr = this.addThrough(cars, q.sym, _pl[0], _pl[1], _pl[2], { lift: true, vmax: 35 }); tr.tt = true; tr.ttRuns = 1; tr.cw = q.t.dir === 'CW'; tr.wantLift = false; tr.lapDist = 0; tr.fromAD = true; eng._adQ.shift(); { eng._thCtx = q.sym + ':AD-route'; for (const t of Object.values(eng.T)) { if (T.edges.includes(t.legN)) eng.throwTurnout(t.id, 'N', 'ai'); else if (T.edges.includes(t.legD)) eng.throwTurnout(t.id, 'D', 'ai'); } } /* [CHOCO-AD4] */ (eng.adDeparted = eng.adDeparted || []).push({ sym: q.sym, t: eng.t, track: T.id });
        this.say(`${q.sym}: built on the A/D (${T.id}), departing Marsden`); } } } }   /* [R36] claims carry over one tick: first come, first served (see drive) */
    // reservations: blocks occupied by any cut
    const occ = {}; for (const c of eng.cuts) for (const e in eng.occupancy(c)) { const b = this.blockOf(+e); (occ[b] = occ[b] || new Set()).add(c); }
    this.occ = occ; this.updateSignals();
    const order = this.trains.slice().sort((a, b) => a.prio - b.prio);
    if (this.eng.dispatchMode !== 'manual') for (const tr of this.trains) { const c = this.cutOf(tr); if (!c || !c.derailed) { tr.derT = 0; continue; } tr.derT = (tr.derT || 0) + dt;
      if (tr.derT > 45) { c.derailed = false; c.v = 0; tr.derT = 0; tr.held = 20; this.rerails = (this.rerails || 0) + 1; this.say(`Dispatcher: ${tr.sym} re-railed by the crew; the meet logic sends one train to staging`); } }   /* [R36] auto session never ends on a wreck: after 45 s the crew re-rails and checkMeet clears the pair (the rare late-claim head-on at the L2 lift throat is still logged as a violation) */
    this.fromStaging3(); for (const tr of order) this.drive(tr, dt);
    if (eng._lw && eng._lw.length) eng._lw = eng._lw.filter(w => { /* [CHOCO-LOCALWINDOW] window = no through train on the L2 main/lift route: none with any car on L2, none queued for or riding the lift to/from L2, lift not carrying a through train; rechecked every 5 s; after 1500 s the local goes anyway (warning) so nothing can deadlock */
      if (eng.t < w.next) return true; w.next = eng.t + 5;
      const busy = this.trains.filter(t => t.tt && !t.backTo && ((() => { const c = this.cutOf(t); return c && c.path.some(p => Math.abs(eng.edgeLevel(p.e) - 2) < 0.75); })() || (t.wantLift && (t.nextLv === 2 || t.downTo === 2 || t.lifted))));
      const waited = eng.t - w.t0;
      if (busy.length && waited < 1500) { if (!w.said) { w.said = 1; this.say(`Dispatcher: ${w.bk}, hold on ${w.ex.job.stops[0].tid} - ${busy.map(t => t.sym).join(', ')} on the L2 route`); } return true; }
      if (busy.length) eng.say(`Dispatcher: ${w.bk} waited ${Math.round(waited)} s on ${w.ex.job.stops[0].tid}, going anyway (no window)`, 'warn'); else this.say(`Dispatcher: ${w.bk}, window - come ahead off ${w.ex.job.stops[0].tid} (waited ${Math.round(waited)} s)`);
      (eng._lwLog = eng._lwLog || []).push([w.bk, Math.round(w.t0), Math.round(waited), busy.length ? 'cap' : 'window']);
      const cut = w.ex.cut(); const lc = cut && cut.cars.find(x => x.addr === w.ex.job.addr); if (!lc) return false; const bk = w.bk;
      lc.ai = true; lc.train = bk; this.trains.push({ sym: bk, addr: w.ex.job.addr, prio: 4, lift: true, laps: 0, state: 'run', wantLift: true, held: 0, vmax: 25, backTo: 1, nextLv: 1, lifted: false, liftT: 0, lapDist: 0 }); this.say(`${w.ex.job.id}: running back as ${bk} (lift to L1 Marsden)`); return false; });
    if (this.pendingStart) this.pendingStart = this.pendingStart.filter(([sm, j]) => { if (eng.t < sm) return true; { const _dj = eng.D.jobs.find(x => x.id === j.id) || {}; const _ac = _dj.after_clear || []; if (_ac.length) { /* [CHOCO-AFTERCLEAR] */ const y = this.execs.find(x => x.job.id === _ac[0]); const c = y && y.cut && y.cut(); const clr = y && (y.done || y.fail || (y.i > 0 && !(y.steps || []).slice(y.i).some(q => [q.frm, q.to].concat(q.via || []).includes(_ac[1])) && !(c && Object.keys(eng.occupancy(c)).some(e => eng.e2t[e] === _ac[1])))); if (!clr) { if (!j._acSaid) { j._acSaid = 1; this.say(`Dispatcher: ${j.id}, hold until ${_ac[0]} has cleared ${_ac[1]}`); } return true; } if (!j._acOk) { j._acOk = 1; this.say(`Dispatcher: ${_ac[0]} has cleared ${_ac[1]} - ${j.id} come ahead`); } } const _af = (_dj.after || []).filter(id => (eng.session.jobs || []).some(x => x.id === id) && !this.execs.some(x => x.job.id === id && (x.done || x.fail))); if (_af.length) { if (!j._afSaid) { j._afSaid = 1; this.say(`Dispatcher: ${j.id}, hold until ${_af.join(', ')} off duty (one crew on the ladder)`); } return true; } { const _m = _dj.yard_mutex; if (_m) { /* [CHOCO-YARDMUTEX] one crew in the Marsden yard at a time: a yard job goes on duty (and its train is put on the layout) only when no other job with the same yard_mutex is on duty; the token is taken here and released when that job is done or failed, so no two yard crews can ever hold each other */ eng._ym = eng._ym || {}; const _hd = eng._ym[_m]; const _hx = _hd && _hd !== j.id && ((eng.session.jobs || []).find(x => x.id === _hd) || {}).exec; if (_hx && !_hx.done && !_hx.fail) { if (j._ymSaid !== _hd) { j._ymSaid = _hd; this.say(`Dispatcher: ${j.id}, hold off the yard - ${_hd} has the Marsden yard`); } return true; } eng._ym[_m] = j.id; } } } /* [CHOCO-AFTER] */ { const _h = eng.trk[j.stops[0].tid]; if (_h && _h.type === 'main') { /* [CHOCO-MAINHOLD] */ (this._mhp = this._mhp || {})[_h.level] = j.id; if (this.trains.some(t => t.tt && !t.backTo && ((() => { const c = this.cutOf(t); return c && Math.round(eng.edgeLevel(c.path[0].e)) === _h.level; })() || (t.wantLift && (t.nextLv === _h.level || t.downTo === _h.level))))) { if (!j._mhSaid) { j._mhSaid = 1; this.say(`Dispatcher: ${j.id}, wait off the main - through traffic still on L${_h.level}`); } return true; } delete this._mhp[_h.level]; } } if (j._offCut) { if (((eng.D.jobs.find(x => x.id === j.id) || {}).loco) === 'mp15') yardUnpark(eng); /* [CHOCO-YARDRES] */ const oc = eng.occupancy(j._offCut); if (eng.cuts.some(c => Object.entries(eng.occupancy(c)).some(([e, b]) => { const a = oc[e]; if (!a) return false; if (!c.yardFill) return true; return a[0] < b[1] + 1.5 && b[0] < a[1] + 1.5; /* [CHOCO-YARDFILL] storage cars at the bumper end only block a train placed within 1.5 in of them */ }))) return true; eng.cuts.push(j._offCut); j._offCut = null; }
      for (const b of j._blocks || []) if (eng.trk[b].type !== 'main' || b === j.stops[0].tid) eng.reserve['B:' + b] = j.id;
      this.say(`${j.id}: on duty (timetable minute ${Math.round(sm / 60)})`); startJobAI(eng, this, j); return false; });
    for (const ex of this.execs) ex.tick(dt);
    this.workWindow(dt);
    /* [R34] main-line sweep: a loco-less cut left standing on a main block after every local is off duty (R60's plan leaves
       'Riverton North turn-02' on T28; through trains then hold behind it forever -> L2 gridlock at ~84 min). After 120 s with no
       local working that level, the dispatcher has the car lifted (logged as a violation so the session plan can be fixed). */
    if ((this._swT || 0) + dt > 10) {   /* [R34] stale reservations: a finished/failed local's block reservations outlive it (B:T24=YARD held NS 212 on L1 from ~80 min to the end -> no more L1 releases) */
      const live = new Set(this.execs.filter(x => !x.done && !x.fail).map(x => x.job.id)), gone = new Set(this.execs.filter(x => x.done || x.fail).map(x => x.job.id)), syms = new Set(this.trains.map(t => t.sym));
      for (const k in eng.reserve) { const v = eng.reserve[k]; if (gone.has(v) && !live.has(v) && !syms.has(v) && !(this.pendingStart || []).some(([, j]) => j.id === v)) { delete eng.reserve[k]; (this.unreserved = this.unreserved || []).push([Math.round(eng.t), k, v]); } } }
    if ((this._swT = (this._swT || 0) + dt) > 10) { this._swT = 0; const busyLv = new Set(this.execs.filter(x => !x.done && !x.fail).map(x => { const h = eng.trk[x.job.stops[0].tid]; return h && h.level; }));
      for (const c of eng.cuts.slice()) { if (c.cars.some(x => x.type === 'loco') || Math.abs(c.v || 0) > 0.01) { c._mainT = 0; continue; } const b = this.blockOf(c.path[0].e), T = eng.trk[b.replace(/^[BT]:/, '')];
        const onMain = (T && T.type === 'main') || /^T:L\d-\d/.test(b); if (!onMain) { c._mainT = 0; continue; } const lv = Math.round(eng.edgeLevel(c.path[0].e)); if (busyLv.has(lv) || (this.mainTime && this.mainTime[lv])) { c._mainT = 0; continue; }
        c._mainT = (c._mainT || 0) + 10; if (c._mainT < 120) continue; eng.cuts.splice(eng.cuts.indexOf(c), 1); (this.swept = this.swept || []).push({ t: eng.t, blk: b, cars: c.cars.map(x => x.id || x.name) });
        this.say(`Dispatcher: ${c.cars.length} car(s) left standing on the L${lv} main (${b}) — hostler lifts them`); } }
  }
  /* dispatcher work window: a through train that has stood in a local's way for 45 s is sent off-layout to
     staging (radio: 'clear to staging'); it re-enters on its home main once every local crew is finished. */
  workWindow(dt) { const eng = this.eng; this.staged = this.staged || [];
    for (const ex of this.execs) { if (ex.done || ex.fail) continue; const c = ex.cut(); if (!c) continue;
      const blocker = ex.blockedBy; if (!blocker || (ex.blockT || 0) < 45) continue;
      const tr = this.trains.find(t => this.cutOf(t) === blocker); if (!tr || this.onLift(tr)) continue;
      const home = blocker.path[0].e; eng.cuts.splice(eng.cuts.indexOf(blocker), 1); this.trains.splice(this.trains.indexOf(tr), 1);
      this.staged.push({ tr, cut: blocker, home }); for (const k in eng.reserve) if (eng.reserve[k] === tr.sym) delete eng.reserve[k]; ex.blockT = 0; ex.blockedBy = null; this.say(`Dispatcher: ${tr.sym}, take it to staging — ${ex.job.id} is working there`); }
    // a local that holds on the main line works under a main-line window: the through trains on its level go to staging until it is done
    for (const ex of this.execs) { if (ex.done || ex.fail) continue; const hold = ex.job.stops && ex.job.stops[0] && eng.trk[ex.job.stops[0].tid];
      if (!hold || hold.type !== 'main') continue; ex.windowed = true; if (!(this.mainTime && this.mainTime[hold.level] === ex.job.id)) continue; /* [CHOCO-DETOUR3] */
      for (const tr of this.trains.slice()) { const c = this.cutOf(tr); if (!c || this.onLift(tr) || tr.backTo) continue; if (Math.round(eng.edgeLevel(c.path[0].e)) !== hold.level) continue;
        eng.cuts.splice(eng.cuts.indexOf(c), 1); this.trains.splice(this.trains.indexOf(tr), 1); this.staged.push({ tr, cut: c, home: c.path[0].e }); for (const k in eng.reserve) if (eng.reserve[k] === tr.sym) delete eng.reserve[k];
        this.say(`Dispatcher: ${tr.sym}, hold in staging — ${ex.job.id} has the L${hold.level} main (track warrant)`); } }
    if (this.staged.length) { const busy = new Set(); for (const c of eng.cuts) for (const e in eng.occupancy(c)) { busy.add(+e); const E = eng.E[+e]; for (const x of eng.E) if (x.a === E.a || x.a === E.b || x.b === E.a || x.b === E.b) busy.add(x.id); }   // keep a block clear around standing/moving cuts
      const holdLv = new Set(this.execs.filter(x => !x.done && !x.fail && x.windowed).map(x => { const h = eng.trk[x.job.stops[0].tid]; return h && h.level; }));
      for (const st of this.staged.slice()) { const lv = st.level || Math.round(eng.edgeLevel(st.home)); if ((this.mainTime && this.mainTime[lv]) || holdLv.has(lv)) continue; if (st.tr.cw !== undefined && this.opposed(st.tr, lv)) continue;   /* [MEET] */ if ((this._relT = this._relT || {})[lv] !== undefined && eng.t - this._relT[lv] < 90) continue; if (st.tr.prio <= 3 && (this.trains.filter(t => t.prio <= 3).length >= 3 || this.trains.some(t => t.prio <= 3 && (() => { const c = this.cutOf(t); return c && (Math.round(eng.edgeLevel(c.path[0].e)) === lv || (t.wantLift && (t.nextLv === lv || t.downTo === lv))); })()))) continue;   /* [R34] re-entry obeys the 3-through cap and the one-through-train-per-level rule (two trains backing out beside NS 165 + CSX phosphate made 4 out and an L1/L2 deadlock at 77 min) */   /* [R34] one re-entry per level per 90 s (four trains backing out at once onto L2 gridlocked at 82.6 min) */ if (this.trains.some(t => t.wantLift) || (eng.lift && eng.lift.moving)) continue; (this._reT = this._reT || {})[lv] = eng.t;   /* [R29] no staging re-entry while a train is on/using the lift (Amtrak 37 x NS 165 seed 2) */ const c = st.cut; const ok = c.path.every(p => !busy.has(p.e)); if (!ok) continue; if (c.path.some(p => { const lg = eng.legOf[p.e]; if (!lg) return false; const r = eng.reserve['T:' + lg[0].id]; return (r && r !== st.tr.sym) || (lg[0].state !== lg[1] && eng.cuts.some(o => eng.fouls(lg[0], o))); })) continue;   /* [R38] a staged train re-enters only when every turnout under it is free; then they are lined for it (CSX phosphate came back onto L1-15 lined reverse for P22's warrant -> runthrough min 115) */ eng.cuts.push(c); alignUnder(eng, c); this.trains.push(st.tr); this.staged.splice(this.staged.indexOf(st), 1); this._relT[lv] = eng.t; for (const e in eng.occupancy(c)) { const E = eng.E[+e]; for (const x of eng.E) if (x.a === E.a || x.a === E.b || x.b === E.a || x.b === E.b) busy.add(x.id); } this.say(`${st.tr.sym}: back out of staging`); } } }
  /* [GRANT] real-dispatcher track time: a local asks for the main on its level; granted when no other local holds it.
     Through trains on that level (not riding the lift) clear to staging/yard and drop their route reservations; the lift will
     not deliver a train onto a granted level; when the local reports clear, the trains come back. */
  grantMain(lv, job) { const eng = this.eng; this.mainTime = this.mainTime || {}; let h = this.mainTime[lv];
    if (h && h !== job) {   /* [R33] deadlock breaker: the holder has been stopped behind the requester's own loco for > 30 s -> hand the main to the requester so it can move out of the way */
      const X = eng.ai.execs || [], he = X.find(x => x.job.id === h && !x.done && !x.fail), re = X.find(x => x.job.id === job);
      const rc = re && re.cut(); this._ask = this._ask || {}; const ak = lv + ':' + job; if (this._ask[ak] == null) this._ask[ak] = eng.t;
      /* [R37] fair share: a local that has waited > 5 min for the main gets it when the holder is between steps with its whole cut off the main (R62 working IM-1 held the L2 main 30 min while R60 sat on T28 and NS 211 stood on the lift) */
      const hc = he && he.cut && he.cut(); const hOff = he && he.phase === 'start' && hc && !Object.keys(eng.occupancy(hc)).some(e => { const t = eng.trk[eng.e2t[+e]]; return t && t.type === 'main'; });
      if (hOff && eng.t - this._ask[ak] > 300) { this.say(`Dispatcher: ${h}, hold in the clear; ${job}, you have the L${lv} main`); this.mainTime[lv] = null; h = null; delete this._ask[ak]; }
      else if (!(he && rc && he.blockedBy === rc && (he.blockT || 0) > 30)) return false;
      if (h) {
      this.say(`Dispatcher: ${h}, hold where you are; ${job}, you have the L${lv} main to clear ${h}`); this.mainTime[lv] = null; h = null; he.blockT = 0; } }
    if (!h && (() => { const x = (this.execs || []).find(x => x.job.id === job); const hh = x && eng.trk[x.job.stops[0].tid]; return hh && hh.type === 'main'; })() && this.trains.some(t => t.tt && !t.backTo && !this.onLift(t) && (() => { const c = this.cutOf(t); return c && Math.round(eng.edgeLevel(c.path[0].e)) === lv; })())) { /* [CHOCO-DETOUR2] */ return false; }
    if (!h) { /* [R36c] a through train already committed to the lift for this level (on the deck, or called the lift with this level next) gets the main first:
         the local waits in its yard / siding a minute or two instead of the through train standing on the lift for the whole track-time window (CSX phosphate 17 min, min 51) */
      const L = eng.lift; const bound = this.trains.find(t => { if (t.prio > 3 && !t.tt) return false; if (this.onLift(t)) { const tg = L.level === 1 ? 2 : L.level >= 3 ? (t.downTo || 2) : (t.toStaging ? 3 : 1); return !t.lifted ? tg === lv : (L.level === lv || L.moving); } return t.wantLift && t.nextLv === lv && (t.stuckT || 0) < 600; });
      if (bound) { if (!this._gw || this._gw[lv] !== bound.sym) { (this._gw = this._gw || {})[lv] = bound.sym; this.say(`Dispatcher: ${job}, hold in the clear — ${bound.sym} is coming off the lift onto L${lv} first`); } return false; }
      this.mainTime[lv] = job; if (this._ask) delete this._ask[lv + ':' + job]; this.say(`Dispatcher: ${job}, you have the L${lv} main (track time granted)`); }
    for (const tr of this.trains.slice()) { const c = this.cutOf(tr); if (!c || tr.backTo) continue; const lifting = this.onLift(tr);
      if (lifting ? !(eng.lift.level === lv && tr.wantLift === false && !eng.lift.moving) : Math.round(eng.edgeLevel(c.path[0].e)) !== lv) continue;   // a train stepping off the lift onto the granted level is held too
      eng.cuts.splice(eng.cuts.indexOf(c), 1); this.trains.splice(this.trains.indexOf(tr), 1); (this.staged = this.staged || []).push({ tr, cut: c, home: c.path[0].e, level: lv, forJob: job });
      for (const k in eng.reserve) if (eng.reserve[k] === tr.sym) delete eng.reserve[k];
      this.say(`Dispatcher: ${tr.sym}, hold clear of the L${lv} main — ${job} has track time`); }
    return true; }
  releaseMain(lv, job) { if (this.mainTime && this.mainTime[lv] === job) { delete this.mainTime[lv]; this.say(`${job}: clear of the L${lv} main`); } }
  blockOf(e) { const lg = this.eng.legOf[e]; if (lg) return 'T:' + lg[0].id; const l = this.eng.lift; if (l && e === l.edge) return 'LIFT'; return 'B:' + (this.eng.e2t[e] || e); }
  drive(tr, dt) {
    const eng = this.eng, cut = this.cutOf(tr); if (!cut) return; tr.stuckT = Math.abs(cut.v) < 0.01 ? (tr.stuckT || 0) + dt : 0;   /* [R28] a through train held > 4 min does not count against the 4-train cap */ const loco = cut.cars.find(x => x.addr === tr.addr); const th = eng.throttles[tr.addr];
    if (cut.derailed) { th.speed = 0; return; }
    if (tr.fromAD && this.onLift(tr)) tr.fromAD = false;   /* [CHOCO-LAP3] the A/D departure route (T4 > L1-LS > T25 > L1-LN) is done once it is on the lift */
    if (eng.dispatchMode === 'manual' && tr.manualHold) { th.speed = 0; return; }
    if (tr.backup > 0) return this._backup(tr, th, cut, loco, dt);
    if (tr.meetWait > 0) { tr.meetWait -= dt; th.speed = 0; return; }
    if (tr.lift && tr.wantLift && tr.nextLv === undefined && !this.onLift(tr) && !tr.lifted) this.liftWindow(tr, cut);   /* [MEET] the first trip goes through the window too */
    // drive toward the loco's front (loco at head of cut, facing forward)
    const dir = (loco.fwd || 1) * th.dir;
    const vs = Math.abs(cut.v), look = Math.max(70, Math.ceil(vs * vs / (2 * eng.decelIps(cut) * 0.7) + 25)); const A = eng.ahead(cut, dir, look);   // [PHYSICS] see past the stopping distance
    let stopAt = look, why = null;
    const mine = new Set(Object.keys(eng.occupancy(cut)).map(e => this.blockOf(+e)));
    // line turnouts / lift ahead; stop at the first block we cannot have
    { const l0 = A[0] && eng.legOf[A[0].e]; if (l0 && A[1] && A[1].e === l0[0].stem && l0[0].state !== l0[1] && eng.dispatchMode !== 'manual') { /* [CHOCO-TRAIL2] */ const t = l0[0], leg = l0[1]; const rv = eng.reserve['T:' + t.id]; if (!(rv && rv !== tr.sym)) { eng._thCtx = tr.sym + ':trail0'; if (!eng.throwTurnout(t.id, leg, 'ai')) { const oc = eng.occupancy(cut), other = leg === 'N' ? t.legD : t.legN; if (!(t.stem in oc) && !(other in oc) && !eng.cuts.some(c => c !== cut && eng.fouls(t, c))) { const k = eng.cuts.indexOf(cut); eng.cuts.splice(k, 1); try { eng.throwTurnout(t.id, leg, 'ai'); } finally { eng.cuts.splice(k, 0, cut); } } } } if (t.state !== leg) { th.speed = 0; return; } this.say(`${tr.sym}: lining ${t.id} ${leg === 'N' ? 'normal' : 'reverse'} (head on the ${leg} leg)`); } }
    let dist = 0;
    for (let i = 1; i < A.length; i++) {
      const a = A[i], b = this.blockOf(a.e); const prev = A[i - 1];
      const lg = eng.legOf[a.e];
      if (this.blockOf(prev.e) !== b && !mine.has(b)) { const sg = this.signalBetween(prev.e, a.e); if (sg && eng.sigHold[sg.id]) { stopAt = Math.min(stopAt, a.from - 1.5); why = `signal ${sg.id} held by the dispatcher`; break; } }
      const users = this.occ[b]; const other = users && [...users].some(c => c !== cut);
      const resv = eng.reserve[b] && eng.reserve[b] !== tr.sym && !mine.has(b);
      const pv = this.prevRes && this.prevRes[b]; let cl = ((this.res[b] && this.res[b] !== tr.sym) || (pv && pv !== tr.sym && !this.res[b] && this.trains.some(o => o.sym === pv))) && !mine.has(b);   /* [R36] a block claimed last tick stays with its claimant until that train stops claiming it. Before, claims were rebuilt every tick in priority order, so a higher-priority train further away took the block from a nearer train already committed to it: the CSX phosphate / NS 211 (min 163) and Amtrak 37 / CSX phosphate (min 269) head-ons on B:T30 between L2-03 and L2-05 */
      if (!cl && !other && !(tr.loopHeld && !tr.wantLift)) this.res[b] = tr.sym;   /* [CHOCO-LAP4] a train held on the loop claims nothing ahead (lap4: T:L1-LS claimed while P90B back held it -> meet removal) */
      if (other || resv || cl) { stopAt = Math.min(stopAt, a.from - 1.5); why = cl && !other && !resv ? `${b} claimed by ${this.res[b] || pv}` : other ? `${b} occupied by ${[...users].filter(c => c !== cut).map(c => eng.cutName(c)).join(', ')}` : `${b} reserved for ${eng.reserve[b]}`; break; }
      if (lg) { const t = lg[0]; const facing = prev.e === t.stem;
        if (facing) { let want = t.mainLeg;
          if (/-L[NS]$/.test(t.id)) { const toLift = eng.liftNodeLevel(eng.E[t.legN].a) || eng.liftNodeLevel(eng.E[t.legN].b) ? 'N' : 'D'; want = tr.wantLift ? toLift : (toLift === 'N' ? 'D' : 'N'); if (this.onLift(tr)) want = toLift; }
          if (tr.pass && tr.pass.to === t.id) want = tr.pass.leg;
          { const rv = eng.reserve['T:' + t.id]; if (t.state !== want && rv && rv !== tr.sym) return this._stop(tr, th, cut, dir, a.from - 1.5, `lining ${t.id} (reserved for ${rv})`, dt); }   /* [R36] never re-throw a turnout another train holds (CSX phosphate and NS 165 threw L2-LS back and forth at the lift throat for 130 sim min) */
          if (t.state !== want) { if (a.from > 0.3 && eng.dispatchMode !== 'manual')   /* [R36] was a.from > 4: a train that had stopped 1.5 in short of a facing turnout (block ahead occupied) could never re-line it once the block cleared, a permanent stall (CSX Y191 at L1-LN, sim minute 196, then NS 165 and BNSF ethanol behind it). throwTurnout still refuses a fouled turnout */ { eng._thCtx = tr.sym + ':facing'; eng.throwTurnout(t.id, want, 'ai'); this.say(`${tr.sym}: lining ${t.id} ${want === 'N' ? 'normal' : 'reverse'}`); } return this._stop(tr, th, cut, dir, a.from - 1.5, `lining ${t.id}${this.fouler(t.id, cut)}`, dt); } }
        else { const leg = lg[1]; if (leg === 'D' && /-L[NS]$/.test(t.id) && tr.landHold && !tr.wantLift && tr.tt && !this.onLift(tr)) { const r = this._loopHold(tr, th, cut, dir, a.from - 1.5, t, dt); if (r !== null) { stopAt = Math.min(stopAt, r.stopAt); why = r.why; break; } }   /* [CHOCO-LAP2] refused: hold on the level's loop (T25/T40) short of the far lift turnout */
          { const rv = eng.reserve['T:' + t.id]; if (t.state !== leg && rv && rv !== tr.sym) return this._stop(tr, th, cut, dir, a.from - 1.5, `lining ${t.id} (reserved for ${rv})`, dt); } if (t.state !== leg) { if (eng.dispatchMode !== 'manual') { eng._thCtx = tr.sym + ':trail'; if (!eng.throwTurnout(t.id, leg, 'ai')) { /* [CHOCO-TRAIL] */ const oc = eng.occupancy(cut), other = leg === 'N' ? t.legD : t.legN; if (!(t.stem in oc) && !(other in oc) && !eng.cuts.some(c => c !== cut && eng.fouls(t, c))) { const k = eng.cuts.indexOf(cut); eng.cuts.splice(k, 1); try { eng.throwTurnout(t.id, leg, 'ai'); } finally { eng.cuts.splice(k, 0, cut); } this.say(`${tr.sym}: lining ${t.id} ${leg === 'N' ? 'normal' : 'reverse'} (own train on the ${leg} leg)`); } } } return this._stop(tr, th, cut, dir, a.from - 1.5, `lining ${t.id}${this.fouler(t.id, cut)}`, dt); } }
        eng.reserve[b] = tr.sym; }
      else if (eng.D.graph.lift && a.e === eng.lift.edge) {
        // entering the lift: need it here and empty
        if (eng.lift.moving) { stopAt = a.from - 1.5; why = 'lift moving'; break; }
      }
      if (a.from > Math.max(30, look - 40)) break;
    }
    { const keep = new Set(mine); for (const a of A) { if (a.from > look) break; keep.add(this.blockOf(a.e)); }   /* [RELEASE 2026-10-18] block-by-block: a turnout is released as soon as the rear of the train clears it */
      const lh = this.onLift(tr) && tr.landRes ? new Set(tr.landRes) : null; for (const k in eng.reserve) if (eng.reserve[k] === tr.sym && /^T:/.test(k) && !keep.has(k) && !(lh && lh.has(k))) { delete eng.reserve[k]; this.released = (this.released || 0) + 1; } }
    const ob = eng.obstacle(cut, dir, look); if (ob.what && ob.what !== 'end' && ob.dist - 2.0 < stopAt) { stopAt = ob.dist - 2.0; why = `${eng.cutName(ob.what)} ahead`; }
    if (A.end && eng.lift && eng.liftNodeLevel(A.end.node) && eng.cuts.some(c => c !== cut && eng.occupancy(c)[eng.lift.edge])) { let tq = null; for (const q of A) { if (q.from >= A.end.dist) break; if (eng.legOf[q.e] && !mine.has(this.blockOf(q.e))) tq = q; } if (tq && tq.from - 1.0 < stopAt) { stopAt = Math.max(0, tq.from - 1.0); why = `waiting for the lift clear of ${eng.legOf[tq.e][0].id} (lift occupied)`; } }   /* [R38] while another train is on the lift, wait short of the landing turnout so it can come off (NS 165 waited fouling L2-LS; CSX phosphate stood 62 s on the lift) */
    if (A.end && A.end.dist < stopAt) { const lv = eng.liftNodeLevel(A.end.node); stopAt = A.end.dist - 0.8; why = lv ? 'waiting for the lift' + (() => { const oc = eng.cuts.find(c => c !== cut && eng.occupancy(c)[eng.lift.edge]); if (!oc) return ''; const t = this.trains.find(t => this.cutOf(t) === oc); return ` (lift occupied by ${t ? t.sym : eng.cutName(oc)})`; })() : 'end of track';
      if (lv && eng.lift.level !== lv && !eng.lift.moving) { if (!this.liftBusy(cut)) { eng.requestLift(lv, 'ai'); this.say(`${tr.sym}: calling the lift to L${lv}`); } } }
    // ride the lift: fully on it -> stop, cycle, continue
    /* [R36] lift recovery: a train standing on the lift deck with no lift trip pending (wantLift false) at a level it cannot leave from (seen: RJC Pamlico
       local carried back up to L3 after stepping off at L1, stuck 200 sim min, and the occupied lift held every staged train in L3) rides it to its level */
    if (this.onLift(tr) && !tr.wantLift && (tr.stuckT || 0) > 30 && !eng.lift.moving && /^waiting for the lift/.test(why || '')) { const to = tr.nextLv && tr.nextLv !== eng.lift.level && tr.nextLv !== 3 ? tr.nextLv : (eng.lift.level === 1 ? 2 : 1);
      if (eng.requestLift(to, 'ai') !== false) { this.liftRecover = (this.liftRecover || 0) + 1; tr.stuckT = 0; this.say(`${tr.sym}: stranded on the lift at L${eng.lift.level} — riding it to L${to}`, 'warn'); } }
    if (this.onLift(tr) && tr.wantLift) {
      const o = eng.occupancy(cut); const onlyLift = Object.keys(o).length === 1;
      { const ls = A.find(a => a.e === eng.lift.edge); const remain = ls ? ls.to - 0.5 : stopAt; if (remain < stopAt && cut.len < eng.lift.len) { stopAt = remain; why = 'stopping on the lift'; } }
      if (onlyLift) { if (!tr.liftT) { tr.liftT = eng.t; }
        th.speed = 0; if (Math.abs(cut.v) < 0.01 && !eng.lift.moving) { if (!tr.lifted && eng.lift.level === 2 && eng.levels >= 3) { tr.l2N = (tr.l2N || 0) + 1; tr.toStaging = !tr.backTo && (tr.forceStage || tr.l2N % 2 === 1); if (tr.forceStage) tr.l2N--; tr.forceStage = false; }   /* [MEET] a window-forced L3 trip does not shift the L1/L3 alternation */   // [L3] every other lift trip from L2 (starting with the first) goes up to staging
        const target = eng.lift.level === 1 ? (tr.viaL3 ? 3 : (tr.backTo ? 1 : 2)) : eng.lift.level >= 3 ? (tr.downTo || 2) : (tr.toStaging ? 3 : 1); if (!tr.lifted && target !== 3 && this._reT && eng.t - (this._reT[target] || -1e9) < 180) return;   /* [R29] a train just backed out of staging on that level: wait */ if (!tr.lifted && this.mainTime && this.mainTime[target] && target !== 3) { if (!tr.liftHeld) { tr.liftHeld = true; this.say(`${tr.sym}: held on the lift — L${target} main is under track time`); } tr.lastWhy = `held on the lift: L${target} main under track time (${this.mainTime[target]})`; return; }   /* [R36b] the 17-min CSX phosphate wait at min 51 was this hold (L2 main given to local R64); it had no why, so it read as an unexplained stall */ tr.liftHeld = false; if (!tr.lifted) { if (target !== 3) this.holdLanding(tr, target); if (eng.requestLift(target, 'ai') === false) { tr.lastWhy = 'on the lift: lift interlock refused the trip, retrying'; return; } /* [CHOCO-LIFTREQ] a refused lift request (approach/interlock) left lifted=true, so the next tick read the unmoved deck as arrival and the train stepped off again on its own level (P90C back @6425 lw1, P97 back @2844 c3a) */ tr.lifted = true; this.say(`${tr.sym}: on the lift, going to L${target}`); return; } else if (eng.lift.level >= 3) { this.toStaging3(tr, cut); return; } else { tr.wantLift = false; tr.lifted = false; tr.liftT = 0; tr.downTo = null; this.say(`${tr.sym}: off the lift on L${eng.lift.level}`); } }
        else if (eng.lift.moving) return; }
    }
    if (!this.onLift(tr) && tr.lift && !tr.wantLift && tr.lastLevel !== undefined && tr.lastLevel !== eng.edgeLevel(cut.path[0].e)) { tr.lastLevel = eng.edgeLevel(cut.path[0].e); }
    if (tr.lift && !tr.wantLift && !this.onLift(tr)) { tr.lapDist = (tr.lapDist || 0) + Math.abs(cut.v) * dt; if (tr.backTo && Math.round(eng.edgeLevel(cut.path[0].e)) === tr.backTo && tr.lapDist > 60) { /* [CHOCO-BACK] yarded */ eng.cuts.splice(eng.cuts.indexOf(cut), 1); this.trains.splice(this.trains.indexOf(tr), 1); (eng.departed = eng.departed || []).push(cut); for (const k in eng.reserve) if (eng.reserve[k] === tr.sym) delete eng.reserve[k]; (eng.backDone = eng.backDone || []).push(tr.sym); this.say(`${tr.sym}: yarded at Marsden (L1)`); return; } if (tr.landHold) { tr.holdT = (tr.holdT || 0) + dt; if (tr.holdT > HOLD_CAP) { const lv0 = Math.round(eng.edgeLevel(cut.path[0].e)); tr.landHold = false; tr.loopHeld = false; tr.holdT = 0; tr.lapDist = 0; tr.capLaps = (tr.capLaps || 0) + 1; (this.holdCap = this.holdCap || []).push([Math.round(eng.t), tr.sym, lv0]); this.say(`⚑ ${tr.sym}: held ${HOLD_CAP} s on the L${lv0} loop without the lift — one extra lap (hold cap)`); } }   /* [CHOCO-LAP2] hold cap */
      let _defer = false; { const vs0 = Math.abs(cut.v), br = vs0 * vs0 / (2 * eng.decelIps(cut) * 0.7) + 12;
        for (let i = 1; i < A.length && A[i].from < br; i++) { const lg = eng.legOf[A[i].e]; if (lg && /-L[NS]$/.test(lg[0].id) && A[i - 1].e === lg[0].stem) { _defer = true; break; } }   /* [CHOCO-LAP2R] too close to stop for the lift: take the loop and ask there */
        if (_defer && !tr.fromAD) tr.landHold = true;
        const oc0 = eng.occupancy(cut) || {}; if (!this._contRun() && tr.tt && tr.landHold && !(tr.loopHeld && vs0 < 0.05) && Object.keys(oc0).some(e => LOOP_EDGES.has(eng.e2t[+e]) || (eng.legOf[+e] && /-L[NS]$/.test(eng.legOf[+e][0].id) && eng.legOf[+e][1] === 'D'))) _defer = true; }   /* on the loop: ask only once stood clear */
      if (!_defer && tr.lapDist > (this._contRun() ? 380 : LAP_REQ)) { /* [CHOCO-LAP] timetable session: ask for the lift once the level is crossed (main 320.4 in), not after 380 in (which forced a 2nd lap) */
        /* [DIR 2026-10-18] direction window: single-track mains, so a through train only takes the lift onto a level that has no opposing
           (other-direction) through train on it or heading there; otherwise it runs another lap and asks again (the dispatcher's meet rule) */
        tr.wantLift = true; tr.landHold = false; tr.nextLv = undefined; this.liftWindow(tr, cut); if (tr.wantLift && this.mainTime) { const l0 = eng.edgeLevel(cut.path[0].e); if (l0 === 1 && tr.tt && !tr.backTo) { const _c = this._lvClosed(2); if (_c && !tr.viaL3) this.say(`${tr.sym}: L2 under track warrant - returning to L3 staging from L1 (detour, skips the L2 run)`); tr.viaL3 = _c; } const tg = l0 === 1 ? (tr.viaL3 ? 3 : 2) : l0 >= 3 ? (tr.downTo || 2) : ((tr.forceStage || ((tr.l2N || 0) + 1) % 2 === 1) && eng.levels >= 3 ? 3 : 1); if (tg !== 3 && !this.mainTime[tg]) { const lb = this.liftLandingBusy(tr, tg); if (lb) { tr.wantLift = false; this._lapHold(tr); tr.lastWhy = `holding off the lift: L${tg} landing busy (${lb})`; } } if (tg !== 3 && this.mainTime[tg]) { tr.wantLift = false; this._lapHold(tr); tr.lastWhy = `holding off the lift: L${tg} main under track time (${this.mainTime[tg]})`; if (!tr.liftDefer) { tr.liftDefer = true; this.say(`${tr.sym}: holding in the clear on L${l0} — L${tg} main is under track time`); } } else tr.liftDefer = false; }   /* [R36c] never board the lift toward a main under track time: hold on the current level / in staging instead of standing on the lift deck */ if (tr.wantLift && tr.loopHeld) { const loco = cut.cars.find(x => x.addr === tr.addr), bo = this._backOut(tr, cut, loco); const busy = !bo ? 'no back-out path' : Math.abs(cut.v) > 0.05 ? 'still moving' : this._entryBusy(tr, cut) || (this.occ[bo.blk] && [...this.occ[bo.blk]].some(c => c !== cut)) ? `${bo.blk} occupied` : (eng.reserve[bo.blk] && eng.reserve[bo.blk] !== tr.sym) ? `${bo.blk} reserved for ${eng.reserve[bo.blk]}` : null;
          if (busy) { tr.wantLift = false; this._lapHold(tr); tr.lastWhy = `holding on the loop: lift free but cannot back out (${busy})`; }
          else { eng.reserve[bo.blk] = tr.sym; eng.reserve['T:' + tr.loopIn] = tr.sym; tr.backup = bo.dist; tr.backOut = true; tr.loopHeld = false; this.say(`${tr.sym}: lift granted — backing out of the loop (${bo.dist.toFixed(0)} in onto ${bo.blk}) for the landing`); } }   /* [CHOCO-LAP2R] reverse out, never forward round the loop */
        if (tr.wantLift) { tr.holdT = 0; tr.landHold = false; tr.lapDist = 0; tr.liftN = (tr.liftN || 0) + 1; }
      } }
    this._stop(tr, th, cut, dir, stopAt, why, dt);
  }
  /* deadlock prevention for opposing moves: two trains each held >15 s by the other -> the lower-priority
     one backs clear (into the siding / block behind it) and waits for the meet. */
  /* [MEET 2026-10-18] lift-trip window (track-warrant rule for the single-track lift between the level loops): a through train may take the
     lift onto level nxt only when no opposing-direction through train is on nxt or committed to it. Otherwise it holds the main on its own
     level (another lap) — or, from L2, clears up to L3 staging so the opposing train can come through (the inferior train takes the hole).
     Ties go by rule: odd-numbered (eastward, CCW) trains are superior by direction; between equals the train with the lower class waits.
     Returns true when the train was turned away this tick. */
  /* [CHOCO-LAP] continuous running (no timetable, or opt.continuous): the reversing loop keeps trains circulating as before. In a timetable session a
     refused lift trip holds the train at its level's lift landing (stopped before the LN/LS points, visible) and re-asks every tick instead of another lap. */
  _contRun() { const e = this.eng; return !e._ttP || !!(e.opt && e.opt.continuous); }
  /* [CHOCO-LAP2] a refused through train stands on the loop track clear of both lift turnouts and the main, its lift request stays live (re-asked every tick),
     and it keeps no turnout or main block lined while it waits: only the turnouts its own cars foul and the loop block it occupies stay reserved. */
  _loopHold(tr, th, cut, dir, stopAt, t, dt) { const eng = this.eng, oc = eng.occupancy(cut) || {}, own = new Set(Object.keys(oc).map(e => this.blockOf(+e)));
    if (!tr.loopHeld) { const lt = eng.trk[LOOP_TRK[t.level]], ll = lt ? lt.edges.reduce((s, e) => s + eng.E[e].len, 0) : 0; if (cut.len > ll - 1.5 - LOOP_CLR) {   /* [CHOCO-LAP3] head stops 1.5 in short of the far leg; rear must be LOOP_CLR in past the entry leg end (1.1 in track spacing) */ tr.landHold = false; tr.lapDist = 0; (this.holdCap = this.holdCap || []).push([Math.round(eng.t), tr.sym, 'too long for the loop']); this.say(`⚑ ${tr.sym}: ${cut.len.toFixed(1)} in train is too long to stand on ${lt && lt.id} — one extra lap`); return null; }
      tr.loopIn = this._loopEntry(t); }
    for (const k in eng.reserve) { if (eng.reserve[k] !== tr.sym) continue; if (/^T:/.test(k)) { if (eng.fouls(k.slice(2), cut)) continue; } else if (own.has(k)) continue; delete eng.reserve[k]; this.released = (this.released || 0) + 1; }
    for (const M of [this.res, this.prevRes]) if (M) for (const k in M) if (M[k] === tr.sym) delete M[k];   /* [CHOCO-LAP3] drop the dispatcher claims (T:L1-LN in lap3) as well */
    if (!tr.loopHeld) { tr.loopHeld = true; tr.holdWhy = String(tr.lastWhy || 'waiting for the lift').replace(/^holding (at the L\d lift landing|off the lift): /, ''); this.say(`${tr.sym}: holding on the L${t.level} loop ${LOOP_TRK[t.level]} clear of ${t.id} — ${tr.holdWhy}`); }
    return { stopAt, why: `holding on the L${t.level} loop for the lift (${tr.holdWhy})` }; }   /* [CHOCO-LAP6] no early return: drive() goes on to the lap block, so the lift is re-asked, the cap timed and the back-out granted every tick (lap5: only re-asked when another stop broke the look-ahead -> 1117/1547 s holds) */
  /* [CHOCO-LAP3] the entry turnout must be free (no foreign reservation, claim or fouling cut) and no train may be on, or bound for, this level's landing via the lift */
  _entryBusy(tr, cut) { const eng = this.eng, k = 'T:' + tr.loopIn, T = eng.T[tr.loopIn], lv = T && T.level; if (!T) return 'no entry turnout';
    const rv = eng.reserve[k]; if (rv && rv !== tr.sym) return `${tr.loopIn} reserved for ${rv}`;
    for (const M of [this.res, this.prevRes]) if (M && M[k] && M[k] !== tr.sym && this.trains.some(o => o.sym === M[k])) return `${tr.loopIn} claimed by ${M[k]}`;
    const fc = eng.cuts.find(c => c !== cut && eng.fouls(tr.loopIn, c)); if (fc) return `${tr.loopIn} fouled by ${eng.cutName(fc)}`;
    for (const o of this.trains) { if (o === tr) continue; const oc = this.cutOf(o); if (oc && this.onLift(o) && (eng.lift.moving ? (o.nextLv === lv || o.downTo === lv) : Math.round(eng.lift.level) === lv)) return `${o.sym} coming off the lift onto L${lv}`; }
    if (eng.lift && eng.lift.moving && eng.lift.to === lv) return `lift moving to L${lv}`;
    return null; }
  _landClaim(me, dl) { const eng = this.eng, ks = ['T:L' + dl + '-LN', 'T:L' + dl + '-LS'];
    for (const M of [this.res, this.prevRes]) if (M) for (const k of ks) if (M[k] && M[k] !== me.sym && this.trains.some(o => o.sym === M[k])) return `claimed by ${M[k]}`;
    for (const o of this.trains) { if (o === me || !o.lift) continue; const c = this.cutOf(o); if (!c || this.onLift(o)) continue; if (Math.round(eng.edgeLevel(c.path[0].e)) !== dl) continue; if (o.loopHeld) return `held for the lift by ${o.sym} (loop)`; if (o.wantLift || o.backOut || o.backup > 0) return `wanted by ${o.sym} for the lift`; }
    return null; }
  _loopEntry(t) { return t.id.replace(/-L([NS])$/, (m, x) => '-L' + (x === 'N' ? 'S' : 'N')); }
  /* [CHOCO-LAP2R] distance the train must shove back so its head clears the entry turnout's points by 3 in, and the main block it backs onto */
  _backOut(tr, cut, loco) { const eng = this.eng, d = -(loco.fwd || 1), A = eng.ahead(cut, d, cut.len + 140); let seenLeg = false;
    for (let i = 0; i < A.length; i++) { const lg = eng.legOf[A[i].e]; if (lg && lg[0].id === tr.loopIn) seenLeg = true; else if (seenLeg) return { dist: A[i].from + cut.len + 3, blk: this.blockOf(A[i].e) }; }
    return null; }
  _boAbort(tr) { if (!tr.backOut) return; tr.backOut = false; tr.meetWait = 3; tr.wantLift = false; this._lapHold(tr); this.say(`${tr.sym}: back-out stopped — holding on the loop`); }   /* [CHOCO-LAP2R] */
  _lapHold(tr) { if (this._contRun() || tr.fromAD) { tr.lapDist = 300; return; } tr.lapDist = LAP_REQ + 1; tr.landHold = true; }
  superior(a, b) { if (a.cw !== b.cw && a.cw !== undefined && b.cw !== undefined) return !a.cw; return a.prio < b.prio || (a.prio === b.prio && a.addr < b.addr); }
  liftWindow(tr, cut) { const eng = this.eng; const cur = Math.round(eng.edgeLevel(cut.path[0].e));
    if (cur === 1 && tr.tt && !tr.backTo) tr.viaL3 = this._lvClosed(2); /* [CHOCO-DETOUR3] */ let nxt = cur === 1 ? (tr.viaL3 ? 3 : 2) : (eng.levels >= 3 && ((tr.l2N || 0) + 1) % 2 === 1 ? 3 : 1);
    if (nxt !== 3 && this.opposed(tr, nxt)) {
      if (cur === 2 && eng.levels >= 3) { nxt = 3; tr.forceStage = true; if (!tr.dirHeld) { tr.dirHeld = true; this.say(`Dispatcher: ${tr.sym}, opposing traffic on L1 — go up to L3 staging and hold for the meet`); } }
      else { tr.wantLift = false; this._lapHold(tr); tr.nextLv = undefined; tr.meets = (tr.meets || 0) + 1; if (!tr.dirHeld) { tr.dirHeld = true; this.say(this._contRun() ? `Dispatcher: ${tr.sym}, hold the L${cur} main (another lap) — opposing traffic on L${nxt}` : `Dispatcher: ${tr.sym}, hold at the L${cur} lift landing — opposing traffic on L${nxt}`); } if (!this._contRun()) tr.lastWhy = `holding at the L${cur} lift landing: opposing traffic on L${nxt}`; return true; } }
    else tr.dirHeld = false;
    if (tr.backTo) nxt = tr.backTo; /* [CHOCO-BACK] */ tr.nextLv = nxt; return false; }
  /* fallback for a meet the window did not prevent (two through trains each held by the other > 15 s): no reversing on the main — the
     inferior train by rule is cleared off the layout to staging (as the dispatcher's 'take it to staging') and comes back when its level is clear. */
  checkMeet(tr, cut) { if (tr.held < 15 || !tr.lastWhy) return;
    for (const o of this.trains) { if (o === tr) continue; const oc = this.cutOf(o); if (!oc) continue;
      const mineBlk = String(o.lastWhy || '').includes(this.eng.cutName(cut)) || String(o.lastWhy || '').includes(tr.sym);
      const hisBlk = String(tr.lastWhy).includes(this.eng.cutName(oc)) || String(tr.lastWhy).includes(o.sym);
      if (hisBlk && mineBlk && o.held > 15) { let lo = this.superior(tr, o) ? o : tr; if (this.onLift(lo)) lo = lo === tr ? o : tr; if (this.onLift(lo)) return;
        const hi = lo === tr ? o : tr, lc = this.cutOf(lo), eng = this.eng; eng.cuts.splice(eng.cuts.indexOf(lc), 1); this.trains.splice(this.trains.indexOf(lo), 1);
        (this.staged = this.staged || []).push({ tr: lo, cut: lc, home: lc.path[0].e, level: Math.round(eng.edgeLevel(lc.path[0].e)), meetWith: hi.sym }); for (const k in eng.reserve) if (eng.reserve[k] === lo.sym) delete eng.reserve[k];
        lo.held = 0; lo.lastWhy = null; hi.held = 0; this.meetStaged = (this.meetStaged || 0) + 1;
        this.say(`Dispatcher: ${lo.sym}, take it to staging for the meet with ${hi.sym}`); return; } }
    /* [R36] circular wait of 3+ trains (NS 165 -> CSX Y191 -> BNSF ethanol -> NS 165 around the L1/L2 loops, sim min 238-254): follow who-waits-for-whom;
       if the chain closes and everyone has been held 2+ min, the lowest-priority train not on the lift goes to staging, same as a meet */
    if (tr.held > 120) { const eng = this.eng, waitsFor = t => this.trains.find(o => o !== t && t.lastWhy && (String(t.lastWhy).includes(o.sym) || (this.cutOf(o) && String(t.lastWhy).includes(eng.cutName(this.cutOf(o))))));
      const ring = [tr]; let x = waitsFor(tr);
      while (x && x.held > 120 && !ring.includes(x) && ring.length < 8) { ring.push(x); x = waitsFor(x); }
      if (x === tr && ring.length >= 3) { const cand = ring.filter(t => !this.onLift(t)); if (!cand.length) return; let lo = cand[0]; for (const t of cand) if (this.superior(lo, t)) lo = t;
        const lc = this.cutOf(lo); eng.cuts.splice(eng.cuts.indexOf(lc), 1); this.trains.splice(this.trains.indexOf(lo), 1);
        (this.staged = this.staged || []).push({ tr: lo, cut: lc, home: lc.path[0].e, level: Math.round(eng.edgeLevel(lc.path[0].e)), meetWith: ring.filter(t => t !== lo)[0].sym }); for (const k in eng.reserve) if (eng.reserve[k] === lo.sym) delete eng.reserve[k];
        for (const k in this.res) if (this.res[k] === lo.sym) delete this.res[k];
        for (const t of ring) { t.held = 0; } lo.lastWhy = null; this.cycleBreaks = (this.cycleBreaks || 0) + 1;
        this.say(`Dispatcher: ${lo.sym}, clear to staging; ${ring.length} trains were waiting on each other (${ring.map(t => t.sym).join(' -> ')})`); return; } }
    // single train blocked by a standing local for a long time: no deadlock, keep waiting
  }
  _backup(tr, th, cut, loco, dt) { const eng = this.eng; const dir = -(loco.fwd || 1); const ob = eng.obstacle(cut, dir, 20);
    if ((ob.what && ob.dist < 3) || (ob.what === 'end' && ob.dist < 3)) { tr.backup = 0; tr.meetWait = 25; this._boAbort(tr); th.speed = 0; this.say(`${tr.sym}: in the clear, holding for the meet`); return; }
    { const A = eng.ahead(cut, dir, 10);   /* [R38] a train backing into the clear for a meet lines (or stops for) the trailing points behind it: CSX phosphate backed through L1-15 lined for P22's warrant (runthrough min 115) */
      for (let i = 1; i < A.length; i++) { const lg = eng.legOf[A[i].e]; if (!lg || A[i - 1].e === lg[0].stem || lg[0].state === lg[1]) continue; const rv = eng.reserve['T:' + lg[0].id];
        eng._thCtx = tr.sym + ':backup'; if ((rv && rv !== tr.sym) || !eng.throwTurnout(lg[0].id, lg[1], 'ai')) { tr.backup = 0; tr.meetWait = 25; this._boAbort(tr); th.speed = 0; this.say(`${tr.sym}: holding short of ${lg[0].id} (lined for ${rv || 'a standing cut'})`); return; } } }
    th.dir = -1; th.speed = 6; tr.backup -= Math.abs(cut.v) * dt; if (tr.backup <= 0) { th.speed = 0; if (tr.backOut) { tr.backOut = false; tr.meetWait = 5; th.dir = 1; this.say(`${tr.sym}: clear of ${tr.loopIn}, reversing direction — ahead onto the lift`); } else { tr.meetWait = 25; this.say(`${tr.sym}: in the clear, holding for the meet`); } } }
  /* [R38] the lift's landing on level lv is free for tr: no other cut on, and no foreign reservation of, the blocks within 2 edges of the
     lift ends on that level. Used before boarding so a train is never delivered onto a level where it must stand on the deck (NS 211 stood
     10 min on the lift at L2 behind local R60 on B:T28). */
  /* [R38] a train on the lift (leaving for its level) holds the landing turnouts on its arrival level until it is off the lift (NS 211 stood 67 s on the lift at L2: BNSF grain took L2-LN while the lift travelled) */
  holdLanding(tr, lv) { const eng = this.eng, en = eng.lift && eng.lift.ends && eng.lift.ends[String(lv)]; if (!en) return; tr.landRes = [];
    let fr = [...en], seen = new Set(); for (let h = 0; h < 2; h++) { const nx = []; for (const n of fr) for (const e of eng.inc[n] || []) { if (seen.has(e) || e === eng.lift.edge) continue; seen.add(e); const E = eng.E[e]; nx.push(E.a === n ? E.b : E.a); } fr = nx; }
    for (const e of seen) { const lg = eng.legOf[e]; if (!lg) continue; const k = 'T:' + lg[0].id; if (!eng.reserve[k] && !eng.cuts.some(c => c !== this.cutOf(tr) && eng.fouls(lg[0], c))) { eng.reserve[k] = tr.sym; tr.landRes.push(k); } } (this._held = this._held || []).push(tr); }
  dropLanding() { const eng = this.eng; this._held = (this._held || []).filter(tr => { if (this.trains.includes(tr) && this.onLift(tr)) return true; const c = this.trains.includes(tr) && this.cutOf(tr); for (const k of tr.landRes || []) if (eng.reserve[k] === tr.sym && !(c && eng.fouls(eng.T[k.slice(2)], c))) delete eng.reserve[k]; tr.landRes = null; return false; }); }   /* [R38] the landing hold ends as soon as the train is off the lift (or gone to staging); its own route claims cover the rest */
  liftLandingBusy(tr, lv) { const eng = this.eng, en = eng.lift && eng.lift.ends && eng.lift.ends[String(lv)]; if (!en) return null; const own = this.cutOf(tr);
    let fr = [...en], seen = new Set(); for (let h = 0; h < 2; h++) { const nx = []; for (const n of fr) for (const e of eng.inc[n] || []) { if (seen.has(e) || e === eng.lift.edge) continue; seen.add(e); const E = eng.E[e]; nx.push(E.a === n ? E.b : E.a); } fr = nx; }
    for (const e of seen) { const b = this.blockOf(e), u = this.occ && this.occ[b]; if (u && [...u].some(c => c !== own)) return `${b} occupied by ${[...u].filter(c => c !== own).map(c => eng.cutName(c)).join(', ')}`; const r = eng.reserve[b]; if (r && r !== tr.sym) return `${b} reserved for ${r}`;
      const lg = eng.legOf[e]; if (lg) { const T = lg[0], rt = eng.reserve['T:' + T.id]; if (rt && rt !== tr.sym) return `${T.id} reserved for ${rt}`; const fc = eng.cuts.find(c => c !== own && eng.fouls(T, c)); if (fc) return `${T.id} fouled by ${eng.cutName(fc)}`; } }   /* [R38] a landing turnout reserved or fouled counts as busy (CSX phosphate stood 62 s on the lift lining L2-LS fouled by NS 165) */
    return null; }
  opposed(tr, lv) { if (tr.cw === undefined) return false; const eng = this.eng;   // [DIR] another-direction through train on level lv (or committed to it)
    for (const o of this.trains) { if (o === tr || o.cw === undefined || o.cw === tr.cw) continue; const c = this.cutOf(o); if (!c) continue;
      if ((o.wantLift && o.nextLv === lv) || Math.round(eng.edgeLevel(c.path[0].e)) === lv) return true; }
    for (const st of this.staged || []) if (st.tr.cw !== undefined && st.tr.cw !== tr.cw && st.level === lv) return true; return false; }
  /* [R36] who is fouling turnout id (so a 'lining' hold names its blocker and checkMeet can see a head-on at the lift throat) */
  fouler(id, cut) { const eng = this.eng; const c = eng.cuts.find(c => c !== cut && eng.fouls(eng.T[id], c)); if (!c) return ''; const t = this.trains.find(t => this.cutOf(t) === c); return ` (fouled by ${t ? t.sym : eng.cutName(c)})`; }
  liftBusy(cut) { const l = this.eng.lift; return this.eng.cuts.some(c => c !== cut && this.eng.occupancy(c)[l.edge]); }
  onLift(tr) { const c = this.cutOf(tr); return c && this.eng.lift && !!this.eng.occupancy(c)[this.eng.lift.edge]; }
  _stop(tr, th, cut, dir, stopAt, why, dt) {
    const eng = this.eng; const lim = this.limitAhead(cut, dir); const a = eng.decelIps(cut) * 0.7;   // [PHYSICS] plan the stop with this train's real braking
    if (why && /occupied by|ahead/.test(why)) { const mv = eng.cuts.some(c => c !== cut && Math.abs(c.v || 0) > 0.05 && why.includes(eng.cutName(c))); if (mv) stopAt = Math.max(0, stopAt / 2 - 1); }   /* [R36] head-on guard: when the cut in the way is itself moving, assume it is closing and take only half the gap (CSX phosphate and NS 211 met head-on on B:T30 at sim min 163, both derailed, the L2 throat gridlocked for the rest of the session) */
    const vStop = Math.sqrt(Math.max(0, 2 * a * Math.max(0, stopAt - 0.3)));
    let vAh = Infinity; try { const vs = Math.abs(cut.v); for (const q of eng.ahead(cut, dir, Math.max(40, vs * vs / (2 * a) + 20)).slice(1)) { const e = eng.E[q.e]; if (!e) continue; let l2 = LIMIT[e.type] || 10; const lg = eng.legOf[q.e]; if (lg && lg[1] === 'D') l2 = Math.min(l2, /#4/.test(lg[0].part) ? 10 : 15);
      vAh = Math.min(vAh, Math.sqrt(IPS(l2) ** 2 + 2 * a * Math.max(0, q.from - 0.5))); } } catch (e) {}   // [PHYSICS] brake ahead of lower limits (lift, sidings, diverging routes)
    const v = Math.min(IPS(Math.min(tr.vmax, lim)), vStop, vAh); th.dir = 1; th.speed = MPH(v) < 0.8 ? 0 : MPH(v);
    if (th.speed === 0 && why) { tr.held += dt; if (tr.held > 8 && tr.lastWhy !== why) { const S = tr._saidW = tr._saidW || {}; if (!(this.eng.t - (S[why] ?? -1e9) < 120)) this.say(`${tr.sym} holding: ${why}`); S[why] = this.eng.t; tr.lastWhy = why; }   /* [CHOCO-LAP7] a held train re-asks every tick now; say each reason at most once per 2 min */ this.checkMeet(tr, cut); } else { tr.held = 0; }
  }
  limitAhead(cut, dir) { const eng = this.eng; let lim = 40; for (const p of cut.path) { const e = eng.E[p.e]; lim = Math.min(lim, LIMIT[e.type] || 10); const lg = eng.legOf[p.e]; if (lg && lg[1] === 'D') lim = Math.min(lim, 15); }
    for (const a of eng.ahead(cut, dir, 14)) { const e = eng.E[a.e]; lim = Math.min(lim, LIMIT[e.type] || 10); const lg = eng.legOf[a.e]; if (lg && lg[1] === 'D') lim = Math.min(lim, /#4/.test(lg[0].part) ? 10 : 15); }
    return lim; }
}

/* executes a planner move list (from build_ops.py) with a real loco in the engine: autopilot drives, lines turnouts, couples, uncouples */
class PlanExec {
  constructor(eng, job, steps, opts = {}) { this.eng = eng; this.job = job; this.steps = steps || []; this.i = 0; this.phase = 'start'; this.done = false; this.fail = null; this.wait = 0; this.vmax = opts.vmax || 8; this.log = []; eng.ai.execs.push(this); const c = this.cut(); this.nStart = c ? c.cars.length : 0; }
  cut() { return this.eng.locoCut(this.job.addr); }
  say(t) { this.eng.say(`🤖 ${this.job.id}: ${t}`, 'ai'); this.log.push(t); }
  tick(dt) {
    if (this.done || this.fail) return; const eng = this.eng; const th = eng.throttles[this.job.addr]; let cut = this.cut(); if (!cut) return this.failed('lost the loco');
    if (cut.derailed) return this.failed('derailed');
    if (this.wait > 0) { this.wait -= dt; th.speed = 0; return; }
    const st = this.steps[this.i]; if (!st) { this.done = true; th.speed = 0; this.releaseAll(); { const lv = (eng.D.jobs.find(x => x.id === this.job.id) || {}).level; if (eng.ai && eng.ai.releaseMain && lv) eng.ai.releaseMain(lv, this.job.id); } this.say(this.steps.length ? 'work complete' : 'no move plan (planner failed for this session)');
      if (this.steps.length && ((eng.D.jobs.find(x => x.id === this.job.id) || {}).depart)) {
        // [NOSTEAL] never depart with another job's delivered set-outs coupled at the far end: leave them standing on their spot
        { const it = {}; for (const ind of eng.D.industries) it[ind.id] = ind.tid; const li = cut.cars.findIndex(x => x.addr === this.job.addr);
          const at = car => { let o = 0; for (const x of cut.cars) { if (x === car) break; o += x.len; } return eng.e2t[eng.locate(cut, o + car.len / 2).e]; };
          const mine = car => !(car.status === 'setout' && car.ind && (car.job !== this.job.id || at(car) === it[car.ind]));   // delivered: another job's, or ours already on its industry track
          let a = 0; while (a < li && !mine(cut.cars[a])) a++; let b = 0; while (b < cut.cars.length - 1 - li && !mine(cut.cars[cut.cars.length - 1 - b])) b++;
          if (a > 0) { eng.uncouple(cut, a, 'ai'); cut = this.cut(); this.say(`left ${a} delivered car(s) standing on their spot`); }
          if (b > 0) { eng.uncouple(cut, cut.cars.length - b, 'ai'); cut = this.cut(); this.say(`left ${b} delivered car(s) standing on their spot`); } } const _bk = ((eng.D.session || {}).back || {})[this.job.id]; if (_bk && eng.ai) { /* [CHOCO-BACK] */ for (const k in eng.reserve) if (eng.reserve[k] === this.job.id) delete eng.reserve[k]; const lc = cut.cars.find(x => x.addr === this.job.addr); if (/^P90/.test(this.job.id) && !this._lwGo) { /* [CHOCO-LOCALWINDOW] a Nutrien local that has finished waits on its siding until the dispatcher gives it a window (see AI tick) */ lc.train = this.job.id; (eng._lw = eng._lw || []).push({ ex: this, bk: _bk, t0: eng.t, next: eng.t }); this.say(`work complete - ${_bk} waits on ${this.job.stops[0].tid} for a dispatcher window`); return; } lc.ai = true; lc.train = _bk; eng.ai.trains.push({ sym: _bk, addr: this.job.addr, prio: 4, lift: true, laps: 0, state: 'run', wantLift: true, held: 0, vmax: 25, backTo: 1, nextLv: 1, lifted: false, liftT: 0, lapDist: 0 }); this.say(`work complete - running back as ${_bk} (lift to L1 Marsden)`); } else { eng.cuts.splice(eng.cuts.indexOf(cut), 1); (eng.departed = eng.departed || []).push(cut); for (const k in eng.reserve) if (eng.reserve[k] === this.job.id) delete eng.reserve[k]; this.say('departed (lift / yard) - tracks released'); if (((eng.D.jobs.find(x => x.id === this.job.id) || {}).loco) === 'mp15') yardPark(eng, cut.cars.find(x => x.loco)); /* [CHOCO-YARDRES] */ } }   // [START] timetable departure
      return; }
    const loco = cut.cars.find(x => x.addr === this.job.addr);
    const li = cut.cars.indexOf(loco);
    // the planner's 'end' a/b of track frm -> direction along the cut
    const trk = eng.trk[st.frm];
    if (this.phase === 'start') {
      { const lv = (eng.D.jobs.find(x => x.id === this.job.id) || {}).level; const ai = eng.ai;   // [GRANT] dispatcher track time on the main
        /* [RELEASE 2026-10-18] a step also needs the main when it starts, ends or runs on a main track, or the crew's cut still stands on one
           (fouls_main alone missed T28-type moves: the local released the main while working on it, which the old held-everywhere through trains hid) */
        const onMain = st.fouls_main || [st.frm, st.to].concat(st.via || []).some(t => eng.trk[t] && eng.trk[t].type === 'main') || Object.keys(eng.occupancy(cut)).some(e => { const t = eng.trk[eng.e2t[+e]]; return t && t.type === 'main'; });
        if (onMain && lv && ai && ai.grantMain) { if (!ai.grantMain(lv, this.job.id)) { th.speed = 0; this.wait = 2; if (!this.askedMain) { this.askedMain = true; this.say(`requesting L${lv} main track time`); } return; } this.askedMain = false; }
        else if (lv && ai && ai.mainTime && ai.mainTime[lv] === this.job.id) ai.releaseMain(lv, this.job.id); }
      // which cut end points to track end st.end?
      const node = st.end === 'a' ? trk.a : trk.b; const nx = eng.N[node];
      const h = eng.posAt(cut, cut.len), t = eng.posAt(cut, 0);
      this.dir = Math.hypot(h.x - nx.x, h.y - nx.y) < Math.hypot(t.x - nx.x, t.y - nx.y) ? 1 : -1;   // +1 = toward cut head
      { // prefer topology: the direction whose path ahead reaches the step's first turnout / target track
        const tgt = new Set(eng.trk[st.to].edges); for (const [id] of st.turnouts.slice(0, 1)) { const T = eng.T[id]; [T.legN, T.legD].forEach(e => tgt.add(e)); }
        const hits = [1, -1].map(dd => { const A = eng.ahead(cut, dd, 400); const k = A.findIndex(a => tgt.has(a.e)); return k < 0 ? 1e9 : A[k].from; });
        if (hits[0] < 1e9 || hits[1] < 1e9) this.dir = hits[0] <= hits[1] ? 1 : -1; }
      this.thDir = undefined;
      // [FETCH] the planner's move starts on st.frm with cars standing there, but the loco is elsewhere and short of cars: go couple them first
      if (st.kind === 'move' && !st.fetch) { const need = st.cars.reduce((n, t) => n + (t === 'X' ? this.xc() : 1), 0), have = cut.cars.length - 1;
        const lt = eng.e2t[eng.locate(cut, cut.cars.slice(0, li).reduce((o, x) => o + x.len, 0) + loco.len / 2).e];
        if (need > have && lt && lt !== st.frm && eng.cuts.some(c => c !== cut && !c.cars.some(x => x.loco) && Object.keys(eng.occupancy(c)).some(e => eng.e2t[e] === st.frm))) {
          const sets = routeSets(eng, lt, st.frm);
          const conflict = sets && sets.some(([id, v]) => sets.some(([id2, v2]) => id2 === id && v2 !== v));   /* [R32] a route that takes one turnout both ways needs a reversal: no blind fetch */
          if (sets && !conflict) { const F = eng.trk[st.frm], L = eng.trk[lt]; const pa = eng.posAt(cut, cut.len / 2), A = eng.N[F.a], B = eng.N[F.b];
            const d2 = (n1, n2) => Math.hypot(eng.N[n1].x - eng.N[n2].x, eng.N[n1].y - eng.N[n2].y); const endLt = Math.min(d2(L.a, F.a), d2(L.a, F.b)) <= Math.min(d2(L.b, F.a), d2(L.b, F.b)) ? 'a' : 'b';
            const entry = Math.hypot(pa.x - A.x, pa.y - A.y) < Math.hypot(pa.x - B.x, pa.y - B.y) ? 'a' : 'b';
            this.steps.splice(this.i, 0, { kind: 'pull', frm: lt, to: st.frm, entry, end: endLt, cars: Array(need - have).fill('S'), turnouts: sets, fetch: true });
            st.fetch = true; this.say(`fetching ${need - have} car(s) from ${st.frm} before the move`); return; } } }
      // cars between loco and the exit end move along; cars behind beyond k stay -> uncouple
      const aheadN = this.dir > 0 ? cut.cars.length - 1 - li : li;
      const nMove = st.cars.reduce((n, t) => n + (t === 'X' ? this.xc() : 1), 0);   // X = the through block (several cars)
      const behindIdx = this.dir > 0 ? li - (st.kind === 'move' ? nMove - aheadN : 0) : li + 1 + (st.kind === 'move' ? nMove - aheadN : 0);
      if (st.kind === 'move' && behindIdx > 0 && behindIdx < cut.cars.length) {
        // [LEAVECLEAR] never leave cars fouling a turnout: shove the whole cut back (away from the exit end) until the cars that stay are clear
        const lvSide = li < behindIdx ? 'B' : 'A'; const fid = eng.leftFouls(cut, behindIdx, lvSide);
        if (fid && (this.leaveN || 0) < 3) { this.phase = 'leave'; this.leaveT = fid; this.leaveIdx = behindIdx; this.leaveSide = lvSide; this.leaveD = 0; this.thDir = undefined; this.say(`setting the cars that stay clear of ${fid}`); return; }
        if (fid) this.say(`WARNING: cars left fouling ${fid}`);
        this.leaveN = 0; eng.uncouple(cut, behindIdx, 'ai'); this.wait = 2.5; cut = this.cut(); }
      for (const [id, leg] of st.turnouts) if (eng.T[id].state !== leg && this.ownOn(cut, id)) { alignUnder(eng, cut); this.phase = 'clear'; this.clearT = id; this.clearD = 0;
        { // clear toward the cut end that already sits in the step's from-track (away from the points)
          const endTrk = dd => { const A = eng.ahead(cut, dd, 2); return A.length ? eng.e2t[A[0].e] : null; };
          const f1 = endTrk(1) === st.frm, f2 = endTrk(-1) === st.frm; if (this.flipDir) { this.dir = this.flipDir; this.thDir = undefined; } else if (f1 !== f2) { this.dir = f1 ? -1 : 1; this.thDir = undefined; } } this.say(`pulling clear of ${id}`); return; }
      /* [RELEASE 2026-10-18] a turnout on this move still held by a through train (it is approaching or passing it): wait for it to clear
         instead of re-lining it under the train. Through trains now release turnouts block by block, so this is a short wait; if it is
         not (the through train is itself held), the dispatcher's work window sends that train to staging after 45 s (blockedBy). */
      { const ai = eng.ai, ck = ai && ai.res && st.turnouts.map(([id]) => 'T:' + id).find(k => { const w = ai.res[k]; if (!w || w === this.job.id) return false; const t = ai.trains.find(x => x.sym === w), c = t && ai.cutOf(t); return !!(c && Math.abs(c.v || 0) > 0.05); });   /* [R38] a moving through train has this turnout in its look-ahead claim (not yet reserved): taking the warrant now re-lined L1-15 inside CSX phosphate's braking distance (runthrough min 115) */
        if (ck) { th.speed = 0; if (this.saidRes !== ck) { this.say(`holding for ${ai.res[ck]} approaching ${ck.slice(2)}`); this.saidRes = ck; } this.wait = 2; return; } }
      { const ai = eng.ai, fk = st.turnouts.map(([id]) => 'T:' + id).find(k => eng.reserve[k] && eng.reserve[k] !== this.job.id && ai && ai.trains.some(t => t.sym === eng.reserve[k]));
        if (fk) { const w0 = ai.trains.find(t => t.sym === eng.reserve[fk]); if (w0 && ai.onLift(w0)) { for (const k in eng.reserve) if (eng.reserve[k] === w0.sym) delete eng.reserve[k]; } }   /* a train standing on the lift (held there for our track time) gives up its claim */
        if (fk && eng.reserve[fk]) { const who = eng.reserve[fk], tr = ai.trains.find(t => t.sym === who), bc = tr && ai.cutOf(tr); if (bc) { this.blockedBy = bc; this.blockT = (this.blockT || 0) + 2; }
          if (this.saidRes !== fk) { this.say(`holding for ${who} to clear ${fk.slice(2)}`); this.saidRes = fk; } this.wait = 2; return; } this.saidRes = null; }
      // track warrant for this move: through trains will not enter these turnouts / tracks until the move is done
      { /* [CHOCO-ROUTELOCK v3: yardmaster grants ladder zones E (L1-03..09, Marsden body) / W (L1-10, L1-14, CCF/TL leads); a move takes every zone it needs at once; FIFO per zone; sticky clear-first call] */
        const _Z = { E: ['L1-03','L1-04','L1-05','L1-06','L1-07','L1-08','L1-09','L1-16','L1-17'], W: ['L1-10','L1-14','L1-15'] } /* [CHOCO-YARDMUTEX] rev6i: new east crossover L1-16/17 in the Marsden zone; L1-15 (YY4/T16 lead, shared with CJOB-S) in the west zone */, _LAD = _Z.E.concat(_Z.W), _ZN = { E: 'the Marsden ladder', W: 'the west (CCF/TL) leads' };
        const _ex = id => (eng.ai && eng.ai.execs || []).find(x => x.job.id === id && x !== this && !x.done && !x.fail); const _need = st.turnouts.map(([id]) => id);
        const _nz = Object.keys(_Z).filter(z => _Z[z].some(id => _need.includes(id))); if ([st.frm, st.to].concat(st.via || []).includes('T7') && !_nz.includes('W')) _nz.push('W'); /* [CHOCO-YARDMUTEX] lead T7 opens west onto the CCF/TL leads: a move on T7 also takes the W zone (gates-m1: YARDA T7->T16 vs CJOB-S at L1-15) */ let _lk = null, _who = null;
        eng._lad = eng._lad || {}; eng._ladQ = eng._ladQ || {}; const _ZT = { E: ['T7'], W: ['T10', 'T23', 'T7'] }; /* [CHOCO-YARDMUTEX] a crew standing on lead T7 keeps both zones (gates-m8a: CJOB-S2 stood on T7 while YARDA was granted W and pulled from T7 -> YARDA held mid-move at L1-04, its next moves ran from the wrong spot and left cars fouling L1-16) */ /* [v3b] a crew standing on the W lead tracks keeps that zone (gates33: CJOB-S got W while CLNA120 stood on T10 -> lead gridlock) */ const _fz = (c, z) => c && (_Z[z].some(id => eng.T[id] && eng.fouls(id, c)) || Object.keys(eng.occupancy(c)).some(e => _ZT[z].includes(eng.e2t[e])));
        if (eng._ladPri && !_ex(eng._ladPri) && eng._ladPri !== this.job.id) eng._ladPri = null;
        for (const z of _nz) { eng._ladQ[z] = (eng._ladQ[z] || []).filter(id => id === this.job.id || _ex(id));
          const g = eng._lad[z] && _ex(eng._lad[z]); if (g) { const gc = g.cut && g.cut(); if ((g.warrant && _Z[z].some(id => g.warrant.includes('T:' + id))) || _fz(gc, z) || (eng._ladAt && eng._ladAt[z] && eng._ladAt[z].j === g.job.id && eng._ladAt[z].i === g.i)) { _lk = _ZN[z]; _who = g.job.id; break; }   /* [CHOCO-YARDMUTEX follow-up] exclusive grant: a zone granted for a move stays held until that move is done (gates-t5 2612: W granted to CLNA120 for T41->T7, whose warrant names no W turnout, and re-granted to CJOB-S the same tick) */ } }
        if (!_lk && _nz.length) { /* [LADCLR] a crew standing in my route is called ahead to clear it (the first call sticks until that crew has moved) */ const _trk = new Set([st.to].concat(st.via || []));
          const _bl = (eng.ai.execs || []).find(x => x !== this && !x.done && !x.fail && (() => { const c = x.cut && x.cut(); return c && (_need.some(id => eng.T[id] && eng.fouls(id, c)) || Object.keys(eng.occupancy(c)).some(e => _trk.has(eng.e2t[e]))); })());
          if (_bl && eng._ladPri !== this.job.id) { if (!eng._ladPri) eng._ladPri = _bl.job.id; _lk = _ZN[_nz[0]] + ' (' + _bl.job.id + ' clearing my route)'; _who = eng._ladPri; } }
        if (!_lk && eng._ladPri !== this.job.id) for (const z of _nz) { const q = eng._ladQ[z]; const onZ = eng._lad[z] === this.job.id && (_fz(cut, z) || (this.warrant && _Z[z].some(id => this.warrant.includes('T:' + id)))); /* [CHOCO-YARDMUTEX] same 'still holds the zone' test the waiting crew uses (warrant or fouling) - gates-m7L: YARDA yielded E to CJOB-S (next in line) while CJOB-S waited on YARDA's E warrant -> both held */ const _hw = q.length && Object.keys(_Z).some(z2 => z2 !== z && eng._lad[z2] === this.job.id && (eng._ladQ[z2] || []).includes(q[0])); /* [CHOCO-YARDMUTEX] don't yield a zone to a crew that is itself queued for another zone we hold (gates-m9a: YARDA yielded W to CJOB-N2 while CJOB-N2 waited on YARDA's E -> deadlock) */ const _yk = Object.values(eng._ym || {}).includes(this.job.id); /* [CHOCO-YARDMUTEX] the yard-token crew keeps its granted zones between moves of its plan (gates-m9c: YARDA light T9->T7 lost E to CJOB-N2 mid-sequence, later moves ran from the wrong spot -> L1-16 fouled) */ if (!onZ && !_hw && !_yk && q.length && q[0] !== this.job.id) { _lk = _ZN[z]; _who = q[0] + ' (next in line)'; break; } }
        if (!_lk) { const r = _LAD.filter(id => _need.includes(id)).map(id => eng.reserve['T:' + id]).find(r => r && r !== this.job.id && _ex(r)); if (r) { _lk = 'a ladder turnout'; _who = r; } }
        if (!_lk) { const r = _need.filter(id => !_LAD.includes(id)).find(id => { const r = eng.reserve['T:' + id]; return r && r !== this.job.id && _ex(r); }); if (r) { _lk = r; _who = eng.reserve['T:' + r]; } }
        if (_lk) { for (const z of _nz) if (!eng._ladQ[z].includes(this.job.id)) eng._ladQ[z].push(this.job.id); if (this._lkSaid !== _lk) { this._lkSaid = _lk; eng.say(`${this.job.id}: holding - ${_lk} granted to ${_who || 'another crew'}`, 'ai'); } this.wait = 2; return; }
        for (const z of _nz) { if (eng._lad[z] !== this.job.id) eng.say(`${this.job.id}: yardmaster grants ${_ZN[z]}`, 'ai'); eng._lad[z] = this.job.id; (eng._ladAt = eng._ladAt || {})[z] = { j: this.job.id, i: this.i }; eng._ladQ[z] = eng._ladQ[z].filter(id => id !== this.job.id); }
        if (_nz.length) { if (eng._ladPri === this.job.id) eng._ladPri = null; for (const id of _LAD) if (_need.includes(id)) eng.reserve['T:' + id] = this.job.id; } this._lkSaid = null; }
      this.warrant = st.turnouts.map(([id]) => 'T:' + id).concat((st.via || []).map(t => 'B:' + t), ['B:' + st.to]).filter(k => !eng.reserve[k] || eng.reserve[k] === this.job.id);
      for (const k of this.warrant) eng.reserve[k] = this.job.id;
      eng._thCtx = this.job.id + ':warrant'; for (const [id, leg] of st.turnouts) if (!eng.throwTurnout(id, leg, 'ai')) { this.blk = (this.blk || 0) + 1; { const bc = eng.cuts.find(c => c !== cut && eng.fouls(id, c) && c.cars.some(x => x.loco)); if (bc) { this.blockedBy = bc; this.blockT = (this.blockT || 0) + 2; } } if (this.blk > 300) return this.failed(`route blocked: cannot line ${id} (car standing on it)`); this.wait = 2; return; }
      this.blk = 0;
      this.phase = 'go'; this.goal = this.target(st); this.say(`${st.kind} ${st.frm}→${st.to} (${st.cars.length} cars)`); this.wait = Math.max(this.wait, 1.5); return;
    }
    const lo = eng.locoCut(this.job.addr); const ld = lo.cars.find(x => x.addr === this.job.addr);
    if (this.thDir === undefined) this.thDir = this.dir * (ld.fwd || 1);
    this.dir = this.thDir * (ld.fwd || 1);   // cut head may flip when cuts merge; the loco's travel direction does not
    const dirTh = this.thDir;
    // safety: line any trailing-point turnout just ahead of the moving end (planner routes list facing points)
    { const dd = this.phase === 'back' ? -this.dir : this.dir; const A = eng.ahead(lo, dd, 12);
      for (let i = 1; i < A.length; i++) { const lg = eng.legOf[A[i].e]; if (lg && A[i - 1].e !== lg[0].stem && lg[0].state !== lg[1]) { const rv = eng.reserve['T:' + lg[0].id]; if (rv && rv !== this.job.id) { th.speed = 0; this.wait = 2; if (this.saidTr !== lg[0].id) { this.say(`holding: ${lg[0].id} is lined for ${rv}`); this.saidTr = lg[0].id; } return; }   /* [R38] never re-line a trailing turnout a through train holds (P22 threw L1-15 under the approaching CSX phosphate -> runthrough min 53/95) */
        eng._thCtx = this.job.id + ':trail'; eng.throwTurnout(lg[0].id, lg[1], 'ai'); } } }
    if (this.phase === 'leave') {   // [LEAVECLEAR] move away from the exit end until the cars that stay no longer foul
      const dd = -this.dir; const ob = eng.obstacle(lo, dd, 40);
      const still = eng.leftFouls(lo, this.leaveIdx, this.leaveSide);
      if (!still || this.leaveD > 40 || (ob.what && ob.dist < (ob.what !== 'end' && ob.what.cars && ob.what.cars.some(x => x.loco) ? 3 : 1.0))) { th.speed = 0; if (Math.abs(lo.v) < 0.02) { this.phase = 'start'; this.leaveN = (this.leaveN || 0) + 1; } return; }
      th.dir = -dirTh; th.speed = 3; this.leaveD += Math.abs(lo.v) * dt; return;
    }
    if (this.phase === 'yield') {   // [R33] back away from a head-on standoff, then re-run the step
      const dd = -this.dir; const ob = eng.obstacle(lo, dd, 40);
      if (this.yieldD > 24 || (ob.what && ob.dist < (ob.what !== 'end' && ob.what.cars && ob.what.cars.some(x => x.loco) ? 3 : 1.0))) { th.speed = 0; if (Math.abs(lo.v) < 0.02) { this.phase = 'start'; this.wait = 60; } return; }
      th.dir = -dirTh; th.speed = 4; this.yieldD += Math.abs(lo.v) * dt; return;
    }
    if (this.phase === 'clear') {   // our own cut fouls a turnout we must throw: draw back away from the exit end until clear
      const dd = -this.dir; const ob = eng.obstacle(lo, dd, 40); const T = eng.T[this.clearT];
      if (!this.ownOn(lo, this.clearT) || this.clearD > 40 || (ob.what && ob.dist < (ob.what !== 'end' && ob.what.cars && ob.what.cars.some(x => x.loco) ? 3 : 1.0))) { th.speed = 0; if (Math.abs(lo.v) < 0.02) { this.phase = 'start'; this.clearN = (this.clearN || 0) + 1; if (this.clearN > 3) { if (!this.clearFlip) { /* [R33] no room behind: try clearing the other way (through the points onto the other leg / main) */ this.clearFlip = 1; this.clearN = 0; this.flipDir = -this.dir; this.say(`no room to clear ${T.id} that way, trying the other side`); return; } return this.failed(`cannot clear ${T.id}`); } } return; }
      th.dir = -dirTh; th.speed = 3; this.clearD += Math.abs(lo.v) * dt; return;
    }
    if (this.phase === 'go') {
      const ob = eng.obstacle(lo, this.dir, 120);
      let rem = this.remaining(lo, this.dir, this.goal);
      const foreign = ob.what && ob.what !== 'end' && ob.what.cars && ob.what.cars.some(x => x.loco);
      if (foreign) { rem = Math.min(rem === null ? 1e9 : rem, ob.dist - 2.0); if (ob.dist < 4.5) { th.speed = 0; this.blockedBy = ob.what; this.blockT = (this.blockT || 0) + dt;
        { /* [R33] head-on standoff: both crews holding for each other > 60 s -> the one without the main track time backs away 24 in */ const X = eng.ai.execs || [], oe = X.find(x => x !== this && !x.done && !x.fail && x.cut() === ob.what), lv = (eng.D.jobs.find(x => x.id === this.job.id) || {}).level;
          if (oe && oe.blockedBy === lo && this.blockT > 60 && (oe.blockT || 0) > 60 && !(eng.ai.mainTime && eng.ai.mainTime[lv] === this.job.id)) { this.phase = 'yield'; this.yieldD = 0; this.blockT = 0; oe.blockT = 0; this.say(`backing away to let ${oe.job.id} by`); return; } } this.waitT = (this.waitT || 0) + dt; if (this.waitT > 8 && !this.saidWait) { this.say(`holding for ${eng.cutName(ob.what)}`); this.saidWait = true; } this.t = (this.t || 0) - dt; return; } }
      else if (st.kind === 'pull' || (st.kind === 'move' && st.coupled)) { if (ob.what && ob.what !== 'end') rem = ob.dist + 0.05; }   // drive on until we couple, wherever the cars stand
      else if (st.kind !== 'move') { if (ob.what && ob.what !== 'end') rem = Math.min(rem === null ? 1e9 : rem, ob.dist + 0.05); }
      else if (ob.what && ob.what !== 'end') rem = Math.min(rem === null ? 1e9 : rem, ob.dist - 1.0);
      if (foreign && /^(CLNA|YARD)/.test(this.job.id) && ob.dist < 6 && Math.abs(lo.v) < 0.05) {   /* [CHOCO-YARDWAIT] a yard crew whose route/target track is held by another train waits for the track (never forces through; step clock paused); watchdog 900 s -> fail so nothing deadlocks silently */
        th.speed = 0; this.ywT = (this.ywT || 0) + dt; if (!this.saidYW) { this.say(`waiting for ${eng.cutName(ob.what)} to clear`); this.saidYW = true; } if (this.ywT > 900) return this.failed('track never cleared (' + eng.cutName(ob.what) + ')'); this.t = (this.t || 0) - dt; }
      else if (!foreign) this.saidYW = false;
      if (rem === null) { this.blind = (this.blind || 0) + Math.abs(lo.v) * dt; if (this.blind > 160) { th.speed = 0; return this.failed('lost the route to ' + st.to); } rem = ob.dist - 0.5; } else this.blind = 0;
      let v = Math.min(IPS(this.vmax), Math.sqrt(2 * eng.decelIps(lo) * 0.7 * Math.max(0, rem)) + 0.05);
      if (ob.what && ob.what !== 'end' && ob.dist < 10) v = Math.min(v, IPS(2.5));
      th.dir = dirTh; th.speed = rem <= 0.02 ? 0 : Math.max(1, MPH(v));
      if (this.coupledNow(lo)) { this.latched = true;
        const aft = st.after && st.after[st.to];
        if (st.kind === 'pull' && aft && !aft.includes('L')) { const xc = this.xc(); const want = aft.reduce((n, t) => n + (t === 'X' ? xc : 1), 0);
          let other = 0; for (const c of eng.cuts) { if (c === lo) continue; let o = 0; for (const car of c.cars) { const l = eng.locate(c, o + car.len / 2); o += car.len; if (eng.e2t[l.e] === st.to) other++; } }
          if (other > want) this.latched = false; }
        // [PULLALL] a pull that has coupled fewer cars than planned keeps coupling while more cars stand apart on the target track
        if (st.kind === 'pull' && this.latched) { const want = st.cars.reduce((n, t) => n + (t === 'X' ? this.xc() : 1), 0);
          if (lo.cars.length - this.nStart < want && eng.cuts.some(c => c !== lo && !c.cars.some(x => x.loco) && Object.keys(eng.occupancy(c)).some(e => eng.e2t[e] === st.to))) this.latched = false; }
        // coupled move: the next move takes more cars than we now hold (cars further in stood apart) -> keep coupling
        const nx = this.steps[this.i + 1];
        if (st.kind === 'move' && st.coupled) { const need = nx ? nx.cars.reduce((n, t) => n + (t === "X" ? this.xc() : 1), 0) : 0;
          const more = eng.cuts.some(c => c !== lo && !c.cars.some(x => x.loco) && Object.keys(eng.occupancy(c)).some(e => eng.e2t[e] === st.to));
          if (more) this.latched = false; } }   // planner: everything on one track with the loco is one coupled train
      if (this.latched && st.kind !== 'pull' && st.turnouts.some(([id]) => eng.fouls(id, lo) || this.ownOn(lo, id))) {   // coupled but still fouling the points: shove the whole cut in
        const ob2 = eng.obstacle(lo, this.dir, 40); if (!(ob2.dist < 0.5) && (this.shoveD = (this.shoveD || 0) + Math.abs(lo.v) * dt) < 60) { th.dir = dirTh; th.speed = 2; return; } }
      if (rem <= 0.02 || this.latched) { th.speed = 0; if (Math.abs(lo.v) < 0.02) this.arrived(st, lo); }
      if ((this.t = (this.t || 0) + dt) > 400) this.failed('timed out on ' + st.kind);
      return;
    }
    if (this.phase === 'back') {
      // watchdog: standing still for 40 s while backing (blocked behind) -> accept this spot and go on
      if (Math.abs(lo.v) < 0.02) { this.stillT = (this.stillT || 0) + dt; if (this.stillT > 40) { this.stillT = 0; th.speed = 0; this.say('backing move blocked — continuing from here'); this.next(); return; } } else this.stillT = 0;
      // [BACKDIR] backing away must never run back into the cars we just left: if they are right behind us, our sense of direction is flipped
      { const lc = eng.cuts.find(c => c !== lo && this.leftCars && c.cars.includes(this.leftCars)); if (lc && !this.backFlipped) { const o = eng.obstacle(lo, -this.dir, 3); if (o.what === lc) { this.dir = -this.dir; this.thDir = -this.thDir; this.backFlipped = true; th.speed = 0; return; } } }
      const rem = this.remaining(lo, -this.dir, this.goal);
      const v = Math.min(IPS(this.vmax), Math.sqrt(2 * eng.decelIps(lo) * 0.7 * Math.max(0, rem === null ? 0 : rem)) + 0.05);
      th.dir = -dirTh; th.speed = rem === null || rem <= 0.02 ? 0 : Math.max(1, MPH(v));
      { const obb = eng.obstacle(lo, -this.dir, 12); if (obb.what && obb.what !== 'end' && obb.dist < 8) th.speed = Math.min(th.speed, 2.5);
        if (obb.what && obb.what !== 'end' && obb.what.cars && obb.what.cars.some(x => x.loco) && obb.dist < 3) { th.speed = 0; return; } }
      if (this.coupledNow(lo)) { this.backLatched = true; }
      if (this.backLatched) { th.speed = 0; if (Math.abs(lo.v) < 0.02) { this.backLatched = false; this.next(); } return; }
      const foulsStep = (st.turnouts || []).some(([id]) => eng.fouls(id, lo));
      const obk = eng.obstacle(lo, -this.dir, 6); const blocked = obk.what && obk.dist < 1.0;
      if ((rem === null || rem <= 0.02) && foulsStep && !blocked && (this.backX = (this.backX || 0) + Math.abs(lo.v) * dt) < 250) { th.dir = -dirTh; th.speed = 4; return; }
      if (rem === null || rem <= 0.02) { th.speed = 0; if (Math.abs(lo.v) < 0.02) { this.backX = 0; this.next(); } }
      return;
    }
  }
  xc() { if (this.xcars === undefined) this.xcars = this.eng.cuts.reduce((n, c) => n + c.cars.filter(x => x.status === 'through' && x.job === this.job.id).length, 0); return this.xcars; }
  ownOn(cut, id) { const t = this.eng.T[id], o = this.eng.occupancy(cut); return !!(o[t.legN] || o[t.legD]) || this.eng.fouls(id, cut); }
  // [LEADK] split point that leaves the m leading cars: with the loco at one end of the cut, the leading cars are at the other end
  leadK(lo, li, m) { const n = lo.cars.length; if (li === n - 1) return m; if (li === 0) return n - m; return this.dir > 0 ? n - m : m; }
  coupledNow(lo) { const n = lo.cars.length; if (this.nCars === undefined) this.nCars = n; if (n !== this.nCars) { this.nCars = n; return true; } return false; }
  target(st) { const t = this.eng.trk[st.to]; return { trk: st.to, node: st.entry === 'a' ? t.a : t.b }; }
  remaining(cut, dir, goal) {   // distance for the leading end to sit 0.6 in + needed length inside goal.trk past goal.node
    const eng = this.eng, A = eng.ahead(cut, dir, 200); const t = eng.trk[goal.trk];
    const glen = goal.depth !== undefined ? goal.depth : cut.len + 0.8;
    let endD = null; for (const a of A) { if (eng.e2t[a.e] === goal.trk) endD = a.to; else if (endD !== null) break; }
    if (endD === null) return null;
    const need = Math.min(t.len - 0.8, (goal.inside || glen));
    return endD - t.len + need - (goal.alreadyIn || 0);
  }
  drop(lo, k) { const L0 = lo.cars.slice(); if (!this.eng.uncouple(lo, k, 'ai')) return false; const L = this.cut(); const left = L0.find(x => !L.cars.includes(x)); this.leftCars = left || null; return true; }
  arrived(st, lo) {
    const eng = this.eng; this.backFlipped = false; this.leftCars = null;
    if (st.kind === 'move') { this.next(); return; }
    // setout: leave the leading st.cars.length cars; pull: keep the coupled cars (uncouple behind the n-th of u's cars)
    const loco = lo.cars.find(x => x.addr === this.job.addr), li = lo.cars.indexOf(loco);
    // planner state after this step (sim.py emits it): exactly these cars stay on the target track
    const aft = st.after && st.after[st.to];
    if (aft && !aft.includes('L') && st.cars.includes('X')) {   // [SETOUTCOUNT] exact car counts unless an X block is involved (another job's cars on the target must not change the count)
      const xc = this.xc();
      const want = aft.reduce((n, t) => n + (t === 'X' ? xc : 1), 0);
      let other = 0; for (const c of eng.cuts) { if (c === lo) continue; let o = 0; for (const car of c.cars) { const l = eng.locate(c, o + car.len / 2); o += car.len; if (eng.e2t[l.e] === st.to) other++; } }
      let m = Math.max(0, Math.min(lo.cars.length - 1, want - other));
      // [SETOUTCOUNT] other cars already standing on the target that the planner did not know about (another job's cut) must not
      // reduce a set-out: a setout always leaves exactly the planner's cars (X = the through block)
      if (st.kind === 'setout') m = Math.max(0, Math.min(lo.cars.length - 1, st.cars.reduce((n, t) => n + (t === 'X' ? xc : 1), 0) + Math.max(0, lo.cars.length - this.nStart)));   // + cars we coupled onto at the far end
      if (m > 0) { const k = this.leadK(lo, li, m); this.drop(lo, k); }
      this.phase = 'back'; this.wait = 3; this.goal = { trk: st.frm, inside: 0.8 }; this.t = 0; this.nCars = undefined; return;
    }
    if (st.kind === 'setout') { const m = st.cars.length + Math.max(0, lo.cars.length - this.nStart); const k = this.leadK(lo, li, m); this.drop(lo, k); }
    else { const want = st.cars.length; // cars of the target track now attached at the leading end: count those beyond our original ahead
      const extra = lo.cars.length - this.nStart; if (extra > want) { const k = this.dir > 0 ? lo.cars.length - (extra - want) : (extra - want); this.drop(lo, k); } }
    this.phase = 'back'; this.wait = 3; this.goal = { trk: st.frm, inside: 0.8 }; this.t = 0; this.nCars = undefined;
  }
  next() { this.flipDir = 0; this.clearFlip = 0; if (this.warrant) { for (const k of this.warrant) if (this.eng.reserve[k] === this.job.id && !/^B:/.test(k) || (this.eng.reserve[k] === this.job.id && !(this.job.stops || []).some(s => 'B:' + s.tid === k))) delete this.eng.reserve[k]; this.warrant = null; }
    this.i++; this.shoveD = 0; this.phase = 'start'; this.nCars = undefined; const c = this.cut(); this.nStart = c ? c.cars.length : 0; this.t = 0; this.blind = 0; this.latched = false; }
  /* [R36] a finished or failed job drops every reservation it still holds (its track warrant blocks, e.g. 'B:T28 reserved for R60' held NS 211 for
     130+ sim min after R60 was done); the cars it left are still protected by occupancy */
  releaseAll() { const eng = this.eng; let n = 0; for (const k in eng.reserve) if (eng.reserve[k] === this.job.id) { delete eng.reserve[k]; n++; } if (n) this.say(`released ${n} reserved block(s)`); return n; }
  failed(why) { this.releaseAll(); this.fail = why; this.eng.throttles[this.job.addr].speed = 0; this.say('FAILED: ' + why); }
}

/* full session (shared by the 2D game, the 3D viewer bridge and tests): locals + yard jobs placed, roster through trains spawned,
   track warrants issued; mode 'auto' starts AI crews on every job (plans for this seed, or the rule-based fallback). */
/* CTC route lining: shortest path over the graph from track 'from' to track 'to', throwing every turnout on it.
   Refuses if a turnout on the route is occupied or reserved by another train. Returns {ok, turnouts|why}. */
function routeSets(eng, from, to) {   // [FETCH] turnout settings from track `from` to `to`, nothing thrown
  const T0 = eng.trk[from], T1 = eng.trk[to]; if (!T0 || !T1) return null;
  const adj = {}; for (const e of eng.E) { (adj[e.a] = adj[e.a] || []).push(e); (adj[e.b] = adj[e.b] || []).push(e); }
  const goal = new Set(T1.edges); const prev = new Map(); const q = T0.edges.map(e => [e]); for (const [e] of q) prev.set(e, null);
  const ok2 = (e1, e2) => { const l1 = eng.legOf[e1], l2 = eng.legOf[e2]; return !(l1 && l2 && l1[0] === l2[0]); };
  let hit = null; while (q.length) { const [e] = q.shift(); if (goal.has(e)) { hit = e; break; } const E = eng.E[e];
    for (const n of [E.a, E.b]) for (const x of adj[n] || []) if (!prev.has(x.id) && ok2(e, x.id)) { prev.set(x.id, e); q.push([x.id]); } }
  if (hit === null) return null; const path = []; for (let e = hit; e !== null; e = prev.get(e)) path.unshift(e);
  const sets = []; for (const e of path) { const lg = eng.legOf[e]; if (lg) sets.push([lg[0].id, lg[1]]); } return sets; }
function lineRoute(eng, from, to, who) {
  const T0 = eng.trk[from], T1 = eng.trk[to]; if (!T0 || !T1) return { ok: false, why: 'unknown track' };
  const adj = {}; for (const e of eng.E) { (adj[e.a] = adj[e.a] || []).push(e); (adj[e.b] = adj[e.b] || []).push(e); }
  const goal = new Set(T1.edges); const prev = new Map(); const q = T0.edges.map(e => [e, null]); for (const [e] of q) prev.set(e, null);
  // edge-to-edge moves are legal only straight through a turnout (stem<->leg), never leg<->leg
  const ok2 = (e1, e2) => { const l1 = eng.legOf[e1], l2 = eng.legOf[e2]; if (l1 && l2 && l1[0] === l2[0]) return false; return true; };
  let hit = null; while (q.length) { const [e] = q.shift(); if (goal.has(e)) { hit = e; break; } const E = eng.E[e];
    for (const n of [E.a, E.b]) for (const x of adj[n] || []) if (!prev.has(x.id) && ok2(e, x.id)) { prev.set(x.id, e); q.push([x.id]); } }
  if (hit === null) return { ok: false, why: `no route ${from} → ${to}` };
  const path = []; for (let e = hit; e !== null; e = prev.get(e)) path.unshift(e);
  const sets = []; for (const e of path) { const lg = eng.legOf[e]; if (lg) sets.push([lg[0].id, lg[1]]); }
  for (const [id] of sets) { const r = eng.reserve['T:' + id]; if (r && r !== who) return { ok: false, why: `${id} reserved for ${r}` }; }
  for (const [id, leg] of sets) if (eng.T[id].state !== leg && !eng.throwTurnout(id, leg, who || 'ctc')) return { ok: false, why: `${id} is occupied` };
  eng.say(`CTC: route lined ${from} → ${to} (${sets.map(s => s[0] + (s[1] === 'N' ? 'n' : 'r')).join(' ') || 'no turnouts'})`, 'disp');
  return { ok: true, turnouts: sets };
}
function carKey(c) { const m = { covered_hopper: c.len < 4 ? 'g32' : 'h51', tank: c.len > 4.5 ? 'gbrx' : 'tk', boxcar: 'c60', reefer: 'rf', flat: c.len > 6 ? 'c89' : 'f68', well: 'well', autorack: 'ar', centerbeam: 'cb', gondola: 'gon', coil: 'coil', hopper: 'cp', amfleet: 'amfleet' }; return m[c.type] || c.type; }
/* [R28 item 9] intermodal re-power: a back-to-back head-end pair (lead unit forward, second unit turned, long hood to long hood). cars are head-first. */
function intermodalPair(cars) { const L = cars.filter(c => c.type === 'loco'); if (!L.length) return cars; const lead = L[0]; const i = cars.indexOf(lead); cars.splice(0, cars.length, ...cars.filter(c => c.type !== 'loco'));
  cars.unshift(Object.assign({}, lead, { fwd: 1 }), Object.assign({}, lead, { id: lead.id + 'B', fwd: -1, rear: false })); return cars; }
/* [CHOCO-YARDRES] resident Marsden yard switcher: the yard job's MP15 stands parked on yard stub T11 (no plan uses it) from t=0 and again after each yard job,
   instead of being off the layout; it leaves the stub when a yard job goes on duty (one MP15 on view at a time) */
const YARD_PARK = 'T11';
function yardPark(eng, loco) { const trk = eng.trk[YARD_PARK]; if (!trk || eng._yp || !loco) return; const busy = new Set(); for (const c of eng.cuts) if (!c.yardFill) for (const e in eng.occupancy(c)) busy.add(+e); if (trk.edges.some(e => busy.has(e))) return;
  const c = Object.assign({}, loco, { id: loco.id, fwd: 1, train: 'yard (parked)', addr: undefined, yardRes: true }); const e0 = trk.edges[0], d0 = eng.E[e0].a === trk.a ? 1 : -1; const cut = eng.cuts.some(q => q.yardFill && Object.keys(eng.occupancy(q)).some(e => trk.edges.includes(+e))) ? eng.makeCut([c], e0, d0 > 0 ? 0.6 : eng.E[e0].len - 0.6, d0) /* [CHOCO-YARDFILL] cars stand at the bumper end; the loco parks at the ladder end */ : placeOnTrack(eng, [c], trk);
  { const oc = eng.occupancy(cut); if (eng.cuts.some(q => q !== cut && Object.entries(eng.occupancy(q)).some(([e, b]) => { const a = oc[e]; return a && a[0] < b[1] && b[0] < a[1]; }))) { eng.cuts.splice(eng.cuts.indexOf(cut), 1); return; } } cut.parked = true; cut.yardRes = true; eng._yp = cut; eng.say(`${loco.id} parked on the yard stub ${YARD_PARK}`); }
function yardUnpark(eng) { const c = eng._yp; if (!c) return; const i = eng.cuts.indexOf(c); if (i >= 0) eng.cuts.splice(i, 1); eng._yp = null; }
const LAP_REQ = 150, HOLD_CAP = 900, LOOP_TRK = { 1: 'T25', 2: 'T40' }, LOOP_EDGES = new Set(['T25', 'T40']), LOOP_CLR = 1.11;   /* [CHOCO-LAP3] probe_clear.js: #6 D route reaches 1.1 in from the lift route 8.52 in from the points = 1.11 in past the 7.41 in leg */   /* [CHOCO-LAP2] s a through train may stand on the loop before it falls back to one extra lap */
   /* [CHOCO-LAP] in run on a level before a through train asks for the lift (level main 320.4 in; the LN/LS decision comes near its end) */
function startSession(eng, ai, seed, mode, opt = {}) {
  const D = eng.D; setupSession(eng, seed, opt.jobs || D.jobs.filter(j => j.game).map(j => j.id));
  const W = D.extent[0], H = D.extent[1];
  const cw = eid => { const p = eng.E[eid].pts, a = p[0], b = p[p.length - 1]; return (a[0] - W / 2) * (b[1] - a[1]) - (a[1] - H / 2) * (b[0] - a[0]) > 0 ? 1 : -1; };
  const thru = (D.trains || []).filter(t => PRIO(t.sym + ' ' + (t.desc || '')) <= 3).sort((a, b) => PRIO(a.sym + ' ' + a.desc) - PRIO(b.sym + ' ' + b.desc)).slice(0, opt.through !== undefined ? opt.through : ((D.session && D.session.through_trains != null) ? D.session.through_trains : 3) /* [CHOCO-TT0] */);
  const R = D.roster || { cars: [], locos: [] }; const placed = [];
  thru.forEach((t, i) => {
    let cars = t.cars.map((c, k) => ({ id: (R.cars.concat(R.locos).find(x => x.home === t.sym && x.id.endsWith('-' + String(k + 1).padStart(2, '0'))) || { id: t.sym + '-' + (k + 1) }).id,
      type: c.type === 'loco' ? 'loco' : carKey(c), len: c.len, fwd: 1, model: c.model, road: c.rr, rear: !!c.rear })); if (/intermodal/i.test(t.sym)) intermodalPair(cars); cars.reverse();
    const lv = t.dir === 'CW' ? 2 : 1; /* [DIR 2026-10-18] one direction per level at the start (CCW/odd on L1, CW/even on L2) */ const busy = new Set(); for (const c of eng.cuts) for (const e in eng.occupancy(c)) { busy.add(+e); const E = eng.E[+e]; for (const x of eng.E) if (x.a === E.a || x.a === E.b || x.b === E.a || x.b === E.b) busy.add(x.id); }   // keep one block clear of standing cuts
    const tl = cars.reduce((s, c) => s + c.len, 0);
    const cands = D.tracks.filter(x => x.type === 'main' && x.len > tl + 2 && !x.edges.some(e => busy.has(e))).sort((a, b) => (a.level === lv ? 0 : 1) - (b.level === lv ? 0 : 1) || b.len - a.len);
    let ok = null;
    for (const main of cands) { const e0 = main.edges[0]; const tr = ai.addThrough(cars.map(c => Object.assign({}, c)), t.sym.replace(/\s*\(.*\)/, ''), e0, 1, (t.dir === 'CW' ? 1 : -1) * cw(e0), {   /* [DIR 2026-10-18] each through train runs its own direction (odd number CCW, even CW; rev4_ops.direction) */ lift: t.lift, vmax: PRIO(t.sym) === 1 ? 40 : 35 });
      const c = ai.cutOf(tr); const oc = eng.occupancy(c); const clash = Object.keys(oc).some(e => busy.has(+e));
      if (!clash) { ok = tr; break; } eng.cuts.splice(eng.cuts.indexOf(c), 1); ai.trains.splice(ai.trains.indexOf(tr), 1); delete eng.throttles[tr.addr]; }
    if (!ok) { eng.say(`${t.sym}: no free main track long enough to place it this session`, 'warn'); return; }
    ok.cw = t.dir === 'CW'; ok.tt = true; ok.ttRuns = 1; ok.ttLv = lv; placed.push(ok);
  });
  /* [R28 item 9] the 20-train timetable: every through train whose first leg is 'lift L3 -> ...' waits in L3 staging and comes down the lift at its
     timetable minute (one run each; then back to L3 and off the layout). Before this only the top-3 through trains were ever placed. */
  if (mode === 'auto' && eng.lift && eng.levels >= 3 && opt.timetable !== false) { const TT = (D.session && D.session.timetable) || [], have = new Set(placed.map(p => p.sym)), base = x => x.replace(/\s*\(.*\)/, '');
    const KW = ['intermodal', 'phosphate', 'ethanol', 'coal', 'grain', 'manifest', 'y191', 'rjc', 'amtrak'];
    const findT = sym => (D.trains || []).find(x => x.sym === sym) || (D.trains || []).find(x => base(x.sym) === base(sym)) || (D.trains || []).find(x => { const a = sym.toLowerCase(), b = (x.sym + ' ' + (x.desc || '')).toLowerCase(); return KW.some(k => a.includes(k) && b.includes(k)) || (a.includes('grain') && /ethanol|hopper/.test(b)); });
    const st = [];
    for (const e of TT) { const sym = base(e.sym); if (e.legs && e.legs[0] && e.legs[0][0] === 'ad') { /* [CHOCO-AD] */ const t = findT(e.sym); if (t) { (eng._adQ = eng._adQ || []).push({ sym, t, until: (e.legs[0][3] || e.start || 0) * 60 * (opt.ttScale || 0.6) }); st.push(sym); } continue; } if (have.has(sym) || !e.legs || !e.legs.length || e.legs[0][0] !== 'lift' || e.legs[0][1] !== 'L3') continue; const t = findT(e.sym); if (!t) continue;
      let cars = t.cars.map((c, k) => ({ id: sym + '-' + String(k + 1).padStart(2, '0'), type: c.type === 'loco' ? 'loco' : carKey(c), len: c.len, fwd: 1, model: c.model, road: c.rr, rear: !!c.rear }));
      if (/grain/i.test(e.sym)) cars = cars.map(c => c.type === 'loco' ? c : Object.assign({}, c, { type: 'h51' }));
      if (/intermodal/i.test(e.sym)) intermodalPair(cars);
      const max = eng.lift.len - 0.6; const _tl = cars.reduce((a, c) => a + c.len, 0); if (_tl > max) { /* [CHOCO-OVERLIFT] */ (eng.overLift = eng.overLift || []).push({ sym, len: +_tl.toFixed(1), max: +max.toFixed(1), cars: cars.length }); eng.say(`⚠ ${sym}: ${_tl.toFixed(1)} in > lift ${max.toFixed(1)} in - HELD in L3 staging, not run (pending: double over the lift in two cuts, or shorten to <= 73 in)`, 'warn'); continue; }   // ride the lift: trim to the lift length
      cars.reverse(); const tr = ai.addThrough(cars, sym, eng.lift.edge, 0.3, 1, { lift: true, vmax: PRIO(sym) === 1 ? 40 : 35 }); tr.tt = true; tr.cw = t.dir === 'CW';
      const c = ai.cutOf(tr); ai.toStaging3(tr, c); const q = ai.stage3[ai.stage3.length - 1]; q.until = (e.legs[0][3] || e.start || 0) * 60 * (opt.ttScale || 0.6); q.lv = /L1/.test(e.legs[0][2] || '') ? 1 : 2; tr.ttUntil0 = q.until; tr.ttLv = q.lv; st.push(sym); }   /* [R34] timetable minutes compressed x0.6 so the 20-train session keeps a train on the main every few minutes; each train keeps its timetable destination level */
    if (ai.stage3) ai.stage3.sort((a, b) => a.until - b.until); eng._ttP = Math.max(45 * 60, ...(ai.stage3 || []).map(q => q.until)) + 12 * 60;   /* [R36] timetable lap length (last train's minute + 12 min) */
    if (st.length) eng.say(`Timetable: ${st.length} through trains wait in L3 staging (${st.join(', ')})`); }
  alignUnder(eng);
  for (const j of eng.session.jobs) { const blocks = [j.stops[0].tid].concat(j.stops.flatMap(s => s.industries.map(i => D.industries.find(x => x.id === i).tid)));
    const sm0 = ((D.jobs.find(x => x.id === j.id) || {}).start_min || 0) * 60;
    if (mode === 'auto' && sm0 > 0) {   // [START] off-layout until its timetable minute (arrives by lift / from the yard in the real session)
      const cut = eng.cuts.find(c => c.cars.some(x => x.loco && x.train === j.id)); if (cut) { eng.cuts.splice(eng.cuts.indexOf(cut), 1); j._offCut = cut; } j._blocks = blocks; continue; }
    for (const b of blocks) if (eng.trk[b].type !== 'main' || b === j.stops[0].tid) eng.reserve['B:' + b] = j.id;   // a local holding on the main protects its own block
    ai.say(`Dispatcher to ${j.id}: track warrant ${100 + eng.session.jobs.indexOf(j)} — work ${blocks.join(', ')}; main tracks by permission only`); }
  if (mode === 'auto') { const yj = eng.session.jobs.filter(j => (D.jobs.find(x => x.id === j.id) || {}).loco === 'mp15' && j._offCut); if (yj.length) yardPark(eng, yj[0].loco); }   // [CHOCO-YARDRES]
  eng.say(`Session ${seed}: ${eng.session.cards.length} car cards, ${eng.session.jobs.length} jobs, ${placed.length} through trains`);
  if (eng.missing && eng.missing.length) eng.say(`Roster has no spare ${[...new Set(eng.missing)].join(', ')} cars — those spots stay empty`, 'warn');
  // [START] optional timetable start (ops.json job start_min): the AI crew waits until then (sim seconds = minutes x 60)
  if (mode === 'auto') for (const j of eng.session.jobs) { const sm = ((D.jobs.find(x => x.id === j.id) || {}).start_min || 0) * 60 * (opt.localScale || 0.6);   /* [R34] locals compressed (x0.6; through trains x0.6, they also queue at the lift) so the session runs 20 trains in ~2 h of operating and >= 6 move in the first 10 min */
    if (sm > eng.t) (ai.pendingStart = ai.pendingStart || []).push([sm, j]); else startJobAI(eng, ai, j); }
  return { thru: placed };
}
/* line every turnout to the leg a standing cut occupies (cars placed across points at session start) */
function alignUnder(eng, only) { for (const c of eng.cuts) { if (only && c !== only) continue; for (const e in eng.occupancy(c)) { const lg = eng.legOf[e]; if (lg && lg[0].state !== lg[1]) lg[0].state = lg[1]; } } }
function startJobAI(eng, ai, j) { const plan = j.plan;
  if (j.exec) return j.exec;
  if (!plan || !plan.steps || !plan.steps.length) { eng.say(`${j.id}: no plan for this session seed — AI crew stands by (seeds with plans: ${(eng.D.sessions || []).map(s => s.seed).join(',')})`, 'warn'); return null; }
  j.exec = new PlanExec(eng, j, plan.steps, { vmax: 8 }); ai.say(`${j.id}: AI crew working ${plan.steps.length} planned moves`); return j.exec; }

const API = { lineRoute, startSession, startJobAI, carKey, makePool, Engine, AI, PlanExec, genSession, setupSession, scoreSession, rng, IPS, MPH, LIMIT, PRIO, LIFT_TIME, LIFT_TRAVEL };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.OpsEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);
