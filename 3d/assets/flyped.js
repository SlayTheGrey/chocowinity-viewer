/* [FLYPED 2026-10-18] Fly (key 5) and Pedestrian (key 6) camera modes for the layout3d viewer (shared tool, works for any plan).
   FLY : free flight. WASD / arrows move along the view, Space or E up, C or Q down (also PageUp / PageDown), mouse look (click = pointer lock,
         or drag), wheel or + / - = speed, Shift = boost x4, hold Z = precision x0.15. Smooth acceleration + damping. No room collision, but the
         decks are solid (you cannot sink through the scenery into the underside) unless X (pass-through) is on. Near plane shrinks near models.
   PED : walk ON the layout as a 1:160 person (eye 5.5 scale ft = 0.41 in). WASD + mouse look, Shift = run (8 mph scale), walk = 3 mph scale,
         Space = jump, C = crouch. Real gravity at scale (g/160, so a jump takes real time, the same clock the trains use for scale speed).
         Ground = the level's own rendered surfaces (terrain, roads, sidewalks + curbs, platforms, track roadbed) via a triangle height index.
         Blocked by buildings (footprints), tree trunks, fences, water, the deck edge, rolling stock and road vehicles; steps <= 11 scale in
         (curbs) and climbs the ballast shoulder to cross tracks.
   API: L3D.flyped.init(api) (viewer calls it), enter(mode, prev), exit(mode, next), update(dt, mode), placePed(lv, x, z [, yaw]), flyTo(lv, x, z),
        wheel(dy), key(code), state(); window.__layout3d.api.flyped = this. */
(function () {
const L3D = window.L3D = window.L3D || {};
const FP = L3D.flyped = {};
const S = 1 / 160, IN_MPH = 17.6 * S;                  // 1 scale mph = 0.11 in/s
const PED = FP.PED = { eye: 66 * S, crouch: 40 * S, r: 0.045, walk: 3 * IN_MPH, run: 8 * IN_MPH, g: 386.1 * S, jump: Math.sqrt(2 * 386.1 * S * 18 * S),
  step: 11 * S, stepTrack: 0.32, near: 0.008, fov: 60 };
const FLY = FP.FLY = { spd: 6, min: 0.05, max: 200, boost: 4, slow: 0.15, acc: 6, margin: 0.03, pass: false };
let A = null, T = null, cam = null; const v = { x: 0, y: 0, z: 0 };
const st = FP.st = { lv: 0, feet: 0, vy: 0, ground: true, eyeY: 0, hv: [0, 0], idx: [], trees: [], fences: [], solids: [], blocked: null, crouch: 0, shadowSaved: null, autoSh: false, hudT: 0 };
const K = () => A.KEY;
// [L3 2026-10-18] the L3 staging shelf as a pseudo level (solid for Fly, walkable for Pedestrian): plywood top on the L2 outline, 0.75 in thick
let L3o = null;
function LVS() { if (!A) return []; if (L3o === null) { L3o = false; const L3 = A.L3;
    if (L3 && L3.g && A.LV[1]) { const S3 = (window.LAYOUT || {}).l3 || {}, cells = new Map(), C = 2, add = (x, y, v) => { const k = Math.floor(x / C) + ',' + Math.floor(y / C); (cells.get(k) || cells.set(k, []).get(k)).push(v); };
      for (const t of S3.tracks || []) { const P = t.pts || []; for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), n = Math.max(1, Math.ceil(l / 0.1)); for (let k = 0; k <= n; k++) { const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k / n, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k / n; add(x, y, [x, y]); } } }
      if (A.LIFT && !(S3.tracks || []).length) for (let z = A.LIFT.y0 - 3; z <= A.LIFT.y1 + 3; z += 0.1) add(A.LIFT.x, z, [A.LIFT.x, z]);
      const track = { near(x, y, r, fn) { for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((y - r) / C); j <= Math.floor((y + r) / C); j++) { const a = cells.get(i + ',' + j); if (a) for (const v of a) if (fn(v) === false) return false; } return true; } };
      L3o = { L: { id: 3, boards: A.LV[1].L.boards, structures: [], lines: [], roads: [], tracks: S3.tracks || [] }, polys: A.LV[1].polys || [], deck: L3.deck, g: L3.g, terrain: null, water: [], nature: null, track, l3: true, thick: 0.75 }; } }
  return L3o ? A.LV.concat([L3o]) : A.LV; }
