/* Structure kits (Walthers Cornerstone, DPM, Woodland Scenics, Modellbahn Union, Iowa Scaled ...) + typed generics.
   build(bt, P): P = {w, d, h, color, sign, name}; local coords: x 0..w, z 0..d, y up from the scenery surface; FRONT = +z face (z = d).
   Kit footprints/heights in inches (N scale). Heights mostly [verify] unless the plan or a catalogue gives them (see registry.json / SOURCES.md). */
'use strict';
(function (L3D) {
const { col, signSlot, canvasTex, noise, win, hash, WHITE, CYL, BOX } = L3D, PI = Math.PI;
// ---- extra textures (256 px = 1.8 in wide, 128 px = one 12 ft story) ------------------------------------------------
Object.assign(L3D.T, {
  dockdoor: () => canvasTex('dockdoor', 256, 128, (g, w, h) => { g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 6) { g.fillStyle = '#00000018'; g.fillRect(x, 0, 2, h); } for (const x of [24, 150]) { g.fillStyle = '#8a8f96'; g.fillRect(x, 30, 84, 98); g.fillStyle = '#00000030'; for (let y = 34; y < h; y += 7) g.fillRect(x, y, 84, 2); g.fillStyle = '#222'; g.fillRect(x - 4, 26, 92, 4); } }),
  storefront2: () => canvasTex('store2', 256, 128, (g, w, h) => { noise(g, w, h, '#f0f0f0', 0.1, 1500, 1); g.fillStyle = '#25313c'; g.fillRect(10, 44, 96, 76); g.fillRect(146, 44, 100, 76); g.fillStyle = '#86a8bf'; g.fillRect(13, 47, 90, 50); g.fillRect(149, 47, 94, 50); g.fillStyle = '#4a2f22'; g.fillRect(112, 38, 30, 90); g.fillStyle = '#c8d8e4'; g.fillRect(116, 44, 22, 34); g.fillStyle = '#0000004a'; g.fillRect(0, 16, w, 14); }),
  brick2: () => canvasTex('brick2', 256, 128, (g, w, h) => { noise(g, w, h, '#efefef', 0.12, 3000, 1); g.fillStyle = '#00000018'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); for (const x of [20, 82, 144, 206]) { win(g, x, 30, 32, 62); g.fillStyle = '#ffffffa0'; g.fillRect(x - 4, 22, 40, 6); } }),
  cold: () => canvasTex('cold', 256, 128, (g, w, h) => { g.fillStyle = '#f4f4f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#00000012'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h); }),
  corr: () => canvasTex('corr', 128, 128, (g, w, h) => { g.fillStyle = '#e8eaec'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 6) { g.fillStyle = '#00000026'; g.fillRect(0, y, w, 2); g.fillStyle = '#ffffff50'; g.fillRect(0, y + 3, w, 1); } }),
  clap: () => canvasTex('clap', 256, 128, (g, w, h) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#00000022'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1); win(g, 44, 34, 40, 56, true); win(g, 172, 34, 40, 56, true); }),
  stall: () => canvasTex('stall', 256, 128, (g, w, h) => { g.fillStyle = '#efefef'; g.fillRect(0, 0, w, h); g.fillStyle = '#00000020'; for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h); for (const x of [20, 140]) { g.fillStyle = '#5a3a28'; g.fillRect(x, 40, 90, 88); g.strokeStyle = '#efe6d6'; g.lineWidth = 5; g.strokeRect(x + 3, 43, 84, 82); g.beginPath(); g.moveTo(x + 3, 43); g.lineTo(x + 87, 125); g.moveTo(x + 87, 43); g.lineTo(x + 3, 125); g.stroke(); } }),
  chrome: () => canvasTex('chrome', 256, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f4f6f8'); gr.addColorStop(0.5, '#9aa2aa'); gr.addColorStop(1, '#e0e4e8'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#28323c'; for (let x = 8; x < w; x += 42) g.fillRect(x, 30, 32, 44); g.fillStyle = '#c8202a'; g.fillRect(0, 84, w, 8); g.fillStyle = '#00000020'; for (let y = 96; y < h; y += 5) g.fillRect(0, y, w, 1); }),
  lumber: () => canvasTex('lumber', 128, 64, (g, w, h) => { g.fillStyle = '#d9b980'; g.fillRect(0, 0, w, h); g.fillStyle = '#00000030'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1); for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h); }),
});
const tex = k => () => new THREE.MeshLambertMaterial({ vertexColors: true, map: L3D.T[k]() });
L3D.MATS = L3D.MATS || {}; for (const k of ['dockdoor', 'storefront2', 'brick2', 'cold', 'corr', 'clap', 'stall', 'chrome', 'lumber']) L3D.MATS[k] = tex(k);
// ---- parts -------------------------------------------------------------------------------------------------------------
const S = L3D.S = {};
S.wall = (bt, key, a, b, y0, y1, cl, out, uw = 1.8, uh = 0.9) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  bt.quad(key, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [0, 0], [L / uw, 0], [L / uw, (y1 - y0) / uh], [0, (y1 - y0) / uh], cl, [out[0], 0, out[1]]); };
S.walls = (bt, x0, z0, x1, z1, y0, y1, key, cl, uw, uh, frontKey) => { const C = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], O = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let i = 0; i < 4; i++) S.wall(bt, i === 2 && frontKey ? frontKey : key, C[i], C[(i + 1) % 4], y0, y1, cl, O[i], uw, uh); };
S.flatRoof = (bt, x0, z0, x1, z1, y, cl, para = 0.08, roofCol = '#c9c7c2') => { bt.quad('roofgravel', [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0 / 2, z0 / 2], [x1 / 2, z0 / 2], [x1 / 2, z1 / 2], [x0 / 2, z1 / 2], col(roofCol), [0, 1, 0]);
  if (para) { const t = 0.03, c = cl.clone().multiplyScalar(0.88); for (const r of [[x0, z0, x1, z0 + t], [x0, z1 - t, x1, z1], [x0, z0, x0 + t, z1], [x1 - t, z0, x1, z1]]) bt.box('plain', r[0], y, r[1], r[2], y + para, r[3], c, 0); } };
S.hvac = (bt, x0, z0, x1, z1, y, n, seed) => { for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * (0.2 + 0.6 * hash(seed + i)), z = z0 + (z1 - z0) * (0.2 + 0.6 * hash(seed + 'z' + i));
  bt.box('glossy', x - 0.13, y, z - 0.09, x + 0.13, y + 0.14, z + 0.09, col('#a7abb0'), 0); bt.geom('glossy', CYL(0.05, 0.05, 0.03, 10), new THREE.Matrix4().makeTranslation(x, y + 0.155, z), col('#6f7378')); } };
S.gable = (bt, x0, z0, x1, z1, y, rise, roofKey, rc, wallKey, wc, ov = 0.05, alongX) => { // ridge along the long axis unless alongX given
  const w = x1 - x0, d = z1 - z0, ax = alongX ?? (w >= d), span = ax ? d : w, len = ax ? w : d;
  const P = (u, v, hh) => ax ? [x0 + u, y + hh, z0 + v] : [x0 + v, y + hh, z0 + u];
  const e0 = P(-ov, -ov, -0.02), e1 = P(len + ov, -ov, -0.02), r0 = P(-ov, span / 2, rise), r1 = P(len + ov, span / 2, rise), f0 = P(-ov, span + ov, -0.02), f1 = P(len + ov, span + ov, -0.02), sl = Math.hypot(span / 2 + ov, rise);
  bt.quad(roofKey, e0, e1, r1, r0, [0, 0], [len, 0], [len, sl], [0, sl], rc, ax ? [0, 1, -1] : [-1, 1, 0]); bt.quad(roofKey, f0, f1, r1, r0, [0, 0], [len, 0], [len, sl], [0, sl], rc, ax ? [0, 1, 1] : [1, 1, 0]);
  for (const [u, s] of [[0, -1], [len, 1]]) bt.tri(wallKey, P(u, 0, 0), P(u, span, 0), P(u, span / 2, rise), [0, 0], [span / 1.8, 0], [span / 3.6, rise / 0.9], wc, ax ? [s, 0, 0] : [0, 0, s]); };
