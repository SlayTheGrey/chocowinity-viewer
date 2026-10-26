/* [REALISM 2026-10-19] likeness pass: procedural models rebuilt against prototype photos (see (build path) + contact sheets).
   Trees: species architecture (trunk taper, limb structure, crown profile, clustered foliage, baked self-shade) at unit height 1;
   ':crown' (instance tint) and ':trunk' (baked bark, drawn white) variants so trunks are not tinted green; ':lo' low-poly far LOD. */
'use strict';
(function (L3D) {
const { part, merge, BOX, CYL, col } = L3D, PI = Math.PI, V3 = THREE.Vector3;
const R = seed => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 1 | s), s = (s + Math.imul(s ^ (s >>> 7), 61 | s)) ^ s, ((s ^ (s >>> 14)) >>> 0) / 4294967296)); };
const UP = new V3(0, 1, 0);
// geometry placed along a direction (CYL/CONE are along +Y): from point a to point b
const seg = (a, b, r0, r1, c, n = 5) => { const d = new V3().subVectors(b, a), L = d.length(); const g = CYL(r1, r0, L, n, 1, true); g.translate(0, L / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize())); g.translate(a.x, a.y, a.z); const gi = g.index ? g.toNonIndexed() : g; if (gi.attributes.uv) gi.deleteAttribute('uv'); return L3D.vcol(gi, col(c)); };
// foliage clump: jittered low icosahedron, flattened, per-vertex self-shade (dark underside / inner, light top)
let CDET = 0; /* [UX1] near-LOD crowns use subdivided (det 1) clumps: round silhouettes instead of 20-face facets */
const clump = (rng, x, y, z, r, sy = 0.7, sh = [0.62, 1.0], det = CDET) => { const g0 = new THREE.IcosahedronGeometry(r, det), g = g0.toNonIndexed(); const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3); const k = 0.25;
  const jit = new Map(); for (let i = 0; i < n; i++) { const key = p.getX(i).toFixed(4) + p.getY(i).toFixed(4) + p.getZ(i).toFixed(4); if (!jit.has(key)) jit.set(key, 1 + (rng() - 0.5) * 2 * k); const j = jit.get(key); p.setXYZ(i, p.getX(i) * j, p.getY(i) * j * sy, p.getZ(i) * j); }
  const base = 0.85 + 0.3 * (rng() - 0.5); for (let i = 0; i < n; i++) { const t = (p.getY(i) / (r * sy) + 1) / 2, v = (sh[0] + (sh[1] - sh[0]) * t) * base; c[3 * i] = c[3 * i + 1] = c[3 * i + 2] = Math.min(1, v); p.setXYZ(i, p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); if (g.attributes.uv) g.deleteAttribute('uv');
  /* soft foliage shading: normals point out from the clump centre (blended toward up) instead of flat facets */
  const nn = g.attributes.normal, v = new V3(); for (let i = 0; i < n; i++) { v.set(p.getX(i) - x, (p.getY(i) - y) / Math.max(sy, 0.3) + r * 0.35, p.getZ(i) - z).normalize(); nn.setXYZ(i, v.x, v.y, v.z); } nn.needsUpdate = true; return g; };
