/* layout3d viewer — plan-neutral; reads window.LAYOUT (layout-data.js, written by build_viewer.py from layout.json).
   World units = real inches. World X = plan x, world Z = plan y (plan y points "down"), world Y = up, floor at 0. */
'use strict';
(function () {
const D = window.LAYOUT; if (!D) { document.body.innerHTML = '<p style="color:#fff">layout-data.js missing</p>'; return; }
const QS = new URLSearchParams(location.search);
/* [FLEX] main-line corners are built in flex track: render/run them as clothoid spiral-arc-spiral curves (same TS/ST, tangents, 18 in body); Kato pieces untouched. ?flex=0 shows the drawn polylines */
if (window.L3DEase && QS.get('flex') !== '0' && !D._flexDone) { try { window.LAYOUT_FLEX = L3DEase.flexFromLayout(D.levels); L3DEase.applyLayout(D.levels); D._flexDone = true; } catch (e) { console.warn('flex easements: ' + e.message); } }
const ROADBED = L3D.kato.H + L3D.kato.TIE_H, RAILH = L3D.kato.RAIL, RAILTOP = ROADBED + RAILH, GAUGE2 = L3D.kato.GAUGE / 2, EYE = 67;
const LOGI = !!(L3D.logistics && L3D.logistics.active);   // [LOGI] goal-driven town (assets/logistics.js) replaces the static cars / people / work trucks
const STATS = window.__layout3d = { errors: [], fps: 0, calls: 0, tris: 0, ready: false };
// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: QS.get('aa') !== '0', powerPreference: 'high-performance', logarithmicDepthBuffer: true, preserveDrawingBuffer: QS.has('shot') });
renderer.shadowMap.enabled = false; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x3a3f45);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2500); /* [CHOCO-DIAG] */ window.__choco = { scene, camera, THREE, get orbit() { try { return orbit; } catch (e) { return null; } } } /* [CHOCO-ORBITX] */;
const hemi = new THREE.HemisphereLight(0xfffaf0, 0x6a5a48, 0.62); scene.add(hemi);
const amb = new THREE.AmbientLight(0xffffff, 0.14); scene.add(amb);
const sun = new THREE.DirectionalLight(0xfff4e0, 0.62); scene.add(sun); scene.add(sun.target);
const { rnd, hash, col, WHITE, resample, frames, plen, inPoly, segDist, TEX, canvasTex, noise, T, win, SIGN, signSlot, MAT, mat, Batch, extrude, polyTop, rectTop } = L3D;
// ------------------------------------------------------------------ spatial index (plan coords, per level)
class Grid {
  constructor(cell = 2) { this.cell = cell; this.m = new Map(); }
  add(x, y, v) { const k = Math.floor(x / this.cell) + ',' + Math.floor(y / this.cell); let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(v); }
  near(x, y, r, fn) { const c = this.cell, i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((y - r) / c), j1 = Math.floor((y + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.m.get(i + ',' + j); if (a) for (const v of a) if (fn(v) === false) return false; } return true; }
}
const LV = D.levels.map(L => {
  const g = new THREE.Group(); g.name = 'L' + L.id; scene.add(g);
  const o = { L, deck: L.deck, g, track: new Grid(2), occ: new Grid(2), board: [], polys: L.polys || [], inst: [], detail: [], labels: new THREE.Group() };
  o.labels.visible = false; g.add(o.labels); return o;
});
function onBoard(o, x, y, m = 0) { for (const r of o.L.boards) if (x >= r[0] + m && x <= r[2] - m && y >= r[1] + m && y <= r[3] - m) return true; for (const p of o.polys) if (inPoly(x, y, p)) return true; return false; }
function trackDist(o, x, y, r) { let best = r; o.track.near(x, y, r, v => { const d = Math.hypot(v[0] - x, v[1] - y); if (d < best) best = d; }); return best; }
function nearestTrack(o, x, y, r = 3) { let best = null, bd = r; o.track.near(x, y, r, v => { const d = Math.hypot(v[0] - x, v[1] - y); if (d < bd) { bd = d; best = v; } }); return best; }
function occupied(o, x, y, pad = 0) { let hit = false; o.occ.near(x, y, 3 + pad, v => { if (x > v[0] - pad && x < v[2] + pad && y > v[1] - pad && y < v[3] + pad) { hit = true; return false; } }); return hit; }
function addOcc(o, r) { for (let x = r[0]; x <= r[2] + 2; x += 2) for (let y = r[1]; y <= r[3] + 2; y += 2) o.occ.add(Math.min(x, r[2]), Math.min(y, r[3]), r); }
// pre-index tracks, structures, lots, roads, water, fields
for (const o of LV) {
  const L = o.L; const all = [...L.tracks.map(t => t.pts), ...L.elevator.map(e => e.pts), ...L.turnouts.flatMap(t => [t.thr, t.div])];
  for (const P of all) { const R = resample(P, 0.25), F = frames(R); R.forEach((p, i) => o.track.add(p[0], p[1], [p[0], p[1], F[i][0], F[i][1]])); }
  /* [CHOCO-LOTS-BC] */ if (o.L.id === 2 && !L.lots.some(l => /WL overflow/.test(l.name || ''))) L.lots.push({ name: 'WL overflow parking (drawing only, Owner 12:31; free_space.py)', r: [7.1, 95.5, 13.85, 98.75], kind: 'parking' });
  for (const s of L.structures) addOcc(o, s.r);
  for (const l of L.lots) addOcc(o, l.r);
  for (const rd of L.roads) { const R = resample(rd.pts, 0.5); for (const p of R) addOcc(o, [p[0] - rd.w / 2 - 0.1, p[1] - rd.w / 2 - 0.1, p[0] + rd.w / 2 + 0.1, p[1] + rd.w / 2 + 0.1]); }
  if (!o.terrain) for (const w of L.water) { if (w.ribbon) { for (const p of resample(w.pts, 0.5)) addOcc(o, [p[0] - .8, p[1] - .8, p[0] + .8, p[1] + .8]); } else { const xs = w.pts.map(p => p[0]), ys = w.pts.map(p => p[1]); o.water = (o.water || []).concat([w.pts]); } }
}
function inWater(o, x, y) { return (o.water || []).some(p => inPoly(x, y, p)); }
// ------------------------------------------------------------------ instanced helpers
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
function vcol(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[3 * i] = c.r; a[3 * i + 1] = c.g; a[3 * i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function part(g, x, y, z, c, rx = 0, ry = 0, rz = 0) { g = g.index ? g.toNonIndexed() : g; g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1))); if (g.attributes.uv) g.deleteAttribute('uv'); return vcol(g, col(c)); }
const merge = parts => { const g = THREE.BufferGeometryUtils.mergeBufferGeometries(parts); g.computeBoundingSphere(); return g; };
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d), CYL = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
function instanced(o, geo, items, place, opt = {}) { // items -> InstancedMesh; place(item, i) sets _p,_q,_s,_c
  if (!items.length) return null; if (!geo.attributes.color) vcol(geo, WHITE); const m = new THREE.InstancedMesh(geo, opt.mat || mat(opt.key || 'plain'), items.length);
  items.forEach((it, i) => { _c.setRGB(1, 1, 1); _q.identity(); _s.set(1, 1, 1); place(it, i); if (o.terrain && !opt.abs && Math.abs(_p.y - o.deck) < 0.3) _p.y += o.terrain.h(_p.x, _p.z); /* [TERRAIN-HOOK] */ _m.compose(_p, _q, _s); m.setMatrixAt(i, _m); m.setColorAt(i, _c); });
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.castShadow = !!opt.cast; m.receiveShadow = true; m.computeBoundingSphere && m.computeBoundingSphere();
  (opt.parent || o.g).add(m); if (opt.detail) o.detail.push([m, opt.detail, opt.near || 0]); /* [TERRAIN-HOOK] near = LOD switch-in distance */ return m;
}
// ------------------------------------------------------------------ benchwork, decks, backdrops, fascia, legs, valance
const FASCIA = col('#1d3326'), PLY = col('#b89a6a'), GRASS = col('#ffffff');
const allBoards = LV.flatMap(o => o.L.boards); const ext = allBoards.reduce((e, r) => [Math.min(e[0], r[0]), Math.min(e[1], r[1]), Math.max(e[2], r[2]), Math.max(e[3], r[3])], [1e9, 1e9, -1e9, -1e9]);
LV.forEach(o => o.L.elevator.forEach(e => e.pts.forEach(p => { ext[0] = Math.min(ext[0], p[0] - 2); ext[1] = Math.min(ext[1], p[1] - 2); ext[2] = Math.max(ext[2], p[0] + 2); ext[3] = Math.max(ext[3], p[1] + 2); })));
const CEN = [(ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2];
const OBST = []; // walk-mode collision: {r:[x0,z0,x1,z1]} or {p:poly} or {seg:[a,b,w]}
const TBASE = L3D.terrain ? L3D.terrain.BASE : 0; // [TERRAIN-HOOK] deck surface sits TBASE below grade so water/ditches can dip
const shelves = []; // off-board track runs get a narrow track shelf
for (const o of LV) {
  const L = o.L, bt = new Batch(), y = o.deck, thick = o.L.id === 1 ? 4.75 : 2.75; /* 0.75 in foam: L1 38.75 top, L2 56.75 top / 54.0 underside */
  const edges = [], rectEdges = [];
  for (const r of L.boards) {
    rectTop(bt, 'grass', r, y - TBASE, GRASS, 10, 6); bt.box('plain', r[0], y - thick, r[1], r[2], y - TBASE - 0.02, r[3], FASCIA); /* [FOAM-FIX 2026-10-16] box top under the foam so terrain below 0 (base -0.1, ditches) is not hidden; exposed edges get fascia strips below */
    rectEdges.push([[r[0], r[1]], [r[2], r[1]]], [[r[2], r[1]], [r[2], r[3]]], [[r[2], r[3]], [r[0], r[3]]], [[r[0], r[3]], [r[0], r[1]]]);
    OBST.push({ r }); edges.push([[r[0], r[1]], [r[2], r[1]]], [[r[2], r[1]], [r[2], r[3]]], [[r[2], r[3]], [r[0], r[3]]], [[r[0], r[3]], [r[0], r[1]]]);
  }
  for (const p of o.polys) { polyTop(bt, 'grass', p, y - TBASE, GRASS, 10); OBST.push({ p });
    for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; edges.push([a, b]);
      const ln = Math.hypot(b[0] - a[0], b[1] - a[1]); if (ln < 0.01) continue; const nx = (b[1] - a[1]) / ln, nz = -(b[0] - a[0]) / ln;
      bt.quad('plain', [a[0], y - thick, a[1]], [b[0], y - thick, b[1]], [b[0], y - 0.02, b[1]], [a[0], y - 0.02, a[1]], [0, 0], [1, 0], [1, 1], [0, 1], FASCIA, [nx, 0, nz]);
      bt.quad('plain', [a[0], y - thick, a[1]], [b[0], y - thick, b[1]], [b[0], y - 0.02, b[1]], [a[0], y - 0.02, a[1]], [0, 0], [1, 0], [1, 1], [0, 1], FASCIA, [-nx, 0, -nz]); }
    const c = p.map(q => new THREE.Vector2(q[0], q[1])); if (THREE.ShapeUtils.isClockWise(c)) c.reverse();
    for (const t of THREE.ShapeUtils.triangulateShape(c, [])) { const v = t.map(i => [c[i].x, y - thick, c[i].y]); bt.tri('plain', v[0], v[1], v[2], [0, 0], [0, 0], [0, 0], FASCIA, [0, -1, 0]); } }
  // backdrops on exposed edges facing away from the room centre (wall side); fascia faces the aisle
  const exposed = ([a, b]) => { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ln = Math.hypot(b[0] - a[0], b[1] - a[1]); if (ln < 0.05) return null; /* [CHOCO-BACKDROP] */
    const nx = (b[1] - a[1]) / ln, ny = -(b[0] - a[0]) / ln; for (const s of [1, -1]) { const px = mx + nx * s * 0.6, py = my + ny * s * 0.6; if (!onBoard(o, px, py)) { if (onBoard(o, mx - nx * s * 0.6, my - ny * s * 0.6)) return [nx * s, ny * s]; } } return null; };
  if (TBASE > 0) for (const e of rectEdges) { const n = exposed(e); if (!n) continue; const [a, b] = e; for (const sg of [1, -1]) bt.quad('plain', [a[0], y - TBASE - 0.03, a[1]], [b[0], y - TBASE - 0.03, b[1]], [b[0], y - 0.02, b[1]], [a[0], y - 0.02, a[1]], [0, 0], [1, 0], [1, 1], [0, 1], FASCIA, [n[0] * sg, 0, n[1] * sg]); }
  const bh = L.id === 1 ? (D.levelSeparation - 2.1) : 16;
  for (const e of edges) { const n = exposed(e); if (!n) continue; const [a, b] = e, mx = (a[0] + b[0]) / 2 - CEN[0], my = (a[1] + b[1]) / 2 - CEN[1];
    if (n[0] * mx + n[1] * my <= 0) continue; // faces centre -> aisle side, no backdrop
    (o.backdrops = o.backdrops || []).push([a, b]); // [TERRAIN-HOOK]
    const ln = Math.hypot(b[0] - a[0], b[1] - a[1]), x0 = Math.min(a[0], b[0]), z0 = Math.min(a[1], b[1]);
    const g = bt.b('skyb'); const ex = 0.25 / (ln || 1), A_ = [a[0] - (b[0] - a[0]) * ex, a[1] - (b[1] - a[1]) * ex], B_ = [b[0] + (b[0] - a[0]) * ex, b[1] + (b[1] - a[1]) * ex]; const v = [[A_[0], y, A_[1]], [B_[0], y, B_[1]], [B_[0], y + bh, B_[1]], [A_[0], y + bh, A_[1]]];   /* [CHOCO-BACKDROP] */
    /* [CHOCO-BDUV] u continuous across corners (axis edges exact), repeat-wrapped */ const fU = q => (q[0] + q[1]) / 96; let u0 = fU(A_), u1 = fU(B_); const lnE = ln * (1 + 2 * ex) / 96; if (Math.abs(Math.abs(u1 - u0) - lnE) > 0.02) u1 = u0 + Math.sign(u1 - u0 || 1) * lnE; bt.quad('skyb', v[0], v[1], v[2], v[3], [u0, 0.08], [u1, 0.08], [u1, 1], [u0, 1], WHITE, [-n[0], 0, -n[1]]); }
  // legs (L1) and shelf standards (L2): steel/wood posts at board corners, inset
  const posts = [];
  if (L.id === 1) for (const r of L.boards) for (const [x, z] of [[r[0] + 1.5, r[1] + 1.5], [r[2] - 1.5, r[1] + 1.5], [r[0] + 1.5, r[3] - 1.5], [r[2] - 1.5, r[3] - 1.5]]) posts.push([x, z, 0, y - thick]);
  instanced(o, BOX(1.5, 1, 1.5), posts, p => { _p.set(p[0], (p[2] + p[3]) / 2, p[1]); _s.set(1, p[3] - p[2], 1); _c.set('#9c7b52'); }, { key: 'plain' });
  if (L.id === 2) { // L2 brackets: triangular steel brackets under each board, every 16 in along the wall side
    const br = []; for (const r of L.boards) { const w = r[2] - r[0], d = r[3] - r[1]; const along = w > d; const n = Math.max(2, Math.ceil((along ? w : d) / 16));
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; br.push(along ? [r[0] + w * t, (r[1] + r[3]) / 2, 0, d] : [(r[0] + r[2]) / 2, r[1] + d * t, Math.PI / 2, w]); } }
    instanced(o, BOX(1, 1, 0.25), br, b => { _p.set(b[0], y - thick - 0.6, b[1]); _q.setFromEuler(_e.set(0, b[2], 0)); _s.set(b[3] * 0.9, 1.2, 1); _c.set('#55585c'); }, { key: 'plain' });
    // LED valance strip under L2 (lights L1) along long board axis
    for (const r of L.boards) { const w = r[2] - r[0], d = r[3] - r[1]; if (w > d) bt.box('emis', r[0] + 1, y - thick - 0.06, (r[1] + r[3]) / 2 - 0.4, r[2] - 1, y - thick - 0.02, (r[1] + r[3]) / 2 + 0.4, col('#fffbe8'), 0);
      else bt.box('emis', (r[0] + r[2]) / 2 - 0.4, y - thick - 0.06, r[1] + 1, (r[0] + r[2]) / 2 + 0.4, y - thick - 0.02, r[3] - 1, col('#fffbe8'), 0); }
  }
  // off-board track (e.g. elevator / east loop) gets a 3 in track shelf so nothing floats
  const off = []; for (const P of [...L.tracks.map(t => t.pts), ...L.elevator.map(e => e.pts)]) { const R = resample(P, 0.5); let run = [];
    for (const p of R) { if (!onBoard(o, p[0], p[1], -0.6)) run.push(p); else { if (run.length > 1) off.push(run); run = []; } } if (run.length > 1) off.push(run); }
  for (const run of off) { extrude(bt, 'plain', run, [[-1.5, -thick], [-1.5, 0], [1.5, 0], [1.5, -thick]], y - 0.02, FASCIA); extrude(bt, 'grass', run, [[-1.5, 0], [1.5, 0]], y - 0.01, GRASS, 10); shelves.push(run); OBST.push({ seg: run, w: 1.5 }); }
  o.bt = bt;
}
MAT.skyb = new THREE.MeshBasicMaterial({ map: T.sky(), color: 0xe8e8e8 }); // painted backdrop, evenly lit T.sky().wrapS = THREE.RepeatWrapping;
// elevator: lift platform + guide columns between the decks
const LIFT = (() => { for (const o of LV) for (const r of o.L.routes) if (r.lift) return r.lift; return null; })();
let liftMesh = null;
// [L3 2026-10-16] optional level 3 (future staging) 18 in (levelSeparation) above L2: benchwork shell on the module outline + the lift landing tracks only.
// Enable per plan with build_viewer.py --levels 3 (window.LAYOUT_OPTS.levels) or the URL ?levels=3; trains bound for staging ride the lift to L3 and despawn there.
const NLEV = Math.min(3, Math.max(D.levels.length, +(QS.get('levels') || (window.LAYOUT_OPTS || {}).levels || D.levels.length)));
const deckAbs = i => LV[i] ? LV[i].deck : LV[LV.length - 1].deck + D.levelSeparation * (i - LV.length + 1);
const L3 = NLEV >= 3 && LV[1] && LIFT ? { deck: deckAbs(2), g: new THREE.Group() } : null;
if (L3) { const bt = new Batch(), y = L3.deck, th = 0.75, src = LV[1].L.boards;
  for (const r of src) { bt.box('plain', r[0], y - th, r[1], r[2], y, r[3], PLY); bt.box('plain', r[0] - 0.05, y - th - 1.5, r[1] - 0.05, r[2] + 0.05, y - th, r[1] + 0.7, FASCIA); bt.box('plain', r[0] - 0.05, y - th - 1.5, r[3] - 0.7, r[2] + 0.05, y - th, r[3] + 0.05, FASCIA); }
  for (const p of LV[1].polys || []) { const c = p.map(q => new THREE.Vector2(q[0], q[1])); if (THREE.ShapeUtils.isClockWise(c)) c.reverse(); for (const t of THREE.ShapeUtils.triangulateShape(c, [])) { const v = t.map(i => [c[i].x, y, c[i].y]); bt.tri('plain', v[0], v[1], v[2], [0, 0], [0, 0], [0, 0], PLY, [0, 1, 0]); } }
  /* [L3-STAGING 2026-10-16] staging rev 1 (layout.l3 from tools/rev4_staging.py): one-way loop through the lift + S1-S5 + two #6 ladders,
     with the L2 lift approach (same footprint) copied up; without layout.l3 the empty deck keeps the lift-landing stubs below */
  const S3 = (window.LAYOUT || {}).l3, K = L3D.kato;
  if (S3 && S3.tracks && S3.tracks.length) { const ties = [];
    for (const t of S3.tracks) ties.push(...K.lay(bt, t.pts, y + (t.type === 'main' ? 0 : 0.002)));
    for (const e of LV[1].L.elevator || []) ties.push(...K.lay(bt, e.pts, y + 0.001));
    for (const t of S3.turnouts || []) { const a = t.thr[0], b = t.thr[t.thr.length - 1], h = Math.atan2(b[1] - a[1], b[0] - a[0]), d = t.div[t.div.length - 1];
      const hand = ((d[0] - a[0]) * -Math.sin(h) + (d[1] - a[1]) * Math.cos(h)) >= 0 ? 1 : -1;
      bt.setT(new THREE.Matrix4().compose(new THREE.Vector3(a[0], y + 0.006, a[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -h, 0)), new THREE.Vector3(1, 1, 1))); K.turnout(bt, /#?4\b/.test(t.part || '') ? '#4' : '#6', hand, 0); bt.setT(null); }
    instanced({ g: L3.g, deck: y, detail: LV[1].detail || [] }, K.tieGeoLow(), ties, t => { _p.set(t[0], t[1], t[2]); _q.setFromEuler(_e.set(0, -t[3], 0)); }, { key: 'plain', abs: true });
    L3.staging = { tracks: S3.tracks.length, turnouts: (S3.turnouts || []).length, ties: ties.length }; }
  // lift landing: Kato roadbed + rails to a bumper at each end of the lift (empty L3 deck only)
  if (!L3.staging) for (const [z0, z1, zb] of [[LIFT.y0 - 3, LIFT.y0 - 0.1, LIFT.y0 - 2.8], [LIFT.y1 + 0.1, LIFT.y1 + 3, LIFT.y1 + 2.8]]) {
    bt.box('plain', LIFT.x - K.W / 2, y, z0, LIFT.x + K.W / 2, y + K.H, z1, col(K.colors.roadbed));
    for (let z = z0 + 0.07; z < z1; z += K.TIE_P) bt.box('plain', LIFT.x - K.TIE_L / 2, y + K.H, z, LIFT.x + K.TIE_L / 2, y + K.H + K.TIE_H, z + K.TIE_W, col(K.colors.tie));
    for (const sx of [-1, 1]) bt.box('glossy', LIFT.x + sx * K.GAUGE / 2 - 0.02, y + K.H + K.TIE_H, z0, LIFT.x + sx * K.GAUGE / 2 + 0.02, y + K.H + K.TIE_H + K.RAIL, z1, col(K.colors.rail));
    bt.box('plain', LIFT.x - 0.3, y + K.H, zb - 0.1, LIFT.x + 0.3, y + K.H + 0.25, zb + 0.1, col('#c8a400')); }
  bt.meshes(L3.g); scene.add(L3.g);
  const cv = document.createElement('canvas'), g2 = cv.getContext('2d'); cv.width = 512; cv.height = 48; g2.font = 'bold 28px sans-serif'; g2.fillStyle = '#fff'; g2.strokeStyle = '#000'; g2.lineWidth = 5; const tx = 'L3 STAGING (future) — lift landing'; g2.strokeText(tx, 8, 34); g2.fillText(tx, 8, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false })); sp.scale.set(10.6, 1, 1); sp.position.set(LIFT.x, y + 3, (LIFT.y0 + LIFT.y1) / 2); L3.g.add(sp); }
