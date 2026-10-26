/* autoramp.js — realistic END-loading autorack facility (Riverton vehicle lot), per plan.  v3 2026-10-15 (height-adjustable steel ramp, matches the printable design in reference/autoramp-print/)
   Prototype: autoracks spotted on a STUB track, car end against a fixed ramp; end doors open, steel bridge plates span car gaps, drivers
   drive vehicles straight through the cut and straight down the ramp; off the ramp they need a level run-off, then swing into the lot aisle.
   (UP "How to load and unload rail cars"; AAR Quality Review TAG; NS auto facility guide; see reference/autoramp-end-loading-notes.md.)
   Track geometry unchanged (ramp is beyond the existing Kato 20-048 bumper) -> spur capacity unchanged (5 autoracks each plan).
   Geometry (N 1:160, inches): ramp 12 ft wide (0.90), fixed concrete slope 1:8, top lip 4 ft at A-deck (~42 in above railhead),
   level run-off 18 ft (1.35) in line with the track centreline, then a turning apron: 12 ft lane (0.90), outer turning radius 20 ft (1.50).
   Phase 1 (before viewer.js): scenery edits in window.LAYOUT + CLEARANCE CHECK (window.__autoramp.clearance; console.error on any hit).
   Phase 2 (after __layout3d.ready): procedural ramp, bridge plate, flush paving, portable ramp, gate arm; ?autoramp=debug draws the swept path.
   ?autoramp=0 disables. */