S.sign = (bt, text, cx, y, z, wmax, bg = '#f4f1e8', fg = '#1d2a44', face = [0, 1]) => { const sl = signSlot(String(text).toUpperCase().slice(0, 30), bg, fg); if (!sl) return; const sw = Math.min(wmax, 0.35 + 3 * sl[4]), sh = sw / 8;
  const tx = face[1], tz = -face[0]; // u runs to the viewer's right
  const A = [cx - tx * sw / 2 + face[0] * 0.012, y, z - tz * sw / 2 + face[1] * 0.012], B = [cx + tx * sw / 2 + face[0] * 0.012, y, z + tz * sw / 2 + face[1] * 0.012];
  bt.quad('sign', A, B, [B[0], y + sh, B[2]], [A[0], y + sh, A[2]], [sl[0], sl[1]], [sl[2], sl[1]], [sl[2], sl[3]], [sl[0], sl[3]], WHITE, [face[0], 0, face[1]]); };
S.dock = (bt, x0, x1, z, depth, cl = col('#bdb8ae')) => { bt.box('conc', x0, 0, z, x1, 0.3, z + depth, cl, 1); for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.6) bt.box('plain', x, 0.3, z + depth - 0.02, x + 0.03, 0.42, z + depth, col('#e0c020'), 0); };
S.awning = (bt, x0, x1, z, y, depth, c) => bt.quad('plain', [x0, y, z], [x1, y, z], [x1, y - 0.12, z + depth], [x0, y - 0.12, z + depth], [0, 0], [1, 0], [1, 1], [0, 1], col(c), [0, 1, 1]);
S.cornice = (bt, x0, z0, x1, z1, y, cl) => { const o = 0.04; bt.box('plain', x0 - o, y - 0.06, z0 - o, x1 + o, y, z1 + o, cl.clone().multiplyScalar(0.8), 0); };
S.cyl = (bt, key, x, z, r, y0, h, c, seg = 20) => bt.geom(key, CYL(r, r, h, seg), new THREE.Matrix4().makeTranslation(x, y0 + h / 2, z), col(c));
S.cone = (bt, key, x, z, r, y0, h, c, seg = 20) => bt.geom(key, new THREE.ConeGeometry(r, h, seg), new THREE.Matrix4().makeTranslation(x, y0 + h / 2, z), col(c));
S.bin = (bt, x, z, r, h, c = '#d7dbdf') => { S.cyl(bt, 'corr', x, z, r, 0, h, c, 24); S.cone(bt, 'glossy', x, z, r * 1.05, h, r * 0.55, '#c9cdd1', 24); S.cyl(bt, 'glossy', x, z, r * 0.12, h + r * 0.5, 0.06, '#b0b4b8', 10);
  for (let k = 0; k < 10; k++) { const a = k / 10 * 2 * PI; bt.box('plain', x + Math.cos(a) * r - 0.006, 0, z + Math.sin(a) * r - 0.006, x + Math.cos(a) * r + 0.006, h, z + Math.sin(a) * r + 0.006, col('#9aa0a6'), 0); }
  bt.box('plain', x + r, 0, z - 0.02, x + r + 0.03, h, z + 0.02, col('#666'), 0); };
S.conveyor = (bt, a, b, w, c = '#8c8c8c') => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(0, 1, 0));
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); bt.geom('corr', BOX(w, w * 0.8, L), m, col(c)); };
S.stack = (bt, x, z, r, h, c = '#7a7a7a') => { S.cyl(bt, 'glossy', x, z, r, 0, h, c, 12); bt.geom('plain', CYL(r * 1.15, r * 1.15, 0.06, 12), new THREE.Matrix4().makeTranslation(x, h, z), col('#333')); };
S.door = (bt, x, z, w, h, c = '#4a3020') => bt.box('plain', x - w / 2, 0, z, x + w / 2, h, z + 0.012, col(c), 0);
S.chimney = (bt, x, z, y, h) => bt.box('brick', x - 0.07, y, z - 0.07, x + 0.07, y + h, z + 0.07, col('#9a4a3a'), 0.5);
S.porch = (bt, x0, x1, z, depth, y, c) => { bt.box('wood', x0, 0, z, x1, 0.06, z + depth, col('#bfae96'), 1); for (const x of [x0 + 0.03, (x0 + x1) / 2, x1 - 0.06]) bt.box('plain', x, 0.06, z + depth - 0.05, x + 0.03, y, z + depth - 0.02, col('#f2f2f2'), 0);
  bt.quad('shingle', [x0 - 0.03, y + 0.02, z], [x1 + 0.03, y + 0.02, z], [x1 + 0.03, y - 0.08, z + depth + 0.04], [x0 - 0.03, y - 0.08, z + depth + 0.04], [0, 0], [1, 0], [1, 1], [0, 1], col(c), [0, 1, 1]); };
// ---- typed generics (used for unknown kits) -------------------------------------------------------------------------
const G = L3D.gen = {};
G.store = (bt, P) => { const { w, d, h } = P, c = col(P.color || '#b5654a'); const f = Math.min(h, 0.9); S.walls(bt, 0, 0, w, d, 0, f, 'storefront2', c, 1.8, 0.9); if (h > f) S.walls(bt, 0, 0, w, d, f, h, 'brick2', c, 1.8, 0.9);
  S.cornice(bt, 0, 0, w, d, h, c); S.flatRoof(bt, 0, 0, w, d, h, c); S.hvac(bt, 0, 0, w, d, h, Math.max(1, Math.round(w * d / 8)), P.name); S.awning(bt, 0.1, w - 0.1, d, f - 0.05, 0.22, ['#2e5d3a', '#7a1f1f', '#1f3f6a', '#6a4a1f'][Math.floor(hash(P.name) * 4)]);
  if (P.sign) S.sign(bt, P.sign, w / 2, f + 0.05, d, w * 0.85, '#7a1f1f', '#fff3c4'); };
G.office = (bt, P) => { const { w, d, h } = P, c = col(P.color || '#c8c0b0'); S.walls(bt, 0, 0, w, d, 0, h, 'brick2', c); S.cornice(bt, 0, 0, w, d, h, c); S.flatRoof(bt, 0, 0, w, d, h, c); S.hvac(bt, 0, 0, w, d, h, 2, P.name); S.door(bt, w / 2, d, 0.3, 0.55, '#2a3440'); if (P.sign) S.sign(bt, P.sign, w / 2, h - 0.3, d, w * 0.8); };
G.warehouse = (bt, P) => { const { w, d, h } = P, c = col(P.color || '#c9c3b5').lerp(WHITE, 0.2); S.walls(bt, 0, 0, w, d, 0, h, 'dockdoor', c, 1.8, h); S.gable(bt, 0, 0, w, d, h, Math.min(w, d) * 0.08, 'metalroof', col('#b8bec4'), 'dockdoor', c, 0.04);
  S.dock(bt, 0.2, w - 0.2, d, 0.28); if (P.sign) S.sign(bt, P.sign, w / 2, h - 0.35, d, w * 0.7); };
G.plant = (bt, P) => { const { w, d, h } = P, c = col(P.color || '#cfc8b8').lerp(WHITE, 0.15); const w2 = w * 0.65; S.walls(bt, 0, 0, w2, d, 0, h, 'metal', c, 3.6, h); S.gable(bt, 0, 0, w2, d, h, d * 0.06, 'metalroof', col('#b4bac0'), 'metal', c);
  S.walls(bt, w2, d * 0.2, w, d, 0, h * 0.65, 'brick2', c.clone().multiplyScalar(0.9)); S.flatRoof(bt, w2, d * 0.2, w, d, h * 0.65, c); S.stack(bt, w2 * 0.3, d * 0.3, 0.12, h + 1.6); S.hvac(bt, w2, d * 0.2, w, d, h * 0.65, 2, P.name);
  S.dock(bt, 0.2, w2 - 0.2, d, 0.25); if (P.sign) S.sign(bt, P.sign, w2 + (w - w2) / 2, h * 0.65 - 0.3, d, (w - w2) * 0.9); };
