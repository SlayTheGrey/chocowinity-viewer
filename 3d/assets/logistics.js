/* logistics.js - draws the goal-driven town (logistics-core.js) in the 3D viewer: vehicles, people, horses, clock HUD, click-to-inspect, ops rail tie-in.
   Data: window.LOGISTICS (logistics-data.js, written by build_viewer.py from <plan>/logistics.json). ?logi=0 = the old static scene. ?time=HH:MM start clock. */
(function () {
'use strict';
const L3D = window.L3D = window.L3D || {}; const QS = new URLSearchParams(location.search);
const G = L3D.logistics = { active: !!window.LOGISTICS && QS.get('logi') !== '0' && !!(L3D.logiCore) };
if (!G.active) return;
const MODEL = { sedan: ['veh-sedan'], suv: ['veh-suv', 'veh-sedan'], pickup: ['veh-pickup'], semi: ['veh-semi'], reefer: ['veh-semi'], boxtruck: ['veh-boxtruck', 'veh-semi'], ups: ['veh-ups', 'veh-boxtruck'],
  tow: ['veh-tow', 'veh-pickup'], tanker: ['veh-tanker', 'veh-semi'], 'bulk-trailer': ['veh-bulk-trailer', 'veh-semi'], flatbed: ['veh-flatbed', 'veh-semi'], autohauler: ['veh-autohauler', 'veh-semi'],
  hirail: ['veh-hirail', 'veh-pickup'], 'grain-truck': ['veh-grain-truck', 'veh-semi'], 'grain-straight': ['veh-grain-straight', 'veh-boxtruck'], schoolbus: ['veh-schoolbus', 'veh-boxtruck'], van: ['veh-suv'], 'horse-trailer': ['veh-pickup'] };
const has = id => !!(L3D.ext && L3D.ext.has && L3D.ext.has(id));
const pick = m => { const c = MODEL[m] || ['veh-sedan']; return c.find(has) || c[c.length - 1]; };
let api, S, T, meshes = {}, pmesh = {}, hmesh = {}, hud, panel, horses = [], sel = null, todSet = null, lastTod = '';
const _m = new (window.THREE.Matrix4)(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _z = new THREE.Vector3(0, 0, 0), _c = new THREE.Color();
/* [RV2] people on a curbed sidewalk stand on its top (15 cm above the street): 0.1 in occupancy grid of the walk outlines per level */
const WALKG = {}; function walkTop(lv, x, z) { let G = WALKG[lv]; if (!G) { G = WALKG[lv] = new Set(); const Lv = (window.LAYOUT && window.LAYOUT.levels || [])[lv - 1];
    for (const l of (Lv && Lv.lots) || []) { if (l.kind !== 'walk' || !l.pts) continue; const P = l.pts, xs = P.map(p => p[0]), zs = P.map(p => p[1]);
      for (let gx = Math.floor(Math.min(...xs) * 10); gx <= Math.ceil(Math.max(...xs) * 10); gx++) for (let gz = Math.floor(Math.min(...zs) * 10); gz <= Math.ceil(Math.max(...zs) * 10); gz++) { const px = gx / 10, pz = gz / 10; let inn = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > pz) !== (P[j][1] > pz) && px < (P[j][0] - P[i][0]) * (pz - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) inn = !inn; if (inn) G.add(gx * 100000 + gz); } } }
  const lot = G.has(Math.round(x * 10) * 100000 + Math.round(z * 10)) ? 0.0589 : 0; const r = surfTop(lv, x, z); return r == null ? lot : Math.max(lot, r); }
/* [R37 A1] feet on the real walking surface: raycast down onto the static level meshes (sidewalks, porches, steps, platforms), cached on a 0.05 in grid.
   Window: 0..0.32 in above the deck/terrain and an upward-facing face, so roofs, cars and people never count. */
const SURFC = {}, SURFM = {}; let surfRC = null; const SURF_MAX = 0.32;
function surfTop(lv, x, z) { if (!api || typeof THREE === 'undefined') return null; const key = lv + ':' + Math.round(x * 20) + ':' + Math.round(z * 20); if (key in SURFC) return SURFC[key];
  let M = SURFM[lv]; if (!M) { const L = api.scene.getObjectByName('L' + lv); if (!L) return null; M = SURFM[lv] = []; L.traverse(o => { if (o.isMesh && !o.isSkinnedMesh && o.visible !== false) M.push(o); }); }
  if (!surfRC) surfRC = new THREE.Raycaster(); const g = deckY(lv, x, z); surfRC.set(new THREE.Vector3(x, g + SURF_MAX, z), new THREE.Vector3(0, -1, 0)); surfRC.far = SURF_MAX + 0.03;
  let r = 0; const N = new THREE.Vector3(); for (const h of surfRC.intersectObjects(M, false)) { if (!h.face) continue; N.copy(h.face.normal).transformDirection(h.object.matrixWorld); if (N.y < 0.6) continue; r = Math.max(0, Math.min(SURF_MAX, h.point.y - g)); break; }
  return (SURFC[key] = r); }
G.surfTop = surfTop; G.deckY = (lv, x, z) => deckY(lv, x, z);
const deckY = (lv, x, z) => { const o = api.LV[lv - 1]; return o.deck + (o.terrain ? Math.max(0, o.terrain.h(x, z)) : 0); };
function env() {
  const X = () => L3D.crossings && L3D.crossings.list || [];
  const near = (lv, x, y, r) => X().some(c => c.lv === lv - 1 && (c.on || c.arm > 0.02) && c.hits.some(h => Math.hypot(h[0] - x, h[1] - y) < r));
  return { xingOn: (lv, x, y) => near(lv, x, y, 1.4), trainNear: (lv, x, y) => near(lv, x, y, 2.0) || trainClose(lv, x, y) };
}
function trainClose(lv, x, y) { for (const t of api.TRAINS || []) { if (t.lv !== lv - 1 || !t.cars) continue; for (const c of t.cars) if (c.cx != null && Math.hypot(c.cx - x, c.cz - y) < 8 && Math.abs(t.v || 0) > 0.1) return true; } return false; }
/* [FIX2] model sets drawn like viewer.js: ext glb 'parts' mode -> one InstancedMesh per part (only the paint part tinted); otherwise L3D.geo
   (ext merged geometry, or the REALISM likeness rebuild with its baked material) with a per-instance colour. Marks the ids used (prune_ext keeps them). */
const NOTINT = new Set(['veh-ups', 'veh-schoolbus', 'veh-autohauler', 'veh-tanker', 'veh-bulk-trailer', 'veh-hirail', 'veh-tractor']);   // liveried models: own colours
function vcolW(g) { if (!g.attributes || g.attributes.color || !g.attributes.position) return; const n = g.attributes.position.count, a = new Float32Array(n * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
function inst(id, n, key) { (window.__L3D_USED = window.__L3D_USED || {})[id] = 1; const E = L3D.ext, XV = E && E.has && E.has(id) && E.ovr(id).mode === 'parts', parts = [];
  if (id === 'veh-autohauler' && E && E.has && E.has(id) && E.parts) splitLoad(E.parts(id), parts);   // [FIX2] the deck cars are a separate load: empty on arrival
  else if (E && E.vehRig && E.has && E.has(id) && E.vehRig(id)) { VR[id] = E.vehRig(id); for (const pt of VR[id].parts) parts.push({ geo: pt.geo, mat: pt.mat, tint: false, grp: pt.grp }); }   // [RV2] rigged: wheels / trailer move
  else if (XV) for (const pt of E.parts(id)) parts.push({ geo: pt.geo, mat: pt.mat, tint: /^(body[_-]?)?paint$/i.test(pt.name || '') && !E.ovr(id).noTint, load: /load|cargo|car_?\d/i.test(pt.name || '') });
  else { const like = L3D.likenessVeh && L3D.likenessVeh.has(id) && !(E && E.has && E.has(id)); parts.push({ geo: L3D.geo(id), mat: like ? L3D.bakedGlossy() : L3D.mat(key || 'glossy'), tint: !NOTINT.has(id) && /^veh-/.test(id) }); }
  const set = { id, parts: [], count: 0, cap: Math.max(1, n), ids: [] };
  for (const P of parts) { vcolW(P.geo); const m = new THREE.InstancedMesh(P.geo, P.mat, set.cap); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.userData.logi = id; m.userData.ids = set.ids;
    m.setColorAt(0, _c.setRGB(1, 1, 1)); api.scene.add(m); set.parts.push({ m, tint: P.tint, load: P.load, slot: P.slot || 0, grp: P.grp || 0 }); }
  set.rig = VR[id] || null; if (set.rig) set.GM = set.rig.G.map(() => new THREE.Matrix4());
  return set; }
function splitLoad(src, parts) {   // car_* parts = the load; wheels / glass / lights of those cars (triangles inside a car box) also go to the load
  const boxes = []; for (const pt of src) if (/^car_/i.test(pt.name || '')) { pt.geo.computeBoundingBox(); const b = pt.geo.boundingBox.clone(); b.min.x -= 0.06; b.max.x += 0.06; b.min.y -= 0.12; b.max.y += 0.42; b.min.z -= 0.06; b.max.z += 0.06; boxes.push(b); }
  const inB = (b, x, y, z) => x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y && z >= b.min.z && z <= b.max.z; let ci = 0;
  for (const pt of src) { const tint = /^(body[_-]?)?paint$/i.test(pt.name || ''); if (/^car_/i.test(pt.name || '')) { parts.push({ geo: pt.geo, mat: pt.mat, tint: false, load: true, slot: ci++ }); continue; }
    const g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo, P = g.attributes.position, n = P.count / 3, A = [], B = [];
    const Bs = boxes.map(() => []); for (let t = 0; t < n; t++) { let hit = -1; for (let bi = 0; bi < boxes.length && hit < 0; bi++) { let all = true; for (let k = 0; k < 3; k++) if (!inB(boxes[bi], P.getX(3 * t + k), P.getY(3 * t + k), P.getZ(3 * t + k))) { all = false; break; } if (all) hit = bi; } (hit < 0 ? A : Bs[hit]).push(t); }
    if (!Bs.some(x => x.length)) { parts.push({ geo: pt.geo, mat: pt.mat, tint, load: false }); continue; }
    const sub = T => { const o = new THREE.BufferGeometry(); for (const nm in g.attributes) { const at = g.attributes[nm], w = at.itemSize, arr = new at.array.constructor(T.length * 3 * w);
        T.forEach((t, j) => { for (let k = 0; k < 3 * w; k++) arr[j * 3 * w + k] = at.array[t * 3 * w + k]; }); o.setAttribute(nm, new THREE.BufferAttribute(arr, w, at.normalized)); } return o; };
    parts.push({ geo: sub(A), mat: pt.mat, tint, load: false }); Bs.forEach((T, bi) => { if (T.length) parts.push({ geo: sub(T), mat: pt.mat, tint: false, load: true, slot: bi }); }); } }
/* [RV2] moving parts of rigged road vehicles. Wheels spin by distance / radius, front wheels steer atan(wheelbase x path curvature), and
   tractor-trailers articulate: the tractor's front axle follows the sim path (forward) and its rear tandem follows as a tractrix; the trailer
   axle follows the kingpin the same way (real off-tracking). Backing up the trailer axle leads instead (pushed along the path). Teleports reset. */
const VR = {}, _A = new THREE.Matrix4(), _B = new THREE.Matrix4(), _C2 = new THREE.Matrix4(), _Y = new THREE.Matrix4(), _Zr = new THREE.Matrix4(), _LT = new THREE.Matrix4();
function vehPose(V, set, dt) { const R = set.rig, r = V._rg || (V._rg = { spin: 0, st: 0 }), h = V.h, ux = Math.cos(h), uy = Math.sin(h), half = 0.36 * V.len;
  const ds0 = r.px != null ? Math.hypot(V.x - r.px, V.y - r.py) : 0, fwd = r.px == null ? 1 : ((V.x - r.px) * ux + (V.y - r.py) * uy) >= 0 ? 1 : -1, ds = ds0 > 0.8 ? 0 : ds0 * fwd, jump = r.px == null || ds0 > 0.8; r.px = V.x; r.py = V.y;
  let yT = h; const semi = R.trailer >= 0 && R.xK != null && R.xT != null;
  if (semi) { const wbT = Math.max(0.1, R.xF - R.xR), kr = R.xK - R.xR, lt = Math.max(0.2, R.xK - R.xT), nrm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    if (jump || !r.F) { r.F = [V.x + R.xF * ux, V.y + R.xF * uy]; r.Rr = [V.x + R.xR * ux, V.y + R.xR * uy]; r.Ta = [V.x + R.xT * ux, V.y + R.xT * uy]; r.yT = h; r.yL = h; }
    else if (ds > 0) { r.F = [V.x + ux * half + (R.xF - half) * ux, V.y + uy * half + (R.xF - half) * uy]; let d = nrm(r.F[0] - r.Rr[0], r.F[1] - r.Rr[1]); r.Rr = [r.F[0] - d[0] * wbT, r.F[1] - d[1] * wbT]; r.yT = Math.atan2(d[1], d[0]);
      const K = [r.Rr[0] + kr * Math.cos(r.yT), r.Rr[1] + kr * Math.sin(r.yT)]; d = nrm(K[0] - r.Ta[0], K[1] - r.Ta[1]); r.Ta = [K[0] - d[0] * lt, K[1] - d[1] * lt]; r.yL = Math.atan2(d[1], d[0]); }
    else if (ds < 0) { r.Ta = [V.x - ux * half + (R.xT + half) * ux, V.y - uy * half + (R.xT + half) * uy]; const K0 = [r.Rr[0] + kr * Math.cos(r.yT), r.Rr[1] + kr * Math.sin(r.yT)]; let d = nrm(K0[0] - r.Ta[0], K0[1] - r.Ta[1]);
      const K = [r.Ta[0] + d[0] * lt, r.Ta[1] + d[1] * lt]; r.yL = Math.atan2(d[1], d[0]); r.Rr = [K[0] - kr * Math.cos(r.yT), K[1] - kr * Math.sin(r.yT)]; d = nrm(r.F[0] - r.Rr[0], r.F[1] - r.Rr[1]); r.yT = Math.atan2(d[1], d[0]); r.F = [r.Rr[0] + d[0] * wbT, r.Rr[1] + d[1] * wbT]; }
    let art = r.yL - r.yT; art = Math.atan2(Math.sin(art), Math.cos(art)); if (Math.abs(art) > 1.3) { r.yL = r.yT + Math.sign(art) * 1.3; art = r.yL - r.yT; }   // no jackknife past ~75 deg
    yT = r.yT; _p.set(r.F[0] - R.xF * Math.cos(yT), _p.y, r.F[1] - R.xF * Math.sin(yT)); _q.setFromEuler(_e.set(0, -yT, 0));
    const k = R.G[R.trailer].piv; _LT.makeTranslation(k.x, k.y, k.z).multiply(_Y.makeRotationY(-art)).multiply(_A.makeTranslation(-k.x, -k.y, -k.z)); }
  // steering from the curvature of the (tractor) heading, low-passed like a driver's hands
  const dy = r.hy != null && !jump ? Math.atan2(Math.sin(yT - r.hy), Math.cos(yT - r.hy)) : 0; r.hy = yT; const kap = Math.abs(ds) > 1e-4 ? dy / ds : r.kap || 0; if (Math.abs(ds) > 1e-4) r.kap = kap;
  const st = Math.max(-0.6, Math.min(0.6, Math.atan(R.wb * kap))); r.st += (st - r.st) * Math.min(1, dt * 5); r.spin += ds / Math.max(0.01, R.r);
  _B.compose(_p, _q, _s);
  for (let gi = 1; gi < R.G.length; gi++) { const g = R.G[gi], M = set.GM[gi]; M.copy(_B); if (g.k === 'trailer') { if (semi) M.multiply(_LT); continue; }
    if (g.parent != null && g.parent >= 0 && semi) M.multiply(_LT); const w = g.piv; M.multiply(_A.makeTranslation(w.x, w.y, w.z)); if (g.front) M.multiply(_Y.makeRotationY(-r.st));
    M.multiply(_Zr.makeRotationZ(-r.spin)).multiply(_C2.makeTranslation(-w.x, -w.y, -w.z)); }
}
function setBegin(set) { set.count = 0; set.ids.length = 0; }
function setPut(set, color, tag, load) { if (set.count >= set.cap) return; _m.compose(_p, _q, _s); for (const P of set.parts) { const k = set.count;
    P.m.setMatrixAt(k, (P.load && !(load === true || P.slot < load)) ? _z0 : (P.grp && set.GM ? set.GM[P.grp] : _m)); P.m.setColorAt(k, P.tint && color ? _c.set(color) : _c.setRGB(1, 1, 1)); } set.ids[set.count++] = tag; }
function setEnd(set) { for (const P of set.parts) { P.m.count = set.count; P.m.instanceMatrix.needsUpdate = true; if (P.m.instanceColor) P.m.instanceColor.needsUpdate = true; } }
const _z0 = new THREE.Matrix4().makeScale(0, 0, 0);
/* [RV1] procedural limb animation. Any person / horse model (built-in or an ingested Grok glb) is split by triangle into segments in its own
   bounding box: legs (below the hip line, left / right of the centre plane; horses: front / back x left / right), arms (shoulder band, outside the
   torso), the horse's head + neck (front, above the withers), the rest = body. Each segment is its own InstancedMesh rotated about its joint
   (hip / shoulder / withers) per frame. A model whose legs do not split cleanly (too few triangles on a side) falls back to the built-in model. */
const RIG = {};
function rigGeoParts(id) { const E = L3D.ext, XV = E && E.has && E.has(id) && E.ovr(id).mode === 'parts'; (window.__L3D_USED = window.__L3D_USED || {})[id] = 1;
  if (XV) return E.parts(id).map(pt => ({ geo: pt.geo, mat: pt.mat })); return [{ geo: L3D.geo(id), mat: L3D.mat('plain') }]; }
function rigSplit(id, kind) {
  const src = rigGeoParts(id), bb = new THREE.Box3(); for (const P of src) { P.geo.computeBoundingBox(); bb.union(P.geo.boundingBox); }
  const H = bb.max.y - bb.min.y, wx = bb.max.x - bb.min.x, wz = bb.max.z - bb.min.z; if (!(H > 0)) return null;
  // person: lateral = wider horizontal axis; horse: forward = longer horizontal axis
  const latX = kind === 'person' ? wx >= wz : wx < wz, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, y0 = bb.min.y;
  const LAT = latX ? 'x' : 'z', FWD = latX ? 'z' : 'x', cl = latX ? cx : cz, cf = latX ? cz : cx, half = (latX ? wx : wz) / 2, flen = (latX ? wz : wx) / 2;
  const segOf = (x, y, z) => { const l = (LAT === 'x' ? x : z) - cl, f = (FWD === 'x' ? x : z) - cf, h = (y - y0) / H;
    if (kind === 'person') { if (h < 0.47) return l < 0 ? 'legL' : 'legR'; if (h > 0.5 && h < 0.83 && Math.abs(l) > Math.max(0.12 * H, half * 0.55)) return l < 0 ? 'armL' : 'armR'; return 'body'; }
    if (h < 0.42) return (f > 0 ? 'F' : 'B') + (l < 0 ? 'L' : 'R'); if (f > flen * 0.45 && h > 0.5) return 'head'; return 'body'; };
  const out = {}, cnt = {};
  for (const P of src) { const g = P.geo.index ? P.geo.toNonIndexed() : P.geo, A = g.attributes.position, n = A.count / 3, by = {};
    for (let t = 0; t < n; t++) { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { x += A.getX(3 * t + k); y += A.getY(3 * t + k); z += A.getZ(3 * t + k); } const sg = segOf(x / 3, y / 3, z / 3); (by[sg] = by[sg] || []).push(t); cnt[sg] = (cnt[sg] || 0) + 1; }
    for (const sg in by) { const T = by[sg], o = new THREE.BufferGeometry(); for (const nm in g.attributes) { const at = g.attributes[nm], w = at.itemSize, arr = new at.array.constructor(T.length * 3 * w);
        T.forEach((t, j) => { for (let k = 0; k < 3 * w; k++) arr[j * 3 * w + k] = at.array[t * 3 * w + k]; }); o.setAttribute(nm, new THREE.BufferAttribute(arr, w, at.normalized)); } (out[sg] = out[sg] || []).push({ geo: o, mat: P.mat }); } }
  const legs = kind === 'person' ? ['legL', 'legR'] : ['FL', 'FR', 'BL', 'BR'], tot = Object.values(cnt).reduce((a, b) => a + b, 0);
  const ok = legs.every(k => (cnt[k] || 0) >= Math.max(4, tot * 0.015));
  const pv = v => LAT === 'x' ? new THREE.Vector3(cl + v[0], y0 + v[1], cf + v[2]) : new THREE.Vector3(cf + v[2], y0 + v[1], cl + v[0]);
  const piv = kind === 'person' ? { legL: pv([-half * 0.25, 0.48 * H, 0]), legR: pv([half * 0.25, 0.48 * H, 0]), armL: pv([-half * 0.7, 0.8 * H, 0]), armR: pv([half * 0.7, 0.8 * H, 0]) }
    : { FL: pv([0, 0.45 * H, flen * 0.6]), FR: pv([0, 0.45 * H, flen * 0.6]), BL: pv([0, 0.45 * H, -flen * 0.6]), BR: pv([0, 0.45 * H, -flen * 0.6]), head: pv([0, 0.72 * H, flen * 0.4]) };
  // rotation axis for a swing: the lateral axis; sign so + = foot / hand forward
  return { id, kind, ok, arms: (cnt.armL || 0) > 3 && (cnt.armR || 0) > 3, segs: out, piv, axis: LAT === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), H, cnt }; }
function rigSet(ids, n, kind) { for (const id of ids) { if (id !== ids[ids.length - 1] && !has(id)) continue; let R = null; try { R = rigSplit(id, kind); } catch (e) { console.warn('rig', id, e); }
    if (!R || !R.ok) { (window.__RIGFALLBACK = window.__RIGFALLBACK || []).push(id); continue; }
    const set = { R, parts: [], count: 0, cap: Math.max(1, n), ids: [] };
    for (const sg in R.segs) for (const P of R.segs[sg]) { vcolW(P.geo); const m = new THREE.InstancedMesh(P.geo, P.mat, set.cap); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.userData.logi = id; m.userData.ids = set.ids; m.setColorAt(0, _c.setRGB(1, 1, 1)); api.scene.add(m); set.parts.push({ m, sg }); }
    (window.__RIG = window.__RIG || {})[kind + ':' + id] = R.cnt; return set; }
  return null; }
const _rq = new THREE.Quaternion(), _rm = new THREE.Matrix4(), _rt = new THREE.Matrix4(), _rb = new THREE.Matrix4();
function rigPut(set, ang, tag, drop) { if (set.count >= set.cap) return; _rb.compose(_p, _q, _s); const k = set.count, R = set.R;
  for (const P of set.parts) { const a = ang[P.sg] || 0; if (!a) _m.copy(_rb); else { const pv = R.piv[P.sg]; _rq.setFromAxisAngle(R.axis, a); _rt.makeTranslation(pv.x, pv.y, pv.z); _rm.makeRotationFromQuaternion(_rq);
      _m.copy(_rb).multiply(_rt).multiply(_rm); _rt.makeTranslation(-pv.x, -pv.y, -pv.z); _m.multiply(_rt); }
    if (drop) { _rt.makeTranslation(0, -drop, 0); _m.premultiply(_rt); }
    P.m.setMatrixAt(k, _m); P.m.setColorAt(k, _c.setRGB(1, 1, 1)); } set.ids[set.count++] = tag; }

/* [RV1] LIFE layer: rigged, animated glb people + horses (Blender pipeline, window.L3D_SKIN) near the camera. SkinnedMesh can't be instanced, so a small
   pool of clones (own skeleton + AnimationMixer each) is handed to the nearest figures every frame (people <= LIFE_N within LIFE_R in; every horse
   within HORSE_R). Everyone else keeps the instanced procedural rig. Clips: idle / walk / graze / sit / work; walk is in place, timeScale follows speed. */
const LIFE = { lib: {}, ws: {}, ready: false, pool: {}, used: new Map(), n: 0 }, LIFE_N = +(QS.get('lifen') || 20), LIFE_R = +(QS.get('lifer') || 20), HORSE_R = +(QS.get('horser') || 30), MM = 1 / 25.4;
function skClone(src) { const c = src.clone(true), sm = [], cm = [], bones = {}; src.traverse(n => { if (n.isSkinnedMesh) sm.push(n); }); c.traverse(n => { if (n.isSkinnedMesh) cm.push(n); if (n.isBone) bones[n.name] = n; });
  cm.forEach((m, i) => { const sk = sm[i].skeleton; m.skeleton = new THREE.Skeleton(sk.bones.map(b => bones[b.name]), sk.boneInverses.map(x => x.clone())); m.bind(m.skeleton, sm[i].bindMatrix.clone()); m.frustumCulled = false; m.castShadow = true; }); return c; }
const IN_PER_MPS = 39.37 / 160;   // 1 m/s real = 0.246 plan in/s
/* [RV2] horses walk at the speed their walk clip was authored for (extras.walk_speed_mps: no hoof slide); defaults = Round-10 values */
function horseSp(H) { return (LIFE.ws[H.h.rider ? 'horse-rider' : 'horse'] || (H.h.rider ? 0.693 : 0.507)) * IN_PER_MPS; }
function lifeLoad() { const D = window.L3D_SKIN; if (QS.get('life') === '0' || !D || !Object.keys(D).length || !THREE.GLTFLoader) return; const ld = new THREE.GLTFLoader(); let k = 0; const keys = Object.keys(D);
  for (const f of keys) { const buf = Uint8Array.from(atob(D[f]), ch => ch.charCodeAt(0)).buffer;
    ld.parse(buf, '', g => { const base = f.replace(/-(b|c|gray|chestnut)$/, ''); const L = LIFE.lib[base] = LIFE.lib[base] || []; g.scene.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } }); L.push({ f, scene: g.scene, clips: g.animations, ws: (g.asset && g.asset.extras && +g.asset.extras.walk_speed_mps) || 0 }); if (g.asset && g.asset.extras && g.asset.extras.walk_speed_mps) LIFE.ws[base] = +g.asset.extras.walk_speed_mps;
      if (++k === keys.length) { LIFE.ready = true; window.__LIFE = Object.fromEntries(Object.entries(LIFE.lib).map(([b, v]) => [b, v.map(x => x.f + ':' + x.clips.map(c => c.name).join('/'))])); } }, e => { console.warn('life glb', f, e); if (++k === keys.length) LIFE.ready = true; }); } }
