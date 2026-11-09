/* Rolling stock: per-type N-scale freight/passenger cars + locomotives with roadname liveries.
   Liveries: one canvas atlas (L3D.rs.atlas) holds reporting marks / heralds / stripes; car geometry carries UVs into it,
   body parts point at a white texel and keep vertex colours -> one material, one draw call per (type,len,livery). */
'use strict';
(function (L3D) {
const { part, merge, BOX, CYL } = L3D, PI = Math.PI;
const CW = 0.76; // body width (10 ft 2 in)
// ---------------------------------------------------------------- livery atlas
const AW = 2048, AH = 2048, CWp = 512, CHp = 64, COLS = AW / CWp; const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH; const g = cv.getContext('2d');
g.fillStyle = '#fff'; g.fillRect(0, 0, CWp, CHp); // cell 0 = white texel for body parts
const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; const cells = {}; let ncell = 1;
function cell(key, draw) { if (cells[key]) return cells[key]; const i = ncell++; const cx = (i % COLS) * CWp, cy = Math.floor(i / COLS) * CHp; g.save(); g.beginPath(); g.rect(cx, cy, CWp, CHp); g.clip(); g.translate(cx, cy); draw(g, CWp, CHp); g.restore(); tex.needsUpdate = true;
  return (cells[key] = [cx / AW, 1 - (cy + CHp) / AH, (cx + CWp) / AW, 1 - cy / AH]); }
const WT = [0.5 * CWp / AW, 1 - 0.5 * CHp / AH];
const txt = (g, s, x, y, px, c, font = 'bold', align = 'left') => { g.font = `${font} ${px}px Arial, Helvetica, sans-serif`; g.fillStyle = c; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
// marks: [roadname big, reporting mark + number, text colour, extra]
const LIV = {
  boxcar: [['NORFOLK SOUTHERN', 'NS 470112', '#f2f2f2', '#7a2c1e'], ['CSX', 'CSXT 138556', '#f2f2f2', '#1d2b5c'], ['RAILBOX', 'ABOX 50771', '#111', '#e8c01a'], ['BNSF', 'BNSF 726031', '#f2f2f2', '#8a3a22']],
  reefer: [['CRYO-TRANS', 'ARMN 765410', '#c8202a', '#f2f2f2'], ['UNIVERSAL', 'UPFE 455123', '#1f3f9a', '#e8e4d8']],
  covered_hopper: [['ADM', 'ADMX 44610', '#1f4e8c', '#d8d4c8'], ['NORFOLK SOUTHERN', 'NS 250331', '#111', '#b8bcc0'], ['CSX', 'CSXT 255118', '#1d2b5c', '#c8ccd0'], ['TRINITY', 'TILX 401227', '#111', '#e4e0d4']],
  hopper: [['NS', 'NS 102544', '#f2f2f2', '#2a2a2a'], ['CSX', 'CSXT 830871', '#f2f2f2', '#3a2a22']],
  gondola: [['NS', 'NS 196210', '#f2f2f2', '#2a2a2a'], ['CSX', 'CSXT 700345', '#f2f2f2', '#4a3a30']],
  tank: [['GATX', 'GATX 220781', '#f2f2f2', '#1a1a1a'], ['UTLX', 'UTLX 642204', '#111', '#e8e8e8'], ['PROCOR', 'PROX 44513', '#f2f2f2', '#1a1a1a']],
  flat: [['TTX', 'TTPX 801122', '#f2f2f2', '#5a4a3a']], coil: [['NS', 'NS 165303', '#f2f2f2', '#2e4a7a']],
  centerbeam: [['TTX', 'TTZX 86518', '#f2f2f2', '#6a6a6a']], autorack: [['NORFOLK SOUTHERN', 'TTGX 952018', '#f2f2f2', '#7a2c1e'], ['CSX', 'TTGX 980271', '#f2f2f2', '#8a8f94']],
  well: [['TTX', 'DTTX 784022', '#f2f2f2', '#383838']], amfleet: [['AMTRAK', 'AMTK 82615', '#1f3f9a', '#c4c8cc']] };
const CONT = [['MAERSK', '#5ba9d8', '#fff'], ['ONE', '#c8186c', '#fff'], ['Hapag-Lloyd', '#f26a1a', '#fff'], ['CMA CGM', '#1f3f7a', '#fff'], ['J.B. HUNT', '#e8e4dc', '#c8202a'], ['SCHNEIDER', '#f28a1a', '#fff'], ['UMAX', '#2a4a8a', '#fff'], ['EMP', '#c8202a', '#fff']];
const decalCell = (k, m) => cell('car|' + k + '|' + m[1], (g, w, h) => { g.clearRect(0, 0, w, h); txt(g, m[0], w / 2, h * 0.42, m[0].length > 10 ? 30 : 42, m[2], 'bold', 'center'); txt(g, m[1], 8, h * 0.85, 14, m[2]); txt(g, 'CAPY 286000  LD LMT', w - 8, h * 0.85, 10, m[2], 'normal', 'right'); });
L3D.rs = { CW, atlas: tex, LIV, liveries: t => (LIV[t] || [['', '', '#fff', '#888']]).length };
L3D.MATS = L3D.MATS || {}; L3D.MATS.livery = () => new THREE.MeshPhongMaterial({ vertexColors: true, map: tex, alphaTest: 0.5, shininess: 30, specular: 0x222222 });
// geometry helpers: body part -> UV at white texel; decal quad (both sides) -> UV of cell
function wuv(gm) { const n = gm.attributes.position.count, a = new Float32Array(n * 2); for (let i = 0; i < n; i++) { a[i * 2] = WT[0]; a[i * 2 + 1] = WT[1]; } gm.setAttribute('uv', new THREE.BufferAttribute(a, 2)); return gm; }
function decal(c, x0, x1, y0, y1, z, cc = '#ffffff') { const out = []; for (const s of [-1, 1]) { const gm = new THREE.PlaneGeometry(x1 - x0, y1 - y0); if (s < 0) gm.rotateY(PI); gm.translate((x0 + x1) / 2, (y0 + y1) / 2, s * z);
  const uv = gm.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, c[0] + (c[2] - c[0]) * u, c[1] + (c[3] - c[1]) * v); } const nn = gm.toNonIndexed(); L3D.vcol(nn, L3D.col(cc)); out.push(nn); } return out; }
function stripeCell(key, draw) { return cell('s|' + key, (g, w, h) => { g.clearRect(0, 0, w, h); draw(g, w, h); }); }
// ---------------------------------------------------------------- cars
const LAD_TOP = { gondola: 0.64, hopper: 0.96, flat: 0.5, well: 0.5, coil: 0.5, tank: 0.9, covered_hopper: 0.9 };
function carGeo(type, len, li = 0) {
  const L = len - 0.16, P = [], D = [], add = (gm, x, y, z, c, rx = 0, ry = 0, rz = 0) => P.push(part(gm, x, y, z, c, rx, ry, rz)), bx = (w, h, d, x, y, z, c) => add(BOX(w, h, d), x, y, z, c);
  const lv = (LIV[type] || [['', '', '#fff', '#888']])[li % L3D.rs.liveries(type)], body = lv[3], dk = '#' + new THREE.Color(body).multiplyScalar(0.8).getHexString(), dc = m => decalCell(type, m);
  bx(L - 0.1, 0.06, 0.5, 0, 0.25, 0, '#262626'); // centre sill
  for (const s of [-1, 1]) { bx(0.08, 0.06, 0.08, s * (len / 2 - 0.05), 0.22, 0, '#303030'); bx(0.05, 0.05, 0.12, s * (len / 2 - 0.02), 0.22, 0, '#3a3a3a'); bx(0.04, 0.05, 0.02, s * (L / 2 - 0.06), 0.36, CW / 2 - 0.02, '#c8c020'); /* end ladders, up to the car's top chord */ const lt = LAD_TOP[type] || 0.9; if (type !== 'amfleet') for (const z of [-1, 1]) bx(0.012, lt - 0.3, 0.012, s * (L / 2 + 0.005), (lt + 0.3) / 2, z * (CW / 2 - 0.05), '#2a2a2a'); }
  const ends = (y0, y1, c = dk) => { for (const s of [-1, 1]) bx(0.02, y1 - y0, CW * 0.96, s * (L / 2 - 0.01), (y0 + y1) / 2, 0, c); };
  switch (type) {
    case 'boxcar': case 'reefer': bx(L, 1.0, CW, 0, 0.78, 0, body); bx(L + 0.02, 0.03, CW + 0.02, 0, 1.295, 0, dk); bx(L * 0.98, 0.012, 0.14, 0, 1.315, 0, '#6a6a6a'); // roof + running board
      for (const s of [-1, 1]) { bx(type === 'reefer' ? 0.42 : 0.75, 0.86, 0.012, 0, 0.72, s * (CW / 2 + 0.006), dk); bx(0.78, 0.02, 0.02, 0, 0.29, s * (CW / 2 + 0.012), '#2a2a2a'); bx(0.78, 0.02, 0.02, 0, 1.16, s * (CW / 2 + 0.012), '#2a2a2a'); for (let i = -6; i <= 6; i++) if (Math.abs(i) > 1) bx(0.012, 0.95, 0.008, i * L / 14, 0.78, s * (CW / 2 + 0.003), dk); }
      ends(0.28, 1.28); D.push(...decal(dc(lv), -L / 2 + 0.12, -0.45, 0.75, 1.05, CW / 2 + 0.012, '#fff')); D.push(...decal(stripeCell('reflect', (g, w, h) => { for (let x = 0; x < w; x += 48) { g.fillStyle = '#f2e600'; g.fillRect(x, h * 0.45, 22, 6); } }), 0.45, L / 2 - 0.1, 0.24, 0.42, CW / 2 + 0.012)); break;
    case 'covered_hopper': /* prototype 4750 cf hopper: 15 ft 5 in over walkway = 1.16 in at 1:160 */ bx(L, 0.42, CW, 0, 0.62, 0, body); add(CYL(CW / 2, CW / 2, L, 14, 1), 0, 0.79, 0, body, 0, 0, PI / 2); bx(L * 0.85, 0.02, 0.16, 0, 1.165, 0, '#9a9a9a');
      for (let i = -3; i <= 3; i++) add(CYL(0.07, 0.07, 0.03, 10), i * L / 8, 1.16, 0, dk); // hatches
      for (let i = -1; i <= 1; i++) add(new THREE.ConeGeometry(0.3, 0.26, 4), i * L / 3.4, 0.37, 0, dk, PI, PI / 4, 0); for (const s of [-1, 1]) for (let i = -5; i <= 5; i++) bx(0.012, 0.5, 0.006, i * L / 11.5, 0.68, s * (CW / 2 + 0.002), dk);
      D.push(...decal(dc(lv), -L / 2 + 0.2, L / 2 - 0.2, 0.5, 0.92, CW / 2 + 0.01)); break;
    case 'hopper': bx(L, 0.62, CW, 0, 0.64, 0, body); bx(L - 0.14, 0.05, CW - 0.08, 0, 0.94, 0, '#141414'); for (let i = 0; i < 8; i++) add(new THREE.IcosahedronGeometry(0.1, 0), -L / 2 + 0.4 + i * (L - 0.8) / 7, 0.97, (i % 2 - 0.5) * 0.25, '#121212');
      for (let i = 0; i < 3; i++) add(new THREE.ConeGeometry(0.28, 0.22, 4), (i - 1) * L / 3.2, 0.25, 0, dk, PI, PI / 4, 0); for (const s of [-1, 1]) for (let i = -6; i <= 6; i++) bx(0.014, 0.6, 0.008, i * L / 13.5, 0.64, s * (CW / 2 + 0.004), dk);
      D.push(...decal(dc(lv), -L / 2 + 0.3, L / 2 - 0.3, 0.6, 0.9, CW / 2 + 0.01)); break;
    case 'gondola': bx(L, 0.36, CW, 0, 0.46, 0, body); bx(L - 0.06, 0.02, CW - 0.06, 0, 0.62, 0, '#2a2420'); for (const s of [-1, 1]) for (let i = -8; i <= 8; i++) bx(0.014, 0.36, 0.008, i * L / 17, 0.46, s * (CW / 2 + 0.004), dk); D.push(...decal(dc(lv), -L / 2 + 0.3, L / 2 - 0.3, 0.32, 0.6, CW / 2 + 0.01)); break;
    case 'tank': add(CYL(0.4, 0.4, L - 0.4, 18), 0, 0.78, 0, body, 0, 0, PI / 2); for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.4, 14, 8, 0, 6.29, 0, 1.571), s * (L / 2 - 0.2), 0.78, 0, body, 0, 0, -s * PI / 2);
      add(CYL(0.1, 0.1, 0.1, 10), 0, 1.22, 0, '#9a9a9a'); bx(0.5, 0.02, 0.26, 0, 1.19, 0, '#555'); bx(L - 0.2, 0.05, 0.6, 0, 0.32, 0, '#2a2a2a'); for (const s of [-1, 1]) bx(0.012, 0.4, 0.3, s * 0.3, 1.05, 0, '#2a2a2a');
      D.push(...decal(dc(lv), -L / 2 + 0.6, L / 2 - 0.6, 0.62, 0.95, 0.405)); D.push(...decal(stripeCell('haz', (g, w, h) => { g.fillStyle = '#d8d8d8'; g.fillRect(w * 0.44, 4, h - 8, h - 8); g.fillStyle = '#c8202a'; g.font = 'bold 20px Arial'; g.fillText('1267', w * 0.445, h * 0.6); }), -0.3, 0.3, 0.42, 0.56, 0.41)); break;
    case 'flat': bx(L, 0.1, CW, 0, 0.32, 0, body); for (let i = -3; i <= 3; i++) bx(0.03, 0.05, CW, i * L / 7, 0.4, 0, '#7a5a3a'); D.push(...decal(dc(lv), -L / 2 + 0.3, L / 2 - 0.3, 0.28, 0.37, CW / 2 + 0.01)); break;
    case 'coil': bx(L, 0.12, CW, 0, 0.32, 0, body); for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.36, 0.36, L / 2 - 0.1, 14, 1, false, 0, PI), s * L / 4, 0.38, 0, body, 0, 0, PI / 2); D.push(...decal(dc(lv), -L / 2 + 0.3, L / 2 - 0.3, 0.26, 0.38, CW / 2 + 0.01)); break;
    case 'centerbeam': bx(L, 0.1, CW, 0, 0.32, 0, body); bx(L - 0.2, 0.86, 0.06, 0, 0.8, 0, '#7a7a7a'); for (let i = -6; i <= 6; i++) bx(0.03, 0.86, 0.1, i * L / 13, 0.8, 0, '#6a6a6a'); for (const s of [-1, 1]) bx(0.05, 1.0, CW, s * (L / 2 - 0.05), 0.85, 0, '#6a6a6a');
      for (const z of [-0.2, 0.2]) for (let i = 0; i < 4; i++) { const x = -L / 2 + 0.1 + (i + 0.5) * (L - 0.2) / 4; bx(L / 4 - 0.06, 0.38, 0.3, x, 0.57, z, '#e8cf8c'); bx(L / 4 - 0.06, 0.36, 0.3, x, 0.95, z, '#dcc07a'); bx(L / 4 - 0.06, 0.74, 0.305, x, 0.76, z, '#f2f2ee'); }
      D.push(...decal(stripeCell('wrap', (g, w, h) => { g.clearRect(0, 0, w, h); txt(g, 'WEYERHAEUSER', w / 2, h / 2, 34, '#1f6e3e', 'bold', 'center'); }), -L / 2 + 0.3, -0.1, 0.55, 0.85, 0.36)); break;
    case 'autorack': bx(L, 1.18, CW, 0, 0.88, 0, body); bx(L, 0.04, CW + 0.03, 0, 1.47, 0, '#9e9e9e'); for (const s of [-1, 1]) { for (let i = -14; i <= 14; i++) bx(0.02, 1.1, 0.01, i * L / 29, 0.86, s * (CW / 2 + 0.005), dk); bx(L, 0.03, 0.012, 0, 0.62, s * (CW / 2 + 0.006), '#555'); bx(L, 0.03, 0.012, 0, 1.06, s * (CW / 2 + 0.006), '#555'); }
      D.push(...decal(dc(lv), -L / 2 + 0.2, L / 2 - 0.2, 0.32, 0.56, CW / 2 + 0.014)); break;
    case 'well': { bx(L, 0.14, 0.12, 0, 0.3, CW / 2 - 0.06, '#383838'); bx(L, 0.14, 0.12, 0, 0.3, -CW / 2 + 0.06, '#383838'); for (const s of [-1, 1]) bx(0.45, 0.22, CW, s * (L / 2 - 0.22), 0.33, 0, '#383838');
      const c1 = CONT[li % CONT.length], c2 = CONT[(li * 3 + 2) % CONT.length], lw = Math.min(L - 0.3, 3.98);
      /* double stack: well floor ~1 ft ATR + 2 x 9 ft 6 in = 20 ft 2 in */ bx(L - 1.1, 0.71, 0.72, 0, 0.445, 0, c1[1]); bx(lw, 0.71, 0.72, 0, 1.16, 0, c2[1]); for (const s of [-1, 1]) for (let i = -12; i <= 12; i++) bx(0.01, 0.69, 0.006, i * lw / 25, 1.16, s * 0.363, '#' + new THREE.Color(c2[1]).multiplyScalar(0.85).getHexString());
      const cc = c => cell('cont|' + c[0], (g, w, h) => { g.clearRect(0, 0, w, h); txt(g, c[0], w / 2, h / 2, 40, c[2], 'bold', 'center'); });
      D.push(...decal(cc(c2), -lw / 2 + 0.3, lw / 2 - 0.3, 1.01, 1.31, 0.368)); D.push(...decal(cc(c1), -(L - 1.1) / 2 + 0.2, (L - 1.1) / 2 - 0.2, 0.34, 0.6, 0.364)); break; }
    case 'amfleet': { /* [REALISM 2026-10-19] Amfleet I (Budd, 85 ft 4 in): stainless tube body, sides bulge at the window line and tuck in at the sill, low rounded roof;
         12 ft 8 in over the roof = 0.95 in, 10 ft 6 in wide; 20 small rounded windows a side; Phase VI red / white / blue band under the windows; fluted lower sides; dark diaphragms */
      const sh = new THREE.Shape(), Q = [[0.33, 0.31], [0.385, 0.42], [0.397, 0.56], [0.395, 0.72], [0.372, 0.84], [0.31, 0.915], [0.16, 0.948], [0, 0.953]];
      sh.moveTo(-Q[0][0], Q[0][1]); for (const [z, y] of Q.slice(1)) sh.lineTo(-z, y); for (const [z, y] of Q.slice().reverse().slice(1)) sh.lineTo(z, y); sh.lineTo(Q[0][0], Q[0][1]);
      const tube = new THREE.ExtrudeGeometry(sh, { depth: L - 0.04, bevelEnabled: false, curveSegments: 1 }); tube.rotateY(PI / 2); tube.translate(-(L - 0.04) / 2, 0, 0); add(tube, 0, 0, 0, '#b9bec3');
      bx(L - 0.3, 0.12, 0.62, 0, 0.25, 0, '#2a2a2a'); for (const x of [-1, 1]) bx(0.05, 0.56, 0.42, x * (L / 2 - 0.01), 0.6, 0, '#1e1e1e') /* REAL1: diaphragm ~5 ft wide, not full car width */;
      for (const s of [-1, 1]) { const zs = s * 0.399; for (let i = 0; i < 20; i++) bx(0.17, 0.12, 0.012, -L / 2 + 0.55 + i * (L - 1.1) / 19, 0.65, zs, '#1a2128');
        bx(L - 0.1, 0.022, 0.01, 0, 0.565, s * 0.399, '#c8202a'); bx(L - 0.1, 0.02, 0.01, 0, 0.543, s * 0.398, '#f2f2f2'); bx(L - 0.1, 0.03, 0.01, 0, 0.518, s * 0.395, '#1f3f9a');
        for (let k = 0; k < 4; k++) bx(L - 0.2, 0.005, 0.008, 0, 0.36 + k * 0.032, s * (0.35 + 0.012 * k), '#8e9398');
        for (const x of [-1, 1]) bx(0.15, 0.4, 0.012, x * (L / 2 - 0.25), 0.55, s * 0.398, '#9ea4aa'); }
      D.push(...decal(cell('amtk', (g, w, h) => { g.clearRect(0, 0, w, h); txt(g, 'AMTRAK', w / 2, h * 0.5, 36, '#1f3f9a', 'bold italic', 'center'); }), -0.6, 0.6, 0.43, 0.5, 0.402)); break; }
    default: bx(L, 0.9, CW, 0, 0.78, 0, body);
  }
  P.forEach(wuv); return merge(P.concat(D));
}
// ---------------------------------------------------------------- locomotives
const SCHEME = { NS: ['#121212', '#121212', '#f2f2f2', '#121212'], CSX: ['#1d2b5c', '#f2c200', '#f2c200', '#1d2b5c'], BNSF: ['#e0601a', '#1a1a1a', '#f2c200', '#1a1a1a'],
  CLNA: ['#1f4e8c', '#f0c419', '#f0c419', '#1f4e8c'], RJC: ['#b5121b', '#f2f2f2', '#f2f2f2', '#b5121b'], Amtrak: ['#c4c8cc', '#c4c8cc', '#c8202a', '#1f3f9a'], UP: ['#e8b90f', '#e8b90f', '#c8202a', '#8d9093'] };   /* [ROSTER] UP Armour Yellow / Harbor Mist Gray (NS 165 2nd unit) */ // [body, cab/nose, stripe, roof]