G.house = (bt, P) => { const { w, d } = P, h = Math.min(P.h || 1.1, 1.6), c = col(P.color || '#e8e2d0'); S.walls(bt, 0, 0, w, d, 0, h, 'clap', c, 1.8, 0.9, 'house1'); S.gable(bt, 0, 0, w, d, h, Math.min(w, d) * 0.38, 'shingle', col(['#5b5550', '#6a5a4c', '#4f5560', '#7a3a2c'][Math.floor(hash(P.name) * 4)]), 'clap', c);
  S.chimney(bt, w * 0.8, d * 0.4, h, Math.min(w, d) * 0.45); S.porch(bt, w * 0.2, w * 0.8, d, 0.3, h * 0.82, '#4f4f52'); };
G.church = (bt, P) => { const { w, d, h } = P, c = col(P.color || '#f2f0ea'), ax = d >= w; S.walls(bt, 0, 0, w, d, 0, h, 'clap', c); S.gable(bt, 0, 0, w, d, h, Math.min(w, d) * 0.45, 'shingle', col('#4a4a50'), 'clap', c, 0.05, !ax);
  const sx = ax ? w / 2 : w - 0.45, sz = ax ? d - 0.45 : d / 2; bt.box('clap', sx - 0.42, 0, sz - 0.42, sx + 0.42, h + Math.min(w, d) * 0.45 + 0.9, sz + 0.42, c, 0.9);
  bt.geom('shingle', new THREE.ConeGeometry(0.52, 1.9, 4), new THREE.Matrix4().compose(new THREE.Vector3(sx, h + Math.min(w, d) * 0.45 + 1.85, sz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, PI / 4, 0)), new THREE.Vector3(1, 1, 1)), col('#3e3e44'));
  bt.box('plain', sx - 0.01, h + Math.min(w, d) * 0.45 + 2.8, sz - 0.01, sx + 0.01, h + Math.min(w, d) * 0.45 + 3.1, sz + 0.01, col('#ddd'), 0); S.door(bt, sx, ax ? d : sz, 0.3, 0.5, '#5a2a20'); };
G.barn = (bt, P) => { const { w, d } = P, h = Math.min(P.h || 1.6, 1.8), c = col(P.color || '#8a2f24'); S.walls(bt, 0, 0, w, d, 0, h, 'stall', c, 1.8, 0.9); S.gable(bt, 0, 0, w, d, h, Math.min(w, d) * 0.5, 'metalroof', col('#7d8288'), 'clap', c); };
G.shed = (bt, P) => { const { w, d } = P, h = Math.min(P.h || 0.75, 0.9), c = col(P.color || '#9a8a74'); S.walls(bt, 0, 0, w, d, 0, h, 'corr', c, 1, 1); S.gable(bt, 0, 0, w, d, h, Math.min(w, d) * 0.2, 'metalroof', col('#9aa0a6'), 'corr', c); };
G.station = (bt, P) => { const { w, d } = P, h = 1.2, c = col(P.color || '#b86a4a'); S.walls(bt, 0, 0, w, d, 0, h, 'brick', c); S.gable(bt, -0.2, -0.2, w + 0.2, d + 0.2, h, Math.min(w, d) * 0.3, 'shingle', col('#4a3a32'), 'brick', c, 0.12); if (P.sign) S.sign(bt, P.sign, w / 2, h - 0.25, d, w * 0.8); };
G.gin = (bt, P) => { const { w, d, h } = P, c = col('#d0d4d8'); S.walls(bt, 0, 0, w, d, 0, h, 'metal', c, 3.6, h); S.gable(bt, 0, 0, w, d, h, Math.min(w, d) * 0.1, 'metalroof', col('#b4bac0'), 'metal', c);
  S.cyl(bt, 'glossy', w * 0.15, d / 2, Math.min(w, d) * 0.2, h, 0.9, '#c4c8cc'); S.conveyor(bt, [w * 0.15, h + 0.9, d / 2], [w * 0.7, h + 0.3, d / 2], 0.18, '#a8a8a8'); for (let i = 0; i < 3; i++) S.cyl(bt, 'glossy', w * (0.3 + 0.2 * i), d * 0.2, 0.08, h, 0.6, '#9aa0a6', 10); };
G.silo = (bt, P) => { const { w, d, h } = P, n = Math.max(1, Math.round(Math.max(w, d) / Math.min(w, d))), r = Math.min(w, d) / 2 * 0.95; for (let i = 0; i < n; i++) { const x = w >= d ? w * (i + 0.5) / n : w / 2, z = w >= d ? d / 2 : d * (i + 0.5) / n;
  S.cyl(bt, 'conc', x, z, r, 0, h, P.color || '#ddd8cc', 24); bt.geom('glossy', new THREE.SphereGeometry(r, 20, 8, 0, 2 * PI, 0, PI / 2), new THREE.Matrix4().makeTranslation(x, h, z), col('#c8c4bc')); } };
G.tanks = (bt, P) => { const { w, d } = P, n = Math.max(1, Math.round(Math.max(w, d) / Math.min(w, d))), r = Math.min(w, d) / 2 * 0.9, h = Math.min(P.h || 2.0, r * 2.4 + 0.4); bt.box('conc', -0.1, 0, -0.1, w + 0.1, 0.1, d + 0.1, col('#b0aca4'), 2);
  for (let i = 0; i < n; i++) { const x = w >= d ? w * (i + 0.5) / n : w / 2, z = w >= d ? d / 2 : d * (i + 0.5) / n; S.cyl(bt, 'glossy', x, z, r, 0.1, h, '#ecebe6', 28); S.cone(bt, 'glossy', x, z, r, h + 0.1, r * 0.16, '#d0d0cc', 28);
    for (let k = 0; k < 8; k++) bt.box('plain', x + r * Math.cos(k * 0.785) - 0.005, 0.1, z + r * Math.sin(k * 0.785) - 0.005, x + r * Math.cos(k * 0.785) + 0.005, h + 0.1, z + r * Math.sin(k * 0.785) + 0.005, col('#c8c8c4'), 0);
    bt.box('plain', x + r, 0.1, z - 0.03, x + r + 0.04, h + 0.12, z + 0.03, col('#555'), 0); bt.box('plain', x + r - 0.02, h + 0.1, z - 0.06, x + r + 0.08, h + 0.16, z + 0.06, col('#e0c020'), 0); } };
G.watertower = (bt, P) => { const { w, d } = P, x = w / 2, z = d / 2, H = P.h || 5.5, R = Math.min(0.85, Math.min(w, d) * 0.42); for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4, bx = x + Math.cos(a) * R * 0.95, bz = z + Math.sin(a) * R * 0.95, tx = x + Math.cos(a) * R * 0.75, tz = z + Math.sin(a) * R * 0.75;
    S.conveyor(bt, [bx, 0, bz], [tx, H * 0.72, tz], 0.06, '#8e959c'); } for (const yy of [H * 0.25, H * 0.5]) for (let k = 0; k < 4; k++) { const a0 = k * PI / 2 + PI / 4, a1 = a0 + PI / 2, r0 = R * (0.95 - 0.2 * yy / H); S.conveyor(bt, [x + Math.cos(a0) * r0, yy, z + Math.sin(a0) * r0], [x + Math.cos(a1) * r0, yy, z + Math.sin(a1) * r0], 0.025, '#8e959c'); }
  S.cyl(bt, 'glossy', x, z, 0.07, 0, H * 0.75, '#9aa0a6', 8); S.cyl(bt, 'glossy', x, z, R, H * 0.72, R * 0.9, '#d6dbe0', 28); bt.geom('glossy', new THREE.SphereGeometry(R, 24, 8, 0, 2 * PI, 0, PI / 2), new THREE.Matrix4().makeTranslation(x, H * 0.72 + R * 0.9, z).multiply(new THREE.Matrix4().makeScale(1, 0.4, 1)), col('#c4c9ce'));
  bt.geom('glossy', new THREE.SphereGeometry(R, 24, 8, 0, 2 * PI, PI / 2, PI / 2), new THREE.Matrix4().makeTranslation(x, H * 0.72, z).multiply(new THREE.Matrix4().makeScale(1, 0.45, 1)), col('#c4c9ce'));
  bt.geom('plain', CYL(R * 1.12, R * 1.12, 0.02, 28), new THREE.Matrix4().makeTranslation(x, H * 0.72 + 0.02, z), col('#7a7f84')); if (P.sign) S.sign(bt, P.sign, x, H * 0.72 + R * 0.3, z + R + 0.005, R * 1.6, '#d6dbe0', '#1d2a44'); };