const pt = (r, a, y) => new V3(Math.cos(a) * r, y, Math.sin(a) * r);
const GA = 2.39996;
/* species builders -> { crown: [geos], wood: [geos] } at unit height 1 */
const SPEC = {
  // loblolly pine: clear self-pruned trunk to ~55-60 %, compact oval crown ~0.32 H wide of upturned branches ending in flattened needle tufts; a few dead stubs below
  'tree-pine': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.95, 0), 0.016, 0.004, '#7a5c46', lo ? 4 : 6)], C = []; const cb = 0.56, N = lo ? 7 : 15;
    for (let i = 0; i < 4 && !lo; i++) { const y = 0.36 + 0.05 * i, a = i * GA * 1.3; W.push(seg(new V3(0, y, 0), pt(0.05, a, y + 0.01), 0.003, 0.0015, '#6a6058', 3)); }
    for (let i = 0; i < N; i++) { const f = i / (N - 1), y = cb + (0.97 - cb) * f, Rm = 0.165 * Math.pow(Math.sin(PI * Math.min(0.96, 0.12 + f * 0.88)), 0.75) + 0.02, a = i * GA + rng() * 0.5, L = Rm * (0.75 + 0.35 * rng());
      const e = pt(L, a, y + L * 0.35); if (!lo) W.push(seg(new V3(0, y, 0), e, 0.004, 0.002, '#6a5040', 3));
      C.push(clump(rng, e.x, e.y, e.z, 0.055 + 0.02 * rng(), 0.55)); if (!lo && L > 0.1) { const m = pt(L * 0.55, a + 0.25, y + L * 0.2); C.push(clump(rng, m.x, m.y, m.z, 0.045 + 0.015 * rng(), 0.6, [0.5, 0.85])); } }
    C.push(clump(rng, 0, 0.97, 0, 0.05, 0.9)); return { crown: C, wood: W }; },
  // longleaf: very straight slender trunk to the top, open sparse crown in the top third, few long crooked limbs with big terminal tufts (foxtail look)
  'tree-longleaf': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.96, 0), 0.014, 0.004, '#9a6a4a', lo ? 4 : 6)], C = []; const N = lo ? 5 : 8;
    for (let i = 0; i < N; i++) { const f = i / (N - 1), y = 0.66 + 0.28 * f, a = i * GA + rng(), L = (0.17 - 0.08 * f) * (0.8 + 0.4 * rng()); const m = pt(L * 0.5, a + 0.3 * (rng() - 0.5), y + 0.03), e = pt(L, a, y + 0.02 + 0.06 * rng());
      if (!lo) { W.push(seg(new V3(0, y, 0), m, 0.0045, 0.003, '#6a5040', 3), seg(m, e, 0.003, 0.002, '#6a5040', 3)); }
      C.push(clump(rng, e.x, e.y + 0.015, e.z, 0.05 + 0.015 * rng(), 0.75)); if (!lo) C.push(clump(rng, (m.x + e.x) / 2, (m.y + e.y) / 2 + 0.02, (m.z + e.z) / 2, 0.035, 0.8, [0.55, 0.9])); }
    C.push(clump(rng, 0, 0.965, 0, 0.045, 1.0)); return { crown: C, wood: W }; },
  // water / white oak: short bole forking ~1/3 up into 3-4 ascending limbs; broad irregular rounded crown ~0.85 H wide; clumps on the shell
  'tree-oak': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.34, 0), 0.034, 0.024, '#5e564e', lo ? 5 : 7)], C = []; const NL = 4;
    for (let i = 0; i < NL; i++) { const a = i * 2 * PI / NL + rng() * 0.6, e = pt(0.2 + 0.08 * rng(), a, 0.62 + 0.1 * rng()); W.push(seg(new V3(0, 0.32, 0), e, 0.018, 0.008, '#5e564e', lo ? 3 : 5)); }
    const N = lo ? 10 : 30; for (let i = 0; i < N; i++) { const u = (i + 0.5) / N, phi = Math.acos(1 - 1.6 * u), a = i * GA; const rx = 0.38 * (0.9 + 0.2 * rng()), ry = 0.37;
      const x = Math.cos(a) * Math.sin(phi) * rx, z = Math.sin(a) * Math.sin(phi) * rx, y = 0.6 + Math.cos(phi) * ry; C.push(clump(rng, x, y, z, (lo ? 0.17 : 0.12) + 0.04 * rng(), 0.8, [0.5, 1.0])); }
    if (!lo) for (let i = 0; i < 4; i++) C.push(clump(rng, (rng() - 0.5) * 0.3, 0.55 + 0.1 * rng(), (rng() - 0.5) * 0.3, 0.17, 0.8, [0.35, 0.6]));
    return { crown: C, wood: W }; },
  // southern live oak: massive short trunk, 5-6 huge near-horizontal sinuous limbs, low broad flat-topped dome ~1.7 H wide, dense dark evergreen
  'tree-oak-live': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.2, 0), 0.075, 0.06, '#4e4842', lo ? 6 : 8)], C = []; const NL = lo ? 4 : 6;
    for (let i = 0; i < NL; i++) { const a = i * 2 * PI / NL + rng() * 0.5, m = pt(0.32 + 0.1 * rng(), a, 0.36 + 0.08 * rng()), e = pt(0.68 + 0.12 * rng(), a + 0.2, 0.4 + 0.1 * rng()); W.push(seg(new V3(0, 0.18, 0), m, 0.035, 0.024, '#4e4842', 5), seg(m, e, 0.024, 0.01, '#4e4842', 4)); }
    const N = lo ? 12 : 34; for (let i = 0; i < N; i++) { const u = (i + 0.5) / N, phi = Math.acos(1 - 1.3 * u), a = i * GA; const rx = 0.82 * (0.85 + 0.25 * rng());
      C.push(clump(rng, Math.cos(a) * Math.sin(phi) * rx, 0.5 + Math.cos(phi) * 0.34 - (phi > 1.2 ? 0.06 : 0), Math.sin(a) * Math.sin(phi) * rx, (lo ? 0.24 : 0.17) + 0.05 * rng(), 0.55, [0.45, 0.95])); }
    return { crown: C, wood: W }; },
  // red maple: upright oval crown ~0.55 H wide, trunk to ~0.3 with ascending limbs
  'tree-maple': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.36, 0), 0.024, 0.016, '#7c7670', lo ? 4 : 6)], C = [];
    for (let i = 0; i < 3; i++) { const a = i * 2.1 + rng(), e = pt(0.12, a, 0.66); W.push(seg(new V3(0, 0.34, 0), e, 0.012, 0.006, '#7c7670', 4)); }
    const N = lo ? 9 : 24; for (let i = 0; i < N; i++) { const u = (i + 0.5) / N, phi = Math.acos(1 - 1.75 * u), a = i * GA; const x = Math.cos(a) * Math.sin(phi) * 0.26, z = Math.sin(a) * Math.sin(phi) * 0.26, y = 0.64 + Math.cos(phi) * 0.34; C.push(clump(rng, x, y, z, (lo ? 0.13 : 0.085) + 0.03 * rng(), 0.8, [0.55, 1.0])); }
    return { crown: C, wood: W }; },
  // sweetgum: excurrent (trunk runs to the top), pyramidal-to-oval crown from ~0.25 H, short horizontal branches
  'tree-sweetgum': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.96, 0), 0.02, 0.004, '#5e544a', lo ? 4 : 6)], C = []; const N = lo ? 10 : 32;
    for (let i = 0; i < N; i++) { const f = i / (N - 1), y = 0.27 + 0.68 * f, Rm = 0.25 * Math.pow(1 - f, 0.8) * Math.min(1, (f + 0.15) * 3.5) + 0.03, a = i * GA + rng() * 0.4, e = pt(Rm, a, y + 0.03);
      if (!lo && Rm > 0.08) W.push(seg(new V3(0, y, 0), e, 0.006, 0.003, '#5e544a', 3)); C.push(clump(rng, e.x, e.y, e.z, (lo ? 0.12 : 0.085) + 0.025 * rng(), 0.85, [0.55, 1.0])); if (!lo && Rm > 0.1) C.push(clump(rng, e.x * 0.45, e.y - 0.02, e.z * 0.45, 0.08, 0.85, [0.4, 0.7])); }
    C.push(clump(rng, 0, 0.95, 0, 0.05, 1.1)); return { crown: C, wood: W }; },
  // eastern red cedar: dense narrow cone/column to the ground, irregular, ~0.35 H wide
  'tree-cedar': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.9, 0), 0.02, 0.004, '#7a5442', 4)], C = []; const NL = lo ? 5 : 11;
    for (let i = 0; i < NL; i++) { const f = i / (NL - 1), y = 0.1 + 0.82 * f, Rm = 0.15 * Math.pow(1 - f, 0.8) + 0.025, nb = lo ? 2 : (f < 0.7 ? 4 : 2);
      for (let k = 0; k < nb; k++) { const a = k * 2 * PI / nb + i * 1.1, e = pt(Rm * 0.55, a, y); C.push(clump(rng, e.x, e.y, e.z, Rm * 0.75 + 0.02, 1.25, [0.5, 0.95])); } }
    C.push(clump(rng, 0, 0.94, 0, 0.035, 1.6)); return { crown: C, wood: W }; },
  // bald cypress: buttressed flared base, straight trunk to the top, narrow irregular crown that flattens on top, feathery horizontal sprays
  'tree-cypress': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.14, 0), 0.075, 0.022, '#6e6458', lo ? 6 : 8), seg(new V3(0, 0.13, 0), new V3(0, 0.95, 0), 0.022, 0.006, '#6e6458', lo ? 4 : 6)], C = []; const N = lo ? 8 : 20;
    for (let i = 0; i < N; i++) { const f = i / (N - 1), y = 0.42 + 0.53 * f, Rm = (0.1 + 0.07 * Math.sin(PI * Math.min(1, f * 1.3))) * (0.75 + 0.5 * rng()), a = i * GA, e = pt(Rm, a, y - 0.02);
      if (!lo) W.push(seg(new V3(0, y, 0), e, 0.004, 0.002, '#7a6252', 3)); C.push(clump(rng, e.x * 0.8, e.y, e.z * 0.8, (lo ? 0.1 : 0.08) + 0.02 * rng(), 0.55, [0.55, 1.0])); if (!lo) C.push(clump(rng, e.x * 0.35, e.y + 0.03, e.z * 0.35, 0.06, 0.7, [0.45, 0.8])); }
    C.push(clump(rng, 0, 0.94, 0, 0.09, 0.35)); return { crown: C, wood: W }; },
  // young hardwood / sapling: thin stem, small oval crown
  'tree-young': (rng, lo) => { const W = [seg(new V3(0, 0, 0), new V3(0, 0.6, 0), 0.012, 0.006, '#6e6660', 4)], C = []; const N = lo ? 6 : 18;
    for (let i = 0; i < N; i++) { const u = (i + 0.5) / N, phi = Math.acos(1 - 1.8 * u), a = i * GA; C.push(clump(rng, Math.cos(a) * Math.sin(phi) * 0.2, 0.66 + Math.cos(phi) * 0.3, Math.sin(a) * Math.sin(phi) * 0.2, 0.09 + 0.03 * rng(), 0.85)); }
    return { crown: C, wood: W }; },
};
const SEED = { 'tree-pine': 41, 'tree-longleaf': 80, 'tree-oak': 11, 'tree-oak-live': 111, 'tree-maple': 21, 'tree-sweetgum': 101, 'tree-cedar': 61, 'tree-cypress': 51, 'tree-young': 31 };
const NAMES = { 'tree-pine': 'Loblolly pine', 'tree-longleaf': 'Longleaf pine', 'tree-oak': 'Water / white oak', 'tree-oak-live': 'Southern live oak', 'tree-maple': 'Red maple', 'tree-sweetgum': 'Sweetgum', 'tree-cedar': 'Eastern red cedar', 'tree-cypress': 'Bald cypress', 'tree-young': 'Young hardwood' };
/* [UX1] clumped sub-crowns: broadleaf crowns are pulled toward K lobe centres on the crown shell (real oaks/maples/gums show separate
   foliage masses with sky gaps between them, not one smooth ball). k = pull strength, K = lobe count */