function lifeGet(base, seed) { const L = LIFE.lib[base]; if (!L || !L.length) return null; const V = L[Math.floor(seed * L.length) % L.length], pl = LIFE.pool[V.f] = LIFE.pool[V.f] || [];
  let o = pl.find(x => !x.busy); if (!o) { const root = skClone(V.scene), g = new THREE.Group(); g.add(root); root.scale.setScalar(MM); g.userData.logi = 'life'; api.scene.add(g);
    const mixer = new THREE.AnimationMixer(root), act = {}; for (const c of V.clips) act[c.name] = mixer.clipAction(c); o = { g, mixer, act, cur: null, f: V.f, ws: V.ws }; pl.push(o); LIFE.n++; }
  o.busy = true; o.g.visible = true; return o; }
function lifePlay(o, clip, ts) { const a = o.act[clip] || o.act.idle || Object.values(o.act)[0]; if (!a) return; if (o.cur !== a) { a.reset(); a.time = Math.random() * a.getClip().duration; a.play(); if (o.cur) o.cur.crossFadeTo(a, 0.45, false); o.cur = a; } a.timeScale = ts == null ? 1 : ts; }
function lifeFrame(dt, people, hs) { // people: [{key, a, d, pose, sd}], hs: horses
  if (!LIFE.ready) return new Set(); const want = new Map();
  // performance guard: frame time averaged over ~1 s; slow (> 70 ms) -> fewer live figures, fast (< 30 ms) -> back up to the cap
  LIFE.ft = LIFE.ft == null ? dt : LIFE.ft * 0.95 + dt * 0.05; LIFE.cap = LIFE.cap == null ? 1 : LIFE.cap; if (QS.get('lifefix') == null) { if (LIFE.ft > 0.07) LIFE.cap = Math.max(0, LIFE.cap - dt * 0.5); else if (LIFE.ft < 0.03) LIFE.cap = Math.min(1, LIFE.cap + dt * 0.2); }
  const nP = Math.round(LIFE_N * LIFE.cap), nH = Math.round(hs.length * LIFE.cap); hs = hs.slice().sort((p, q) => p.d - q.d).slice(0, nH); people = people.slice(0, 1e9);
  people.sort((p, q) => p.d - q.d); for (const p of people.slice(0, nP)) if (p.d < LIFE_R) want.set(p.key, p);
  for (const H of hs) if (H.d < HORSE_R) want.set(H.key, H);
  for (const [k, o] of LIFE.used) if (!want.has(k) || want.get(k).base !== o.base) { o.busy = false; o.g.visible = false; o.cur && o.cur.stop(); o.cur = null; LIFE.used.delete(k); }
  const got = new Set();
  for (const [k, p] of want) { let o = LIFE.used.get(k); if (!o) { if (LIFE.used.size >= LIFE_N + hs.length) continue; o = lifeGet(p.base, p.sd); if (!o) continue; o.base = p.base; LIFE.used.set(k, o); }
    o.g.position.set(p.x, p.y, p.z); o.g.rotation.set(0, p.yaw, 0); lifePlay(o, p.clip, p.clip === 'walk' && p.sp != null && o.ws ? Math.min(2.5, Math.max(0.15, p.sp / (o.ws * IN_PER_MPS))) : p.ts);   /* [RV2] stride locked to ground speed: clip root speed = extras.walk_speed_mps */ o.mixer.update(dt); got.add(k); }
  return got; }
const AMP = +(QS.get('limbamp') || 1);
function personAng(pose, ph, t, sd) { // ph = stride phase (rad), t = seconds, sd = per-person seed
  if (pose === 'walk') { const s = Math.sin(ph); return { legL: 0.45 * s * AMP, legR: -0.45 * s * AMP, armL: -0.35 * s * AMP, armR: 0.35 * s * AMP }; }
  if (pose === 'worker') { const w = Math.sin(t * 5.5 + sd * 6); return { armL: -0.55 - 0.45 * Math.max(0, w), armR: -0.4 - 0.5 * Math.max(0, -w), legL: 0, legR: 0 }; }   // hands forward, working
  if (pose === 'sit') return { legL: -1.45, legR: -1.45, armL: -0.5, armR: -0.5 };
  const i = Math.sin(t * 0.9 + sd * 9) * 0.05; return { armL: i, armR: -i * 0.8 }; }   // idle: weight shift / arms sway
function horseAng(H, t) { if (H.mv) { const s = Math.sin(H.ph) * 0.42; return { FL: s, BR: s, FR: -s, BL: -s, head: 0.05 * Math.sin(H.ph * 2) }; }
  if (H.graze) return { head: -0.85 + 0.06 * Math.sin(t * 1.3 + H.sd) }; return { head: 0.04 * Math.sin(t * 0.7 + H.sd) }; }

G.init = function (A) {
  api = A; T = L3D.logiCore; S = G.sim = T.create(window.LOGISTICS, env());
  const t0 = QS.get('time'); S.seek(t0 ? (+t0.split(':')[0]) * 3600 + (+(t0.split(':')[1] || 0)) * 60 : S.D.clock.start); S.fc = 4;
  const cnt = {}; for (const v of S.D.vehicles) { const id = pick(v.model); cnt[id] = (cnt[id] || 0) + 1; }
  for (const id in cnt) meshes[id] = inst(id, cnt[id] + 12);
  for (const pose of ['walk', 'stand', 'worker']) pmesh[pose] = inst(has('person-' + pose) || !has('person-stand') ? 'person-' + pose : 'person-stand', S.agents.length, 'plain');
  if (QS.get('rig') !== '0') { RIG.person = rigSet(['person-stand', 'person-walk', 'person-worker'], S.agents.length, 'person'); RIG.worker = rigSet(['person-worker', 'person-stand'], S.agents.length, 'person');
    RIG.sit = has('person-sit') ? null : RIG.person; RIG.horse = rigSet(['horse'], (S.D.horses || []).length + 1, 'horse'); RIG.rider = has('horse-rider') ? rigSet(['horse-rider'], (S.D.horses || []).length + 1, 'horse') : null;
    if (has('person-sit')) pmesh.sit = inst('person-sit', S.agents.length, 'plain'); }
  // horses graze inside their paddocks; ridden horses work the ring
  for (const h of S.D.horses || []) horses.push({ h, x: h.x, y: h.y, a: h.a, tx: h.x, ty: h.y, wait: Math.random() * 30, graze: false, ph: 0, mv: false, sd: Math.random() * 6 });
  for (const id of ['horse', 'horse-grazing', 'horse-rider']) hmesh[id] = inst(has(id) ? id : 'horse', horses.length + 1, 'plain');
  lifeLoad(); buildHud(); bindPick(); G.ready = true;
};
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }
function stepHorses(dt) { for (const H of horses) { const P = H.h.poly; H.mvT = Math.max(0, (H.mvT || 0) - dt); H.mv = H.mvT > 0; if (H.wait > 0) { H.wait -= dt; continue; }
    const dx = H.tx - H.x, dy = H.ty - H.y, d = Math.hypot(dx, dy), sp = horseSp(H);
    if (d < 0.05) { H.graze = !H.h.rider && Math.random() < 0.6; H.wait = H.h.rider ? 1 : 15 + Math.random() * 60;
      const xs = P.map(p => p[0]), ys = P.map(p => p[1]); for (let k = 0; k < 30; k++) { const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs)), y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
        if (inPoly(x, y, P) && Math.hypot(x - H.x, y - H.y) < (H.h.rider ? 6 : 3)) { H.tx = x; H.ty = y; break; } } continue; }
    H.graze = false; const st = Math.min(d, sp * dt); H.ph += st / (H.h.rider ? 0.32 : 0.22) * Math.PI; H.mvT = 0.3; const nx = H.x + dx / d * st, ny = H.y + dy / d * st; if (inPoly(nx, ny, P)) { H.x = nx; H.y = ny; H.a = Math.atan2(dy, dx); } else { H.tx = H.x; H.ty = H.y; } } }