G.minor = (bt, P) => { const nm = (P.name || '').toLowerCase(), c = col(P.color || '#9e9e9e');
  if (/pool/.test(nm)) { bt.box('glossy', 0, 0, 0, P.w, 0.12, P.d, col('#e8e8e8'), 0); bt.box('glossy', 0.03, 0.12, 0.03, P.w - 0.03, 0.125, P.d - 0.03, col('#4fb3e0'), 0); return; }
  if (/module|cotton/.test(nm)) { const n = Math.max(1, Math.floor(P.w / 2.5)); for (let i = 0; i < n; i++) L3D.assets['cotton-module'].build(bt, { x: i * 2.5 + 0.05, z: 0 }); return; }
  if (/pallet/.test(nm)) { for (let i = 0; i < 4; i++) bt.box('wood', 0.1 + i * 0.25, 0, 0.1, 0.3 + i * 0.25, 0.08 + 0.04 * (i % 2), 0.3, col('#b08a5a'), 1); return; }
  if (/tank|propane/.test(nm)) { bt.geom('glossy', CYL(Math.min(P.w, P.d) / 2.2, Math.min(P.w, P.d) / 2.2, Math.max(P.w, P.d) * 0.9, 16).rotateZ(PI / 2), new THREE.Matrix4().makeTranslation(P.w / 2, Math.min(P.w, P.d) / 2.2 + 0.05, P.d / 2), col('#f0f0ee')); return; }
  if (/hay|bale/.test(nm)) { for (let i = 0; i < Math.max(1, Math.floor(P.w / 0.4)); i++) bt.geom('plain', CYL(0.17, 0.17, 0.3, 12).rotateX(PI / 2), new THREE.Matrix4().makeTranslation(0.2 + i * 0.38, 0.17, P.d / 2), col('#c8a860')); return; }
  bt.box('plain', 0, 0, 0, P.w, Math.min(0.45, Math.max(0.15, 0.3 * Math.min(P.w, P.d))), P.d, c, 0); };
// ---- named kits ---------------------------------------------------------------------------------------------------------
const kit = (id, meta, build) => L3D.reg(id, Object.assign({ cat: 'structure' }, meta), build);
const row = (stories, seedCols) => (bt, P) => { const { w, d } = P; const n = Math.max(2, Math.round(w / 2.3)); for (let i = 0; i < n; i++) { const x0 = w * i / n, x1 = w * (i + 1) / n, s = stories[i % stories.length], hh = s * 0.85 + 0.15, c = col(seedCols[i % seedCols.length]);
  S.walls(bt, x0 + 0.002, 0, x1 - 0.002, d, 0, 0.9, 'storefront2', c, 1.8, 0.9); S.walls(bt, x0 + 0.002, 0, x1 - 0.002, d, 0.9, hh, 'brick2', c, 1.8, 0.85); S.cornice(bt, x0, 0, x1, d, hh, c); S.flatRoof(bt, x0, 0, x1, d, hh, c, 0.1);
  S.awning(bt, x0 + 0.08, x1 - 0.08, d, 0.86, 0.2, ['#2e5d3a', '#7a1f1f', '#1f3f6a', '#8a6a2a'][i % 4]); S.hvac(bt, x0, 0, x1, d, hh, 1, P.name + i); }
  if (P.sign) S.sign(bt, P.sign, w / 2, 0.92, d, Math.min(w * 0.4, 2.2), '#7a1f1f', '#fff3c4'); };
kit('walthers-933-3850', { name: "Walthers Cornerstone Merchant's Row I", kit: '933-3850', dims_in: [7.5, 3.5, 2.6], verify: 'height', match: ['933-3850', "merchant's row i\\b(?!i)"] }, row([3, 2, 3], ['#a5523e', '#c9b48a', '#8a4a3a']));
kit('walthers-933-3224', { name: "Walthers Cornerstone Merchant's Row II", kit: '933-3224', dims_in: [6.25, 3.5, 2.4], verify: 'height', match: ['933-3224', "merchant's row ii\\b"] }, row([2, 3], ['#b86a4a', '#d0c4a8']));
kit('walthers-933-3851', { name: "Walthers Cornerstone Merchant's Row III", kit: '933-3851', dims_in: [6.375, 3.875, 2.6], verify: 'height', match: ['933-3851', "merchant's row iii"] }, row([3, 2, 2], ['#9a4c3c', '#c8b090', '#7a5040']));
kit('walthers-933-3858', { name: 'Walthers Cornerstone Brick Church', kit: '933-3858', dims_in: [3.5, 3.8, 2.2], height_steeple_in: 5.6, verify: 'footprint and height [EST in plan]', match: ['933-3858', 'church'] }, (bt, P) => G.church(bt, Object.assign({}, P, { color: '#b5654a', h: 1.9 })));
kit('walthers-933-3263', { name: 'Walthers Cornerstone Parkview Terrace (2-flat)', kit: '933-3263', dims_in: [2.6, 3.4, 2.0], verify: 'all', match: ['933-3263', 'parkview'] }, (bt, P) => { const { w, d } = P, c = col('#a8604a'); S.walls(bt, 0, 0, w, d, 0, 1.8, 'brick2', c); S.cornice(bt, 0, 0, w, d, 1.8, c); S.flatRoof(bt, 0, 0, w, d, 1.8, c); S.porch(bt, 0.2, w - 0.2, d, 0.35, 0.8, '#3a3a3a'); S.porch(bt, 0.2, w - 0.2, d, 0.35, 1.65, '#3a3a3a'); });
kit('walthers-933-3885', { name: 'Walthers Cornerstone Modern Gas Station', kit: '933-3885', dims_in: [5.75, 3.625, 1.75] /* [FIX-19] Walthers: main building 5-3/4 x 3-5/8 x 1-3/4 in */, match: ['933-3885', 'gas station', '65-139'] }, (bt, P) => { const { w, d } = P;
  /* [GAS-FC 2026-10-16] store only (the kit main building fills the footprint); the pump canopy is a separate forecourt prop (walthers-933-3885-canopy, props.js fallback) */
  S.walls(bt, 0, 0, w, d, 0, 1.45, 'storefront2', col('#e8e4dc')); S.flatRoof(bt, 0, 0, w, d, 1.45, col('#e0e0e0'), 0.3, '#bdbdbd'); bt.box('emis', 0, 1.3, d - 0.01, w, 1.45, d + 0.03, col('#c8202a'), 0); /* [FIX-19] 1.45 in walls + 0.3 in parapet = the kit's 1-3/4 in */
  if (P.sign) S.sign(bt, P.sign, w / 2, 1.05, d, w * 0.5); });
