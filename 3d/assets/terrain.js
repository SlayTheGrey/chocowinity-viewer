/* layout3d terrain: per-level heightfield (inches relative to deck top; track roadbed base = 0) generated from the plan + optional per-plan terrain.json
   (window.TERRAIN, embedded by build_viewer.py). Rules: track corridor/roads/lots/structures flat at 0, ditches each side of track, fields with subtle undulation,
   gentle hills far from features (rising toward backdrops), water 0.3-0.5 in below with sloping banks, terrain meets the fascia at 0. Smooth-normal mesh with
   per-vertex colour blending (grass/dirt/mud/ballast dust) and textured categories. Exposes o.terrain.h(x,z). */
'use strict';
(function (L3D) {
const { col, inPoly, segDist, canvasTex, noise, rnd } = L3D;
const DEF = { step: 0.5, base: -0.1, undulation: 0.06, undScale: 7, fieldUndulation: 0.03, hillHeight: 1.1, hillStart: 5, hillFull: 16, hillScale: 18, backdropRise: 0.5, backdropWidth: 6,
  blend: 1.2, shoulder: 0.55, ditchOffset: 0.95, ditchHalfWidth: 0.38, ditchDepth: 0.14, waterLevel: -0.25, waterBottom: -0.5, bankWidth: 0.9, fasciaBlend: 0.8, foundation: 0.05, seed: 7, foam: 0.75, foamMin: 0.125 };
// FOAM: deck top (0) = top of a full 0.75 in extruded foam sheet on the plywood; every carve (water, ditch, hollow) is clamped so >= foamMin of foam stays above the plywood.
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// seeded value noise + fbm
function vnoise(seed) { const P = new Uint8Array(512); let s = seed * 9301 + 49297; for (let i = 0; i < 256; i++) P[i] = i; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [P[i], P[j]] = [P[j], P[i]]; } for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const h = (x, y) => P[P[x & 255] + (y & 255)] / 255; return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v; }; }
const fbm = (n, x, y) => (n(x, y) * 0.6 + n(x * 2.03, y * 2.03) * 0.28 + n(x * 4.1, y * 4.1) * 0.12) * 2 - 1;
// chamfer distance transform on grid: seeds (bool) -> distance in inches
function dist(seed, nx, nz, step) { const D = new Float32Array(nx * nz), INF = 1e9, d1 = step, d2 = step * Math.SQRT2;
  for (let i = 0; i < nx * nz; i++) D[i] = seed[i] ? 0 : INF;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const p = k * nx + i; let v = D[p]; if (i) v = Math.min(v, D[p - 1] + d1); if (k) { v = Math.min(v, D[p - nx] + d1); if (i) v = Math.min(v, D[p - nx - 1] + d2); if (i < nx - 1) v = Math.min(v, D[p - nx + 1] + d2); } D[p] = v; }
  for (let k = nz - 1; k >= 0; k--) for (let i = nx - 1; i >= 0; i--) { const p = k * nx + i; let v = D[p]; if (i < nx - 1) v = Math.min(v, D[p + 1] + d1); if (k < nz - 1) { v = Math.min(v, D[p + nx] + d1); if (i < nx - 1) v = Math.min(v, D[p + nx + 1] + d2); if (i) v = Math.min(v, D[p + nx - 1] + d2); } D[p] = v; }
  return D; }