G.tick = function (dt) {
  if (!G.ready) return; const opsC = opsClock(); if (opsC != null && Math.abs(opsC - S.clock) > 900) S.seek(opsC); S.tick(dt, opsC != null ? { clock: opsC, motion: opsRate() } : null);
  stepHorses(dt * (S.fc / 4)); railPoll(dt); draw(dt); hudTick();
};
/* [RV2] rigged kit structures, driven by the town sim (sim seconds, so they follow the clock rate):
   - Mi-Jack Translift 933-3222 (gantry > wheel_1..8, trolley > hoist_cables + spreader): while a chassis is at TEAM-MJ it works S-2: trolley over the
     well car, spreader down, latch, hoist, trolley over the chassis lane, set down, unlatch, hoist, gantry rolls to the next platform. Cables are
     stretched to the real drop (scale.y = trolley height - spreader height - 0.12 m; geometry is 1 m long). A 53 ft box rides the spreader while loaded.
   - dock doors (door_N on a kit, origin = top of the opening): open (slide up 3.05 m) once a truck has backed into the dock in front, close after. */
const KA = { init: false, crane: [], doors: [], barn: [], spout: [], bay: [] };
function kitInit() { KA.init = true; const E = L3D.ext; if (!E || !E.placed) return; const v = new THREE.Vector3(), find = (o, n) => { let r = null; o.traverse(x => { if (!r && x.name === n) r = x; }); return r; };
  for (const pl of E.placed) { const o = pl.o; o.updateMatrixWorld(true);
    if (pl.id === 'walthers-933-3222') { const G = find(o, 'gantry'), T = find(o, 'trolley'), SP = find(o, 'spreader'), CB = find(o, 'hoist_cables'); if (!G || !T || !SP) continue;
      const W = []; G.traverse(x => { if (/^wheel_/.test(x.name)) W.push({ n: x, q: x.quaternion.clone() }); });
      const mmPerM = 1000 / 160; let box = null; if (E.has('load-container-53')) { box = E.scenes['load-container-53'].clone(true); const bb = new THREE.Box3().setFromObject(box); box.visible = false; box.userData.h = bb.max.y - bb.min.y; o.parent.add(box); }
      KA.crane.push({ o, G, T, SP, CB, W, g0: G.position.clone(), t0: T.position.clone(), s0: SP.position.clone(), cb0: CB ? CB.scale.clone() : null, mm: mmPerM, ph: -1, pt: 0, gx: 0, gxT: 0, box, spin: 0 }); }
    if (pl.id === 'walthers-933-3856-bay') { const B = find(o, 'bridge'), T = find(o, 'trolley'), MG = find(o, 'magnet'), CB = find(o, 'hoist_cables'); if (B && T && MG) KA.bay.push({ B, T, MG, CB, b0: B.position.clone(), t0: T.position.clone(), m0: MG.position.clone(), c0: CB ? CB.scale.clone() : null, ph: Math.random() * 100 }); continue; }   // [R28 item 5] PSP bay crane: bridge along the bay, trolley across, magnet up/down
    if (pl.id === 'walthers-933-3860') { const sp = find(o, 'spout'); if (sp) KA.spout.push({ n: sp, rx0: sp.rotation.x, k: 0 }); continue; }   // [RV2 R16] rail loadout spout: rest = raised, lower = -25 deg about local X
    if (pl.id === 'gen-barn') { o.traverse(x => { const m = /^door_(\d)$/.exec(x.name || ''); if (m) KA.barn.push({ n: x, x0: x.position.x, sg: m[1] === '1' ? -1 : 1, open: 0 }); }); continue; }   // sliders: door_1 -X, door_2 +X, 2.0 m
    o.traverse(x => { if (!/^door_\d+$/.test(x.name)) return; x.getWorldPosition(v); KA.doors.push({ n: x, y0: x.position.y, wx: v.x, wz: v.z, k: 0, dock: null, open: 0 }); }); }
  const P = S.D.places; for (const d of KA.doors) { let best = null, bd = 1.6; for (const pid in P) { const p = P[pid]; if (p.kind !== 'dock' || !p.door) continue; const dd = Math.hypot(p.door[0] - d.wx, p.door[1] - d.wz); if (dd < bd) { bd = dd; best = pid; } } d.dock = best; }
  /* docks without a rigged kit door get a generic sectional dock door (9 x 10 ft opening, floor 4 ft up = dock height): a dark opening and a ribbed
     curtain that rolls up into the header (curtain top fixed, height shrinks) */
  const used = new Set(KA.doors.map(d => d.dock)), mOpen = new THREE.MeshLambertMaterial({ color: 0x15171a }), mCur = new THREE.MeshLambertMaterial({ color: 0xb9bcc0 }), FT = 12 / 160;
  /* [R28 item 6] a dock whose wall belongs to a placed kit .glb (it models its own doors, e.g. the UPS hub) gets no generic door: the generic
     opening + curtain used to stand on the apron in front of the real wall as dark / white squares */
  const kitBoxes = []; for (const e of ((L3D.ext && L3D.ext.placed) || [])) { try { e.g.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(e.g); if (!b.isEmpty()) kitBoxes.push(b); } catch (er) { } }
  const onKit = (x, z) => kitBoxes.some(b => x > b.min.x - 0.6 && x < b.max.x + 0.6 && z > b.min.z - 0.6 && z < b.max.z + 0.6);
  for (const pid in P) { const p = P[pid]; if (p.kind !== 'dock' || !p.door || used.has(pid) || onKit(p.door[0], p.door[1])) continue; let nx = p.x - p.door[0], nz = p.y - p.door[1]; const l = Math.hypot(nx, nz); if (l < 1e-3) continue; nx /= l; nz /= l;
    const lv = p.lv, y0 = deckY(lv, p.door[0], p.door[1]), W2 = 9 * FT, H = 10 * FT, fl = 4 * FT, yaw = Math.atan2(nx, nz);
    const op = new THREE.Mesh(new THREE.BoxGeometry(W2, H, 0.006), mOpen); op.position.set(p.door[0] + nx * 0.008, y0 + fl + H / 2, p.door[1] + nz * 0.008); op.rotation.y = yaw; api.scene.add(op);
    const cg = new THREE.BoxGeometry(W2 * 0.98, H, 0.008); cg.translate(0, -H / 2, 0); const cu = new THREE.Mesh(cg, mCur); cu.position.set(p.door[0] + nx * 0.014, y0 + fl + H, p.door[1] + nz * 0.014); cu.rotation.y = yaw; cu.castShadow = true; api.scene.add(cu);
    KA.doors.push({ n: cu, proc: true, dock: pid, open: 0, wx: p.door[0], wz: p.door[1] }); }
  window.__KITANIM = { cranes: KA.crane.length, doors: KA.doors.length, docked: KA.doors.filter(d => d.dock).map(d => d.n.name + '@' + d.dock) }; }
// one crane cycle in sim seconds (Mi-Jack 1000P: trolley ~60 m/min, hoist ~ 20 m/min loaded): [phase, seconds, trolley z (m), spreader height (m), loaded]
const MJ = [['to rail', 14, -4.5, 6.5, 0], ['lower', 10, -4.5, 4.0, 0], ['latch', 5, -4.5, 4.0, 0], ['hoist', 12, -4.5, 7.6, 1], ['to chassis', 14, 4.5, 7.6, 1], ['lower', 14, 4.5, 4.2, 1], ['unlatch', 5, 4.5, 4.2, 0], ['hoist', 10, 4.5, 6.5, 0], ['roll', 20, 4.5, 6.5, 0]]   /* [Round 11c] rest 6.5 m, travel 1.2-9.6 m; box top 4.0 m in the well, 4.2 m on the chassis */;
/* [R28 item 9] PROVISIONAL L3 run-around (viewer-only animation, no track change): an arriving staging train's loco cuts off at the north end of S1,
   runs out over the north ladder (L3-07 / L3-06), down the L3 loop (bypass) as the run-around track, back in over the south ladder (L3-01 / L3-02)
   and couples to the south end of S1, ready to leave the other way. See P/L3-runaround-note.md. ?l3ra=0 turns it off. */
const RA = { on: null, P: null, len: 0, s: 0, o: null, dwell: 0 };
function l3RunAround(dt) { if (RA.on === false) return; const L3 = api && api.L3, S3 = (window.LAYOUT || {}).l3, E = L3D.ext;
  /* [R30] NS 211-style intermodal run-around on the approved yardlab T3 crossovers, with the owner's power: ET44 A cab-forward, ET44 B reversed (long hood to
     long hood). Power stands at the east end of a double-stack on S1, cuts off, runs east through XO-T onto the loop, stops, REVERSES west along the loop,
     through XO-W onto S1 south of the train, stops, reverses and couples to the train's other end. The models never flip: after the run-around B leads
     cab-forward (the train departs the other way). Wheels roll with the travel sign. */
  const LOCO = ['loco-et44', 'loco-es44', 'loco-gp38-ns'].find(k => E && E.has && E.has(k));
  if (RA.on === null) { RA.on = !!(L3 && S3 && S3.tracks && LOCO) && !/[?&]l3ra=0/.test(location.search); if (!RA.on) return;
    const tk = n => S3.tracks.find(t => t.name === n), loop = tk('L3 loop (bypass)'), s1 = tk('S1'), xt = tk('XO-T'), xw = tk('XO-W'); if (!loop || !s1 || !xt || !xw) { RA.on = false; return; }
    const near = (pl, q) => { let bi = 0, bd = 1e9; pl.forEach((p, k) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; bi = k; } }); return bi; };
    const sub = (pl, a, b) => { const i0 = near(pl, a), i1 = near(pl, b); return i0 <= i1 ? pl.slice(i0, i1 + 1) : pl.slice(i1, i0 + 1).reverse(); };
    const mk = P => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return { P, c, len: c[c.length - 1] }; };
    const ext = (pl, from, away, L) => { const i0 = near(pl, from), d = near(pl, away) > i0 ? -1 : 1, out = [pl[i0]]; let acc = 0; for (let i = i0 + d; i >= 0 && i < pl.length && acc < L; i += d) { acc += Math.hypot(pl[i][0] - out[out.length - 1][0], pl[i][1] - out[out.length - 1][1]); out.push(pl[i]); } return out; };
    const sz = o => { const b = new THREE.Box3().setFromObject(o); return Math.max(b.max.z - b.min.z, b.max.x - b.min.x); };
    RA.A = E.scenes[LOCO].clone(true); RA.A.name = 'l3-runaround-ET44-A'; RA.B = E.scenes[LOCO].clone(true); RA.B.name = 'l3-runaround-ET44-B'; L3.g.add(RA.A); L3.g.add(RA.B);
    const LA = sz(RA.A) + 0.06, dAB = LA; RA.LA = LA; RA.dAB = dAB;
    const Q = sub(s1.pts, xw.pts[1], xt.pts[1]), Qm = mk(Q);
    // standing double-stack on S1: rear 3 in north of XO-W, 10 wells max, front >= pair + 2 in short of XO-T
    const wk = ['car-well'].find(k => E.has(k));   /* [R34] was ['car-stack', ...]: 'car-stack' is the crushed-car scrap prop -> rusty junk blocks sat on S1 as 'cargo' */ RA.cars = []; let d = 3.0;
    if (wk) for (let n = 0; n < 10; n++) { const o = E.scenes[wk].clone(true); o.name = 'l3-runaround-well'; const L = sz(o) + 0.06; if (d + L + 2 * LA + 2.5 > Qm.len) break; RA.cars.push({ o, d: d + L / 2 }); d += L; L3.g.add(o); }
    RA.q0 = 3.0; RA.qF = d;   // train rear / front arcs on Q
    const e1 = ext(loop.pts, xt.pts[0], xw.pts[0], 2 * LA + 1.5), e2 = ext(s1.pts, xw.pts[1], xt.pts[1], 2 * LA + 1.5);
    RA.L1 = mk([...Q, xt.pts[0], ...e1.slice(1)]);
    RA.L2 = mk([...e1.slice().reverse(), ...sub(loop.pts, xt.pts[0], xw.pts[0]).slice(1), xw.pts[1], ...e2.slice(1)]);
    RA.L3 = mk([...e2.slice().reverse(), ...Q.slice(1)]); RA.e2len = mk(e2).len;
    RA.leg = 1; RA.s = RA.qF + LA / 2 + dAB; RA.dwell = 20; RA.deck = L3.deck + 0.289; RA.spinA = 0; RA.spinB = 0;
    for (const c of RA.cars) raPut(c.o, Qm, c.d, 0); window.__RA = RA; }
  const v = 4.0 * dt;
  const end = RA.leg === 1 ? RA.L1.len : RA.leg === 2 ? RA.L2.len - RA.dAB : RA.cplS;
  if (RA.dwell > 0) RA.dwell -= dt; else RA.s = Math.min(RA.s + v, end);
  const L = RA.leg === 1 ? RA.L1 : RA.leg === 2 ? RA.L2 : RA.L3;
  // unit arcs on the current leg: leg1 A ahead of B; leg2 B ahead (retrace); leg3 A ahead (retrace again)
  const sA = RA.leg === 2 ? RA.s : RA.leg === 1 ? RA.s : RA.s + RA.dAB, sB = RA.leg === 2 ? RA.s + RA.dAB : RA.leg === 1 ? RA.s - RA.dAB : RA.s;
  const fl = RA.leg === 2 ? Math.PI : 0; raPut(RA.A, L, sA, fl); raPut(RA.B, L, sB, fl + Math.PI);
  if (RA.dwell > 0) return;
  if (RA.leg === 1 && RA.s >= RA.L1.len - 1e-6) { RA.leg = 2; RA.s = 0; RA.dwell = 6; }
  else if (RA.leg === 2 && RA.s >= RA.L2.len - RA.dAB - 1e-6) { RA.leg = 3; RA.s = 0; RA.dwell = 6; RA.cplS = RA.e2len + RA.q0 - RA.LA / 2 - RA.dAB - 0.03; }
  else if (RA.leg === 3 && RA.s >= RA.cplS - 1e-6) { RA.coupled = (RA.coupled || 0) + 1; window.__RA_DONE = RA.coupled; RA.leg = 1; RA.s = RA.qF + RA.LA / 2 + RA.dAB; RA.dwell = 40; } }
window.__RAstep = dt => l3RunAround(dt);   /* [R34] test hook (locohead.js) */
function raPut(o, p, d, flip) { const c = p.c; d = Math.max(0, Math.min(p.len, d)); let i = 1; while (i < c.length - 1 && c[i] < d) i++; const a = p.P[i - 1], b = p.P[i], f = Math.min(1, (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1));
  const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f; if (o.userData.px !== undefined) { const dx = x - o.userData.px, dz = z - o.userData.pz, yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) + flip, sg = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) >= 0 ? 1 : -1; o.userData.spin = (o.userData.spin || 0) + sg * Math.hypot(dx, dz) / 0.021;
    o.traverse(n => { if (/^wheelset/.test(n.name || '')) { n.userData.q0 = n.userData.q0 || n.quaternion.clone(); n.quaternion.copy(n.userData.q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -o.userData.spin)); } }); }
  o.userData.px = x; o.userData.pz = z; o.position.set(x, RA.deck, z); o.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) + flip; }   /* [R34] glb long axis is +X (cab end); was atan2(dx,dz) = Z-forward -> units lay 90 deg across the tracks */