const LOBE = { 'tree-oak': [5, 0.38], 'tree-maple': [4, 0.3], 'tree-sweetgum': [4, 0.28], 'tree-young': [3, 0.3], 'tree-oak-live': [6, 0.32], 'tree-cypress': [4, 0.3] };
function lobes(rng, C, [K, k]) { const bb = new THREE.Box3(), tb = new THREE.Box3(), c = new V3(), sz = new V3(); for (const g of C) { g.computeBoundingBox(); bb.union(g.boundingBox); } bb.getCenter(c); bb.getSize(sz);
  const L = []; for (let i = 0; i < K; i++) { const a = i * 2 * PI / K + rng() * 0.8, up = rng(); L.push(new V3(c.x + Math.cos(a) * sz.x * 0.3, c.y + (up - 0.35) * sz.y * 0.45, c.z + Math.sin(a) * sz.z * 0.3)); }
  for (const g of C) { tb.copy(g.boundingBox); const m = tb.getCenter(new V3()); let best = L[0], bd = 1e9; for (const p of L) { const d = p.distanceToSquared(m); if (d < bd) { bd = d; best = p; } } const d = best.clone().sub(m).multiplyScalar(k); g.translate(d.x, d.y, d.z); } }
L3D.TREE_V = 3; // number of shape variants per species (instances pick one)
L3D.treeParts = {};
for (const [id, fn] of Object.entries(SPEC)) { const H = (L3D.assets[id] && L3D.assets[id].h_in) || [3, 4.5];
  const built = {}; const get = (v, lo) => { const k = v + (lo ? 'l' : 'h'); if (built[k]) return built[k]; CDET = lo ? 0 : 1; const rng = R(SEED[id] * 7919 + v * 131 + (lo ? 17 : 0)), b = fn(rng, lo); CDET = 0; if (LOBE[id]) lobes(rng, b.crown, LOBE[id]); return (built[k] = b); };
  for (let v = 0; v < L3D.TREE_V; v++) { const sfx = v ? '#' + v : '';
    L3D.defGeo(id + sfx + ':crown', { name: NAMES[id] + ' crown', internal: true }, () => merge(get(v, false).crown));
    L3D.defGeo(id + sfx + ':trunk', { name: NAMES[id] + ' trunk', internal: true }, () => merge(get(v, false).wood));
    L3D.defGeo(id + sfx + ':crownlo', { name: NAMES[id] + ' crown (far)', internal: true }, () => merge(get(v, true).crown));
    L3D.defGeo(id + sfx + ':trunklo', { name: NAMES[id] + ' trunk (far)', internal: true }, () => merge(get(v, true).wood)); }
  // full tree (crown + wood) keeps the old id for every other caller (fallback viewer path, gallery, part-1-only)
  L3D.defGeo(id, Object.assign({}, L3D.assets[id] || {}, { name: NAMES[id] + ' (realism rebuild)', h_in: H }), () => merge(get(0, false).crown.map(g => g.clone()).concat(get(0, false).wood.map(g => g.clone()))), () => merge(get(0, true).crown.map(g => g.clone()).concat(get(0, true).wood.map(g => g.clone())))); }
