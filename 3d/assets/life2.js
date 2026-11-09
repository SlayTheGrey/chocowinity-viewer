/* life.js - ambient life for the layout3d viewer (N-scale layout). Self-contained, plain script, global THREE (r14x) + THREE.GLTFLoader.
   API:   L3D.life2.init(opts) -> Promise   |   L3D.life2.update(dt, camera)   |   L3D.life2.setHour(h)   |   L3D.life2.stats()   |   L3D.life2.dispose()
   See INTEGRATION.md for opts / data formats. Units: data in SCENE units on the ground plane (x, z), y from opts.heightAt(x, z) unless a point
   carries its own y (dock decks, ramps). All behaviour speeds are real m/s converted with opts.unitsPerMeter (N scale in inches: 39.37/160).
   Design rules: every actor has a purpose + destination, only moves on validated surfaces (sidewalk/drive graphs, yard/pasture polygons, site
   lanes), never inside blockers or track clearance; fixed-size pools -> no memory growth; skinned clones only near the camera and in view. */
(function () {
'use strict';
const T = window.THREE, L3D = window.L3D = window.L3D || {}, LIFE = L3D.life2 = L3D.life2 || {};
const TAU = Math.PI * 2, DEG = Math.PI / 180;
/* ------------------------------------------------------------------ small utils (no per-frame allocation) */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let R = mulberry(1);
const rr = (a, b) => a + (b - a) * R(), pick = A => A[Math.floor(R() * A.length) % A.length];
function inPoly(x, z, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function segD(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz; let t = l ? ((px - ax) * dx + (pz - az) * dz) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + dx * t - px, qz = az + dz * t - pz; return Math.sqrt(qx * qx + qz * qz); }
function polyEdgeD(x, z, P) { let d = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) d = Math.min(d, segD(x, z, P[i][0], P[i][1], P[j][0], P[j][1])); return d; }
function lineD(x, z, L) { let d = 1e9; for (let i = 1; i < L.length; i++) d = Math.min(d, segD(x, z, L[i - 1][0], L[i - 1][1], L[i][0], L[i][1])); return d; }
function angWrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
const yawOf = (dx, dz) => Math.atan2(-dz, dx);   // models face +X
function bbox(P) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const p of P) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c = Math.max(c, p[0]); d = Math.max(d, p[1]); } return [a, b, c, d]; }

/* ------------------------------------------------------------------ state */
let S = null;
const _v = new T.Vector3(), _v2 = new T.Vector3(), _m = new T.Matrix4(), _q = new T.Quaternion(), _s = new T.Vector3(), _e = new T.Euler(), _fr = new T.Frustum(), _pm = new T.Matrix4(), _sph = new T.Sphere();
const DEF = { unitsPerMeter: 39.37 / 160, glbScale: 1 / 25.4, nearLOD: 80, farLOD: 400, maxSkinned: 48, maxActors: 220, trackClear: 2.75, personR: 0.35,
  seed: 7, hour: 12, dayOfWeek: 6, simRateFar: 4, quality: 'high' };

