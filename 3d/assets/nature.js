/* layout3d nature: true-N-scale vegetation populated on the terrain. Species (loblolly + longleaf pine, oaks w/ optional Spanish moss, sweetgum, red cedar,
   bald cypress with knees), understory, kudzu, grass tufts, wildflowers, cattails/reeds at water edges, crop rows at real spacing (tobacco 4 ft, cotton 38 in,
   soybean 30 in, corn 30 in), hedgerows along field edges, forest edges with density falloff, sparse rocks. Instanced in 48 in chunks with distance culling.
   URL/terrain.json: season=summer|spring|fall|winter, moss=0|1, woods=0|1. Also L3D.terrainReport() (planning checks). */
'use strict';
(function (L3D) {
const { part, merge, BOX, CYL, col } = L3D, PI = Math.PI, TR = L3D.terrain, sm = TR.smooth;
const CONE = (r, h, n = 7) => new THREE.ConeGeometry(r, h, n), lumpy = L3D.lumpyGeo, ICO = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
const trunk = (h, r0, r1, c = '#e6d6c6', y0 = 0) => part(CYL(r1, r0, h, 6), 0, y0 + h / 2, 0, c);
const def = L3D.defGeo;
// ---- species (unit height 1; viewer scales to real height) ----
def('tree-longleaf', { name: 'Longleaf pine (tall, sparse tufted crown)', h_in: [4.5, 6.0], note: '60-80 ft' }, () => { const P = [trunk(0.8, 0.016, 0.009, '#f0d8c4')];
  for (let i = 0; i < 7; i++) { const a = i * 2.4, r = 0.06 + 0.05 * (i % 3), y = 0.7 + 0.04 * i; P.push(part(BOX(0.012, 0.012, r * 1.6), Math.cos(a) * r * 0.5, y, Math.sin(a) * r * 0.5, '#f0d8c4', 0, -a, 0.3), part(lumpy(0.065, 0, 80 + i, 0.8), Math.cos(a) * r, y + 0.02, Math.sin(a) * r, i % 2 ? '#9c9c9c' : '#a6a6a6')); }
  P.push(part(lumpy(0.07, 0, 90, 0.9), 0, 0.97, 0, '#a6a6a6')); return merge(P); }, () => merge([trunk(0.8, 0.016, 0.009, '#f0d8c4'), part(ICO(0.14).scale(1, 0.6, 1), 0, 0.88, 0, '#a6a6a6')]));
def('tree-sweetgum', { name: 'Sweetgum (pyramidal crown)', h_in: [3.0, 4.5] }, () => merge([trunk(0.4, 0.022, 0.012), part(lumpy(0.2, 1, 101, 1.6), 0, 0.62, 0, '#a6a6a6'), part(lumpy(0.14, 1, 102, 1.3), 0, 0.85, 0, '#9c9c9c'), part(lumpy(0.12, 0, 103), 0.1, 0.55, 0.06, '#a0a0a0')]),
  () => merge([trunk(0.4, 0.022, 0.012), part(CONE(0.24, 0.75, 7), 0, 0.66, 0, '#a6a6a6')]));
def('tree-oak-live', { name: 'Southern live oak (wide spreading)', h_in: [2.6, 3.8], note: '40-55 ft tall, wider than tall' }, () => { const P = [trunk(0.32, 0.07, 0.05)];
  for (const [a, l] of [[0.3, 0.42], [2.4, 0.38], [4.3, 0.45]]) P.push(part(CYL(0.02, 0.035, l, 5), Math.cos(a) * l * 0.4, 0.38, Math.sin(a) * l * 0.4, '#e6d6c6', Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9));
  P.push(part(lumpy(0.3, 1, 111, 0.55).scale(1.5, 1, 1.4), 0, 0.6, 0, '#a6a6a6'), part(lumpy(0.22, 1, 112, 0.6), 0.35, 0.52, 0.1, '#9c9c9c'), part(lumpy(0.22, 1, 113, 0.6), -0.32, 0.55, -0.15, '#a2a2a2')); return merge(P); },
  () => merge([trunk(0.32, 0.07, 0.05), part(ICO(0.34).scale(1.6, 0.6, 1.5), 0, 0.62, 0, '#a6a6a6')]));
def('spanish-moss', { name: 'Spanish moss drape (cluster)', h_in: [0.6, 1.0] }, () => merge([...[0, 1, 2, 3, 4].map(i => part(CONE(0.05, 0.5 + 0.2 * (i % 2), 4), Math.cos(i * 1.3) * 0.12, -0.3, Math.sin(i * 1.3) * 0.12, '#fff', PI, 0, 0))]));
def('cypress-knees', { name: 'Cypress knees (cluster)', h_in: [0.1, 0.2] }, () => merge([...[0, 1, 2, 3, 4, 5].map(i => part(CONE(0.03 + 0.01 * (i % 2), 0.08 + 0.05 * (i % 3), 5), Math.cos(i * 1.7) * (0.12 + 0.05 * i), 0.04, Math.sin(i * 1.7) * (0.12 + 0.04 * i), '#6a5646'))]));
def('kudzu', { name: 'Kudzu blanket (drapes over edge trees/poles)', h_in: [0.8, 2.5] }, () => merge([part(lumpy(0.5, 1, 121, 0.8).scale(1.3, 1, 1), 0, 0.38, 0, '#fff'), part(lumpy(0.32, 1, 122, 1.4), 0.3, 0.62, 0.1, '#eee'), part(lumpy(0.3, 1, 123, 0.7), -0.4, 0.24, -0.2, '#f2f2f2')]));
def('understory', { name: 'Understory shrub (yaupon / wax myrtle)', h_in: [0.3, 0.7] }, () => merge([part(lumpy(0.4, 0, 131, 1.0), 0, 0.42, 0, '#fff'), part(lumpy(0.3, 0, 132, 1.0), 0.25, 0.32, 0.1, '#eee'), part(CYL(0.02, 0.03, 0.3, 4), 0, 0.15, 0, '#e6d6c6')]));
def('wildflowers', { name: 'Wildflower patch', h_in: [0.06, 0.1] }, () => merge([...[0, 1, 2, 3, 4, 5, 6].map(i => part(new THREE.OctahedronGeometry(0.018), Math.cos(i * 2.2) * 0.07 * (1 + i % 3), 0.07 + 0.01 * (i % 2), Math.sin(i * 2.2) * 0.07 * (1 + i % 3), ['#f2d22a', '#ffffff', '#c86ad8', '#f27a2a'][i % 4])), ...[0, 1, 2].map(i => part(CONE(0.03, 0.08, 3), Math.cos(i * 2) * 0.06, 0.04, Math.sin(i * 2) * 0.06, '#5a7a3a'))]));
def('cattails', { name: 'Cattails / rushes clump', h_in: [0.3, 0.45], note: '4-6 ft' }, () => merge([...[0, 1, 2, 3, 4, 5].map(i => part(CYL(0.004, 0.006, 0.9, 3), Math.cos(i * 2.1) * 0.05, 0.45, Math.sin(i * 2.1) * 0.05, '#fff', Math.cos(i) * 0.12, 0, Math.sin(i) * 0.12)), ...[0, 2, 4].map(i => part(CYL(0.016, 0.016, 0.14, 5), Math.cos(i * 2.1) * 0.05 + Math.sin(i) * 0.08, 0.8, Math.sin(i * 2.1) * 0.05 + Math.cos(i) * 0.05, '#5a3a22')), ...[0, 1, 2, 3].map(i => part(CONE(0.03, 0.6, 3), Math.cos(i * 1.6) * 0.08, 0.3, Math.sin(i * 1.6) * 0.08, '#fff', 0.15 * Math.cos(i), 0, 0.15 * Math.sin(i)))]));
def('rock', { name: 'Fieldstone / small outcrop', h_in: [0.1, 0.3] }, () => merge([part(L3D.lumpyGeo(0.5, 1, 141, 0.55), 0, 0.12, 0, '#fff'), part(L3D.lumpyGeo(0.3, 0, 142, 0.6), 0.45, 0.06, 0.2, '#eee')]));
// crops: one instance = one plant (or a short run of plants), real heights
def('crop-tobacco', { name: 'Tobacco plant (flue-cured, mid-season)', h_in: [0.25, 0.3], note: '3.5-4.5 ft; rows 4 ft' }, () => merge([part(CYL(0.02, 0.03, 0.9, 4), 0, 0.45, 0, '#6a8a3a'), ...[0, 1, 2, 3, 4, 5].map(i => part(new THREE.SphereGeometry(0.22, 5, 3).scale(1, 0.18, 0.5), Math.cos(i * 2.4) * 0.2, 0.2 + i * 0.12, Math.sin(i * 2.4) * 0.2, i % 2 ? '#fff' : '#eee', 0, -i * 2.4, -0.25))]));
def('crop-cotton', { name: 'Cotton plants (open bolls), 1 ft run', h_in: [0.2, 0.25], note: '3-4 ft; rows 38 in' }, () => merge([part(lumpy(0.5, 0, 151, 0.8).scale(1.6, 1, 0.8), 0, 0.5, 0, '#fff'), ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => part(ICO(0.07), -0.6 + i * 0.15, 0.55 + 0.25 * Math.sin(i * 2.7), 0.25 * Math.cos(i * 1.9), '#f6f4ee'))]));
def('crop-soy', { name: 'Soybean row segment (canopy), 1 ft', h_in: [0.12, 0.16], note: '2-2.5 ft; rows 30 in' }, () => merge([part(lumpy(0.5, 0, 161, 0.55).scale(1.8, 1, 0.7), 0, 0.35, 0, '#fff')]));
def('crop-corn', { name: 'Corn stalks, short run', h_in: [0.5, 0.65], note: '7-9 ft; rows 30 in' }, () => merge([...[-0.3, 0, 0.3].flatMap((x, j) => [part(CYL(0.012, 0.018, 1.0, 4), x, 0.5, 0, '#8aa040'), ...[0, 1, 2, 3].map(i => part(BOX(0.4, 0.01, 0.05), x + Math.cos(i * 1.6 + j) * 0.18, 0.3 + i * 0.16, Math.sin(i * 1.6 + j) * 0.18, '#fff', 0, -(i * 1.6 + j), -0.4))]), part(CYL(0.015, 0.012, 0.15, 4), 0, 1.02, 0, '#c8a860')]));
def('crop-lo', { name: 'Crop row far-LOD block (internal)' }, () => merge([part(BOX(0.9, 0.8, 0.45), 0, 0.4, 0, '#fff')]));
// ---- helpers ----
const CH = 160; function chunked(C, o, geo, items, f, opt = {}) { const cells = {}, ch = opt.cell || CH; for (const it of items) { const k = Math.floor(it[0] / ch) + ',' + Math.floor(it[1] / ch); (cells[k] = cells[k] || []).push(it); } for (const list of Object.values(cells)) C.inst(o, geo, list, f, opt); }
const SP = { 'tree-pine': { H: [4.1, 6.0], crownLow: 0.62, r: 0.2 }, 'tree-longleaf': { H: [4.5, 6.0], crownLow: 0.68, r: 0.18 }, 'tree-oak': { H: [3.0, 4.5], crownLow: 0.3, r: 0.32 }, 'tree-oak-live': { H: [2.6, 3.6], crownLow: 0.35, r: 0.55 },
  'tree-sweetgum': { H: [3.0, 4.5], crownLow: 0.35, r: 0.22 }, 'tree-maple': { H: [3.0, 4.2], crownLow: 0.35, r: 0.22 }, 'tree-cedar': { H: [1.8, 3.2], crownLow: 0.1, r: 0.2 }, 'tree-cypress': { H: [3.5, 5.0], crownLow: 0.3, r: 0.17 } /* [R33] GLB crown starts ~35% up (was 0.55: cypress crowns overhung L2 W-1 at 1.5 in) */, 'tree-young': { H: [1.5, 2.5], crownLow: 0.4, r: 0.25 } };
/* [RV2 R13] Blender GLB trees at their real sizes (height in plan in, crown radius = half GLB spread); +-8% natural variation only */
const GLBT = { 'tree-oak': [4.911, 4.4], 'tree-maple': [4.34, 2.88], 'tree-young': [1.581, 0.92], 'tree-pine': [6.624, 2.55], 'tree-cedar': [2.457, 1.19], 'tree-cypress': [5.683, 2.17], 'tree-longleaf': [7.405, 2.42], 'tree-sweetgum': [5.784, 2.69], 'tree-oak-live': [3.414, 6.89] };
for (const k in GLBT) { const [h, sp] = GLBT[k]; SP[k].H = [h * 0.92, h * 1.08]; SP[k].r = sp / 2 / h; }
/* [RV3 trees] Owner: trees were oversized and swallowed roads/lots. Real eastern-NC mature heights + crown spreads (metres, 1:160 -> /4.064 in):
   loblolly 16-24 m / crown <= 9 m, longleaf 18-24 / 9, oaks 15-22 / 15, live oak 10-15 / 18, sweetgum 15-23 / 12, maple 12-18 / 11,
   red cedar 8-12 / 5, cypress 15-23 / 8, young trees 4-7 / 4. Heights are clamped into these ranges and the crown is narrowed (never the
   height stretched) so its spread stays under the cap. */
const M2IN = 1 / 4.064, REAL = { 'tree-pine': [16, 24, 9], 'tree-longleaf': [18, 24, 9], 'tree-oak': [15, 22, 15], 'tree-oak-live': [10, 15, 18], 'tree-sweetgum': [15, 23, 12],
  'tree-maple': [12, 18, 11], 'tree-cedar': [8, 12, 5], 'tree-cypress': [15, 23, 8], 'tree-young': [4, 7, 4] };
for (const k in REAL) { const [a, b, c] = REAL[k]; SP[k].H = [a * M2IN, b * M2IN]; SP[k].crownMax = c * M2IN; SP[k].unitW = 2 * SP[k].r; SP[k].r = Math.min(SP[k].r, c * M2IN / 2 / (b * M2IN)); }
const clampH = (sp, H) => SP[sp] && SP[sp].crownMax ? Math.max(sp === 'tree-pine' || sp === 'tree-young' ? 0.6 : SP[sp].H[0] * 0.8, Math.min(SP[sp].H[1], H)) : H;
const crownW = (sp, H, w) => { const S = SP[sp]; return S && S.crownMax ? Math.min(H * w, S.crownMax / S.unitW) : H * w; };
const CAR_H = 1.65, ENV = 0.62; // car height (in) and half clearance envelope from track centre (N-scale NEM/NMRA-ish, incl. overhang on R282+)
const clearNeed = (sp, H) => { const s = SP[sp]; return s.crownLow * H > CAR_H + 0.6 ? ENV + 0.1 : ENV + 0.1 + s.r * H; };   /* [R33] crown must clear the envelope unless it is well above double-stacks */
function pick(r, list) { let a = 0; for (const [k, w] of list) { a += w; if (r < a) return k; } return list[list.length - 1][0]; }
L3D.nature = { SP, clearNeed };
// C: viewer ctx { onBoard, trackDist, occupied, inWater, inst(o, geo, items, f(it)->[x,y,z,rotY,[sx,sy,sz],Color], opt), hash, QS }
L3D.nature.populate = (o, C) => {
  const L = o.L, T = o.terrain, y = o.deck, TJ = window.TERRAIN || {}, QS = C.QS; let s = 99 + L.id * 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const moss = (QS.get('moss') || String(TJ.moss != null ? TJ.moss : 1)) !== '0', woods = (QS.get('woods') || String(TJ.woods != null ? TJ.woods : 1)) !== '0';
  const H = (x, z) => T ? T.h(x, z) : 0, gi = (x, z) => T ? Math.max(0, Math.min(T.nx * T.nz - 1, Math.round((z - T.z0) / T.step) * T.nx + Math.round((x - T.x0) / T.step))) : 0;
  const wet = (x, z) => T && T.dW[gi(x, z)] < 2.5, inW = (x, z) => T ? T.water[gi(x, z)] || H(x, z) < T.cfg.waterLevel + 0.01 : C.inWater(o, x, z);
  const free = (x, z, need = 0.85) => C.onBoard(o, x, z, 0.25) && C.trackDist(o, x, z, need + 0.1) > need && !C.occupied(o, x, z, 0.2) && !inW(x, z);
  const fieldAt = (x, z) => L.fields.some(f => L3D.inPoly(x, z, f.pts));
  const NS = TR.vnoise(311 + L.id * 17), NG = TR.vnoise(733 + L.id * 5); /* [UX1] stand + gap fields */
  const trees = [], rej = { clearance: 0 }; const N = o.nature = { trees, rej, bushes: [], kudzu: [], cattails: [], crops: 0 };
  const roadD = (x, z) => { let d = 1e9; for (const r of L.roads || []) for (let j = 0; j + 1 < r.pts.length; j++) d = Math.min(d, L3D.segDist(x, z, r.pts[j], r.pts[j + 1]) - (r.w || 1.2) / 2); return d; };
  const crownOK = (x, z, rc) => !C.occupied(o, x, z, Math.max(0.2, rc * 0.7)) && roadD(x, z) > rc * 0.6;   /* [RV3] crown may only lightly overhang lots / buildings / roads */
  const addTree = (x, z, sp, densityEdge = 1, hm = 1) => { const S = SP[sp], Ht = clampH(sp, (S.H[0] + (S.H[1] - S.H[0]) * rnd()) * hm), rc = S.r * Ht;
    for (let k = 0; k < 4; k++) { const ok = C.trackDist(o, x, z, 3) >= clearNeed(sp, Ht) && free(x, z, 0.6) && !fieldAt(x, z) && crownOK(x, z, rc);
      if (ok) { trees.push({ x, z, sp, H: Ht, r: rc, edge: densityEdge }); return; }
      if (k === 3) { rej.clearance++; rej.crown = (rej.crown || 0) + 1; return; } const a = rnd() * 6.283, d = 0.5 + rnd() * 1.2; x += Math.cos(a) * d; z += Math.sin(a) * d; } };   /* [RV3] relocate up to 3 times, else thin */
  const mix = (x, z) => wet(x, z) ? [['tree-cypress', 0.45], ['tree-sweetgum', 0.25], ['tree-oak', 0.15], ['tree-pine', 0.15]] : [['tree-pine', 0.42], ['tree-longleaf', 0.13], ['tree-oak', 0.14], ['tree-oak-live', 0.05], ['tree-sweetgum', 0.14], ['tree-maple', 0.05], ['tree-cedar', 0.07]];
  // plan trees (clusters)
  for (const t of L.trees) { const n = Math.max(1, Math.round(3 * t.r * t.r + 1)); for (let i = 0; i < n; i++) { const a = rnd() * 6.283, rr = t.r * Math.sqrt(rnd()), x = t.x + rr * Math.cos(a), z = t.y + rr * Math.sin(a); addTree(x, z, pick(rnd(), mix(x, z))); } }
  // forest polygons with edge falloff (pine plantations in rows, cypress swamp, mixed woods)
  for (const g of L.ground || []) if (['pine', 'plant', 'cypress'].includes(g.kind)) { const xs = g.pts.map(p => p[0]), zs = g.pts.map(p => p[1]), st = g.kind === 'plant' ? 0.8 : 0.7;
    for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs); x += st) for (let z = Math.min(...zs) + 0.3; z < Math.max(...zs); z += st) { const jx = x + (g.kind === 'plant' ? 0 : (rnd() - .5) * 0.6), jz = z + (g.kind === 'plant' ? 0 : (rnd() - .5) * 0.6); if (!L3D.inPoly(jx, jz, g.pts)) continue;
      let de = 1e9; for (let i = 0; i < g.pts.length; i++) de = Math.min(de, L3D.segDist(jx, jz, g.pts[i], g.pts[(i + 1) % g.pts.length])); const dens = 0.35 + 0.65 * sm(0, 2.0, de); if (rnd() > dens) continue;
      addTree(jx, jz, g.kind === 'cypress' ? (rnd() < 0.8 ? 'tree-cypress' : 'tree-sweetgum') : g.kind === 'plant' ? 'tree-pine' : pick(rnd(), mix(jx, jz)), de); } }
  // [REV4-3D] cutover (young pines + saplings, sparse) and brush (scattered shrubs) ground covers
  const NOAUTO = new Set(['row', 'lawn', 'young', 'brush', 'sand', 'salvage', 'cinder', 'gravel', 'lot', 'apron', 'drive', 'walk']);
  const extraBush = [];
  for (const g of L.ground || []) if (g.kind === 'young' || g.kind === 'brush') { const xs = g.pts.map(p => p[0]), zs = g.pts.map(p => p[1]), st = g.kind === 'young' ? 1.0 : 1.3;
    for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs); x += st) for (let z = Math.min(...zs) + 0.3; z < Math.max(...zs); z += st) { const jx = x + (rnd() - .5) * 0.8, jz = z + (rnd() - .5) * 0.8; if (!L3D.inPoly(jx, jz, g.pts)) continue;
      if (g.kind === 'young') { if (rnd() < 0.7) { const sp = rnd() < 0.6 ? 'tree-pine' : 'tree-young', S = SP[sp]; if (C.trackDist(o, jx, jz, 3) > 1.2 && free(jx, jz, 0.6)) { const Hy = sp === 'tree-pine' ? 1.2 + 1.3 * rnd() : S.H[0] + (S.H[1] - S.H[0]) * rnd() * 0.6; if (crownOK(jx, jz, S.r * Hy)) trees.push({ x: jx, z: jz, sp, H: Hy, r: S.r * Hy, edge: 1 }); } } }
      else if (rnd() < 0.45 && free(jx, jz, 0.7)) extraBush.push([jx, jz]); } }
  // auto woods in large open areas far from features (density ramps up with distance = natural forest edge)
  if (woods && T) for (let x = T.x0 + 0.5; x < T.x0 + T.nx * T.step; x += 0.85) for (let z = T.z0 + 0.5; z < T.z0 + T.nz * T.step; z += 0.85) { const jx = x + (rnd() - .5) * 0.7, jz = z + (rnd() - .5) * 0.7, p = gi(jx, jz); if (!T.board[p] || T.field[p] >= 0) continue;
    if (T.ground[p] >= 0 && NOAUTO.has(L.ground[T.ground[p]].kind)) continue; /* [REV4-3D] no auto forest on lawns, ROW, yards, rings, salvage, cutover */
    const dF = T.dF[p], dens = sm(4.0, 9.0, dF) * 0.9; if (rnd() > dens) continue;
    /* [UX1 woods] stands, not salt-and-pepper: a low-frequency field picks pine stands (tall, even-aged loblolly, little mix) vs hardwood
       patches (oak/sweetgum/maple, varied heights, turning colours) vs mixed; a second field opens clearings that get brush; heights vary by stand */
    if (wet(jx, jz)) { addTree(jx, jz, pick(rnd(), mix(jx, jz)), dF - 4, 0.8 + 0.4 * rnd()); continue; }
    const sv = TR.fbm(NS, jx / 13, jz / 13), gv = TR.fbm(NG, jx / 5.5, jz / 5.5);
    if (gv < -0.28 && dF > 5) { if (rnd() < 0.35 && free(jx, jz, 0.7)) extraBush.push([jx, jz]); continue; } // clearing / gap with brush
    if (sv > 0.12) { if (rnd() < 0.18) continue; addTree(jx, jz, pick(rnd(), [['tree-pine', 0.84], ['tree-longleaf', 0.08], ['tree-sweetgum', 0.04], ['tree-cedar', 0.04]]), dF - 4, 1.02 + 0.12 * rnd()); }
    else if (sv < -0.12) addTree(jx, jz, pick(rnd(), [['tree-oak', 0.3], ['tree-sweetgum', 0.24], ['tree-maple', 0.14], ['tree-young', 0.1], ['tree-pine', 0.1], ['tree-oak-live', 0.05], ['tree-cedar', 0.07]]), dF - 4, 0.72 + 0.45 * rnd());
    else addTree(jx, jz, pick(rnd(), mix(jx, jz)), dF - 4, 0.8 + 0.35 * rnd()); }
  // hedgerows: plan lines + field edges
  /* [TILE-HOOK] with hedge.glb ingested: plan hedge lines are tiled by viewer.js, field edges get tiled sections (~70% kept = natural gaps) */
  const XHG = !!(L3D.ext && L3D.ext.tile && L3D.ext.has('hedge')), YH = p => y + H(p[0], p[1]);
  const hedges = []; for (const ln of L.lines.filter(l => l.kind === 'hedge' && !XHG)) L3D.resample(ln.pts, 0.35).forEach(p => { if (free(p[0], p[1], 0.7)) hedges.push(p); });
  for (const f of L.fields) { if (f.crop === 'pasture') continue; if (XHG) { L3D.ext.tile(o.g, 'hedge', f.pts.concat([f.pts[0]]), YH, p => rnd() < 0.7 && free(p[0], p[1], 0.9)); continue; }
    const R = L3D.resample(f.pts.concat([f.pts[0]]), 0.4); R.forEach(p => { if (rnd() < 0.55 && free(p[0], p[1], 0.9)) hedges.push([p[0] + (rnd() - .5) * .2, p[1] + (rnd() - .5) * .2]); }); }
  // understory + kudzu at forest edges, cypress knees, Spanish moss
  const under = [], kudzu = [], knees = [], mossI = [];
  for (const t of trees) { if (t.edge < 1.5 && t.sp !== 'tree-pine') for (let k = 0; k < 2; k++) { const a = rnd() * 6.28, d = 0.4 + rnd() * 0.6, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d; if (rnd() < 0.6 && free(x, z, 0.75)) under.push([x, z]); } /* [UX1] edge understory */
    if (rnd() < 0.45) { const a = rnd() * 6.28, d = 0.3 + rnd() * 0.8, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d; if (free(x, z, 0.75)) under.push([x, z]); }
    if (t.edge < 1.2 && t.sp !== 'tree-cypress' && rnd() < 0.12 && C.trackDist(o, t.x, t.z, 2) > 1.2) kudzu.push([t.x, t.z, t.H]);
    if (t.sp === 'tree-cypress') for (let k = 0; k < 2; k++) knees.push([t.x + (rnd() - .5) * 0.8, t.z + (rnd() - .5) * 0.8]);
    if (moss && !(L3D.ext && L3D.ext.has(t.sp) && L3D.ext.ovr(t.sp).mode === 'parts') /* [R36c] ext 'parts' trees are LOD-hidden at normal viewing distance (near 5), so their moss hung in mid-air beside the main yard: the pale spiky 'pilings'. Moss only on trees that draw. */ && (t.sp === 'tree-oak-live' || (t.sp === 'tree-cypress' || t.sp === 'tree-oak') && wet(t.x, t.z)) && rnd() < 0.7) for (let k = 0; k < 2; k++) { const a = rnd() * 6.28; { const lr = (t.sp === 'tree-oak-live' ? 0.35 + 0.4 * rnd() : 0.3 + 0.3 * rnd()) * t.r; mossI.push([t.x + Math.cos(a) * lr, t.z + Math.sin(a) * lr, t.H * (t.sp === 'tree-oak-live' ? 0.42 + 0.12 * rnd() : 0.5 + 0.15 * rnd())]); }   /* [RV2 R13] moss glb origin = top of limb, hangs down from a limb inside the crown */ } }
  // water edge: cattails + reeds
  const catt = []; if (T) for (let p = 0; p < T.nx * T.nz; p++) { if (!T.board[p] || T.water[p] || T.dW[p] > 0.8 || T.flat[p]) continue; if (rnd() < 0.5) { const i = p % T.nx, k = (p - i) / T.nx; catt.push([T.X(i) + (rnd() - .5) * 0.4, T.Z(k) + (rnd() - .5) * 0.4]); } }
  for (const ln of L.lines.filter(l => l.kind === 'reeds')) L3D.resample(ln.pts, 0.25).forEach(p => catt.push([p[0] + (rnd() - .5) * .4, p[1] + (rnd() - .5) * .4]));
  under.push(...extraBush);
  N.cattails = catt; N.bushes = under; N.kudzu = kudzu;
  // grass tufts + wildflowers (ditches/roadsides/field margins)
  const tufts = [], flowers = []; if (T) for (let p = 0; p < T.nx * T.nz; p += 1) { if (!T.board[p] || T.flat[p] || T.water[p] || T.field[p] >= 0) continue; const i = p % T.nx, k = (p - i) / T.nx; if (rnd() < 0.22) tufts.push([T.X(i) + (rnd() - .5) * T.step, T.Z(k) + (rnd() - .5) * T.step]);
    if ((T.cat[p] === 3 || T.dF[p] < 1.5) && rnd() < 0.06) flowers.push([T.X(i) + (rnd() - .5) * T.step, T.Z(k) + (rnd() - .5) * T.step]); }
  // crop rows at real spacing, parallel to the field's long side
  const crops = { 'crop-tobacco': [], 'crop-cotton': [], 'crop-soy': [], 'crop-corn': [] };
  L.fields.forEach((f, fi) => { const crop = f.crop === 'tobacco' ? 'crop-tobacco' : f.crop === 'cotton' ? 'crop-cotton' : f.crop === 'soy' || f.crop === 'soybean' ? 'crop-soy' : f.crop === 'corn' ? 'crop-corn' : f.crop === '' ? (fi % 2 ? 'crop-soy' : 'crop-corn') : null; if (!crop) return;
    const rowSp = { 'crop-tobacco': 0.3, 'crop-cotton': 0.2, 'crop-soy': 0.24, 'crop-corn': 0.43 }[crop], plSp = { 'crop-tobacco': 0.125, 'crop-cotton': 2.44, 'crop-soy': 2.47, 'crop-corn': 1.81 }[crop];   /* [RV2 R13] glb runs: cotton/soy 9.6 m, corn 6.6 m (2 rows) */ /* per-instance spacing: cotton/soy/corn instances are multi-plant row runs */
    let best = [1, 0], bl = 0; for (let i = 0; i < f.pts.length; i++) { const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > bl) { bl = l; best = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; } }
    const [ux, uz] = best, vx = -uz, vz = ux, xs = f.pts.map(p => p[0] * ux + p[1] * uz), vs = f.pts.map(p => p[0] * vx + p[1] * vz), ang = Math.atan2(uz, ux);
    for (let v = Math.min(...vs) + rowSp / 2; v < Math.max(...vs); v += rowSp) for (let u = Math.min(...xs) + Math.max(0.15, plSp / 2); u < Math.max(...xs) - (plSp > 1 ? plSp / 2 - 0.1 : 0); u += plSp) { const x = u * ux + v * vx, z = u * uz + v * vz; if (!L3D.inPoly(x, z, f.pts)) continue; let de = 1e9; for (let i = 0; i < f.pts.length; i++) de = Math.min(de, L3D.segDist(x, z, f.pts[i], f.pts[(i + 1) % f.pts.length])); if (de < 0.25 || !free(x, z, 0.8)) continue; crops[crop].push([x, z, ang]); } });
  function uy(v) { return v; }
  // ---- instancing ----
  const SEAS = (c, amt) => TR.seasonTint(c, amt), C3 = new THREE.Color();
  { /* [R33] final crown check with the rendered geometry's own width/height ratio (GLB crowns are wider than SP[sp].r) */
    const rat = {}; const ratio = sp => { if (rat[sp] === undefined) { const g = L3D.geo(sp); if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox; rat[sp] = Math.max(SP[sp].r, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2 / Math.max(1e-3, b.max.y - b.min.y)); } return rat[sp]; };
    const keep = trees.filter(t => SP[t.sp].crownLow * t.H > CAR_H + 0.6 || C.trackDist(o, t.x, t.z, 3) >= ENV + 0.1 + ratio(t.sp) * t.H * 1.1);
    rej.crownGeo = trees.length - keep.length; trees.length = 0; trees.push(...keep); }
  const byS = {}; for (const t of trees) (byS[t.sp] = byS[t.sp] || []).push(t);
  for (const [sp, list] of Object.entries(byS)) { const F = it => { const t = it[2], w = GLBT[sp] ? 0.96 + 0.08 * rnd() : sp === 'tree-oak-live' ? 1.0 : 0.85 + 0.3 * rnd(); C3.setHSL(sp === 'tree-cedar' ? 0.31 : sp.includes('pine') || sp === 'tree-longleaf' ? 0.25 + 0.04 * rnd() : sp === 'tree-cypress' ? 0.22 : 0.2 + 0.09 * rnd(), 0.38 + 0.1 * rnd(), 0.32 + 0.1 * rnd()); /* brighter tint; crowns darkened in geometry so trunks read lighter */
    SEAS(C3, sp.includes('pine') || sp === 'tree-longleaf' || sp === 'tree-cedar' || sp === 'tree-oak-live' ? 0.25 : sp === 'tree-sweetgum' ? 1.4 : 1); const cw = crownW(sp, t.H, w); return [t.x, y + H(t.x, t.z) - 0.02, t.z, rnd() * 6.28, [cw, t.H, cw], C3]; }; /* [EXT] Grok glb trees near (textured, shared jitter), procedural far */
    const rows = list.map(t => [t.x, t.z, (r => (r[5] = r[5] && r[5].clone(), r))(F([t.x, t.z, t]))]), X = L3D.ext && L3D.ext.has(sp) && L3D.ext.ovr(sp).mode === 'parts';
    /* [REALISM 2026-10-19] rebuilt species trees (likeness.js): one geometry per variant with baked bark (tree material), hi LOD near / lo LOD far, species fall colour */
    if (L3D.treeMat && L3D.assets[sp + ':t'] && !X) { if (L3D.likeness_treeTint) rows.forEach(r => { const c = L3D.likeness_treeTint(sp, rnd, new THREE.Color()); if (c) r[2][5] = c; });
      for (let v = 0; v < 2; v++) { const sub = rows.filter((r, i) => i % 2 === v), sfx = v ? '#1' : '';
        chunked(C, o, L3D.geo(sp + sfx + ':t'), sub, it => it[2], { mat: L3D.treeMat(), cast: true, detail: 46, cell: 32 });
        chunked(C, o, L3D.geo(sp + sfx + ':tlo'), sub, it => it[2], { mat: L3D.treeMat(), cast: true, detail: 400, near: 46, cell: 32 }); } continue; }   /* [R34 walk-mode trees] lo chunks on the SAME 32 in grid as the hi chunks -> identical instance sets + spheres, so lo is shown exactly when hi is hidden (48 in lo cells left a band where neither LOD drew: walk-mode cameras sat inside a lo cell (dd<46 -> lo hidden) with the trees' hi cells beyond 46) */
    chunked(C, o, L3D.geo(sp), rows, it => it[2], { key: 'plain', cast: true, detail: 400, near: X ? 5 : 0 });
    if (X) for (const pt of L3D.ext.parts(sp)) chunked(C, o, pt.geo, rows, it => { const r = it[2].slice(); r[5] = /bark/i.test(pt.name) ? new THREE.Color(1, 1, 1) : r[5].clone().lerp(new THREE.Color(1, 1, 1), 0.55); return r; }, { mat: pt.mat, cast: true, detail: 5, cell: 24 }); }
  /* [R30] real-size table for shrubs (N 1:160, 1 ft = 0.075 in): shrubs 3-8 ft tall and wide, hedges 4-6 ft tall; every instance is clamped to it, and
     shrubs/hedges never sit on a walk, sidewalk, path or trail (plan walk lots + path lines, shrub radius added). */
  const FT = 0.075, SHRUB = L3D.SHRUB_SIZE = { understory: { h: [3, 6], w: [3, 6] }, bush: { h: [3, 6], w: [3, 6] } /* [R34] 3-6 ft (0.23-0.45 in) */, hedge: { h: [4, 6], w: [2.5, 6] } };
  const gsz = k => { const g = L3D.geo(k); if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox; return [Math.max(1e-3, b.max.x - b.min.x), Math.max(1e-3, b.max.y - b.min.y), Math.max(1e-3, b.max.z - b.min.z)]; };
  const clampSc = (k, sc) => { const T = SHRUB[k], z = gsz(k); const h = Math.max(T.h[0] * FT, Math.min(T.h[1] * FT, z[1] * sc[1])), wmax = T.w[1] * FT, wmin = T.w[0] * FT;
    const fx = Math.max(wmin, Math.min(wmax, z[0] * sc[0])) / z[0], fz = Math.max(wmin, Math.min(wmax, z[2] * sc[2])) / z[2]; return [fx, h / z[1], fz]; };
  const WALKS = (L.lots || []).filter(l => /walk|path|trail|sidewalk/i.test((l.kind || '') + ' ' + (l.name || '')) && l.r), PATHS = (L.lines || []).filter(l => /path|trail|walk/.test(l.kind || ''));
  const onPath = (p, r) => WALKS.some(l => p[0] > l.r[0] - r && p[0] < l.r[2] + r && p[1] > l.r[1] - r && p[1] < l.r[3] + r) ||
    PATHS.some(l => { for (let i = 1; i < l.pts.length; i++) if (L3D.segDist(p[0], p[1], l.pts[i - 1], l.pts[i]) < (l.w || 0.25) / 2 + r) return true; return false; });
  { const f = (A, r) => { const k = A.filter(p => !onPath(p, r)); N.pathRej = (N.pathRej || 0) + A.length - k.length; A.length = 0; A.push(...k); }; f(hedges, 0.2); f(under, 0.3); }
  { /* [6c] vegetation crown vs track envelope (ENV 0.62 + 0.1 margin + crown half-width) */ const td = p => C.trackDist(o, p[0], p[1], 3); const g = (A, r) => { const k = A.filter(p => td(p) >= ENV + 0.1 + r(p)); N.vegRej = (N.vegRej || 0) + A.length - k.length; A.length = 0; A.push(...k); };
    g(hedges, () => 0.23); g(under, () => 0.3); g(kudzu, () => 0.6);   /* [R34] kudzu mat half-width <= 0.6 in */ g(mossI, () => 0.25); }
  chunked(C, o, L3D.geo('hedge'), hedges, p => { const sc = 0.5 + 0.3 * rnd(); C3.setHSL(0.27, 0.4, 0.2 + 0.06 * rnd()); return [p[0], y + H(p[0], p[1]), p[1], rnd() * 3, clampSc('hedge', [sc * 1.1, sc * 1.3, sc]), SEAS(C3, 1)]; }, { key: 'plain', detail: 200 });
  /* [INGEST batch8] shrub mix: every third understory clump is the bush.glb shrub (0.35 in model, scaled 0.8-1.3 = 5-7 ft) */
  const bushX = L3D.ext && L3D.ext.has && L3D.ext.has('bush') ? under.filter((p, i) => i % 3 === 2) : [];
  if (bushX.length) { const keep = under.filter((p, i) => i % 3 !== 2); under.length = 0; under.push(...keep);
    chunked(C, o, L3D.geo('bush'), bushX, p => { const sc = 0.8 + 0.5 * rnd(); C3.setHSL(0.27, 0.35, 0.22 + 0.07 * rnd()); return [p[0], y + H(p[0], p[1]), p[1], rnd() * 6, clampSc('bush', [sc, sc, sc]), SEAS(C3, 0.6)]; }, { key: 'plain', detail: 160 }); }
  chunked(C, o, L3D.geo('understory'), under, p => { const sc = 0.35 + 0.35 * rnd(); C3.setHSL(0.26, 0.35, 0.2 + 0.07 * rnd()); return [p[0], y + H(p[0], p[1]), p[1], rnd() * 6, clampSc('understory', [sc, sc, sc]), SEAS(C3, 0.6)]; }, { key: 'plain', detail: 160 });
  { /* [R34 REVIEW5] kudzu was 1.4-2.5 in tall mounds (20-40 ft blobs as tall as the trees along the fascia). Now a low draped ground-cover mat: 2-4 ft tall
     (0.15-0.3 in), 8-16 ft patches, irregular (every other edge spot left as a gap or a small 3-6 ft shrub) */
  const g = L3D.geo('kudzu'); if (!g.boundingBox) g.computeBoundingBox(); const kb = g.boundingBox, kh = Math.max(1e-3, kb.max.y - kb.min.y), kw = Math.max(1e-3, Math.max(kb.max.x - kb.min.x, kb.max.z - kb.min.z));
  const mat = [], sh = []; for (const p of kudzu) { const r = rnd(); if (r < 0.3) continue; (r < 0.55 ? sh : mat).push(p); } kudzu.length = 0; kudzu.push(...mat); N.kudzuShrubs = sh;
  chunked(C, o, g, mat, p => { const h = 0.15 + 0.15 * rnd(), w = 0.6 + 0.6 * rnd(); C3.setHSL(0.24, 0.5, 0.24 + 0.05 * rnd()); return [p[0], y + H(p[0], p[1]) - 0.02, p[1], rnd() * 6, [w / kw, h / kh, w * (0.6 + 0.4 * rnd()) / kw], SEAS(C3, 1.2)]; }, { key: 'plain', cast: false, detail: 300 });
  if (sh.length) chunked(C, o, L3D.geo(L3D.ext && L3D.ext.has && L3D.ext.has('bush') ? 'bush' : 'understory'), sh, p => { const sc = 0.6 + 0.4 * rnd(); C3.setHSL(0.27, 0.35, 0.2 + 0.07 * rnd()); return [p[0] + rnd() * 0.3, y + H(p[0], p[1]), p[1] + rnd() * 0.3, rnd() * 6, clampSc(L3D.ext && L3D.ext.has && L3D.ext.has('bush') ? 'bush' : 'understory', [sc, sc, sc]), SEAS(C3, 0.6)]; }, { key: 'plain', detail: 160 }); }
  /* [R36e] the ext cypress-knees GLB renders untextured WHITE at 1.2 in across (these were the white tufts by the pond): scale 0.55 and tint bark brown */ const KXT = !!(L3D.ext && L3D.ext.has && L3D.ext.has('cypress-knees')); chunked(C, o, L3D.geo('cypress-knees'), knees, p => { const sc = KXT ? 0.5 + 0.1 * rnd() : 1; if (KXT) C3.setHSL(0.07, 0.2, 0.3 + 0.05 * rnd()); return KXT ? [p[0], y + Math.min(H(p[0], p[1]), T ? T.cfg.waterLevel : 0) - 0.03, p[1], rnd() * 6, [sc, sc, sc], C3] : [p[0], y + Math.min(H(p[0], p[1]), T ? T.cfg.waterLevel : 0) - 0.03, p[1], rnd() * 6, [1, 1, 1]]; }, { key: 'plain', detail: 40 });
  chunked(C, o, L3D.geo('spanish-moss'), mossI, p => { C3.set('#9aa48a'); return [p[0], y + H(p[0], p[1]) + p[2], p[1], rnd() * 6, [1, 0.9 + 0.2 * rnd(), 1], C3]; }, { key: 'plain', detail: 160 });
  chunked(C, o, L3D.geo('cattails'), catt, p => { const sc = 0.35 + 0.12 * rnd(); C3.setHSL(0.2, 0.4, 0.32 + 0.08 * rnd()); return [p[0], y + Math.max(H(p[0], p[1]), T ? T.cfg.waterLevel - 0.02 : 0), p[1], rnd() * 6, [sc, sc, sc], SEAS(C3, 1)]; }, { key: 'plain', detail: 120 });
  chunked(C, o, L3D.geo('grass-tuft'), tufts, p => { const sc = 0.8 + 0.6 * rnd(); C3.setHSL(0.22 + 0.05 * rnd(), 0.45, 0.3 + 0.1 * rnd()); return [p[0], y + H(p[0], p[1]), p[1], rnd() * 6, [sc, sc, sc], SEAS(C3, 1)]; }, { key: 'plain', detail: 26, cell: 64 });
  /* [R36e] the ext wildflowers GLB renders untextured (white) at 0.6 x 0.28 in (8 ft patch, 3.7 ft tall): scale it to ~0.1 in and tint it */ const WFX = !!(L3D.ext && L3D.ext.has && L3D.ext.has('wildflowers')); chunked(C, o, L3D.geo('wildflowers'), flowers, p => { if (!WFX) return [p[0], y + H(p[0], p[1]), p[1], rnd() * 6, [1, 1, 1]]; const sc = 0.32 + 0.08 * rnd(); C3.setHSL([0.14, 0.2, 0.8, 0.02][(rnd() * 4) | 0], 0.5, 0.45); return [p[0], y + H(p[0], p[1]), p[1], rnd() * 6, [sc, sc, sc], C3]; }, { key: 'plain', detail: 26, cell: 64 });
  for (const [k, list] of Object.entries(crops)) { N.crops += list.length; for (const [G, od] of [[L3D.geo(k), { detail: 3.5, cell: 12 }], [L3D.geo('crop-lo'), { detail: 50, near: 3.5, cell: 64 }]]) chunked(C, o, G, list, p => { const hh = { 'crop-tobacco': 0.27, 'crop-cotton': 0.22, 'crop-soy': 0.14, 'crop-corn': 0.55 }[k] * (0.9 + 0.2 * rnd()); C3.setHSL(k === 'crop-corn' ? 0.2 : 0.25, 0.5, k === 'crop-tobacco' ? 0.36 : 0.3);
    return [p[0], y + H(p[0], p[1]), p[1], -p[2], [hh, hh, hh], SEAS(C3, 1.3)]; }, Object.assign({ key: 'plain' }, od)); }
  // sparse rocks on the higher ground only (coastal plain is flat)
  const rocks = []; if (T) for (let k = 0; k < 40 && rocks.length < 6; k++) { const x = T.x0 + rnd() * T.nx * T.step, z = T.z0 + rnd() * T.nz * T.step, p = gi(x, z); if (T.board[p] && T.H[p] > 0.5 && free(x, z, 1)) rocks.push([x, z]); }
  chunked(C, o, L3D.geo('rock'), rocks, p => { const sc = 0.15 + 0.2 * rnd(); C3.set('#a09a90'); return [p[0], y + H(p[0], p[1]) - 0.03, p[1], rnd() * 6, [sc, sc, sc], C3]; }, { key: 'plain', detail: 120 });
};
// ------------------------------------------------------------------ planning checks (terrain_check.py reads this via headless Chrome)
L3D.terrainReport = (ctx) => {
  const out = { levels: [] };
  for (const o of TR.levels) { const T = o.terrain, L = o.L, N = o.nature || { trees: [], rej: {} }, R = { level: L.id, issues: [], stats: {} }, iss = (k, m, at) => R.issues.push({ kind: k, msg: m, at: at && at.map(v => +v.toFixed(1)) });
    // 1. grade under track = 0 (levels are flat)
    let mx = 0, at = null; const pts = []; for (const t of L.tracks) pts.push(...L3D.resample(t.pts, 1)); for (const p of pts) { for (const off of [0, 0.4, -0.4]) { const v = Math.abs(T.h(p[0], p[1] + off)); if (v > mx) { mx = v; at = p; } } }
    R.stats.maxTerrainUnderTrack_in = +mx.toFixed(3); if (mx > 0.01) iss('grade', `terrain ${mx.toFixed(3)} in off level under/beside track (roadbed base must be 0)`, at);
    // 2. vegetation clearance
    let bad = 0; for (const t of N.trees) { const d = ctx.trackDist(o, t.x, t.z, 3), need = L3D.nature.clearNeed(t.sp, t.H); if (d < need) { bad++; if (bad <= 10) iss('clearance', `${t.sp} ${t.H.toFixed(1)} in tall only ${d.toFixed(2)} in from track (needs ${need.toFixed(2)})`, [t.x, t.z]); } }
    for (const b of (N.kudzu || [])) { const d = ctx.trackDist(o, b[0], b[1], 3); if (d < 1.2) iss('clearance', `kudzu ${d.toFixed(2)} in from track`, b); }
    R.stats.trees = N.trees.length; R.stats.treesSkippedForClearance = N.rej.clearance || 0; R.stats.treesFouling = bad; R.stats.crops = N.crops || 0; R.stats.cattails = (N.cattails || []).length;
    // 3. sight lines at road crossings: 250 ft (18.75 in) along track x 50 ft (3.75 in) along road, each quadrant; obstructions > 0.25 in (3.5 ft)
    const trianglesHit = []; for (const [gi2, g] of (L.gates || []).entries()) { const v = ctx.nearestTrack(o, g.x, g.y, 3); if (!v) continue; const tx = v[2], tz = v[3], rx = -tz, rz = tx;
      for (const st of [1, -1]) for (const sr of [1, -1]) { const A = [v[0], v[1]], B = [v[0] + tx * st * 18.75, v[1] + tz * st * 18.75], Cc = [v[0] + rx * sr * 3.75, v[1] + rz * sr * 3.75], tri = [A, B, Cc];
        const hits = []; for (const t of N.trees) if (L3D.inPoly(t.x, t.z, tri) && Math.hypot(t.x - A[0], t.z - A[1]) > 0.8) hits.push(t.sp);
        for (const s of L.structures) { const cx = (s.r[0] + s.r[2]) / 2, cz = (s.r[1] + s.r[3]) / 2; if (s.h > 0.25 && L3D.inPoly(cx, cz, tri)) hits.push('structure ' + (s.name || s.kind)); }
        if (hits.length) { trianglesHit.push(1); iss('sightline', `crossing #${gi2 + 1} (${g.kind}) quadrant ${st > 0 ? '+' : '-'}track/${sr > 0 ? '+' : '-'}road blocked by ${hits.length} (${[...new Set(hits)].slice(0, 3).join(', ')})`, [g.x, g.y]); } } }
    R.stats.crossings = (L.gates || []).length; R.stats.blockedQuadrants = trianglesHit.length;
    // 4. drainage sanity: ponding lows outside water/ditches, ditch outlets, culverts
    const { nx, nz, H, board, cat, water } = T; let ponds = 0; const pondAt = []; for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) { const p = k * nx + i; if (!board[p] || water[p] || cat[p] === 3 || T.flat[p]) continue; const h = H[p]; let low = true; for (const q of [p - 1, p + 1, p - nx, p + nx, p - nx - 1, p - nx + 1, p + nx - 1, p + nx + 1]) if (!board[q] || H[q] <= h + 0.003) { low = false; break; } if (low && h < -0.05) { ponds++; if (pondAt.length < 5) pondAt.push([T.X(i), T.Z(k)]); } }
    R.stats.pondingLows = ponds; if (ponds > 0) pondAt.forEach(p => iss('drainage', 'closed low spot (would pond) - grade to ditch/water or accept as wet area', p));
    let ditch = 0, ditchOut = 0; for (let p = 0; p < nx * nz; p++) if (cat[p] === 3) { ditch++; if (T.dW[p] < 2 || T.road[p - 1] || T.road[p + 1] || !board[p - 1] || !board[p + 1]) ditchOut++; }
    R.stats.ditchCells = ditch; R.stats.culverts = T.culverts.length; R.stats.ditchOutletCells = ditchOut; if (ditch && !ditchOut && !T.culverts.length) iss('drainage', 'ditches have no outlet (no water, culvert or board edge reached)');
    // 5. backdrop transitions: terrain height along backdrops; flat features hard against the backdrop
    let bdN = 0, hs = []; for (const [a, b] of o.backdrops || []) for (const p of L3D.resample([a, b], 2)) { const n = [(b[1] - a[1]), -(a[0] - b[0])]; const l = Math.hypot(n[0], n[1]) || 1; let q = null; for (const s of [1, -1]) { const x = p[0] + n[0] / l * s * 0.4, z = p[1] + n[1] / l * s * 0.4; if (ctx.onBoard(o, x, z)) q = [x, z]; } if (!q) continue; bdN++; hs.push(T.h(q[0], q[1]));
      if (ctx.trackDist(o, q[0], q[1], 1.2) < 1.0) iss('backdrop', 'track within 1 in of the backdrop: use a low-relief flat/cut or treeline to hide the joint', q); }
    if (hs.length) { R.stats.backdropTerrain_in = { min: +Math.min(...hs).toFixed(2), mean: +(hs.reduce((a, b) => a + b, 0) / hs.length).toFixed(2), max: +Math.max(...hs).toFixed(2) }; if (Math.max(...hs) > 2) iss('backdrop', 'terrain > 2 in high at backdrop (check backdrop horizon line)'); }
    // 6. water vs track
    let wet = 0; for (const p of pts) if (T.dW[Math.max(0, Math.round((p[1] - T.z0) / T.step) * nx + Math.round((p[0] - T.x0) / T.step))] < 0.6) wet++; if (wet) iss('water', `${wet} track sample(s) within 0.6 in of water - check fill/riprap and bridge`, null);
    // de-dup sightline/backdrop spam
    const seen = {}; R.issues = R.issues.filter(i => { const k = i.kind + i.msg.slice(0, 40) + (i.at || []).join(); if (seen[k]) return false; seen[k] = 1; return true; });
    out.levels.push(R); }
  return out;
};
})(window.L3D);