/* combined crown + trunk in ONE geometry for the tree material: trunk vertex colours are stored negative = "baked, not tinted" */
const neg = g => { const c = g.attributes.color.array; for (let i = 0; i < c.length; i++) c[i] = -Math.max(c[i], 0.004); return g; };
for (const id of Object.keys(SPEC)) for (const sfx of ['', '#1']) {
  L3D.defGeo(id + sfx + ':t', { name: NAMES[id] + ' (tree material)', internal: true }, () => merge(L3D.geo(id + sfx + ':crown').clone ? [L3D.geo(id + sfx + ':crown').clone(), neg(L3D.geo(id + sfx + ':trunk').clone())] : []));
  L3D.defGeo(id + sfx + ':tlo', { name: NAMES[id] + ' (tree material, far)', internal: true }, () => merge([L3D.geo(id + sfx + ':crownlo').clone(), neg(L3D.geo(id + sfx + ':trunklo').clone())])); }
let TM = null; L3D.treeMat = () => TM || (TM = (() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `vColor = vec3(1.0);
#ifdef USE_COLOR
  vColor *= abs(color);
#endif
#ifdef USE_INSTANCING_COLOR
  if (color.r >= 0.0) vColor.xyz *= instanceColor.xyz;
#endif`); }; m.customProgramCacheKey = () => 'l3d-tree'; return m; })());
/* species colour for mid-October eastern NC (early fall): pines/cedar/live oak evergreen, red maple + sweetgum turning, oaks mostly green */
const PAL = { 'tree-pine': [[1, '#4d6a35']], 'tree-longleaf': [[1, '#587236']], 'tree-cedar': [[1, '#3c5534']], 'tree-oak-live': [[1, '#4a5d36']],
  'tree-oak': [[0.72, '#58713a'], [0.16, '#77773a'], [0.12, '#8a6a3a']], 'tree-maple': [[0.38, '#b23a24'], [0.24, '#c66a2a'], [0.16, '#c8a038'], [0.22, '#68793a']],
  'tree-sweetgum': [[0.3, '#66783a'], [0.2, '#b89a34'], [0.24, '#bf6a2a'], [0.16, '#8a2c2a'], [0.1, '#6a2c3e']], 'tree-cypress': [[0.68, '#6e7d40'], [0.32, '#9a7a3c']],
  'tree-young': [[0.6, '#68823a'], [0.2, '#a8902e'], [0.2, '#b0602a']] };
L3D.likeness_treeTint = (sp, rnd, c) => { const P = PAL[sp]; if (!P) return null; let u = rnd(), hx = P[P.length - 1][1]; for (const [w, h] of P) { if ((u -= w) <= 0) { hx = h; break; } }
  c.set(hx); const k = 0.88 + 0.26 * rnd(); c.multiplyScalar(k); const fall = (L3D.terrain && L3D.terrain.season) || 'summer'; if (fall === 'summer' && P.length > 1) c.set(P[P.length - 1][1] === '#6a2c3e' ? '#5e7438' : '#5e7438').multiplyScalar(k); return c; };