/* ------------------------------------------------------------------ surfaces + validation */
class Surfaces {
  constructor(d, o) { this.blk = (d.blockers || []).map(P => ({ P, bb: bbox(P) })); this.trk = d.tracks || []; this.o = o; this.allowTrack = d.trackCrossings || []; this.bad = []; }
  /* point is valid for a walker of radius r (scene units): not inside / within r of any blocker, outside track clearance unless at a marked crossing */
  ok(x, z, r, kind) {
    for (const b of this.blk) { if (x < b.bb[0] - r || x > b.bb[2] + r || z < b.bb[1] - r || z > b.bb[3] + r) continue; if (inPoly(x, z, b.P) || polyEdgeD(x, z, b.P) < r) return false; }
    const c = this.o.trackClear * this.o.u;
    if (kind !== 'track-ok') for (const L of this.trk) if (lineD(x, z, L) < c) { if (!this.allowTrack.some(q => Math.hypot(q[0] - x, q[1] - z) < (q[2] || c * 1.5))) return false; }
    return true; }
  segOk(a, b, r, kind) { const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (0.25 * this.o.u))); for (let i = 0; i <= n; i++) { const t = i / n; if (!this.ok(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r, kind)) return false; } return true; }
}
/* ------------------------------------------------------------------ graph + A* with bounded route cache */
class Graph {
  constructor(G, surf, r, name) { this.N = G.nodes || []; this.adj = this.N.map(() => []); this.dropped = 0; this.cache = new Map(); this.name = name; this.tags = G.tags || {};
    for (const e of G.edges || []) { const [a, b, k] = e; const A = this.N[a], B = this.N[b]; if (!A || !B) continue;
      if (surf && !(k && k.free) && !surf.segOk(A, B, r, k && k.track ? 'track-ok' : null)) { this.dropped++; surf.bad.push([name, a, b]); continue; }
      const w = Math.hypot(B[0] - A[0], B[1] - A[1]); this.adj[a].push(b, w); if (!(k && k.oneway)) this.adj[b].push(a, w); } }
  nearest(x, z) { let bi = -1, bd = 1e18; for (let i = 0; i < this.N.length; i++) { if (!this.adj[i].length) continue; const d = (this.N[i][0] - x) ** 2 + (this.N[i][1] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
  route(a, b) { if (a < 0 || b < 0) return null; const key = a * 100003 + b; let r = this.cache.get(key); if (r !== undefined) { this.cache.delete(key); this.cache.set(key, r); return r; }
    const n = this.N.length, g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), open = [a], H = i => Math.hypot(this.N[i][0] - this.N[b][0], this.N[i][1] - this.N[b][1]); g[a] = 0; const inO = new Uint8Array(n); inO[a] = 1;
    while (open.length) { let bi = 0; for (let i = 1; i < open.length; i++) if (g[open[i]] + H(open[i]) < g[open[bi]] + H(open[bi])) bi = i; const u = open.splice(bi, 1)[0]; inO[u] = 0; if (u === b) break;
      const A = this.adj[u]; for (let i = 0; i < A.length; i += 2) { const v = A[i], w = g[u] + A[i + 1]; if (w < g[v]) { g[v] = w; prev[v] = u; if (!inO[v]) { open.push(v); inO[v] = 1; } } } }
    r = null; if (g[b] < Infinity) { r = []; for (let u = b; u >= 0; u = prev[u]) r.push(this.N[u]); r.reverse(); }
    this.cache.set(key, r); if (this.cache.size > 256) this.cache.delete(this.cache.keys().next().value); return r; }
}
/* ------------------------------------------------------------------ assets */
function skClone(src) { const c = src.clone(true), sm = [], cm = [], bones = {}; src.traverse(n => { if (n.isSkinnedMesh) sm.push(n); }); c.traverse(n => { if (n.isSkinnedMesh) cm.push(n); if (n.isBone) bones[n.name] = n; });
  cm.forEach((m, i) => { const sk = sm[i].skeleton; m.skeleton = new T.Skeleton(sk.bones.map(b => bones[b.name]), sk.boneInverses); m.bind(m.skeleton, sm[i].bindMatrix); m.frustumCulled = false; }); return c; }
function findNode(o, n) { let r = null; o.traverse(x => { if (!r && x.name === n) r = x; }); return r; }
async function loadAll(src) { const ld = new T.GLTFLoader(), out = {};
  await Promise.all(Object.entries(src).map(([id, s]) => new Promise(res => {
    const done = g => { const ex = (g.asset && g.asset.extras) || (g.parser && g.parser.json.asset.extras) || {}; let sk = false, bindGeo = null, mat = null;
        g.scene.traverse(m => { if (m.isMesh) { m.castShadow = true; if (m.isSkinnedMesh) { sk = true; if (!bindGeo) { bindGeo = m.geometry.clone(); bindGeo.deleteAttribute('skinIndex'); bindGeo.deleteAttribute('skinWeight'); mat = m.material; } } } });
        out[id] = { id, scene: g.scene, clips: g.animations || [], ex, skinned: sk, bindGeo, mat, ws: +ex.walk_speed_mps || 1 }; res(); };
    const fail = e => { console.warn('[life] asset', id, e && e.message); res(); };
    if (s && s.isObject3D) { out[id] = { id, scene: s, clips: [], ex: {}, skinned: false, ws: 1 }; return res(); }
    if (typeof s === 'string' && !/^(https?:|\.|\/)|\.glb$/.test(s)) { const b = Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer; ld.parse(b, '', done, fail); }
    else if (s instanceof ArrayBuffer) ld.parse(s, '', done, fail); else ld.load(s, done, undefined, fail); })));
  return out; }

/* ------------------------------------------------------------------ skinned pool + far instancing (LOD) */
class Skin {   // pool of skinned clones per asset, fixed max; actors borrow while near + in view
  constructor(A, max, group, sc) { this.A = A; this.free = []; this.n = 0; this.max = max; this.g = group; this.sc = sc; }
  get() { if (S.skLive >= S.o.maxSkinned) return null; let o = this.free.pop(); if (o) { o.root.visible = true; S.skLive++; return o; } if (this.n >= this.max || S.skMade >= S.o.maxSkinned) return null; this.n++; S.skMade++; S.skLive++;
    const root = skClone(this.A.scene); root.scale.setScalar(this.sc); const g = new T.Group(); g.add(root); this.g.add(g); const mixer = new T.AnimationMixer(root), act = {};
    for (const c of this.A.clips) { const a = mixer.clipAction(c); act[c.name] = a; if ((this.A.ex.oneshot || []).includes(c.name)) { a.setLoop(T.LoopOnce); a.clampWhenFinished = true; } }
    const carry = findNode(root, 'carry'); return { root: g, mixer, act, cur: null, carry }; }
  put(o) { S.skLive--; if (o.cur) o.cur.stop(); o.cur = null; o.mixer.stopAllAction(); o.root.visible = false; if (o.held) { o.held = null; } this.free.push(o); }
}
class Far {    // one InstancedMesh per asset (bind pose), capacity = actors of that asset
  constructor(A, cap, group, sc) { this.m = new T.InstancedMesh(A.bindGeo, A.mat, Math.max(1, cap)); this.m.count = 0; this.m.frustumCulled = false; this.m.castShadow = true; this.sc = sc; group.add(this.m); this.cap = cap; this.k = 0; }
  begin() { this.k = 0; } put(x, y, z, yaw) { if (this.k >= this.cap) return; _q.setFromAxisAngle(_v2.set(0, 1, 0), yaw); _s.setScalar(this.sc); _m.compose(_v.set(x, y, z), _q, _s); this.m.setMatrixAt(this.k++, _m); }
  end() { this.m.count = this.k; this.m.instanceMatrix.needsUpdate = true; }
}

/* ------------------------------------------------------------------ actors: task queue + planner */
let NID = 0;
class Actor {
  constructor(asset, cls, plan) { this.id = NID++; this.asset = asset; this.cls = cls; this.plan = plan; this.x = 0; this.z = 0; this.y = null; this.yaw = 0; this.q = []; this.t = 0; this.clip = 'idle'; this.ts = 1;
    this.sp = 1; this.var = rr(0.88, 1.12); this.phase = R(); this.sk = null; this.d2 = 1e9; this.vis = true; this.alive = true; this.turnRate = 300 * DEG; this.held = null; this.mode = 0; this.wait = 0; }
  push(...t) { this.q.push(...t); return this; }
  step(dt) { let k = 0; while (k++ < 4) { if (!this.q.length) { if (!this.alive) return; this.plan(this); if (!this.q.length) { this.clip = 'idle'; return; } }
      const tk = this.q[0]; const done = RUN[tk.k](this, tk, dt); if (!done) return; this.q.shift(); dt = 0; } }
}
const RUN = {
  /* walk / drive a polyline at speed tk.sp (m/s); clip timeScale locked to ground speed (no foot slide); yaw turns at turnRate, slowing on sharp corners */
  path(a, tk, dt) { const P = tk.P; if (tk.i == null) { tk.i = 1; tk.s = 0; if (!P || P.length < 2) return true; if (!a.placed) { a.x = P[0][0]; a.z = P[0][1]; } else tk.i = 0; a.placed = true; }
    const sp = (tk.sp || 1.3) * a.var * S.u; let rem = sp * dt;
    while (rem > 0 && tk.i < P.length) { const B = P[tk.i], dx = B[0] - a.x, dz = B[1] - a.z, d = Math.hypot(dx, dz); const want = yawOf(dx, dz), da = angWrap(want - a.yaw);
      if (Math.abs(da) > 1.0 && d > 1e-4 && !tk.rev) { a.yaw += Math.sign(da) * Math.min(Math.abs(da), a.turnRate * dt); a.clip = tk.clip || 'walk'; a.ts = 0.35; return false; }   // turn on the spot before a sharp corner
      a.yaw += Math.sign(da) * Math.min(Math.abs(da), a.turnRate * dt) * (tk.rev ? 0 : 1);
      if (d <= rem) { a.x = B[0]; a.z = B[1]; if (B.length > 2) a.y = B[2]; else a.y = null; rem -= d; tk.i++; } else { a.x += dx / d * rem; a.z += dz / d * rem; if (B.length > 2) a.y = (a.y == null ? B[2] : a.y + (B[2] - a.y) * Math.min(1, rem / d)); rem = 0; } }
    a.clip = tk.clip || 'walk'; a.ts = (tk.sp || 1.3) * a.var / (a.ws || 1); a.moved = sp; return tk.i >= P.length; },
  play(a, tk, dt) { if (tk.e == null) { tk.e = 0; a.clip = tk.clip; a.ts = tk.ts || 1; if (tk.yaw != null) tk.y0 = a.yaw; } tk.e += dt;
    if (tk.yaw != null) a.yaw += angWrap(tk.yaw - a.yaw) * Math.min(1, dt * 3);
    if (tk.at) for (const ev of tk.at) if (!ev.done && tk.e >= ev.t) { ev.done = true; ev.fn(a); }
    return tk.e >= tk.dur; },
  call(a, tk) { tk.fn(a); return true; },
  hide(a, tk) { a.vis = !tk.on; return true; },
};
const walk = (P, sp, clip) => ({ k: 'path', P, sp, clip });
const play = (clip, dur, extra) => Object.assign({ k: 'play', clip, dur }, extra || {});
const call = fn => ({ k: 'call', fn });

/* ------------------------------------------------------------------ time of day: population factor per class (0..1) */
const TOD = {   // hour -> factor (piecewise linear, 24 h); dayOfWeek 0 = Sunday
  ped:     [[0, .05], [6, .1], [8, .6], [12, .8], [17, 1], [20, .5], [22, .15], [24, .05]],
  dogwalk: [[0, 0], [6, .5], [8, .8], [10, .3], [16, .4], [18, 1], [21, .3], [22, 0], [24, 0]],
  yard:    [[0, 0], [8, 0], [9, .8], [12, .6], [17, .8], [19, 0], [24, 0]],
  kids:    [[0, 0], [8, 0], [15.5, .3], [16, 1], [19.5, .6], [20.5, 0], [24, 0]],
  angler:  [[0, 0], [5.5, 0], [6, 1], [9, .6], [12, .2], [17, .6], [19.5, 1], [20.5, 0], [24, 0]],
  church:  [[0, 0], [9, 0], [9.5, 1], [12.5, 1], [13, 0], [24, 0]],
  work:    [[0, 0], [6.5, 0], [7, 1], [16.5, 1], [17, 0], [24, 0]],
  deliver: [[0, 0], [8.5, 0], [9, 1], [19, 1], [19.5, 0], [24, 0]],
  bus:     [[0, 0], [6.8, 0], [7, 1], [8.3, 1], [8.5, 0], [14.8, 0], [15, 1], [16.3, 1], [16.5, 0], [24, 0]],
};
function tod(c) { const h = S.hour, P = TOD[c]; for (let i = 1; i < P.length; i++) if (h <= P[i][0]) { const a = P[i - 1], b = P[i]; let f = a[1] + (b[1] - a[1]) * (h - a[0]) / (b[0] - a[0]);
      if (c === 'kids' && (S.dow === 0 || S.dow === 6) && h > 9 && h < 19.5) f = 1; if (c === 'church' && S.dow !== 0) f *= 0.08; if ((c === 'work' || c === 'bus') && (S.dow === 0 || S.dow === 6)) f *= c === 'bus' ? 0 : 0.3; return f; } return 0; }

/* ------------------------------------------------------------------ behaviours */
function sidewalkRoute(a, toNode) { const G = S.walk; const from = G.nearest(a.x, a.z); const P = G.route(from, toNode); return P && P.length > 1 ? P : null; }
function despawn(a) { a.alive = false; a.q.length = 0; }
/* pedestrian: home door -> errand POI (shop door, church, bus stop, park bench) -> dwell (talk/idle/sit) -> next errand or home -> despawn */
function planPed(a) { const D = S.data; if (a.home == null) { const pois = D.pois || []; a.home = pick(pois.filter(p => p.kind === 'door' || p.kind === 'home') .concat([pois[0]])); const n = S.walk.nearest(a.home.p[0], a.home.p[1]); a.x = S.walk.N[n][0]; a.z = S.walk.N[n][1]; a.errands = 1 + Math.floor(R() * 3); }
  if (a.errands-- <= 0 || tod(a.cls) < R() * 0.6) { const P = sidewalkRoute(a, S.walk.nearest(a.home.p[0], a.home.p[1])); if (P) a.push(walk(P, 1.25)); a.push(play('idle', 0.5), call(despawn)); return; }   // home: goes indoors
  const tgt = pick((D.pois || []).filter(p => p !== a.home)); if (!tgt) { a.push(play('idle', 5)); return; } const P = sidewalkRoute(a, S.walk.nearest(tgt.p[0], tgt.p[1])); if (!P) { a.push(play('idle', 3)); return; }
  a.push(walk(P, 1.25 * rr(0.9, 1.1)));
  const dw = tgt.kind === 'bench' ? play(S.assets[a.asset].clips.some(c => c.name === 'sit') ? 'sit' : 'idle', rr(20, 60), { yaw: tgt.yaw }) : play(R() < 0.5 ? 'talk' : 'idle', rr(4, 14), { yaw: tgt.yaw });
  a.push(dw); }
/* dog walker: loop route on sidewalks; the dog follows the walker's trail 1.4 m back, offset to the right, with its own walk cycle */
function planDogWalker(a) { if (a.loopN == null) { a.loopN = 0; const L = S.data.dogLoops && S.data.dogLoops.length ? pick(S.data.dogLoops) : null; a.loop = L; }
  if (a.loopN++ > 1 || tod('dogwalk') < 0.15) { a.push(play('idle', 1), call(b => { despawn(b); if (b.dog) despawn(b.dog); })); return; }
  const L = a.loop; if (!L) { const n = S.walk.N; const to = Math.floor(R() * n.length); const P = sidewalkRoute(a, to); if (P) a.push(walk(P, 1.05)); else a.push(play('idle', 3)); return; }
  let from = S.walk.nearest(a.x, a.z); for (let i = 0; i < L.length; i++) { const P = S.walk.route(from, L[i]); if (P && P.length > 1) { a.push(walk(P, 1.05)); from = L[i]; } }
  a.push(play('idle', rr(3, 8))); }
function planDog(d) { d.push(call(dd => { const w = dd.owner; if (!w || !w.alive) { despawn(dd); return; } dd.q.push({ k: 'follow' }); })); }
RUN.follow = function (d, tk, dt) { const w = d.owner; if (!w.alive) return true; const tr = w.trail; const back = 1.4 * S.u; // walk the owner's trail
  let acc = 0, i = w.trailN - 1, px = w.x, pz = w.z; for (let k = 0; k < 63 && i > 0; k++, i--) { const j = (w.trailH - 1 - k + 64) % 64, qx = tr[j * 2], qz = tr[j * 2 + 1]; const s = Math.hypot(qx - px, qz - pz); if (acc + s >= back) { const f = (back - acc) / s; px += (qx - px) * f; pz += (qz - pz) * f; acc = back; break; } acc += s; px = qx; pz = qz; }
  const ox = Math.sin(w.yaw) * 0.35 * S.u, oz = Math.cos(w.yaw) * 0.35 * S.u; const tx = px - ox, tz = pz - oz, dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
  const sp = Math.min(dist / Math.max(dt, 1e-3), 1.6 * S.u); if (dist > 4 * S.u || !S.surf.ok(tx, tz, 0.15 * S.u)) { d.x = px; d.z = pz; } else if (dist > 1e-4) { d.x += dx / dist * sp * dt; d.z += dz / dist * sp * dt; d.yaw += angWrap(yawOf(dx, dz) - d.yaw) * Math.min(1, dt * 6); }
  d.clip = sp > 0.08 * S.u ? 'walk' : (R() < 0.002 ? 'swish' : d.clip === 'walk' ? 'idle' : d.clip); d.ts = sp / S.u / (d.ws || 1); return false; };
/* polygon wanderer (yard work, kids, barnyard animals, pasture herd): random valid target inside poly (and its keep-out list), straight walk, activity */
function polyTarget(Z, x, z, maxD, r) { for (let k = 0; k < 40; k++) { const tx = rr(Z.bb[0], Z.bb[2]), tz = rr(Z.bb[1], Z.bb[3]); if (!inPoly(tx, tz, Z.P) || polyEdgeD(tx, tz, Z.P) < r) continue;
    if (x != null && maxD && Math.hypot(tx - x, tz - z) > maxD) continue; if ((Z.keep || []).some(K => inPoly(tx, tz, K) || polyEdgeD(tx, tz, K) < r)) continue;
    let ok = true; const n = x == null ? 0 : Math.ceil(Math.hypot(tx - x, tz - z) / (0.3 * S.u)); for (let i = 1; i < n && ok; i++) { const px = x + (tx - x) * i / n, pz = z + (tz - z) * i / n; if (!inPoly(px, pz, Z.P) || (Z.keep || []).some(K => inPoly(px, pz, K))) ok = false; }
    if (ok && S.surf.ok(tx, tz, r * 0.5, Z.trackOk ? 'track-ok' : null)) return [tx, tz]; } return null; }
function zone(P, keep) { const Z = { P, keep: keep || [], bb: bbox(P) }; Z.corners = []; for (const K of Z.keep) { const c = K.reduce((a, p) => [a[0] + p[0] / K.length, a[1] + p[1] / K.length], [0, 0]);
    for (const p of K) { const dx = p[0] - c[0], dz = p[1] - c[1], l = Math.hypot(dx, dz) || 1; Z.corners.push([p[0] + dx / l * 0.9 * (S ? S.u : 0.25), p[1] + dz / l * 0.9 * (S ? S.u : 0.25)]); } } return Z; }
function zoneLOS(Z, a, b) { const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (0.25 * S.u))); for (let i = 1; i < n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n; if (!inPoly(x, z, Z.P) || Z.keep.some(K => inPoly(x, z, K))) return false; } return true; }
/* shortest walk a -> b inside a yard / pasture around its keep-out polygons (visibility graph over buffered keep corners) */
function zoneRoute(Z, a, b) { if (zoneLOS(Z, a, b)) return [a, b]; const N = [a, b].concat(Z.corners.filter(c => inPoly(c[0], c[1], Z.P))), n = N.length, d = new Array(n).fill(1e18), pv = new Array(n).fill(-1), done = new Array(n).fill(false); d[0] = 0;
  for (let it = 0; it < n; it++) { let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || d[i] < d[u])) u = i; if (u < 0 || d[u] >= 1e18) break; done[u] = true; if (u === 1) break;
    for (let v = 0; v < n; v++) if (!done[v] && zoneLOS(Z, N[u], N[v])) { const w = d[u] + Math.hypot(N[v][0] - N[u][0], N[v][1] - N[u][1]); if (w < d[v]) { d[v] = w; pv[v] = u; } } }
  if (pv[1] < 0) return null; const P = []; for (let u = 1; u >= 0; u = pv[u]) P.push(N[u]); return P.reverse(); }