/* [R30 item 8] main-yard life (viewer-only; the ops engine never uses Y1-Y5 in its sessions): standing cuts on the five class tracks and an
   MP15 switcher that classifies them - light to a track, couples to its west car, pulls a 1-3 car cut to the lead, shoves it into another track. */
const YA = { on: null };
function yardLife(dt) { if (YA.on === false) return; const E = L3D.ext, LY = (window.LAYOUT || {}).levels;
  if (YA.on === null) { YA.on = !!(E && E.has && E.has('loco-mp15') && LY && LY[0] && api && api.LV && api.scene) && !/[?&]yard=0/.test(location.search); if (!YA.on) return;
    const Y = LY[0].tracks.filter(t => { const xs = t.pts.map(p => p[0]), ys = t.pts.map(p => p[1]); return Math.min(...ys) > 104 && Math.max(...ys) < 112.5 && Math.min(...xs) > 47 && Math.max(...xs) > 108.5 && Math.max(...xs) < 109.2; })
      .sort((a, b) => b.pts[0][1] - a.pts[0][1]);
    if (Y.length < 4) { YA.on = false; return; }
    const W = Y.map(t => t.pts[0]);
    /* [R30] route over the real L1 rails: shortest path through track + turnout (thr/div) polylines from the Y0/ladder lead to each class track
       (was a straight chord = 0.49 in off the rails) */
    const NK = p => Math.round(p[0] * 40) + ',' + Math.round(p[1] * 40), G = new Map(), PT = new Map();
    const add = (a, b) => { const ka = NK(a), kb = NK(b); if (ka === kb) return; PT.set(ka, a); PT.set(kb, b); const d = Math.hypot(a[0] - b[0], a[1] - b[1]); (G.get(ka) || G.set(ka, []).get(ka)).push([kb, d]); (G.get(kb) || G.set(kb, []).get(kb)).push([ka, d]); };
    for (const t of LY[0].tracks) for (let i = 1; i < t.pts.length; i++) add(t.pts[i - 1], t.pts[i]);
    for (const to of (LY[0].turnouts || [])) for (const q of [to.thr, to.div]) if (q) for (let i = 1; i < q.length; i++) add(q[i - 1], q[i]);
    const route = (a, b) => { const ka = NK(a), kb = NK(b), D = new Map([[ka, 0]]), pr = new Map(), Q = [[0, ka]];
      const push = e => { Q.push(e); let i = Q.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (Q[p][0] <= Q[i][0]) break; [Q[p], Q[i]] = [Q[i], Q[p]]; i = p; } };
      const pop = () => { const top = Q[0], l = Q.pop(); if (Q.length) { Q[0] = l; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < Q.length && Q[a][0] < Q[m][0]) m = a; if (b < Q.length && Q[b][0] < Q[m][0]) m = b; if (m === i) break; [Q[m], Q[i]] = [Q[i], Q[m]]; i = m; } } return top; };
      while (Q.length) { const [d, k] = pop(); if (k === kb) break; if (d > (D.get(k) ?? 1e9)) continue; for (const [n, w] of G.get(k) || []) { const nd = d + w; if (nd < (D.get(n) ?? 1e9)) { D.set(n, nd); pr.set(n, k); push([nd, n]); } } }
      if (!pr.has(kb)) return [a, b]; const out = []; for (let k = kb; k; k = pr.get(k)) { out.push(PT.get(k)); if (k === ka) break; } return out.reverse(); };
    const Lp = [33.82283465, 115.08347638];
    const mk = P => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return { P, c, len: c[c.length - 1] }; };   /* [R34] yardLife had no mk of its own (ReferenceError killed kitTick: yard, cranes, run-around all frozen) */
    YA.paths = Y.map((t, k) => mk([...route(Lp, W[k]), ...t.pts.slice(1)]));
    const kinds = ['car-boxcar', 'car-covered_hopper', 'car-tank', 'car-gondola', 'car-boxcar-c60', 'car-hopper', 'car-centerbeam', 'car-reefer'].filter(k => E.has(k));
    const sz = o => { const b = new THREE.Box3().setFromObject(o); return Math.max(b.max.z - b.min.z, b.max.x - b.min.x); };
    YA.deck = api.LV[0].deck + 0.289; YA.g = new THREE.Group(); YA.g.name = 'yard-life'; api.scene.add(YA.g);
    let n = 0; YA.trk = YA.paths.map((pa, k) => { const want = [12, 9, 11, 8, 10][k] || 8, cars = [];   /* [R34] ~45 standing cars (was 20) */ let d = pa.len - 1.2;   // pack from the east bumper
      for (let i = 0; i < want; i++) { const o = E.scenes[kinds[(n++ * 7 + k) % kinds.length]].clone(true); o.name = 'yard-car'; const L = sz(o) + 0.12; d -= L / 2; { const tl = Y[k].pts.reduce((a, q, i, A) => i ? a + Math.hypot(q[0] - A[i - 1][0], q[1] - A[i - 1][1]) : 0, 0); if (d - L < pa.len - tl + 3.0) break; } cars.push({ o, d, L }); d -= L / 2; YA.g.add(o); }
      return cars; });
    YA.loco = E.scenes['loco-mp15'].clone(true); YA.loco.name = 'yard-switcher-mp15'; YA.loco.L = sz(YA.loco); YA.g.add(YA.loco);
    YA.st = 'idle'; YA.t = 5; YA.s = 0.1 + YA.loco.L / 2;   /* [R38] was 0: the switcher jumped 1.9 in on its first move */ YA.k = 0; YA.cut = []; YA.moves = 0; window.__YARD = YA; YA.trk.forEach((cs, k) => cs.forEach(c => yPlace(c.o, k, c.d))); yPlace(YA.loco, 0, 0.1 + YA.loco.L / 2); }
  /* [R36] real switching speeds (N 1:160: 1 in/s = 9.09 scale mph). Was a flat 4.0 in/s = 36 smph with no acceleration. Now: <= 1.0 in/s (9.1 smph)
     in the open, accelerating/braking at 0.25 in/s^2, and <= 0.35 in/s (3.2 smph) for the last 1.5 in into a coupling or stop. */
  const yv = (rem, couple) => { const cap = rem < 1.5 ? (couple ? 0.35 : 0.5) : 1.0, brake = Math.sqrt(2 * 0.25 * Math.max(0, rem)) + 0.08; const tg = Math.min(cap, brake); YA.vs = YA.vs || 0; YA.vs = tg > YA.vs ? Math.min(tg, YA.vs + 0.25 * dt) : tg; YA.vmax = Math.max(YA.vmax || 0, YA.vs); if (couple && rem < 0.3) YA.vcouple = Math.max(YA.vcouple || 0, YA.vs); return Math.min(Math.max(0, rem), YA.vs * dt + 1e-4); };
  if (YA.st === 'idle') { YA.t -= dt; if (YA.t > 0) return;
    const full = YA.trk.map((c, k) => [c.length, k]).filter(x => x[0] >= 2).sort((a, b) => b[0] - a[0]); if (!full.length) { YA.t = 30; return; }
    YA.a = full[Math.floor(Math.random() * Math.min(2, full.length))][1]; const fr = YA.trk.map((c, k) => [c.length, k]).filter(x => x[1] !== YA.a).sort((a, b) => a[0] - b[0]); YA.b = fr[0][1];
    YA.nc = Math.min(YA.trk[YA.a].length - 1 || 1, 1 + Math.floor(Math.random() * 3));
    /* [R38] the pulled cut must clear the last turnout before it is shoved onto track b (it was re-placed onto path b while still on path a's
       ladder: cars jumped ~1.1 in sideways at the pull->shove handover). Cap the cut to what fits on the common lead of paths a and b. */
    { const PA = YA.paths[YA.a], PB = YA.paths[YA.b]; let i = 0; while (i < PA.P.length && i < PB.P.length && Math.hypot(PA.P[i][0] - PB.P[i][0], PA.P[i][1] - PB.P[i][1]) < 1e-3) i++; const dv = i > 0 ? PA.c[i - 1] : 0;
      const src = YA.trk[YA.a]; let room = dv - 0.15 - (0.1 + YA.loco.L), n = 0; while (n < YA.nc && room - src[src.length - 1 - n].L >= 0) { room -= src[src.length - 1 - n].L; n++; }
      if (n < 1) { YA.t = 10; return; } YA.nc = n; YA.dv = dv; }
    YA.st = 'go'; YA.k = YA.a; }
  const cs = YA.trk[YA.a] || [];
  if (YA.st === 'go') { const w = cs[cs.length - 1], tgt = w.d - w.L / 2 - YA.loco.L / 2 - 0.05; YA.s = Math.min(tgt, YA.s + yv(tgt - YA.s, true)); yPlace(YA.loco, YA.a, YA.s); if (YA.s >= tgt - 1e-4) { YA.cut = cs.splice(cs.length - YA.nc, YA.nc).reverse(); YA.st = 'pull'; YA.t = 4; YA.vs = 0; } return; }
  if (YA.st === 'pull') { if (YA.t > 0) { YA.t -= dt; return; } YA.s = Math.max(0.1 + YA.loco.L / 2, YA.s - yv(YA.s - (0.1 + YA.loco.L / 2), false)); yPlace(YA.loco, YA.a, YA.s); let d = YA.s + YA.loco.L / 2; for (const c of YA.cut) { c.d = d + c.L / 2; d += c.L; yPlace(c.o, YA.a, c.d); }
    if (YA.s <= 0.1 + YA.loco.L / 2 + 1e-6) { YA.st = 'shove'; YA.t = 4; YA.vs = 0; } return; }
  if (YA.st === 'shove') { if (YA.t > 0) { YA.t -= dt; return; } const dst = YA.trk[YA.b], pb = YA.paths[YA.b]; const stop = (dst.length ? dst[dst.length - 1].d - dst[dst.length - 1].L / 2 : pb.len - 1.2) - 0.05;
    let tot = 0; for (const c of YA.cut) tot += c.L; YA.s = Math.min(stop - tot - YA.loco.L / 2, YA.s + yv(stop - tot - YA.loco.L / 2 - YA.s, dst.length > 0)); yPlace(YA.loco, YA.b, YA.s); let d = YA.s + YA.loco.L / 2; for (const c of YA.cut) { c.d = d + c.L / 2; d += c.L; yPlace(c.o, YA.b, c.d); }
    if (YA.s >= stop - tot - YA.loco.L / 2 - 1e-6) { for (const c of YA.cut.slice().reverse()) dst.push(c); YA.cut = []; YA.moves++; YA.st = 'back'; YA.k = YA.b; YA.t = 6; YA.vs = 0; } return; }
  if (YA.st === 'back') { if (YA.t > 0) { YA.t -= dt; return; } YA.s = Math.max(0.1 + YA.loco.L / 2, YA.s - yv(YA.s - (0.1 + YA.loco.L / 2), false)); yPlace(YA.loco, YA.b, YA.s); if (YA.s <= 0.1 + YA.loco.L / 2 + 1e-6) { YA.st = 'idle'; YA.t = 20; } } }
/* [R30 CLNA fix] transload forklift: drives the plan's anims route (boxcar door -> ramp pad -> 12 ft lane -> storage -> flatbed bay) in a loop, a lumber
   bundle on the forks between the car and the storage yard and between the storage yard and the truck. Never crosses a track (route is all lot side). */
const FK = { on: null };
/* pad top: the TL-pad ramp is drawn as a slab; read its real top from the scene once (raycast), else ground */
function fkTop(x, z) { const key = Math.round(x * 20) + ',' + Math.round(z * 20); FK.hm = FK.hm || new Map(); if (FK.hm.has(key)) return FK.hm.get(key); const r = fkTop0(x, z); FK.hm.set(key, r); return r; }
function fkTop0(x, z) { if (!FK.rc) { FK.rc = new THREE.Raycaster(); FK.tg = []; api.scene.traverse(o => { if (o.isMesh && /pad|lot|ground|terrain|L1/i.test((o.name || '') + (o.parent && o.parent.name || '')) && !/fk-anim/.test(o.name || '')) FK.tg.push(o); }); }
  FK.rc.set(new THREE.Vector3(x, FK.deck + 1, z), new THREE.Vector3(0, -1, 0)); FK.rc.far = 1.5; const h = FK.rc.intersectObjects(FK.tg, false)[0]; return h ? Math.max(0, Math.min(0.35, h.point.y - FK.deck)) : 0; }
function fkLife(dt) { if (FK.on === false) return; const E = L3D.ext, LY = (window.LAYOUT || {}).levels;
  if (FK.on === null) { const an = LY && LY[0] && (LY[0].anims || []).find(a => a.kind === 'forklift'); FK.on = !!(an && E && E.has && E.has('load-forklift') && api && api.LV && api.scene) && !(window.L3D_LIFE_GLB && !/[?&]life=0/.test(location.search));   /* [R34] life.js runs the CLNA forklift (rigged, operator, loads on the forks) */ if (!FK.on) return;
    const P = an.pts, c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    Object.assign(FK, { P, c, len: c[c.length - 1], dw: an.dwell || [], s: 0, k: 0, t: 0, deck: api.LV[0].deck + (window.L3D && L3D.terrain ? 0 : 0) });
    FK.o = E.scenes['load-forklift'].clone(true); FK.o.name = 'fk-anim-forklift'; api.scene.add(FK.o);
    if (E.has('load-lumber-stack')) { FK.b = E.scenes['load-lumber-stack'].clone(true); FK.b.name = 'fk-anim-bundle'; FK.b.scale.set(0.5, 0.35, 0.5); FK.o.add(FK.b); FK.b.position.set(0, 0.1, 0.3); }
    window.__FK = FK; }
  if (FK.t > 0) { FK.t -= dt; return; }
  const v = 1.6 * dt; let i = 1; while (i < FK.c.length - 1 && FK.c[i] < FK.s) i++;
  const ns = FK.s + v; if (ns >= FK.c[i] && FK.dw[i]) { FK.s = FK.c[i]; FK.t = FK.dw[i]; FK.load = i === 1 ? true : i === 6 ? false : i === 12 ? false : FK.load; } else FK.s = ns;
  if (FK.s >= FK.len) { FK.s = 0; FK.trip = (FK.trip || 0) + 1; }
  let j = 1; while (j < FK.c.length - 1 && FK.c[j] < FK.s) j++; const a = FK.P[j - 1], b = FK.P[j], f = Math.min(1, (FK.s - FK.c[j - 1]) / ((FK.c[j] - FK.c[j - 1]) || 1));
  FK.o.position.set(a[0] + (b[0] - a[0]) * f, FK.deck + (a.length > 2 ? (a[2] + ((b[2] || 0) - a[2]) * f) : fkTop(FK.o.position.x, FK.o.position.z)), a[1] + (b[1] - a[1]) * f);   /* [R34] route carries deck height; level changes only on the ramp leg */ FK.o.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
  if (FK.b) FK.b.visible = j <= 6 || (j >= 9 && j <= 12); }