L3D.likeness = { R, seg, clump, pt, SPEC, PAL };
})(window.L3D);
/* ---------------------------------------------------------------- horses + people (true 1:160 proportions, built from tapered limbs and ellipsoids) */
(function (L3D) {
const { merge, col } = L3D, V3 = THREE.Vector3, UP = new V3(0, 1, 0), CYL = (a, b, h, n) => new THREE.CylinderGeometry(a, b, h, n, 1, false);
/* white parts take the instance tint (coat, shirt); every other colour is baked: stored negative for L3D.treeMat (L3D.bakedMat) */
const fin = (g, c) => { g = g.index ? g.toNonIndexed() : g; if (g.attributes.uv) g.deleteAttribute('uv'); L3D.vcol(g, col(c)); if (c !== '#ffffff' && L3D.BAKE_NEG) { const a = g.attributes.color.array; for (let i = 0; i < a.length; i++) a[i] = -Math.max(a[i], 0.004); } return g; };
L3D.BAKE_NEG = true; L3D.bakedMat = () => L3D.treeMat();
// tapered limb a->b, radius r0 at a, r1 at b, flattened by sz across (local z)
const limb = (a, b, r0, r1, c, n = 6, sz = 1, sx = 1) => { const d = new V3().subVectors(b, a), L = d.length(); const g = CYL(r1, r0, L, n); g.scale(sx, 1, sz); g.translate(0, L / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize())); g.translate(a.x, a.y, a.z); return fin(g, c); };
const ell = (x, y, z, rx, ry, rz, c, w = 10, h = 7, rot = 0) => { const g = new THREE.SphereGeometry(1, w, h); g.scale(rx, ry, rz); if (rot) g.rotateZ(rot); g.translate(x, y, z); return fin(g, c); };
const box = (x, y, z, w, h, d, c, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); g.translate(x, y, z); return fin(g, c); };
const v = (x, y, z = 0) => new V3(x, y, z);
/* HORSE, ~15.2 hands (62 in = 0.39 in at the withers), 8 ft nose-to-tail (0.6 in); +x = head. Coat white = instance tint; mane, tail, lower legs, hooves baked. */
const DARK = '#2b2320', HOOF = '#3a3430';
function horse(pose, rider) { const P = [], coat = '#ffffff', grz = pose === 'graze';
  // barrel: chest + belly + hindquarters (deep chest, rounded croup)
  P.push(ell(0.0, 0.305, 0, 0.17, 0.088, 0.066, coat, 12, 8), ell(0.115, 0.31, 0, 0.085, 0.092, 0.064, coat, 10, 7), ell(-0.125, 0.318, 0, 0.09, 0.086, 0.07, coat, 10, 7), ell(0.15, 0.255, 0, 0.05, 0.05, 0.05, coat, 8, 6));
  // neck (thick at the shoulder, flat-sided), head (wedge, ~0.15 in long), ears, mane
  const w0 = v(0.14, 0.355), n1 = grz ? v(0.28, 0.17) : v(0.255, 0.495), h1 = grz ? v(0.31, 0.03) : v(0.35, 0.405);
  P.push(limb(w0, n1, 0.05, 0.03, coat, 8, 0.62), ell(w0.x + 0.005, w0.y + 0.0, 0, 0.045, 0.045, 0.036, coat, 8, 6));
  P.push(limb(n1, h1, 0.03, 0.017, coat, 8, 0.65), ell(n1.x, n1.y, 0, 0.032, 0.028, 0.024, coat, 8, 6), ell(h1.x, h1.y, 0, 0.018, 0.017, 0.015, coat, 8, 5));
  P.push(ell(h1.x + (grz ? 0.002 : 0.004), h1.y + (grz ? -0.002 : -0.003), 0, 0.012, 0.01, 0.011, DARK, 6, 4)); // muzzle
  for (const s of [-1, 1]) P.push(limb(v(n1.x - 0.005, n1.y + 0.022, s * 0.012), v(n1.x - 0.014, n1.y + (grz ? 0.035 : 0.048), s * 0.016), 0.007, 0.002, coat, 4));
  P.push(limb(v(w0.x - 0.01, w0.y + 0.055), v(n1.x - 0.018, n1.y + 0.022), 0.009, 0.006, DARK, 4, 0.5)); // mane crest
  // legs: front straight (elbow, knee, cannon, fetlock, hoof); hind with the stifle forward and the hock pointing back
  for (const s of [-1, 1]) { const z = s * 0.042;
    P.push(limb(v(0.13, 0.25, z), v(0.135, 0.13, z), 0.024, 0.014, coat, 6), limb(v(0.135, 0.13, z), v(0.137, 0.03, z), 0.011, 0.01, DARK, 5), ell(0.137, 0.13, z, 0.014, 0.016, 0.013, coat, 6, 4));
    P.push(limb(v(-0.12, 0.29, z), v(-0.165, 0.145, z), 0.036, 0.016, coat, 6, 0.8), limb(v(-0.165, 0.145, z), v(-0.155, 0.03, z), 0.012, 0.01, DARK, 5), ell(-0.166, 0.145, z, 0.014, 0.017, 0.013, DARK, 6, 4));
    for (const x of [0.139, -0.153]) P.push(limb(v(x, 0.03, z), v(x + 0.006, 0.0, z), 0.012, 0.015, HOOF, 6)); }
  // tail: dock from the croup, hair falling to the hocks
  P.push(limb(v(-0.205, 0.375), v(-0.235, 0.31), 0.014, 0.012, DARK, 5), limb(v(-0.235, 0.31), v(-0.245, 0.16), 0.016, 0.007, DARK, 5, 0.6));
  if (rider) { // western saddle + pad, rider (jeans, shirt, hat) seated with legs down the sides
    P.push(box(0.03, 0.396, 0, 0.11, 0.012, 0.09, '#3a2a1e'), box(0.07, 0.41, 0, 0.018, 0.03, 0.03, '#3a2a1e'));
    for (const s of [-1, 1]) { const z = s * 0.06; P.push(limb(v(0.02, 0.405, s * 0.03), v(0.06, 0.33, z), 0.017, 0.013, '#33425e', 6), limb(v(0.06, 0.33, z), v(0.045, 0.235, z), 0.013, 0.01, '#33425e', 6), box(0.055, 0.226, z, 0.04, 0.016, 0.022, '#3a2a1e')); }
    P.push(limb(v(0.015, 0.405), v(0.025, 0.545), 0.04, 0.05, '#7a4b3a', 8, 1, 0.6)); // torso (shirt)
    for (const s of [-1, 1]) P.push(limb(v(0.03, 0.535, s * 0.05), v(0.075, 0.475, s * 0.055), 0.012, 0.01, '#7a4b3a', 5), limb(v(0.075, 0.475, s * 0.055), v(0.115, 0.455, s * 0.035), 0.01, 0.008, '#c99a7a', 5));
    P.push(limb(v(0.027, 0.545), v(0.028, 0.56), 0.008, 0.008, '#c99a7a', 5), ell(0.03, 0.585, 0, 0.022, 0.028, 0.019, '#c99a7a', 8, 6), ell(0.028, 0.607, 0, 0.034, 0.005, 0.03, '#8a7a5a', 10, 3), ell(0.028, 0.618, 0, 0.018, 0.014, 0.017, '#8a7a5a', 8, 4)); }
  return merge(P); }