'use strict';
(function () {
const D = window.LAYOUT, MODE = new URLSearchParams(location.search).get('autoramp'); if (!D || MODE === '0') return;
const S = 1 / 160, FT = 12 * S, MM = 1 / 25.4;
const RT = (4.4 + 0.9 + 2.03) * MM;                // Kato roadbed + tie + rail = railhead above deck (matches track.js)
// Height-adjustable steel end ramp (Buck-loader / portable multi-level ramp type): hinged steel deck from a toe on the lot up to a level
// platform on a notched support tower at the car end; the tower pins at the bottom (A), tri-level middle (B3), bi-level upper (B2) or
// tri-level top (C3) deck. Same dims as the printed model (autoramp-print/): deck 90 mm, platform 12 mm, width 23 mm (12 ft).
const DECKS = { A: 42, B3: 111, B2: 128, C3: 179 };   // deck floor above railhead, real inches [EST from BNSF tri-level / Greenbrier bi-level clear heights + ~6 in decks]
const DSEL = (new URLSearchParams(location.search).get('autoramp_deck') || 'A').toUpperCase(), DK = DECKS[DSEL] ? DSEL : 'A';
const DECKLEN = 90 * MM, PLAT = 12 * MM;
const RISE = RT + DECKS[DK] * S, RISE_A = RT + DECKS.A * S;   // lot grade -> selected deck floor (Kato railhead is 7.33 mm above the lot/foam top)
const HORIZ = Math.sqrt(DECKLEN * DECKLEN - RISE * RISE), HORIZ_A = Math.sqrt(DECKLEN * DECKLEN - RISE_A * RISE_A);   // footprint = A pose (longest)
const LANE = 12 * FT, ROUT = 20 * FT, HALF = LANE / 2, RC = ROUT - HALF;   // RC = lane-centre turning radius
const FACE = 0.12;  // FACE = gap bumper -> ramp face (Kato bumper body)
const CFG = {
  'best-version': { lv: 2, runoffFt: 18, tx: 11.582, by: 19.5, aisleX: 15.25, lotY: 16.4, paveTo: 26.0, paveX: [10.9, 12.15],
    lots: [[10.95, 11.6, 16.3, 22.3]],
    fences: [[[10.7, 19.3], [10.7, 11.3], [17.95, 11.3], [17.95, 54.7], [12.2, 54.7], [12.2, 19.8]]],
    dropFence: f => Math.abs(f.pts[0][0] - 12.2) < 0.01 && Math.abs(f.pts[0][1] - 19.8) < 0.01,
    shack: [15.75, 53.4, 16.35, 53.95], gateArm: [15.0, 54.6], portable: null,
    rows: { x0: 13.1, x1: 17.4, y0: 16.7, y1: 22.0 } },
  'fresh-start-rev36': { lv: 2, runoffFt: 16, tx: 3.738, by: 20.5, aisleX: 7.6, lotY: 21.0, paveTo: 27.5, paveX: [2.9, 4.6],
    lots: [[3.05, 16.6, 10.6, 21.0], [3.3, 14.4, 4.6, 16.6], [3.45, 13.75, 4.6, 14.4], [4.6, 12.0, 10.6, 16.6]],   // >= 0.6 in off the L2 main curve (x 1.8 -> NE)
    fenceAlongMain: { off: 0.68, y0: 11.9, y1: 28.0, northY: 11.8, eastX: 10.7 },   // chain-link 0.68 in (9 ft) off the main CL, inside the curve
    fences: [[[10.7, 11.8], [10.7, 55.0]]],
    dropFence: f => Math.abs(f.pts[0][0] - 4.5) < 0.01 || (Math.abs(f.pts[0][0] - 10.7) < 0.01 && Math.abs(f.pts[0][1] - 56.6) > 0.01 && f.pts[0][1] < 30),
    dropDitch: l => l.kind === 'ditch' && Math.abs(l.pts[0][0] - 3.05) < 0.01, shack: [9.55, 54.15, 10.15, 54.75], gateArm: [10.5, 55.8],
    portable: null, rows: { x0: 8.75, x1: 10.2, y0: 13.2, y1: 20.6 } },
  /* [R36] ROOT CAUSE of the missing REVIEW6 ramp: CFG had no 'rev4-fresh-detail' entry, so autoramp.js returned at load (r34 had retired the glb ramp prop
     in export_plan in favour of this procedural ramp). W-1 (L2) ends at the Kato bumper (9.644, 25.6) heading -y into the RVD lot r[5,14.5,15.9,22.4]. */
  'rev4-fresh-detail': { lv: 2, runoffFt: 14, tx: 9.644, by: 25.6, aisleX: 12.0, lotY: 21.9, paveTo: 25.6, paveX: [9.0, 10.3],
    lots: [[9.0, 19.0, 12.7, 22.4]], fences: [], dropFence: f => false, shack: [13.7, 16.0, 14.7, 17.0], noShack: true, gateArm: [13.4, 16.5],
    portable: null, rows: { x0: 12.9, x1: 15.4, y0: 17.6, y1: 21.8 } },
};
const C = CFG[D.name]; if (!C) return; const L = D.levels.find(l => l.id === C.lv); if (!L) return;
const RUNOFF = C.runoffFt * FT, W = 23 * MM;
// ---- swept path (plan coords; ramp heads -y from the bumper). Vehicles unloading drive this forward; loading drives it in reverse.
const face = C.by - FACE, platEnd = face - PLAT, foot = platEnd - HORIZ_A, runEnd = foot - RUNOFF;
const c1 = [C.tx + RC, runEnd], y2 = runEnd - RC, c2 = [C.aisleX - RC, runEnd];
const arc = (c, a0, a1, n = 16) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [c[0] + RC * Math.cos(a), c[1] + RC * Math.sin(a)]; });
if (c2[0] < c1[0] - 1e-6) console.error('autoramp: aisle too close to the ramp for two 20 ft turns');
const PATH = [[C.tx, face], [C.tx, runEnd], ...arc(c1, Math.PI, 1.5 * Math.PI).slice(1), ...arc(c2, 1.5 * Math.PI, 2 * Math.PI).slice(1), [C.aisleX, Math.max(C.lotY, runEnd + 0.5)]];
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const pathD = p => { let d = 1e9; for (let i = 0; i + 1 < PATH.length; i++) d = Math.min(d, segD(p, PATH[i], PATH[i + 1])); return d; };
const inArcBand = (p, c, qx, qy) => { const dx = p[0] - c[0], dy = p[1] - c[1], r = Math.hypot(dx, dy); return dx * qx >= -0.05 && dy * qy >= -0.05 && r <= ROUT + 0.05 && r >= RC - HALF - 0.05; };
const inEnv = (x, y, m = 0) => { const p = [x, y];
  if (Math.abs(x - C.tx) <= W / 2 + 0.06 + m && y <= C.by + 0.05 && y >= runEnd - 0.05) return true;          // ramp + in-line run-off (curbs incl.)
  if (pathD(p) <= HALF + 0.08 + m) return true;                                                              // 12 ft lane (+1 ft)
  return inArcBand(p, c1, -1, -1) || inArcBand(p, c2, 1, -1); };                                             // outer body corners on the 20 ft turns