kit('walthers-933-3891', { name: 'Walthers Cornerstone Modern Shopping Center I', kit: '933-3891', dims_in: [6.25, 3.0, 1.1], verify: 'height', match: ['933-3891', 'shopping center', 'grocery'] }, (bt, P) => { const { w, d } = P, c = col('#d8ccb4'); S.walls(bt, 0, 0, w, d, 0, 1.0, 'storefront2', c); bt.box('plain', -0.05, 1.0, d - 0.25, w + 0.05, 1.25, d + 0.05, col('#a83a2a'), 0); S.flatRoof(bt, 0, 0, w, d, 1.0, c, 0.06); S.hvac(bt, 0, 0, w, d, 1.0, 3, 'shop'); if (P.sign) S.sign(bt, P.sign, w / 2, 1.04, d + 0.05, w * 0.6, '#a83a2a', '#ffffff'); });
kit('walthers-933-3239', { name: 'Walthers Cornerstone Sunrise Feed Mill', kit: '933-3239', dims_in: [9.0, 2.4, 4.4], verify: 'height', match: ['933-3239', 'feed mill', 'farm supply', 'ag feed'] }, (bt, P) => { const { w, d } = P, c = col('#d8d0bc');
  S.walls(bt, 0, 0, w * 0.6, d, 0, 1.4, 'metal', c, 3.6, 1.4); S.gable(bt, 0, 0, w * 0.6, d, 1.4, d * 0.15, 'metalroof', col('#a8aeb4'), 'metal', c); S.dock(bt, 0.2, w * 0.6 - 0.2, -0.3, 0.3);
  S.walls(bt, w * 0.6, 0, w * 0.82, d, 0, 4.0, 'corr', col('#c8c2b0'), 1, 1); S.gable(bt, w * 0.6, 0, w * 0.82, d, 4.0, d * 0.25, 'metalroof', col('#9aa0a6'), 'corr', col('#c8c2b0'));
  for (let i = 0; i < 2; i++) S.bin(bt, w * 0.88 + i * 0.0, d * (0.28 + 0.44 * i), d * 0.22, 2.4, '#d0d4d8'); S.conveyor(bt, [w * 0.71, 4.2, d / 2], [w * 0.9, 2.6, d * 0.3], 0.1);
  if (P.sign) S.sign(bt, P.sign, w * 0.3, 1.0, d, w * 0.5); });
kit('walthers-933-3235', { name: 'Walthers Cornerstone Lumber & Millwork', kit: '933-3235', dims_in: [5.5, 5.5, 1.6], verify: 'height', match: ['933-3235', 'lumber'] }, (bt, P) => { const { w, d } = P, c = col('#c8b89a');
  S.walls(bt, 0, 0, w, d * 0.35, 0, 1.3, 'clap', c); S.gable(bt, 0, 0, w, d * 0.35, 1.3, d * 0.08, 'metalroof', col('#8a9096'), 'clap', c);
  const y = 1.25; for (const x of [0.05, w / 2, w - 0.09]) for (const z of [d * 0.4, d - 0.1]) bt.box('wood', x, 0, z, x + 0.06, y, z + 0.06, col('#8a6a4a'), 1);
  bt.quad('metalroof', [0, y, d * 0.38], [w, y, d * 0.38], [w, y - 0.25, d], [0, y - 0.25, d], [0, 0], [w, 0], [w, 1], [0, 1], col('#a4aab0'), [0, 1, 1]);
  for (let i = 0; i < 6; i++) bt.box('lumber', 0.3 + (i % 3) * 1.7, 0, d * 0.48 + Math.floor(i / 3) * 1.4, 1.6 + (i % 3) * 1.7, 0.25 + 0.15 * (i % 2), d * 0.48 + Math.floor(i / 3) * 1.4 + 0.5, col('#ffffff'), 0.6);
  if (P.sign) S.sign(bt, P.sign, w / 2, 0.95, d * 0.35, w * 0.6); });
kit('walthers-933-3856', { name: 'Walthers Cornerstone Coastal Steel Service (steel service center)', kit: '933-3856 [verify kit no.]', dims_in: [10.5, 6.31, 3.2], verify: 'height', match: ['933-3856', 'coastal steel', 'pamlico steel'] }, (bt, P) => { const { w, d } = P, c = col('#b8b2a4'), h = 3.0;
  S.walls(bt, 0, 0, w, d, 0, h, 'metal', c, 3.6, h); S.gable(bt, 0, 0, w, d, h, d * 0.1, 'metalroof', col('#a0a6ac'), 'metal', c, 0.06, true);
  for (const x of [0, w]) bt.box('plain', x - 0.01, 0.0, d * 0.3, x + 0.01, 1.6, d * 0.7, col('#2a2a2a'), 0); // rail doors at both ends (track runs through)
  bt.box('glossy', 0.1, h - 0.35, 0.2, w - 0.1, h - 0.28, 0.3, col('#e0c020'), 0); bt.box('glossy', 0.1, h - 0.35, d - 0.3, w - 0.1, h - 0.28, d - 0.2, col('#e0c020'), 0);
  S.stack(bt, w * 0.85, d * 0.2, 0.08, h + 1.0); if (P.sign) S.sign(bt, P.sign, w / 2, h - 0.6, d, w * 0.6); });
kit('walthers-933-3233', { name: 'Riverton Pipe & Steel (kitbash pipe yard)', kit: 'kitbash (not 933-3233)', dims_in: [5.6, 5.7, 2.4], verify: 'kit identity and height', match: ['933-3233', 'pipe & steel'] }, (bt, P) => { const { w, d } = P;
  G.warehouse(bt, Object.assign({}, P, { w: w * 0.55, color: '#9aa4ae' }));
  for (let i = 0; i < 5; i++) for (let k = 0; k < 3 - (i % 2); k++) bt.geom('glossy', CYL(0.09, 0.09, 2.2, 10).rotateZ(PI / 2), new THREE.Matrix4().makeTranslation(w * 0.62 + 1.2, 0.1 + k * 0.17, 0.4 + i * 0.6 + k * 0.08), col('#6a4a3a'));
  S.conveyor(bt, [w * 0.6, 2.2, 0.2], [w - 0.1, 2.2, 0.2], 0.08, '#e0c020'); for (const x of [w * 0.6, w - 0.1]) bt.box('plain', x - 0.04, 0, 0.16, x + 0.04, 2.2, 0.24, col('#e0c020'), 0); });
kit('walthers-933-3854', { name: 'Walthers Cornerstone transload sheds + office (933-3854)', kit: '933-3854 [verify name]', dims_in: [4.0, 2.0, 1.2], verify: 'all', match: ['933-3854', 'transload', 'building supply'] }, (bt, P) => { const { w, d } = P;
  for (let i = 0; i < 2; i++) { const x0 = w * i / 2 + 0.05, x1 = w * (i + 1) / 2 - 0.05; for (const x of [x0, x1 - 0.05]) for (const z of [0.05, d - 0.1]) bt.box('plain', x, 0, z, x + 0.05, 1.0, z + 0.05, col('#7a7a7a'), 0);
    S.gable(bt, x0, 0, x1, d, 1.0, d * 0.15, 'metalroof', col('#a8aeb4'), 'corr', col('#c0c0c0'), 0.05); }
  if (P.sign) S.sign(bt, P.sign, w / 2, 0.75, d, w * 0.5); });
kit('walthers-933-3860', { name: 'Walthers Cornerstone Prairie Co-op grain elevator', kit: '933-3860', dims_in: [5.1875, 3.1875, 6.2], verify: 'height', match: ['933-3860', 'co-op', 'grain elevator', 'prairie'] }, (bt, P) => { const { w, d } = P, c = col('#c4a882'), main = Math.min(w, 3.0);
  S.walls(bt, 0, 0, main, d, 0, 4.6, 'corr', c, 1, 1); S.gable(bt, 0, 0, main, d, 4.6, d * 0.2, 'metalroof', col('#9aa0a6'), 'corr', c, 0.04, false);
  S.walls(bt, main * 0.25, d * 0.25, main * 0.75, d * 0.75, 4.6 + d * 0.2, 6.0, 'corr', c, 1, 1); S.gable(bt, main * 0.25, d * 0.25, main * 0.75, d * 0.75, 6.0, d * 0.12, 'metalroof', col('#9aa0a6'), 'corr', c);
  S.walls(bt, main, d * 0.3, w, d, 0, 1.0, 'clap', col('#d8d0b8')); S.gable(bt, main, d * 0.3, w, d, 1.0, 0.3, 'shingle', col('#5a4a3a'), 'clap', col('#d8d0b8'));
  bt.box('plain', main * 0.4, 0, -0.25, main * 0.6, 4.4, 0, col('#9a8a70'), 0); S.conveyor(bt, [main * 0.5, 5.6, d * 0.1], [w - 0.3, 2.0, -0.1], 0.08); if (P.sign) S.sign(bt, P.sign, main / 2, 3.6, d, main * 0.9, '#c4a882', '#3a1a0a'); });