// ground textures (dirt, mud) for blending categories
L3D.T.dirt = () => canvasTex('dirt', 256, 256, (g, w, h) => { noise(g, w, h, '#8a7656', 0.25, 9000, 2); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '60,50,35' : '170,150,110'},0.12)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 8 + rnd() * 30, 0, 7); g.fill(); } });
L3D.T.mud = () => canvasTex('mud', 256, 256, (g, w, h) => { noise(g, w, h, '#5a4c36', 0.2, 8000, 2); for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(40,34,24,0.15)'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 10 + rnd() * 30, 0, 7); g.fill(); } });
L3D.T.sand = () => canvasTex('sand', 256, 256, (g, w, h) => { noise(g, w, h, '#d8c49a', 0.18, 9000, 2); for (let i = 0; i < 30; i++) { g.strokeStyle = 'rgba(150,120,80,0.15)'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 40, 0, 3); g.stroke(); } });
L3D.MATS = L3D.MATS || {}; L3D.MATS.sand = () => new THREE.MeshLambertMaterial({ vertexColors: true, map: L3D.T.sand() }); L3D.MATS.dirt = () => new THREE.MeshLambertMaterial({ vertexColors: true, map: L3D.T.dirt() }); L3D.MATS.mud = () => new THREE.MeshLambertMaterial({ vertexColors: true, map: L3D.T.mud() });
const SEASON = { summer: [1, 1, 1], spring: [1.02, 1.08, 0.92], fall: [1.07, 0.98, 0.82] /* REAL1: mid-October eastern NC (early fall: duller, warmer grass, not straw) */, winter: [1.1, 0.95, 0.8] };
const TR = L3D.terrain = { DEF, BASE: 0.75, levels: [], cur: null, smooth, fbm, vnoise, season: 'summer' };
TR.seasonTint = (c, amt = 1) => { const s = SEASON[TR.season] || SEASON.summer; c.r *= 1 + (s[0] - 1) * amt; c.g *= 1 + (s[1] - 1) * amt; c.b *= 1 + (s[2] - 1) * amt; return c; };
TR.config = (id) => { const T = window.TERRAIN || {}; return Object.assign({}, DEF, T.defaults || {}, ((T.levels || {})[id] || {}).params || {}); };
// C = viewer context: { onBoard, trackDist, occupied, inWater }
TR.build = (o, C) => {
  const L = o.L, id = String(L.id), cfg = TR.config(id), ov = ((window.TERRAIN || {}).levels || {})[id] || {}, step = cfg.step;
  TR.season = (C.QS && C.QS.get('season')) || (window.TERRAIN || {}).season || 'summer';
  const B = L.boards.concat((o.polys || []).map(p => { const xs = p.map(q => q[0]), zs = p.map(q => q[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; }));
  const x0 = Math.min(...B.map(r => r[0])) - step, z0 = Math.min(...B.map(r => r[1])) - step, x1 = Math.max(...B.map(r => r[2])) + step, z1 = Math.max(...B.map(r => r[3])) + step;
  const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1, N = nx * nz, X = i => x0 + i * step, Z = k => z0 + k * step;
  const board = new Uint8Array(N), flat = new Uint8Array(N), water = new Uint8Array(N), dT = new Float32Array(N), field = new Int16Array(N).fill(-1), ground = new Int16Array(N).fill(-1), road = new Uint8Array(N);
  const rib = L.water.filter(w => w.ribbon), wpoly = L.water.filter(w => !w.ribbon);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const p = k * nx + i, x = X(i), z = Z(k);
    board[p] = C.onBoard(o, x, z, -0.01) ? 1 : 0; if (!board[p]) continue;
    const t = C.trackDist(o, x, z, 2.5); dT[p] = t; const occ = C.occupied(o, x, z, 0.12);
    flat[p] = t < cfg.shoulder || occ ? 1 : 0;
    if (occ) for (const rd of L.roads) { for (let j = 0; j + 1 < rd.pts.length; j++) if (segDist(x, z, rd.pts[j], rd.pts[j + 1]) < rd.w / 2 + 0.15) { road[p] = 1; break; } if (road[p]) break; }
    for (const w of wpoly) if (inPoly(x, z, w.pts)) water[p] = 1;
    for (const w of rib) for (let j = 0; j + 1 < w.pts.length; j++) if (segDist(x, z, w.pts[j], w.pts[j + 1]) < (+w.ribbon || 1.4) / 2) water[p] = 1;
    L.fields.forEach((f, fi) => { if (field[p] < 0 && inPoly(x, z, f.pts)) field[p] = fi; }); (L.ground || []).forEach((g, gi) => { if (ground[p] < 0 && inPoly(x, z, g.pts)) ground[p] = gi; }); }
  for (let p = 0; p < N; p++) if (water[p] && flat[p] && dT[p] < cfg.shoulder) water[p] = 0; // never flood the track corridor
  // ribbon water (creeks/rivers) is pre-registered in the viewer's occupancy grid, which would mark it flat (h = 0, no carve): un-flatten water cells off the track corridor and roads
  for (let p = 0; p < N; p++) if (water[p] && flat[p] && dT[p] >= cfg.shoulder && !road[p]) flat[p] = 0;
  const notBoard = board.map(v => v ? 0 : 1), notWater = water.map((v, p) => v ? 0 : 1);
  const dF = dist(flat, nx, nz, step), dW = dist(water, nx, nz, step), dWin = dist(notWater, nx, nz, step), dE = dist(notBoard, nx, nz, step);
  // backdrop proximity (edges flagged by the viewer)
  const bd = new Uint8Array(N); for (const [a, b] of o.backdrops || []) { const R = L3D.resample([a, b], step * 0.5); for (const q of R) { const i = Math.round((q[0] - x0) / step), k = Math.round((q[1] - z0) / step); if (i >= 0 && k >= 0 && i < nx && k < nz) bd[k * nx + i] = 1; } }
  const dB = dist(bd, nx, nz, step);
  const n1 = vnoise(cfg.seed + L.id * 13), n2 = vnoise(cfg.seed * 3 + L.id), H = new Float32Array(N), cat = new Uint8Array(N); // cat: 0 grass 1 field 2 ground 3 ditch 4 bank/mud 5 water bed 6 shoulder 7 flat(lot/road)
  const ditchLines = (L.lines || []).filter(l => l.kind === 'ditch').map(l => l.pts);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const p = k * nx + i; if (!board[p]) continue; const x = X(i), z = Z(k);
    let h = cfg.base + cfg.undulation * fbm(n1, x / cfg.undScale, z / cfg.undScale); cat[p] = 0;
    if (field[p] >= 0) { h = cfg.base + cfg.fieldUndulation * fbm(n1, x / 11, z / 11); cat[p] = 1; } else if (ground[p] >= 0) cat[p] = 2;
    h += cfg.hillHeight * smooth(cfg.hillStart, cfg.hillFull, dF[p]) * (0.55 + 0.45 * fbm(n2, x / cfg.hillScale, z / cfg.hillScale)) * (field[p] >= 0 ? 0.3 : 1);
    h += cfg.backdropRise * (1 - smooth(0, cfg.backdropWidth, dB[p])) * smooth(1.5, 4, dF[p]);
    // water + banks
    if (water[p]) { h = cfg.waterLevel - 0.04 - (cfg.waterLevel - 0.04 - cfg.waterBottom) * smooth(0, cfg.bedRamp || 1.4, dWin[p]); cat[p] = 5; }
    else if (dW[p] < cfg.bankWidth) { const s = smooth(0, cfg.bankWidth, dW[p]); h = (cfg.waterLevel + 0.03) * (1 - s) + h * s; if (s < 0.7) cat[p] = 4; }
    // marsh flats sit just above water
    if (ground[p] >= 0 && /marsh|cypress/.test(L.ground[ground[p]].kind) && !water[p]) { h = Math.min(h, cfg.waterLevel + 0.06 + 0.03 * fbm(n2, x / 3, z / 3)); cat[p] = 4; }
    // blend to the flat features (track roadbed base, roads, lots, structures) = level 0
    h *= smooth(0, cfg.blend, dF[p]);
    // ditches each side of the track (not through roads: culverts there)
    const t = dT[p]; if (!road[p] && !water[p] && t > cfg.shoulder && t < cfg.ditchOffset + cfg.ditchHalfWidth && dF[p] < 1.6) { const b = 1 - Math.min(1, Math.abs(t - cfg.ditchOffset) / cfg.ditchHalfWidth); const dh = -cfg.ditchDepth * (b * b * (3 - 2 * b)); if (dh < h) { h = Math.min(h, dh); if (b > 0.3) cat[p] = 3; } }
    for (const P of ditchLines) for (let j = 0; j + 1 < P.length; j++) { const d = segDist(x, z, P[j], P[j + 1]); if (d < 0.45 && !flat[p]) { h = Math.min(h, -cfg.ditchDepth * (1 - d / 0.45)); cat[p] = 3; } }
    if (flat[p]) { h = 0; cat[p] = t < cfg.shoulder ? 6 : 7; }
    // fascia: terrain meets the fascia top (0) at the board edge
    h *= smooth(0, cfg.fasciaBlend, dE[p] - step * 0.5);
    H[p] = h; }
  // editable overrides from terrain.json: points (gaussian bumps), contours (target height along a line), features (cut/fill/embankment/culvert/pond)
  for (const pt of ov.points || []) for (let p = 0; p < N; p++) { if (!board[p] || flat[p]) continue; const i = p % nx, k = (p - i) / nx, d = Math.hypot(X(i) - pt.x, Z(k) - pt.y); if (d < pt.r * 2.5) H[p] += pt.h * Math.exp(-((d / pt.r) ** 2)) * smooth(0, cfg.blend, dF[p]); }
  for (const f of (ov.contours || []).concat(ov.features || [])) { if (!f.pts || f.type === 'culvert') continue; const w = f.w || 1.0, target = f.h != null ? f.h : f.type === 'cut' ? 0.6 : f.type === 'fill' || f.type === 'embankment' ? -0.3 : f.type === 'pond' ? cfg.waterBottom : 0;
    for (let p = 0; p < N; p++) { if (!board[p] || (flat[p] && f.type !== 'pond')) continue; const i = p % nx, k = (p - i) / nx; let d = 1e9; for (let j = 0; j + 1 < f.pts.length; j++) d = Math.min(d, segDist(X(i), Z(k), f.pts[j], f.pts[j + 1])); if (d < w * 2) H[p] += (target - H[p]) * (1 - smooth(w * 0.5, w * 2, d)); } }
  // foam carve limit (no plywood cuts): never deeper than foam - foamMin
  { const lim = -((cfg.foam || 0.75) - (cfg.foamMin || 0.125)); for (let p = 0; p < N; p++) if (H[p] < lim) H[p] = lim; }
  // one smoothing pass that keeps the flats exact
  const S = H.slice(); for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) { const p = k * nx + i; if (!board[p] || flat[p] || cat[p] === 3) continue; let s = 0, n = 0; for (const q of [p, p - 1, p + 1, p - nx, p + nx]) if (board[q]) { s += H[q]; n++; } S[p] = s / n; } H.set(S);
  const h = (x, z) => { const fi = (x - x0) / step, fk = (z - z0) / step, i = Math.floor(fi), k = Math.floor(fk); if (i < 0 || k < 0 || i >= nx - 1 || k >= nz - 1) return 0; const u = fi - i, v = fk - k, p = k * nx + i;
    return (H[p] * (1 - u) + H[p + 1] * u) * (1 - v) + (H[p + nx] * (1 - u) + H[p + nx + 1] * u) * v; };
  // culverts: ditch cells touching a road
  const culverts = []; for (let p = nx; p < N - nx; p++) if (cat[p] === 3 && (road[p + 1] || road[p - 1] || road[p + nx] || road[p - nx])) { const i = p % nx, k = (p - i) / nx; if (!culverts.some(c => Math.hypot(c[0] - X(i), c[1] - Z(k)) < 1.5)) culverts.push([X(i), Z(k)]); }
  const T = o.terrain = { h, x0, z0, nx, nz, step, H, board, flat, water, dT, dF, dW, dWin, dB, cat, field, ground, road, culverts, cfg, X, Z };
  TR.levels.push(o); TR.cur = T; TR.mesh(o, C); return T;
};
// mesh: categories -> material keys; per-vertex colours blend dirt/mud/ballast dust; smooth normals from the heightfield
TR.mesh = (o, C) => {
  const T = o.terrain, { nx, nz, step, H, board, cat, X, Z, dT, dW, dF, field, ground } = T, L = o.L, y = o.deck + 0.003, cfg = T.cfg;
  const GK = { row: 'grass', lawn: 'grass', young: 'grass', brush: 'grass', sand: 'sand', salvage: 'gravel', gravel: 'gravel', cinder: 'gravel', marsh: 'marsh', grass: 'grass', pine: 'grass', plant: 'grass', cypress: 'marsh', apron: 'gravel', lot: 'gravel', walk: 'grass', drive: 'gravel', road: 'grass' };
  const keyOf = p => { const c = cat[p]; if (c === 1) { const cr = L.fields[field[p]].crop; return cr === 'tobacco' ? 'ft' : cr === 'cotton' ? 'fc' : cr === 'pasture' ? 'grass' : 'fp'; }
    if (c === 2) return GK[L.ground[ground[p]].kind] || 'grass'; if (c === 3) return 'grass'; if (c === 4) return 'mud'; if (c === 5) return 'mud'; if (c === 6) return 'dirt'; if (c === 7) return 'gravel'; return 'grass'; };
  const n3 = vnoise(17 + L.id), V = {}, colr = new THREE.Color();
  const vcolor = (p) => { const x = X(p % nx), z = Z((p - p % nx) / nx), c = cat[p], nn = fbm(n3, x / 2.5, z / 2.5);
    if (c === 1) { const cr = L.fields[field[p]].crop; colr.set(cr === 'pasture' ? '#c8d6a0' : '#ffffff'); } else if (c === 2) { const k = L.ground[ground[p]].kind; colr.set({ row: '#b0a880', lawn: '#e4f4bc', young: '#c4b880', brush: '#aeb07c', sand: '#ffffff', salvage: '#8a8274', pine: '#a0a070', cinder: '#8a847c', plant: '#b0b890', cypress: '#a0a080', marsh: '#ffffff', gravel: '#ffffff', grass: '#d8e0b0' }[k] || '#d0d8b0'); }
    else if (c === 3) colr.set('#8fa060'); else if (c === 4 || c === 5) colr.set('#ffffff'); else if (c === 6) colr.set('#b0a898'); else if (c === 7) colr.set('#d0d0d0'); else colr.set('#d8e0b0');
    colr.multiplyScalar(0.9 + 0.12 * nn);
    /* [UX1] mid-October eastern NC: open grass carries tan broomsedge / dead-grass patches, field margins a weedy straw band, ditches stay darker and wetter, yard gravel picks up cinder / oil-stain mottle */
    if (c === 0 || c === 3) { const pv = fbm(n3, x / 1.1 + 40, z / 1.1 - 17), edge = dF[p] < 0.7 ? 1 - dF[p] / 0.7 : 0; colr.lerp(new THREE.Color('#cdbb8a'), Math.min(0.55, Math.max(0, (pv - 0.05) * 1.6) + 0.35 * edge) * (c === 3 ? 0.3 : 1)); }
    if (c === 3) colr.multiplyScalar(0.86);
    if (c === 7) { const ov = fbm(n3, x / 0.8 - 9, z / 0.8 + 31); colr.lerp(new THREE.Color('#7e766a'), Math.max(0, ov) * 0.7); }
    if (c !== 4 && c !== 5 && c !== 6 && c !== 7) TR.seasonTint(colr, c === 1 ? 0.5 : 1);
    // ballast dust near the roadbed, damp darkening near water
    if (dT[p] < 0.9 && c !== 6) colr.lerp(new THREE.Color('#9a958c'), 0.35 * (1 - smooth(0.55, 0.9, dT[p])));
    if (dW[p] < 1.5 && c !== 5) colr.multiplyScalar(0.85 + 0.15 * smooth(0, 1.5, dW[p]));
    return [colr.r, colr.g, colr.b]; };
  const nrm = (p) => { const i = p % nx, k = (p - i) / nx, hl = H[i > 0 ? p - 1 : p], hr = H[i < nx - 1 ? p + 1 : p], hd = H[k > 0 ? p - nx : p], hu = H[k < nz - 1 ? p + nx : p]; const v = new THREE.Vector3(-(hr - hl) / (2 * step), 1, -(hu - hd) / (2 * step)).normalize(); return [v.x, v.y, v.z]; };
  for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) { const p = k * nx + i, q = [p, p + 1, p + nx + 1, p + nx]; const nb = q.reduce((a, v) => a + board[v], 0); if (nb < 3) continue;
    const kc = keyOf(board[p] ? p : q.find(v => board[v])), G = V[kc] = V[kc] || { idx: new Map(), pos: [], nor: [], col: [], uv: [], ind: [] };
    const vid = v => { let r = G.idx.get(v); if (r !== undefined) return r; r = G.pos.length / 3; G.idx.set(v, r); const vi = v % nx, vk = (v - vi) / nx; G.pos.push(X(vi), y + H[v], Z(vk)); G.nor.push(...nrm(v)); G.col.push(...vcolor(board[v] ? v : p)); G.uv.push(X(vi) / 4, Z(vk) / 4); return r; };
    const a = vid(q[0]), b = vid(q[1]), c = vid(q[2]), d = vid(q[3]); if (nb === 4) G.ind.push(a, d, c, a, c, b); else { const t = q.filter(v => board[v]).map(vid); G.ind.push(t[0], t[2], t[1]); } }
  const grp = new THREE.Group(); grp.name = 'terrain';
  for (const [kc, G] of Object.entries(V)) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2)); g.setIndex(G.ind); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, L3D.mat(kc)); m.receiveShadow = true; m.matrixAutoUpdate = false; grp.add(m); }
  o.g.add(grp);
  // leveled foundations under every structure (concrete/brick skirt, slightly proud of grade)
  const bt = o.bt; for (const s of L.structures) { const r = s.r; if (r[2] - r[0] < 0.2 || r[3] - r[1] < 0.2 || s.kind === 'minor' || s.kind === 'pool') continue; let lo = 0; for (const [x, z] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) lo = Math.min(lo, T.h(x - 0.1, z - 0.1)); bt.box('conc', r[0] - 0.03, o.deck + lo - 0.05, r[1] - 0.03, r[2] + 0.03, o.deck + cfg.foundation, r[3] + 0.03, col('#a8a49c'), 1); }
  // culvert pipe ends where ditches pass under roads
  for (const c of T.culverts) bt.geom('conc', new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(c[0], o.deck - cfg.ditchDepth + 0.1, c[1]), col('#8a8a86'));
};
})(window.L3D);