const ENV_BOX = [Math.min(C.tx - W / 2, c1[0] - ROUT) - 0.1, runEnd - ROUT - 0.1, Math.max(C.aisleX + HALF, c2[0] + ROUT) + 0.1, C.by + 0.1];
// ---- phase 1: scenery edits
const clip = ln => { const out = []; let cur = []; const P = []; for (let i = 0; i + 1 < ln.pts.length; i++) { const a = ln.pts[i], b = ln.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1)); for (let k = 0; k < n; k++) P.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } P.push(ln.pts[ln.pts.length - 1]);
  for (const p of P) { if (inEnv(p[0], p[1], 0.15)) { clip.hit = true; if (cur.length > 1) out.push(cur); cur = []; } else cur.push(p); } if (cur.length > 1) out.push(cur);
  return out.map(pts => Object.assign({}, ln, { pts })); };
const removed = { trees: 0, vehicles: 0, people: 0, lamps: 0, lines: 0, gates: 0, structures: 0 };
C.lots.forEach(r => L.lots.push({ name: 'auto ramp run-off + turning apron (paved) [autoramp.js]', r, kind: 'parking' }));
L.lots.forEach(l => { if (/vehicle lot 6 x|auto unloading lot/i.test(l.name)) { l.kind = 'parking'; l.name += ' (VIN storage rows; no side loading)'; } });
L.lines = L.lines.filter(l => !(l.kind === 'fence' && C.dropFence(l)) && !(C.dropDitch && C.dropDitch(l)));
C.fences.forEach(p => L.lines.push({ kind: 'chain', pts: p }));
if (C.fenceAlongMain) { const F = C.fenceAlongMain, mp = L.tracks.filter(t => t.type === 'main').flatMap(t => t.pts).filter(p => p[0] < 14 && p[1] >= F.y0 - 0.5 && p[1] <= F.y1 + 0.5);
  mp.sort((a, b) => b[1] - a[1]); const out = [];
  for (let i = 0; i < mp.length; i += 3) { const a = mp[Math.max(0, i - 1)], b = mp[Math.min(mp.length - 1, i + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; let nx = -ty / l, ny = tx / l; if (nx + ny < 0) { nx = -nx; ny = -ny; }
    const q = [mp[i][0] + nx * F.off, mp[i][1] + ny * F.off]; if (q[1] >= F.northY && q[1] <= F.y1) out.push(q); }
  out.push([out[out.length - 1][0] + 0.3, F.northY], [F.eastX, F.northY]); L.lines.push({ kind: 'chain', pts: out }); }
const nl = []; for (const ln of L.lines) { if (ln.kind === 'poles') { nl.push(ln); continue; } clip.hit = false; const parts = clip(ln); if (clip.hit) { removed.lines++; nl.push(...parts); } else nl.push(ln); } L.lines = nl;
if (!C.noShack) L.structures.push({ name: 'auto lot guard shack + gate [autoramp.js]', r: C.shack, color: '#e8e4dc', h: 9 * FT + 0.07, kind: 'minor', roof: 'flat', sign: '', dock: false, minor: true });
const P = C.portable, PL = 40 * FT, portR = P ? [P.x - 0.5, P.y - PL / 2 - 0.1, P.x + 0.5, P.y + PL / 2 + 0.1] : null;
const inPort = (x, y, m = 0) => portR && x > portR[0] - m && x < portR[2] + m && y > portR[1] - m && y < portR[3] + m;
const inShack = (x, y, m = 0) => x > C.shack[0] - m && x < C.shack[2] + m && y > C.shack[1] - m && y < C.shack[3] + m;
const vCorners = v => { const c = Math.cos(v.a), s = Math.sin(v.a), l = (v.l || 1.1) / 2, w = (v.w || 0.46) / 2; return [[l, w], [l, -w], [-l, w], [-l, -w], [0, 0]].map(([a, b]) => [v.x + a * c - b * s, v.y + a * s + b * c]); };
const vHit = v => vCorners(v).some(p => inEnv(p[0], p[1]) || inPort(p[0], p[1]) || inShack(p[0], p[1], 0.1));
const filt = (k, f) => { const n = L[k].length; L[k] = L[k].filter(f); removed[k] += n - L[k].length; };
filt('trees', t => !inEnv(t.x, t.y, (t.r || 0.4) * 0.8) && !inPort(t.x, t.y, 0.3));
filt('vehicles', v => !vHit(v));
filt('people', p => !inEnv(p[0] ?? p.x, p[1] ?? p.y));
filt('lamps', p => !inEnv(p[0] ?? p.x, p[1] ?? p.y, 0.1));
filt('gates', g => !inEnv(g.x, g.y, 0.1));
// new vehicles on the apron (car axis along x like the plan rows; 9 x 20 ft stalls), only outside the envelope
const R = C.rows; let k = 0;
for (let y = R.y0; y <= R.y1; y += 0.62) for (let x = R.x0; x <= R.x1; x += 1.25) { const kind = (k++ % 4 === 3) ? 'pickup' : 'car', v = { kind, x, y, a: Math.PI, l: kind === 'pickup' ? 1.3 : 1.1, w: 0.46 };
  if (vHit(v) || L.vehicles.some(o => Math.abs(o.x - x) < 1.2 && Math.abs(o.y - y) < 0.55)) continue; L.vehicles.push(v); }
L.labels.push({ x: C.tx + 1.5, y: foot, text: `height-adjustable steel end ramp at the bumper (set to deck ${DK}); in-line ${C.runoffFt} ft run-off; 20 ft turning apron`, kind: 'life' });
// ---- clearance check: any scenery object inside ramp + run-off + turning envelope = FAIL
function clearance() { const hits = [];
  L.trees.forEach(t => { if (inEnv(t.x, t.y, (t.r || 0.4) * 0.5)) hits.push('tree ' + t.x + ',' + t.y); });
  L.vehicles.forEach(v => { if (vCorners(v).some(p => inEnv(p[0], p[1]))) hits.push('vehicle ' + v.x + ',' + v.y); });
  L.people.forEach(p => { const x = p[0] ?? p.x, y = p[1] ?? p.y; if (inEnv(x, y)) hits.push('person ' + x + ',' + y); });
  L.lamps.forEach(p => { const x = p[0] ?? p.x, y = p[1] ?? p.y; if (inEnv(x, y)) hits.push('lamp ' + x + ',' + y); });
  L.gates.forEach(g => { if (inEnv(g.x, g.y)) hits.push('gate ' + g.x + ',' + g.y); });
  L.structures.forEach(s => { const r = s.r; for (let x = r[0]; x <= r[2]; x += 0.1) for (let y = r[1]; y <= r[3]; y += 0.1) if (inEnv(x, y)) { hits.push('structure ' + (s.name || r.join(','))); return; } });
  L.lines.forEach(ln => { if (ln.kind === 'poles' || ln.kind === 'wire') return; for (let i = 0; i + 1 < ln.pts.length; i++) { const a = ln.pts[i], b = ln.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let j = 0; j <= n; j++) { const x = a[0] + (b[0] - a[0]) * j / n, y = a[1] + (b[1] - a[1]) * j / n; if (inEnv(x, y)) { hits.push(ln.kind + ' line @' + x.toFixed(2) + ',' + y.toFixed(2)); return; } } } });
  if (portR) for (let x = portR[0]; x <= portR[2]; x += 0.1) for (let y = portR[1]; y <= portR[3]; y += 0.1) if (inEnv(x, y)) { hits.push('portable ramp'); x = 1e9; break; }
  L.tracks.forEach(t => { if (portR && t.pts.some(p => p[0] > portR[0] - 0.5 && p[0] < portR[2] + 0.5 && p[1] > portR[1] && p[1] < portR[3])) hits.push('portable ramp on track'); });
  // the envelope must stay on the benchwork and off other tracks
  const onB = (x, y) => L.boards.some(r => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
  for (let x = ENV_BOX[0]; x <= ENV_BOX[2]; x += 0.1) for (let y = ENV_BOX[1]; y <= ENV_BOX[3]; y += 0.1) if (inEnv(x, y) && !onB(x, y)) { hits.push('off benchwork @' + x.toFixed(1) + ',' + y.toFixed(1)); x = 1e9; break; }
  // other tracks: track centreline must be >= 8 ft 6 in (0.64 in, standard lateral clearance) from the envelope (lane edge + 1 ft); the chain-link fence sits in that gap
  let minTrk = 99; L.tracks.forEach(t => { if (t.pts.some(p => Math.abs(p[0] - C.tx) < 0.05 && Math.abs(p[1] - C.by) < 0.6)) return; for (const p of t.pts) { if (p[0] < ENV_BOX[0] - 3 || p[0] > ENV_BOX[2] + 3 || p[1] < ENV_BOX[1] - 3 || p[1] > ENV_BOX[3] + 3) continue;
    for (let m = 0; m <= 2; m += 0.02) if (inEnv(p[0], p[1], m)) { minTrk = Math.min(minTrk, m); break; } } });
  if (minTrk < 0.64) hits.push('track CL only ' + minTrk.toFixed(2) + ' in (' + (minTrk * 160 / 12).toFixed(1) + ' ft) from envelope; need 0.64 in (8.5 ft)');
  return { pass: hits.length === 0, hits, removed, trackCLclear_in: +minTrk.toFixed(2), trackCLclear_ft: +(minTrk * 160 / 12).toFixed(1), envelope: ENV_BOX.map(v => +v.toFixed(2)), geometry: { ramp: 'adjustable steel, deck ' + DK, slopeAtDeck: '1:' + (HORIZ / RISE).toFixed(1), slopeA: '1:' + (HORIZ_A / RISE_A).toFixed(1), runoff_ft: C.runoffFt, face, platEnd, foot, runEnd, outerTurnYmin: +(runEnd - ROUT).toFixed(2), rise_in: +RISE.toFixed(3) } }; }
const CL = clearance(); if (!CL.pass) console.error('autoramp clearance FAIL', JSON.stringify(CL.hits)); else console.log('autoramp clearance PASS', JSON.stringify(CL));
window.__autoramp = { plan: D.name, cfg: C, path: PATH, clearance: CL, inEnv };
// ---- phase 2: meshes
function build() {
  const ST = window.__layout3d, scene = ST.scene, g = scene.getObjectByName('L' + C.lv) || scene, K = L3D.kato;
  const y0 = L.deck, top = y0 + RISE;
  const M = c => new THREE.MeshLambertMaterial({ color: c }), conc = M('#bdb8ae'), steel = M('#6f7378'), yel = M('#e8b81a'), asph = M('#4e4f51'), dark = M('#2a2a2a');
  const add = (geo, m, x, y, z, rx = 0, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; parent.add(o); return o; };
  const SL = HORIZ, ang = Math.atan2(RISE, HORIZ), toe = platEnd - HORIZ, D2 = 0.6 * MM;
  /* [WIRE 2026-10-16] struct-autorack-adjustable-ramp.glb (grok-sim batch 3) replaces the procedural tower/deck/plate when ingested: its -Z end
     (bridge plate tip) is turned to face the car (+plan y) and set 56 in past the ramp face; paving, run-off dashes and gate arm stay procedural */
  const XR = 'struct-autorack-adjustable-ramp', XE = false && L3D.ext && L3D.ext.has && L3D.ext.has(XR);   /* [R34] glb retired: its tower cross-members and screw-jack bars crossed the drive lane (REVIEW5); procedural end ramp below */
  if (XE) { const bb = new THREE.Box3().setFromObject(L3D.ext.scenes[XR]), tip = face + 56 * S;
    L3D.ext.instance(g, XR, [new THREE.Matrix4().compose(new THREE.Vector3(C.tx, y0, tip + bb.min.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), new THREE.Vector3(1, 1, 1))]); window.__autoramp.glb = true; }
  if (!XE) {
  // level platform on the car end + notched tower (2 posts each side, pin at the selected deck), steel tread deck hinged at the platform, toe wheels
  add(new THREE.BoxGeometry(W, 0.6 * MM * 2, PLAT), steel, C.tx, top - 0.6 * MM, face - PLAT / 2);
  for (const sx of [-1, 1]) for (const z of [face - 1.5 * MM, platEnd + 1.5 * MM]) {
    const ph = top - y0 + 42 * S;   /* [R34] side posts end at guard-rail height (42 in) above the platform; nothing spans the lane */ add(new THREE.BoxGeometry(2 * MM, ph, 2 * MM), yel, C.tx + sx * (W / 2 - 1 * MM), y0 + ph / 2, z);
  }
  add(new THREE.BoxGeometry(W + 2 * MM, 1.5 * MM, PLAT + 2 * MM), steel, C.tx, y0 + 0.75 * MM, face - PLAT / 2);    // tower base frame
  const deck = new THREE.Group(); deck.position.set(C.tx, top - 1.2 * MM, platEnd); deck.rotation.x = -ang; g.add(deck);   // local -z runs down the deck
  add(new THREE.BoxGeometry(W, 1.2 * MM, DECKLEN), steel, 0, 0, -DECKLEN / 2, 0, deck);
  /* [R34] solid deck (no transverse ribs); guard rails = side posts + top/mid rails on the two edges only */
  for (const sx of [-1, 1]) { for (let z = 0; z <= DECKLEN + 1e-6; z += DECKLEN / 4) add(new THREE.BoxGeometry(0.8 * MM, 42 * S, 0.8 * MM), yel, sx * (W / 2 - 0.4 * MM), 21 * S, -z, 0, deck);
    for (const hh of [21, 42]) add(new THREE.BoxGeometry(0.8 * MM, 0.8 * MM, DECKLEN), yel, sx * (W / 2 - 0.4 * MM), hh * S, -DECKLEN / 2, 0, deck); }
  for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.8 * MM, 2.5 * MM, DECKLEN), yel, sx * (W / 2 - 0.4 * MM), 1.8 * MM, -DECKLEN / 2, 0, deck);
    const w = add(new THREE.CylinderGeometry(1.6 * MM, 1.6 * MM, 1.2 * MM, 10), dark, C.tx + sx * (W / 2 - 1.5 * MM), y0 + 1.6 * MM, toe + 2 * MM); w.rotation.z = Math.PI / 2; }
  add(new THREE.BoxGeometry(8.5 * FT, 0.4 * MM, 56 * S + FACE), steel, C.tx, top + 0.2 * MM, face + (56 * S + FACE) / 2 - 0.02);   // 56 in bridge plate to the end door
  }   // [WIRE] end of procedural ramp (no glb)
  for (let z = foot; z > runEnd; z -= 0.45) add(new THREE.BoxGeometry(0.04, 0.003, 0.22), M('#e8e8e8'), C.tx, y0 + 0.016, z - 0.11);   // lane centre dashes on run-off
  // flush paving: the stub track runs into the lot (asphalt up to just under the railhead)
  const G2 = K.GAUGE / 2, pl = C.paveTo - C.by, pc = (C.by + C.paveTo) / 2, pt = RT - 0.006;
  add(new THREE.BoxGeometry(K.GAUGE - 0.05, pt, pl), asph, C.tx, y0 + pt / 2, pc);
  add(new THREE.BoxGeometry(C.tx - G2 - 0.025 - C.paveX[0], pt, pl), asph, (C.paveX[0] + C.tx - G2 - 0.025) / 2, y0 + pt / 2, pc);
  add(new THREE.BoxGeometry(C.paveX[1] - (C.tx + G2 + 0.025), pt, pl), asph, (C.paveX[1] + C.tx + G2 + 0.025) / 2, y0 + pt / 2, pc);
  if (P) { const pr = new THREE.Group(); pr.position.set(P.x, y0, P.y); pr.rotation.y = P.rot; g.add(pr); const hB = 110 * S;   // portable ramp, 40 ft, parked lowered
    add(new THREE.BoxGeometry(11 * FT, 0.03, PL), yel, 0, 0.18, 0, -Math.atan2(0.2, PL), pr);
    for (const z of [-PL / 2 + 0.2, PL / 2 - 0.2]) for (const x of [-0.38, 0.38]) { const w = add(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10), dark, x, 0.09, z, 0, pr); w.rotation.z = Math.PI / 2; } }
  if (C.gateArm) { add(new THREE.BoxGeometry(0.06, 0.25, 0.06), M('#444'), C.gateArm[0], y0 + 0.125, C.gateArm[1]); add(new THREE.BoxGeometry(1.2, 0.025, 0.025), M('#f2f2f2'), C.gateArm[0] - 0.6, y0 + 0.24, C.gateArm[1]); }
  if (MODE === 'debug') { // swept-path overlay: lane centre (cyan), lane edges (yellow), outer body path (red), envelope cells (red tint)
    const dy = y0 + RISE + 0.08, line = (pts, c) => { const G = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[2] ?? dy, p[1]))); g.add(new THREE.Line(G, new THREE.LineBasicMaterial({ color: c, depthTest: false }))); };
    const off = (s) => PATH.map((p, i) => { const a = PATH[Math.max(0, i - 1)], b = PATH[Math.min(PATH.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1; return [p[0] - ty / l * s, p[1] + tx / l * s]; });
    line(PATH, 0x00ffff); line(off(HALF), 0xffff00); line(off(-HALF), 0xffff00);
    line(arc(c1, Math.PI, 1.5 * Math.PI).map(p => [c1[0] + (p[0] - c1[0]) * ROUT / RC, c1[1] + (p[1] - c1[1]) * ROUT / RC]), 0xff2020);
    line(arc(c2, 1.5 * Math.PI, 2 * Math.PI).map(p => [c2[0] + (p[0] - c2[0]) * ROUT / RC, c2[1] + (p[1] - c2[1]) * ROUT / RC]), 0xff2020);
    const cells = []; for (let x = ENV_BOX[0]; x <= ENV_BOX[2]; x += 0.1) for (let y = ENV_BOX[1]; y <= ENV_BOX[3]; y += 0.1) if (inEnv(x, y)) cells.push([x, y]);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: CL.pass ? 0x30ff60 : 0xff2020, transparent: true, opacity: 0.25, depthTest: false }), cells.length);
    const m4 = new THREE.Matrix4(); cells.forEach((c, i) => { m4.makeTranslation(c[0], dy - 0.02, c[1]); im.setMatrixAt(i, m4); }); g.add(im);
    for (const vv of L.vehicles) if (Math.abs(vv.x - C.tx) < 12 && Math.abs(vv.y - C.by) < 14) { const cs = vCorners(vv).slice(0, 4); line([cs[0], cs[1], cs[3], cs[2], cs[0]], 0xffffff); }
    // a ghost car at 5 positions along the path
    for (const f of [0.15, 0.35, 0.5, 0.65, 0.8]) { let tot = 0; const seg = []; for (let i = 0; i + 1 < PATH.length; i++) { const l = Math.hypot(PATH[i + 1][0] - PATH[i][0], PATH[i + 1][1] - PATH[i][1]); seg.push(l); tot += l; }
      let s = f * tot, i = 0; while (i < seg.length - 1 && s > seg[i]) s -= seg[i++]; const a = PATH[i], b = PATH[i + 1], t = s / seg[i], hd = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const car = add(new THREE.BoxGeometry(16 * FT, 0.08, 6.5 * FT), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false }), a[0] + (b[0] - a[0]) * t, (i < 1 && a[1] + (b[1] - a[1]) * t > toe) ? y0 + RISE * Math.min(1, (a[1] + (b[1] - a[1]) * t - toe) / SL) + 0.1 : dy, a[1] + (b[1] - a[1]) * t); car.rotation.y = -hd; }
  }
  window.__autoramp.built = true;
}
(function wait() { if (window.__layout3d && window.__layout3d.ready && window.__layout3d.scene) { try { build(); } catch (e) { console.error('autoramp', e); } } else setTimeout(wait, 100); })();
})();