kit('walthers-933-3861', { name: 'Walthers Cornerstone Down East Beverage distributor (933-3861)', kit: '933-3861 [verify name]', dims_in: [10.6, 4.7, 1.9], verify: 'height', match: ['933-3861', 'beverage'] }, (bt, P) => G.warehouse(bt, Object.assign({}, P, { h: 1.9, color: '#c8b8a0' })));
kit('walthers-933-3862', { name: 'Walthers Cornerstone Riverton Packaging (box plant, 933-3862)', kit: '933-3862 [verify name]', dims_in: [12.0, 6.75, 2.6], verify: 'height', match: ['933-3862', 'packaging', 'box co'] }, (bt, P) => { const { w, d } = P, c = col('#b0705a'), h = 2.2;
  S.walls(bt, 0, 0, w, d, 0, h, 'brick2', c); const n = Math.max(3, Math.round(w / 1.6)); for (let i = 0; i < n; i++) { const x0 = w * i / n, x1 = w * (i + 1) / n; // sawtooth roof
    bt.quad('metalroof', [x0, h, 0], [x0, h, d], [x1, h + 0.45, d], [x1, h + 0.45, 0], [0, 0], [d, 0], [d, 1], [0, 1], col('#9aa0a6'), [-0.4, 1, 0]); bt.quad('cold', [x1, h, 0], [x1, h, d], [x1, h + 0.45, d], [x1, h + 0.45, 0], [0, 0], [d, 0], [d, 1], [0, 1], col('#6f8aa0'), [1, 0, 0]);
    for (const z of [0, d]) bt.tri('brick2', [x0, h, z], [x1, h, z], [x1, h + 0.45, z], [0, 0], [1, 0], [1, 0.5], c, [0, 0, z ? 1 : -1]); }
  S.stack(bt, w * 0.08, d * 0.2, 0.15, h + 2.4, '#8a4a3a'); S.dock(bt, 0.3, w - 0.3, d, 0.25); if (P.sign) S.sign(bt, P.sign, w / 2, h - 0.4, d, w * 0.5); });
kit('walthers-933-3863', { name: 'Walthers Cornerstone UPS Hub (933-3863)', kit: '933-3863', dims_in: [12.0, 6.5, 1.9], verify: 'height', match: ['933-3863', 'ups'] }, (bt, P) => { const { w, d } = P, c = col('#d6cbb4'), h = 1.8;
  S.walls(bt, 0, 0, w, d, 0, h, 'dockdoor', c, 1.4, h); bt.box('plain', -0.02, h - 0.3, -0.02, w + 0.02, h, d + 0.02, col('#4a2f1e'), 0); S.flatRoof(bt, 0, 0, w, d, h, c, 0.06); S.hvac(bt, 0, 0, w, d, h, 4, 'ups');
  for (const z of [-0.3, d]) S.dock(bt, 0.2, w - 0.2, z, 0.3); S.sign(bt, 'UPS', w / 2, h - 0.28, d + 0.02, 1.2, '#4a2f1e', '#f2c200'); });
kit('walthers-933-3864', { name: 'Walthers Cornerstone cold storage (Tidewater Foods kitbash, 933-3864)', kit: '933-3864 [verify name]', dims_in: [12.0, 3.75, 3.0], verify: 'height', match: ['933-3864', 'tidewater foods', 'cold storage'] }, (bt, P) => { const { w, d } = P, c = col('#f2f1ec'), h = 2.8;
  S.walls(bt, 0, 0, w, d, 0, h, 'cold', c, 1.8, h); S.flatRoof(bt, 0, 0, w, d, h, c, 0.06, '#e8e8e4'); S.hvac(bt, 0, 0, w, d, h, 5, 'tf'); S.dock(bt, 0.2, w - 0.2, -0.32, 0.32);
  for (let x = 0.5; x < w - 0.4; x += 0.9) bt.box('plain', x, 0.32, -0.04, x + 0.45, 0.95, 0, col('#5a6a7a'), 0); if (P.sign) S.sign(bt, P.sign, w / 2, h - 0.5, d, w * 0.5, '#1f3f6a', '#ffffff'); });
kit('walthers-933-3218', { name: 'Walthers Cornerstone Medusa Cement terminal', kit: '933-3218', dims_in: [5.375, 4.5, 6.0], verify: 'height', match: ['933-3218', 'medusa', 'cement'] }, (bt, P) => { const { w, d } = P, r = Math.min(w, d) * 0.2;
  for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) { S.cyl(bt, 'conc', w * 0.3 + i * 2.1 * r, d * 0.3 + k * 2.1 * r, r, 0, 5.0, '#e6e2d8', 24); S.cone(bt, 'conc', w * 0.3 + i * 2.1 * r, d * 0.3 + k * 2.1 * r, r, -0.0, 0.01, '#e6e2d8'); }
  S.walls(bt, w * 0.3 - r, d * 0.3 - r, w * 0.3 + 3.1 * r, d * 0.3 + 3.1 * r, 5.0, 5.8, 'corr', col('#c8c4b8'), 1, 1); S.flatRoof(bt, w * 0.3 - r, d * 0.3 - r, w * 0.3 + 3.1 * r, d * 0.3 + 3.1 * r, 5.8, col('#c8c4b8'), 0.04);
  bt.box('plain', w * 0.05, 1.0, 0.05, w - 0.05, 1.08, d * 0.2, col('#777'), 0); for (const x of [w * 0.1, w * 0.9]) bt.box('plain', x, 0, 0.05, x + 0.05, 1.0, 0.1, col('#777'), 0);
  S.sign(bt, P.sign || 'MEDUSA CEMENT', w * 0.3 + r, 4.2, d * 0.3 + 3.1 * r + 0.01, 2.4, '#e6e2d8', '#1d2a44'); });
kit('walthers-933-3222', { name: 'Walthers Cornerstone Mi-Jack Translift crane', kit: '933-3222', dims_in: [4.0, 3.125, 3.6], verify: 'height', match: ['933-3222', 'mi-jack'] }, (bt, P) => { const { w, d } = P, h = 3.4, y = col('#e0c020');
  for (const x of [0.1, w - 0.25]) { for (const z of [0.1, d - 0.25]) bt.box('glossy', x, 0.15, z, x + 0.15, h, z + 0.15, y, 0); bt.box('glossy', x, 0, 0.05, x + 0.15, 0.2, d - 0.05, col('#333'), 0); bt.box('glossy', x - 0.02, h - 0.4, 0.05, x + 0.17, h, d - 0.05, y, 0); }
  bt.box('glossy', 0.05, h - 0.3, d / 2 - 0.2, w - 0.05, h, d / 2 + 0.2, y, 0); bt.box('glossy', w * 0.4, h - 0.65, d / 2 - 0.3, w * 0.6, h - 0.3, d / 2 + 0.3, col('#f0f0f0'), 0); bt.box('plain', w * 0.25, h - 1.2, d / 2 - 0.5, w * 0.75, h - 1.1, d / 2 + 0.5, col('#444'), 0); });
kit('walthers-933-3200', { name: 'Walthers Cornerstone Interstate Fuel & Oil loading rack', kit: '933-3200', dims_in: [3.1, 3.75, 1.8], verify: 'height', match: ['933-3200', 'fuel & oil', 'tank farm rack'] }, (bt, P) => { const { w, d } = P;
  bt.box('plain', 0, 0.9, 0, w * 0.25, 0.95, d, col('#8a8a8a'), 0); for (let z = 0.1; z < d; z += 0.7) bt.box('plain', 0.02, 0, z, 0.08, 1.6, z + 0.06, col('#666'), 0); for (let z = 0.4; z < d; z += 0.7) bt.box('glossy', w * 0.25, 0.95, z, w * 0.25 + 0.3, 0.99, z + 0.04, col('#e0c020'), 0);
  G.tanks(bt, { w: w * 0.6, d, h: 1.6 }); });