if (LIFT) {
  const g = merge([part(BOX(2.0, 0.6, LIFT.y1 - LIFT.y0 + 1), 0, -0.3, 0, '#3d4a5a'), part(BOX(2.2, 0.05, LIFT.y1 - LIFT.y0 + 1.2), 0, -0.62, 0, '#888')]);
  liftMesh = new THREE.Mesh(g, mat('plain')); liftMesh.position.set(LIFT.x, LV[0].deck, (LIFT.y0 + LIFT.y1) / 2); scene.add(liftMesh);
  const bt = new Batch(); for (const z of [LIFT.y0 - 0.8, (LIFT.y0 + LIFT.y1) / 2, LIFT.y1 + 0.8]) for (const dx of [-1.4, 1.4]) bt.box('glossy', LIFT.x + dx - 0.25, LV[0].deck - 4, z - 0.25, LIFT.x + dx + 0.25, L3 ? L3.deck + 2 : LV[1] ? LV[1].deck + 2 : LV[0].deck + 20, z + 0.25, col('#b0b6bc'));
  bt.meshes(scene);
}
// ------------------------------------------------------------------ room: floor, walls, ceiling, light panels
const CEILG = new THREE.Group(); scene.add(CEILG);
const ROOM = [ext[0] - 34, ext[1] - 34, ext[2] + 34, ext[3] + 34], CEIL = 96;
{ const bt = new Batch(); rectTop(bt, 'carpet', ROOM, 0, col('#ffffff'), 24);
  const W = [[[ROOM[0], ROOM[1]], [ROOM[2], ROOM[1]], [0, 0, 1]], [[ROOM[2], ROOM[1]], [ROOM[2], ROOM[3]], [-1, 0, 0]], [[ROOM[2], ROOM[3]], [ROOM[0], ROOM[3]], [0, 0, -1]], [[ROOM[0], ROOM[3]], [ROOM[0], ROOM[1]], [1, 0, 0]]];
  for (const [a, b, n] of W) { bt.quad('wall', [a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], CEIL, b[1]], [a[0], CEIL, a[1]], [0, 0], [4, 0], [4, 2], [0, 2], col('#ffffff'), n); bt.box('wood', Math.min(a[0], b[0]) + (n[0] > 0 ? 0 : n[0] < 0 ? -0.6 : 0), 0, Math.min(a[1], b[1]) + (n[2] < 0 ? -0.6 : 0), Math.max(a[0], b[0]) + (n[0] > 0 ? 0.6 : 0), 4, Math.max(a[1], b[1]) + (n[2] > 0 ? 0.6 : 0), col('#e8e2d6'), 8); }
  const cb = new Batch(); cb.quad('plain', [ROOM[0], CEIL, ROOM[1]], [ROOM[2], CEIL, ROOM[1]], [ROOM[2], CEIL, ROOM[3]], [ROOM[0], CEIL, ROOM[3]], [0, 0], [1, 0], [1, 1], [0, 1], col('#efefea'), [0, -1, 0]);
  for (let x = ROOM[0] + 24; x < ROOM[2] - 12; x += 48) for (let z = ROOM[1] + 24; z < ROOM[3] - 12; z += 48) cb.box('emis', x - 12, CEIL - 0.6, z - 24, x + 12, CEIL - 0.1, z + 24, col('#fdfcf5'), 0);
  OBST.push({ walls: ROOM }); bt.meshes(scene); cb.meshes(CEILG); }
// ------------------------------------------------------------------ track: Kato Unitrack from assets/track.js (real roadbed profile, code 80 rail, ties, #6/#4 turnouts, 20-048 bumpers)
const K = L3D.kato;
for (const o of LV) {
  const L = o.L, y = o.deck, ties = [], hi = [];
  const add = (P, lift) => { ties.push(...K.lay(o.bt, P, y + lift)); };
  /* [CHOCO-FLEX] */ const flexTies = [];
  const layFlex = (P, yy) => { const R = L3D.resample(P, 0.5); if (R.length < 2) return; const MMi = K.MM, CW = 24 * MMi, CT = 17 * MMi;
    L3D.extrude(o.bt, 'plain', R, [[-CW / 2, 0], [-CT / 2, K.H], [CT / 2, K.H], [CW / 2, 0]], yy, L3D.col('#a77b4f'), 1.0);
    const top = yy + K.H + K.TIE_H, RR = L3D.resample(P, 0.6); for (const sx of [-K.GAUGE / 2, K.GAUGE / 2]) L3D.extrude(o.bt, 'rail', RR, K.RAILP_MID, top, L3D.col(K.colors.rail), 4, sx);
    const T = L3D.resample(P, 3.9 * MMi), F = L3D.frames(T); T.forEach((p, i) => flexTies.push([p[0], yy + K.H, p[1], Math.atan2(F[i][1], F[i][0])])); };
  L.tracks.forEach(t => { const lift = t.type === 'main' ? 0 : t.type === 'siding' ? 0.002 : 0.004; if (t.sys === 'flex') { /* [CHOCO-J099] */ const J = 20 * K.MM, cut = (P, d) => { let acc = 0; for (let i = 1; i < P.length; i++) { const sl = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (acc + sl >= d) { const f = (d - acc) / sl, q = [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f]; return [P.slice(0, i).concat([q]), [q].concat(P.slice(i))]; } acc += sl; } return null; }; const Lt = t.pts.slice(1).reduce((s2, p, i) => s2 + Math.hypot(p[0] - t.pts[i][0], p[1] - t.pts[i][1]), 0); const c1 = Lt > 3 * J ? cut(t.pts, J) : null, c2 = c1 ? cut(c1[1], Lt - 2 * J) : null; if (c1 && c2) { add(c1[0], lift); layFlex(c2[0], y + lift); add(c2[1], lift); (window.__j099 = window.__j099 || []).push(t.name); } else layFlex(t.pts, y + lift); } else add(t.pts, lift); });
  if (flexTies.length) { const FG = K.tieGeo(14.6 * K.MM); const cellsF = {}; for (const ti of flexTies) { const k = Math.floor(ti[0] / 48) + ',' + Math.floor(ti[2] / 48); (cellsF[k] = cellsF[k] || []).push(ti); }
    for (const list of Object.values(cellsF)) instanced(o, FG, list, t => { _p.set(t[0], t[1] + 0.0005, t[2]); _q.setFromEuler(_e.set(0, -t[3], 0)); _c.setRGB(0.62 + 0.1 * ((t[0] * 5.1 + t[2] * 2.3) % 1), 0.5, 0.42); }, { key: 'plain', detail: 20 }); }
  L.elevator.forEach(e => add(e.pts, 0.001));
  for (const t of L.turnouts) { // place the Kato turnout asset at the points; fall back to generic lay when geometry is odd
    const a = t.thr[0], b = t.thr[t.thr.length - 1], h = Math.atan2(b[1] - a[1], b[0] - a[0]), d = t.div[t.div.length - 1];
    const hand = ((d[0] - a[0]) * -Math.sin(h) + (d[1] - a[1]) * Math.cos(h)) >= 0 ? 1 : -1, kind = /#?4\b|20-22[01]/.test(t.part || t.name || '') ? '#4' : '#6';
    o.bt.setT(new THREE.Matrix4().compose(new THREE.Vector3(a[0], y + 0.006, a[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -h, 0)), new THREE.Vector3(1, 1, 1)));
    K.turnout(o.bt, kind, hand, 0); o.bt.setT(null); }
  const cells = {}; for (const ti of ties) { const k = Math.floor(ti[0] / 48) + ',' + Math.floor(ti[2] / 48); (cells[k] = cells[k] || []).push(ti); }
  const TG = K.tieGeo(); for (const list of Object.values(cells)) instanced(o, TG, list, t => { _p.set(t[0], t[1] + 0.0005, t[2]); _q.setFromEuler(_e.set(0, -t[3], 0)); _c.setScalar(0.88 + 0.24 * ((t[0] * 7.3 + t[2] * 3.1) % 1)); }, { key: 'plain', detail: 20 }); /* [PERF-HOOK] ties 30->20 */
  o.tiesLow = instanced(o, K.tieGeoLow(), ties, t => { _p.set(t[0], t[1], t[2]); _q.setFromEuler(_e.set(0, -t[3], 0)); }, { key: 'plain' });
  for (const bp of L.bumpers) { const v = nearestTrack(o, bp[0], bp[1], 2); let hh = v ? Math.atan2(v[3], v[2]) : 0;
    if (v && trackDist(o, bp[0] + Math.cos(hh) * 1.0, bp[1] + Math.sin(hh) * 1.0, 0.6) < 0.4) hh += Math.PI; // stop faces into the track
    o.bt.setT(new THREE.Matrix4().compose(new THREE.Vector3(bp[0], y + 0.004, bp[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -hh + Math.PI, 0)), new THREE.Vector3(1, 1, 1))); K.bumper(o.bt, 0); o.bt.setT(null); }
}
// ------------------------------------------------------------------ [TERRAIN-HOOK] terrain heightfield + water (assets/terrain.js, water.js, nature.js)
const TCTX = { onBoard, trackDist, nearestTrack, occupied, inWater, QS: new URLSearchParams(location.search),
  inst: (o, geo, items, f, opt) => instanced(o, geo, items, it => { const r = f(it); _p.set(r[0], r[1], r[2]); _q.setFromEuler(_e.set(0, r[3] || 0, 0)); if (r[4]) _s.set(r[4][0], r[4][1], r[4][2]); if (r[5]) _c.copy(r[5]); }, Object.assign({ abs: true }, opt)) };
if (L3D.terrain && TCTX.QS.get('terrain') !== '0') for (const o of LV) { try { L3D.terrain.build(o, TCTX); if (L3D.water) L3D.water.build(o); } catch (e) { console.error('terrain', e); o.terrain = null; } }
if (L3D.terrainReport) window.__layout3d_terrainReport = () => L3D.terrainReport(TCTX);
/* [RV2 Owner] curbed town sidewalks (1.5 m concrete, top 15 cm above the road surface, scored joints every 1.5 m), curb ramps with
   detectable-warning pads, and continental crosswalk bars across the street. All in plan inches (N 1:160). */
const SWALK = { top: 0.022 + 0.0369, mats: null };
function townWalks(o, L, y) { if (!SWALK.mats) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#d9d5cc'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) { const v = 200 + Math.random() * 30; g.fillStyle = `rgb(${v},${v - 3},${v - 9})`; g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
    g.strokeStyle = '#a9a59c'; g.lineWidth = 2; for (const k of [0, 64]) { g.beginPath(); g.moveTo(k + 1, 0); g.lineTo(k + 1, 128); g.stroke(); g.beginPath(); g.moveTo(0, k + 1); g.lineTo(128, k + 1); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.74, 1 / 0.74); t.anisotropy = 4;
    SWALK.mats = [new THREE.MeshLambertMaterial({ map: t }), new THREE.MeshLambertMaterial({ color: 0xc9c5bc })]; SWALK.ramp = new THREE.MeshLambertMaterial({ color: 0xcfcbc2 }); SWALK.warn = new THREE.MeshLambertMaterial({ color: 0xc9a227 }); SWALK.bar = new THREE.MeshLambertMaterial({ color: 0xf2f2ee }); }
  const H = SWALK.top; let n = 0;
  for (const P of o._walks || []) { const sh = new THREE.Shape(P.map(p => new THREE.Vector2(p[0], -p[1]))); const ge = new THREE.ExtrudeGeometry(sh, { depth: H, bevelEnabled: false }); ge.rotateX(-Math.PI / 2); ge.translate(0, y, 0);
    const m = new THREE.Mesh(ge, SWALK.mats); m.receiveShadow = true; m.castShadow = false; m.userData.sidewalk = 1; o.g.add(m); n++; }
  for (const r of L.ramps || []) { const [x, z, a] = r, nx = Math.cos(a), nz = Math.sin(a), ux = -nz, uz = nx, rw = 0.22, run = 0.26, y0 = y + 0.022 + 0.001, y1 = y + H;
    const v = [[x - ux * rw, y0, z - uz * rw], [x + ux * rw, y0, z + uz * rw], [x + ux * rw + nx * run, y1, z + uz * rw + nz * run], [x - ux * rw + nx * run, y1, z - uz * rw + nz * run]];
    const flare = s => [[x + s * ux * rw, y0, z + s * uz * rw], [x + s * ux * (rw + 0.0), y1, z + s * uz * rw + 0 + nz * run * 0 + (s * uz * 0)], [x + s * ux * rw + nx * run, y1, z + s * uz * rw + nz * run]];
    const pos = []; const tri = (A, B, C) => pos.push(...A, ...B, ...C); tri(v[0], v[2], v[1]); tri(v[0], v[3], v[2]);
    for (const s of [-1, 1]) { const F = flare(s), side = [[x + s * ux * rw, y0, z + s * uz * rw], [x + s * ux * rw + nx * run, y1, z + s * uz * rw + nz * run], [x + s * ux * rw + nx * run, y0, z + s * uz * rw + nz * run]]; tri(side[0], s > 0 ? side[1] : side[2], s > 0 ? side[2] : side[1]); }
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g2.computeVertexNormals(); const rm = new THREE.Mesh(g2, SWALK.ramp); rm.material.side = THREE.DoubleSide; rm.receiveShadow = true; o.g.add(rm);
    const w = new THREE.Mesh(new THREE.BoxGeometry(rw * 1.6, 0.003, 0.09), SWALK.warn); w.position.set(x + nx * 0.06, y0 + (y1 - y0) * 0.24 + 0.002, z + nz * 0.06); w.rotation.y = -Math.atan2(uz, ux); w.rotation.z = 0; w.rotateX(Math.atan2(y1 - y0, run)); o.g.add(w); }
  for (const c of L.crosswalks || []) { const [x, z, a, w] = c, ux = Math.cos(a), uz = Math.sin(a), nx = -uz, nz = ux, bw = 0.07, gap = 0.075;
    for (let k = -w / 2 + 0.07; k <= w / 2 - 0.07 + 1e-6; k += bw + gap) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.003, bw), SWALK.bar); b.position.set(x + nx * k, y + 0.0245, z + nz * k); b.rotation.y = -Math.atan2(uz, ux); b.receiveShadow = true; o.g.add(b); }
    for (const sd of [-1, 1]) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.003, w / 2 - 0.05), SWALK.bar); sl.position.set(x + ux * sd * 0.5 + nx * (-sd) * w / 4, y + 0.0245, z + uz * sd * 0.5 + nz * (-sd) * w / 4); sl.rotation.y = -Math.atan2(uz, ux); o.g.add(sl); } }   // stop bars on the approach lanes
  window.__SWALK = (window.__SWALK || 0) + n; }