L3D.defGeo('horse', { name: 'Horse, standing (15.2 hands) - realism rebuild', h_in: [0.52], note: '62 in at withers, 8 ft long' }, () => horse('stand', false));
L3D.defGeo('horse-grazing', { name: 'Horse, grazing - realism rebuild', h_in: [0.4] }, () => horse('graze', false));
L3D.defGeo('horse-rider', { name: 'Horse with western rider - realism rebuild', h_in: [0.63] }, () => horse('stand', true));
/* PEOPLE: 5 ft 9 in = 0.43 in. Head 1/7.5 of height, shoulders ~16 in wide, legs 47 %. Shirt/jacket white = instance tint; trousers, shoes, skin, hair baked. */
const SKIN = '#c4946e', HAIR = '#3a2c22', JEANS = '#34445f', SHOE = '#2a2420';
function person(pose) { const P = [], H = 0.43, shirt = '#ffffff', walk = pose === 'walk', sit = pose === 'sit';
  const hipY = sit ? 0.13 : 0.205, legA = walk ? 0.32 : 0.035, pants = pose === 'farmer' ? '#4a5a78' : pose === 'worker' ? '#3e4a5a' : JEANS;
  if (sit) { for (const s of [-1, 1]) { const z = s * 0.022; P.push(limb(v(0, hipY, z), v(0.105, hipY + 0.005, z), 0.022, 0.016, pants, 6), limb(v(0.105, hipY + 0.005, z), v(0.11, 0.012, z), 0.016, 0.011, pants, 6), box(0.122, 0.006, z, 0.062, 0.012, 0.024, SHOE)); } }
  else for (const s of [-1, 1]) { const z = s * 0.022, a = s * legA, kx = Math.sin(a) * 0.103, ky = hipY - Math.cos(a) * 0.103, fx = kx + Math.sin(a * 0.8) * 0.098, fy = Math.max(0.012, ky - Math.cos(a * 0.8) * 0.098);
    P.push(limb(v(0, hipY, z), v(kx, ky, z), 0.022, 0.016, pants, 6), limb(v(kx, ky, z), v(fx, fy, z), 0.016, 0.011, pants, 6), box(fx + 0.014, 0.006, z, 0.066, 0.012, 0.025, pose === 'worker' ? '#5a3a22' : SHOE)); }
  const sh = hipY + 0.155, lean = walk ? 0.006 : 0; // torso: pelvis -> chest -> shoulders, flattened front-to-back
  P.push(ell(0, hipY + 0.01, 0, 0.03, 0.03, 0.045, pants, 8, 6), limb(v(0, hipY + 0.005), v(lean, sh), 0.046, 0.053, shirt, 8, 1, 0.56), ell(lean, sh - 0.005, 0, 0.03, 0.018, 0.056, shirt, 8, 5));
  // arms: shoulder -> elbow -> wrist, hands
  for (const s of [-1, 1]) { const z = s * 0.058, a = walk ? -s * 0.3 : pose === 'sit' ? 0.5 : 0.06, ex = lean + Math.sin(a) * 0.075, ey = sh - 0.01 - Math.cos(a) * 0.075, b = sit ? 1.1 : a * 1.3, wx = ex + Math.sin(b) * 0.065, wy = ey - Math.cos(b) * 0.065;
    P.push(limb(v(lean, sh - 0.01, z), v(ex, ey, z * 1.02), 0.0135, 0.011, shirt, 5), limb(v(ex, ey, z * 1.02), v(wx, wy, z), 0.011, 0.008, pose === 'worker' || pose === 'farmer' ? shirt : SKIN, 5), ell(wx + 0.002, wy - 0.01, z, 0.008, 0.012, 0.006, SKIN, 6, 4)); }
  // neck, head (6 in wide, 9 in tall, 7.5 in deep), hair
  const hy = sh + 0.045; P.push(limb(v(lean, sh), v(lean, sh + 0.022), 0.009, 0.0085, SKIN, 6), ell(lean + 0.002, hy, 0, 0.0235, 0.029, 0.019, SKIN, 10, 7), ell(lean - 0.003, hy + 0.008, 0, 0.023, 0.024, 0.0195, HAIR, 10, 6));
  if (pose === 'worker') { P.push(ell(lean, hy + 0.014, 0, 0.027, 0.018, 0.024, '#f2f2ee', 10, 5), ell(lean + 0.004, hy + 0.004, 0, 0.034, 0.003, 0.028, '#f2f2ee', 10, 3)); // hard hat + brim
    P.push(limb(v(0, hipY + 0.04), v(lean, sh - 0.01), 0.049, 0.056, '#e2ff3c', 8, 1, 0.6), box(lean, hipY + 0.085, 0, 0.004, 0.012, 0.112, '#e8e8e8'), box(lean, hipY + 0.125, 0, 0.004, 0.012, 0.112, '#e8e8e8')); } // hi-vis vest + reflective bands
  if (pose === 'farmer') P.push(ell(lean, hy + 0.017, 0, 0.024, 0.014, 0.021, '#3a5a3a', 8, 4), box(lean + 0.022, hy + 0.012, 0, 0.026, 0.003, 0.03, '#3a5a3a')); // ball cap
  const g = merge(P); if (sit) g.translate(-0.045, 0, 0); /* origin: front edge of the seat (viewer bench spot), hips on the seat centre */ return g; }
for (const pose of ['stand', 'walk', 'worker', 'farmer', 'sit']) L3D.defGeo('person-' + pose, { name: `Person (${pose}) - realism rebuild`, h_in: [0.43], note: '5 ft 9 in' }, () => person(pose));
L3D.likenessPeople = true;
})(window.L3D);
/* ---------------------------------------------------------------- road vehicles: side-profile extrusions (true silhouettes) with wheel arches, glass greenhouse, real 1:160 dims.
   Body white = instance tint (paint); glass, tyres, lights, trim baked (negative colours, L3D.bakedMat / glossy). +x = front, origin = ground centre. */