kit('walthers-933-3265', { name: 'Walthers Cornerstone storage tanks', kit: '933-3265 [verify]', dims_in: [2.125, 2.125, 2.0], verify: 'all', match: ['933-3265', '933-3893', 'tank farm', 'storage tank'] }, (bt, P) => G.tanks(bt, P));
kit('walthers-933-3258', { name: 'Walthers Cornerstone Butterfly station platform (per section)', kit: '933-3258', dims_in: [6.13, 1.25, 1.1], verify: 'height', match: ['933-3258', 'butterfly', 'platform'] }, (bt, P) => { const { w, d } = P;
  bt.box('conc', 0, 0, 0, w, 0.08, d, col('#cfccc4'), 1); bt.box('plain', 0, 0.08, d - 0.04, w, 0.09, d, col('#e8d040'), 0); for (let x = 0.4; x < w; x += 1.2) bt.box('plain', x, 0.08, d / 2 - 0.03, x + 0.06, 0.95, d / 2 + 0.03, col('#555'), 0);
  for (const s of [-1, 1]) bt.quad('metalroof', [0, 0.95, d / 2], [w, 0.95, d / 2], [w, 1.05, d / 2 + s * d * 0.55], [0, 1.05, d / 2 + s * d * 0.55], [0, 0], [w, 0], [w, 1], [0, 1], col('#5a6066'), [0, 1, s * 0.3]); });
kit('walthers-933-3812', { name: 'Walthers Cornerstone water tower [verify kit no.]', kit: '933-3812 [verify]', dims_in: [2.2, 2.2, 5.5], verify: 'kit no. and dims', match: ['933-3812', 'water tower'] }, (bt, P) => G.watertower(bt, P));
kit('walthers-933-3268', { name: 'Walthers Cornerstone truck/rail docks', kit: '933-3268 [verify]', dims_in: [6.0, 1.0, 0.3], verify: 'all', match: ['933-3268', 'truck dock'] }, (bt, P) => S.dock(bt, 0, P.w, 0, P.d));
kit('ws-br4956', { name: "Woodland Scenics BR4956 Miss Molly's Diner", kit: 'BR4956', dims_in: [2.75, 2.4, 0.95], verify: 'height', match: ['br4956', 'diner', 'grill'] }, (bt, P) => { const { w, d } = P, dw = d * 0.55;
  S.walls(bt, 0, d - dw, w, d, 0.1, 0.75, 'chrome', col('#ffffff'), 0.9, 0.65); bt.box('plain', 0, 0, d - dw, w, 0.1, d, col('#3a3a3a'), 0);
  bt.geom('glossy', new THREE.CylinderGeometry(dw / 2, dw / 2, w, 16, 1, false, -PI / 2, PI).rotateZ(PI / 2), new THREE.Matrix4().makeTranslation(w / 2, 0.75, d - dw / 2).multiply(new THREE.Matrix4().makeScale(1, 0.35, 1)), col('#d8dce0'));
  S.walls(bt, w * 0.6, 0, w, d - dw, 0, 0.8, 'clap', col('#e8e2d0')); S.flatRoof(bt, w * 0.6, 0, w, d - dw, 0.8, col('#ccc'), 0.03); S.chimney(bt, w * 0.8, 0.3, 0.8, 0.35);
  S.sign(bt, P.sign || 'DINER', w / 2, 0.92, d - dw / 2, w * 0.7, '#c8202a', '#ffffff'); });
kit('mu-n-h00041', { name: 'Modellbahn Union N-H00041 horse stable', kit: 'N-H00041', dims_mm: [95, 42], dims_in: [3.74, 1.65, 1.5], verify: 'height', match: ['n-h00041', 'stable'] }, (bt, P) => { const { w, d } = P, c = col('#8a3a2a');
  S.walls(bt, 0, 0, w, d, 0, 0.85, 'stall', c, 1.0, 0.85); S.gable(bt, 0, 0, w, d, 0.85, d * 0.4, 'shingle', col('#4a4a4a'), 'clap', c, 0.12); bt.box('plain', w * 0.45, 0.85 + d * 0.4, d / 2 - 0.12, w * 0.55, 0.85 + d * 0.4 + 0.3, d / 2 + 0.12, col('#e8e2d0'), 0); });
kit('isle-grain-bins', { name: 'Iowa Scaled Engineering grain bins (corrugated, cone roof)', kit: 'Iowa Scaled Engineering N grain bin [verify part no.]', dims_in: [1.8, 1.8, 2.0], verify: 'diameter/height', match: ['iowa scaled', 'grain bin', 'bins'] }, (bt, P) => { const n = Math.max(1, Math.round(Math.max(P.w, P.d) / Math.min(P.w, P.d))), r = Math.min(P.w, P.d) / 2 * 0.95;
  for (let i = 0; i < n; i++) S.bin(bt, P.w >= P.d ? P.w * (i + 0.5) / n : P.w / 2, P.w >= P.d ? P.d / 2 : P.d * (i + 0.5) / n, r, Math.min(P.h || 2, 2.2)); });
kit('dpm-51300', { name: 'DPM 51300 Corner Turret Building', kit: 'DPM 51300', dims_in: [2.4, 2.4, 2.3], verify: 'all', match: ['51300', 'turret', 'bank'] }, (bt, P) => { const { w, d } = P, c = col('#9a5040');
  S.walls(bt, 0, 0, w, d, 0, 0.9, 'storefront2', c); S.walls(bt, 0, 0, w, d, 0.9, 2.0, 'brick2', c, 1.8, 0.55); S.cornice(bt, 0, 0, w, d, 2.0, c); S.flatRoof(bt, 0, 0, w, d, 2.0, c, 0.12);
  S.cyl(bt, 'brick2', w - 0.3, d - 0.3, 0.38, 0.9, 1.4, '#9a5040', 12); S.cone(bt, 'shingle', w - 0.3, d - 0.3, 0.44, 2.3, 0.7, '#3e4a40', 12); if (P.sign) S.sign(bt, P.sign, w / 2, 0.93, d, w * 0.7, '#1d2a44', '#f2d77a'); });
kit('dpm-50200', { name: 'DPM 50200 storefront (Pamlico Grocery) [verify kit]', kit: 'DPM 50200 [verify]', dims_in: [2.5, 3.0, 1.5], verify: 'kit identity and dims', match: ['50200'] }, (bt, P) => G.store(bt, Object.assign({}, P, { h: 1.5, color: '#b8704a' })));
kit('dpm-modulars', { name: 'DPM Modulars low-relief wall (60103/60122/60132)', kit: 'DPM 60103 + 60122 + 60132', dims_in: [4.0, 0.4, 1.8], verify: 'height', match: ['modulars', '60103', '60122'] }, (bt, P) => { const c = col('#a8604a'); S.walls(bt, 0, 0, P.w, P.d, 0, 0.9, 'storefront2', c); S.walls(bt, 0, 0, P.w, P.d, 0.9, 1.8, 'brick2', c, 1.8, 0.9); S.cornice(bt, 0, 0, P.w, P.d, 1.8, c); S.flatRoof(bt, 0, 0, P.w, P.d, 1.8, c); });
kit('kitbash-polymers', { name: 'Pamlico Polymers plastic-pellet silos + vacuum unloader (kitbash)', kit: 'kitbash [EST]', dims_in: [14, 3.5, 5.4], verify: 'all', match: ['polymers'] }, (bt, P) => { const sw = P.w < P.d, w = Math.max(P.w, P.d), d = Math.min(P.w, P.d), n = Math.max(2, Math.round(w / d)), r = d * 0.42; /* fix: footprint can arrive rotated (w<d) -> one giant dome; lay the row along the long axis */
  const _bt = bt; bt = { box: (k, x0, y0, z0, x1, y1, z1, c, u) => sw ? _bt.box(k, z0, y0, x0, z1, y1, x1, c, u) : _bt.box(k, x0, y0, z0, x1, y1, z1, c, u), geom: (k, g, M, c) => _bt.geom(k, g, sw ? new THREE.Matrix4().makeTranslation(M.elements[14], M.elements[13], M.elements[12]) : M, c) };
  for (let i = 0; i < n; i++) { const x = w * (i + 0.5) / n; S.cyl(_bt, 'glossy', sw ? d / 2 : x, sw ? x : d / 2, r, 1.0, P.h - 1.0 - r, '#e8e6e0', 24); bt.geom('glossy', new THREE.SphereGeometry(r, 20, 8, 0, 2 * PI, 0, PI / 2), new THREE.Matrix4().makeTranslation(x, P.h - r, d / 2), col('#d8d6d0')); S.cone(_bt, 'glossy', sw ? d / 2 : x, sw ? x : d / 2, r, 0.35, 0.65, '#d8d6d0', 20);
    for (let k = 0; k < 4; k++) bt.box('plain', x + Math.cos(k * PI / 2 + 0.78) * r * 0.8 - 0.03, 0, d / 2 + Math.sin(k * PI / 2 + 0.78) * r * 0.8 - 0.03, x + Math.cos(k * PI / 2 + 0.78) * r * 0.8 + 0.03, 1.0, d / 2 + Math.sin(k * PI / 2 + 0.78) * r * 0.8 + 0.03, col('#888'), 0); }
  bt.box('plain', 0, P.h - 0.1, d / 2 - 0.08, w, P.h - 0.02, d / 2 + 0.08, col('#999'), 0); if (P.sign && !sw) S.sign(_bt, P.sign, w / 2, 1.2, d / 2 + r + 0.02, Math.min(3, w * 0.3), '#1f3f6a', '#ffffff'); });