// ------------------------------------------------------------------ ground scenery: fields, ground covers, water, lots, sidewalks, roads, lines
const GROUND = { row: ['grass', '#b8b08a'], lawn: ['grass', '#e0f0b8'], young: ['grass', '#c8c08a'], brush: ['grass', '#b8bc88'], sand: ['gravel', '#f0e0c0'], salvage: ['gravel', '#8a8070'], gravel: ['gravel', '#ffffff'], cinder: ['gravel', '#9a948c'], marsh: ['marsh', '#ffffff'], grass: ['grass', '#d8e0b0'], pine: ['grass', '#8c9a70'], plant: ['grass', '#9aa878'], cypress: ['marsh', '#a0a890'], apron: ['gravel', '#e0d8c8'], lot: ['gravel', '#d0d0d0'], walk: ['concrete', '#ffffff'], drive: ['gravel', '#ffffff'], road: ['asphalt', '#ffffff'] };
for (const o of LV) {
  const L = o.L, y = o.deck, bt = o.bt;
  if (!o.terrain) for (const f of L.fields) polyTop(bt, f.crop === 'tobacco' ? 'ft' : f.crop === 'cotton' ? 'fc' : 'fp', f.pts, y + 0.008, WHITE, 1.4);
  if (!o.terrain) for (const gr of L.ground || []) { const [k, c] = GROUND[gr.kind] || ['grass', '#c0c8a0']; polyTop(bt, k, gr.pts, y + 0.004, col(c), k === 'grass' ? 10 : 4); }
  for (const w of (o.terrain && o.waterMesh ? [] : L.water)) { /* REAL1: terrain carves + shades the water (water.js); the old flat ribbon floated above the banks as turquoise */ if (w.ribbon) { const R = resample(w.pts, 0.4); extrude(bt, 'marsh', R, [[-1.2, 0], [1.2, 0]], y + 0.006, WHITE, 3); extrude(bt, 'water', R, [[-0.75, 0], [0.75, 0]], y + 0.016, WHITE); }
    else { polyTop(bt, 'marsh', w.pts, y + 0.006, WHITE); const c = w.pts.reduce((a, p) => [a[0] + p[0] / w.pts.length, a[1] + p[1] / w.pts.length], [0, 0]); polyTop(bt, 'water', w.pts.map(p => [c[0] + (p[0] - c[0]) * 0.93, c[1] + (p[1] - c[1]) * 0.93]), y + 0.016, WHITE); } }
  /* [RV1] per-stall stripes from the logistics stalls (they follow each stall's real heading; the old world-aligned stripe texture ignored it) */
  const STRIPED = new Set(); if (LOGI && window.LOGISTICS) { const SL = ['CCF-P', 'MAIN-P', 'TL-court', 'PSP-P', 'YARD-P', 'UPS-court', 'UPS-staff', 'CHURCH-P', 'BOAT', 'STAFF-P', 'DEPOT-P', 'PIPE-P', 'RVD-lot', 'ALB-staff', 'MAIN2-P'], lvn = D.levels.indexOf(L) + 1, seen = new Set();
    for (const p of Object.values(window.LOGISTICS.places || {})) { if (p.kind !== 'stall' || !SL.includes(p.lot) || (lvn > 0 && p.lv !== lvn)) continue; if (lvn <= 0 && !L.lots.some(l => l.r && p.x >= l.r[0] - 0.5 && p.x <= l.r[2] + 0.5 && p.y >= l.r[1] - 0.5 && p.y <= l.r[3] + 0.5)) continue;
      STRIPED.add(p.lot); const ca = Math.cos(p.a), sa = Math.sin(p.a), hl = (p.len || 1.35) / 2, hw = (p.w || 0.675) / 2;
      for (const sd of [-1, 1]) { const cx = p.x - sa * hw * sd, cz = p.y + ca * hw * sd, k = Math.round(cx * 20) + ',' + Math.round(cz * 20); if (seen.has(k)) continue; seen.add(k);
        extrude(bt, 'emis', [[cx - ca * hl, cz - sa * hl], [cx + ca * hl, cz + sa * hl]], [[-0.011, 0], [0.011, 0]], y + 0.017, col('#e6e6de'), 1); }
      /* [R28 item 3] concrete wheel stop 6 ft wide, 2 ft in from the stall head; the first stall of each lot is the ADA (van-accessible) stall: blue field + white symbol + striped access aisle */
      { const wx = p.x + ca * (hl - 0.13), wz = p.y + sa * (hl - 0.13); extrude(bt, 'plain', [[wx + sa * 0.225, wz - ca * 0.225], [wx - sa * 0.225, wz + ca * 0.225]], [[-0.02, 0], [0.02, 0], [0.02, 0.03], [-0.02, 0.03]], y + 0.012, col('#b8b4aa'), 1); }
      if (!seen.has('ada:' + p.lot)) { seen.add('ada:' + p.lot); extrude(bt, 'emis', [[p.x - ca * hl * 0.8, p.y - sa * hl * 0.8], [p.x + ca * hl * 0.8, p.y + sa * hl * 0.8]], [[-hw * 0.85, 0], [hw * 0.85, 0]], y + 0.0175, col('#1f5fb0'), 1);
        extrude(bt, 'emis', [[p.x - ca * 0.12, p.y - sa * 0.12], [p.x + ca * 0.12, p.y + sa * 0.12]], [[-0.1, 0], [0.1, 0]], y + 0.018, col('#f2f2f2'), 1); } } }
  for (const l of L.lots) {
    if (l.kind === 'walk') { if (l.pts && l.pts.length >= 3) { (o._walks = o._walks || []).push(l.pts); continue; } bt.box('concrete', l.r[0], y, l.r[1], l.r[2], y + 0.05, l.r[3], col('#e6e3dc'), 2); continue; }
    if (l.kind === 'apron') { rectTop(bt, 'asphalt', l.r, y + 0.012, WHITE, 3); continue; }   /* [GAS-FC] plain asphalt (pump forecourt: no stall stripes under the canopy) */
    /* [FIX-1/7 2026-10-17] courts, lanes, team yard + autolot = asphalt; concrete pads/pits = concrete; polygon lots (pts) follow their outline */
    const LK = { parking: LOGI && STRIPED.has(l.name) ? ['asphalt', col('#d0d0d0'), 3] : ['parking', WHITE, 2.72], court: ['asphalt', col('#d8d8d8'), 3], autolot: ['asphalt', col('#cfcfcf'), 3], pad: ['concrete', col('#d6d2ca'), 2] }[l.kind] || ['gravel', col('#e4ddd0'), 3];
    if (l.kind === 'parking' && !l.pts && !(LOGI && STRIPED.has(l.name))) { /* [CHOCO-LOTGRID] */ rectTop(bt, 'asphalt', l.r, y + 0.012, col('#d0d0d0'), 3);
      const r = l.r, wx = r[2] - r[0], wy = r[3] - r[1], alongX = wx >= wy, Lg = alongX ? wx : wy, Dp = alongX ? wy : wx, c = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]; let bq = null, bd = 1e9;
      for (const rd of L.roads) for (let i = 1; i < (rd.pts || []).length; i++) { const p0 = rd.pts[i - 1], p1 = rd.pts[i], dx = p1[0] - p0[0], dz = p1[1] - p0[1], t = Math.max(0, Math.min(1, ((c[0] - p0[0]) * dx + (c[1] - p0[1]) * dz) / (dx * dx + dz * dz || 1))), q = [p0[0] + t * dx, p0[1] + t * dz], d = Math.hypot(q[0] - c[0], q[1] - c[1]); if (d < bd) { bd = d; bq = q; } }
      const roadSide = bq ? (alongX ? Math.sign(bq[1] - c[1]) : Math.sign(bq[0] - c[0])) || 1 : 1, rows = Dp >= 2 * 1.35 + 1.5 ? [-1, 1] : Dp >= 1.35 ? [-roadSide] : [], n = Math.floor((Lg - 0.2) / 0.675), u0 = (alongX ? r[0] : r[1]) + 0.1;
      for (const side of rows) { const e0 = side < 0 ? (alongX ? r[1] : r[0]) : (alongX ? r[3] : r[2]), e1 = e0 - side * 1.35;
        for (let k = 0; k <= n; k++) { const u = u0 + 0.675 * k, A = alongX ? [u, e0 - side * 0.05] : [e0 - side * 0.05, u], B = alongX ? [u, e1] : [e1, u]; extrude(bt, 'emis', [A, B], [[-0.011, 0], [0.011, 0]], y + 0.017, col('#e6e6de'), 1); }
        const S0 = alongX ? [u0, e1] : [e1, u0], S1 = alongX ? [u0 + 0.675 * n, e1] : [e1, u0 + 0.675 * n]; extrude(bt, 'emis', [S0, S1], [[-0.008, 0], [0.008, 0]], y + 0.017, col('#e6e6de'), 1); }
      continue; }
    if (l.pts) polyTop(bt, LK[0], l.pts, y + (l.kind === 'pad' ? 0.016 : 0.012), LK[1], LK[2]); else rectTop(bt, LK[0], l.r, y + (l.kind === 'pad' ? 0.016 : 0.012), LK[1], LK[2]);
  }
  for (const rd of L.roads) { if (rd.kind === 'over') continue; // [OVERPASS] drawn elevated by assets/overpass.js
    const R = resample(rd.pts, 0.3), hw = rd.w / 2, drive = rd.kind === 'drive';
    extrude(bt, drive ? 'gravel' : 'asphalt', R, [[-hw, 0], [hw, 0]], y + (drive ? 0.018 : 0.022), WHITE, 3);
    if (!drive) for (const s of [-1, 1]) extrude(bt, 'gravel', R, [[-0.08, 0], [0.08, 0]], y + 0.015, col('#b9a98a'), 3, s * (hw + 0.07)); /* [UX1] packed sand/gravel shoulder (eastern NC two-lane: ~2 ft unpaved strip before the grass verge) */
    if (!drive && rd.w >= 0.9) {
      for (const s of [-1, 1]) extrude(bt, 'emis', R, [[-0.016, 0], [0.016, 0]], y + 0.026, col('#e4e4dc'), 1, s * (hw - 0.06)); // edge lines [UX1] solid white, wide enough to read at eye height
      if (rd.w >= 1.2) { let acc = 0; const F = frames(R); for (let i = 0; i + 1 < R.length; i++) { acc += 0.3; if (acc % 0.9 < 0.45) extrude(bt, 'emis', [R[i], R[i + 1]], [[-0.012, 0], [0.012, 0]], y + 0.026, col('#d8b230'), 1); } }
    }
  }
  townWalks(o, L, y);
  for (const ln of L.lines) {
    const R = resample(ln.pts, 0.3);
    if (ln.kind === 'ditch' && !o.terrain) extrude(bt, 'marsh', R, [[-0.28, 0.0], [-0.12, -0.0], [0.12, 0.0], [0.28, 0]], y + 0.007, col('#8f9a70'), 2);
    if (ln.kind === 'pier') { /* [R30] pond dock: deck 1.5 ft (0.11 in) above the water, shore end on the bank (terrain height), timber pilings to the pond bed every 0.6 in */
      const TR = o.terrain, WL = TR && TR.cfg ? TR.cfg.waterLevel : -0.25, gh = p => TR ? TR.h(p[0], p[1]) : 0, dk = p => y + Math.max(gh(p) + 0.03, WL + 0.11);
      if (!(L3D.ext && L3D.ext.tile && L3D.ext.tile(o.g, 'pier', ln.pts, p => [dk(p) - 0.03, dk(p) + 0.04], null, { span: 1 })   /* [R36c] deck band only: stretching pier.glb from the pond bed to the deck drew its piles as long jagged spikes; the plain square timber piles below are the only piles now */)) L3D.path.pier(bt, ln.pts, dk(ln.pts[ln.pts.length - 1]));
      const Rp = resample(ln.pts, 0.6); ln._deck = Rp.map(p => +dk(p).toFixed(3)); for (const p of Rp) { const g = gh(p); if (g > WL + 0.02) continue; for (const sd of [-0.17, 0.17]) { const q = ln.pts, d0 = q[0], d1 = q[q.length - 1], L_ = Math.hypot(d1[0] - d0[0], d1[1] - d0[1]) || 1, nx = -(d1[1] - d0[1]) / L_, nz = (d1[0] - d0[0]) / L_;
        const px = p[0] + nx * sd, pz = p[1] + nz * sd; bt.box('wood', px - 0.025, y + g - 0.05, pz - 0.025, px + 0.025, dk(p) + 0.04, pz + 0.025, col('#6b5a44')); } } }   /* [R36] ROOT CAUSE of the tall pond-dock pilings: dk() already includes the deck height y; 'y + dk(p)' put every piling top at 2*y (~76 in, through L2 to L3) */   /* [TILE-HOOK] pier.glb deck top (7 mm) at the procedural deck height */
  }
}
// ------------------------------------------------------------------ structures: asset library (assets/structures.js kits + generic typed builders), front faces the nearest road,
// merged per material in ~40 in chunks; each chunk has a detailed batch + a simple box batch switched by distance (LOD). External .glb overrides (assets/external) win when present.
const _shadowKeys = ['brick', 'store', 'metal', 'siding', 'house1', 'conc', 'roofgravel', 'shingle', 'metalroof', 'glossy', 'brick2', 'storefront2', 'corr', 'clap', 'cold', 'plain', 'wood'];
const SLOD = []; const STRUCT_IDS = {};
for (const o of LV) {
  const L = o.L, y = o.deck, CH = {};
  const SCH = 64, chunk = (x, z) => { const k = Math.floor(x / SCH) + ',' + Math.floor(z / SCH); return CH[k] || (CH[k] = { det: new Batch(), far: new Batch(), x: (Math.floor(x / SCH) + 0.5) * SCH, z: (Math.floor(z / SCH) + 0.5) * SCH }); }; /* [PERF-HOOK] structure chunk 40->64 in to cut draw calls */
  for (const s of L.structures) {
    const r = s.r, W = r[2] - r[0], D = r[3] - r[1], h = s.h, cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2; if (W < 0.05 || D < 0.05) continue; /* [CHOCO-BLDG] */ if (L3D.chocoB && L3D.chocoB.has(s)) { const ch = chunk(cx, cz); s.asset = 'choco-bldg'; STRUCT_IDS['choco-bldg'] = (STRUCT_IDS['choco-bldg'] || 0) + 1; const hh = L3D.chocoB.build(ch.det, s, y, { td: (x, z) => trackDist(o, x, z, 6), L, o }); ch.far.box('plain', r[0], y, r[1], r[2], y + Math.min(hh, 3.4), r[3], L3D.col(s.color || '#bbb'), 0); continue; }
    const C = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], OUT = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const _rid = L3D.resolveStructure(s), _fr = L3D.ext && L3D.ext.has(_rid) && L3D.ext.ovr(_rid).front, _lo = _fr === 'long' || _fr === 'short'; /* [EXT-OVR-HOOK] facade on a long/short side */
    let bi = 2, bd = 1e9; for (let i = 0; i < 4; i++) { if (_lo && Math.abs(W - D) > 0.05 && ((i % 2 === 1) === (W >= D)) === (_fr === 'long')) continue; const A = C[i], B = C[(i + 1) % 4], mx = (A[0] + B[0]) / 2 + OUT[i][0] * 1.2, mz = (A[1] + B[1]) / 2 + OUT[i][1] * 1.2;
      let dd = 1e9;  for (const rd of (_fr === 'track' ? L.tracks : L.roads)) for (let j = 0; j + 1 < rd.pts.length; j += (_fr === 'track' ? 4 : 1)) dd = Math.min(dd, segDist(mx, mz, rd.pts[j], rd.pts[Math.min(j + (_fr === 'track' ? 4 : 1), rd.pts.length - 1)])); /* [INGEST7] front:'track' = facade toward the nearest track (depot bay window) */ if (dd > 6) dd = 6 + Math.hypot(mx - CEN[0], mz - CEN[1]) / 100; if (dd < bd) { bd = dd; bi = i; } }
    { const _fc = L3D.ext && L3D.ext.has(_rid) && L3D.ext.ovr(_rid).face; if (_fc) { const _rk = { zneg: 0, xpos: 1, zpos: 2, xneg: 3 }; if (_fc === 'trackLong') { /* [R28] facade on the LONG side nearest any track, sampled densely (the 4-point step picked an end on near-square footprints) */
        let b2 = 1e9; for (const i of (W >= D ? [0, 2] : [1, 3])) { const A = C[i], B = C[(i + 1) % 4]; let dd = 1e9; for (const fr of [0.2, 0.5, 0.8]) { const mx = A[0] + (B[0] - A[0]) * fr + OUT[i][0] * 0.6, mz = A[1] + (B[1] - A[1]) * fr + OUT[i][1] * 0.6; for (const rd of L.tracks) for (let j = 0; j + 1 < rd.pts.length; j++) dd = Math.min(dd, segDist(mx, mz, rd.pts[j], rd.pts[j + 1])); } if (dd < b2) { b2 = dd; bi = i; } } } else if (_fc in _rk) bi = _rk[_fc]; } }
    /* [RV3 doors] the facade side carries the doors: if it has no paved access (road, court, apron, parking, gravel drive or walk) but the opposite
       side does (or, for a square footprint, a neighbouring side), the building turns to face it */
    const _acc = i => { const A = C[i], B = C[(i + 1) % 4]; for (const fr of [0.25, 0.5, 0.75]) for (const dv of [0.35, 0.8]) { const ax = A[0] + (B[0] - A[0]) * fr + OUT[i][0] * dv, az = A[1] + (B[1] - A[1]) * fr + OUT[i][1] * dv;
      for (const lt of L.lots || []) { const P = lt.pts || (lt.r && [[lt.r[0], lt.r[1]], [lt.r[2], lt.r[1]], [lt.r[2], lt.r[3]], [lt.r[0], lt.r[3]]]); if (P && inPoly(ax, az, P)) return true; }
      for (const rd of L.roads) for (let j = 0; j + 1 < rd.pts.length; j++) if (segDist(ax, az, rd.pts[j], rd.pts[j + 1]) < (rd.w || 1.2) / 2 + 0.3) return true; } return false; };
    if (_fr !== 'track' && !s.minor && !_acc(bi)) { const alt = [(bi + 2) % 4].concat(Math.abs(W - D) <= 0.3 && !_lo ? [(bi + 1) % 4, (bi + 3) % 4] : []).find(_acc); if (alt != null) { s._turned = bi + '->' + alt; bi = alt; } }
    s._bi = bi; s._rid = _rid; /* [RV3 doors] audit hook: facade (+Z) faces OUT[bi] */ const rot = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][bi], side = bi % 2 === 1, w = side ? D : W, d = side ? W : D;
    const M = new THREE.Matrix4().compose(new THREE.Vector3(cx, y, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(-w / 2, 0, -d / 2));
    const id = L3D.resolveStructure(s); let A = L3D.assets[id] || (L3D.ext && L3D.ext.has(id) ? { id, build() {} } : L3D.assets['gen-warehouse']); /* [VARIANT-HOOK] ext-only ids (grok-sim variants) */ STRUCT_IDS[A.id] = (STRUCT_IDS[A.id] || 0) + 1; s.asset = A.id;
    const ch = chunk(cx, cz), P = { w, d, h, color: s.color || '#cccccc', sign: s.sign, name: s.name || '', dock: s.dock, kind: s.kind, roof: s.roof, seed: hash(s.name || cx + ',' + cz) };
    let _fit = L3D.ext && L3D.ext.has(A.id) ? (L3D.ext.fitOK ? L3D.ext.fitOK(A.id, w, d) : { ok: true }) : null; /* [REVIEW1 scale] kit glb only at true 1:160 scale */
    if (_fit && !_fit.ok) { let pid = A.id; for (let g = 0; pid && g < 8 && !(L3D.assets[pid] && L3D.assets[pid].build); g++) pid = L3D.FALLBACK[pid]; const PB = (pid && L3D.assets[pid]) || L3D.assets[{ house: 'gen-house', office: 'gen-office', commercial: 'gen-store', shed: 'gen-shed', barn: 'gen-barn' }[s.kind] || 'gen-warehouse'];
      A = PB; _fit = null; s.asset = A.id + '(proc)'; (window.__SCALEFIX = window.__SCALEFIX || []).push(s.sid || s.name); } else if (_fit && _fit.rot) P.rot90 = true;
    if (_fit) { P.parent = o.g; o.g.add(L3D.ext.place(A.id, M, P)); } /* [EXT-OVR-HOOK] inst-mode assets batch per level */
    else { ch.det.setT(M); try { A.build(ch.det, P); } catch (e) { console.warn('asset build failed', A.id, e); ch.det.box('plain', 0, 0, 0, w, h, d, col(P.color), 0); } ch.det.setT(null); }
    const fc = col(P.color); ch.far.box(s.kind === 'industrial' ? 'metal' : 'plain', r[0], y, r[1], r[2], y + h * (s.kind === 'silo' || s.kind === 'bin' || s.kind === 'tanks' ? 0.9 : 1), r[3], fc, 0);
  }
  if (L3D.ext && L3D.ext.flush) L3D.ext.flush(); /* [EXT-OVR-HOOK] */
  for (const ch of Object.values(CH)) { const gd = new THREE.Group(), gf = new THREE.Group(); ch.det.meshes(gd, _shadowKeys); ch.far.meshes(gf, ['plain', 'metal']); o.g.add(gd, gf); gf.visible = false; SLOD.push({ gd, gf, c: new THREE.Vector3(ch.x, y + 2, ch.z) }); }
}
window.__L3D_USED = STRUCT_IDS;
SIGN.tex = new THREE.CanvasTexture(SIGN.c); SIGN.tex.anisotropy = 4; mat('sign').map = SIGN.tex;
// ------------------------------------------------------------------ instanced life: trees, hedges, reeds, vehicles, people, streetlights, poles + wires, fences, gates, signals
const GEO = new Proxy({}, { get: (_, k) => L3D.geo({ pine: 'tree-pine', decid: 'tree-oak', bush: 'hedge', reed: 'reed', car: 'veh-sedan', pickup: 'veh-pickup', semi: 'veh-semi', person: 'person-stand', lamp: 'streetlight', pole: 'utility-pole', xbuck: 'crossbuck', gatearm: 'crossing-gate', signal: 'ns-signal' }[k] || k) });
/* [REALISM] shirt / jacket colours for October (muted, darker than car paint) */ const SHIRT = ['#3a4a6a', '#6a2a2a', '#d8d4c8', '#4a5a3a', '#2a2a2a', '#7a6a50', '#5a6a80', '#8a3a3a', '#b8a888', '#3a3a4a'];
const CARCOL = ['#f2f2f0', '#e8e8e6', '#f6f6f4', '#1c1c1e', '#26262a', '#5e6064', '#74767a', '#b4b8bc', '#a8acb0', '#1f3a6a', '#7e1a1a', '#4a4e48']; /* REAL1: US car colour mix (white/black/grey/silver dominate; was a toy rainbow incl. yellow/green) */
for (const o of LV) {
  const L = o.L, y = o.deck, trees = [], hedges = [], reeds = [];
  const ok = (x, z, clr = 0.85) => onBoard(o, x, z, 0.3) && trackDist(o, x, z, clr + 0.1) > clr && !occupied(o, x, z, 0.15) && !inWater(o, x, z);
  for (const t of L.trees) { const n = Math.max(1, Math.round(3 * t.r * t.r + 1)); for (let i = 0; i < n; i++) { const a = rnd() * 6.283, rr = t.r * Math.sqrt(rnd()), x = t.x + rr * Math.cos(a), z = t.y + rr * Math.sin(a); if (ok(x, z, 2.4)) trees.push([x, z, rnd() < 0.55 ? 'pine' : 'decid']); } }
  for (const g of L.ground || []) if (['pine', 'plant', 'cypress'].includes(g.kind)) { const xs = g.pts.map(p => p[0]), zs = g.pts.map(p => p[1]); const bx = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
    const step = g.kind === 'plant' ? 0.9 : 0.75; for (let x = bx[0] + 0.3; x < bx[2]; x += step) for (let z = bx[1] + 0.3; z < bx[3]; z += step) { const jx = x + (g.kind === 'plant' ? 0 : (rnd() - .5) * 0.6), jz = z + (g.kind === 'plant' ? 0 : (rnd() - .5) * 0.6); if (inPoly(jx, jz, g.pts) && ok(jx, jz, 2.4)) trees.push([jx, jz, g.kind === 'cypress' ? 'decid' : 'pine']); } }
  for (const ln of L.lines) { const R = resample(ln.pts, ln.kind === 'treeline' ? 0.7 : ln.kind === 'hedge' ? 0.35 : 0.25);
    if (ln.kind === 'treeline') R.forEach(p => { const x = p[0] + (rnd() - .5) * .4, z = p[1] + (rnd() - .5) * .4; if (ok(x, z, 2.4)) trees.push([x, z, rnd() < 0.5 ? 'pine' : 'decid']); });
    if (ln.kind === 'hedge' && !(L3D.ext && L3D.ext.tile && L3D.ext.tile(o.g, 'hedge', ln.pts, p => y + (o.terrain ? o.terrain.h(p[0], p[1]) : 0), p => ok(p[0], p[1], 0.7)))) R.forEach(p => { if (ok(p[0], p[1], 0.7)) hedges.push(p); });   /* [TILE-HOOK] hedge.glb sections */
    if (ln.kind === 'reeds') R.forEach(p => { for (let k = 0; k < 3; k++) reeds.push([p[0] + (rnd() - .5) * .4, p[1] + (rnd() - .5) * .4]); }); }
  if (L3D.nature && o.terrain) { trees.length = 0; hedges.length = 0; reeds.length = 0; L3D.terrain.cur = o.terrain; try { L3D.nature.populate(o, TCTX); } catch (e) { console.error('nature', e); } } // [TERRAIN-HOOK]
  const tp = trees.filter(t => t[2] === 'pine'), tdAll = trees.filter(t => t[2] === 'decid'), TV = ['tree-oak', 'tree-maple', 'tree-young', 'tree-cedar'], td = [];
  tdAll.forEach((t, i) => { const v = TV[Math.floor(hash(t[0] * 3.1 + t[1]) * TV.length)]; if (v === 'tree-oak') td.push(t); else (TV[v] = TV[v] || []).push(t); });
  for (const v of ['tree-maple', 'tree-young', 'tree-cedar']) if (TV[v]) instanced(o, L3D.geo(v), TV[v], t => { const H = v === 'tree-young' ? 1.6 + rnd() : v === 'tree-cedar' ? 2 + 1.5 * rnd() : 3 + 1.5 * rnd(); _p.set(t[0], y, t[1]); _s.set(H, H, H); _q.setFromEuler(_e.set(0, rnd() * 6, 0)); _c.setHSL(v === 'tree-cedar' ? 0.3 : 0.2 + 0.1 * rnd(), 0.4, 0.22 + 0.08 * rnd()); }, { key: 'plain', cast: true });
  // loblolly pine 55-80 ft -> 4.1-6.0 in; hardwoods 40-60 ft -> 3.0-4.5 in
  instanced(o, GEO.pine, tp, t => { const H = 4.1 + 1.9 * rnd(); _p.set(t[0], y, t[1]); _s.set(H * (0.85 + .3 * rnd()), H, H * (0.85 + .3 * rnd())); _q.setFromEuler(_e.set(0, rnd() * 6, 0)); _c.setHSL(0.27 + 0.04 * rnd(), 0.38, 0.22 + 0.06 * rnd()); }, { key: 'plain', cast: true });
  instanced(o, GEO.decid, td, t => { const H = 3.0 + 1.5 * rnd(); _p.set(t[0], y, t[1]); _s.set(H * (0.8 + .4 * rnd()), H, H * (0.8 + .4 * rnd())); _q.setFromEuler(_e.set(0, rnd() * 6, 0)); _c.setHSL(0.22 + 0.08 * rnd(), 0.42, 0.25 + 0.08 * rnd()); }, { key: 'plain', cast: true });
  instanced(o, GEO.bush, hedges, p => { _p.set(p[0], y, p[1]); const s = 0.5 + 0.3 * rnd(); _s.set(s * 1.1, s * 1.4, s); _c.setHSL(0.28, 0.4, 0.2 + 0.06 * rnd()); }, { key: 'plain' });
  instanced(o, GEO.reed, reeds, p => { _p.set(p[0], y + 0.01, p[1]); _s.set(1, 1 + rnd(), 1); _c.setHSL(0.17, 0.35, 0.45); }, { key: 'plain', detail: 160 });
  /* [WIRE batch8-addendum 2026-10-19] road vehicles by what they are parked at: semis at tank farms / food plants pull tankers, at the co-op, cement or
     pellet silos bulk trailers, at lumber / steel / pipe yards flatbeds, near the autorack ramp the auto hauler; pickups at the yard office / MOW
     stock (tie stacks, rail rack, ballast) are hi-rail trucks, at farms / the co-op some are grain trucks. Only when that glb is loaded. */
  const XHV = id => !!(L3D.ext && L3D.ext.has(id)), NEWV = new Set(['veh-tanker', 'veh-bulk-trailer', 'veh-flatbed', 'veh-autohauler', 'veh-hirail', 'veh-grain-truck', 'veh-grain-straight']);
  const siteOf = v => { let best = null, bd = 7; for (const s of L.structures) { const dx = Math.max(s.r[0] - v.x, 0, v.x - s.r[2]), dz = Math.max(s.r[1] - v.y, 0, v.y - s.r[3]), d = Math.hypot(dx, dz); if (d < bd) { bd = d; best = s; } } return best ? (best.name || '') + ' ' + (best.asset || '') + ' ' + (best.kind || '') : ''; };
  const propNear = (kinds, v, r) => (L.props || []).some(p => kinds.includes(p.kind) && Math.hypot(p.x - v.x, p.y - v.y) < r);
  const VCTX = v => { if (v._vt !== undefined) return v._vt; const nm = siteOf(v).toLowerCase(); let t = null;
    if (v.kind === 'semi') t = propNear(['struct-autorack-adjustable-ramp'], v, 14) ? 'veh-autohauler' : /tank|ethanol|oil|fuel|propane|syrup|veg|food|polymer|chemical/.test(nm) ? 'veh-tanker' : /co-?op|grain|feed|pellet|cement|medusa|silo|elevator|fertili/.test(nm) ? 'veh-bulk-trailer' : /lumber|steel|pipe|millwork|building supply|scrap|salvage/.test(nm) ? 'veh-flatbed' : null;
    else if (v.kind === 'pickup') t = (/yard office|section|mow|maintenance/.test(nm) || propNear(['tie-stack', 'rail-rack', 'ballast-pile'], v, 9)) ? 'veh-hirail' : /farm|co-?op|grain|barn|stable|gin/.test(nm) && hash(v.x + 'g' + v.y) < 0.6 && !L.vehicles.some(w => w !== v && Math.hypot(w.x - v.x, w.y - v.y) < 1.8) ? 'veh-grain-straight' /* 2.6 in long: only where it has room */ : null;
    return (v._vt = t && XHV(t) ? t : null); };
  const VMAP = v => VCTX(v) || (v.kind === 'semi' ? (hash(v.x + 'b' + v.y) < 0.25 ? 'veh-boxtruck' : 'veh-semi') : v.kind === 'pickup' ? (hash(v.x + 't' + v.y) < 0.1 ? 'veh-tow' : 'veh-pickup') : (['veh-sedan', 'veh-sedan', 'veh-suv', 'veh-suv', 'veh-sedan'][Math.floor(hash(v.y + 's' + v.x) * 5)]));
  for (const vt of (LOGI ? [] : ['veh-sedan', 'veh-suv', 'veh-pickup', 'veh-tow', 'veh-semi', 'veh-boxtruck', ...NEWV])) { if (NEWV.has(vt) && !XHV(vt)) continue; /* [W9-FIX] new types have no built-in model: skip when the glb is not loaded (part 1 alone) */ const VL = L.vehicles.filter(v => VMAP(v) === vt), VP = v => { _p.set(v.x, y + 0.012, v.y); _q.setFromEuler(_e.set(0, -v.a + (!v.fix && hash(v.x + ',' + v.y) < 0.5 ? Math.PI : 0), 0)); /* [FIX-2] fix=1: docked semis / fuelling cars keep their heading */ if (NEWV.has(vt)) _c.setRGB(1, 1, 1); else _c.set(CARCOL[Math.floor(hash(v.x * 7 + v.y) * CARCOL.length)]); }, XV = L3D.ext && L3D.ext.has(vt) && L3D.ext.ovr(vt).mode === 'parts'; /* [EXT-OVR-HOOK] textured glb near, procedural far */
    const VC = {}; for (const v of VL) (VC[Math.floor(v.x / 24) + ',' + Math.floor(v.y / 24)] = VC[Math.floor(v.x / 24) + ',' + Math.floor(v.y / 24)] || []).push(v); for (const VL2 of (XV ? Object.values(VC) : [VL])) instanced(o, L3D.geo(vt), VL2, VP, { key: 'glossy', mat: L3D.likenessVeh && L3D.likenessVeh.has(vt) && !XV ? L3D.bakedGlossy() : undefined /* [REALISM] rebuilt vehicles: paint tinted, glass/tyres baked */, detail: 260, near: XV ? 10 : 0, cast: true }); if (XV) for (const VL2 of Object.values(VC)) for (const pt of L3D.ext.parts(vt)) instanced(o, pt.geo, VL2, (v, i) => { VP(v, i); if (!/^(body[_-]?)?paint$/i.test(pt.name || '') || L3D.ext.ovr(vt).noTint) _c.setRGB(1, 1, 1); /* [VEH-TINT 2026-10-15] Grok files name the body 'paint' or 'body_paint'; Color.set(1,1,1) was hex 0x000001 = black */ }, { mat: pt.mat, detail: 10, cast: true }); }
  const people = L.people.map(p => [p[0], p[1]]); for (const s of L.structures) if (['commercial', 'station'].includes(s.kind)) { const n = 1 + Math.floor(hash(s.name) * 3); for (let i = 0; i < n; i++) people.push([s.r[0] + (s.r[2] - s.r[0]) * rnd(), s.r[3] + 0.25]); }
  const ppl = people.filter(p => onBoard(o, p[0], p[1]) && trackDist(o, p[0], p[1], 0.6) > 0.5 && !L.structures.some(s => p[0] > s.r[0] && p[0] < s.r[2] && p[1] > s.r[1] && p[1] < s.r[3]));
  /* [WIRE batch8-addendum 2026-10-19] people by where they stand: farmers at farms / stables / the co-op, workers (hi-vis) at industries and railroad
     buildings, townsfolk standing or walking elsewhere; a bench in front of each station / store (street side) with a seated figure on most of them
     (person-sit.glb, origin between the feet, keepOrigin). Poses whose glb is missing fall back to the procedural stand/walk/worker figures. */
  const XHP = id => !!(L3D.ext && L3D.ext.has(id)) || !!(L3D.likenessPeople && /^person-/.test(id)) /* [REALISM] rebuilt figures cover every pose */, nearS = (x, z, r) => { let b = null, bd = r; for (const t of L.structures) { const d = Math.hypot(Math.max(t.r[0] - x, 0, x - t.r[2]), Math.max(t.r[1] - z, 0, z - t.r[3])); if (d < bd) { bd = d; b = t; } } return b; };
  const poseOf = p => { const t = nearS(p[0], p[1], 4), nm = t ? ((t.name || '') + ' ' + (t.kind || '')).toLowerCase() : '', hz = hash(p[0] + 'p' + p[1]);
    if (/farm|barn|stable|paddock|co-?op|gin/.test(nm) && XHP('person-farmer')) return 'farmer'; if (/industrial|plant|mill|steel|yard office|warehouse|terminal|transload|salvage|lumber/.test(nm) && hz < 0.8) return 'worker'; return hz < 0.5 ? 'stand' : 'walk'; };
  for (const pose of (LOGI ? [] : ['stand', 'walk', 'worker', 'farmer'])) instanced(o, L3D.geo('person-' + pose), ppl.filter(p => poseOf(p) === pose), p => { _p.set(p[0], y + (XHP('person-' + pose) ? 0 : 0.05), p[1]); _q.setFromEuler(_e.set(0, rnd() * 6, 0)); _c.set(pose === 'farmer' ? ['#8a3a2a', '#3a5a7a', '#5a6a3a', '#b0a080'][Math.floor(rnd() * 4)] : pose === 'worker' ? ['#5a6470', '#7a6a5a', '#2f3a4a'][Math.floor(rnd() * 3)] : SHIRT[Math.floor(rnd() * SHIRT.length)]); }, { key: 'plain', mat: L3D.likenessPeople ? L3D.bakedMat() : undefined, detail: 140 });
  { const roadD = (x, z) => { let d = 1e9; for (const rd of L.roads || []) for (let j = 0; j + 1 < rd.pts.length; j++) d = Math.min(d, segDist(x, z, rd.pts[j], rd.pts[j + 1]) - (rd.w || 1.2) / 2); return d; }, sit = [];
    for (const t of L.structures) { if (!['station', 'commercial'].includes(t.kind)) continue; const r = t.r, cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
      const sides = [[0, 1, r[3]], [0, -1, r[1]], [1, 0, r[2]], [-1, 0, r[0]]].map(([nx, nz, e]) => { const mx = nx ? e : cx, mz = nz ? e : cz; return { nx, nz, mx, mz, d: roadD(mx + nx * 0.4, mz + nz * 0.4) }; }).sort((a, b) => a.d - b.d);
      const S = sides[0]; if (S.d > 3) continue; const along = (nx, nz) => [-nz, nx], [ax, az] = along(S.nx, S.nz), half = S.nx ? (r[3] - r[1]) / 2 : (r[2] - r[0]) / 2, f = (hash(t.name + 'bench') - 0.5) * half;
      const bx = S.mx + ax * f + S.nx * 0.32, bz = S.mz + az * f + S.nz * 0.32; if (!onBoard(o, bx, bz, 0.1) || trackDist(o, bx, bz, 0.8) < 0.6 || occupied(o, bx, bz, 0.08) || roadD(bx, bz) < 0.12) continue;
      const g = y + (o.terrain ? Math.max(0, o.terrain.h(bx, bz)) : 0), hl = 0.15, h0 = 0.105, x0 = bx - ax * hl, z0 = bz - az * hl, x1 = bx + ax * hl, z1 = bz + az * hl, d = 0.05;   /* 4 ft bench, 17 in seat */
      const box = (u0, u1, v0, v1, y0, y1, c) => { const P = [[u0, v0], [u1, v1]].map(([u, v]) => [bx + ax * u + S.nx * v, bz + az * u + S.nz * v]); o.bt.box('wood', Math.min(P[0][0], P[1][0]), y0, Math.min(P[0][1], P[1][1]), Math.max(P[0][0], P[1][0]), y1, Math.max(P[0][1], P[1][1]), col(c), 1); };
      box(-hl, hl, -d, d, g + h0 - 0.012, g + h0, '#6a4a2e'); box(-hl, hl, -d - 0.012, -d, g + h0, g + h0 + 0.1, '#6a4a2e'); for (const u of [-hl + 0.02, hl - 0.03]) box(u, u + 0.012, -d, d, g, g + h0 - 0.012, '#2a2a2a');
      if (hash(t.name + 'sit') < 0.7) sit.push([bx + S.nx * 0.045, bz + S.nz * 0.045, Math.atan2(S.nz, S.nx), g]); }
    if (!LOGI && XHP('person-sit') && sit.length) instanced(o, L3D.geo('person-sit'), sit, p => { _p.set(p[0], p[3], p[1]); _q.setFromEuler(_e.set(0, -p[2], 0)); if (L3D.likenessPeople) _c.set(SHIRT[Math.floor(hash(p[0] + 'sh' + p[1]) * SHIRT.length)]); else _c.setRGB(1, 1, 1); }, { key: 'plain', mat: L3D.likenessPeople ? L3D.bakedMat() : undefined, detail: 140 }); o.benches = sit.length; }
  if (0) instanced(o, GEO.person, people.filter(p => onBoard(o, p[0], p[1]) && trackDist(o, p[0], p[1], 0.6) > 0.5 && !L.structures.some(s => p[0] > s.r[0] && p[0] < s.r[2] && p[1] > s.r[1] && p[1] < s.r[3])), p => { _p.set(p[0], y + 0.05, p[1]); _q.setFromEuler(_e.set(0, rnd() * 6, 0)); _c.set(CARCOL[Math.floor(rnd() * CARCOL.length)]); }, { key: 'plain', detail: 140 });
  const lampA = p => { let a = 0; let bd = 1e9; for (const rd of L.roads) for (let j = 0; j + 1 < rd.pts.length; j++) { const dd = segDist(p[0], p[1], rd.pts[j], rd.pts[j + 1]); if (dd < bd) { bd = dd; const A = rd.pts[j], B = rd.pts[j + 1]; const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * (B[0] - A[0]) + (p[1] - A[1]) * (B[1] - A[1])) / ((B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2 || 1))); a = Math.atan2(A[1] + (B[1] - A[1]) * t - p[1], A[0] + (B[0] - A[0]) * t - p[0]); } } return a; };   /* [R33] streetlights whose pole or arm reaches into a track envelope are not placed */
  const inB = (x, z) => L.structures.some(s => x > s.r[0] - 0.08 && x < s.r[2] + 0.08 && z > s.r[1] - 0.08 && z < s.r[3] + 0.08);   /* [R34] pole or any point of the 0.9 in arm over/through a building -> not placed */
  const LAMPS = L.lamps.filter(p => { const a = lampA(p); for (let k = 0; k <= 6; k++) if (inB(p[0] + 0.15 * k * Math.cos(a), p[1] + 0.15 * k * Math.sin(a))) return false; return trackDist(o, p[0], p[1], 2) > 0.8 && trackDist(o, p[0] + 0.9 * Math.cos(a), p[1] + 0.9 * Math.sin(a), 2) > 0.8; });
  instanced(o, GEO.lamp, LAMPS, p => { _p.set(p[0], y, p[1]); const a = lampA(p); _q.setFromEuler(_e.set(0, -a, 0)); }, { key: 'plain', detail: 220 });
  // utility poles every ~8 in (proto ~110 ft) with 3 sagging wires
  const poles = [], wires = [];
  /* [INGEST batch8 2026-10-18] the rev4 plan draws no pole lines: dress the long public roads (Front St on L1, River Rd / Main St on L2) with a
     roadside distribution line (utility-pole.glb), on whichever side keeps more poles clear of track, buildings and other roads. Viewer dressing only. */
  const poleLines = L.lines.filter(l => l.kind === 'poles');
  if (!poleLines.length) for (const rd of L.roads || []) { if (rd.private || (rd.kind && rd.kind !== 'road')) continue; let len = 0; for (let j = 0; j + 1 < rd.pts.length; j++) len += Math.hypot(rd.pts[j + 1][0] - rd.pts[j][0], rd.pts[j + 1][1] - rd.pts[j][1]); if (len < 60) continue;
    const off = (rd.w || 1.2) / 2 + 0.45, side = sg => rd.pts.map((p, j) => { const A = rd.pts[Math.max(0, j - 1)], B = rd.pts[Math.min(rd.pts.length - 1, j + 1)], h = Math.atan2(B[1] - A[1], B[0] - A[0]); return [p[0] - Math.sin(h) * off * sg, p[1] + Math.cos(h) * off * sg]; });
    const clear = q => onBoard(o, q[0], q[1], 0.2) && trackDist(o, q[0], q[1], 1) > 0.7 && !occupied(o, q[0], q[1], 0.15) && !(L.roads || []).some(r2 => { for (let j = 0; j + 1 < r2.pts.length; j++) if (segDist(q[0], q[1], r2.pts[j], r2.pts[j + 1]) < (r2.w || 1.2) / 2 + 0.15) return true; return false; });
    const score = pts => resample(pts, 1).filter(clear).length, a = side(1), b = side(-1); poleLines.push({ kind: 'poles', pts: score(a) >= score(b) ? a : b, clear, auto: rd.name }); }
  for (const ln of poleLines) { const R = resample(ln.pts, 0.5), keep = []; let acc = 8; for (let i = 0; i < R.length; i++) { if (i) acc += Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]); if (acc >= 8 && onBoard(o, R[i][0], R[i][1], 0.1) && trackDist(o, R[i][0], R[i][1], 1) > 0.7 && (!ln.clear || ln.clear(R[i]))) { keep.push(R[i]); acc = 0; } }
    keep.forEach((p, i) => { const q = keep[Math.min(keep.length - 1, i + 1)], pr = keep[Math.max(0, i - 1)]; const a = Math.atan2(q[1] - pr[1], q[0] - pr[0]); poles.push([p[0], p[1], a]); });
    for (let i = 0; i + 1 < keep.length; i++) { if (Math.hypot(keep[i + 1][0] - keep[i][0], keep[i + 1][1] - keep[i][1]) > 11) continue; /* gap where poles were skipped: no span */ const a = keep[i], b = keep[i + 1], h = Math.atan2(b[1] - a[1], b[0] - a[0]), nx = -Math.sin(h), nz = Math.cos(h);
      for (const off of [-0.25, 0, 0.25]) { let prev = null; for (let k = 0; k <= 6; k++) { const t = k / 6, x = a[0] + (b[0] - a[0]) * t + nx * off, z = a[1] + (b[1] - a[1]) * t + nz * off, yy = y + 2.46 + (off ? 0 : 0.08) - 0.12 * 4 * t * (1 - t); if (prev) wires.push(...prev, x, yy, z); prev = [x, yy, z]; } } } }
  instanced(o, GEO.pole, poles, p => { _p.set(p[0], y, p[1]); _q.setFromEuler(_e.set(0, -p[2], 0)); }, { key: 'plain', cast: true });
  if (wires.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3)); o.g.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x222222 }))); }
  // fences from the asset library: white board (horse farm), chain link (industry), wire (farm)
  const YT = p => y + (o.terrain ? o.terrain.h(p[0], p[1]) : 0);
  for (const ln of L.lines.filter(l => l.kind === 'fence' || l.kind === 'board' || l.kind === 'chain' || l.kind === 'wire')) {   /* [WIRE] + 'wire' (cemetery fence was never drawn) */ const kind = ln.kind === 'fence' || ln.kind === 'board' ? 'board' /* [FIX-20] 'board' lines were drawn as wire */ : ln.kind === 'chain' ? 'chain' : 'wire', okF = p => onBoard(o, p[0], p[1]) && trackDist(o, p[0], p[1], 0.7) > 0.5;
    if (L3D.ext && L3D.ext.tile && L3D.ext.tile(o.g, 'fence-' + kind, ln.pts, YT, okF)) continue;   /* [TILE-HOOK] fence-board/-chain/-wire.glb sections, else procedural */
    L3D.path.fence(o.bt, ln.pts, y, kind, okF); }
  /* [TILE-HOOK] rail-dock lines (export_plan: track face of 'dock' spot facilities): loading-dock.glb only where the building is procedural
     (kit glbs carry their own docks); fallback = the procedural building's own dock */
  for (const r of (L.dockRamps || [])) {   /* [R34] forklift ramp wedge: deck height at y0, lot level at y1 */
    const g = new THREE.BufferGeometry(), X0 = r.x0, X1 = r.x1, h = r.h, Y = y; const P = [X0,Y+h,r.y0, X1,Y+h,r.y0, X1,Y,r.y1, X0,Y,r.y1, X0,Y,r.y0, X1,Y,r.y0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex([0,3,1, 1,3,2, 4,0,3, 5,2,1, 4,5,0, 5,1,0]); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#bdb8ae', roughness: 0.95, side: THREE.DoubleSide })); m.name = 'TL-pad-dock-ramp'; m.userData.kind = 'dock-ramp'; o.g.add(m); }
  for (const ln of L.lines.filter(l => l.kind === 'dock')) { const s = L.structures.find(t => t.sid === ln.sid), sid = s && L3D.resolveStructure(s);
    if (sid && L3D.ext && L3D.ext.has(sid)) continue; if (L3D.ext && L3D.ext.tile && L3D.ext.tile(o.g, 'loading-dock', ln.pts, YT, p => onBoard(o, p[0], p[1]), { depth: ln.depth })) continue;
    const [A, B] = ln.pts, hd = (ln.depth || 0.9) / 2, vx = Math.abs(B[0] - A[0]) < Math.abs(B[1] - A[1]), h = ln.h || 0.31;   /* fallback: plain concrete dock block */
    o.bt.box('concrete', Math.min(A[0], B[0]) - (vx ? hd : 0), y, Math.min(A[1], B[1]) - (vx ? 0 : hd), Math.max(A[0], B[0]) + (vx ? hd : 0), y + h, Math.max(A[1], B[1]) + (vx ? 0 : hd), col('#c8c4bc'), 2); }
  /* [CHOCO-PIPE] */ for (const ln of L.lines.filter(l => l.kind === 'pipe')) { const hh = /bridge/i.test(ln.name || '') ? Math.max(ln.h || 0, 24 * 0.075) : (ln.h || 0.12) /* [CHOCO-PIPE item9] bridges over track drawn at 24 ft (1.8 in N), clear of the 23 ft NX-2 envelope */, R = L3D.resample(ln.pts, 0.08);
    for (let i = 1; i < R.length; i++) { const a = R[i - 1], b = R[i], dx = b[0] - a[0], dz = b[1] - a[1], Lr = Math.hypot(dx, dz) || 1, nx = -dz / Lr * 0.045, nz = dx / Lr * 0.045;
      for (const sd of [-1, 1]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, Lr + 0.01, 10), new THREE.MeshStandardMaterial({ color: sd < 0 ? '#b8bcbf' : '#8e9599', metalness: 0.6, roughness: 0.45 }));
        m.position.set((a[0] + b[0]) / 2 + sd * nx, y + hh, (a[1] + b[1]) / 2 + sd * nz); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / Lr, 0, dz / Lr)); o.g.add(m); } }
    const _sd = (q, A, B) => { const vx = B[0] - A[0], vz = B[1] - A[1], l2 = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((q[0] - A[0]) * vx + (q[1] - A[1]) * vz) / l2)); return Math.hypot(q[0] - A[0] - u * vx, q[1] - A[1] - u * vz); }, _foul = q => L.tracks.some(t => t.pts.some((P, i) => i && _sd(q, t.pts[i - 1], P) < 0.6375 + 0.03)); /* [CHOCO-PIPE item9] no bent inside a track's 8.5 ft side envelope */
    const _walk = q => (L.lots || []).some(w => w.kind === 'walk' && w.r && q[0] > w.r[0] - 0.05 && q[0] < w.r[2] + 0.05 && q[1] > w.r[1] - 0.05 && q[1] < w.r[3] + 0.05);   /* [CHOCO-NUTFIX] no pipe/conveyor support on a sidewalk */
    for (const p of L3D.resample(ln.pts, 1.2)) for (const sd of [-0.07, 0.07]) { if (_foul(p)) continue; if (_walk(p)) { (window.__pipeOnWalk = window.__pipeOnWalk || []).push([ln.name, +p[0].toFixed(2), +p[1].toFixed(2)]); continue; } const d = ln.pts[ln.pts.length - 1], s0 = ln.pts[0], Lr = Math.hypot(d[0] - s0[0], d[1] - s0[1]) || 1, nx = -(d[1] - s0[1]) / Lr, nz = (d[0] - s0[0]) / Lr;
      o.bt.box('plain', p[0] + nx * sd - 0.025, y, p[1] + nz * sd - 0.025, p[0] + nx * sd + 0.025, y + hh - 0.02, p[1] + nz * sd + 0.025, L3D.col('#5d6266')); }
    { const p = L3D.resample(ln.pts, 1.2); for (const q of p) { const d = ln.pts[ln.pts.length - 1], s0 = ln.pts[0], Lr = Math.hypot(d[0] - s0[0], d[1] - s0[1]) || 1, nx = -(d[1] - s0[1]) / Lr, nz = (d[0] - s0[0]) / Lr;
      o.bt.box('plain', Math.min(q[0] - nx * .08, q[0] + nx * .08) - .01, y + hh - .035, Math.min(q[1] - nz * .08, q[1] + nz * .08) - .01, Math.max(q[0] - nx * .08, q[0] + nx * .08) + .01, y + hh - .02, Math.max(q[1] - nz * .08, q[1] + nz * .08) + .01, L3D.col('#5d6266')); } } }
  // relay huts beside signals, dumpsters + pallets behind industries
  instanced(o, L3D.geo('relay-hut'), L.signals.map(s => { const v = nearestTrack(o, s.x, s.y, 3); return v ? [v[0] - v[3] * 1.6 + v[2] * 0.9, v[1] + v[2] * 1.6 + v[3] * 0.9, Math.atan2(v[3], v[2])] : [s.x + 1, s.y + 1, 0]; }).filter(p => onBoard(o, p[0], p[1]) && trackDist(o, p[0], p[1], 0.8) > 0.6 && !occupied(o, p[0], p[1], 0.3)), p => { _p.set(p[0], y, p[1]); _q.setFromEuler(_e.set(0, -p[2], 0)); }, { key: 'plain', detail: 160 });
  const ind = L.structures.filter(s => s.kind === 'industrial' || s.kind === 'commercial'); const dumps = [], pals = [];
  for (const s of ind) { const px = s.r[0] - 0.4, pz = s.r[1] + (s.r[3] - s.r[1]) * hash(s.name + 'd'); if (onBoard(o, px, pz) && trackDist(o, px, pz, 0.8) > 0.6 && !occupied(o, px, pz, 0.2)) (s.kind === 'industrial' && hash(s.name) < 0.5 ? pals : dumps).push([px, pz]); }
  // site vehicles/props by structure asset: UPS package cars at the hub, tractors + farmers at barns, school bus at churches, boats at piers, cotton modules at gins
  const near = (s, k) => { const out = []; for (let i = 0; i < k; i++) { const x = s.r[0] + (s.r[2] - s.r[0]) * (0.2 + 0.6 * hash(s.name + i)), z = s.r[3] + 0.5 + 0.6 * i; if (onBoard(o, x, z) && trackDist(o, x, z, 0.8) > 0.7 && !occupied(o, x, z, 0.25)) out.push([x, z]); } return out; };
  const site = { 'veh-ups': [], 'veh-tractor': [], 'person-farmer': [], 'veh-schoolbus': [], 'cotton-module': [] };
  for (const s of L.structures) { const id = s.asset || '', nm = (s.name || '').toLowerCase();
    if (s.site) { for (const k in s.site) (site[k] = site[k] || []).push(...s.site[k].map(p => [p[0], p[1], p[2]])); } else if (/3863|ups/.test(id + nm)) site['veh-ups'].push(...near(s, 3)); if (/barn|stable|farm/.test(id + nm)) { site['veh-tractor'].push(...near(s, 1)); site['person-farmer'].push(...near(s, 1)); }
    if (/church/.test(id)) site['veh-schoolbus'].push(...near(s, 1)); if (/gin/.test(id + nm)) site['cotton-module'].push(...near(s, 2)); }
  /* [WIRE batch8-addendum 2026-10-19] one parked work vehicle per matching site when its glb is loaded: hi-rail truck at the yard office / MOW stock,
     grain truck at the co-op or farm, flatbed at the lumber / building-supply / steel yards, auto hauler beside the autorack ramp. spotFor() tries
     the four sides 0.75 in out, parallel to the side, and checks the whole vehicle length for board, track and building clearance. */
  const spotFor = (cx, cz, hw, hd, len) => { for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (const f of [0, 0.3, -0.3]) { const ax = -nz, az = nx, half = nx ? hd : hw, x = cx + nx * ((nx ? hw : hd) + 0.75) + ax * f * half, z = cz + nz * ((nx ? hw : hd) + 0.75) + az * f * half; let ok = true;
      for (let t = -len / 2; t <= len / 2 + 1e-6 && ok; t += 0.4) { const px = x + ax * t, pz = z + az * t; if (!onBoard(o, px, pz, 0.15) || trackDist(o, px, pz, 1) < 0.8 || occupied(o, px, pz, 0.12)) ok = false; } if (ok) return [x, z, Math.atan2(az, ax)]; } return null; };
  const WV = [['veh-hirail', /yard office|section house|mow/i, ['rail-rack', 'ballast-pile', 'tie-stack']], ['veh-grain-straight', /farmers co-?op|grain|elevator/i, []], ['veh-flatbed', /lumber|building supply|steel processing|pipe/i, []], ['veh-autohauler', null, ['struct-autorack-adjustable-ramp']]];
  for (const [vid, rx, pk] of WV) { if (!XHV(vid) || o.L.vehicles.some(v => VMAP(v) === vid)) continue; const len = L3D.ext.len ? +L3D.ext.len(vid) : 2; let sp = null;
    for (const t of L.structures) if (!sp && rx && rx.test(t.name || '')) sp = spotFor((t.r[0] + t.r[2]) / 2, (t.r[1] + t.r[3]) / 2, (t.r[2] - t.r[0]) / 2, (t.r[3] - t.r[1]) / 2, len);
    for (const q of (L.props || [])) if (!sp && pk.includes(q.kind)) sp = spotFor(q.x, q.y, 0.6, 0.6, len);
    if (sp) (site[vid] = site[vid] || []).push([sp[0], sp[1], sp[2]]); }
  if (LOGI) for (const k of Object.keys(site)) if (k !== 'veh-tractor' && k !== 'cotton-module') delete site[k];
  /* [CHOCO-NUTFIX] parked fuel/sand delivery truck at the E-1 pad stop bar: a destination prop, kept with the logistics town */ for (const v of (L.fixedVeh || [])) if (XHV(v.id)) (site[v.id] = site[v.id] || []).push([v.x, v.y, v.a]);
  /* [RV1] no random barn tractors: the farm tractor is parked inside the open hay pole barn, square to the bays (p[3] = exact heading) */
  if (LOGI) { site['veh-tractor'] = []; for (const t of L.structures) if (/hay storage/i.test(t.name || '')) { const w = t.r[2] - t.r[0], d = t.r[3] - t.r[1]; site['veh-tractor'].push([t.r[0] + w * 0.32, (t.r[1] + t.r[3]) / 2, null, w >= d ? 0 : Math.PI / 2]); } }   // [LOGI] work trucks / bus / farmers come from the schedule
  for (const [k, list] of Object.entries(site)) instanced(o, L3D.geo(k), list, p => { _p.set(p[0], y + 0.01, p[1]); _q.setFromEuler(_e.set(0, p[3] != null ? p[3] : (NEWV.has(k) && p[2] != null ? -p[2] : 0) + (hash(p[0] + p[1]) < 0.5 ? 0 : Math.PI), 0)); if (NEWV.has(k)) _c.setRGB(1, 1, 1); if (k === 'veh-tractor') _c.set(hash(p[1]) < 0.5 ? '#2f7a2f' : '#c8202a'); if (k === 'person-farmer') { if (XHP('person-farmer') && !L3D.likenessPeople) _c.setRGB(1, 1, 1); else _c.set('#8a3a2a'); } }, { key: 'plain', mat: (L3D.likenessVeh && L3D.likenessVeh.has(k)) || (L3D.likenessPeople && /^person-/.test(k)) ? L3D.bakedGlossy() : undefined, detail: 200, cast: true });
  instanced(o, L3D.geo('boat'), L.lines.filter(l => l.kind === 'pier').map(l => l.pts[l.pts.length - 1]), p => { _p.set(p[0] + 0.5, y + 0.02, p[1] + 0.4); _c.set('#7a8a6a'); }, { key: 'plain', detail: 200 });
  if (L3D.props) try { L3D.props.build(o, TCTX); } catch (e) { console.error('props', e); } /* [REV4-3D] fill-zone props (assets/props.js) */
  instanced(o, L3D.geo('dumpster'), dumps, p => { _p.set(p[0], y, p[1]); _c.set(hash(p[0]) < 0.5 ? '#2f5a3a' : '#3a4a7a'); }, { key: 'plain', detail: 140 });
  instanced(o, L3D.geo('pallets'), pals, p => { _p.set(p[0], y, p[1]); _q.setFromEuler(_e.set(0, rnd() * 3, 0)); }, { key: 'plain', detail: 140 });
  // crossings: crossbucks (+ gate arms when 'gate'); oriented to face the road
  instanced(o, GEO.xbuck, (L3D.crossings ? [] : L.gates), g => { const v = nearestTrack(o, g.x, g.y, 3); const h = v ? Math.atan2(v[3], v[2]) : 0; _p.set(g.x, y, g.y); _q.setFromEuler(_e.set(0, -h, 0)); }, { key: 'plain', detail: 220 });
  instanced(o, GEO.gatearm, (L3D.crossings ? [] : L.gates).filter(g => g.kind === 'gate'), g => { const v = nearestTrack(o, g.x, g.y, 3); const h = v ? Math.atan2(v[3], v[2]) : 0; _p.set(g.x, y, g.y); _q.setFromEuler(_e.set(0, -h + Math.PI / 2, 0)); }, { key: 'plain', detail: 220 });
  instanced(o, GEO.signal, L.signals, s => { const v = nearestTrack(o, s.x, s.y, 3); const h = v ? Math.atan2(v[3], v[2]) : 0; let x = s.x, z = s.y;
    if (v && Math.hypot(v[0] - x, v[1] - z) < 0.8) { const nx = -v[3], nz = v[2]; x = v[0] + nx * 0.85; z = v[1] + nz * 0.85; } _p.set(x, y, z); _q.setFromEuler(_e.set(0, -h - Math.PI / 2, 0)); }, { key: 'emis' });
  // labels (sprites; hidden until toggled)
  for (const lb of L.labels) { const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = 'bold 26px sans-serif'; const w = Math.min(900, g.measureText(lb.text).width + 14); c.width = w; c.height = 36;
    g.fillStyle = lb.kind === 'turnout' ? '#ffe9c8e8' : '#ffffffe0'; g.fillRect(0, 0, w, 36); g.fillStyle = '#111'; g.font = 'bold 26px sans-serif'; g.fillText(lb.text, 7, 27);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); sp.scale.set(w / 36 * 0.55, 0.55, 1); sp.position.set(lb.x, y + (lb.kind === 'turnout' ? 1.2 : 2.6), lb.y); sp.renderOrder = 10; o.labels.add(sp); }
  /* [CHOCO-NAMES] */ function QS0names() { try { return new URLSearchParams(location.search).get('names') !== '0'; } catch (e) { return true; } } o.names = new THREE.Group(); o.names.visible = !(document.getElementById('names') && !document.getElementById('names').checked) && QS0names(); /* [CHOCO-NAMES-ON] default on */ o.g.add(o.names); { const NG = [[/^CCF /, 'Coastal Carolina Foods (CCF)'], [/^PSR /, 'Pamlico Scrap & Recycling (PSR)'], [/^FF /, 'Beaufort Farm Supply (FF)'], [/^(Marsden|RIP )/, 'Marsden Yard'], [/^TL /, 'Chocowinity Transload (TL)'], [/Pamlico Grill/, 'Pamlico Grill'], [/Quick Mart/, 'Quick Mart'],
      [/^GCF /, 'GCF Pulp Mill'], [/^WL /, 'WL Lumber Mill'], [/^PR /, 'Pamlico Propane (PR)'], [/^Nutrien /, 'Nutrien'], [/Tire & Auto/, 'Pamlico Tire & Auto'], [/Gas & Grocery/, 'Gas & Grocery'], [/Pamlico Hardware/, 'Pamlico Hardware'], [/Baptist Church/, 'Missionary Baptist Church']];
    for (const [re, text] of NG) { const ss = (L.structures || []).filter(q => re.test(q.name || '') && q.r); if (!ss.length) continue; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, h = 0, A = 0, cx = 0, cz = 0;
      for (const q of ss) { const [a0, b0, a1, b1] = q.r, ar = Math.abs((a1 - a0) * (b1 - b0)); x0 = Math.min(x0, a0); z0 = Math.min(z0, b0); x1 = Math.max(x1, a1); z1 = Math.max(z1, b1); h = Math.max(h, q.h || 1); cx += (a0 + a1) / 2 * ar; cz += (b0 + b1) / 2 * ar; A += ar; }
      const c = document.createElement('canvas'), gx = c.getContext('2d'); gx.font = '600 30px sans-serif'; const w = Math.ceil(gx.measureText(text).width) + 24; c.width = w; c.height = 44;
      gx.fillStyle = 'rgba(20,28,36,0.78)'; gx.beginPath(); gx.roundRect ? gx.roundRect(0, 0, w, 44, 10) : gx.rect(0, 0, w, 44); gx.fill(); gx.fillStyle = '#fff'; gx.font = '600 30px sans-serif'; gx.fillText(text, 12, 32);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true, transparent: true })); sp.scale.set(w / 44 * 1.15, 1.15, 1); sp.position.set(cx / A, y + h + 2.0, cz / A); if (text === 'Marsden Yard') sp.position.set(85, y + 3.0, 11.2);   /* [CHOCO-YARDLBL] was the area centroid of every Marsden/RIP structure incl. the mechanical/lube sheds at y~98 -> floated over the CCF tanks (x~15, y~50); now over the classification tracks T14-T17 (x 56-115, y 8-16) */ sp.renderOrder = 11; sp.userData.nm = text; o.names.add(sp); } }
  o.bt.meshes(o.g, _shadowKeys); o.bt = null;
}
// ------------------------------------------------------------------ rolling stock: low-poly N-scale models (1:160), vertex-coloured; instance colour tints white parts
const { CW, carGeo, locoGeo, TRUCK2, TRUCK3 } = L3D.rs; const PAL = new Proxy({}, { get: () => ['#ffffff'] }); // rolling stock from assets/rollingstock.js (liveries in atlas)
// routes (sampled every 0.1 in)
class Route {
  constructor(r, o) { const P = resample(r.pts, 0.1); if (r.closed && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) > 0.01) P.push(P[0]);
    this.n = P.length; this.X = new Float32Array(this.n); this.Z = new Float32Array(this.n); this.S = new Float32Array(this.n); let s = 0;
    P.forEach((p, i) => { if (i) s += Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]); this.X[i] = p[0]; this.Z[i] = p[1]; this.S[i] = s; }); this.len = s; this.closed = r.closed; this.lift = r.lift; this.name = r.name; this.o = o; this.src = r; let A = 0; for (let i = 1; i < this.n; i++) A += this.X[i - 1] * this.Z[i] - this.X[i] * this.Z[i - 1]; this.cw = A > 0; /* plan y (= z) points down the page, so a positive shoelace sum is clockwise as drawn */ }
  at(s, out) { // plan position at arc length s -> out (Vector3 x, -, z)
    s = this.closed ? ((s % this.len) + this.len) % this.len : Math.max(0, Math.min(this.len, s)); let lo = 0, hi = this.n - 1; const g = Math.min(hi - 1, Math.floor(s / this.len * hi)); // near-uniform -> guess then walk
    let i = g; while (i > 0 && this.S[i] > s) i--; while (i < hi - 1 && this.S[i + 1] < s) i++; const t = (s - this.S[i]) / ((this.S[i + 1] - this.S[i]) || 1);
    out.x = this.X[i] + (this.X[i + 1] - this.X[i]) * t; out.z = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * t; return out; }
}
const ROUTES = LV.map(o => Object.fromEntries((o.L.routes || []).map(r => [r.name, new Route(r, o)])));
/* [DIR 2026-10-18] through trains run by train number (odd = CCW, even = CW; layout trains[].dir from rev4_ops.direction). Each route also gets a
   reversed twin '<name>~R' (lift window mirrored), and a train runs on whichever of the two goes its way round. */