const RNAME = { NS: ['NORFOLK SOUTHERN', '#f2f2f2'], CSX: ['CSX', '#f2c200'], BNSF: ['BNSF', '#f2c200'], CLNA: ['CAROLINA', '#f0c419'], RJC: ['R J CORMAN', '#f2f2f2'], Amtrak: ['AMTRAK', '#1f3f9a'], UP: ['UNION PACIFIC', '#c8202a'] };
const NUM = { ET44: 4001, SD70: 2650, ES44: 6420, GP38: 2007, GP15: 1503, MP15: 2391, GP40: 6611, SD40: 3801, P42: 112 };
function locoGeo(model, rr, len) {
  const [body, cab, stripe, roof] = SCHEME[rr] || SCHEME.NS, L = len - 0.16, P = [], D = [], bx = (w, h, d, x, y, z, c) => P.push(part(BOX(w, h, d), x, y, z, c)), add = (gm, x, y, z, c, rx = 0, ry = 0, rz = 0) => P.push(part(gm, x, y, z, c, rx, ry, rz));
  const nm = RNAME[rr] || RNAME.NS, nc = cell('loco|' + rr, (g, w, h) => { g.clearRect(0, 0, w, h); txt(g, nm[0], w / 2, h / 2, nm[0].length > 10 ? 36 : 52, nm[1], 'bold', 'center'); });
  const numc = cell('num|' + rr + model, (g, w, h) => { g.clearRect(0, 0, w, h); txt(g, String(NUM[model] || 1000), w / 2, h / 2, 50, nm[1], 'bold', 'center'); });
  for (const s of [-1, 1]) { bx(0.08, 0.06, 0.08, s * (len / 2 - 0.05), 0.22, 0, '#303030'); bx(0.05, 0.05, 0.12, s * (len / 2 - 0.02), 0.22, 0, '#3a3a3a'); }
  if (model === 'P42') { bx(L, 0.82, CW, 0, 0.74, 0, body); bx(L - 0.6, 0.06, CW + 0.01, 0, 0.62, 0, stripe); bx(L - 0.6, 0.04, CW + 0.012, 0, 0.56, 0, '#f2f2f2'); bx(L - 0.6, 0.06, CW + 0.014, 0, 0.5, 0, roof);
    bx(0.4, 0.5, CW * 0.98, L / 2 - 0.05, 0.6, 0, body); add(new THREE.CylinderGeometry(0.2, 0.2, CW * 0.98, 10, 1, false, 0, PI / 2), L / 2 - 0.05, 0.85, 0, body, PI / 2); bx(0.05, 0.14, CW * 0.8, L / 2 + 0.06, 0.95, 0, '#1a2028'); bx(1.2, 0.22, 0.5, -0.2, 0.22, 0, '#2a2a2a');
    D.push(...decal(nc, -L / 2 + 0.3, 0.6, 0.8, 1.05, CW / 2 + 0.008)); P.forEach(wuv); return merge(P.concat(D)); }
  const six = !/GP|MP/.test(model), /* [MP15] MP15DC = B-B switcher */ cabX = L / 2 - (six ? 0.95 : 0.8), hx0 = -L / 2 + 0.12, hx1 = cabX - 0.45, hw = 0.54;
  bx(L, 0.08, CW, 0, 0.33, 0, '#2a2a2a'); bx(L, 0.03, CW + 0.01, 0, 0.36, 0, stripe); // frame + walkway stripe
  for (const s of [-1, 1]) { bx(L - 0.2, 0.012, 0.012, 0, 0.62, s * (CW / 2 - 0.01), '#d8d8d8'); for (let i = 0; i < 9; i++) bx(0.012, 0.24, 0.012, -L / 2 + 0.2 + i * (L - 0.4) / 8, 0.5, s * (CW / 2 - 0.01), '#d8d8d8'); } // handrails
  bx(hx1 - hx0, 0.66, hw, (hx0 + hx1) / 2, 0.71, 0, body); bx(hx1 - hx0, 0.03, hw + 0.02, (hx0 + hx1) / 2, 1.05, 0, roof); // long hood
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) bx(0.16, 0.42, 0.006, hx0 + 0.25 + i * (hx1 - hx0 - 0.5) / 5, 0.7, s * (hw / 2 + 0.003), '#' + new THREE.Color(body).multiplyScalar(0.75).getHexString()); // doors
  bx(six ? 0.9 : 0.6, 0.2, 0.66, -L / 2 + (six ? 0.6 : 0.45), 0.98, 0, body); for (const x of [0.2, -0.2]) add(CYL(0.12, 0.12, 0.02, 12), -L / 2 + (six ? 0.6 : 0.45) + x, 1.09, 0, '#2a2a2a'); // radiator + fans
  add(CYL(0.04, 0.05, 0.08, 8), hx1 - 0.5, 1.09, 0, '#1a1a1a'); // exhaust stack
  bx(0.5, 0.8, CW * 0.98, cabX - 0.2, 0.78, 0, cab); bx(0.52, 0.04, CW, cabX - 0.2, 1.19, 0, roof); bx(0.04, 0.16, CW * 0.8, cabX + 0.06, 0.98, 0, '#1a2028'); for (const s of [-1, 1]) bx(0.22, 0.13, 0.01, cabX - 0.2, 0.98, s * CW * 0.49, '#1a2028');
  bx(L / 2 - cabX - 0.12, 0.4, 0.58, (cabX + 0.05 + L / 2 - 0.07) / 2, 0.58, 0, cab); bx(0.02, 0.05, 0.1, L / 2 - 0.05, 0.72, 0, '#fffbe0'); // nose + headlight
  bx(six ? 1.3 : 1.0, 0.18, 0.6, -0.15, 0.2, 0, '#1c1c1c'); add(CYL(0.025, 0.025, 0.25, 6), cabX - 0.1, 1.24, 0, '#888', 0, 0, PI / 2); // fuel tank, horn
  if (rr === 'NS') bx(0.6, 0.12, hw + 0.006, -0.6, 0.7, 0, '#f2f2f2'); // NS horse panel band
  if (rr === 'CSX') bx(hx1 - hx0, 0.2, hw + 0.004, (hx0 + hx1) / 2, 0.5, 0, '#1d2b5c');
  D.push(...decal(nc, hx0 + 0.15, hx1 - 0.15, 0.72, 0.95, hw / 2 + 0.008)); D.push(...decal(numc, cabX - 0.38, cabX - 0.02, 0.62, 0.78, CW * 0.49 + 0.008));
  P.forEach(wuv); return merge(P.concat(D));
}
const TR = (len, ax, r) => merge([part(BOX(len, 0.1, 0.06), 0, 0.12, 0.33, '#1e1e1e'), part(BOX(len, 0.1, 0.06), 0, 0.12, -0.33, '#1e1e1e'), part(BOX(0.12, 0.06, 0.6), 0, 0.16, 0, '#1e1e1e'),
  ...ax.flatMap(x => [part(CYL(r, r, 0.62, 12), x, r, 0, '#5a5550', PI / 2), ...[-1, 1].map(s => part(CYL(0.035, 0.035, 0.02, 8), x, 0.12, s * 0.37, '#2a2a2a', PI / 2))]), ...[-1, 1].map(s => part(CYL(0.03, 0.03, 0.08, 6), 0, 0.12, s * 0.33, '#3a3a3a'))]);