const SEAT = { m: null, n: 0 };
function seatFrame(LP) { if (!api || !api.scene) return; if (!SEAT.m) { /* [R34] park bench (was a placeholder green box): 6 ft long (0.45 in), seat 18 in (0.1125 in) up, 3 seat slats, 2 back slats, 2 cast end frames with legs; long axis = sitter's local Z, back at -X */
    const S_ = 1 / 160 * 12, parts = [], bx = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); parts.push(b); };
    for (let k = 0; k < 3; k++) bx(0.028, 0.006, 0.45, -0.035 + k * 0.032, 0.1125 - 0.003, 0);
    for (let k = 0; k < 2; k++) bx(0.006, 0.026, 0.45, -0.062, 0.135 + k * 0.034, 0);
    for (const z of [-0.2, 0.2]) { bx(0.01, 0.1125, 0.012, 0.02, 0.056, z); bx(0.01, 0.17, 0.012, -0.058, 0.085, z); bx(0.1, 0.008, 0.012, -0.015, 0.104, z); }
    const g = THREE.BufferGeometryUtils.mergeBufferGeometries(parts); void S_;
    SEAT.m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x5a3f2a, roughness: 0.85 }), 256); SEAT.m.name = 'park-bench'; SEAT.m.userData.kind = 'park-bench'; SEAT.m.frustumCulled = false; api.scene.add(SEAT.m); SEAT.M = new THREE.Matrix4(); SEAT.q = new THREE.Quaternion(); SEAT.u = new THREE.Vector3(0, 1, 0); SEAT.p = new THREE.Vector3(); SEAT.s = new THREE.Vector3(1, 1, 1); }
  let n = 0; const done_ = []; for (const e of LP) { if (e.clip !== 'sit' || n >= 256) continue; const lx = -0.11; if (done_.some(q => Math.hypot(q[0] - e.x, q[1] - e.z) < 0.3 && Math.abs(Math.sin(q[2] - e.yaw)) < 0.2)) continue; done_.push([e.x, e.z, e.yaw]); SEAT.p.set(e.x + Math.cos(e.yaw) * lx, e.y, e.z - Math.sin(e.yaw) * lx); SEAT.q.setFromAxisAngle(SEAT.u, e.yaw); SEAT.M.compose(SEAT.p, SEAT.q, SEAT.s); SEAT.m.setMatrixAt(n++, SEAT.M); }
  window.__LP = LP; SEAT.m.count = n; SEAT.m.instanceMatrix.needsUpdate = true; SEAT.n = n; window.__SEATS = { n, sit: LP.filter(e => e.clip === 'sit').map(e => ({ x: +e.x.toFixed(2), y: +e.y.toFixed(3), z: +e.z.toFixed(2) })) }; }
/* [R34] road power: an ET44 pair (rear to rear, cab out each end) shuttles on E-1 between the ready end (west) and the fuel/sand pad
   (east, beside the FUEL-tank + sand tower), 4 min dwell at each end (sim seconds follow the town clock rate) */
const RP = { on: null };
function roadPower(dt) { if (RP.on === false) return; const E = L3D.ext, LY = (window.LAYOUT || {}).levels;
  if (RP.on === null) { RP.on = !!(E && E.has && E.has('loco-et44') && LY && api && api.scene) && !/[?&]yard=0/.test(location.search); if (!RP.on) return;
    const t = LY[0].tracks.find(t => { const xs = t.pts.map(p => p[0]), ys = t.pts.map(p => p[1]); return Math.min(...xs) > 84 && Math.min(...xs) < 86 && Math.max(...xs) > 109 && Math.min(...ys) > 113.5 && Math.max(...ys) < 115.5; });
    if (!t) { RP.on = false; return; } const P = t.pts, c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    RP.p = { P, c, len: c[c.length - 1] }; RP.g = new THREE.Group(); RP.g.name = 'road-power-E1'; api.scene.add(RP.g); RP.u = [0, 1].map(k => { const o = E.scenes['loco-et44'].clone(true); o.name = 'road-power-et44-' + k; RP.g.add(o); return o; });
    const b = new THREE.Box3().setFromObject(RP.u[0]); RP.L = Math.max(b.max.x - b.min.x, b.max.z - b.min.z); RP.deck = api.LV[0].deck + 0.289; RP.s = 1.2 + RP.L; RP.dir = 1; RP.wait = 30; RP.trips = 0; window.__RP = RP; }
  if (RP.wait > 0) RP.wait -= dt; else { const lo = 1.2 + RP.L, hi = RP.p.len - 1.2 - RP.L; const rem = RP.dir > 0 ? hi - RP.s : RP.s - lo, tg = Math.min(0.45, Math.sqrt(2 * 0.15 * Math.max(0, rem)) + 0.03); RP.vs = tg > (RP.vs || 0) ? Math.min(tg, (RP.vs || 0) + 0.15 * dt) : tg; RP.vmax = Math.max(RP.vmax || 0, RP.vs); RP.s += RP.dir * Math.min(Math.max(0, rem) + 1e-4, dt * RP.vs);   /* [R36] engine-facility shuttle: <= 0.45 in/s (4.1 smph) with accel/brake 0.15 in/s^2 (was a flat 0.35 in/s, instant start/stop) */ if (RP.s >= hi - 1e-4 || RP.s <= lo + 1e-4) { RP.s = Math.max(lo, Math.min(hi, RP.s)); RP.dir *= -1; RP.wait = 240; RP.trips++; RP.vs = 0; } }
  const at = d => { const { P, c, len } = RP.p; d = Math.max(0, Math.min(len, d)); let i = 1; while (i < c.length - 1 && c[i] < d) i++; const a = P[i - 1], b = P[i], f = Math.min(1, (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1)); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(-(b[1] - a[1]), b[0] - a[0])]; };
  const h = RP.L / 2 + 0.03; [[RP.s + h, 0], [RP.s - h, Math.PI]].forEach(([d, flip], k) => { const q = at(d), o = RP.u[k]; o.position.set(q[0], RP.deck, q[1]); o.rotation.y = q[2] + flip; }); }   /* unit 0 cab east, unit 1 cab west */
function yPt(p, d, ex) { const c = p.c; if (!ex) d = Math.max(0, Math.min(p.len, d)); let i = 1; while (i < c.length - 1 && c[i] < d) i++; const a = p.P[i - 1], b = p.P[i], f = (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1);   /* [R38] past a path end the truck pivot runs on along the end segment (was clamped: the chord shortened and the car yawed 0.12 rad in one step at 44.17,112.31) */ return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
/* [R37 A8] body pose from its two truck pivots (+-0.36 L along the path): position = chord midpoint, heading = chord direction. Was per-segment heading
   that snapped at every polyline vertex -> switcher/cars shimmied side to side through turnouts. */
function yPlace(o, k, d) { const p = YA.paths[k]; let L = o.userData.yL; if (!L) { const r0 = o.rotation.y; o.rotation.y = 0; o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); o.rotation.y = r0; L = o.userData.yL = Math.max(0.6, Math.max(b.max.x - b.min.x, b.max.z - b.min.z)) || 2; }
  const h = 0.36 * L, A = yPt(p, d - h, 1), B = yPt(p, d + h, 1); o.position.set((A[0] + B[0]) / 2, YA.deck, (A[1] + B[1]) / 2); o.rotation.y = Math.atan2(-(B[1] - A[1]), B[0] - A[0]); }
function kitTick(dt) { if (!KA.init) kitInit(); const sm = x => x * x * (3 - 2 * x);
  l3RunAround(dt); yardLife(dt); roadPower(dt); fkLife(dt); try { eqTick(dt); } catch (e) { if (!EQ.err) { EQ.err = String(e) + ' ' + String(e && e.stack).slice(0, 400); window.__EQERR = EQ.err; } }
  for (const c of KA.bay) { c.ph += dt; const mm = 1000 / 160;   /* [R36 P8] real pick/place cycle (was a free sinusoid): bridge to the coil/plate stock, magnet down,
       energise + lift, bridge to the gondola spot, lower into the car, release, hoist clear. Speeds: bridge 0.5 m/s, trolley 0.4 m/s, hoist 0.15 m/s. */
    const PH = [['travel', 48], ['lower', 20], ['grab', 4], ['hoist', 20], ['travel', 48], ['lower', 20], ['drop', 4], ['hoist', 20]], T = PH.reduce((a, q) => a + q[1], 0);
    let t = c.ph % T, k = 0; while (t > PH[k][1]) { t -= PH[k][1]; k++; } const f = t / PH[k][1], s_ = f * f * (3 - 2 * f), toCar = k >= 4 || k === 0 && false;
    const B0 = -12 * mm, B1 = 12 * mm, T0 = 2 * mm, T1 = 7 * mm, H = 3.5 * mm;
    let bx, ty, mz; if (k === 0) { bx = B1 + (B0 - B1) * s_; ty = T1 + (T0 - T1) * s_; mz = 0; } else if (k === 4) { bx = B0 + (B1 - B0) * s_; ty = T0 + (T1 - T0) * s_; mz = 0; }
    else { bx = k < 4 ? B0 : B1; ty = k < 4 ? T0 : T1; mz = k === 1 || k === 5 ? H * s_ : k === 3 || k === 7 ? H * (1 - s_) : H; }
    if (!c.fit) { c.fit = 1; const body = c.B.parent && c.B.parent.getObjectByName('body'); if (body) { const WALL = 0.2, Bb = new THREE.Box3().setFromObject(body), sp = () => new THREE.Box3().setFromObject(c.B);   /* [R37 A10] bridge span + end trucks inside the interior walls (WALL in from the outer faces), travel clamped to the interior */
        c.in = { x0: Bb.min.x + WALL, x1: Bb.max.x - WALL, z0: Bb.min.z + WALL, z1: Bb.max.z - WALL };
        for (const ax of ['x', 'y', 'z']) { const s0 = sp(), w0 = s0.max.x - s0.min.x, need = c.in.x1 - c.in.x0; if (w0 <= need) break; const k = need / w0, old = c.B.scale[ax]; c.B.scale[ax] = old * k; c.B.updateMatrixWorld(true); const s1 = sp(); if (s1.max.x - s1.min.x > w0 - 1e-4) c.B.scale[ax] = old; else { const cx = (s1.min.x + s1.max.x) / 2, mid = (c.in.x0 + c.in.x1) / 2; if (Math.abs(cx - mid) > 1e-3) c.B.parent.updateMatrixWorld(true); c.spanAx = ax; c.spanK = k; } }
        c.B.updateMatrixWorld(true); const s2 = sp(); c.fitW = [+s2.min.x.toFixed(3), +s2.max.x.toFixed(3)]; } }
    const pbx = c.B.position.x; c.B.position.x = c.b0.x + bx; c.T.position.z = c.t0.z - ty;
    if (c.in) { c.B.updateMatrixWorld(true); const q = new THREE.Box3().setFromObject(c.B); if (q.min.z < c.in.z0 || q.max.z > c.in.z1 || q.min.x < c.in.x0 - 1e-3 || q.max.x > c.in.x1 + 1e-3) { c.B.position.x = pbx; c.clamped = (c.clamped || 0) + 1; } } c.MG.position.y = c.m0.y - mz; if (c.CB && c.c0) c.CB.scale.y = c.c0.y * (1 + mz / (5.4 * mm));
    if (!c.load) { const g = new THREE.CylinderGeometry(0.9 * mm, 0.9 * mm, 1.3 * mm, 18); g.rotateZ(Math.PI / 2); c.load = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.35 })); c.load.name = 'psp-coil-load'; c.load.position.set(-0.3 * mm, -2.7 * mm, 0); c.MG.add(c.load);
      /* [R36 P8] C-hook under the magnet beam: shank + upper/lower arms; the coil eye rides on the lower arm (always drawn - it is the rigging) */
      const hm = new THREE.MeshStandardMaterial({ color: 0xd8a018, metalness: 0.4, roughness: 0.5 }), H = new THREE.Group(); H.name = 'psp-c-hook';
      const bx = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w * mm, h * mm, d * mm), hm); m.position.set(x * mm, y * mm, z * mm); H.add(m); };
      bx(0.25, 2.6, 0.3, -1.05, -1.3, 0); bx(1.1, 0.22, 0.3, -0.55, -0.05, 0); bx(1.3, 0.22, 0.3, -0.45, -2.5, 0); H.position.set(0, -0.2 * mm, 0); c.MG.add(H); c.hook = H; c.load.scale.setScalar(1.0); }
    c.load.visible = (k === 2 && f > 0.5) || k === 3 || k === 4 || k === 5 || (k === 6 && f < 0.5); c.state = PH[k][0] + (k >= 4 ? '-car' : '-stock');
    /* [R36 P8] the load set down in the gondola stays there: a pile that grows with every drop (per gondola, from the ops car at the drop spot) */
    if (typeof eqCarsNear === 'function') { c.MG.updateMatrixWorld(true); const wp = new THREE.Vector3(); c.MG.getWorldPosition(wp); const g = eqCarsNear(1, wp.x, wp.z, 3.0, /gon|mill/i)[0];
      if (g && ((k === 6 && c.lastK !== 6) || (!c.pile && !c.pileSeed))) { const seed = !c.pile && !(k === 6 && c.lastK !== 6); c.pileSeed = 1; if (!c.pile || c.pileCar !== g.c.id) { if (c.pile) c.pile.parent.remove(c.pile); const P = new THREE.Group(); P.name = 'psp-gon-pile'; P.position.set(g.c._px, g.c._y + 0.3, g.c._py); P.rotation.y = -(g.c._ang || 0); api.scene.add(P); c.pile = P; c.pileCar = g.c.id; c.pileN = 0; c.pileM = [];
        } const n = c.pileN++, m = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 14), new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.7, roughness: 0.35 })); m.rotation.x = Math.PI / 2; m.position.set(-1.6 + (n % 7) * 0.5, 0.11 + Math.floor(n / 7) * 0.2, 0); c.pile.add(m); if (seed) for (let j = 0; j < 4; j++) { const q = m.clone(), nn = c.pileN++; q.position.set(-1.6 + (nn % 7) * 0.5, 0.11 + Math.floor(nn / 7) * 0.2, 0); c.pile.add(q); } if (c.pileN > 14) { c.pile.remove(c.pile.children[0]); } }
      c.lastK = k; window.__PSPPILE = c.pileN || 0; } }
  window.__PSPBAY = KA.bay.map(c => c.state); window.__PSPFIT = KA.bay.map(c => ({ in: c.in, w: c.fitW, ax: c.spanAx, k: c.spanK, clamped: c.clamped || 0 })); window.__PSPSET = ph => KA.bay.forEach(c => { c.ph = ph; });
  for (const C of KA.crane) { const busy = (() => { const id = S.occ['TEAM-MJ']; const V = id && S.veh[id]; return !!(V && V.state === 'park'); })() || QS.get('mjwork') === '1';
    if (C.ph < 0 && busy) { C.ph = 0; C.pt = 0; } if (C.ph < 0 && !busy) continue;
    C.pt += dt; let st = MJ[C.ph]; if (C.pt >= st[1]) { C.pt = 0; const prev = st; C.ph = (C.ph + 1) % MJ.length; if (C.ph === 0 && !busy) { C.ph = -1; } if (prev[0] === 'roll') C.gx0 = C.gx; if (MJ[(C.ph + MJ.length) % MJ.length][0] === 'roll') { C.gx0 = C.gx; C.gxT = C.gx > 3 ? -4 : C.gx + 4; } st = MJ[Math.max(0, C.ph)]; }
    const pv = MJ[(Math.max(0, C.ph) + MJ.length - 1) % MJ.length], k = sm(Math.min(1, C.pt / st[1])), z = pv[2] + (st[2] - pv[2]) * k, hs = pv[3] + (st[3] - pv[3]) * k;
    if (st[0] === 'roll') { const nx = C.gx0 + (C.gxT - C.gx0) * k; C.spin += (nx - C.gx) / 0.45; C.gx = nx; }   // wheel radius 0.45 m
    C.G.position.x = C.g0.x + C.gx * C.mm; C.T.position.z = C.t0.z + z * C.mm;
    // spreader height above ground (m) -> local offset under the trolley (rest = 6.5 m)
    C.SP.position.y = C.s0.y - (6.5 - hs) * C.mm; if (C.CB) { const th = C.t0.y / C.mm, L = Math.max(0.2, th - hs - 0.12); C.CB.scale.y = L; }   // cable geometry is 1 m long
    for (const w of C.W) w.n.quaternion.copy(w.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -C.spin));
    if (C.box) { const ld = st[4] || (st[0] === 'hoist' && pv[0] === 'latch'); C.box.visible = !!ld; if (ld) { C.o.updateMatrixWorld(true); const p = new THREE.Vector3(); C.SP.getWorldPosition(p); const q = new THREE.Quaternion(); C.o.getWorldQuaternion(q); C.box.position.copy(p); C.box.position.y -= C.box.userData.h * 1.02; C.box.quaternion.copy(q); C.box.parent.worldToLocal(C.box.position); } } }
  { const h = (S.clock / 3600) % 24, want = h >= 6.5 && h < 19 ? 1 : 0; for (const b of KA.barn) { b.open += Math.sign(want - b.open) * Math.min(Math.abs(want - b.open), dt / 6); b.n.position.x = b.x0 + b.sg * b.open * 2.0 * (1000 / 160); } }   // barn doors open for the farm day
  { const h = (S.clock / 3600) % 24, q = /[?&]spout=([01])/.exec(location.search), want = q ? +q[1] : (h >= 8 && h < 16 ? 1 : 0); for (const p of KA.spout) { p.k = Math.max(0, Math.min(1, p.k + Math.sign(want - p.k) * Math.min(Math.abs(want - p.k), Math.abs(dt) / 4))); p.n.rotation.x = p.rx0 - p.k * 25 * Math.PI / 180; } window.__SPOUT = KA.spout.map(p => +p.k.toFixed(2)); }   // [RV2 R16] spout lowered over the covered hopper at S-1 during the loading shift
  for (const d of KA.doors) { if (!d.dock) continue; const id = S.occ[d.dock], V = id && S.veh[id], want = V && (V.state === 'park' || (V.mv && Math.hypot(V.x - d.wx, V.y - d.wz) < V.len / 2 + 0.6)) ? 1 : 0;
    d.open += Math.sign(want - d.open) * Math.min(Math.abs(want - d.open), dt / 8); if (d.proc) d.n.scale.y = Math.max(0.04, 1 - d.open * 0.96); else d.n.position.y = d.y0 + d.open * 3.05 * (1000 / 160); } }   // 8 s roll-up, 3.05 m travel (mm in the kit frame)