for (const RT of ROUTES) for (const k of Object.keys(RT)) { const r = RT[k], src = r.src; const lift = src.lift ? Object.assign({}, src.lift, { s0: r.len - src.lift.s1, s1: r.len - src.lift.s0 }) : src.lift;
  RT[k + '~R'] = new Route(Object.assign({}, src, { pts: src.pts.slice().reverse(), lift }), r.o); }
const routeFor = (lv, name, dir) => { const r = ROUTES[lv][name] || ROUTES[0][name]; return r && (r.cw === (dir === 'CW')) ? name : name + '~R'; };
// consists
const CONS = (D.trains || []).map(t => t);
const pick = (re, fb) => CONS.find(t => re.test(t.sym)) || CONS[fb] || CONS[0];
const tlen = t => t.cars.reduce((a, c) => a + c.len, 0);
function trimTo(t, max) { const cars = []; let L = 0; for (const c of t.cars) { if (L + c.len > max) break; cars.push(c); L += c.len; } return Object.assign({}, t, { cars }); }
const PLAN = [];
// OPS-HOOK (ops worker, minimal): see tools/layout3d/ops/README.md "3D hook". Lines tagged OPSH below.
const OPSH = window.LAYOUT3D_OPS && window.LAYOUT3D_OPS.enabled ? window.LAYOUT3D_OPS : null; // ops hook (tools/layout3d/ops/viewer): the ops sim drives the trains
if (CONS.length && ROUTES[0].main && !OPSH) {
  /* [DIR 2026-10-18] the demo has no dispatcher for meets on single track, so (like a dispatcher keeping a window) each deck carries one
     direction: L1 the odd-numbered CCW trains, L2 the even-numbered CW trains; the lift train is an odd L1 <-> L3 staging move (CSX Y191). */
  const bySym = (re, fb) => CONS.find(t => re.test(t.sym)) || pick(fb, 0);
  PLAN.push({ t: bySym(/^NS 211/, /intermodal/i), lv: 0, r: 'main', s: 70 });
  const coal = CONS.find(t => /coal/i.test(t.sym)); if (coal) PLAN.push({ t: coal, lv: 0, r: 'main', s: 190 });
  PLAN.push({ t: bySym(/^NS 165/, /manifest/i), lv: 0, r: 'main', s: 300 });
  /* [SHOW-NEW-RS] CLNA 120/119 (2 CLNA GP15-1) runs on the L1 main; its flats are steel-coil cars (Pamlico Steel traffic) */
  const clna = CONS.find(t => /clna/i.test(t.sym) && t.cars.some(c => c.type === 'loco' && /gp15/i.test(c.model || '')));
  if (clna) PLAN.push({ t: Object.assign({}, clna, { cars: clna.cars.map(c => c.type === 'flat' ? Object.assign({}, c, { type: 'coil' }) : c) }), lv: 0, r: 'main', s: 420 });
  if (ROUTES[1] && ROUTES[1].main) {
    const am = bySym(/^Amtrak 38/, /amtrak/i); PLAN.push({ t: Object.assign({}, am, { cars: am.cars.slice(0, 5).concat(am.cars.slice(5).filter(c => c.type === 'loco').slice(-1)) }), lv: 1, r: 'main', s: 300 }); /* [REV2] keep the rear P42 */
    PLAN.push({ t: bySym(/^NS 212/, /intermodal/i), lv: 1, r: 'main', s: 70 });
    PLAN.push({ t: bySym(/phosphate empties/i, /phosphate/i), lv: 1, r: 'main', s: 190 }); }
  const liftR = ROUTES[0].lift; if (liftR && liftR.lift) { const max = liftR.lift.s1 - liftR.lift.s0 - 1.5; const y = CONS.find(t => /Y191/.test(t.sym) && tlen(t) <= max);
    const lt = y || CONS.find(t => /turn|local/i.test(t.sym) && tlen(t) <= max) || trimTo(pick(/turn|local/i, 6), max); PLAN.push({ t: lt.cars.length && tlen(lt) <= max ? Object.assign({}, lt, { dir: y ? lt.dir : 'CCW' }) : trimTo(lt, max), lv: 0, r: 'lift', s: 190, home: 0 }); }
}
// gather every car instance (running + parked) so each model gets one InstancedMesh
const KEYS = {}; const keyOf = c => c.type === 'loco' ? `loco|${c.model}|${c.rr}|${c.len}` : `${c.type}|${c.len}|${c.liv | 0}`;
function reg(c, parent) { const k = keyOf(c) + '|' + parent.uuid; (KEYS[k] = KEYS[k] || { c, parent, n: 0, list: [] }); const e = KEYS[k]; c.slot = [e, e.n++]; return e; }
const TRAINS = PLAN.map((p, i) => { const dir = p.t.dir === 'CW' ? 'CW' : 'CCW'; const tr = { i, sym: p.t.sym, desc: p.t.desc, dir, home: p.home, lv: p.lv, route: routeFor(p.lv, p.r, dir), s: p.s, v: 0, y: 0, state: 'run', lt: 0, cars: p.t.cars.map(c => Object.assign({}, c)), pos: [] };
  tr.len = tlen(tr); tr.cars.forEach((c, j) => { c.liv = Math.floor(hash(tr.sym + j) * L3D.rs.liveries(c.type)); c.color = c.type === 'loco' ? '#ffffff' : (PAL[c.type] || ['#888'])[Math.floor(hash(tr.sym + j) * (PAL[c.type] || ['#888']).length)]; reg(c, scene); }); return tr; });