function planYard(a) { const Z = a.zone; if (tod('yard') < 0.1 && R() < 0.5) { const P = zoneRoute(Z, [a.x, a.z], Z.door); if (P) a.push(walk(P, 1.0)); a.push(call(despawn)); return; }
  const t = polyTarget(Z, a.x, a.z, 8 * S.u, 0.6 * S.u); if (t) a.push(walk([[a.x, a.z], t], 0.9)); a.push(play(a.tool || 'idle', rr(15, 40), { yaw: a.yaw + rr(-1, 1) }), play('idle', rr(2, 6))); }
function planKid(a) { const Z = a.zone; if (tod('kids') < 0.1) { const P = zoneRoute(Z, [a.x, a.z], Z.door); if (P) a.push(walk(P, 1.2)); a.push(call(despawn)); return; }
  const r = R(); if (r < 0.45) { const t = polyTarget(Z, a.x, a.z, 10 * S.u, 0.5 * S.u); if (t) a.push(walk([[a.x, a.z], t], rr(1.2, 2.4))); }   // run about (tag)
  else if (r < 0.65) a.push(play('jump', 1.25 * Math.ceil(rr(1, 4))));
  else a.push(play(R() < 0.5 ? 'talk' : 'wave', rr(3, 8))); }
function planAngler(a) { const F = a.spot; if (!a.at) { a.at = true; const P = sidewalkRoute(a, S.walk.nearest(F.from[0], F.from[1])) || []; if (P.length) a.push(walk(P, 1.1)); a.push(walk([[F.from[0], F.from[1]]].concat(F.path || [], [F.p]), 0.9), play('cast', 2.5, { yaw: F.yaw })); return; }
  if (tod('angler') < 0.15 && R() < 0.4) { a.push(walk([F.p].concat((F.path || []).slice().reverse(), [F.from]), 0.9), call(despawn)); return; }
  a.push(play('fish', rr(30, 90), { yaw: F.yaw }), play('cast', 2.5, { yaw: F.yaw })); }
function planChurch(a) { const C = a.church; if (!a.st) { a.st = 1; const P = [C.lot[0] ? C.lot : [a.x, a.z]].concat(C.path || [], [C.door]); a.x = P[0][0]; a.z = P[0][1]; a.push(walk(P, 1.0), play('talk', rr(5, 20)), { k: 'hide', on: true }, play('idle', rr(40, 70) * 60 / S.timeWarp)); return; }
  if (a.st === 1) { a.st = 2; a.push({ k: 'hide', on: false }, play('talk', rr(10, 40)), walk([C.door].concat((C.path || []).slice().reverse(), [C.lot]), 1.0), call(despawn)); } }
function planCrew(a) { const L = a.walkway; a.push(walk(L, 1.1), play(R() < 0.5 ? 'work' : 'talk', rr(10, 30)), walk(L.slice().reverse(), 1.1), play('idle', rr(5, 15))); }
/* animals: herd behaviour inside the pasture; graze most of the time, walk short legs between grazing spots, swish / alert / lie (more at night & midday heat);
   foals stay within 2-5 m of their dam; chickens peck/scratch near the coop; the barn cat / dog wanders the barnyard and sleeps */
function planAnimal(a) { const Z = a.zone, sp = a.spc; const night = S.hour < 6 || S.hour > 20.5, noon = S.hour > 12 && S.hour < 15;
  if (a.dam && a.dam.alive) { const dd = Math.hypot(a.dam.x - a.x, a.dam.z - a.z); if (dd > 5 * S.u) { const tx = a.dam.x + rr(-2, 2) * S.u, tz = a.dam.z + rr(-2, 2) * S.u; if (inPoly(tx, tz, Z.P) && zoneLOS(Z, [a.x, a.z], [tx, tz])) { a.push(walk([[a.x, a.z], [tx, tz]], sp.trot || 1.3)); return; } } }
  const r = R(), lie = night ? 0.45 : noon ? 0.15 : 0.04;
  if (sp.kind === 'chicken') { if (r < 0.35) { const t = polyTarget(Z, a.x, a.z, 3 * S.u, 0.15 * S.u); if (t) a.push(walk([[a.x, a.z], t], rr(0.25, 0.5))); } else a.push(play(r < 0.75 ? 'peck' : r < 0.9 ? 'scratch' : 'idle', rr(2, 6))); return; }
  if (r < lie) { a.push(play('alert', 3), play('lie', rr(60, 400))); return; }
  if (r < lie + 0.33) { const t = polyTarget(Z, a.x, a.z, (sp.roam || 12) * S.u, (sp.r || 1.2) * S.u); if (t) { a.push(walk([[a.x, a.z], t], rr(0.8, 1.1) * (sp.walk || 1))); return; } }
  if (r < lie + 0.40) { a.push(play('swish', 3)); return; } if (r < lie + 0.46) { a.push(play('alert', 4)); return; }
  if (sp.graze) a.push(play('graze', rr(15, 60))); else a.push(play('idle', rr(8, 25))); }
/* ------------------------------------------------------------------ vehicles: drive graph follower with accel/decel + wheel spin + driver */
/* [R37 A6] keep right: the drive graph is road centrelines -> shift interior route points 1.7 m (half a lane) to the right of travel (mitred, capped
   on sharp corners); the route starts where the vehicle already stands (no snap back to the centreline) and ends on the curb point unchanged. */
function laneOff(P, v) { if (!P || P.length < 3) return P; const off = (S.o.laneOff != null ? S.o.laneOff : 1.7) * S.u, Q = P.map(p => p.slice());
  for (let i = 1; i < P.length - 1; i++) { const a = P[i - 1], b = P[i], c = P[i + 1]; let d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = c[0] - b[0], d2z = c[1] - b[1]; const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1; d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    let nx = -(d1z + d2z), nz = d1x + d2x; const nl = Math.hypot(nx, nz); if (nl < 0.2) continue; nx /= nl; nz /= nl; const cos = nx * -d1z + nz * d1x, k = Math.min(1.6, 1 / Math.max(0.3, cos));
    const f0 = i === P.length - 2 ? 0.5 : 1, rr = 1.35 * S.u, okB = (x, z) => !S.surf || S.surf.ok(x, z, rr, 'track-ok');   // [R37 A5] never shift the van box into a footprint
    let put = null; for (const f of [f0, f0 * 0.5, 0]) { const x = b[0] + nx * off * k * f, z = b[1] + nz * off * k * f; if (okB(x, z) || f === 0) { put = [x, z]; break; } }
    Q[i] = put; }
  if (v && v.o && v.o.visible && !v.q.length && Math.hypot(v.x - Q[0][0], v.z - Q[0][1]) > 0.02 * S.u) Q.unshift([v.x, v.z]);   /* [R38] leave via the route start node (back along the curb approach); replacing P[0] with the van position cut a diagonal from the curb to P[1] across lots (UPS at MR1, mail at CHURCH) */   /* [R38b] only for a leg queued while the van is idle: a round queues every leg up front, so later legs got the DEPOT prepended -> straight diagonals from the depot across MR1 / CHURCH / DINER / MED-office / COOP-seed */
  return Q; }