(function (L3D) {
const { merge, col } = L3D, PI = Math.PI;
const NEG = (g, c) => { g = g.index ? g.toNonIndexed() : g; if (g.attributes.uv) g.deleteAttribute('uv'); L3D.vcol(g, col(c)); if (c !== '#ffffff') { const a = g.attributes.color.array; for (let i = 0; i < a.length; i++) a[i] = -Math.max(a[i], 0.004); } return g; };
// side profile (x,y) polygon -> extruded across z (depth), optional bevel; arches: [[x, r]] cut from the bottom edge at height yb
const prof = (pts, depth, c, { arches = [], yb = null, bevel = 0.006, z = 0 } = {}) => { const sh = new THREE.Shape(); let P = pts.slice();
  if (yb != null) { const fr = P[P.length - 1][0], rr = P[0][0], bot = [[fr, yb]]; const A = arches.slice().sort((a, b) => b[0] - a[0]);
    for (const [ax, ar, cy0] of A) { const cy = cy0 != null ? cy0 : ar * 0.9, t0 = Math.asin(Math.max(-1, Math.min(1, (yb - cy) / ar))); for (let k = 0; k <= 10; k++) { const t = t0 + k / 10 * (PI - 2 * t0); bot.push([ax + Math.cos(t) * ar, cy + Math.sin(t) * ar]); } }
    bot.push([rr, yb]); P = P.concat(bot); }
  sh.moveTo(P[0][0], P[0][1]); for (const p of P.slice(1)) sh.lineTo(p[0], p[1]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 2 }); g.translate(0, 0, -(depth - 2 * bevel) / 2 + z); return NEG(g, c); };
const box = (x, y, z, w, h, d, c, rz = 0, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); return NEG(g, c); };
const cyl = (x, y, z, r, w, c, n = 12) => { const g = new THREE.CylinderGeometry(r, r, w, n); g.rotateX(PI / 2); g.translate(x, y, z); return NEG(g, c); };
// wheel = tyre + rim + hub; pairs at +-tz
const wheel = (x, r, tz, w, rim = '#9aa0a6', tyre = '#151515') => { const o = []; for (const s of [-1, 1]) o.push(cyl(x, r, s * tz, r, w, tyre, 14), cyl(x, r, s * (tz + w / 2 + 0.001), r * 0.62, 0.004, rim, 10)); return o; };
const GL = '#22303a', LITE = '#f4f0dc', TAIL = '#a0141a', TRIM = '#1c1c1c';
const B = {};
// 2018 Toyota Camry-class sedan: 16 ft long, 6 ft wide, 4 ft 9 in tall, 27 in wheels, 111 in wheelbase
B['veh-sedan'] = () => { const W = 0.45, ar = [[0.36, 0.094, 0.084], [-0.33, 0.094, 0.084]]; const P = [prof([[-0.6, 0.07], [-0.605, 0.17], [-0.585, 0.228], [-0.4, 0.24], [0.22, 0.232], [0.5, 0.206], [0.592, 0.168], [0.605, 0.075]], W, '#ffffff', { arches: ar, yb: 0.045 }),
  prof([[-0.425, 0.236], [-0.23, 0.342], [0.0, 0.354], [0.09, 0.35], [0.27, 0.23]], W - 0.05, GL, { bevel: 0.004 }), prof([[-0.23, 0.338], [0.0, 0.35], [0.09, 0.346], [0.095, 0.354], [0.0, 0.358], [-0.23, 0.346]], W - 0.044, '#ffffff', { bevel: 0.002 }),
  box(-0.06, 0.29, 0, 0.022, 0.11, W - 0.046, '#ffffff', -0.08), box(0.605, 0.15, 0, 0.012, 0.03, W - 0.1, TRIM), box(-0.607, 0.185, 0, 0.008, 0.022, W - 0.06, TAIL)];
  for (const s of [-1, 1]) P.push(box(0.592, 0.18, s * 0.16, 0.02, 0.022, 0.08, LITE), box(-0.6, 0.2, s * 0.17, 0.012, 0.03, 0.08, TAIL));
  ar.forEach(([x]) => P.push(...wheel(x, 0.084, W / 2 - 0.03, 0.055))); return merge(P); };
// 2016 Chevrolet Tahoe-class full-size SUV: 17 ft long, 6 ft 8 in wide, 6 ft 2 in tall, 31 in tyres, 116 in wheelbase, upright rear
B['veh-suv'] = () => { const W = 0.5, ar = [[0.41, 0.108, 0.097], [-0.315, 0.108, 0.097]]; const P = [prof([[-0.637, 0.085], [-0.64, 0.305], [-0.62, 0.315], [0.25, 0.312], [0.575, 0.3], [0.632, 0.255], [0.637, 0.095]], W, '#ffffff', { arches: ar, yb: 0.06 }),
  prof([[-0.628, 0.312], [-0.612, 0.448], [0.115, 0.458], [0.28, 0.31]], W - 0.05, GL, { bevel: 0.004 }), prof([[-0.612, 0.444], [0.115, 0.454], [0.12, 0.462], [-0.614, 0.452]], W - 0.044, '#ffffff', { bevel: 0.002 }),
  box(-0.06, 0.38, 0, 0.025, 0.14, W - 0.046, '#ffffff'), box(-0.36, 0.38, 0, 0.025, 0.14, W - 0.046, '#ffffff'), box(-0.6, 0.38, 0, 0.04, 0.14, W - 0.046, '#ffffff'),
  box(0.636, 0.2, 0, 0.012, 0.08, W - 0.14, '#9aa0a6'), box(0.64, 0.12, 0, 0.012, 0.04, W - 0.04, TRIM)];
  for (const s of [-1, 1]) P.push(box(0.628, 0.245, s * 0.19, 0.02, 0.03, 0.08, LITE), box(-0.636, 0.28, s * 0.21, 0.012, 0.06, 0.04, TAIL), box(-0.25, 0.47, s * 0.2, 0.75, 0.01, 0.012, TRIM));
  ar.forEach(([x]) => P.push(...wheel(x, 0.097, W / 2 - 0.035, 0.065))); return merge(P); };
// 2015 Ford F-150 SuperCrew 5.5 ft bed: 19 ft 4 in long, 6 ft 8 in wide, 6 ft 4 in tall, 145 in wheelbase, 32 in tyres
B['veh-pickup'] = () => { const W = 0.5, ar = [[0.5, 0.112, 0.1], [-0.406, 0.112, 0.1]]; const P = [prof([[-0.1, 0.09], [-0.1, 0.335], [0.3, 0.335], [0.62, 0.33], [0.712, 0.3], [0.725, 0.11]], W, '#ffffff', { arches: [ar[0]], yb: 0.07 }),
  prof([[-0.09, 0.333], [-0.085, 0.468], [0.2, 0.476], [0.335, 0.335]], W - 0.05, GL, { bevel: 0.004 }), prof([[-0.085, 0.464], [0.2, 0.472], [0.205, 0.48], [-0.087, 0.472]], W - 0.044, '#ffffff', { bevel: 0.002 }),
  box(0.06, 0.4, 0, 0.025, 0.13, W - 0.046, '#ffffff'), box(-0.08, 0.4, 0, 0.03, 0.13, W - 0.046, '#ffffff'), box(0.722, 0.22, 0, 0.012, 0.11, W - 0.12, '#8a8f94'), box(0.73, 0.12, 0, 0.012, 0.045, W - 0.02, '#9aa0a6')];
  for (const s of [-1, 1]) { P.push(prof([[-0.725, 0.12], [-0.725, 0.335], [-0.11, 0.335], [-0.11, 0.12]], 0.02, '#ffffff', { arches: [ar[1]], yb: 0.12, z: s * (W / 2 - 0.01), bevel: 0.003 }), box(0.715, 0.29, s * 0.18, 0.02, 0.035, 0.08, LITE), box(-0.725, 0.29, s * 0.22, 0.012, 0.08, 0.03, TAIL)); }
  P.push(box(-0.72, 0.23, 0, 0.018, 0.2, W - 0.04, '#ffffff'), box(-0.415, 0.15, 0, 0.6, 0.012, W - 0.04, '#2a2a2a'), box(-0.11, 0.25, 0, 0.012, 0.17, W - 0.04, '#ffffff'));
  ar.forEach(([x]) => P.push(...wheel(x, 0.1, W / 2 - 0.035, 0.068))); return merge(P); };