const PARKED = [];
// [IND-CARS] industry spurs park only the car types that industry receives (ops-data industries -> roster key -> viewer type/length); other spurs stay mixed
function spurCars(o, t) { const OD = window.OPS_DATA; if (!OD || !OD.industries) return null; const li = LV.indexOf(o) + 1, E = {}; for (const e of OD.graph.edges) E[e.id] = e;
  const RK = {}; for (const c of (OD.roster && OD.roster.cars) || []) if (!RK[c.key]) RK[c.key] = { type: c.type, len: c.len };
  const near = (P, q) => { for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)); if (Math.hypot(a[0] + u * dx - q[0], a[1] + u * dy - q[1]) < 0.35) return true; } return false; };
  const probe = [t.pts[Math.floor(t.pts.length / 2)], t.pts[0], t.pts[t.pts.length - 1]];
  for (const ind of OD.industries) { const tr = (OD.tracks || []).find(x => x.id === ind.tid); if (!tr || tr.level !== li) continue; const P = []; for (const id of tr.edges) if (E[id]) P.push(...E[id].pts);
    if (P.length < 2 || probe.filter(q => near(P, q)).length < 2) continue; const out = []; for (const g of ind.groups) { const r = RK[g.car]; if (!r) continue; for (let k = 0; k < g.spots; k++) out.push({ type: r.type, len: r.len || g.len }); }
    if (out.length) return { ind: ind.id, cars: out }; } return null; }