const TRUCK2 = TR(0.62, [-0.2, 0.2], 0.055), TRUCK3 = TR(0.98, [-0.33, 0, 0.33], 0.065);
const PAL = { loco: ['#ffffff'] };
Object.assign(L3D.rs, { carGeo, locoGeo, TRUCK2, TRUCK3, SCHEME, PAL });
const LENS = { boxcar: 5.1, reefer: 6.5, covered_hopper: 4.7, hopper: 4.0, gondola: 4.2, tank: 4.6, flat: 5.6, coil: 3.8, centerbeam: 6.0, autorack: 6.9, well: 5.3, amfleet: 6.4 };
for (const [t, ln] of Object.entries(LENS)) L3D.reg('car-' + t, { cat: 'rollingstock', name: t.replace('_', ' ') + ' car', len_in: ln, liveries: (LIV[t] || []).map(m => m[1]) }, bt => bt.geom('livery', carGeo(t, ln, 0), null, L3D.WHITE));
for (const [m, ln, rr] of [['ET44', 4.6, 'NS'], ['SD70', 4.3, 'CSX'], ['ES44', 4.6, 'BNSF'], ['GP38', 3.6, 'CLNA'], ['GP15', 3.3, 'CLNA'], ['GP40', 3.8, 'CSX'], ['SD40', 4.1, 'RJC'], ['P42', 4.4, 'Amtrak'], ['MP15', 3.6, 'NS']])
  L3D.reg('loco-' + m.toLowerCase(), { cat: 'rollingstock', name: m + ' locomotive', len_in: ln, roads: Object.keys(SCHEME) }, bt => bt.geom('livery', locoGeo(m, rr, ln), null, L3D.WHITE));
/* [RS-ROAD] railroad-specific variants: registry id loco-<model>-<rr> maps to base id (base) for sizes/physics; L3D.ext.rsId(type, model, rr) prefers the variant glb */
L3D.reg('loco-et44-csx', { cat: 'rollingstock', name: 'ET44AH locomotive (CSX)', len_in: 4.6, base: 'loco-et44', rr: 'CSX', roads: ['CSX'] }, bt => bt.geom('livery', locoGeo('ET44', 'CSX', 4.6), null, L3D.WHITE));
})(window.L3D);