/* [R36 P8/P2/P11] industry equipment cycles (viewer-side, sim clock): Medusa hopper unloading (hose hookup at the pits) + mixer truck loading
   (drum spinning), Albemarle Ag pit + inclined conveyor + bagged pallets onto a flatbed, scrap material handler loading a gondola (pile grows),
   boxcar doors open with a load fraction while spotted, autorack loading (vehicles driven up the ramp into the rack) + van shuttle, gas
   station cars pumping fuel (nozzle hose), IM-1 yard hostler moving chassis between the Mi-Jack and the container stacks.
   Rail-car rigs attach only to a real ops car standing at the spot (window.__ops3d engine cars: _px/_py plan, _ang, _y rail height). */
const EQ = { on: null, t: 0, g: [], cars: [], doors: new Map() };
const EQM = 0.246;   // 1 m in N-scale inches
function eqMat(c, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7, metalness: 0.1 }, o || {})); }
function eqBox(G, w, h, d, x, y, z, m) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; G.add(o); return o; }
function eqCyl(G, r, h, x, y, z, m, ax) { const g = new THREE.CylinderGeometry(r, r, h, 18); if (ax === 'x') g.rotateZ(Math.PI / 2); if (ax === 'z') g.rotateX(Math.PI / 2); const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; G.add(o); return o; }
function eqGroup(lv, x, z, name) { const G = new THREE.Group(); G.name = name; G.position.set(x, api.LV[lv - 1].deck, z); api.scene.add(G); EQ.g.push(G); return G; }
function eqTube(G, P, r, m) { const c = new THREE.CatmullRomCurve3(P.map(p => new THREE.Vector3(p[0], p[1], p[2]))); const o = new THREE.Mesh(new THREE.TubeGeometry(c, 16, r, 6, false), m); G.add(o); return o; }
function eqTruck(G, col, name) { const T = new THREE.Group(); T.name = name; const cab = eqMat(col), blk = eqMat(0x222222), gl = eqMat(0x223344, { metalness: 0.3 });
  eqBox(T, 2.0 * EQM, 0.35 * EQM, 2.4 * EQM, 0, 0.75 * EQM, 0, blk); eqBox(T, 1.7 * EQM, 1.9 * EQM, 2.4 * EQM, 3.2 * EQM, 1.6 * EQM, 0, cab); eqBox(T, 0.05 * EQM, 0.8 * EQM, 2.1 * EQM, 4.06 * EQM, 2.0 * EQM, 0, gl);
  for (const wx of [3.2, -0.8, -2.2]) for (const s of [-1, 1]) eqCyl(T, 0.5 * EQM, 0.3 * EQM, wx * EQM, 0.5 * EQM, s * 1.05 * EQM, blk, 'z');
  T.children[0].scale.x = 4.2; T.children[0].position.x = 0.4 * EQM; G.add(T); return T; }
function eqCarsNear(lv, x, z, r, re) { const H = window.__ops3d, out = []; if (!H || !H.engine) return out; const dk = api.LV[lv - 1].deck;
  for (const c of H.engine.cuts) for (const k of c.cars) { if (k._px == null || k.loco) continue; if (Math.abs((k._y || 0) - dk) > 1.5) continue; const d = Math.hypot(k._px - x, k._py - z); if (d < r && (!re || re.test(k.type || ''))) out.push({ c: k, d, cut: c }); }
  return out.sort((a, b) => a.d - b.d); }
function eqStill(cut) { return !cut || Math.abs(cut.v || 0) < 0.01; }
function eqInit() { const E = L3D.ext, LY = (window.LAYOUT || {}).levels; EQ.on = !!(api && api.scene && api.LV && LY && api.LV.length >= 2) && !/[?&]equip=0/.test(location.search); if (!EQ.on) return;
  const grey = eqMat(0x9aa0a6, { metalness: 0.5 }), yel = eqMat(0xe0b020, { metalness: 0.3 }), blk = eqMat(0x202020), hose = eqMat(0x111111, { roughness: 0.9 }), belt = eqMat(0x333333), tan = eqMat(0xc8a878), rust = eqMat(0x6b4a33), wht = eqMat(0xeeeeee), red = eqMat(0xb02020);
  /* Medusa: two pit standpipes beside the spur (y 113.51) with a hose that hooks up to the hopper outlet when a car stands over the pit */
  EQ.med = [93.4, 96.8].map((x, i) => { const G = eqGroup(2, x, 113.51 - 0.62, 'eq-medusa-pit-' + i); eqCyl(G, 0.06, 0.32, 0, 0.16, 0, yel); eqBox(G, 0.3, 0.08, 0.2, 0, 0.04, 0, grey);
    const H = eqTube(G, [[0, 0.3, 0], [0, 0.36, 0.25], [0, 0.2, 0.45], [0, 0.3, 0.62]], 0.045, hose); const Hc = eqTube(G, [[0, 0.3, 0], [0.1, 0.12, -0.1], [0.25, 0.03, -0.05]], 0.03, hose); return { G, H, Hc, x }; });
  /* Medusa mixer truck under the truck-load spout (north side, y 107.6): drives in, loads with the drum turning, drives out east */
  { const G = eqGroup(2, 0, 107.6, 'eq-medusa-mixer'); G.position.x = 0; const T = eqTruck(G, 0xe8e8e8, 'eq-mixer'); const D = new THREE.Group(); D.position.set(-1.2 * EQM, 2.0 * EQM, 0); D.rotation.z = 0.3; T.add(D);
    const dg = new THREE.CylinderGeometry(1.0 * EQM, 1.25 * EQM, 4.0 * EQM, 16); dg.rotateZ(Math.PI / 2); D.add(new THREE.Mesh(dg, eqMat(0xd9d9d9, { metalness: 0.3 })));
    for (let k = 0; k < 6; k++) { const f = eqBox(D, 3.6 * EQM, 0.12 * EQM, 0.2 * EQM, 0, 0, 0, red); const a = k * Math.PI / 3; f.position.set(0, Math.cos(a) * 1.15 * EQM, Math.sin(a) * 1.15 * EQM); f.rotation.x = a; }
    const S = eqGroup(2, 90.5, 107.6, 'eq-medusa-spout'); eqCyl(S, 0.08, 0.5, 0, 1.05, 0, grey); eqCyl(S, 0.03, 0.9, 0.5, 0.5, 0.0, grey); EQ.mix = { G, T, D, x0: 99.0, xs: 90.05, x1: 98.5 }; }
  /* Albemarle Ag: pit grate between the rails + inclined belt conveyor along the wall up to the warehouse eave; flatbed at the truck lane gets bagged pallets */
  { const G = eqGroup(2, 11.26, 54.3, 'eq-alb-pit'); eqBox(G, 0.36, 0.01, 0.6, 0, 0.003, 0, eqMat(0x303030, { metalness: 0.6 }));
    const C = eqGroup(2, 11.78, 54.3, 'eq-alb-conveyor'); const L = 2.2, h1 = 0.95, ang = Math.atan2(h1, L); const B = new THREE.Group(); B.position.set(0, 0.12, 0); B.rotation.x = -ang; C.add(B);
    eqBox(B, 0.12, 0.04, L / Math.cos(ang), 0, 0, L / 2 / Math.cos(ang), grey); eqBox(B, 0.1, 0.012, L / Math.cos(ang), 0, 0.026, L / 2 / Math.cos(ang), belt);
    for (let k = 0; k < 4; k++) eqBox(C, 0.03, 0.12 + h1 * k / 3, 0.03, 0, (0.12 + h1 * k / 3) / 2, L * k / 3, grey);
    const bags = []; for (let k = 0; k < 10; k++) bags.push(eqBox(B, 0.06, 0.03, 0.08, 0, 0.05, 0, tan)); EQ.alb = { B, bags, len: L / Math.cos(ang) };
    const F = eqGroup(2, 14.8, 52.2, 'eq-alb-flatbed'); F.rotation.y = Math.PI / 2; const T = eqTruck(F, 0x2a5a2a, 'eq-alb-truck'); const pal = []; for (let k = 0; k < 8; k++) { const p = eqBox(F, 1.1 * EQM, 1.0 * EQM, 1.1 * EQM, (-2.6 + (k >> 1) * 1.25) * EQM, 1.35 * EQM, ((k & 1) ? 0.6 : -0.6) * EQM, tan); p.visible = false; pal.push(p); }
    const J = eqGroup(2, 13.8, 52.2, 'eq-alb-palletjack'); eqBox(J, 1.1 * EQM, 1.0 * EQM, 1.1 * EQM, 0, 0.6 * EQM, 0, tan); eqBox(J, 1.2 * EQM, 0.15 * EQM, 1.0 * EQM, 0, 0.08 * EQM, 0, yel); EQ.albT = { F, pal, J }; }
  /* scrap: material handler beside the bins swings magnet bins -> gondola; the pile in the gondola grows */
  { const G = eqGroup(1, 12.85, 74.25, 'eq-scrap-handler'); eqBox(G, 0.75, 0.25, 0.75, 0, 0.13, 0, blk); const U = new THREE.Group(); U.position.y = 0.3; G.add(U); eqBox(U, 0.7, 0.45, 0.55, 0.05, 0.22, 0, yel);
    const Bm = new THREE.Group(); Bm.position.set(0.1, 0.45, 0); U.add(Bm); const b1 = eqBox(Bm, 0.08, 0.08, 1.8, 0, 0, 0.9, yel); Bm.rotation.x = -0.55;
    const Mg = new THREE.Group(); Bm.add(Mg); Mg.position.set(0, 0, 1.8); const cab = eqTube(Mg, [[0, 0, 0], [0, -0.3, 0], [0, -0.55, 0]], 0.012, blk); const disc = eqCyl(Mg, 0.22, 0.08, 0, -0.6, 0, eqMat(0x444444, { metalness: 0.7 }));
    const lump = eqBox(Mg, 0.3, 0.12, 0.3, 0, -0.7, 0, rust); EQ.scrap = { G, U, Bm, Mg, lump, pile: null, frac: 0 }; }
  /* autorack: vehicles from the lot driven up the ramp (raycast its deck) into the rack's end doors; van shuttle returns the drivers */
  { const tg = []; const v = new THREE.Vector3(); api.scene.traverse(o => { if (!o.isMesh || o.isSkinnedMesh) return; o.getWorldPosition(v); if (Math.hypot(v.x - 9.64, v.z - 24) < 3 && Math.abs(v.y - api.LV[1].deck) < 2) tg.push(o); }); EQ.ar = { tg, rc: new THREE.Raycaster(), veh: [] };
    const cols = [0x2050a0, 0xa02020, 0xdddddd, 0x303030]; for (let k = 0; k < 2; k++) { const G = eqGroup(2, 9.64, 17, 'eq-autorack-veh-' + k); eqBox(G, 4.6 * EQM, 0.9 * EQM, 1.8 * EQM, 0, 0.6 * EQM, 0, eqMat(cols[k], { metalness: 0.5 })); eqBox(G, 2.4 * EQM, 0.55 * EQM, 1.6 * EQM, -0.2 * EQM, 1.3 * EQM, 0, eqMat(0x223344, { metalness: 0.4 })); EQ.ar.veh.push({ G, ph: k * 0.5, col: k }); }
    const V = eqGroup(2, 12, 18, 'eq-autorack-van'); eqBox(V, 5.2 * EQM, 2.0 * EQM, 2.0 * EQM, 0, 1.25 * EQM, 0, wht); eqBox(V, 0.05, 0.6 * EQM, 1.8 * EQM, 2.62 * EQM, 1.6 * EQM, 0, eqMat(0x223344)); EQ.van = V; }
  /* gas station: two pumping positions beside the islands under the canopy (42.0, 108.39); car arrives, nozzle hose in, pumps, leaves */
  EQ.gas = [[39.8, 108.4], [43.3, 108.4]].map(([x, z], i) => { const G = eqGroup(2, x, z, 'eq-gas-car-' + i); const body = new THREE.Group(); G.add(body); eqBox(body, 4.5 * EQM, 0.9 * EQM, 1.8 * EQM, 0, 0.6 * EQM, 0, eqMat([0x305080, 0x806020][i], { metalness: 0.5 })); eqBox(body, 2.3 * EQM, 0.55 * EQM, 1.6 * EQM, -0.2 * EQM, 1.3 * EQM, 0, eqMat(0x223344, { metalness: 0.4 }));
    body.rotation.y = Math.PI / 2; const P = eqGroup(2, x + 0.42, z + 0.1, 'eq-gas-nozzle-' + i); const hz = eqTube(P, [[0, 0.3, 0], [-0.1, 0.16, 0.05], [-0.2, 0.17, 0.1]], 0.012, hose); eqBox(P, 0.06, 0.03, 0.04, -0.21, 0.17, 0.1, blk); return { G, body, P, hz, x, ph: i * 0.45 }; });
  /* IM-1: two-high container stacks on the pad + yard hostler shuttling a chassis between the stack row and the Mi-Jack */
  { const S = eqGroup(2, 108.0, 111.95, 'eq-im1-stacks'); const cc = [0x1d3f6e, 0xa0522d, 0x2e6b30, 0x8a1c1c]; for (let k = 0; k < 4; k++) eqBox(S, 16 * EQM, 2.6 * EQM, 2.5 * EQM, 0, 1.3 * EQM + (k & 1) * 2.62 * EQM, 0, eqMat(cc[k], { metalness: 0.4 })).position.x = (k >> 1) ? 0 : 0;
    const H = eqGroup(2, 107.4, 111.14, 'eq-im1-hostler'); eqBox(H, 2.2 * EQM, 1.6 * EQM, 2.3 * EQM, 1.6 * EQM, 1.2 * EQM, 0, eqMat(0xd86018)); eqBox(H, 12 * EQM, 0.3 * EQM, 2.3 * EQM, -5 * EQM, 0.9 * EQM, 0, blk); const box = eqBox(H, 12 * EQM, 2.6 * EQM, 2.5 * EQM, -5 * EQM, 2.4 * EQM, 0, eqMat(0x5a5a5a, { metalness: 0.4 })); EQ.host = { H, box }; }
}
/* [R37] true-scale Blender equipment (window.L3D_EQ_GLB from blender-pipeline scripts/life/equip.py, N-scale mm, +X forward, Y up) replaces the box stand-ins.
   Loaded once; until (or if never) loaded the box versions keep running. ?eqglb=0 keeps the boxes. */
const EQG = { lib: {}, st: null, done: false, sc: 1 / 25.4 };
function eqGLBLoad() { const D = window.L3D_EQ_GLB; if (EQG.st) return; EQG.st = 'none'; if (!D || /[?&]eqglb=0/.test(location.search) || !THREE.GLTFLoader) return; EQG.st = 'loading'; const ld = new THREE.GLTFLoader(), keys = Object.keys(D); let k = 0;
  for (const f of keys) { const buf = Uint8Array.from(atob(D[f]), ch => ch.charCodeAt(0)).buffer; ld.parse(buf, '', g => { g.scene.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); EQG.lib[f] = g.scene; if (++k === keys.length) EQG.st = 'ready'; }, e => { console.warn('eq glb', f, e); if (++k === keys.length) EQG.st = 'ready'; }); } }