const SPURIND = [];
for (const o of LV) { if (OPSH) break; const L = o.L; for (const t of L.tracks) { if (t.type !== 'spur') continue; const a = t.pts[0], b = t.pts[t.pts.length - 1];
  const bump = L.bumpers.find(p => Math.hypot(p[0] - b[0], p[1] - b[1]) < 1.2) ? 'end' : L.bumpers.find(p => Math.hypot(p[0] - a[0], p[1] - a[1]) < 1.2) ? 'start' : null; if (!bump) continue;
  const pts = bump === 'end' ? t.pts.slice().reverse() : t.pts; const r = new Route({ pts, closed: false }, o); let s = 0.35; const types = ['boxcar', 'covered_hopper', 'tank', 'gondola', 'reefer', 'hopper', 'centerbeam'], lens = { boxcar: 5.1, covered_hopper: 4.7, tank: 4.6, gondola: 4.2, reefer: 6.5, hopper: 4.0, centerbeam: 6.0 };
  const IC = spurCars(o, t); if (IC) SPURIND.push({ level: L.id, ind: IC.ind, types: [...new Set(IC.cars.map(c => c.type))] }); let n = 0; while (n < (IC ? IC.cars.length : 0)) {   /* [RV1] a spur with no industry match parks nothing (was 6 random cars: boxcars among autoracks etc.) */ const ty = IC ? IC.cars[n].type : types[Math.floor(hash(t.pts[0] + ',' + n) * types.length)], ln = IC ? IC.cars[n].len : lens[ty]; if (s + ln > r.len - 1.5 - 2.5) break; { const nz = L3D.crossings && L3D.crossings.noSpot(o, r, s, s + ln, LV); if (nz !== null && nz !== undefined) { s = nz; continue; } } /* [XING-NOSPOT] never park on a crossing */ const c = { type: ty, len: ln, liv: Math.floor(hash(n + 'l' + t.pts[0]) * L3D.rs.liveries(ty)), color: PAL[ty][Math.floor(hash(n + 'p' + t.pts[0]) * PAL[ty].length)] }; reg(c, o.g); PARKED.push({ c, r, s: s + ln, o }); s += ln + 0.02; n++; } } }
const _ZS = new THREE.Vector3(1e-4, 1e-4, 1e-4), _UNIT = new THREE.Vector3(1, 1, 1); const TRUCKS = { 2: { parent: scene, n: 0 }, 3: { parent: scene, n: 0 } }; const trucksOf = c => c.type === 'loco' && !/GP|MP|P42/.test(c.model) ? 3 : 2;
const TMESH = {}; // truck instanced meshes, one per (axles, parent)
function truckSlot(c, parent) { const k = trucksOf(c) + '|' + parent.uuid; const e = TMESH[k] = TMESH[k] || { ax: trucksOf(c), parent, n: 0 }; c.tslot = [e, e.n]; e.n += 2; }
TRAINS.forEach(t => t.cars.forEach(c => truckSlot(c, scene))); PARKED.forEach(p => truckSlot(p.c, p.o.g));
for (const e of Object.values(KEYS)) { const c = e.c, xid = L3D.ext && L3D.ext.rsId ? L3D.ext.rsId(c.type === 'loco' ? 'loco' : c.type, c.model, c.rr, c.len) : (c.type === 'loco' ? 'loco-' + String(c.model || '').toLowerCase() : 'car-' + c.type); /* [RS-ROAD] */ /* [EXT-RS-HOOK] Grok glb body at true length; viewer trucks hidden (glb has its own) */
  if (L3D.ext && L3D.ext.rsHas && L3D.ext.rsHas(xid)) { e.mesh = L3D.ext.rsMesh(xid, e.n, e.parent, c.len);
    for (const p of [...TRAINS.flatMap(t => t.cars), ...PARKED.map(p => p.c)]) if (p.slot && p.slot[0] === e) p.noTruck = true; continue; }
  const g = c.type === 'loco' ? locoGeo(c.model, c.rr, c.len) : carGeo(c.type, c.len, c.liv | 0); e.mesh = new THREE.InstancedMesh(g, mat('livery'), e.n); e.mesh.frustumCulled = false; e.mesh.castShadow = true; e.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); e.parent.add(e.mesh); }
for (const e of Object.values(TMESH)) { e.mesh = new THREE.InstancedMesh(e.ax === 3 ? TRUCK3 : TRUCK2, mat('plain'), e.n); e.mesh.frustumCulled = false; e.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); e.parent.add(e.mesh); }
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _cpv = new THREE.Vector3();
function placeCar(c, route, sFront, y) { // sFront = arc length of the car's front coupler face
  const RGM = c.slot && c.slot[0].mesh && c.slot[0].mesh.rig ? c.slot[0].mesh : null; /* [EXT-RS-HOOK] rigged glb: truck centres from the model */
  const inset = RGM ? RGM.insetFront : c.type === 'loco' ? (trucksOf(c) === 3 ? 0.95 : 0.8) : Math.min(0.62, c.len * 0.13), insetR = RGM ? RGM.insetRear : inset;
  route.at(sFront - inset, _a); route.at(sFront - c.len + insetR, _b); _a.y = _b.y = y;
  const yaw = Math.atan2(_a.z - _b.z, _a.x - _b.x) + (c.rear ? Math.PI : 0); _q.setFromEuler(_e.set(0, -yaw, 0)); /* [REV2] rear DPU / cab-end unit faces back */ _s.set(1, 1, 1);
  _p.set((_a.x + _b.x) / 2, y, (_a.z + _b.z) / 2); _m.compose(_p, _q, _s); const [e, i] = c.slot; e.mesh.setMatrixAt(i, _m); e.mesh.instanceMatrix.needsUpdate = true;
  if (!c.colSet) { _c.set(c.color); e.mesh.setColorAt(i, _c); e.mesh.instanceColor.needsUpdate = true; c.colSet = true; }
  const [te, ti] = c.tslot; for (const [k, v] of [[0, _a], [1, _b]]) { const s2 = sFront - (k ? c.len - insetR : inset); route.at(s2 + 0.3, _d); const ty = Math.atan2(_d.z - v.z, _d.x - v.x); _q.setFromEuler(_e.set(0, -ty, 0)); _m.compose(v, _q, c.noTruck ? _ZS : _s); te.mesh.setMatrixAt(ti + k, _m); if (RGM) { _m.compose(v, _q, _UNIT); RGM.setTruckAt(c.slot[1], k, _m, sFront / RGM.wheelR); } }
  if (RGM && RGM.setCouplerAt) { _m.compose(_p, _q.setFromEuler(_e.set(0, -yaw, 0)), _UNIT); for (const kk of [0, 1]) { const pv = RGM.couplerPivot(kk, _m, _cpv); if (!pv) continue; const sK = (kk === 0) !== !!c.rear ? sFront : sFront - c.len; route.at(sK, _d);   /* [RV2] knuckle sits on the track at the coupler face */
      const dir = Math.atan2(_d.z - pv.z, _d.x - pv.x), out = yaw + (kk === 0 ? 0 : Math.PI); let a = dir - out; a = Math.atan2(Math.sin(a), Math.cos(a)); RGM.setCouplerAt(c.slot[1], kk, _m, -a); } }
  te.mesh.instanceMatrix.needsUpdate = true; c.cx = _p.x; c.cz = _p.z; c.cy = y; c.yaw = Math.atan2(_a.z - _b.z, _a.x - _b.x);
}
for (const p of PARKED) placeCar(p.c, p.r, p.s, p.o.deck + RAILTOP);
// ------------------------------------------------------------------ train simulation (scale speed, block-style spacing, elevator cycle)
const PHY = window.L3DPhysics || null;
const SIM = { mph: +(QS.get('mph') || 40), paused: QS.get('pause') === '1', time: 0 };
const ips = () => SIM.mph * 17.6 / 160; // scale mph -> real in/s
const _h = new THREE.Vector3(), _h2 = new THREE.Vector3();
function trainRoute(t) { return ROUTES[t.lv][t.route] || ROUTES[0][t.route]; }
function blocked(t) { // something on our level within 2.5 in ahead of the lead coupler, roughly in line with the track
  const r = trainRoute(t); r.at(t.s, _h); r.at(t.s + 1, _h2); const hx = _h2.x - _h.x, hz = _h2.z - _h.z, hl = Math.hypot(hx, hz) || 1;
  for (const u of TRAINS) { if (u === t || u.lv !== t.lv || u.state === 'lifting' || u.state === 'staged') continue; if (t.yield === u.i && u.yield === t.i && t.i < u.i) continue;
    for (const c of u.cars) { const dx = c.cx - _h.x, dz = c.cz - _h.z, along = (dx * hx + dz * hz) / hl, lat = Math.abs(dx * hz - dz * hx) / hl; if (along > -c.len / 2 && along < c.len / 2 + (t.look || 2.2) && lat < 0.45) { t.yield = u.i; return true; } } }
  t.yield = -1; return false;
}
// [FIX-9 2026-10-17] a train that rides the lift up to L3 parks, visibly, on a free staging track S1-S5 (layout.l3) centred on the track,
// instead of vanishing; with no layout.l3 (empty future deck) it is still hidden below the scene
function stageL3(t) { const S3 = (window.LAYOUT || {}).l3; if (!L3 || !L3.staging || !S3) return; const occ = new Set(TRAINS.filter(u => u !== t && u.state === 'staged' && u.l3t).map(u => u.l3t));
  const tr = S3.tracks.filter(x => /^S\d/.test(x.name) && !occ.has(x.name)).map(x => ({ x, r: new Route({ pts: x.pts, closed: false }, LV[1]) })).find(o => o.r.len >= t.len + 1); if (!tr) return;
  t.l3t = tr.x.name; t.l3r = tr.r; t.l3s = tr.r.len / 2 + t.len / 2; }