class Vehicle {
  constructor(asset, kind) { this.A = S.assets[asset]; this.kind = kind; this.o = this.A.scene.clone(true); this.o.scale.setScalar(S.sc); S.g.add(this.o); this.x = 0; this.z = 0; this.yaw = 0; this.v = 0; this.q = []; this.id = NID++;
    this.wheels = []; this.o.traverse(n => { if (/^wheel_/.test(n.name)) this.wheels.push(n); }); this.R = (+this.A.ex.wheel_r_m || 0.4) * S.u; this.doors = ['door_l', 'door_r'].map(n => findNode(this.o, n)).filter(Boolean); this.d0 = this.doors.map(d => d.position.x);
    this.door = 0; this.doorT = 0; this.o.visible = false; }
  drive(P, vmax, stopAtEnd) { this.q.push({ P: laneOff(P, this), vmax, stop: stopAtEnd !== false, i: 1 }); }
  step(dt) { const tk = this.q[0]; if (!tk) { this.v = 0; return; } if (tk.fn) { if (tk.fn(this, dt)) this.q.shift(); return; }
    const P = tk.P; if (tk.i === 1 && tk.init == null) { tk.init = 1; if (P.length) { this.x = P[0][0]; this.z = P[0][1]; } }
    let rem = 0; for (let i = tk.i; i < P.length; i++) rem += Math.hypot(P[i][0] - (i === tk.i ? this.x : P[i - 1][0]), P[i][1] - (i === tk.i ? this.z : P[i - 1][1]));
    const vmax = tk.vmax * S.u, a = 1.6 * S.u, vstop = tk.stop ? Math.max(rem > 0.02 * S.u ? 0.6 * S.u : 0, Math.sqrt(2 * a * Math.max(0, rem - 0.2 * S.u))) : vmax;
    // corner slowdown: look at the next turn angle
    const B = P[tk.i]; let vt = Math.min(vmax, vstop); if (B && tk.i + 1 < P.length) { const C = P[tk.i + 1], t1 = yawOf(B[0] - this.x, B[1] - this.z), t2 = yawOf(C[0] - B[0], C[1] - B[1]); const da = Math.abs(angWrap(t2 - t1)); const dB = Math.hypot(B[0] - this.x, B[1] - this.z); if (da > 0.5 && dB < 12 * S.u) vt = Math.min(vt, Math.max(2.5 * S.u, vmax * (1 - da / 2))); }
    this.v += Math.max(-2.5 * a * dt, Math.min(a * dt, vt - this.v)); let s = this.v * dt;
    while (s > 0 && tk.i < P.length) { const Q = P[tk.i], dx = Q[0] - this.x, dz = Q[1] - this.z, d = Math.hypot(dx, dz); if (d > 1e-5) this.yaw += angWrap(yawOf(dx, dz) - this.yaw) * Math.min(1, s / (2.2 * S.u)) * 2.0;
      if (d <= s) { this.x = Q[0]; this.z = Q[1]; s -= d; tk.i++; } else { this.x += dx / d * s; this.z += dz / d * s; s = 0; } }
    for (const w of this.wheels) w.rotation.z -= this.v * dt / this.R;
    if (tk.i >= P.length) { this.v = tk.stop ? 0 : this.v; this.q.shift(); } }
  wait(sec) { this.q.push({ fn: (v, dt) => (v.v = 0, (v._w = (v._w || 0) + dt) >= sec ? (v._w = 0, true) : false) }); }
  run(fn) { this.q.push({ fn: (v) => (fn(v), true) }); }
  setDoor(open) { this.door = open ? 1 : 0; }
  pose(dt) { this.doorT += Math.sign(this.door - this.doorT) * Math.min(Math.abs(this.door - this.doorT), dt / 0.9); this.doors.forEach((d, i) => d.position.x = this.d0[i] - this.doorT * 0.80 * 1000 / 160);
    const y = S.o.heightAt ? S.o.heightAt(this.x, this.z) : 0; this.o.position.set(this.x, y, this.z); this.o.rotation.set(0, this.yaw, 0); }
  nodeWorld(n, out) { const o = findNode(this.o, n); this.o.updateMatrixWorld(true); return o ? o.getWorldPosition(out) : out.set(this.x, 0, this.z); }
}
/* [R37 A7] no U-turns in the street: when the next route would start back the way the van came (dir = its arrival heading), it first drives
   on to a turnaround node (dead end = driveway / lot spur end / cul-de-sac, degree 1) and turns there; else it keeps going and loops round. */
function fwdRoute(D, cur, to, dir) { const P = D.route(cur, to); if (!P || P.length < 2 || !dir) return P; const C = D.N[cur];
  const d0 = [P[1][0] - C[0], P[1][1] - C[1]], l0 = Math.hypot(d0[0], d0[1]) || 1; if ((d0[0] * dir[0] + d0[1] * dir[1]) / l0 > -0.3) return P;
  const L = Q => { let s = 0; for (let i = 1; i < Q.length; i++) s += Math.hypot(Q[i][0] - Q[i - 1][0], Q[i][1] - Q[i - 1][1]); return s; };
  if (D.adj[cur].length <= 2) return P;   // already at a dead end: turn here
  let best = null, bl = 1e18; const A = D.adj[cur];
  for (let i = 0; i < A.length; i += 2) { const nx = A[i], N = D.N[nx], dd = [N[0] - C[0], N[1] - C[1]], ll = Math.hypot(dd[0], dd[1]) || 1; if ((dd[0] * dir[0] + dd[1] * dir[1]) / ll < 0.3) continue;
    const ends = []; for (let j = 0; j < D.N.length; j++) if (D.adj[j].length === 2 && j !== cur) ends.push([(D.N[j][0] - N[0]) ** 2 + (D.N[j][1] - N[1]) ** 2, j]);
    ends.sort((a, b) => a[0] - b[0]);
    for (const [, e] of ends.slice(0, 12)) { const P1 = D.route(nx, e); if (!P1 || (P1.length > 1 && P1[1] === C)) continue; const P2 = D.route(e, to); if (!P2) continue; const Q = [C].concat(P1, P2.slice(1)), l = L(Q); if (l < bl) { bl = l; best = Q; } } }
  return best && bl < 6 * L(P) + 40 ? best : P; }
const lastDir = P => P && P.length > 1 ? [P[P.length - 1][0] - P[P.length - 2][0], P[P.length - 1][1] - P[P.length - 2][1]] : null;
/* UPS / mail delivery round: depot -> stops (route on the drive graph) -> each stop: park at the curb point, door open, driver steps out with the
   parcel (pickup clip, parcel attached to bone 'carry'), walks the validated curb->door path (carry clip), drop clip at the door (parcel left
   on the step), walks back (walk), gets in, door closes, drives on. Parcels are a fixed pool and are collected (removed) after 'parcelLife' s. */
/* [R36] porch spot for a home stop: walk in from the curb-side door point along the facade normal, ray-casting the placed house model
   straight down; the last raised floor (porch deck / stoop, 0.03-0.35 in above grade) before the wall = the spot by the front door.
   No raised floor -> the grade spot at the foot of the wall (door step). Result in group-local [x, z, y]; cached per stop. */
function porchSpot(st) { if (st._ps !== undefined) return st._ps; st._ps = null; const E = window.L3D && L3D.ext && L3D.ext.placed; if (!E) return null;
  const n = [Math.cos(st.doorYaw), -Math.sin(st.doorYaw)], g = S.g; g.updateMatrixWorld(true); const W = new THREE.Vector3(st.door[0], 0, st.door[1]); g.localToWorld(W);
  const objs = []; const bb = new THREE.Box3(); const sc = window.__layout3d && __layout3d.api && __layout3d.api.scene; const cand = sc ? sc.children.filter(o => o !== g && o.visible) : E.map(pl => pl.o).filter(Boolean);
  for (const o0 of cand) o0.traverse(o => { if (!o.isMesh || o.isSkinnedMesh || !o.visible) return; if (o.isInstancedMesh) { if (o.count < 400) objs.push(o); return; } if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); if (bb.max.x - bb.min.x > 40 || bb.max.z - bb.min.z > 40) return; if (bb.distanceToPoint(new THREE.Vector3(W.x, Math.min(Math.max(W.y, bb.min.y), bb.max.y), W.z)) < 1.8) objs.push(o); }); if (!objs.length) { (S.psLog = S.psLog || []).push({ name: st.name, door: st.door, objs: 0 }); return null; }
  const rc = new THREE.Raycaster(); const P = new THREE.Vector3(), up = W.y;
  const floorAt = (x, z) => { P.set(x, 0, z); g.localToWorld(P); const h0 = S.o.heightAt ? S.o.heightAt(x, z) : 0; rc.set(new THREE.Vector3(P.x, P.y + h0 + 6, P.z), new THREE.Vector3(0, -1, 0)); rc.far = 1e9;
    let y = h0; for (const q of rc.intersectObjects(objs, false)) { const dh = q.point.y - P.y - h0; if (dh < 0.35 && dh > y - h0) y = h0 + dh; } return y; };   /* highest floor below 0.35 in (porch roof / eaves ignored) */
  /* facade distance: horizontal rays inward at 0.2 in above the floor, 5 lateral offsets, median (thin porch posts do not count) */
  const t0 = [-0.4, -0.2, 0, 0.2, 0.4].map(o => { const x = st.door[0] - n[1] * o, z = st.door[1] + n[0] * o, y = floorAt(x, z) + 0.2; P.set(x, y, z); g.localToWorld(P); rc.set(P.clone(), new THREE.Vector3(-n[0], 0, -n[1]).transformDirection(g.matrixWorld)); rc.far = 2.5; const h = rc.intersectObjects(objs, false)[0]; S._psd = (S._psd || []).concat([[o, h ? +h.distance.toFixed(2) : null, h ? h.object.name : '']]); return h ? h.distance : 9; }).sort((a, b) => a - b)[2];
  let r = null, last = null; if (t0 < 2.5) { const t = Math.max(0, t0 - 0.12), x = st.door[0] - n[0] * t, z = st.door[1] - n[1] * t, y = floorAt(x, z); r = [x, z, y]; last = y - (S.o.heightAt ? S.o.heightAt(x, z) : 0) > 0.03 ? r : null; }
  st._ps = r; (S.psLog = S.psLog || []).push({ name: st.name, door: st.door, objs: objs.length, psd: S._psd, r, deck: !!last }); return r; }