function eqModel(parent, id, x, y, z, ry) { const S = EQG.lib[id]; if (!S) return null; const o = S.clone(true); o.name = 'eqm-' + id; o.scale.setScalar(EQG.sc); o.position.set(x || 0, y || 0, z || 0); o.rotation.y = ry || 0; parent.add(o); const n = {}; o.traverse(c => { if (c.name) n[c.name] = c; }); o.userData.n = n; return o; }
function eqHideBoxes(G, keep) { for (const c of G.children) if (c.isMesh && !(keep || []).includes(c)) c.visible = false; }
function eqGLBApply() { if (EQG.done || EQG.st !== 'ready') return; EQG.done = true; const M = EQM, used = [];
  const use = (id, o) => { if (o) used.push(id); return o; };
  /* mixer: real drum (spins about its tilted local X), rear chute + ladder */
  { const X = EQ.mix, o = use('veh-mixer', eqModel(X.G, 'veh-mixer', 0, 0, 0, 0)); if (o) { X.T.visible = false; X.D = o.userData.n.drum; X.chute = o.userData.n.chute; X.glb = o; } }
  /* Medusa pit standpipes (coupler turned toward the car; live hoses kept) */
  for (const p of EQ.med) { const o = use('eq-standpipe', eqModel(p.G, 'eq-standpipe', 0, 0, 0, -Math.PI / 2)); if (o) { eqHideBoxes(p.G, [p.H, p.Hc]); for (const h of [p.H, p.Hc]) h.position.set(0, 1.50 * M - 0.3, 0.31 * M); } }
  /* ALB: pit grate between the rails, incline belt conveyor (bags ride its belt line), pallet jack */
  { const G = EQ.g.find(g => g.name === 'eq-alb-pit'); if (G && use('eq-pit-grate', eqModel(G, 'eq-pit-grate', 0, 0, 0, Math.PI / 2))) eqHideBoxes(G); }
  { const C = EQ.alb.B.parent, o = use('eq-conveyor', eqModel(C, 'eq-conveyor', 0, 0, 0, -Math.PI / 2)); if (o) { eqHideBoxes(C); for (const c of EQ.alb.B.children) if (!EQ.alb.bags.includes(c)) c.visible = false;
      const ang = Math.atan2(2.35, 7.3); EQ.alb.B.position.set(0, (0.45 + 0.12) * M, -3.65 * M); EQ.alb.B.rotation.x = -ang; EQ.alb.len = 7.3 / Math.cos(ang) * M; EQ.alb.belt = o.userData.n.belt; } }
  { const J = EQ.albT.J, o = use('prop-pallet-jack', eqModel(J, 'prop-pallet-jack', 0, 0, 0, 0)); if (o) { const ld = J.children.filter(c => c.isMesh); ld[1] && (ld[1].visible = false); ld[0] && ld[0].position.set(0.22 * M, 0.6 * M, 0); EQ.albT.jh = o.userData.n.handle; } }
  /* scrap: rubber-tired material handler with elevating cab + 1.55 m magnet */
  { const Sc = EQ.scrap, o = use('eq-handler', eqModel(Sc.G, 'eq-handler', 0, 0, 0, 0)); if (o) { eqHideBoxes(Sc.G); Sc.U.visible = false; const n = o.userData.n; Sc.gU = n.upper; Sc.gB = n.boom; Sc.gS = n.stick; Sc.gM = n.magnet;
      Sc.lump.parent.remove(Sc.lump); const L = new THREE.Group(); L.name = 'eq-scrap-lump'; L.add(Sc.lump); Sc.lump.position.set(0, 0, 0); Sc.lump.scale.set(0.9, 0.8, 0.9); api.scene.add(L); Sc.lumpG = L; Sc.glb = o; } }
  /* gas: dispensers on the islands with the two nozzles in their boots */
  for (const g of EQ.gas) { const o = use('eq-gas-pump', eqModel(g.P, 'eq-gas-pump', 0.02, 0, -0.08, Math.PI / 2)); if (o) { g.pump = o; g.nz = o.userData.n.nozzle_l; g.P.children.forEach(c => { if (c.isMesh && c !== g.hz) c.visible = false; }); } }
  /* IM-1: yard hostler (Ottawa class) + 40 ft chassis carrying the box; kingpin over the fifth wheel */
  { const Hh = EQ.host, o = use('veh-hostler', eqModel(Hh.H, 'veh-hostler', 0, 0, 0, 0)), c = use('eq-chassis', eqModel(Hh.H, 'eq-chassis', -7.4 * M, 0, 0, 0)); if (o && c) { eqHideBoxes(Hh.H, [Hh.box]); Hh.box.scale.set(12.19 / 12, 2.59 / 2.6, 2.44 / 2.5); Hh.box.position.set(-7.4 * M, (1.33 + 1.30) * M, 0); Hh.fifth = o.userData.n.fifth; Hh.H.position.x += 0; Hh.glb = o; } }
  /* Mi-Jack: true spreader with twistlocks hung under the kit's hoist (kit spreader mesh hidden, its hoist motion kept) */
  { let K = null; const v = new THREE.Vector3(); api.scene.traverse(q => { if (!K && q.name === 'spreader' && q.isMesh) { q.getWorldPosition(v); if (Math.hypot(v.x - 111, v.z - 114.2) < 8) K = q; } });
    if (K && EQG.lib['eq-spreader']) { const bb = new THREE.Box3().setFromObject(K), ws = new THREE.Vector3(); K.getWorldScale(ws); const o = eqModel(K, 'eq-spreader', 0, 0, 0, 0); o.scale.set(EQG.sc / ws.x, EQG.sc / ws.y, EQG.sc / ws.z);
      const c = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y + 0.13 * M, (bb.min.z + bb.max.z) / 2); K.worldToLocal(c); o.position.copy(c); if (bb.max.z - bb.min.z > bb.max.x - bb.min.x) o.rotation.y = Math.PI / 2;
      K.material = (Array.isArray(K.material) ? K.material[0] : K.material).clone(); K.material.visible = false; EQ.spr = { K, o, tw: ['twist_fl', 'twist_fr', 'twist_rl', 'twist_rr'].map(k => o.userData.n[k]).filter(Boolean) }; used.push('eq-spreader'); } }
  window.__EQGLB = used; }
function eqPose(G, x, z, h) { G.position.x = x; G.position.z = z; G.rotation.y = h; }
function eqTick(dt) { if (EQ.on === null) { eqInit(); eqGLBLoad(); } if (!EQ.on) return; eqGLBApply(); EQ.t += dt; const t = EQ.t, hr = (S.clock / 3600) % 24, work = hr >= 5.5 && hr < 19.5, sm = x => x * x * (3 - 2 * x), st = {};
  /* Medusa pits */
  for (const p of EQ.med) { const c = eqCarsNear(2, p.x, 113.51, 1.4)[0]; const on = !!(c && eqStill(c.cut)) && work; p.H.visible = on; p.Hc.visible = !on; st['med' + p.x] = on ? 'unloading ' + c.c.id : 'idle'; }
  /* mixer: in 40 s, load 90 s (drum fast), out 40 s, away 30 s */
  { const M = EQ.mix, T = 200, u = (t + 60) % T; let x, spin = 0.6; /* [R37 B4] glb drum: 0.6*0.35 = 0.21 rad/s = 2 rpm agitating on the road; 4*0.35 = 1.4 rad/s = 13.4 rpm charging at the plant (real 12-15) */ if (u < 40) x = M.x0 + (M.xs - M.x0) * sm(u / 40); else if (u < 130) { x = M.xs; spin = 4; } else if (u < 170) x = M.xs + (M.x1 - M.xs) * sm((u - 130) / 40); else x = M.x1;
    M.G.position.x = x; M.G.visible = work && u < 170; M.D.rotateX(dt * spin * (M.glb ? 0.35 : 1)); if (M.chute) M.chute.rotation.y = (u >= 40 && u < 130) ? -0.0 : 0; st.mixer = u < 40 ? "pulling in under the spout" : u < 130 ? 'loading (drum charging)' : 'departing'; }
  /* ALB conveyor bags move up the belt while a hopper stands over the pit */
  { const c = eqCarsNear(2, 11.26, 54.3, 2.6, /^(h\d|cb|g32|ch)/i)[0], run = !!(c && eqStill(c.cut)) && work; EQ.alb.bags.forEach((b, k) => { b.visible = run; b.position.z = ((t * 0.12 + k * EQ.alb.len / 10) % EQ.alb.len); }); st.alb = run ? 'pit + conveyor running (' + c.c.id + ')' : 'conveyor idle (no covered hopper on the pit)';
    const A = EQ.albT, T = 160, u = t % T, n = Math.min(8, Math.floor(u / 18)); A.pal.forEach((p, k) => { p.visible = work && k < n; }); const ph = (u % 18) / 18; A.J.position.x = 13.8 + 0.6 * Math.sin(ph * Math.PI); A.J.visible = work && n < 8; if (A.jh) A.jh.rotation.z = -0.25 - 0.25 * Math.sin(ph * Math.PI * 2); st.albTruck = n + '/8 pallets'; }
  /* scrap handler: swing to bins (grab) -> swing to the gondola (drop), pile frac grows while a gondola stands at the spot */
  { const Sc = EQ.scrap, g = eqCarsNear(1, 10.7, 74.25, 3.0, /gon|^g|mill/i)[0], T = 50, u = t % T, k = u / T;
    const yb = Math.atan2(74.25 - 74.25, 12.0 - 12.85), yg = g ? Math.atan2(Math.max(g.c._py, 73.5) - 74.25, g.c._px - 12.85) : yb + 0.9;
    const a = k < 0.25 ? yb : k < 0.5 ? yb + (yg - yb) * sm((k - 0.25) / 0.25) : k < 0.75 ? yg : yg + (yb - yg) * sm((k - 0.75) / 0.25);
    Sc.U.rotation.y = -a + Math.PI / 2; if (Sc.gU) { const M = EQM, rb = Math.hypot(12.0 - 12.85, 74.25 - 74.25) / M, rg = g ? Math.hypot(g.c._px - 12.0, Math.max(g.c._py, 73.5) - 74.25) / M : rb + 2.5, mv = (k > 0.25 && k < 0.5) || k > 0.75;
      const r = Math.max(3.5, Math.min(8.9, (k < 0.25 || k >= 0.75 ? rb : k < 0.5 ? rb + (rg - rb) * sm((k - 0.25) / 0.25) : rg) - (mv ? 0.6 : 0))); const phi = Math.acos(Math.max(-1, Math.min(1, (r - 1.0) / 8.0)));
      Sc.gU.rotation.y = -a; Sc.gB.rotation.z = phi; Sc.gM.rotation.z = -phi; const w = new THREE.Vector3(); Sc.gM.getWorldPosition(w); Sc.lumpG.position.set(w.x, w.y - 1.85 * M, w.z); Sc.lumpG.visible = Sc.lump.visible; Sc.lump.visible = true; Sc.lumpG.visible = k > 0.2 && k < 0.6; } Sc.Mg.rotation.x = 0.55; Sc.lump.visible = k > 0.2 && k < 0.6; if (g && eqStill(g.cut) && work) { if (!Sc.pile || Sc.pileCar !== g.c.id) { if (Sc.pile) Sc.pile.parent.remove(Sc.pile); const P = eqGroup(1, g.c._px, g.c._py, 'eq-scrap-pile'); P.position.y = (g.c._y || api.LV[0].deck) + 0.3; P.rotation.y = -(g.c._ang || 0); const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); const m = new THREE.Mesh(geo, eqMat(0x5b4636, { roughness: 1 })); P.add(m); Sc.pile = P; Sc.pm = m; Sc.pileCar = g.c.id; Sc.frac = 0.1; }
      if (k > 0.6 && k < 0.6 + dt / T + 1e-9) Sc.frac = Math.min(1, Sc.frac + 0.06); Sc.pm.scale.set(1.9 * Sc.frac + 0.2, 0.05 + 0.45 * Sc.frac, 0.32); st.scrap = 'loading ' + g.c.id + ' pile ' + Math.round(Sc.frac * 100) + '%'; } else st.scrap = 'sorting at the bins (no gondola spotted)'; }
  /* boxcar doors + load fraction while standing at an industry */
  { const H = window.__ops3d, seen = new Set(); if (H && H.engine) for (const c of H.engine.cuts) { if (!eqStill(c)) continue; for (const k of c.cars) { if (k._px == null || !/^(c\d|x|box|b\d|plate)/i.test(k.type || '') || !k.ind || k.status === 'pickup' && k.dest === 'TRAIN') continue; seen.add(k.id); let D = EQ.doors.get(k.id);
        if (!D) { const G = new THREE.Group(); G.name = 'eq-boxcar-door'; api.scene.add(G); const dm = eqMat(0x5a3a28), dk = eqMat(0x0c0c0c), ld = eqMat(0xc8a878); D = { G, t0: t, s: [] }; for (const sd of [-1, 1]) { const O = eqBox(G, 0.75, 0.62, 0.01, 0, 0.66, sd * 0.392, dk), P = eqBox(G, 0.75, 0.64, 0.02, 0, 0.66, sd * 0.405, dm), L = eqBox(G, 0.7, 0.5, 0.02, 0, 0.6, sd * 0.398, ld); D.s.push({ O, P, L, sd }); } EQ.doors.set(k.id, D); }
        D.G.position.set(k._px, k._y != null ? k._y : api.LV[0].deck, k._py); D.G.rotation.y = -(k._ang || 0); const op = Math.min(1, (t - D.t0) / 8), fr = k.load === 'empty' ? Math.min(1, (t - D.t0) / 600) : Math.max(0, 1 - (t - D.t0) / 600); D.G.visible = work;
        for (const q of D.s) { q.P.position.x = op * 0.78; q.L.scale.y = Math.max(0.02, fr); q.L.position.y = 0.36 + 0.25 * fr; q.L.visible = fr > 0.02; } D.frac = fr; } }
    for (const [id, D] of EQ.doors) if (!seen.has(id)) { api.scene.remove(D.G); EQ.doors.delete(id); } st.boxcars = EQ.doors.size; }
  /* autorack loading: lot row -> ramp toe -> up the ramp (raycast) -> into the rack doors; van shuttle lot <-> ramp */
  { const A = EQ.ar, T = 120; const path = [[6.0, 17.0], [9.64, 18.5], [9.64, 22.2], [9.64, 27.6]]; const seg = (P, f) => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); const d = f * c[c.length - 1]; let i = 1; while (i < c.length - 1 && c[i] < d) i++; const g = (d - c[i - 1]) / (c[i] - c[i - 1] || 1), a = P[i - 1], b = P[i]; return [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g, Math.atan2(-(b[1] - a[1]), b[0] - a[0])]; };
    const rack = eqCarsNear(2, 9.64, 27.5, 4.0, /auto|rack|ar/i)[0];
    for (const V of A.veh) { const u = ((t / T + V.ph) % 1); const f = Math.min(1, u / 0.7); const p = seg(V.col ? [[14.0, 17.0], [9.64, 18.5], [9.64, 22.2], [9.64, 27.6]] : path, sm(f)); eqPose(V.G, p[0], p[1], p[2]);
      A.rc.set(new THREE.Vector3(p[0], api.LV[1].deck + 2, p[1]), new THREE.Vector3(0, -1, 0)); A.rc.far = 3; const h = A.tg.length ? A.rc.intersectObjects(A.tg, true).find(q => !q.object.name.startsWith('eq-') && q.point.y < api.LV[1].deck + 0.8) : null; V.G.position.y = h ? h.point.y : api.LV[1].deck + (p[1] <= 18.5 ? 0 : 0.55 * Math.min(1, (p[1] - 18.5) / 3.7)); V.G.visible = work && u < 0.72; }
    const v = (t / 90) % 1, q = seg([[13.0, 16.0], [11.5, 20.5], [11.0, 21.6]], v < 0.5 ? sm(v * 2) : sm(2 - v * 2)); eqPose(EQ.van, q[0], q[1], q[2] + (v < 0.5 ? 0 : Math.PI)); EQ.van.visible = work; st.autorack = rack ? 'loading into ' + rack.c.id : 'ramp cycle (no autorack spotted at the ramp)'; }
  /* gas: arrive 15 s, pump 60 s (nozzle in), leave 15 s, empty 20 s */
  for (const g of EQ.gas) { const T = 110, u = (t / T + g.ph) % 1 * T; let dx; if (u < 15) dx = -3 + 3 * sm(u / 15); else if (u < 75) dx = 0; else if (u < 90) dx = 3 * sm((u - 75) / 15); else dx = 9; g.G.position.z = 108.4 - (u < 75 ? -dx : dx); g.body.rotation.y = u < 75 ? Math.PI / 2 : -Math.PI / 2; g.G.visible = dx < 8; g.P.visible = true; g.hz.visible = u >= 17 && u < 74; if (g.nz) g.nz.visible = !g.hz.visible; st['gas' + g.x] = u < 15 ? 'arriving' : u < 75 ? 'pumping' : 'leaving'; }
  /* IM-1 hostler: stack row (x 108) <-> under the Mi-Jack (x 111), with / without a box */
  { const Hh = EQ.host, T = 140, u = t % T; let x; if (u < 30) x = 107.4 + 4.2 * sm(u / 30); else if (u < 70) x = 111.6; else if (u < 100) x = 111.6 - 4.2 * sm((u - 70) / 30); else x = 107.4; Hh.H.position.x = x; const unl = Math.floor(t / T) % 2 === 1, well = eqCarsNear(2, 111, 114.2, 5, /well/i)[0]; Hh.box.visible = unl ? (u >= 50 && u < 100) : (u < 50 || u >= 100); if (Hh.fifth) Hh.fifth.position.y = (1.25 + 0.3 * (u < 30 || u >= 100 ? 1 : 0)) * 6.25; if (EQ.spr) { const lk = u >= 30 && u < 50 ? 1 : 0; for (const q of EQ.spr.tw) q.rotation.y = lk * Math.PI / 2; st.spreader = lk ? 'twistlocks locked' : 'twistlocks open';
      const hang = unl ? (u >= 30 && u < 50) : (u >= 50 && u < 70); if (!EQ.sprBox) { const B = new THREE.Group(); B.name = 'eq-spreader-box'; eqBox(B, 12.19 * EQM, 2.59 * EQM, 2.44 * EQM, 0, -1.30 * EQM, 0, eqMat(0x7a2a1f, { metalness: 0.4 })); api.scene.add(B); EQ.sprBox = B; }
      const w = new THREE.Vector3(); EQ.spr.o.getWorldPosition(w); EQ.sprBox.position.set(w.x, w.y - 0.15 * EQM, w.z); EQ.sprBox.rotation.y = 0; EQ.sprBox.visible = hang && work;
      for (const q of EQ.spr.tw) q.rotation.y = (lk || hang) ? Math.PI / 2 : 0; }
    st.im1 = (well ? (unl ? 'unloading ' : 'loading ') + well.c.id : 'no well under the Mi-Jack') + (EQ.spr ? '' : ' (kit spreader)'); st.hostler = u < 30 ? (unl ? 'to crane (empty chassis)' : 'to crane (loaded)') : u < 70 ? 'under crane (lift)' : u < 100 ? (unl ? 'to stacks (loaded)' : 'to stacks (empty)') : 'at stacks'; }
  window.__EQ = st; }