// typed generics in the registry (unknown kits resolve to these)
for (const [id, fn, nm] of [['gen-store', 'store', 'Generic storefront'], ['gen-office', 'office', 'Generic office'], ['gen-warehouse', 'warehouse', 'Generic warehouse'], ['gen-plant', 'plant', 'Generic plant'], ['gen-house', 'house', 'Generic house'], ['gen-church', 'church', 'Generic church'], ['gen-barn', 'barn', 'Generic barn'], ['gen-shed', 'shed', 'Generic shed'], ['gen-station', 'station', 'Generic depot'], ['gen-gin', 'gin', 'Generic cotton gin'], ['gen-silo', 'silo', 'Generic silo'], ['gen-tanks', 'tanks', 'Generic tanks'], ['gen-watertower', 'watertower', 'Generic water tower'], ['gen-minor', 'minor', 'Generic minor detail']])
  L3D.reg(id, { cat: 'structure-generic', name: nm + ' (parameterized by footprint)', kind: fn }, (bt, P) => G[fn](bt, P));
/* [VARIANT-HOOK 2026-10-16] Grok batch ids (tools/grok_sim, (build path)) -> what to draw until that .glb is ingested */
L3D.FALLBACK = Object.assign({
  'walthers-933-3853-hay': 'gen-barn', 'walthers-933-3853-runin': 'gen-shed', 'walthers-933-3853-shed': 'gen-shed', 'walthers-933-3853-garage': 'gen-shed', 'walthers-933-3853': 'gen-warehouse',
  'walthers-933-3200-rack': 'walthers-933-3200', 'walthers-933-3200-pump': 'gen-shed', 'walthers-933-3885-canopy': null /* props.js procedural canopy until ingested */,
  'walthers-933-3892': 'mu-n-h00041', 'walthers-933-3890': 'gen-house', 'walthers-933-3888': 'gen-house', 'walthers-933-3838': 'gen-house', 'walthers-933-3834': 'gen-office',
  'walthers-933-3240': 'gen-station', 'walthers-933-3893': 'walthers-933-3265', 'walthers-933-3855': null /* [RV3] own GLB from structs.alb3855 */, 'ws-785-2253': null,
  'load-pellet-rack': 'walthers-933-3200', 'load-pellet-silo': 'walthers-933-3265', 'load-dump-shed': null }, L3D.FALLBACK || {});
/* [RV2] scratch-built items with no GLB of their own: drawn by the parametric shed builder at their plan size (not a stand-in GLB) */
/* [RV3] the three items below now have Blender GLBs (assets/external); these parametric builders only run if a GLB fails to load */
for (const [id, nm] of [['load-dump-shed', 'Truck dump shed over pit (cut-down 933-3854 roof, scratch)'], ['load-guard-shack', 'Guard shack (scratch, 1 x 1 in)'], ['walthers-933-3855', 'Modern Steel Warehouse 933-3855 (cut kit; no GLB yet)']]) L3D.reg(id, { cat: 'structure-generic', name: nm, kind: 'shed' }, (bt, P) => (id === 'walthers-933-3855' ? G.warehouse : G.shed)(bt, P));
L3D.pickAsset = id => { for (let g = 0; id && g < 8; g++) { if ((L3D.ext && L3D.ext.has && L3D.ext.has(id)) || L3D.assets[id]) return id; id = L3D.FALLBACK[id]; } return null; };
// resolve a plan structure to an asset id
L3D.resolveStructure = (s) => { let nm = (s.name || '').toLowerCase();
  /* [KIT-TAG 2026-10-16] plan hint wins; a trailing [kit no.] tag (rev4 export) picks that kit's asset, and when no asset has that kit the
     building falls back to its typed generic instead of a keyword match ('house on Church Ln' is not a church, 'co-op office' is not the elevator) */
  /* [VARIANT-HOOK 2026-10-16] assetHint may be one id or a list (most specific first). A hint whose .glb is ingested wins; otherwise each
     hint walks L3D.FALLBACK (variant -> base kit -> typed generic) to the first id that has a glb or a registered builder. A [kit no.] tag
     likewise prefers that kit's own ingested glb (walthers-933-XXXX / ws-XXX-XXXX) before the registry match. */
  const X = id => !!(L3D.ext && L3D.ext.has && L3D.ext.has(id));
  const hints = [].concat(s.assetHint || []);
  for (const h of hints) if (X(h)) return h;
  for (const h of hints) { const f = L3D.pickAsset(h); if (f) return f; }
  const tag = (nm.match(/\[(\d{3}-\d{4})\]\s*$/) || [])[1];
  if (tag) { for (const c of ['walthers-' + tag, 'ws-' + tag]) if (X(c)) return c; }
  if (tag) { const a = Object.values(L3D.assets).find(a => a.match && a.match.some(m => m === tag)); if (a) return a.id; nm = ''; }
  /* [NAME-MATCH v2 2026-10-15] a name match only counts if the plan footprint is a plausible size for that asset: props named after a building
     ('dumpster (diner)', 'co-op grain bin') used to resolve to the whole building. Candidates whose kit footprint is >4x the plan footprint are
     dropped; among the rest the longest matching key wins, keys with a kit number (4+ digits) first. */
  const fa = Math.max(0.01, (s.r[2] - s.r[0]) * (s.r[3] - s.r[1])); let best = null, bl = -1;
  for (const a of Object.values(L3D.assets)) { if (!a.match) continue; const m = a.match.filter(m => new RegExp(m, 'i').test(nm)).sort((x, y) => y.length - x.length)[0]; if (!m) continue;
    const dm = a.dims_in || a.size_in; if (dm && dm[0] * dm[2] > 4 * fa) continue; const sc = m.length + (/\d{4}/.test(m) ? 100 : 0); if (sc > bl) { best = a.id; bl = sc; } }
  if (best) return best;
  const k = s.kind; const map = { commercial: 'gen-store', office: 'gen-office', industrial: /gin/.test(nm) ? 'gen-gin' : (s.r[2] - s.r[0]) * (s.r[3] - s.r[1]) > 40 ? 'gen-plant' : 'gen-warehouse', house: 'gen-house', church: 'gen-church', barn: 'gen-barn', shed: 'gen-shed', station: 'gen-station', silo: 'gen-silo', bin: 'isle-grain-bins', tanks: 'gen-tanks', watertower: 'gen-watertower', elevator: 'walthers-933-3860', minor: 'gen-minor', pool: 'gen-minor' };
  return map[k] || 'gen-warehouse'; };
})(window.L3D);