function deliveryRound(v, drv, stops, opts) {
  const D = S.drive; let cur = D.nearest(v.x, v.z);
  const len = P => { let l = 0; for (let i = 1; i < (P || []).length; i++) l += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return P ? l : 1e18; };
  const left = stops.slice(), ord = []; let c0 = cur; while (left.length) { let bi = 0, bl = 1e18; left.forEach((st, i) => { const l = len(D.route(c0, D.nearest((st.via || st.curb)[0], (st.via || st.curb)[1]))); if (l < bl) { bl = l; bi = i; } }); const st = left.splice(bi, 1)[0]; ord.push(st); c0 = D.nearest((st.via || st.curb)[0], (st.via || st.curb)[1]); }
  let dir = null; for (const st of ord) { const to = D.nearest((st.via || st.curb)[0], (st.via || st.curb)[1]); const P = fwdRoute(D, cur, to, dir); if (!P) continue; v.drive(P.concat([st.curb]), opts.vmax || 11); dir = lastDir(P.concat([st.curb])); cur = to;
    if (opts.mailbox && st.mailbox) { v.wait(0.4); v.run(() => { drv.reach = 1; }); v.wait(5); v.run(() => { drv.reach = 0; S.count.mail++; }); continue; }
    v.run(vv => { vv.setDoor(true); }); v.wait(1.0);
    v.q.push({ fn: (vv, dt) => { if (!drv.out) { drv.out = 1; drv.onFoot = true; const ex = vv.nodeWorld('exit_r', _v); let side = -1; { const lx = 2 * vv.x - ex.x, lz = 2 * vv.z - ex.z; if (Math.hypot(lx - st.door[0], lz - st.door[1]) < Math.hypot(ex.x - st.door[0], ex.z - st.door[1])) { ex.x = lx; ex.z = lz; side = 1; } }   /* [R36 P12] P70 sliding doors both sides: step out on the CURB (door) side, never into the street */
          drv.x = ex.x; drv.z = ex.z; drv.yaw = vv.yaw + side * Math.PI / 2;
          const parcel = S.parcels.get(); drv.q.length = 0; const PS = st.business ? null : porchSpot(st);   /* [R36] homes: on the porch by the front door */
          drv.push(play('pickup', 2, { at: [{ t: 1.0, fn: d => { d.held = parcel; } }] }), walk([[drv.x, drv.z]].concat(st.path || [], [st.door]), 1.35, 'carry'),
                   ...(PS ? [call(d => { d.y = PS[2]; }), walk([st.door, [PS[0], PS[1]]], 0.9, 'carry')] : []),
                   play('drop', 2, { yaw: st.doorYaw, at: [{ t: 1.0, fn: d => { const pp = d.held; S.parcels.place(pp, PS ? PS : st.door, st.doorYaw); if (st.business) { pp.t = S.time - S.o.parcelLife + 4; S.count.inside = (S.count.inside || 0) + 1; } else S.count.porch = (S.count.porch || 0) + 1; d.held = null; S.count.parcels++; /* [R36 P12] business: handed in at the counter (gone after 4 s); residence: left on the porch step until parcelLife */ } }] }),
                   ...(PS ? [walk([[PS[0], PS[1]], st.door], 0.9), call(d => { d.y = null; })] : []), walk([st.door].concat((st.path || []).slice().reverse(), [[ex.x, ex.z]]), 1.45), call(d => { d.out = 2; })); }
        if (drv.out === 2) { drv.out = 0; drv.onFoot = false; return true; } return false; } });
    v.run(vv => vv.setDoor(false)); v.wait(1.0); }
  const home = D.nearest(opts.depot[0], opts.depot[1]); const P = fwdRoute(D, cur, home, dir); if (P) v.drive(P, opts.vmax || 11); v.run(vv => { vv.done = true; });
}
class ParcelPool { constructor(A, n) { this.A = A; this.list = []; this.n = n; this.k = 0; }
  get() { let p = this.list.find(q => !q.used); if (!p) { if (this.list.length < this.n) { const o = this.A.scene.clone(true); o.scale.setScalar(S.sc); S.g.add(o); p = { o, used: false, t: 0 }; this.list.push(p); } else { p = this.list.reduce((a, b) => a.t < b.t ? a : b); } }
    p.used = true; p.placed = false; p.o.visible = true; p.t = S.time; return p; }
  place(p, at, yaw) { if (!p) return; p.placed = true; p.t = S.time; const y = S.o.heightAt ? S.o.heightAt(at[0], at[1]) : 0; p.o.position.set(at[0], at[2] != null ? at[2] : y, at[1]); p.o.rotation.set(0, yaw || 0, 0); }
  tick() { for (const p of this.list) if (p.used && p.placed && S.time - p.t > S.o.parcelLife) { p.used = false; p.o.visible = false; } }
}
/* ------------------------------------------------------------------ forklift work cycles
   site = { id, home:[x,z], lanes:{nodes:[[x,z,y?]...], edges:[[a,b]]}, stations:[{id, kind:'stack'|'car'|'truck', approach:[x,z,y?], yaw, deckY, slots:[[x,z,y?,yaw?]...],
            load:'prop-pallet-boxes'|'prop-pallet-bags'|'prop-lumber-bundle', count, unitH, ready?:fn}], tasks:[{from, to, weight}] }
   cycle: travel (forks 0.15 m, mast tilted back) to the 'from' approach -> stop 1.2 m short, lower forks to the load's pocket height, tilt level,
   creep forward fork length (insert), lift 0.12 m, tilt back 6 deg -> reverse 3 m with a 60-90 deg turn -> travel loaded (2.2 m/s, 1.0 on ramps /
   bridge plates, look_back clip while reversing) -> 'to' approach, raise to the slot's deck height + 0.10, creep in, tilt level, lower until the
   load rests (re-parented to the world at the slot: counts change from->to), back out, lower forks, return. */