FP.levels = () => LVS();
// [ROUND 2026-10-18] round / cylindrical footprints: layout field shape:'round'|'rect', a registry shape hint, else tanks / silos / bins by kind or name
function roundOf(s) { const R3 = (window.L3D && (L3D.REGISTRY || {}).assets) || {}, AS = (window.L3D && L3D.assets) || {}; let hint = s.shape || null, named = false;
  for (const id of [].concat(s.assetHint || [], s.sid || [])) { const a = R3[id] || AS[id]; if (!a) continue; hint = hint || a.shape || (a.meta && a.meta.shape) || null; if (/\b(tank|silo|bin|cistern)s?\b/i.test(a.name || '') && !/rack|car|pump|house|shed/i.test(a.name || '')) named = true; }
  if (hint === 'rect' || hint === 'box') return null;
  if (!(hint === 'round' || hint === 'cylinder' || /^(tanks?|silos?|bins?|water-?tower|gasholder)$/i.test(s.kind || '') || named || (/\b(tank|silo|bin|cistern)s?\b/i.test(s.name || '') && !/rack|car|pump|house|shed|farm|lot/i.test(s.name || '')))) return null;
  const q = s.r, w = q[2] - q[0], d = q[3] - q[1], R = Math.min(w, d) / 2, n = Math.max(1, Math.round(Math.max(w, d) / Math.min(w, d))), out = [];
  for (let i = 0; i < n; i++) out.push(w >= d ? [q[0] + (i + 0.5) * w / n, (q[1] + q[3]) / 2, Math.min(R, w / n / 2)] : [(q[0] + q[2]) / 2, q[1] + (i + 0.5) * d / n, Math.min(R, d / n / 2)]); return out; }
