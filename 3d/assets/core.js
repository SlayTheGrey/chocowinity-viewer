/* layout3d asset core: shared helpers, procedural canvas textures, shared materials, Batch (merge-by-material with local transform).
   Everything is in real inches (N scale 1:160 models). Loaded before the asset modules and viewer.js. */
'use strict';
window.L3D = window.L3D || {};
(function (L3D) {
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
// ------------------------------------------------------------------ utilities
const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const col = c => new THREE.Color(c);
const WHITE = col('#ffffff');
function resample(P, step) { // uniform arc-length resampling; keeps real corners (> 20 deg) so lot outlines stay square
  const out = [[P[0][0], P[0][1]]]; let carry = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    let d = step - carry; while (d < L - 1e-6) { out.push([a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]); d += step; } carry = L - (d - step);
    if (i + 2 < P.length) { const c = P[i + 2], t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]); let dt = Math.abs(t2 - t1); if (dt > Math.PI) dt = 2 * Math.PI - dt; if (dt > 0.35) { out.push([b[0], b[1]]); carry = 0; } }
  }
  const e = P[P.length - 1], l = out[out.length - 1]; if (Math.hypot(e[0] - l[0], e[1] - l[1]) > 1e-4) out.push([e[0], e[1]]); return out;
}
function frames(P) { // per-point unit tangent + left normal
  return P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l; return [tx, ty, -ty, tx]; });
}
function plen(P) { let s = 0; for (let i = 0; i + 1 < P.length; i++) s += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); return s; }
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function segDist(px, py, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy); }
// ------------------------------------------------------------------ procedural canvas textures (shared)
const TEX = {};
function canvasTex(key, w, h, draw, repeat = true) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return (TEX[key] = t);
}
function noise(g, w, h, base, amp, n, sz = 2) { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (rnd() - 0.5) * amp; g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`; g.fillRect(rnd() * w, rnd() * h, sz, sz); } }
const T = {
  grass: () => canvasTex('grass', 512, 512, (g, w, h) => { noise(g, w, h, '#82955c' /* REAL1: duller mid-Oct fescue/bermuda (was #7fa35a lime) */, 0.22, 26000, 2); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd() < .5 ? '60,80,30' : '170,180,90'},0.10)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 60, 0, 7); g.fill(); } }),
  asphalt: () => canvasTex('asphalt', 256, 256, (g, w, h) => noise(g, w, h, '#4a4b4d', 0.25, 9000, 1)),
  gravel: () => canvasTex('gravel', 256, 256, (g, w, h) => noise(g, w, h, '#a8a296', 0.35, 14000, 2)),
  concrete: () => canvasTex('concrete', 256, 256, (g, w, h) => { noise(g, w, h, '#c9c6bf', 0.12, 6000, 2); g.strokeStyle = '#999'; g.lineWidth = 2; g.strokeRect(0, 0, w, h); }),
  parking: () => canvasTex('parking', 256, 256, (g, w, h) => { noise(g, w, h, '#4f5052', 0.22, 8000, 1); g.fillStyle = '#e8e8e8'; for (let i = 0; i < 4; i++) { g.fillRect(i * 64, 10, 3, 92); g.fillRect(i * 64, 154, 3, 92); } }),
  ballast: () => canvasTex('ballast', 256, 64, (g, w, h) => noise(g, w, h, '#8d8a85', 0.35, 7000, 2)),
  field_tobacco: () => canvasTex('ft', 128, 128, (g, w, h) => { noise(g, w, h, '#7a5d3d', 0.2, 2000, 2); for (let x = 0; x < w; x += 16) { g.fillStyle = '#4f8a2a'; g.fillRect(x + 2, 0, 11, h); for (let y = 0; y < h; y += 8) { g.fillStyle = '#6fae3c'; g.beginPath(); g.arc(x + 7, y + 4, 5, 0, 7); g.fill(); } } }),
  field_cotton: () => canvasTex('fc', 128, 128, (g, w, h) => { noise(g, w, h, '#6b5a3a', 0.2, 2000, 2); for (let x = 0; x < w; x += 16) { g.fillStyle = '#5d7040'; g.fillRect(x + 3, 0, 9, h); for (let i = 0; i < 40; i++) { g.fillStyle = '#f4f2ea'; g.fillRect(x + 3 + rnd() * 9, rnd() * h, 2, 2); } } }),
  field_plow: () => canvasTex('fp', 128, 128, (g, w, h) => { noise(g, w, h, '#8b6a45', 0.25, 3000, 2); for (let x = 0; x < w; x += 8) { g.fillStyle = '#00000022'; g.fillRect(x, 0, 3, h); } }),
  marsh: () => canvasTex('marsh', 256, 256, (g, w, h) => { noise(g, w, h, '#a7b86a', 0.3, 14000, 2); for (let i = 0; i < 900; i++) { g.strokeStyle = rnd() < .5 ? '#6f7f3a' : '#c6c98a'; g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.lineTo(x + rnd() * 3 - 1.5, y - 6); g.stroke(); } }),
  wood: () => canvasTex('wood', 512, 512, (g, w, h) => { for (let y = 0; y < h; y += 32) { g.fillStyle = `hsl(30,${30 + rnd() * 10}%,${42 + rnd() * 8}%)`; g.fillRect(0, y, w, 31); g.fillStyle = '#00000030'; g.fillRect(0, y + 31, w, 1); const o = rnd() * w; g.fillRect(o, y, 1, 31); } }),
  roofgravel: () => canvasTex('rg', 128, 128, (g, w, h) => noise(g, w, h, '#b4b2ad', 0.3, 5000, 1)),
  shingle: () => canvasTex('sh', 128, 128, (g, w, h) => { noise(g, w, h, '#d0d0d0', 0.2, 2000, 1); g.fillStyle = '#00000038'; for (let y = 0; y < h; y += 8) { g.fillRect(0, y, w, 1); for (let x = (y / 8 % 2) * 8; x < w; x += 16) g.fillRect(x, y, 1, 8); } }),
  metalroof: () => canvasTex('mr', 128, 128, (g, w, h) => { g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = '#00000022'; g.fillRect(x, 0, 2, h); g.fillStyle = '#ffffff40'; g.fillRect(x + 3, 0, 1, h); } }),
  // walls: 256 px = 1.8 in wide, 128 px = one 12 ft story (0.9 in); light/neutral so vertex colour tints them
  brick: () => canvasTex('brick', 256, 128, (g, w, h) => { noise(g, w, h, '#efefef', 0.12, 3000, 1); g.fillStyle = '#00000018'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); for (const x of [36, 148]) win(g, x, 34, 56, 58); g.fillStyle = '#ffffff60'; g.fillRect(0, 0, w, 4); }),
  store: () => canvasTex('store', 256, 128, (g, w, h) => { noise(g, w, h, '#efefef', 0.1, 2000, 1); g.fillStyle = '#203040'; g.fillRect(14, 40, 150, 78); g.fillStyle = '#7fa2b8'; g.fillRect(18, 44, 142, 70); g.fillStyle = '#3a2a20'; g.fillRect(186, 34, 44, 94); g.fillStyle = '#9fc2d8'; g.fillRect(192, 42, 32, 40); g.fillStyle = '#ffffffa0'; for (let x = 18; x < 160; x += 36) g.fillRect(x, 44, 2, 70); g.fillStyle = '#00000050'; g.fillRect(0, 20, w, 12); }),
  siding: () => canvasTex('siding', 256, 128, (g, w, h) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#00000020'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1); win(g, 40, 36, 44, 54, true); win(g, 170, 36, 44, 54, true); }),
  house1: () => canvasTex('house1', 256, 128, (g, w, h) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h); g.fillStyle = '#00000020'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1); win(g, 30, 36, 44, 54, true); g.fillStyle = '#5a3a28'; g.fillRect(120, 40, 34, 88); g.fillStyle = '#c8b28a'; g.fillRect(124, 44, 26, 30); win(g, 186, 36, 44, 54, true); }),
  metal: () => canvasTex('metal', 512, 256, (g, w, h) => { g.fillStyle = '#ececec'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 6) { g.fillStyle = '#00000020'; g.fillRect(x, 0, 2, h); } g.fillStyle = '#9a9a9a'; g.fillRect(70, 130, 120, 126); g.fillRect(330, 130, 120, 126); g.fillStyle = '#00000030'; for (let y = 134; y < h; y += 8) { g.fillRect(70, y, 120, 2); g.fillRect(330, y, 120, 2); } g.fillStyle = '#4a5560'; g.fillRect(240, 186, 30, 70); g.fillStyle = '#ffffff70'; g.fillRect(0, 0, w, 6); }),
  conc: () => canvasTex('conc', 256, 128, (g, w, h) => { noise(g, w, h, '#e4e2dc', 0.12, 3000, 1); g.fillStyle = '#00000014'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1); }),
  sky: () => canvasTex('sky', 1024, 512, (g, w, h) => { /* [CHOCO-SKY] tileable: soft clouds wrapped across x=0/w, hills periodic in w */ const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6f9fd8'); gr.addColorStop(0.62, '#c6dcf0'); gr.addColorStop(0.8, '#e8eef0'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const puff = (x, y, rx, ry, a) => { for (const ox of [-w, 0, w]) { g.save(); g.translate(x + ox, y); g.scale(1, ry / rx); const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx); rg.addColorStop(0, 'rgba(255,255,255,' + a + ')'); rg.addColorStop(0.55, 'rgba(255,255,255,' + (a * 0.6) + ')'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.beginPath(); g.arc(0, 0, rx, 0, 7); g.fill(); g.restore(); } };
    for (let i = 0; i < 14; i++) { const x = rnd() * w, y = 70 + rnd() * 150, n = 4 + Math.floor(rnd() * 4); for (let k = 0; k < n; k++) puff(x + (k - n / 2) * 22 + rnd() * 10, y + rnd() * 10 - 5, 34 + rnd() * 26, 13 + rnd() * 8, 0.42); }
    const P = (x, a) => a.reduce((m, [k, amp, ph]) => m + amp * Math.sin(2 * Math.PI * k * x / w + ph), 0); const H1 = [[3, 9, 0.4], [7, 6, 1.9], [13, 4, 0.7], [29, 2.5, 2.2], [53, 1.5, 4.1]], H2 = [[5, 6, 2.6], [11, 4, 0.2], [23, 3, 1.3], [61, 2, 3.3], [97, 1.2, 0.9]];
    g.fillStyle = '#6f8a5f'; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.78 - 12 - P(x, H1)); g.lineTo(w, h); g.fill();
    g.fillStyle = '#4f6a45'; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.86 - 4 - P(x, H2)); g.lineTo(w, h); g.fill(); }, true),
  wall: () => canvasTex('wall', 256, 256, (g, w, h) => noise(g, w, h, '#d9d4c8', 0.06, 3000, 2)),
  carpet: () => canvasTex('carpet', 256, 256, (g, w, h) => noise(g, w, h, '#5d5f63', 0.2, 20000, 1)),
};
function win(g, x, y, w, h, white) { g.fillStyle = white ? '#ffffff' : '#e0d8cc'; g.fillRect(x - 3, y - 3, w + 6, h + 7); g.fillStyle = '#2a3440'; g.fillRect(x, y, w, h); g.fillStyle = '#5c7288'; g.fillRect(x + 2, y + 2, w - 4, h / 2 - 3); g.fillStyle = white ? '#ffffff' : '#ccc'; g.fillRect(x, y + h / 2 - 1, w, 2); g.fillRect(x + w / 2 - 1, y, 2, h); }
// sign atlas (one texture for all signs)
const SIGN = { c: document.createElement('canvas'), n: 0, cols: 4, rows: 32 }; SIGN.c.width = 2048; SIGN.c.height = 2048; SIGN.tex = null;
function signSlot(text, bg, fg) {
  if (SIGN.n >= SIGN.cols * SIGN.rows) return null; const i = SIGN.n++, cw = 512, ch = 64, x = (i % SIGN.cols) * cw, y = Math.floor(i / SIGN.cols) * ch;
  const g = SIGN.c.getContext('2d'); g.fillStyle = bg; g.fillRect(x, y, cw, ch); g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(x + 3, y + 3, cw - 6, ch - 6);
  let fs = 40; g.font = `bold ${fs}px sans-serif`; while (g.measureText(text).width > cw - 24 && fs > 14) { fs -= 2; g.font = `bold ${fs}px sans-serif`; }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x + cw / 2, y + ch / 2 + 1);
  const W = SIGN.c.width, H = SIGN.c.height; return [x / W, 1 - (y + ch) / H, (x + cw) / W, 1 - y / H, Math.min(1, g.measureText(text).width / (cw - 24))];
}
// ------------------------------------------------------------------ materials (shared, cached)
const MAT = {};
function mat(key) {
  if (MAT[key]) return MAT[key]; let m;
  const L = (o) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, o));
  const tex = { grass: 'grass', asphalt: 'asphalt', gravel: 'gravel', concrete: 'concrete', parking: 'parking', ballast: 'ballast', ft: 'field_tobacco', fc: 'field_cotton', fp: 'field_plow', marsh: 'marsh',
    roofgravel: 'roofgravel', shingle: 'shingle', metalroof: 'metalroof', brick: 'brick', store: 'store', siding: 'siding', house1: 'house1', metal: 'metal', conc: 'conc', wood: 'wood', carpet: 'carpet', wall: 'wall' }[key];
  const ext = !tex && L3D.MATS && L3D.MATS[key];
  if (ext) m = ext();
  else if (tex) m = L({ map: T[tex]() });
  else if (key === 'water') m = new THREE.MeshPhongMaterial({ color: 0x3e3a28 /* REAL1 tannin blackwater */, specular: 0x8a8a80, shininess: 90, transparent: true, opacity: 0.88, vertexColors: false });
  else if (key === 'sign') m = L({ map: SIGN.tex });
  else if (key === 'emis') m = new THREE.MeshBasicMaterial({ vertexColors: true });
  else if (key === 'rail') m = new THREE.MeshPhongMaterial({ vertexColors: true, color: 0xc9ccd0, specular: 0xffffff, shininess: 80 });
  else if (key === 'glossy') m = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x666666, shininess: 50 });
  else m = L({});
  return (MAT[key] = m);
}
// ------------------------------------------------------------------ Batch: merge everything static by material
class Batch {
  constructor() { this.m = {}; this.M = null; this.NM = new THREE.Matrix3(); }
  setT(m) { this.M = m; if (m) this.NM.getNormalMatrix(m); return this; }
  _tp(v) { if (!this.M) return v; const e = this.M.elements, x = v[0], y = v[1], z = v[2]; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; }
  _tn(v) { if (!this.M || !v) return v; const e = this.NM.elements, x = v[0], y = v[1], z = v[2]; return [e[0] * x + e[3] * y + e[6] * z, e[1] * x + e[4] * y + e[7] * z, e[2] * x + e[5] * y + e[8] * z]; }
  b(key) { return this.m[key] || (this.m[key] = { p: [], n: [], u: [], c: [] }); }
  tri(key, a, b, c, ua, ub, uc, cl, hint) {
    if (this.M) { a = this._tp(a); b = this._tp(b); c = this._tp(c); hint = this._tn(hint); }
    const B = this.b(key); const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; nx = -nx; ny = -ny; nz = -nz; }
    for (const [v, uv] of [[a, ua], [b, ub], [c, uc]]) { B.p.push(v[0], v[1], v[2]); B.n.push(nx, ny, nz); B.u.push(uv[0], uv[1]); B.c.push(cl.r, cl.g, cl.b); }
  }
  quad(key, a, b, c, d, ua, ub, uc, ud, cl, hint) { this.tri(key, a, b, c, ua, ub, uc, cl, hint); this.tri(key, a, c, d, ua, uc, ud, cl, hint); }
  geom(key, g, m, cl) {
    const gg = g.index ? g.toNonIndexed() : g.clone(); if (m) gg.applyMatrix4(m); if (this.M) gg.applyMatrix4(this.M); const B = this.b(key);
    const P = gg.attributes.position.array, N = gg.attributes.normal.array, U = gg.attributes.uv ? gg.attributes.uv.array : null, C = gg.attributes.color ? gg.attributes.color.array : null;
    for (let i = 0; i < P.length / 3; i++) { B.p.push(P[3 * i], P[3 * i + 1], P[3 * i + 2]); B.n.push(N[3 * i], N[3 * i + 1], N[3 * i + 2]); B.u.push(U ? U[2 * i] : 0, U ? U[2 * i + 1] : 0);
      if (C) B.c.push(C[3 * i] * cl.r, C[3 * i + 1] * cl.g, C[3 * i + 2] * cl.b); else B.c.push(cl.r, cl.g, cl.b); }
    gg.dispose();
  }
  box(key, x0, y0, z0, x1, y1, z1, cl, uvs = 1) { // axis-aligned box, world-scaled UVs
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); const m = new THREE.Matrix4().makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (uvs) { const u = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal; for (let i = 0; i < u.count; i++) { const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const a = ay > .5 ? p.getX(i) : ax > .5 ? p.getZ(i) : p.getX(i), b = ay > .5 ? p.getZ(i) : p.getY(i); u.setXY(i, a / uvs, b / uvs); } }
    this.geom(key, g, m, cl); g.dispose();
  }
  meshes(parent, shadow, list) {
    for (const [key, B] of Object.entries(this.m)) {
      if (!B.p.length) continue; const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3)); g.computeBoundingSphere();
      const ms = new THREE.Mesh(g, mat(key)); ms.receiveShadow = true; ms.castShadow = !!(shadow && shadow.includes(key)); ms.matrixAutoUpdate = false; parent.add(ms); if (list) list.push(ms);
    }
    this.m = {};
  }
}
// extrude a 2-D profile [[offset, height], ...] along plan path P at base height y
function extrude(bt, key, P, profile, y, cl, uvLen = 2, off = 0) {
  const F = frames(P); let s = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], fa = F[i], fb = F[i + 1], ds = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let j = 0; j + 1 < profile.length; j++) {
      const [o0, h0] = profile[j], [o1, h1] = profile[j + 1];
      const A0 = [a[0] + fa[2] * (o0 + off), y + h0, a[1] + fa[3] * (o0 + off)], A1 = [a[0] + fa[2] * (o1 + off), y + h1, a[1] + fa[3] * (o1 + off)];
      const B0 = [b[0] + fb[2] * (o0 + off), y + h0, b[1] + fb[3] * (o0 + off)], B1 = [b[0] + fb[2] * (o1 + off), y + h1, b[1] + fb[3] * (o1 + off)];
      let pn = [h1 - h0, -(o1 - o0)]; if (pn[1] < 0 || (Math.abs(pn[1]) < 1e-6 && pn[0] * (o0 + o1) < 0)) pn = [-pn[0], -pn[1]];
      const hint = [fa[2] * pn[0], pn[1], fa[3] * pn[0]];
      const v0 = j / (profile.length - 1), v1 = (j + 1) / (profile.length - 1);
      bt.quad(key, A0, B0, B1, A1, [s / uvLen, v0], [(s + ds) / uvLen, v0], [(s + ds) / uvLen, v1], [s / uvLen, v1], cl, hint);
    }
    s += ds;
  }
}
function polyTop(bt, key, P, y, cl, uvs = 4) { // flat polygon (plan pts) at height y, world UVs
  const c = P.map(p => new THREE.Vector2(p[0], p[1])); if (THREE.ShapeUtils.isClockWise(c)) c.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(c, []);
  for (const t of tris) { const v = t.map(i => [c[i].x, y, c[i].y]); bt.tri(key, v[0], v[1], v[2], [v[0][0] / uvs, v[0][2] / uvs], [v[1][0] / uvs, v[1][2] / uvs], [v[2][0] / uvs, v[2][2] / uvs], cl, [0, 1, 0]); }
}
function rectTop(bt, key, r, y, cl, uvs = 4, grid = 0) {
  if (!grid) return polyTop(bt, key, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], y, cl, uvs);
  const nx = Math.max(1, Math.ceil((r[2] - r[0]) / grid)), nz = Math.max(1, Math.ceil((r[3] - r[1]) / grid)); const jit = (x, z) => { const k = 0.9 + 0.16 * hash(Math.round(x * 3) + ',' + Math.round(z * 3)); return new THREE.Color(cl.r * k, cl.g * (k + 0.02), cl.b * k); };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x0 = r[0] + (r[2] - r[0]) * i / nx, x1 = r[0] + (r[2] - r[0]) * (i + 1) / nx, z0 = r[1] + (r[3] - r[1]) * j / nz, z1 = r[1] + (r[3] - r[1]) * (j + 1) / nz;
    const B = bt.b(key); const V = [[x0, z0], [x1, z1], [x1, z0], [x0, z0], [x0, z1], [x1, z1]];
    for (const [x, z] of V) { const c = jit(x, z); B.p.push(x, y, z); B.n.push(0, 1, 0); B.u.push(x / uvs, z / uvs); B.c.push(c.r, c.g, c.b); }
  }
}
function vcol(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[3 * i] = c.r; a[3 * i + 1] = c.g; a[3 * i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function part(g, x, y, z, c, rx = 0, ry = 0, rz = 0) { g = g.index ? g.toNonIndexed() : g; g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1))); if (g.attributes.uv) g.deleteAttribute('uv'); return vcol(g, col(c)); }
const merge = parts => { const g = THREE.BufferGeometryUtils.mergeBufferGeometries(parts); g.computeBoundingSphere(); return g; };
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d), CYL = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);
// asset registry: id -> {meta, build}; build(bt, P) writes into Batch bt in LOCAL coords (x = width, z = depth, y = up; origin = footprint min corner; front faces +z)
L3D.assets = L3D.assets || {};
L3D.reg = (id, meta, build) => { L3D.assets[id] = Object.assign({ id }, meta, { build }); };
Object.assign(L3D, {rnd, hash, col, WHITE, resample, frames, plen, inPoly, segDist, TEX, canvasTex, noise, T, win, SIGN, signSlot, MAT, mat, Batch, extrude, polyTop, rectTop, vcol, part, merge, BOX, CYL});
})(window.L3D);