const carOK = st => !st.carSpot || !S.o.carAt || !!S.o.carAt(st.carSpot[0], st.carSpot[1], 0.3);
class Forklift {
  constructor(site) { const A = S.assets.forklift; this.A = A; this.site = site; this.o = A.scene.clone(true); this.o.scale.setScalar(S.sc); S.g.add(this.o); this.id = NID++;
    const f = n => findNode(this.o, n); this.n = { mast: f('mast'), inner: f('mast_inner'), car: f('carriage'), load: f('load'), sw: f('steering_wheel'), ll: f('lever_lift'), lt: f('lever_tilt'), srl: f('steer_rl'), srr: f('steer_rr'), seat: f('seat') };
    this.wheels = []; this.o.traverse(n => { if (/^wheel_/.test(n.name)) this.wheels.push(n); });
    this.car0 = this.n.car.position.y; this.in0 = this.n.inner.position.y; this.lift = 0.15; this.tilt = 0; this.x = site.home[0]; this.z = site.home[1]; this.y = null; this.yaw = site.homeYaw || 0; this.v = 0; this.steer = 0; this.q = []; this.held = null;
    const G = site.lanes; this.G = new Graph(G, null, 0, 'lanes:' + site.id);
    // [R36 P6] drawn steel bridge plate for car stations flagged plate:[x0,y0,x1,y1,w] (dock edge x0/y0 -> car door x1/y1, width w); kit plates (CCF) are not flagged
    for (const st of site.stations || []) if (st.plate) { const [x0, y0, x1, y1, w] = st.plate, L = Math.hypot(x1 - x0, y1 - y0, 0) || 0.1, dy = y1 - y0;
      const m = new T.Mesh(new T.BoxGeometry(Math.hypot(L, dy), 0.035, w), new T.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.7, roughness: 0.45 }));
      m.name = 'bridge-plate:' + site.id; const c = st.plate[5] != null ? st.plate[5] : st.carSpot[1]; if (st.plate[6]) { m.position.set(c, (y0 + y1) / 2 - 0.018, (x0 + x1) / 2); m.rotation.set(0, Math.PI / 2, 0); m.rotateZ(Math.atan2(dy, x0 - x1)); } else { m.position.set((x0 + x1) / 2, (y0 + y1) / 2 - 0.018, c); m.rotation.set(0, 0, Math.atan2(dy, x1 - x0)); } S.g.add(m); }
    this.op = new Actor(site.operator || 'person-operator', 'op', () => {}); this.op.ride = this; S.actors.push(this.op);
    /* [R36] dedicated seated operator: own skinned clone parented to the forklift's 'seat' node (moves with it, never pooled / culled / bind-posed);
       the old pooled actor stood at the seat's WORLD y inside the deck-offset life group, i.e. one deck too high, so forklifts looked driverless */
    { const OA = S.assets[site.operator] || S.assets['person-operator']; if (OA && OA.skinned && this.n.seat) { const root = skClone(OA.scene); root.name = 'fk-operator'; root.userData.operatorOf = 'forklift'; const mixer = new T.AnimationMixer(root), act = {};
        for (const c of OA.clips) act[c.name] = mixer.clipAction(c); this.n.seat.add(root); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.setScalar(1); this.opk = { root, mixer, act, cur: null }; this.op.vis = false; this.op.cls = 'op-seated'; } }
    for (const st of site.stations) { st.units = st.units || []; st.max = st.max || st.slots.length; const A2 = S.assets[st.load]; for (let i = 0; i < (st.count || 0) && i < st.slots.length; i++) st.units.push(this.makeUnit(A2, st, i)); } }
  makeUnit(A, st, i) { const o = A.scene.clone(true); o.scale.setScalar(S.sc); S.g.add(o); const u = { o, kind: st.load }; this.setAt(u, st.slots[i], st); return u; }
  setAt(u, s, st) { this.site.parent && 0; S.g.attach(u.o); const y = s[2] != null ? s[2] : (st.deckY != null ? st.deckY : (S.o.heightAt ? S.o.heightAt(s[0], s[1]) : 0)); u.o.position.set(s[0], y, s[1]); u.o.rotation.set(0, s[3] != null ? s[3] : (st.yaw || 0), 0); u.o.scale.setScalar(S.sc); }
  /* [R36] car stations with a carSpot: worked only while a car stands on the spot; when the car leaves, the loads it carried leave with it */
  carSync() { for (const st of this.site.stations) { if (!st.carSpot || !S.o.carAt) continue; const c = S.o.carAt(st.carSpot[0], st.carSpot[1], 0.3); if (c !== st.car) { if (st.car && !c) { for (const u of st.units) { u.o.parent && u.o.parent.remove(u.o); } st.units = []; } st.car = c; } } }
  plan() { this.carSync(); const st = this.site.stations, T0 = this.site.tasks; const ok = T0.filter(t => { const a = st.find(s => s.id === t.from), b = st.find(s => s.id === t.to); return a && b && a.units.length && b.units.length < b.max && (!a.ready || a.ready()) && (!b.ready || b.ready()) && carOK(a) && carOK(b); });
    if (!ok.length || tod('work') < 0.2) { this.q.push({ k: 'goto', p: this.site.home, yaw: this.site.homeYaw }, { k: 'wait', t: 20 }); return; }
    let w = 0; for (const t of ok) w += t.weight || 1; let r = R() * w, t = ok[0]; for (const x of ok) { r -= x.weight || 1; if (r <= 0) { t = x; break; } }
    const A = st.find(s => s.id === t.from), B = st.find(s => s.id === t.to); const ins = 1.15 * S.u;
    const pocket = s => (s.pocket != null ? s.pocket : (s.load === 'prop-lumber-bundle' ? 0.02 : 0.035));   // fork-tine bottom height: pallet pocket 0.02-0.11 m, bundle bunks 0.09 m
    // approach pose: the forklift stops so that one fork-length creep puts the 'load' node (1.11 m ahead of the front axle) over the slot
    const appr = (s, i) => { const q = s.slots[i], yw = s.yaw || 0, k = (1.11 + 1.15) * S.u; return [q[0] - Math.cos(yw) * k, q[1] + Math.sin(yw) * k, s.floorY != null ? s.floorY : (q[2] != null && s.kind === 'car' && s.deckY != null ? s.deckY : (s.deckY != null ? s.deckY : 0))]; };
    const ia = A.units.length - 1, ib = B.units.length; const pa = appr(A, ia), pb = appr(B, ib); if (B.groundFloor) pb[2] = 0; if (A.groundFloor) pa[2] = 0;
    const floorA = pa[2] / S.u, floorB = pb[2] / S.u, ya = (A.slots[ia][2] != null ? A.slots[ia][2] : 0) / S.u - floorA, yb = (B.slots[ib][2] != null ? B.slots[ib][2] : 0) / S.u - floorB;
    const side = R() < 0.5 ? 1 : -1;
    this.q.push({ k: 'goto', p: pa, yaw: A.yaw }, { k: 'mast', lift: pocket(A) + ya, tilt: 0 }, { k: 'creep', d: ins }, { k: 'pick', st: A },
      { k: 'mast', lift: pocket(A) + ya + 0.12, tilt: 6 }, { k: 'creep', d: -(A.backDist != null ? A.backDist : 3) * S.u, turn: A.backTurn != null ? A.backTurn : 70, side },
      { k: 'mast', lift: 0.25, tilt: 6 }, { k: 'goto', p: pb, yaw: B.yaw, loaded: true }, { k: 'mast', lift: yb + pocket(B) + 0.12, tilt: 6 }, { k: 'creep', d: ins },
      { k: 'mast', lift: yb + pocket(B) + 0.12, tilt: 0 }, { k: 'mast', lift: yb + pocket(B) - 0.01, tilt: 0 }, { k: 'drop', st: B },
      { k: 'creep', d: -ins - (B.backDist != null ? B.backDist : 1.5) * S.u, turn: B.backTurn != null ? B.backTurn : 60, side: -side }, { k: 'mast', lift: 0.15, tilt: 3 }); }
  stackH(st, i) { return 0; }
  slotY(B) { const s = B.slots[B.units.length]; const base = (s && s[2] != null ? s[2] : B.deckY || 0) - (B.approach[2] || 0); return base / S.u; }   // lift relative to the floor the forklift stands on (m)
  step(dt) { if ((this._cs = (this._cs || 0) + dt) > 2) { this._cs = 0; if (!this.held && !this.q.some(t => t.k === 'drop' || t.k === 'pick')) this.carSync(); } if (!this.q.length) this.plan(); const tk = this.q[0]; if (!tk) return; if (this[tk.k](tk, dt)) this.q.shift(); }
  goto(tk, dt) { if (!tk.P) { const a = this.G.nearest(this.x, this.z), b = this.G.nearest(tk.p[0], tk.p[1]); tk.P = (this.G.route(a, b) || []).concat([tk.p]); tk.i = 0; }
    const vmax = (tk.loaded ? 2.2 : 3.0) * S.u, acc = 1.0 * S.u; const P = tk.P; if (tk.i >= P.length) { this.v = 0; this.yaw += angWrap((tk.yaw != null ? tk.yaw : this.yaw) - this.yaw) * Math.min(1, dt * 2); return Math.abs(angWrap((tk.yaw != null ? tk.yaw : this.yaw) - this.yaw)) < 0.02; }
    const Q = P[tk.i], dx = Q[0] - this.x, dz = Q[1] - this.z, d = Math.hypot(dx, dz); const ramp = Q.length > 2 && Math.abs((Q[2] || 0) - (this.y || 0)) > 0.01 * S.u; const vt = Math.min(ramp ? 1.0 * S.u : vmax, Math.sqrt(2 * acc * (d + (tk.i < P.length - 1 ? 3 * S.u : 0))));
    this.v += Math.max(-2 * acc * dt, Math.min(acc * dt, vt - this.v)); const want = yawOf(dx, dz), da = angWrap(want - this.yaw); this.steer += (Math.max(-1, Math.min(1, da * 2)) - this.steer) * Math.min(1, dt * 4);
    this.yaw += Math.sign(da) * Math.min(Math.abs(da), (this.v / (2.1 * S.u) + 0.4) * dt); const s = this.v * dt * Math.max(0.2, Math.cos(da));
    if (d <= s || d < 0.05 * S.u) { this.x = Q[0]; this.z = Q[1]; if (Q.length > 2) this.y = Q[2]; tk.i++; } else { this.x += dx / d * s; this.z += dz / d * s; if (Q.length > 2) this.y = (this.y == null ? Q[2] : this.y + (Q[2] - this.y) * Math.min(1, s / d)); }
    this.spin(s); this.op.clip = Math.abs(this.steer) > 0.3 ? 'operate' : 'operate'; return false; }
  creep(tk, dt) { if (tk.e == null) { tk.e = 0; tk.sx = this.x; tk.sz = this.z; tk.y0 = this.yaw; } const sp = (tk.d < 0 ? 1.5 : 0.6) * S.u, dur = Math.abs(tk.d) / sp; tk.e = Math.min(dur, tk.e + dt); const f = tk.e / dur, sm = f * f * (3 - 2 * f);
    const turn = (tk.turn || 0) * DEG * sm * (tk.side || 1); this.yaw = tk.y0 + turn; const dist = tk.d * sm; const ym = tk.y0 + turn * 0.5; const px = this.x;
    this.x = tk.sx + Math.cos(ym) * dist; this.z = tk.sz - Math.sin(ym) * dist; this.spin((this.x - px) * Math.sign(tk.d)); this.op.clip = tk.d < 0 ? 'look_back' : 'operate'; this.steer = tk.turn ? -Math.sign(tk.d) : 0; return tk.e >= dur; }
  mast(tk, dt) { const r = 0.45, tr = 8; const dl = tk.lift - this.lift, dtl = tk.tilt - this.tilt; this.lift += Math.sign(dl) * Math.min(Math.abs(dl), r * dt); this.tilt += Math.sign(dtl) * Math.min(Math.abs(dtl), tr * dt);
    this.op.clip = 'lever'; return Math.abs(dl) < 1e-3 && Math.abs(dtl) < 1e-2; }
  pick(tk) { const u = tk.st.units.pop(); if (u) { this.n.load.attach(u.o); u.o.position.set(0, -(tk.st.load === 'prop-lumber-bundle' ? 0.09 : 0.065) * 1000 / 160, 0); u.o.rotation.set(0, tk.st.forkYaw || 0, 0); u.o.scale.setScalar(1); this.held = u; S.count.moves++; } return true; }
  drop(tk) { const u = this.held; if (u) { const st = tk.st, s = st.slots[st.units.length]; this.setAt(u, s, st); st.units.push(u); this.held = null; } return true; }
  wait(tk, dt) { tk.e = (tk.e || 0) + dt; this.op.clip = 'operate'; return tk.e >= tk.t; }
  spin(s) { for (const w of this.wheels) w.rotation.z -= s / ((/f/.test(w.name.slice(-2)) ? 0.27 : 0.23) * S.u); }
  pose() { const y = this.y != null ? this.y : (S.o.heightAt ? S.o.heightAt(this.x, this.z) : 0); this.o.position.set(this.x, y, this.z); this.o.rotation.set(0, this.yaw, 0);
    const mm = 1000 / 160, L = this.lift * mm, free = 1.2 * mm; this.n.car.position.y = this.car0 + Math.min(L, free) + Math.max(0, L - free) / 2; this.n.inner.position.y = this.in0 + Math.max(0, L - free) / 2;
    this.n.mast.rotation.z = this.tilt * DEG; this.n.sw.rotation.x = this.steer * 2.5; this.n.srl.rotation.y = this.n.srr.rotation.y = -this.steer * 0.9;
    this.n.ll.rotation.z = this.op.clip === 'lever' ? 0.3 : 0; this.o.updateMatrixWorld(true); this.n.seat.getWorldPosition(_v); S.g.worldToLocal(_v); this.op.x = _v.x; this.op.z = _v.z; this.op.y = _v.y; this.op.yaw = this.yaw;
    if (this.opk) { const K = this.opk, w = K.act[this.op.clip] || K.act.operate || K.act.sit; if (w && K.cur !== w) { if (K.cur) K.cur.fadeOut(0.3); w.reset().fadeIn(0.3).play(); K.cur = w; } } }
}