FP.roundOf = roundOf;
FP.init = function (api) { A = api; T = window.THREE; cam = api.camera; api.flyped = FP; hud(); };
FP._A = () => A;
// ------------------------------------------------------------------ helpers
const segD = (px, pz, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9; let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz); };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const thick = o => o.thick || (o.L.id === 1 ? 4.75 : 2.75);
const terr = (o, x, z) => o.deck + (o.terrain ? o.terrain.h(x, z) : 0);
function boardAt(x, z, m = 0) { for (let i = 0; i < LVS().length; i++) if (A.onBoard(LVS()[i], x, z, m)) return i; return -1; }
// ------------------------------------------------------------------ height index: upward-facing triangles of the level's static meshes in 0.5 in cells
const CELL = 0.5;
function index(li) {
  if (st.idx[li]) return st.idx[li]; const o = LVS()[li], t0 = performance.now();
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const r of o.L.boards) { x0 = Math.min(x0, r[0]); z0 = Math.min(z0, r[1]); x1 = Math.max(x1, r[2]); z1 = Math.max(z1, r[3]); }
  for (const p of o.polys || []) for (const q of p) { x0 = Math.min(x0, q[0]); z0 = Math.min(z0, q[1]); x1 = Math.max(x1, q[0]); z1 = Math.max(z1, q[1]); }
  x0 -= 2; z0 -= 2; x1 += 2; z1 += 2; const NX = Math.ceil((x1 - x0) / CELL), NZ = Math.ceil((z1 - z0) / CELL);
  const cells = new Array(NX * NZ); let tri = []; const V = new T.Vector3(); o.g.updateMatrixWorld(true);
  const skip = m => !m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || m === o.waterMesh || m.userData.noGround || (Array.isArray(m.material) ? m.material : [m.material]).every(q => q && q.transparent && q.opacity < 0.5);
  o.g.traverse(m => { if (skip(m)) return; const g = m.geometry, P = g.attributes.position; if (!P) return; const I = g.index, n = I ? I.count : P.count, W = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { V.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); W[i * 3] = V.x; W[i * 3 + 1] = V.y; W[i * 3 + 2] = V.z; }
    for (let k = 0; k + 2 < n; k += 3) { const a = I ? I.getX(k) : k, b = I ? I.getX(k + 1) : k + 1, c = I ? I.getX(k + 2) : k + 2;
      const ax = W[a * 3], ay = W[a * 3 + 1], az = W[a * 3 + 2], bx = W[b * 3], by = W[b * 3 + 1], bz = W[b * 3 + 2], cx = W[c * 3], cy = W[c * 3 + 1], cz = W[c * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az, nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, nl = Math.hypot(nx, ny, nz);
      if (!(nl > 1e-12) || Math.abs(ny) / nl < 0.2) continue;             // vertical walls are not ground (footprints / band test handle them)
      const id = tri.length / 9; tri.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / CELL)), i1 = Math.min(NX - 1, Math.floor((Math.max(ax, bx, cx) - x0) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / CELL)), j1 = Math.min(NZ - 1, Math.floor((Math.max(az, bz, cz) - z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = j * NX + i; (cells[q] || (cells[q] = [])).push(id); } } });
  const ix = st.idx[li] = { x0, z0, NX, NZ, cells, tri: new Float32Array(tri), ms: Math.round(performance.now() - t0) }; tri = null;
  // trees (trunks) and fences of this level
  st.trees[li] = ((o.nature && o.nature.trees) || []).map(t => [t.x, t.z, Math.max(0.03, Math.min(0.08, (t.H || 2) * 0.018))]);
  st.solids[li] = (o.L.structures || []).map(s => ({ s, r: s.r, c: roundOf(s) }));
  st.fences[li] = []; for (const l of o.L.lines || []) if (/^(fence|board|chain|wire|hedge|rail)$/.test(l.kind) && l.pts) for (let i = 1; i < l.pts.length; i++) st.fences[li].push([l.pts[i - 1], l.pts[i]]);
  return ix;
}
FP.index = index;
// surfaces under (x,z): returns { g: highest top <= lim, band: true if a top lies in (lim, head) }
function surf(li, x, z, lim, head) {
  const ix = index(li), i = Math.floor((x - ix.x0) / CELL), j = Math.floor((z - ix.z0) / CELL); let g = -1e9, band = false;
  if (i >= 0 && j >= 0 && i < ix.NX && j < ix.NZ) { const L = ix.cells[j * ix.NX + i], R = ix.tri; if (L) for (const id of L) { const o = id * 9;
    const ax = R[o], az = R[o + 2], bx = R[o + 3], bz = R[o + 5], cx = R[o + 6], cz = R[o + 8], d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (!d) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue; const y = l1 * R[o + 1] + l2 * R[o + 4] + l3 * R[o + 7];
    if (y <= lim) { if (y > g) g = y; } else if (y < head) band = true; } }
  const tg = Math.min(terr(LVS()[li], x, z) - 0.02, lim); if (g < tg) g = tg;   // never below the terrain (the base board under the scenery shows through gaps at the deck edge)
  return { g, band };
}
FP.surf = surf;
// ------------------------------------------------------------------ pedestrian collision
function carBoxes(li) {   // rolling stock + road vehicles on this level: [x, z, angle, halfLen, halfWid]
  const out = []; const H = window.__ops3d;
  if (H && H.carBoxes) for (const b of H.carBoxes()) if (b[5] === li) out.push(b);
  for (const t of A.TRAINS || []) if (t.lv === li) for (const c of t.cars || []) if (c.cx != null) out.push([c.cx, c.cz, c.yaw || 0, c.len / 2, 0.38]);
  return out;
}
function inBox(b, x, z, pad) { const dx = x - b[0], dz = z - b[1], c = Math.cos(b[2]), s = Math.sin(b[2]); const u = dx * c + dz * s, w = -dx * s + dz * c; return Math.abs(u) < b[3] + pad && Math.abs(w) < b[4] + pad ? [u, w] : null; }
function why(li, x, z, feet, boxes) {   // null = free, else the reason (used by the tests and the HUD)
  const o = LVS()[li], r = PED.r; if (!A.onBoard(o, x, z, 0.06)) return 'edge'; if ((o.water || []).some(p => inPoly(x, z, p))) return 'water';
  for (const b of st.solids[li] || []) { const q = b.r; if (!(x > q[0] - r && x < q[2] + r && z > q[1] - r && z < q[3] + r)) continue; if (!b.c) return 'building'; for (const c of b.c) if (Math.hypot(x - c[0], z - c[1]) < c[2] + r) return 'building'; }
  for (const t of st.trees[li]) if (Math.abs(t[0] - x) < 0.2 && Math.abs(t[1] - z) < 0.2 && Math.hypot(t[0] - x, t[1] - z) < t[2] + r) return 'tree';
  for (const f of st.fences[li]) if (segD(x, z, f[0], f[1]) < r + 0.012) return 'fence';
  for (const b of boxes) if (inBox(b, x, z, r)) return 'car';
  const lim = feet + (A.trackDist(o, x, z, 1) < 0.75 ? PED.stepTrack : PED.step), head = feet + PED.eye * 0.95;
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const s2 = surf(li, x + ox, z + oz, lim, head); if (s2.band) return 'obstacle'; }
  return null;
}
FP.why = (li, x, z, feet) => { index(li); return why(li, x, z, feet == null ? surf(li, x, z, 1e9, 1e9).g : feet, carBoxes(li)); };
// ------------------------------------------------------------------ enter / exit / placement
FP.enter = function (m, prev) {
  v.x = v.y = v.z = 0; st.hv = [0, 0]; cam.up.set(0, 1, 0);
  if (m === 'fly') { setNear(0.05); if (prev === 'walk' || prev === 'cab' || prev === 'chase' || prev === 'ped') { /* keep the view, it is already a first-person one */ } }
  if (m === 'ped') { cam.near = PED.near; cam.fov = PED.fov; cam.updateProjectionMatrix(); if (!st.placing) pedFromView(prev); autoShadows(true); }
  hudShow(m);
};
FP.exit = function (m, next) { if (m === 'ped') autoShadows(false); shadowReset(); hudShow(next); if (m === 'ped' || m === 'fly') { cam.near = 0.1; cam.updateProjectionMatrix(); } st.placed = m === 'ped' && next === 'ped'; };
function setNear(n) { if (Math.abs(cam.near - n) > 1e-6) { cam.near = n; cam.updateProjectionMatrix(); } }
function pedFromView(prev) {   // where the screen centre meets the scenery (or straight below the camera), else the town centre
  const p = cam.position.clone(), d = new T.Vector3(); cam.getWorldDirection(d); let hit = null;
  if (prev !== 'walk') for (let t = 0, stp = 0.25; t < 600 && !hit; t += stp) { const x = p.x + d.x * t, y = p.y + d.y * t, z = p.z + d.z * t;
    for (let i = LVS().length - 1; i >= 0; i--) { const o = LVS()[i]; if (y < o.deck - 3 || y > o.deck + 30) continue; if (A.onBoard(o, x, z) && y <= terr(o, x, z) + 0.05) { hit = [i, x, z]; break; } } stp = Math.min(1, 0.05 + t * 0.01); }
  if (!hit) { let best = -1; for (let i = 0; i < LVS().length; i++) if (A.onBoard(LVS()[i], p.x, p.z) && LVS()[i].deck < p.y) best = i; if (best >= 0) hit = [best, p.x, p.z]; }
  if (!hit) hit = [0, A.LOOK0[0], A.LOOK0[1]];
  const yaw = Math.atan2(d.x, d.z); FP.placePed(hit[0], hit[1], hit[2], Math.hypot(d.x, d.z) > 0.05 ? yaw : null);
}
FP.placePed = function (li, x, z, yaw) {   // nearest free standing spot (spiral search), prefer not standing on a track
  index(li); const boxes = carBoxes(li); let best = null;
  for (let r = 0; r < 12 && !best; r += 0.1) for (let i = 0, n = Math.max(1, Math.round(r * 20)); i < n; i++) { const a = i / n * 2 * Math.PI, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const g = surf(li, px, pz, 1e9, 1e9).g; if (A.trackDist(LVS()[li], px, pz, 1) < 0.45) continue; if (!why(li, px, pz, g, boxes)) { best = [px, pz, g]; break; } }
  if (!best) return false; if (A.getMode() !== 'ped') { st.placing = true; try { A.setMode('ped'); } finally { st.placing = false; } }
  st.lv = li; st.feet = surf(li, best[0], best[1], best[2] + 0.01, 1e9).g; st.vy = 0; st.ground = true; st.eyeY = st.feet + PED.eye; v.x = v.z = 0; st.hv = [0, 0];
  cam.position.set(best[0], st.eyeY, best[1]); cam.up.set(0, 1, 0); const e = new T.Euler(0, 0, 0, 'YXZ'); e.setFromQuaternion(cam.quaternion, 'YXZ');
  if (yaw != null) e.y = yaw + Math.PI; e.x = -0.04; e.z = 0; cam.quaternion.setFromEuler(e); st.placed = true; return true;
};
FP.flyTo = function (li, x, z) { if (A.getMode() !== 'fly') A.setMode('fly'); const o = LVS()[li], y = terr(o, x, z); cam.position.set(x, y + 3.5, z + 6); cam.up.set(0, 1, 0); cam.lookAt(x, y + 0.3, z); v.x = v.y = v.z = 0; return true; };
// ------------------------------------------------------------------ per-frame update
FP.update = function (dt, m) { if (m === 'fly') fly(dt); else if (m === 'ped') ped(dt); shadowFollow(m); hudTick(dt, m); };
const _f = { x: 0, y: 0, z: 0 };
function fly(dt) {
  const k = K(), d = new T.Vector3(); cam.getWorldDirection(d); const rx = -d.z, rz = d.x, rl = Math.hypot(rx, rz) || 1;
  let mx = 0, my = 0, mz = 0; const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), u = (k.Space || k.KeyE || k.PageUp ? 1 : 0) - (k.KeyC || k.KeyQ || k.PageDown ? 1 : 0);
  mx = d.x * f + rx / rl * s; my = d.y * f + u; mz = d.z * f + rz / rl * s; const ml = Math.hypot(mx, my, mz);
  const spd = FLY.spd * (k.ShiftLeft || k.ShiftRight ? FLY.boost : 1) * (k.KeyZ ? FLY.slow : 1);
  const tx = ml ? mx / ml * spd : 0, ty = ml ? my / ml * spd : 0, tz = ml ? mz / ml * spd : 0, a = 1 - Math.exp(-dt * (ml ? FLY.acc : FLY.acc * 1.3));
  v.x += (tx - v.x) * a; v.y += (ty - v.y) * a; v.z += (tz - v.z) * a; if (!ml && Math.hypot(v.x, v.y, v.z) < 1e-4) v.x = v.y = v.z = 0;
  const p = cam.position, nx = p.x + v.x * dt, ny = p.y + v.y * dt, nz = p.z + v.z * dt; const r = flyClamp(p.x, p.y, p.z, nx, ny, nz); p.set(r[0], r[1], r[2]);
  const R = A.room; p.x = Math.max(R[0] - 400, Math.min(R[2] + 400, p.x)); p.z = Math.max(R[1] - 400, Math.min(R[3] + 400, p.z)); p.y = Math.max(-20, Math.min(400, p.y));
  // near plane: tiny when close to the scenery so a model an inch (or 1/20 in) away is not clipped; larger far away to keep depth precision
  const c = clearance(p); setNear(c < 1.5 ? 0.008 : c < 6 ? 0.02 : c < 30 ? 0.05 : 0.1); st.clear = c;
}
function clearance(p) { let c = 1e9; for (const o of LVS()) if (A.onBoard(o, p.x, p.z)) { const t = terr(o, p.x, p.z), b = o.deck - thick(o); c = Math.min(c, p.y >= t ? p.y - t : p.y <= b ? b - p.y : 0); } return c; }
function flyClamp(x0, y0, z0, x, y, z) {   // decks are solid unless pass-through (X)
  if (FLY.pass) return [x, y, z]; const m = FLY.margin;
  for (const o of LVS()) { const on1 = A.onBoard(o, x, z); if (!on1) continue; const top = terr(o, x, z) + m, bot = o.deck - thick(o) - m;
    if (y > bot && y < top) { const on0 = A.onBoard(o, x0, z0);
      if (!on0) return [x0, y, z0];   // flying into the fascia / deck edge from the side: stop horizontally
      if (y0 >= (terr(o, x0, z0) + m) - 0.25 || y0 >= (bot + top) / 2) y = top; else y = bot; } }
  return [x, y, z];
}
FP.flyClamp = flyClamp;
function ped(dt) {
  const k = K(), li = st.lv, o = LVS()[li]; if (!o) return; index(li);
  const d = new T.Vector3(); cam.getWorldDirection(d); d.y = 0; const dl = Math.hypot(d.x, d.z) || 1; d.x /= dl; d.z /= dl;
  const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  let mx = d.x * f - d.z * s, mz = d.z * f + d.x * s; const ml = Math.hypot(mx, mz); st.crouch += ((k.KeyC ? 1 : 0) - st.crouch) * (1 - Math.exp(-dt * 10));
  const spd = (k.ShiftLeft || k.ShiftRight ? PED.run : PED.walk) * (k.KeyC ? 0.5 : 1); if (ml) { mx = mx / ml * spd; mz = mz / ml * spd; }
  const a = 1 - Math.exp(-dt * (st.ground ? 9 : 1.5)); st.hv[0] += (mx - st.hv[0]) * a; st.hv[1] += (mz - st.hv[1]) * a;
  const boxes = carBoxes(li), p = cam.position; let x = p.x, z = p.z; st.blocked = null;
  const tryMove = (nx, nz) => { const w = why(li, nx, nz, st.feet, boxes); if (!w) { x = nx; z = nz; return true; } st.blocked = w; return false; };
  const ddx = st.hv[0] * dt, ddz = st.hv[1] * dt;
  if (ddx || ddz) { if (!tryMove(x + ddx, z + ddz)) { if (!tryMove(x + ddx, z)) { if (!tryMove(x, z + ddz)) { st.hv[0] *= 0.3; st.hv[1] *= 0.3; } } } }
  for (const b of boxes) { const q = inBox(b, x, z, PED.r); if (q) { const c = Math.cos(b[2]), sn = Math.sin(b[2]), side = q[1] >= 0 ? 1 : -1, w = side * (b[4] + PED.r + 0.01);   // a moving car/train shoves you aside
    const nx = b[0] + q[0] * c - w * sn, nz = b[1] + q[0] * sn + w * c; if (!why(li, nx, nz, st.feet, boxes.filter(bb => bb !== b))) { x = nx; z = nz; } st.blocked = 'pushed'; } }
  if (k.Space && st.ground && !st.jumpHeld) { st.vy = PED.jump; st.ground = false; } st.jumpHeld = !!k.Space;
  const lim = st.feet + (A.trackDist(o, x, z, 1) < 0.75 ? PED.stepTrack : PED.step), g = surf(li, x, z, lim, 1e9).g;
  st.vy -= PED.g * dt; st.feet += st.vy * dt; if (st.feet <= g) { st.feet = g; st.vy = 0; st.ground = true; } else st.ground = st.feet - g < 0.002;
  const eye = st.feet + PED.eye - (PED.eye - PED.crouch) * st.crouch; st.eyeY += (eye - st.eyeY) * (eye > st.eyeY ? 1 - Math.exp(-dt * 18) : 1); st.eyeY = Math.max(st.eyeY, st.feet + PED.crouch * 0.9);
  p.set(x, st.eyeY, z); setNear(PED.near); st.speedMph = Math.hypot(st.hv[0], st.hv[1]) / IN_MPH;
}
FP.wheel = function (dy) { FLY.spd = Math.max(FLY.min, Math.min(FLY.max, FLY.spd * (dy < 0 ? 1.25 : 0.8))); st.hudT = 0; hudShow('fly'); };
FP.key = function (code) { if (code === 'KeyX') { FLY.pass = !FLY.pass; hudShow('fly'); return true; } return false; };
FP.state = () => ({ mode: A.getMode(), lv: st.lv, feet: st.feet, eye: cam.position.y - st.feet, pos: [cam.position.x, cam.position.y, cam.position.z], v: [v.x, v.y, v.z], hv: st.hv.slice(), ground: st.ground, blocked: st.blocked, near: cam.near, fov: cam.fov, spd: FLY.spd, pass: FLY.pass, clear: st.clear, mph: st.speedMph, idxMs: st.idx.map(i => i && i.ms) });
// ------------------------------------------------------------------ shadows: in Fly/Ped a tight sun frustum follows the camera (crisp close-up shadows)
function shadowFollow(m) {
  const sun = A.sun; if (!sun || !(A.shadowsOn ? A.shadowsOn() : A.renderer.shadowMap.enabled)) return; const sc = sun.shadow.camera;
  if (!st.shadowSaved) st.shadowSaved = { p: sun.position.clone(), t: sun.target.position.clone(), b: [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far] };
  const c = m === 'ped' ? 0 : Math.max(0, st.clear || 0), R = m === 'ped' ? 9 : Math.max(10, Math.min(110, 6 + c * 1.6)), d = new T.Vector3(); cam.getWorldDirection(d);
  const fl = Math.hypot(d.x, d.z) || 1, ahead = m === 'ped' ? R * 0.55 : Math.min(R * 0.5, c * 0.8 + 2), sz = sun.shadow.mapSize.x || 1024, tex = 2 * R / sz;
  let fx = cam.position.x + d.x / fl * ahead, fz = cam.position.z + d.z / fl * ahead; fx = Math.round(fx / tex) * tex; fz = Math.round(fz / tex) * tex;
  const lv = m === 'ped' ? LVS()[st.lv] : LVS().reduce((b, o) => (o.deck <= cam.position.y + 1 ? o : b), LVS()[0]), fy = lv ? lv.deck : cam.position.y;
  const off = (L3D.ambience && L3D.ambience.sunOff ? L3D.ambience.sunOff() : st.shadowSaved.p.clone().sub(st.shadowSaved.t)).normalize().multiplyScalar(R * 2 + 30);
  sun.target.position.set(fx, fy, fz); sun.position.set(fx + off.x, fy + off.y, fz + off.z); sun.target.updateMatrixWorld();
  if (sc.right !== R) { sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = R * 4 + 80; sc.updateProjectionMatrix(); }
  sun.shadow.normalBias = m === 'ped' ? 0.004 : 0.01; sun.shadow.bias = -0.0002;
}
function shadowReset() { const s = st.shadowSaved, sun = A.sun; if (!s || !sun) return; const sc = sun.shadow.camera; sun.position.copy(s.p); sun.target.position.copy(s.t); if (L3D.ambience && L3D.ambience.sunOff) sun.position.copy(s.t).add(L3D.ambience.sunOff()); sun.target.updateMatrixWorld();
  [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far] = s.b; sc.updateProjectionMatrix(); sun.shadow.normalBias = 0.02; sun.shadow.bias = -0.0004; st.shadowSaved = null; }