function liftBusy(t) { return TRAINS.some(u => u !== t && u.state === 'lifting'); }
function stepTrains(dt) {
  if (!SIM.paused) SIM.time += dt;
  for (const t of TRAINS) {
    const r = trainRoute(t), target = SIM.paused ? 0 : ips();
    if (t.state === 'staged') { t.st -= SIM.paused ? 0 : dt; if (t.st <= 0 && !liftBusy(t)) { t.l3r = null; t.state = 'lifting'; t.lt = 0; t.from = 2; t.to = t.home === 0 ? 0 : 1; t.y = deckAbs(2) - LV[t.to].deck; t.lv = t.to; } }   // [L3] back from staging: appears on the lift at L3
    else if (t.state === 'lifting') { t.lt += dt * (SIM.paused ? 0 : 1); const from = t.from != null ? t.from : t.lv, to = t.to != null ? t.to : 1 - t.lv, T = 8 * Math.abs(to - from), k = Math.min(1, t.lt / T), e = k * k * (3 - 2 * k);
      t.y = deckAbs(from) + (deckAbs(to) - deckAbs(from)) * e - LV[t.lv].deck;
      if (liftMesh) liftMesh.position.y = LV[t.lv].deck + t.y; if (k >= 1) { t.from = t.to = null; if (to >= 2) { t.state = 'staged'; t.st = +(QS.get('stage') || 60); t.y = -1e4; t.v = 0; stageL3(t); } else { t.lv = to; t.y = 0; t.state = 'run'; t.hold = 1.5; } } }
    else {
      if (PHY && SIM.paused) { /* [PHYSICS] pause freezes the trains in place */ }
      else if (PHY) {   // [PHYSICS] mass-based acceleration / braking (assets/physics.js); pause freezes the trains
        const C = t._C || (t._C = PHY.consist(t.cars.map((c, j) => ({ loco: c.type === 'loco', model: c.model, type: c.type, id: t.sym + j })))), u = PHY.MPH(t.v), cp = PHY.caps(C, u, {});
        t.look = 2.2 + t.v * t.v / (2 * PHY.IPS(cp.dec * 1.3)); if (t.hold > 0) t.hold -= dt; const stop = t.hold > 0 || blocked(t); let nu;
        if (t.ctl && t.ctl.cab) { const k = t.ctl; k.abc = PHY.brakeLag(k.abc || 0, k.auto || 0, dt); k.ibc = PHY.brakeLag(k.ibc || 0, k.ind || 0, dt, 0.6, 0.5);
          nu = PHY.step(C, u, { notch: stop ? 0 : k.notch || 0, auto: stop ? 1 : k.abc, ind: k.ibc, emergency: stop, dir: 1 }, {}, dt); t.prot = stop; }   // train protection: emergency stop for an occupied block
        else { const tgt = stop ? 0 : Math.min(C.vmax, PHY.MPH(target)), d = tgt - u; nu = u + (d > 0 ? Math.min(d, cp.acc * dt) : Math.max(d, -cp.dec * (stop ? 1.3 : 1) * dt)); }
        t.v = Math.max(0, PHY.IPS(nu)); t.mph = nu; }
      else { if (t.hold > 0) t.hold -= dt; const stop = t.hold > 0 || blocked(t); t.v += Math.max(-3 * dt, Math.min(1.5 * dt, (stop ? 0 : target) - t.v)); if (stop && t.v > 0) t.v = Math.max(0, t.v - 6 * dt); }
      const prev = t.s; t.s += PHY && SIM.paused ? 0 : t.v * dt;
      if (r.lift && LV[1]) { const L1 = r.lift, thr = L1.s1 - 0.6, a = ((prev % r.len) + r.len) % r.len, b = ((t.s % r.len) + r.len) % r.len;
        if (a < thr && b >= thr && b - t.len >= L1.s0 - 0.01) { if (liftBusy(t)) { t.s = prev; t.v = 0; t.hold = 1; } else { t.s += thr - b; t.state = 'lifting'; t.lt = 0; t.v = 0; t.from = t.lv;   // interlock: one train on the lift
          t.trips = (t.trips || 0) + 1; t.to = t.home === 0 && L3 && (window.LAYOUT || {}).l3 ? (t.lv === 0 ? 2 : 0) : L3 && t.lv === 1 && t.trips % 2 === 0 ? 2 : 1 - t.lv; } } }
    }
    if (t.state === 'staged' && t.l3r) { let s = t.l3s; for (const c of t.cars) { placeCar(c, t.l3r, s, L3.deck + RAILTOP); s -= c.len; } continue; }   // [FIX-9] parked on its L3 staging track
    let s = t.s; const y = LV[t.lv].deck + RAILTOP + t.y; for (const c of t.cars) { placeCar(c, r, s, y); s -= c.len; }
  }
}
// ------------------------------------------------------------------ cameras & modes
const orbit = new THREE.OrbitControls(camera, renderer.domElement); orbit.enableDamping = true; orbit.dampingFactor = 0.12; orbit.maxDistance = 900; orbit.minDistance = 1.5;
const plc = new THREE.PointerLockControls(camera, document.body);
let MODE = null, SEL = 0; /* null (not 'orbit') so the first setMode('orbit') runs the overview init; with 'orbit' it returned early and the camera sat on the carpet at the origin (blank screen) */ const KEY = {}; const camT = new THREE.Vector3(), camL = new THREE.Vector3(), lookS = new THREE.Vector3();
const VIEWS = { town: () => { const dx = CEN[0] - LOOK0[0], dz = CEN[1] - LOOK0[1], l = Math.hypot(dx, dz) || 1; return [[LOOK0[0] + dx / l * 16, LV[0].deck + 8, LOOK0[1] + dz / l * 16], [LOOK0[0], LV[0].deck + 0.8, LOOK0[1]]]; }, overview: () => [[CEN[0] - 120, 175, ext[3] + 150], [CEN[0], 44, CEN[1]]], l1: () => [[CEN[0], LV[0].deck + 120, CEN[1] + 70], [CEN[0], LV[0].deck, CEN[1]]],
  l2: () => [[CEN[0], (LV[1] || LV[0]).deck + 110, CEN[1] + 60], [CEN[0], (LV[1] || LV[0]).deck, CEN[1]]], elev: () => [[ext[2] + 30, 70, CEN[1] + 30], [LIFT ? LIFT.x : ext[2], 46, CEN[1]]] };
function setView(v) { setMode('orbit'); const [p, t] = VIEWS[v](); camera.position.set(...p); orbit.target.set(...t); orbit.update(); }
function walkFree(x, z) { const R = window.__walkClear || 9; /* [HEIGHT] chair clearance */ if (x < ROOM[0] + R || x > ROOM[2] - R || z < ROOM[1] + R || z > ROOM[3] - R) return false;
  for (const ob of OBST) { if (ob.r) { const r = ob.r; if (x > r[0] - R && x < r[2] + R && z > r[1] - R && z < r[3] + R) return false; }
    else if (ob.p) { if (inPoly(x, z, ob.p)) return false; for (let i = 0; i < ob.p.length; i++) if (segDist(x, z, ob.p[i], ob.p[(i + 1) % ob.p.length]) < R) return false; }
    else if (ob.seg) { for (let i = 0; i + 1 < ob.seg.length; i += 2) if (segDist(x, z, ob.seg[i], ob.seg[Math.min(ob.seg.length - 1, i + 2)]) < R + ob.w) return false; } }
  if (LIFT && x > LIFT.x - 2 - R && x < LIFT.x + 2 + R && z > LIFT.y0 - 2 - R && z < LIFT.y1 + 2 + R) return false; return true; }
const LOOK0 = (() => { const S = LV[0].L.structures.filter(s => !s.minor); if (!S.length) return CEN; let best = null; for (const s of S) { const x = (s.r[0] + s.r[2]) / 2, z = (s.r[1] + s.r[3]) / 2, n = S.filter(q => Math.hypot((q.r[0] + q.r[2]) / 2 - x, (q.r[1] + q.r[3]) / 2 - z) < 15).length; if (!best || n > best[0]) best = [n, x, z]; } return [best[1], best[2]]; })();
// [SPAWN 2026-10-15] walk spawn = operator aisle: free floor cells inside the benchwork footprint (ext), the one nearest the layout centre, facing the nearest fascia.
// Works for any plan (U / L / around-the-walls / island). URL ?spawn=x,z or x,z,tx,tz (plan inches; tx,tz = look-at point) overrides when that spot is walkable.
const inAisle = (x, z) => x > ext[0] && x < ext[2] && z > ext[1] && z < ext[3] && walkFree(x, z);
function spawnFace(x, z) { let best = null; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI, dx = Math.cos(a), dz = Math.sin(a);
    for (let d = 1; d < 200; d += 1) { const px = x + dx * d, pz = z + dz * d; if (px < ROOM[0] || px > ROOM[2] || pz < ROOM[1] || pz > ROOM[3]) break;
      if (LV.some(o => onBoard(o, px, pz))) { if (!best || d < best[0]) best = [d, dx, dz]; break; } } }
  if (!best) return [CEN[0], CEN[1]]; const d = best[0] + 10; return [x + best[1] * d, z + best[2] * d]; }
const SPAWN = (() => { const q = (QS.get('spawn') || '').split(',').map(Number);
  if (q.length >= 2 && q.every(Number.isFinite)) { if (walkFree(q[0], q[1])) return { x: q[0], z: q[1], look: q.length >= 4 ? [q[2], q[3]] : spawnFace(q[0], q[1]), src: 'url' }; console.warn('?spawn not walkable, using aisle spawn'); }
  let best = null; for (let x = ext[0] + 3; x < ext[2]; x += 3) for (let z = ext[1] + 3; z < ext[3]; z += 3) { if (!walkFree(x, z)) continue; const sc = Math.hypot(x - CEN[0], z - CEN[1]); if (!best || sc < best[0]) best = [sc, x, z]; }
  if (!best) for (let x = ROOM[0] + 10; x < ROOM[2] - 10; x += 3) for (let z = ROOM[1] + 10; z < ROOM[3] - 10; z += 3) { if (!walkFree(x, z)) continue; const sc = Math.hypot(x - CEN[0], z - CEN[1]); if (!best || sc < best[0]) best = [sc, x, z]; } // island layout: room aisle
  const x = best ? best[1] : CEN[0], z = best ? best[2] : ROOM[1] + 12; return { x, z, look: spawnFace(x, z), src: best ? 'aisle' : 'fallback' }; })();
SPAWN[0] = SPAWN.x; SPAWN[1] = SPAWN.z; // legacy [x, z] access
// [UI] teleport (jump-to-location list): stand on the walkable aisle floor nearest plan point (x, z), facing it
function teleport(x, z, lookY) { let best = null; for (let r = 0; r < 140 && !best; r += 3) for (let i = 0, n = Math.max(1, Math.round(r * 2)); i < n; i++) { const a = i / n * 2 * Math.PI, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (walkFree(px, pz)) { best = [px, pz]; break; } }
  if (!best) return false; setMode('walk'); camera.position.set(best[0], walk.eye, best[1]); camera.up.set(0, 1, 0); camera.lookAt(x, lookY != null ? lookY : LV[0].deck + 2, z); walk.init = true; ZOOM.reset(); return true; }
function goSpawn() { camera.position.set(SPAWN.x, walk.eye, SPAWN.z); camera.up.set(0, 1, 0); camera.lookAt(SPAWN.look[0], LV[0].deck + 10, SPAWN.look[1]); walk.init = true; }
// entering Walk from Orbit / Cab / Chase: keep the spot if it is on the aisle floor (level the view, drop to eye height), otherwise teleport to the aisle spawn
function enterWalk() { const p = camera.position; if (!walk.init || !inAisle(p.x, p.z) || p.y > CEIL) { goSpawn(); return 'spawn'; }
  _e.setFromQuaternion(camera.quaternion, 'YXZ'); _e.x = Math.max(-0.6, Math.min(0.6, _e.x)); _e.z = 0; camera.quaternion.setFromEuler(_e); p.y = walk.eye; return 'kept'; }
const LOOKM = m => m === 'walk' || m === 'fly' || m === 'ped';   // [FLYPED] first-person look modes (pointer lock or drag)
function setMode(m) {
  if (m === MODE) return; const FPm = L3D.flyped; if ((m === 'fly' || m === 'ped') && !(FPm && STATS.api && STATS.api.flyped)) return; const prev = MODE; if (LOOKM(MODE) && !LOOKM(m)) { plc.unlock(); }
  if (FPm && STATS.api && (prev === 'fly' || prev === 'ped')) FPm.exit(prev, m);
  MODE = m; orbit.enabled = m === 'orbit'; document.getElementById('cross').style.display = LOOKM(m) ? 'block' : 'none';
  camera.near = m === 'cab' ? 0.03 : m === 'walk' ? 0.5 : 0.1; if (m !== 'ped' && camera.fov !== ZOOM.base && ZOOM.k === 1) camera.fov = ZOOM.base; camera.updateProjectionMatrix();
  if (m === 'fly' || m === 'ped') FPm.enter(m, prev); /* [FLYPED] */
  if (m === 'walk') { STATS.walkEnter = enterWalk(); }
  if (m === 'orbit') { /* [CHOCO-OV] always frame the whole layout on entering Overview (was first entry only: after Walk the camera stayed at eye height looking at the floor) */ const [p, t] = VIEWS.overview(); camera.position.set(...p); orbit.target.set(...t); orbit.init = true; orbit.update(); }
  if (m === 'cab' || m === 'chase') snapCam = true;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}
let snapCam = true; const walk = { init: false, eye: EYE, drag: null, yaw: 0, pitch: 0 };
// [HEIGHT] walk-mode person: stature + posture -> eye height. Standing eye = stature - 4.5 in; seated eye = seat + 0.434 x stature (anthropometric sitting eye height).
// Chairs: office 16-21 in (adjustable), stool 24-30, dining 18, wheelchair 19.5. Seated moves at half speed and keeps a larger clearance (knees/chair). Persisted in localStorage.
const HSTORE = 'layout3d.walkPerson'; const CHAIR = { stand: { seat: 0, min: 0, max: 0, clear: 9, spd: 1 }, office: { seat: 18.5, min: 16, max: 21, clear: 15, spd: 0.5 }, stool: { seat: 27, min: 24, max: 30, clear: 13, spd: 0.4 }, dining: { seat: 18, min: 18, max: 18, clear: 15, spd: 0.35 }, wheel: { seat: 19.5, min: 19.5, max: 19.5, clear: 18, spd: 0.5 } };
const PERSON = { h: 71, pose: 'stand', seat: 18, dEye: 0 }; let hBadgeT = 0;
const ftin = h => { const i = Math.round(h); return `${Math.floor(i / 12)}'${i % 12}"`; }, cm = v => (v * 2.54).toFixed(0);
const eyeOf = () => (PERSON.pose === 'stand' ? PERSON.h - 4 : PERSON.seat + 0.434 * PERSON.h) + PERSON.dEye;
function personUI(live) { const C = CHAIR[PERSON.pose], e = walk.eye, el = document.getElementById('hread');
  const txt = `${ftin(PERSON.h)} (${cm(PERSON.h)} cm) ${PERSON.pose === 'stand' ? 'standing' : 'seated on ' + document.querySelector('#pose option[value=' + PERSON.pose + ']').textContent + ', seat ' + PERSON.seat.toFixed(1) + ' in (' + cm(PERSON.seat) + ' cm)'} → eye ${e.toFixed(1)} in (${ftin(e)}, ${cm(e)} cm)`;
  if (el) el.textContent = txt; const b = document.getElementById('hbadge'); if (b && live) { b.textContent = txt; b.classList.remove('hidden'); hBadgeT = performance.now(); }
  const s = document.getElementById('seat'); if (s) { s.disabled = C.min === C.max; s.min = C.min || 16; s.max = C.max || 30; s.value = PERSON.seat; s.style.opacity = PERSON.pose === 'stand' ? 0.3 : 1; }
  const hs = document.getElementById('hsl'), ps = document.getElementById('pose'); if (hs) hs.value = PERSON.h; if (ps) ps.value = PERSON.pose;
  try { localStorage.setItem(HSTORE, JSON.stringify(PERSON)); } catch (e) {} }
function applyPerson(live) { walk.eye = eyeOf(); walk.clear = window.__walkClear = CHAIR[PERSON.pose].clear; walk.spd = CHAIR[PERSON.pose].spd; if (typeof MODE !== 'undefined' && MODE === 'walk') camera.position.y = walk.eye; personUI(live); }
function setEye(eye, live) { PERSON.dEye += eye - walk.eye; applyPerson(live); } // Space / C nudge eye (crouch / tiptoe / seat adjust)
function setPose(pose) { PERSON.pose = pose; const C = CHAIR[pose]; if (pose !== 'stand') PERSON.seat = Math.min(C.max, Math.max(C.min, C.seat)); PERSON.dEye = 0; }
setInterval(() => { const b = document.getElementById('hbadge'); if (b && hBadgeT && performance.now() - hBadgeT > 1500) { b.classList.add('hidden'); hBadgeT = 0; } }, 300);
(() => { try { const st = JSON.parse(localStorage.getItem(HSTORE) || 'null'); if (st && st.h > 30 && st.h < 90 && CHAIR[st.pose]) Object.assign(PERSON, st); } catch (e) {}
  const q = new URLSearchParams(location.search); if (q.get('height')) PERSON.h = +q.get('height'); if (q.get('pose') && CHAIR[q.get('pose')]) { setPose(q.get('pose')); } if (q.get('seat')) PERSON.seat = +q.get('seat');
  const pre = document.getElementById('hpre'), sl = document.getElementById('hsl'), ps = document.getElementById('pose'), se = document.getElementById('seat');
  if (pre) { pre.value = PERSON.h + '|' + PERSON.pose; pre.onchange = () => { const [h, pz] = pre.value.split('|'); PERSON.h = +h; setPose(pz); applyPerson(); }; }
  if (sl) sl.oninput = () => { PERSON.h = +sl.value; PERSON.dEye = 0; if (pre) pre.value = ''; applyPerson(); }; if (ps) ps.onchange = () => { setPose(ps.value); if (pre) pre.value = ''; applyPerson(); };
  if (se) se.oninput = () => { PERSON.seat = +se.value; PERSON.dEye = 0; if (pre) pre.value = ''; applyPerson(); }; applyPerson(); })();
renderer.domElement.addEventListener('click', () => { if (LOOKM(MODE) && !QS.has('shot')) plc.lock(); });
renderer.domElement.addEventListener('mousedown', e => { if (LOOKM(MODE) && !plc.isLocked) walk.drag = [e.clientX, e.clientY]; });
addEventListener('mouseup', () => walk.drag = null);
addEventListener('mousemove', e => { if (!LOOKM(MODE) || plc.isLocked || !walk.drag) return; const dx = e.clientX - walk.drag[0], dy = e.clientY - walk.drag[1]; walk.drag = [e.clientX, e.clientY];
  _e.setFromQuaternion(camera.quaternion, 'YXZ'); _e.y -= dx * 0.004 / ZOOM.k; _e.x = Math.max(-1.5, Math.min(1.5, _e.x - dy * 0.004 / ZOOM.k)); camera.quaternion.setFromEuler(_e); });