/* ------------------------------------------------------------------ spawning / directors (population per class follows time of day) */
function spawnPerson(asset, cls, plan, x, z) { if (S.actors.length >= S.o.maxActors) return null; const a = new Actor(asset, cls, plan); a.x = x; a.z = z; a.ws = S.assets[asset] ? S.assets[asset].ws : 1; S.actors.push(a); return a; }
const PEDS = ['person-ped-a', 'person-ped-b', 'person-ped-c', 'person-ped-d'];
function director(dt) { const D = S.data; S.dirT -= dt; if (S.dirT > 0) return; S.dirT = 2;
  const have = c => S.actors.filter(a => a.cls === c && a.alive).length, A = id => S.assets[id] ? id : null;
  const nPed = Math.round((D.pedestrians || 12) * tod('ped')); if (S.walk && have('ped') < nPed && D.pois && D.pois.length) { const id = A(pick(PEDS)); if (id) spawnPerson(id, 'ped', planPed, 0, 0); }
  if (S.walk && D.dogLoops !== undefined && have('dogwalk') < Math.round((D.dogWalkers || 2) * tod('dogwalk'))) { const id = A(pick(PEDS)); const dg = A(pick(['dog-lab', 'dog-collie'])); const p = pick(D.pois || [{ p: S.walk.N[0] }]);
    if (id && dg) { const w = spawnPerson(id, 'dogwalk', planDogWalker, p.p[0], p.p[1]); if (w) { const n = S.walk.nearest(w.x, w.z); w.x = S.walk.N[n][0]; w.z = S.walk.N[n][1]; w.trail = new Float32Array(128); w.trailH = 0; w.trailN = 0; w.leash = true;
      const d = spawnPerson(dg, 'dog', planDog, w.x, w.z); if (d) { d.owner = w; w.dog = d; } } } }
  for (const Y of S.yards) { if (Y.kids && !Y.kidA.some(k => k.alive) && tod('kids') > R() + 0.2) { Y.kidA = []; for (let i = 0; i < Y.kids; i++) { const id = A(pick(['kid-a', 'kid-b', 'kid-c'])); if (!id) break; const k = spawnPerson(id, 'kids', planKid, Y.door[0], Y.door[1]); if (k) { k.zone = Y; Y.kidA.push(k); } } }
    if (Y.work && !(Y.worker && Y.worker.alive) && tod('yard') > R() + 0.3) { const k = spawnPerson(A('person-yard') || PEDS[0], 'yard', planYard, Y.door[0], Y.door[1]); if (k) { k.zone = Y; k.tool = 'rake'; Y.worker = k; } } }
  for (const F of D.fishing || []) if (!(F.a && F.a.alive) && tod('angler') > R() + 0.25) { const id = A('person-angler'); if (id) { F.a = spawnPerson(id, 'angler', planAngler, F.from[0], F.from[1]); if (F.a) F.a.spot = F; } }
  if (D.church && tod('church') > 0.5 && have('church') < (D.church.congregation || 12) && R() < 0.5) { const id = A(pick(['person-church', 'person-church-b', 'person-ped-a', 'person-ped-c'])); if (id) { const a = spawnPerson(id, 'church', planChurch, 0, 0); if (a) a.church = D.church; } }
  for (const C of D.crews || []) if (!(C.a && C.a.alive) && tod('work') > 0.5) { const id = A(/customer/.test(C.role || '') ? 'person-ped-b' : /operator/.test(C.role || '') ? 'person-operator' : 'person-crew') || A('person-crew'); if (id) { C.a = spawnPerson(id, 'crew', planCrew, C.walkway[0][0], C.walkway[0][1]); if (C.a) C.a.walkway = C.walkway; } }
  // delivery rounds (UPS: business + homes; mail van: mailboxes) - one vehicle each, a round every 'every' minutes of sim time while 'deliver' is on
  for (const R0 of S.rounds) { if (R0.v.q.length || tod('deliver') < 0.5) continue; if (S.time < R0.next) continue; R0.next = S.time + (R0.every || 600);
    const stops = R0.stops.slice().sort(() => R() - 0.5).slice(0, R0.perRound || 4); R0.v.o.visible = true; R0.v.x = R0.depot[0]; R0.v.z = R0.depot[1]; R0.v.done = false; deliveryRound(R0.v, R0.drv, stops, R0); }
  // school bus: stops in the morning / afternoon windows, kids board/alight between the bus door and the stop
  if (S.bus) { const B = S.bus; if (!B.v.q.length && tod('bus') > 0.5 && S.time > B.next) { B.next = S.time + (B.every || 900); B.v.o.visible = true; B.v.x = B.depot[0]; B.v.z = B.depot[1]; let cur = S.drive.nearest(B.v.x, B.v.z);
      for (const st of B.stops) { const to = S.drive.nearest((st.via || st.curb)[0], (st.via || st.curb)[1]); const P = S.drive.route(cur, to); if (!P) continue; B.v.drive(P.concat([st.curb]), 9); cur = to; B.v.run(() => { const id = A(pick(['kid-a', 'kid-b', 'kid-c'])); if (!id || !st.walk) return; const am = S.hour < 12;
          for (let i = 0; i < (st.kids || 2); i++) { const P2 = am ? st.walk.slice().reverse() : st.walk; const k = spawnPerson(id, 'buskid', kk => { kk.push(walk(P2, 1.2), call(despawn)); }, P2[0][0] + i * 0.6 * S.u, P2[0][1]); } }); B.v.wait(st.dwell || 20); }
      const P = S.drive.route(cur, S.drive.nearest(B.depot[0], B.depot[1])); if (P) B.v.drive(P, 9); B.v.run(v => { v.o.visible = false; }); } }
}

/* ------------------------------------------------------------------ init / update / dispose */
LIFE.init = async function (o) {
  o = Object.assign({}, DEF, o || {}); R = mulberry(o.seed); NID = 0; o.u = o.unitsPerMeter; o.parcelLife = o.parcelLife || 900;
  const g = new T.Group(); g.name = 'life'; (o.scene || o.parent).add(g);
  S = { o, g, data: o.data || {}, u: o.unitsPerMeter, sc: o.glbScale, actors: [], forklifts: [], rounds: [], hour: o.hour, dow: o.dayOfWeek, time: 0, timeWarp: o.timeWarp || 1, dirT: 0, frame: 0,
        count: { parcels: 0, mail: 0, moves: 0 }, skLive: 0, skMade: 0, assets: {}, skins: {}, far: {}, yards: [] };
  S.assets = await loadAll(o.assets || {});
  const D = S.data; S.surf = new Surfaces(D, o);
  const r = o.personR * o.u; if (D.sidewalks) S.walk = new Graph(D.sidewalks, S.surf, r, 'sidewalks'); if (D.drives) S.drive = new Graph(D.drives, null, 0, 'drives');
  for (const Y of D.yards || []) S.yards.push(Object.assign(zone(Y.poly, Y.keep), { door: Y.door, kids: Y.kids || 0, work: !!Y.work, kidA: [] }));
  // pastures: animals placed at valid random points; foals bound to the first adult horse (dam)
  for (const Pa of D.pastures || []) { const Z = zone(Pa.poly, Pa.keep); let dam = null;
    for (const [id, n] of Object.entries(Pa.animals || {})) { if (!S.assets[id]) continue; const ex = S.assets[id].ex; const kind = id.startsWith('chicken') ? 'chicken' : (ex.species || id.split('-')[0]);
      const spc = { kind, graze: !/dog|cat|chicken/.test(id), r: kind === 'chicken' ? 0.15 : kind === 'cat' ? 0.25 : kind === 'dog' ? 0.4 : kind === 'goat' ? 0.5 : 1.3, roam: kind === 'chicken' ? 3 : 14, walk: kind === 'dog' ? 1.1 : kind === 'cat' ? 0.6 : 1 };
      for (let i = 0; i < n; i++) { const p = polyTarget(Z, null, null, 0, spc.r * o.u); if (!p) continue; const a = new Actor(id, 'animal', planAnimal); a.x = p[0]; a.z = p[1]; a.yaw = rr(-Math.PI, Math.PI); a.zone = Z; a.spc = spc; a.ws = S.assets[id].ws; a.turnRate = (kind === 'horse' || kind === 'cow' ? 70 : 160) * DEG;
        if (kind === 'horse' && !dam) dam = a; if (kind === 'foal') a.dam = dam; S.actors.push(a); } } }
  for (const site of D.forkliftSites || []) if (S.assets.forklift) S.forklifts.push(new Forklift(site));
  for (const Rd of D.deliveries || []) { const vid = Rd.vehicle || 'veh-ups-p70'; if (!S.assets[vid] || !S.drive) continue; const v = new Vehicle(vid, Rd.kind); const drv = new Actor(Rd.driver || 'person-ups', 'driver', () => {}); drv.ws = (S.assets[Rd.driver || 'person-ups'] || { ws: 1 }).ws; drv.v = v; S.actors.push(drv); S.rounds.push(Object.assign({ v, drv, next: 0 }, Rd)); }
  if (D.schoolBus && S.drive && S.assets[D.schoolBus.vehicle || 'veh-schoolbus']) S.bus = Object.assign({ v: new Vehicle(D.schoolBus.vehicle || 'veh-schoolbus', 'bus'), next: 0 }, D.schoolBus);
  if (S.assets['prop-parcel']) S.parcels = new ParcelPool(S.assets['prop-parcel'], o.maxParcels || 16);
  // pools: skinned clones per asset (bounded), far instanced meshes sized for the max actors of that asset
  for (const [id, A] of Object.entries(S.assets)) if (A.skinned) { S.skins[id] = new Skin(A, 10, g, S.sc); S.far[id] = new Far(A, Math.min(o.maxActors, 64), g, S.sc); }
  S.leash = new T.LineSegments(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0x202020 })); S.leash.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(6 * 16), 3)); S.leash.frustumCulled = false; g.add(S.leash);
  LIFE.ready = true; return LIFE.stats(); };