// UPS package car (Grumman Olson / Morgan Olson P-80 class): ~22 ft long, 7 ft 9 in wide, 9 ft 10 in tall; short sloped nose, tall flat windshield, full-height box body,
// open sliding cab doors, roll-up rear door, Pullman brown with the gold shield; 136 in wheelbase, 33 in tyres. Body colour baked (always UPS brown).
B['veh-ups'] = () => { const W = 0.58, BR = '#4a2c1c', ar = [[0.45, 0.118, 0.105], [-0.42, 0.118, 0.105]]; const P = [
  prof([[-0.83, 0.1], [-0.83, 0.72], [-0.805, 0.74], [0.36, 0.74], [0.43, 0.715], [0.465, 0.66], [0.49, 0.4], [0.74, 0.37], [0.8, 0.34], [0.825, 0.29], [0.83, 0.12]], W, BR, { arches: ar, yb: 0.075, bevel: 0.008 }),
  prof([[0.462, 0.655], [0.488, 0.405], [0.497, 0.405], [0.472, 0.655]], W - 0.07, GL, { bevel: 0.002 }), box(0.79, 0.27, 0, 0.012, 0.07, W - 0.16, '#1a1a1a'), box(0.835, 0.13, 0, 0.02, 0.05, W - 0.02, '#262626'),
  box(-0.832, 0.42, 0, 0.006, 0.56, W - 0.08, '#3e2618'), box(-0.835, 0.12, 0, 0.02, 0.04, W - 0.03, '#202020')];
  for (const s of [-1, 1]) { const z = s * (W / 2 + 0.001); P.push(box(0.33, 0.47, z, 0.2, 0.36, 0.006, '#120c08'), box(0.33, 0.6, z, 0.17, 0.1, 0.008, GL), box(-0.2, 0.52, z, 0.13, 0.15, 0.006, '#d6a92e'), box(-0.2, 0.52, z, 0.1, 0.11, 0.008, BR),
    box(0.8, 0.31, s * 0.22, 0.02, 0.03, 0.06, LITE), box(-0.831, 0.66, s * 0.24, 0.006, 0.03, 0.04, '#e0a020'), box(-0.832, 0.2, s * 0.24, 0.008, 0.04, 0.04, TAIL), box(0.52, 0.47, s * (W / 2 + 0.02), 0.01, 0.05, 0.03, '#202020')); }
  for (let k = 1; k < 7; k++) P.push(box(-0.833, 0.14 + k * 0.08, 0, 0.004, 0.004, W - 0.1, '#2e1c12'));
  ar.forEach(([x]) => P.push(...wheel(x, 0.105, W / 2 - 0.045, 0.07))); return merge(P); };
// John Deere 6R-class row-crop tractor: 16 ft long, 8 ft wide, 10 ft to the cab roof; 6 ft rear tyres, 4 ft 4 in front; long narrow hood, 4-post glass cab. Paint white = tint (green / red).
B['veh-tractor'] = () => { const P = [], YEL = '#f2c200';
  P.push(prof([[-0.05, 0.3], [-0.05, 0.44], [0.55, 0.43], [0.62, 0.4], [0.64, 0.27], [0.58, 0.24], [-0.05, 0.24]], 0.22, '#ffffff', { bevel: 0.012 }), box(0.64, 0.33, 0, 0.012, 0.09, 0.17, '#202020'),
    box(-0.28, 0.33, 0, 0.5, 0.08, 0.3, '#ffffff'), box(-0.27, 0.36, 0, 0.36, 0.03, 0.52, '#2a2a2a'));
  const cx = -0.3, cy0 = 0.38, cy1 = 0.74; for (const [x, z] of [[cx - 0.17, 0.2], [cx - 0.17, -0.2], [cx + 0.17, 0.21], [cx + 0.17, -0.21]]) P.push(box(x, (cy0 + cy1) / 2, z, 0.025, cy1 - cy0, 0.025, '#1a1a1a'));
  P.push(box(cx, (cy0 + cy1) / 2, 0, 0.34, cy1 - cy0 - 0.02, 0.4, GL), box(cx, cy1 + 0.015, 0, 0.42, 0.03, 0.48, '#ffffff'), box(0.3, 0.5, 0.06, 0.02, 0.16, 0.02, '#202020'));
  for (const s of [-1, 1]) { P.push(cyl(-0.29, 0.225, s * 0.31, 0.225, 0.13, '#171717', 16), cyl(-0.29, 0.225, s * 0.377, 0.14, 0.006, YEL, 12), cyl(0.45, 0.16, s * 0.27, 0.16, 0.1, '#171717', 14), cyl(0.45, 0.16, s * 0.322, 0.1, 0.006, YEL, 10), box(-0.29, 0.47, s * 0.32, 0.36, 0.015, 0.15, '#ffffff')); }
  return merge(P); };
const NAME = { 'veh-sedan': 'Sedan (Camry-class)', 'veh-suv': 'Full-size SUV (Tahoe-class)', 'veh-pickup': 'Pickup (F-150 SuperCrew)', 'veh-ups': 'UPS package car (P-80)', 'veh-tractor': 'Row-crop tractor (JD 6R-class)' };
for (const [id, fn] of Object.entries(B)) L3D.defGeo(id, { name: NAME[id] + ' - realism rebuild', note: 'side-profile extrusion, true 1:160' }, fn);
L3D.likenessVeh = new Set(Object.keys(B));
let GM = null; L3D.bakedGlossy = () => GM || (GM = (() => { const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x333333 }); m.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `vColor = vec3(1.0);
#ifdef USE_COLOR
  vColor *= abs(color);
#endif
#ifdef USE_INSTANCING_COLOR
  if (color.r >= 0.0) vColor.xyz *= instanceColor.xyz;
#endif`); }; m.customProgramCacheKey = () => 'l3d-baked-glossy'; return m; })());
})(window.L3D);