function autoShadows(on) {   // Pedestrian view switches sun shadows on (tight frustum = cheap) unless ?q=low or ?shadows=0; restores your setting on exit
  const q = new URLSearchParams(location.search); if (q.get('q') === 'low' || q.get('shadows') === '0') return;
  if (on) { if (!(A.shadowsOn ? A.shadowsOn() : A.renderer.shadowMap.enabled)) { st.autoSh = true; A.setShadows(true); } } else if (st.autoSh) { st.autoSh = false; A.setShadows(false); } }
// ------------------------------------------------------------------ HUD line
let H = null;
function hud() { H = document.createElement('div'); H.id = 'fphud'; H.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(12,16,22,.78);color:#e8eef5;font:12px system-ui;padding:5px 12px;border-radius:14px;z-index:15;pointer-events:none;display:none;white-space:nowrap'; document.body.appendChild(H); }
function hudShow(m) { if (!H) return; H.style.display = m === 'fly' || m === 'ped' ? 'block' : 'none'; st.hudT = 0; hudTick(0, m); }
function hudTick(dt, m) { if (!H || (m !== 'fly' && m !== 'ped')) return; st.hudT += dt; if (st.hudT > 0 && st.hudT - dt > 0 && Math.floor(st.hudT * 4) === Math.floor((st.hudT - dt) * 4)) return;
  const ui = document.getElementById('ui'); H.style.visibility = (ui && ui.style.display === 'none') || document.body.classList.contains('l3d-hideui') ? 'hidden' : 'visible';
  if (m === 'fly') H.innerHTML = `<b>Fly</b> · speed ${FLY.spd < 1 ? FLY.spd.toFixed(2) : FLY.spd.toFixed(1)} in/s (wheel / + −) · Shift boost · hold Z precision · Space/E up · C/Q down · X decks: <b style="color:${FLY.pass ? '#fb5' : '#8d8'}">${FLY.pass ? 'pass-through' : 'solid'}</b>`;
  else H.innerHTML = `<b>Pedestrian</b> 1:160 · eye 5.5 ft · ${(st.speedMph || 0).toFixed(1)} mph · W A S D walk · Shift run · Space jump · C crouch · M map: click to go${st.blocked && st.blocked !== 'pushed' ? ` · <span style="color:#fb5">blocked: ${st.blocked}</span>` : ''}`; }
})();
// [FLYPED] a sidewalk spot on the main street (longest public road, "Main"/"Front" preferred): [level, x, z, yaw along the road]
(function () { const FP = window.L3D.flyped;
  FP.streetSpot = function () { const A = FP._A(); if (!A) return null; let best = null, bs = -1;
    A.LV.forEach((o, li) => { for (const r of o.L.roads || []) { if (!r.pts || r.pts.length < 2 || r.kind === 'over' || /drive|lane|alley|lot|loop/i.test(r.name || '')) continue; let L = 0; for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      const sc = L * (/main|front|market|depot/i.test(r.name || '') ? 3 : 1); if (sc > bs) { bs = sc; best = { li, r, L }; } } });
    if (!best) return null; const P = best.r.pts, o = A.LV[best.li], at = s0 => { let s = s0; for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (s <= l || i === P.length - 1) { const f = Math.min(1, s / (l || 1)), dx = (P[i][0] - P[i - 1][0]) / (l || 1), dz = (P[i][1] - P[i - 1][1]) / (l || 1); return [P[i - 1][0] + f * (P[i][0] - P[i - 1][0]), P[i - 1][1] + f * (P[i][1] - P[i - 1][1]), dx, dz]; } s -= l; } };
    // most "downtown" sidewalk spot along it: many buildings within 8 in, none closer than 0.8 in, away from the deck edge; look along the street
    let pick = null, ps = -1e9; for (let f = 0.15; f <= 0.85; f += 0.05) for (const side of [1, -1]) { const [x0, z0, dx, dz] = at(best.L * f), off = side * ((best.r.w || 1.2) / 2 + 0.16), x = x0 - dz * off, z = z0 + dx * off;
      if (!A.onBoard(o, x, z, 1.5)) continue; let n = 0, close = false; for (const st2 of o.L.structures) { const q = st2.r, cx = Math.max(q[0], Math.min(q[2], x)), cz = Math.max(q[1], Math.min(q[3], z)), d = Math.hypot(cx - x, cz - z); if (d < 0.8) close = true; if (d < 8) n++; }
      const sc = n - (close ? 50 : 0) - Math.abs(f - 0.5) * 2; if (sc > ps) { ps = sc; pick = [best.li, x, z, Math.atan2(dx, dz)]; } }
    if (pick) { let fw = 0; const fx = Math.sin(pick[3]), fz = Math.cos(pick[3]); for (const st2 of o.L.structures) { const q = st2.r, cx = (q[0] + q[2]) / 2 - pick[1], cz = (q[1] + q[3]) / 2 - pick[2], d = Math.hypot(cx, cz); if (d < 20) fw += Math.sign(cx * fx + cz * fz); } if (fw < 0) pick[3] += Math.PI; }   // face the busier way
    return pick; };
})();