LIFE.setHour = h => { if (S) S.hour = ((h % 24) + 24) % 24; };
LIFE.setDay = d => { if (S) S.dow = d; };
const ACT = 'idle';
function applyClip(a, sk, dt) { const want = sk.act[a.clip] || sk.act[ACT] || Object.values(sk.act)[0]; if (!want) return;
  if (sk.cur !== want) { want.reset(); want.enabled = true; const d = want.getClip().duration; if (want.loop !== T.LoopOnce) want.time = ((a.phase + S.time / d) % 1) * d; want.setEffectiveWeight(1).play(); if (sk.cur) sk.cur.crossFadeTo(want, a.clip === 'lie' || sk.cur.getClip().name === 'lie' ? 1.4 : 0.35, false); sk.cur = want; }
  want.timeScale = Math.max(0.1, Math.min(3, a.ts || 1)); }
LIFE.update = function (dt, camera) {
  if (!S || !LIFE.ready) return; dt = Math.min(dt, 0.1); const sdt = dt * S.timeWarp; S.time += sdt; S.frame++;
  director(sdt); if (S.parcels) S.parcels.tick();
  for (const f of S.forklifts) { f.step(sdt); f.pose(); if (f.opk) f.opk.mixer.update(sdt); }
  for (const p of S.parked || []) if (p.K) p.K.mixer.update(sdt);
  for (const Rd of S.rounds) { Rd.v.step(sdt); Rd.v.pose(sdt); const d = Rd.drv; if (!d.onFoot) { Rd.v.nodeWorld('seat_driver', _v); S.g.worldToLocal(_v); /* [R36] group is deck-offset */ d.x = _v.x; d.z = _v.z; d.y = _v.y; d.yaw = Rd.v.yaw; d.clip = d.reach ? 'lever' : 'operate'; d.vis = Rd.v.o.visible; } else { d.y = null; d.vis = true; d.step(sdt); } }
  if (S.bus) { S.bus.v.step(sdt); S.bus.v.pose(sdt); }
  camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); S.g.updateMatrixWorld(); const gy = S.g.matrixWorld.elements[13], gx = S.g.matrixWorld.elements[12], gz = S.g.matrixWorld.elements[14]; const cx = camera.position.x - gx, cz = camera.position.z - gz, cy = camera.position.y - gy;   /* [R36 P12] the life group is deck-offset: LOD distance + frustum in group-local -> world (before: dy = deck height, so no actor was ever near or in view -> no skinned people/animals drawn) */
  const near = S.o.nearLOD * S.u, far = S.o.farLOD * S.u;    // nearLOD / farLOD in REAL metres (defaults 80 / 400 m = 20 / 98 N-scale inches)
  for (const k in S.far) S.far[k].begin(); let li = 0; const lp = S.leash.geometry.attributes.position.array;
  // live actors: sim (far ones at a reduced rate), LOD, animation culling
  for (let i = S.actors.length - 1; i >= 0; i--) { const a = S.actors[i];
    if (!a.alive) { if (a.sk) { S.skins[a.asset].put(a.sk); a.sk = null; } S.actors.splice(i, 1); continue; }
    const y0 = a.y != null ? a.y : (S.o.heightAt ? S.o.heightAt(a.x, a.z) : 0); const dx = a.x - cx, dz = a.z - cz, dy = y0 - cy; a.d2 = dx * dx + dz * dz + dy * dy;
    const farSim = a.d2 > far * far && (S.frame + a.id) % S.o.simRateFar; if (a.cls !== 'driver' && a.cls !== 'op') { if (!farSim) a.step(farSim ? 0 : sdt * (a.d2 > far * far ? S.o.simRateFar : 1)); }
    if (a.trail && (S.frame & 3) === 0) { const h = a.trailH; a.trail[h * 2] = a.x; a.trail[h * 2 + 1] = a.z; a.trailH = (h + 1) % 64; a.trailN = Math.min(64, a.trailN + 1); }
    const A = S.assets[a.asset]; if (!A || !A.skinned) continue;
    _sph.center.set(a.x + gx, y0 + gy + 0.9 * S.u, a.z + gz); _sph.radius = 1.5 * S.u; const inView = _fr.intersectsSphere(_sph);
    if (!a.vis || a.d2 > far * far * 4 || !inView) { if (a.sk) { S.skins[a.asset].put(a.sk); a.sk = null; } if (a.vis && inView && a.d2 <= far * far * 4) S.far[a.asset].put(a.x, y0, a.z, a.yaw); continue; }
    if (a.d2 < near * near && !a.sk) a.sk = S.skins[a.asset].get();
    if (a.d2 > near * near * 1.3 && a.sk) { S.skins[a.asset].put(a.sk); a.sk = null; }
    if (a.sk) { a.sk.root.position.set(a.x, y0, a.z); a.sk.root.rotation.set(0, a.yaw, 0); applyClip(a, a.sk, dt); a.sk.mixer.update(sdt);
      if (a.held) { if (!a.sk.carry) { a.held.o.position.set(a.x + Math.cos(a.yaw) * 0.28 * S.u, y0 + 1.0 * S.u, a.z - Math.sin(a.yaw) * 0.28 * S.u); a.held.o.rotation.set(0, a.yaw, 0); a.held.o.visible = true; } /* [R37 A3] rig without a carry bone: parcel held at chest height in front */ if (a.sk.carry) { a.sk.carry.getWorldPosition(_v); a.held.o.position.set(_v.x, _v.y - 0.125 * S.u, _v.z); a.held.o.rotation.set(0, a.yaw, 0); a.held.o.visible = true; } }
    } else { S.far[a.asset].put(a.x, y0, a.z, a.yaw); if (a.held) { a.held.o.position.set(a.x + Math.cos(a.yaw) * 0.3 * S.u, y0 + 1.0 * S.u, a.z - Math.sin(a.yaw) * 0.3 * S.u); a.held.o.rotation.set(0, a.yaw, 0); } }
    if (a.leash && a.dog && li < 16) { const d = a.dog, hy = y0 + 0.85 * S.u, b = li * 6; lp[b] = a.x; lp[b + 1] = hy; lp[b + 2] = a.z; lp[b + 3] = d.x; lp[b + 4] = (S.o.heightAt ? S.o.heightAt(d.x, d.z) : 0) + 0.45 * S.u; lp[b + 5] = d.z; li++; } }
  for (const k in S.far) S.far[k].end(); S.leash.geometry.setDrawRange(0, li * 2); S.leash.geometry.attributes.position.needsUpdate = true;
};
/* [R36] parked forklifts (replace the static 'load-forklift' props): the rigged forklift glb with a seated operator on its 'seat' node, idle clip */
LIFE.addParked = function (list) { if (!S || !S.assets.forklift) return 0; S.parked = S.parked || []; const OA = S.assets['person-operator'];
  for (const p of list || []) { const o = S.assets.forklift.scene.clone(true); o.name = 'fk-parked'; o.scale.setScalar(S.sc); const y = S.o.heightAt ? S.o.heightAt(p.x, p.z) : 0; o.position.set(p.x, (p.y != null ? p.y : y), p.z); o.rotation.set(0, p.yaw || 0, 0); S.g.add(o);
    const seat = findNode(o, 'seat'); let K = null; if (p.crewed && OA && OA.skinned && seat) {   /* [R36 idle-equipment rule] a parked forklift has NO operator (only p.crewed adds one) */ const root = skClone(OA.scene); root.name = 'fk-operator'; root.userData.operatorOf = 'forklift'; seat.add(root); const mixer = new T.AnimationMixer(root); const c = OA.clips.find(c => c.name === 'operate') || OA.clips.find(c => c.name === 'sit'); if (c) mixer.clipAction(c).play(); K = { root, mixer }; }
    S.parked.push({ o, K }); } return S.parked.length; };
LIFE.forklifts = function () { if (!S) return []; return S.forklifts.map(f => ({ o: f.o, op: f.opk ? f.opk.root : null, kind: 'life' })).concat((S.parked || []).map(p => ({ o: p.o, op: p.K ? p.K.root : null, kind: 'parked' }))); };
LIFE.stats = function () { if (!S) return null; let sk = 0, pooled = 0, far = 0; for (const k in S.skins) { sk += S.skins[k].n - S.skins[k].free.length; pooled += S.skins[k].n; } for (const k in S.far) far += S.far[k].m.count;
  const sites = S.forklifts.map(f => ({ id: f.site.id, units: f.site.stations.reduce((n, s) => n + s.units.length, 0) + (f.held ? 1 : 0), per: Object.fromEntries(f.site.stations.map(s => [s.id, s.units.length])) }));
  return { actors: S.actors.length, byClass: S.actors.reduce((m, a) => (m[a.cls] = (m[a.cls] || 0) + 1, m), {}), skinnedActive: sk, skinnedPooled: pooled, farInstances: far, routesCached: (S.walk ? S.walk.cache.size : 0) + (S.drive ? S.drive.cache.size : 0),
    droppedEdges: S.surf ? S.surf.bad.length : 0, children: S.g.children.length, parcels: S.parcels ? S.parcels.list.length : 0, counts: S.count, sites, hour: S.hour, time: +S.time.toFixed(1) }; };
LIFE.dispose = function () { if (!S) return; S.g.parent && S.g.parent.remove(S.g); S.g.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); S.leash.geometry.dispose(); S = null; LIFE.ready = false; };
LIFE._S = () => S;
})();