const _f = new THREE.Vector3(), _r = new THREE.Vector3();
function updateWalk(dt) {
  const sp = (KEY.ShiftLeft || KEY.ShiftRight ? 100 : 50) * dt * (walk.spd || 1); /* [HEIGHT] seated rolls slower */ camera.getWorldDirection(_f); _f.y = 0; _f.normalize(); _r.set(-_f.z, 0, _f.x);
  let mx = 0, mz = 0; if (KEY.KeyW || KEY.ArrowUp) { mx += _f.x; mz += _f.z; } if (KEY.KeyS || KEY.ArrowDown) { mx -= _f.x; mz -= _f.z; } if (KEY.KeyD || KEY.ArrowRight) { mx += _r.x; mz += _r.z; } if (KEY.KeyA || KEY.ArrowLeft) { mx -= _r.x; mz -= _r.z; }
  const ml = Math.hypot(mx, mz); if (ml > 0) { mx = mx / ml * sp; mz = mz / ml * sp; const p = camera.position; if (walkFree(p.x + mx, p.z)) p.x += mx; if (walkFree(p.x, p.z + mz)) p.z += mz; }
  if (KEY.Space) setEye(Math.min(84, walk.eye + 20 * dt), true); if (KEY.KeyC) setEye(Math.max(30, walk.eye - 20 * dt), true); camera.position.y = walk.eye;
}
function lead(t) { return t.cars[0]; }
function updateRide(dt) {
  const t = TRAINS[SEL]; if (!t) return; const r = trainRoute(t), y = LV[t.lv].deck + RAILTOP + t.y;
  if (MODE === 'cab') { r.at(t.s - 0.5, _a); r.at(t.s + 0.2, _b); const hx = _b.x - _a.x, hz = _b.z - _a.z, hl = Math.hypot(hx, hz) || 1; camT.set(_a.x - hz / hl * 0.16, y + 0.98, _a.z + hx / hl * 0.16); r.at(t.s + 9, _d); lookS.set(_d.x, y + 0.75, _d.z); }
  else { r.at(t.s - 16, _a); r.at(t.s - 15, _b); const hx = _b.x - _a.x, hz = _b.z - _a.z, hl = Math.hypot(hx, hz) || 1; camT.set(_a.x + hz / hl * 4, y + 5.5, _a.z - hx / hl * 4); r.at(t.s - 2, _d); lookS.set(_d.x, y + 0.6, _d.z); }
  const k = snapCam ? 1 : 1 - Math.exp(-dt * (MODE === 'cab' ? 14 : 4)); camera.position.lerp(camT, k); camL.lerp(lookS, snapCam ? 1 : 1 - Math.exp(-dt * 8)); camera.lookAt(camL); snapCam = false;
}
// ------------------------------------------------------------------ quality, shadows, LOD
const QUAL = { low: { pr: 1.0, det: 0.55, sh: 1024 }, med: { pr: 1.25, det: 1.0, sh: 1024 }, high: { pr: 1.5, det: 1.7, sh: 2048 } }; let Q = QS.get('q') || 'med';
function setQuality(q) { Q = q; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUAL[q].pr)); sun.shadow.mapSize.set(QUAL[q].sh, QUAL[q].sh); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } if (typeof SHON !== 'undefined' && SOFTSH && !SHON && renderer.shadowMap.enabled) SHCLEAR = 1; document.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('on', b.dataset.q === q)); onResize(); }
// [NO-STUTTER 2026-10-18] "soft" shadow switching (default unless ?q=low or ?shadows=hard): the shadow-capable shaders are compiled once at load and
// stay; "off" just stops the shadow pass and points the (cleared) shadow map at empty space, so G / Pedestrian toggle without a recompile hitch.
const SOFTSH = (QS.get('q') || 'med') !== 'low' && QS.get('shadows') !== 'hard'; let SHON = false, SHCLEAR = 0;
const remat = () => scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
function setShadows(on) { SHON = !!on;
  if (SOFTSH) { if (!renderer.shadowMap.enabled) { renderer.shadowMap.enabled = true; sun.castShadow = true; remat(); } renderer.shadowMap.autoUpdate = SHON; if (SHON) renderer.shadowMap.needsUpdate = true; else SHCLEAR = 1; }
  else { renderer.shadowMap.enabled = on; sun.castShadow = on; remat(); }
  document.getElementById('shadows').checked = on; }
sun.position.set(CEN[0] - 60, 140, CEN[1] - 40); sun.target.position.set(CEN[0], 40, CEN[1]); const sc = sun.shadow.camera; sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 20; sc.far = 400; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
// distance culling for small details (bounding sphere per instanced mesh)
for (const o of LV) for (const [m] of o.detail) { const b = new THREE.Box3(), v = new THREE.Vector3(); for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, _m); v.setFromMatrixPosition(_m); b.expandByPoint(v); } m.userData.sph = b.getBoundingSphere(new THREE.Sphere()); m.frustumCulled = false; }
LV.forEach(o => o.g.traverse(x => { if (x.isInstancedMesh) x.frustumCulled = false; }));
const SLOD_D = { low: 60, med: 100, high: 170 };
function lod() { const sd = SLOD_D[Q] || 110; for (const c of SLOD) { const near = camera.position.distanceTo(c.c) < sd + 28; c.gd.visible = near; c.gf.visible = !near; }
  for (const o of LV) for (const [m, dist, near] of o.detail) { const s = m.userData.sph, dd = camera.position.distanceTo(s.center) - s.radius; m.visible = dd < dist * QUAL[Q].det && (!near || dd >= near * QUAL[Q].det); } }
// ------------------------------------------------------------------ UI
const $ = id => document.getElementById(id);
$('ttl').textContent = `${D.name} — N scale 1:160 · L1 deck ${D.deckHeights[0]}" · L2 deck ${D.deckHeights[1] || '-'}" (sep ${D.levelSeparation}")`;
TRAINS.forEach((t, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${t.sym} (${t.cars.length} units, ${t.len.toFixed(0)}")${t.dir === 'CW' ? ' — CW (even no.)' : ' — CCW (odd no.)'}${/^lift/.test(t.route) ? ' — via elevator' : ''}`; $('train').appendChild(o); });
$('train').onchange = e => { SEL = +e.target.value; snapCam = true; };
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.querySelectorAll('[data-q]').forEach(b => b.onclick = () => setQuality(b.dataset.q));
document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => setView(b.dataset.v));
$('pause').onclick = () => { SIM.paused = !SIM.paused; $('pause').classList.toggle('on', SIM.paused); };
$('speed').oninput = e => { SIM.mph = +e.target.value; $('spd').textContent = SIM.mph; };
$('lv1').onchange = e => LV[0].g.visible = e.target.checked; $('lv2').onchange = e => LV[1] && (LV[1].g.visible = e.target.checked);
$('labels').onchange = e => LV.forEach(o => o.labels.visible = e.target.checked); /* [CHOCO-NAMES] */ if ($('names')) $('names').onchange = e => LV.forEach(o => o.names && (o.names.visible = e.target.checked));
$('fps').onchange = e => $('stats').style.display = e.target.checked ? 'block' : 'none';
$('shadows').onchange = e => setShadows(e.target.checked);
const toggleHelp = () => $('help').classList.toggle('hidden'); $('helpb').onclick = toggleHelp; $('helpx').onclick = toggleHelp;
// [ZOOM] walk / cab zoom: wheel or + / - change the FOV smoothly (base FOV down to 10 deg), 0 or middle-click resets; mouse-look slows in proportion
const ZOOM = { k: 1, kt: 1, base: camera.fov, mine: null, MINF: 10,
  on: () => MODE === 'walk' || MODE === 'cab' || MODE === 'ped',
  maxK() { return Math.tan(ZOOM.base * Math.PI / 360) / Math.tan(ZOOM.MINF * Math.PI / 360); },
  step(d) { ZOOM.kt = Math.min(ZOOM.maxK(), Math.max(1, ZOOM.kt * Math.pow(1.25, d))); }, reset() { ZOOM.kt = 1; },
  fov() { return 2 * Math.atan(Math.tan(ZOOM.base * Math.PI / 360) / ZOOM.k) * 180 / Math.PI; },
  update(dt) { if (ZOOM.mine !== null && Math.abs(camera.fov - ZOOM.mine) > 1e-6) ZOOM.base = camera.fov;   // someone else (mode switch / ops cab) set a new base FOV
    if (!ZOOM.on()) { ZOOM.kt = 1; } ZOOM.k += (ZOOM.kt - ZOOM.k) * (1 - Math.exp(-dt * 10)); if (Math.abs(ZOOM.k - ZOOM.kt) < 1e-3) ZOOM.k = ZOOM.kt;
    if (ZOOM.k !== 1 || ZOOM.mine !== null) { const f = ZOOM.fov(); if (Math.abs(camera.fov - f) > 1e-6) { camera.fov = f; camera.updateProjectionMatrix(); } ZOOM.mine = ZOOM.k === 1 ? null : f; if (ZOOM.k === 1) camera.fov = ZOOM.base; }
    plc.pointerSpeed = 1 / ZOOM.k; const el = document.getElementById('zoomind');
    if (el) { const show = ZOOM.on() && ZOOM.kt > 1.001; el.style.display = show ? 'block' : 'none'; if (show) el.textContent = `Zoom ${ZOOM.k.toFixed(1)}x  (${camera.fov.toFixed(0)}\u00b0)  -  wheel / + - , 0 or middle-click resets`; } } };
addEventListener('wheel', e => { if (MODE === 'fly' && L3D.flyped && (plc.isLocked || e.target === renderer.domElement)) { e.preventDefault(); L3D.flyped.wheel(e.deltaY); return; } if (!ZOOM.on()) return; if (!plc.isLocked && e.target !== renderer.domElement) return; e.preventDefault(); ZOOM.step(e.deltaY < 0 ? 1 : -1); }, { passive: false });
addEventListener('mousedown', e => { if (e.button === 1 && ZOOM.on() && (plc.isLocked || e.target === renderer.domElement)) { e.preventDefault(); ZOOM.reset(); } });
addEventListener('keydown', e => { KEY[e.code] = true; if (e.target.tagName === 'INPUT' && e.target.type === 'range') return;
  const k = e.code; if (k === 'Digit1') setMode('orbit'); else if (k === 'Digit2') setMode('walk'); else if (k === 'Digit3') setMode('cab'); else if (k === 'Digit4') setMode('chase');
  else if (k === 'Digit5') setMode('fly'); else if (k === 'Digit6') setMode('ped'); /* [FLYPED] */
  else if (MODE === 'fly' && (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract')) L3D.flyped.wheel(k === 'Equal' || k === 'NumpadAdd' ? -1 : 1); else if (MODE === 'fly' && k === 'KeyX') L3D.flyped.key(k);
  else if (k === 'Home') { setMode('walk'); goSpawn(); STATS.walkEnter = 'home'; }
  else if (k === 'KeyN') { SEL = (SEL + 1) % Math.max(1, TRAINS.length); $('train').value = SEL; snapCam = true; } else if (k === 'KeyP') $('pause').click();
  else if (ZOOM.on() && (k === 'Equal' || k === 'NumpadAdd' || k === 'Minus' || k === 'NumpadSubtract')) ZOOM.step(k === 'Equal' || k === 'NumpadAdd' ? 1 : -1);
  else if (ZOOM.on() && (k === 'Digit0' || k === 'Numpad0')) ZOOM.reset();
  else if (k === 'Equal' || k === 'NumpadAdd') { $('speed').value = SIM.mph = Math.min(60, SIM.mph + 5); $('spd').textContent = SIM.mph; } else if (k === 'Minus' || k === 'NumpadSubtract') { $('speed').value = SIM.mph = Math.max(0, SIM.mph - 5); $('spd').textContent = SIM.mph; }
  else if (k === 'KeyB' && $('names')) { $('names').checked = !$('names').checked; $('names').onchange({ target: $('names') }); } else if (k === 'KeyL') { $('labels').checked = !$('labels').checked; $('labels').onchange({ target: $('labels') }); } else if (k === 'KeyF') { $('fps').checked = !$('fps').checked; $('fps').onchange({ target: $('fps') }); }
  else if (k === 'KeyG') setShadows(!SHON); else if (k === 'KeyH') toggleHelp(); else if (k === 'KeyQ' && MODE !== 'fly') setQuality({ low: 'med', med: 'high', high: 'low' }[Q]);
  if (LOOKM(MODE) && (k === 'Space' || k === 'PageUp' || k === 'PageDown' || (MODE !== 'walk' && /^Arrow/.test(k)))) e.preventDefault(); });
addEventListener('keyup', e => KEY[e.code] = false); addEventListener('blur', () => { for (const k in KEY) KEY[k] = false; });
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); } addEventListener('resize', onResize);
// ------------------------------------------------------------------ boot (URL params let scripts drive views: mode, view, train, cam=x,y,z,tx,ty,tz, t=pre-roll seconds, q, shadows, labels, ui)
window.addEventListener('error', e => STATS.errors.push(String(e.message)));
setQuality(Q); if (QS.get('shadows') === '1' || (Q === 'high' && QS.get('shadows') !== '0')) setShadows(true); else if (SOFTSH) { setShadows(false); SHCLEAR = 3; }   /* compile the shadow variants now, during load */
if (QS.get('names') === '0' && $('names')) { $('names').checked = false; LV.forEach(o => o.names && (o.names.visible = false)); } if (QS.get('names') === '1' && $('names')) { $('names').checked = true; LV.forEach(o => o.names && (o.names.visible = true)); } if (QS.get('labels') === '1') { $('labels').checked = true; LV.forEach(o => o.labels.visible = true); }
if (QS.get('ui') === '0') { $('ui').style.display = 'none'; $('stats').style.display = 'none'; document.body.classList.add('l3d-hideui'); /* [CHOCO-UI0] */ }
SEL = Math.min(TRAINS.length - 1, Math.max(0, +(QS.get('train') || 0))); $('train').value = SEL; $('speed').value = SIM.mph; $('spd').textContent = SIM.mph;
for (let k = 0, n = Math.round(+(QS.get('t') || 0) / 0.05); k < n; k++) stepTrains(0.05); stepTrains(0);
setMode('orbit'); if (QS.get('view')) setView(QS.get('view')); walk.init = false; const QM = QS.get('mode') || ''; setMode(/^(fly|ped)$/.test(QM) ? 'orbit' : QM || (QS.get('view') || QS.get('cam') ? 'orbit' : 'walk')); /* [SPAWN] default start = Walk at the aisle spawn */
if (QS.get('cam')) { const c = QS.get('cam').split(',').map(Number); camera.position.set(c[0], c[1], c[2]); if (MODE === 'orbit') { orbit.target.set(c[3], c[4], c[5]); orbit.update(); } else { camera.lookAt(c[3], c[4], c[5]); if (MODE === 'walk') walk.eye = c[1]; } }
STATS.api = { lod: () => lod(), spurInd: SPURIND, scene, renderer, setMode, setView, setQuality, setShadows, trains: TRAINS, spawn: SPAWN, goSpawn, inAisle, room: ROOM, camera, stepTrains, walkFree,
  LV, RAILTOP, EYE, orbit, plc, KEY, getMode: () => MODE, teleport, getSel: () => SEL, setSel: i => { SEL = i; $('train').value = i; snapCam = true; }, SIM, LOOK0, CEN, liftMesh: () => liftMesh, LIFT, NLEV, L3, deckAbs, TRAINS, advance: (sec, h = 0.05) => { for (let k = 0, n = Math.round(sec / h); k < n; k++) stepTrains(h); }, sun, onBoard, trackDist, setEye: y => { walk.eye = y; }, hemi, amb, shadowsOn: () => SHON, softShadows: SOFTSH };
if (L3D.ambience) try { L3D.ambience.init(STATS.api); } catch (e) { STATS.errors.push('ambience: ' + e.message); console.error(e); } // [AMBIENCE-HOOK]
if (L3D.flyped) try { L3D.flyped.init(STATS.api); if (QM === 'fly') setMode('fly'); if (QS.get('ped')) { const q = QS.get('ped').split(',').map(Number); L3D.flyped.placePed(q[0] | 0, q[1], q[2], q.length > 3 ? q[3] * Math.PI / 180 : null); } else if (QM === 'ped') setMode('ped'); } catch (e) { STATS.errors.push('flyped: ' + e.message); console.error(e); } // [FLYPED-HOOK]
if (L3D.overpass) try { L3D.overpass.build(STATS.api); } catch (e) { STATS.errors.push('overpass: ' + e.message); console.error(e); } // [OVERPASS-HOOK]
if (L3D.crossings) try { L3D.crossings.build(STATS.api); STATS.api.crossings = L3D.crossings; } catch (e) { STATS.errors.push('crossings: ' + e.message); console.error(e); } // [XING-HOOK]
if (LOGI) try { L3D.logistics.init(STATS.api); STATS.api.logistics = L3D.logistics; } catch (e) { STATS.errors.push('logistics: ' + e.message); console.error(e); } // [LOGI-HOOK]
if (L3D.lifewire) try { L3D.lifewire.init(STATS.api); } catch (e) { STATS.errors.push('life: ' + e.message); console.error(e); } // [R34 LIFE-HOOK]
if (OPSH && OPSH.attach) try { OPSH.attach(STATS.api); } catch (e) { STATS.errors.push('ops attach: ' + e.message); console.error(e); }
let last = performance.now(), acc = 0, nfr = 0, lodTick = 0;
function loop(now) {
  const real = (now - last) / 1000, dt = Math.max(0, Math.min(0.1, real)); last = now;   /* [R34] first rAF stamp can precede last (negative dt ran life/ops backwards) */ CEILG.visible = camera.position.y < CEIL - 0.5;
  stepTrains(dt); if (L3D.crossings) try { L3D.crossings.tick(dt); } catch (e) { STATS.errors.push('xing: ' + e.message); } if (OPSH) try { OPSH.update(dt); } catch (e) { STATS.errors.push('ops: ' + e.message); } if (LOGI) try { L3D.logistics.tick(dt * Math.min(8, (window.__ops3d && window.__ops3d.rateOf) ? window.__ops3d.rateOf() : 1)); }   /* [R36] the logistics switcher / shuttles follow the ops time rate (they ran at 1x whatever the rate) */ catch (e) { STATS.errors.push('logi: ' + e.message); }
  if (OPSH && OPSH.camera && OPSH.camera(dt, MODE)) {} else if (MODE === 'walk') updateWalk(dt); else if (MODE === 'fly' || MODE === 'ped') L3D.flyped.update(dt, MODE); else if (MODE === 'cab' || MODE === 'chase') updateRide(dt); else orbit.update();
  if (L3D.lifewire && L3D.lifewire.on) L3D.lifewire.update(dt, camera);   // [R34 LIFE-HOOK]
  if (lodTick++ % 10 === 0) lod();
  if (L3D.reach && L3D.reach.ctx) L3D.reach.update(dt); // [REACH-HOOK]
  const AU = window.LAYOUT3D_AUDIO; if (AU && AU.update) try { AU.update(dt, camera, TRAINS); } catch (e) { console.warn('audio', e); } // ops/audio hook (optional)
  ZOOM.update(dt);
  const shwarm = SHCLEAR === 2; if (SHCLEAR === 3) SHCLEAR = 2; else if (shwarm) { renderer.shadowMap.needsUpdate = true; SHCLEAR = 0; }   // boot: frame 2 (lights set up) does one real shadow pass so the depth programs are compiled too, frame 3 clears
  let shp = null; if (SHCLEAR === 1) { shp = [sun.position.clone(), sun.target.position.clone()]; sun.position.y += 1e5; sun.target.position.y += 1e5; sun.target.updateMatrixWorld(); renderer.shadowMap.needsUpdate = true; SHCLEAR = 0; }
  if (L3D.ambience && L3D.ambience.update) L3D.ambience.update(dt);
  /* [CHOCO-NAMES] fade: full within 70 in, gone past 150 in or closer than 3 in */ for (const o of LV) if (o.names && o.names.visible && o.g.visible !== false) for (const sp of o.names.children) { const d = camera.position.distanceTo(sp.position); sp.material.opacity = d < 3 ? 0 : d < 70 ? 1 : Math.max(0, 1 - (d - 70) / 80); sp.visible = sp.material.opacity > 0.02; }
  renderer.render(scene, camera); nfr++; acc += real; if (shwarm) SHCLEAR = 1; if (shp) { sun.position.copy(shp[0]); sun.target.position.copy(shp[1]); sun.target.updateMatrixWorld(); }
  if (acc >= 0.5) { STATS.fps = nfr / acc; STATS.calls = renderer.info.render.calls; STATS.tris = renderer.info.render.triangles; nfr = 0; acc = 0;
    (() => { const S = $('stats'); let t = S.querySelector('.stats-txt'); if (!t) { t = document.createElement('span'); t.className = 'stats-txt'; S.appendChild(t); } return t; })().textContent = /* [CHOCO-STATS] text in a child span so the minimise button survives */ `${STATS.fps.toFixed(0)} fps  ${STATS.calls} draw calls  ${(STATS.tris / 1000).toFixed(0)}k tris\n${MODE}${MODE === 'cab' || MODE === 'chase' ? ' · ' + (TRAINS[SEL] || {}).sym : ''} · ${SIM.paused ? 'paused' : SIM.mph + ' mph'} · quality ${Q}${renderer.shadowMap.enabled ? ' · shadows' : ''}`; }
  STATS.ready = true; STATS.trains = TRAINS; STATS.camera = camera; STATS.scene = scene; STATS.audioHook = 'window.LAYOUT3D_AUDIO = { attach(layout3d), update(dt, camera, trains) }; per train: trains[i].cars[j].cx/cy/cz, .v (in/s), .sym, .state';
if (!loop._init) { loop._init = true;   /* [R28 item 10 LEAK] these sat inside loop(): reach.init added a 'reach' group + envelope Points every frame and audio re-attached (≈ +8 scene objects per frame, 1,900 -> 3,700 in 30 min) */
if (L3D.reach) try { L3D.reach.init({ scene, camera, renderer, LV, PERSON, ROOM, walkFree, getMode: () => MODE, target: () => orbit.target }); } catch (e) { console.error('reach', e); } // [REACH-HOOK]
if (window.LAYOUT3D_AUDIO && window.LAYOUT3D_AUDIO.attach) try { window.LAYOUT3D_AUDIO.attach(STATS); } catch (e) { console.warn('audio attach', e); } }
requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