/* [R37 B1] blue-signal protection (49 CFR 218.29): every industry spur with cars spotted and no engine on it shows a blue flag on a post at the
   switch end plus a yellow derail on the rail just inside it; both come down while a crew engine is on the spur (the crew removes its protection to switch). */
const BF = { list: null, n: 0 };
function blueTick() { const H = window.__ops3d, eng = H && H.engine; if (!eng || !eng.D || !api) return;
  if (!BF.list) { BF.list = []; const mb = new THREE.MeshStandardMaterial({ color: 0x1f4fff, emissive: 0x0a1a66, roughness: 0.6, side: THREE.DoubleSide }), mp = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.5 }), my = new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.5 });
    for (const ind of eng.D.industries || []) { const t = eng.trk && eng.trk[ind.tid]; if (!t || t.type !== 'spur') continue; const A = eng.N[t.a], B = eng.N[t.b]; if (!A || !B) continue;
      let a = A, b = B; if (B.kind === 'points' && A.kind === 'bumper') { a = B; b = A; } const dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, d = Math.min(2.2, L * 0.15);
      const lv = t.level || 1, y = api.LV[lv - 1].deck + 0.289, g = new THREE.Group(); g.name = 'blue-flag-' + ind.id; g.position.set(a.x + ux * d, y, a.y + uz * d); g.rotation.y = Math.atan2(-uz, ux);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6), mp); post.position.set(0, 0.21 - 0.05, 0.56); g.add(post);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.09), mb); fl.position.set(0.075, 0.30, 0.56); g.add(fl);
      const der = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.06), my); der.position.set(0, 0.0, 0.12); g.add(der);   /* derail on the near rail (rail 0.18 off centre at N gauge 0.354) */
      g.visible = false; api.scene.add(g); BF.list.push({ ind: ind.id, tid: ind.tid, g }); } }
  const occ = {}, loco = {}; for (const c of eng.cuts) { const o = eng.occupancy ? eng.occupancy(c) : {}; const lo = c.cars.some(x => x.loco); for (const e in o) { const tid = eng.e2t[e]; if (!tid) continue; occ[tid] = 1; if (lo) loco[tid] = 1; } }
  let n = 0; for (const f of BF.list) { f.g.visible = !!occ[f.tid] && !loco[f.tid]; if (f.g.visible) n++; } BF.n = n; G.blue = { up: n, of: BF.list.length }; }
function draw(dtR) { dtR = dtR || 0.016; try { blueTick(); } catch (e) { G.blueErr = String(e); } try { kitTick(dtR * (S.fc || 4) / 4); }   /* motion time = vehicles (core: motion = fc / 4) */ catch (e) { if (!KA.err) { KA.err = String(e) + ' ' + String(e && e.stack).slice(0, 600); window.__KAERR = KA.err; console.warn('kitTick', e); } }
  for (const id in meshes) setBegin(meshes[id]);
  for (const id in S.veh) { const V = S.veh[id]; if (!V.vis) continue; const set = meshes[pick(V.model)]; if (!set) continue;
    _p.set(V.x, deckY(V.lv, V.x, V.y) + 0.012, V.y); _q.setFromEuler(_e.set(0, -V.h, 0)); if (set.rig) vehPose(V, set, dtR); setPut(set, V.v.color, 'v:' + id, V.model !== 'autohauler' ? true : (V.load || 0)); }
  for (const id in meshes) setEnd(meshes[id]);
  for (const k in pmesh) setBegin(pmesh[k]); for (const k in RIG) if (RIG[k]) setBegin(RIG[k]);
  const tnow = performance.now() / 1000, cp = api.camera.position, LP = [], LH = [];
  if (LIFE.ready) { for (const a of S.agents) { if (!a.vis || a.held) continue; const L = a.legs[a.i]; if (!L || (L.k !== 'walk' && L.k !== 'stand')) continue; const y = deckY(a.lv, a.x, a.y) + walkTop(a.lv, a.x, a.y), d = Math.hypot(a.x - cp.x, y - cp.y, a.y - cp.z); if (d > LIFE_R) continue;
      const sit = L.k === 'stand' && /fisherman|angler|spectator|customer/.test(a.A.role || ''), wk = a.pose !== 'walk' && (a.kind === 'task' || /worker|crew|yard|driver|production|guard|operator|owner/.test(a.A.role || ''));
      const sd = a._sd != null ? a._sd : (a._sd = Math.random()), farm = /farm|stable|horse/i.test((a.A.role || '') + (a.A.biz || ''));
      const sp = a._lx != null ? Math.hypot(a.x - a._lx, a.y - a._ly) / Math.max(1e-3, dtR) : 0; a._lx = a.x; a._ly = a.y;
      const base = sit ? (LIFE.lib['person-sit'] ? 'person-sit' : 'person-stand') : wk ? (LIFE.lib['person-worker'] ? 'person-worker' : 'person-stand') : farm && LIFE.lib['person-farmer'] ? 'person-farmer' : a.pose === 'walk' && LIFE.lib['person-walk'] ? 'person-walk' : 'person-stand';
      LP.push({ key: 'a:' + a.id, d, base, sd, x: a.x, y, z: a.y, yaw: -a.h, clip: a.pose === 'walk' ? 'walk' : sit ? 'sit' : wk ? 'work' : 'idle', ts: a.pose === 'walk' ? Math.min(3, Math.max(0.3, sp / (8.75 * MM))) : 1, sp }); }
    for (let i = 0; i < horses.length; i++) { const H = horses[i], y = deckY(H.h.lv, H.x, H.y), d = Math.hypot(H.x - cp.x, y - cp.y, H.y - cp.z); const base = H.h.rider ? 'horse-rider' : 'horse'; if (!LIFE.lib[base]) continue;
      LH.push({ key: 'h:' + i, d, base, sd: H.sd / 6, x: H.x, y, z: H.y, yaw: -H.a, clip: H.mv ? 'walk' : H.graze ? 'graze' : 'idle', ts: 1, sp: H.mv ? horseSp(H) * (S.fc / 4) : 0 }); } }
  seatFrame(LP);   /* [R30] seated figures never float: a folding camp chair / stool sits under every 'sit' pose (person-sit glb: feet at origin, seat 0.118 in) */
  const LG = lifeFrame(dtR, LP, LH);
  for (const a of S.agents) { if (!a.vis || a.held || LG.has('a:' + a.id)) continue; const L = a.legs[a.i]; if (!L || (L.k !== 'walk' && L.k !== 'stand')) continue;
    const sit = L.k === 'stand' && /fisherman|angler|spectator|customer/.test(a.A.role || '');
    const k = a.pose === 'walk' ? 'walk' : sit ? 'sit' : (a.kind === 'task' || /worker|crew|yard|driver|production|guard|operator|owner/.test(a.A.role || '') ? 'worker' : 'stand');
    if (a._px != null) { const d = Math.hypot(a.x - a._px, a.y - a._py); if (d < 2) a._ph = (a._ph || 0) + d / 0.2 * Math.PI; } a._px = a.x; a._py = a.y; const sd = a._sd != null ? a._sd : (a._sd = Math.random());
    _p.set(a.x, deckY(a.lv, a.x, a.y) + walkTop(a.lv, a.x, a.y), a.y); _q.setFromEuler(_e.set(0, -a.h + (QS.get('pyaw') ? +QS.get('pyaw') : 0), 0));   /* [RV1] person models face +X like the vehicles (was +90 deg: people walked sideways) */
    if (k === 'sit' && pmesh.sit) { setPut(pmesh.sit, null, 'a:' + a.id, true); continue; }
    const RS = k === 'worker' ? (RIG.worker || RIG.person) : RIG.person;
    if (RS) { rigPut(RS, personAng(k, a._ph || 0, tnow, sd), 'a:' + a.id, k === 'sit' ? RS.R.H * 0.24 : 0); continue; }
    setPut(pmesh[k === 'sit' ? 'stand' : k], null, 'a:' + a.id, true); }
  for (const k in pmesh) setEnd(pmesh[k]);
  for (const k in hmesh) setBegin(hmesh[k]);
  for (let hi = 0; hi < horses.length; hi++) { const H = horses[hi]; if (LG.has('h:' + hi)) continue; const k = H.h.rider ? 'horse-rider' : H.graze ? 'horse-grazing' : 'horse'; _p.set(H.x, deckY(H.h.lv, H.x, H.y), H.y); _q.setFromEuler(_e.set(0, -H.a, 0));
    const RS = H.h.rider ? RIG.rider : RIG.horse; if (RS && !(H.graze && has('horse-grazing'))) { rigPut(RS, horseAng(H, tnow), 'h', 0); continue; } setPut(hmesh[k], null, 'h', true); }
  for (const k in hmesh) setEnd(hmesh[k]); for (const k in RIG) if (RIG[k]) setEnd(RIG[k]);
}
// ---------------------------------------------------------------- ops tie-in: the ops session drives the clock; a spotted car starts its industry's trucks
function ops() { return QS.get('logiclock') !== 'own' && window.__ops3d && window.__ops3d.engine ? window.__ops3d : null; }
function opsClock() { const H = ops(); if (!H) return null; if (!S.railHeld) S.holdRail(true); const t = H.engine.t || 0; return (6 * 3600 + t * (H.fc || 4)) % 86400; }
function opsRate() { const H = ops(); return H ? Math.min(H.rateOf ? H.rateOf() : 1, 4) * (H.fc || 4) / 4 : 1; }
let rp = 0; const seen = {};
function railPoll(dt) { rp += dt; if (rp < 2) return; rp = 0; const H = ops(); if (H) S.pollRail(H.engine); }
G.trigger = (k, why) => S.trigger(k, why);
// ---------------------------------------------------------------- HUD + inspect
function el(tag, css, html) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; return e; }
function buildHud() {
  hud = el('div', 'position:fixed;left:10px;bottom:10px;z-index:30;background:rgba(20,24,28,.82);color:#e8e8e8;font:12px/1.35 system-ui,sans-serif;padding:6px 8px;border-radius:6px;user-select:none', '');
  hud.id = 'logi-hud'; document.body.appendChild(hud);
  hud.innerHTML = '<b id="logi-clock">--:--</b> <span id="logi-rate"></span> <button data-r="4">x4</button><button data-r="12">x12</button><button data-r="60">x60</button><button data-r="0">II</button><br><span id="logi-sum" style="opacity:.8"></span>';
  hud.querySelectorAll('button').forEach(b => { b.style.cssText = 'margin-left:3px;font:11px system-ui;padding:1px 5px'; b.onclick = () => { S.fc = +b.dataset.r; }; });
  panel = el('div', 'position:fixed;right:10px;bottom:10px;z-index:31;max-width:360px;max-height:55vh;overflow:auto;background:rgba(20,24,28,.9);color:#eee;font:12px/1.4 system-ui,sans-serif;padding:8px 10px;border-radius:6px;display:none'); panel.id = 'logi-inspect'; document.body.appendChild(panel);
  todSet = QS.has('tod') ? null : (L3D.ambience && L3D.ambience.set);
}
function todTick() { if (todSet && S) { const tod = L3D.ambience.todAt(S.clock); if (tod !== lastTod) { lastTod = tod; try { todSet(tod); } catch (e) {} } } }
function hudTick() { todTick(); if (!hud) return; const c = T.hm(S.clock); document.getElementById('logi-clock').textContent = c; document.getElementById('logi-rate').textContent = ops() ? '(ops clock)' : (S.fc ? 'x' + S.fc : 'paused');
  let mv = 0, wk = 0; for (const id in S.veh) if (S.veh[id].vis && S.veh[id].state === 'drive') mv++; for (const a of S.agents) if (a.vis && a.pose === 'walk') wk++;
  document.getElementById('logi-sum').textContent = `${mv} vehicles moving, ${wk} people walking`;
  if (sel) showSel(); }
function showSel() { const [k, id] = sel.split(':'); let a = null, V = null;
  if (k === 'v') { V = S.veh[id]; a = V && V.drv ? S.byId[V.drv] : S.agents.find(x => x.A.veh === id && x.kind === 'person') || S.agents.find(x => x.legs.some(L => L.veh === id)); } else { a = S.byId[id]; V = a && a.A.veh ? S.veh[a.A.veh] : null; }
  const P = a && S.D.people.find(p => p.id === (a.A.of || a.id)); const nx = a && S.nextLeg(a);
  let h = '<div style="float:right;cursor:pointer" id="logi-x">x</div>';
  if (V) h += `<b>${V.v.label || V.model}</b>${V.v.owner ? ' - ' + V.v.owner : ''}<br>`;
  if (a) h += `<b>${a.A.name}</b>, ${a.A.role || ''}<br>${a.A.carrier ? 'carrier: ' + a.A.carrier + '<br>' : ''}now: ${S.agentState(a)}<br>${nx ? 'next: ' + (nx.k === 'drive' ? 'drive ' + nx.frm + ' -> ' + nx.to : 'walk') + ' at ' + T.hm(nx.t0) + '<br>' : ''}`;
  if (P && P.home) h += `home: ${P.home.label || P.home.town || ''}${P.home.stall ? ' (parks in ' + P.home.stall + ')' : ''}<br>`;
  if (a && a.A.plan) h += '<div style="opacity:.8;margin-top:3px">' + a.A.plan.map(s => `${s.t_in != null ? T.hm(s.t_in) : '  '}-${T.hm(s.t_out)} ${s.what}${s.stall ? ' [' + s.stall + ']' : ''}`).join('<br>') + '</div>';
  panel.innerHTML = h; panel.style.display = 'block'; document.getElementById('logi-x').onclick = () => { sel = null; panel.style.display = 'none'; }; }
function bindPick() { const ray = new THREE.Raycaster(), cv = api.renderer.domElement; let dn = null;
  cv.addEventListener('pointerdown', e => { dn = [e.clientX, e.clientY]; });
  cv.addEventListener('pointerup', e => { if (!dn || Math.hypot(e.clientX - dn[0], e.clientY - dn[1]) > 4) return; const r = cv.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), api.camera);
    const objs = [...Object.values(meshes), ...Object.values(pmesh)].flatMap(x => x.parts.map(p => p.m)); const hit = ray.intersectObjects(objs, false).find(h => h.instanceId != null && h.instanceId < h.object.count);
    if (hit) { sel = hit.object.userData.ids[hit.instanceId]; showSel(); } }); }
G.select = id => { sel = id; showSel(); };
})();
