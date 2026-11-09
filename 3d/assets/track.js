/* Kato Unitrack (N) assets. Units inches; dimensions from Kato published mm values (see SOURCES.md). Local frame: piece starts at origin heading +x,
   +z = left of travel for curves with hand +1. y = 0 is the layout surface the roadbed sits on. */
'use strict';
(function (L3D) {
const { Batch, extrude, col, canvasTex, noise, mat, BOX, part, merge, rnd } = L3D, MM = 1 / 25.4;
const K = L3D.kato = {
  MM, W: 25 * MM, TOP: 18.6 * MM, H: 4.4 * MM, RAIL: 2.03 * MM, GAUGE: 9.0 * MM, TIE_L: 15.2 * MM, TIE_W: 1.5 * MM, TIE_H: 0.9 * MM, TIE_P: 3.75 * MM, CTR: 33 * MM,
  colors: { roadbed: '#8f8c87', tie: '#4a3a2e', rail: '#c9ccd1', plate: '#2c2c2c', housing: '#55575a', frog: '#3b3b3d' },
};
K.PROFILE = [[-K.W / 2, 0], [-K.W / 2 + 0.6 * MM, 1.2 * MM], [-K.TOP / 2, K.H], [K.TOP / 2, K.H], [K.W / 2 - 0.6 * MM, 1.2 * MM], [K.W / 2, 0]]; // sloped molded shoulders
const hw = 0.45 * MM, bw = 0.9 * MM; // code 80 rail: head 0.9 mm, base 1.8 mm, web 0.5 mm, height 2.03 mm
K.RAILP = [[-bw, 0], [-bw, 0.25 * MM], [-0.25 * MM, 0.45 * MM], [-0.25 * MM, K.RAIL - 0.6 * MM], [-hw, K.RAIL - 0.5 * MM], [-hw, K.RAIL], [hw, K.RAIL], [hw, K.RAIL - 0.5 * MM], [0.25 * MM, K.RAIL - 0.6 * MM], [0.25 * MM, 0.45 * MM], [bw, 0.25 * MM], [bw, 0]];
K.RAILP_MID = [[-bw, 0], [-bw, 0.25 * MM], [-hw, K.RAIL], [hw, K.RAIL], [bw, 0.25 * MM], [bw, 0]]; // layout-scale profile (flange + head)
K.RAILP_LOW = [[-bw, 0], [-hw, K.RAIL], [hw, K.RAIL], [bw, 0]];
L3D.T.kato_ballast = () => canvasTex('kato_ballast', 256, 64, (g, w, h) => { noise(g, w, h, '#8e8b86', 0.18, 2500, 1); for (let i = 0; i < 2600; i++) { const v = 120 + rnd() * 70; g.fillStyle = `rgb(${v},${v - 4},${v - 9})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.8 + rnd() * 1.2, 0, 7); g.fill(); } });
L3D.MATS = L3D.MATS || {}; L3D.MATS.kato_ballast = () => new THREE.MeshLambertMaterial({ vertexColors: true, map: L3D.T.kato_ballast() });
// tie with two tie plates + spike heads (instanced by the viewer, merged in pieces)
K.tieGeo = (len = K.TIE_L) => merge([part(BOX(K.TIE_W, K.TIE_H, len), 0, K.TIE_H / 2, 0, K.colors.tie), ...[-1, 1].map(s => part(BOX(K.TIE_W * 1.25, 0.15 * MM, 2.6 * MM), 0, K.TIE_H + 0.07 * MM, s * K.GAUGE / 2, K.colors.plate))]);
K.tieGeoLow = (len = K.TIE_L) => merge([part(new THREE.PlaneGeometry(K.TIE_W, len).rotateX(-Math.PI / 2), 0, K.TIE_H, 0, K.colors.tie)]);
// lay generic Unitrack along a plan path P ([[x,z],...]) into Batch bt at height y. Returns tie poses [[x, y, z, heading]].
K.lay = (bt, P, y, opt = {}) => {
  const R = L3D.resample(P, opt.step || 0.5); if (R.length < 2) return [];
  extrude(bt, 'kato_ballast', R, K.PROFILE, y, col(K.colors.roadbed), 1.0);
  const top = y + K.H + K.TIE_H; const RR = opt.full ? R : L3D.resample(P, 0.6); if (!opt.noRails) for (const s of [-K.GAUGE / 2, K.GAUGE / 2]) extrude(bt, 'rail', RR, opt.low ? K.RAILP_LOW : opt.full ? K.RAILP : K.RAILP_MID, top, col(K.colors.rail), 4, s);
  const T = L3D.resample(P, K.TIE_P), F = L3D.frames(T); return T.map((p, i) => [p[0], y + K.H, p[1], Math.atan2(F[i][1], F[i][0])]);
};
// geometry helpers for pieces
const arc = (R, deg, hand, n) => { const a = deg * Math.PI / 180, P = []; for (let i = 0; i <= n; i++) { const t = a * i / n; P.push([R * Math.sin(t), hand * R * (1 - Math.cos(t))]); } return P; };
const tiesInto = (bt, poses, len) => { const g = K.tieGeo(len); for (const t of poses) bt.geom('plain', g, new THREE.Matrix4().compose(new THREE.Vector3(t[0], t[1], t[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t[3], 0)), new THREE.Vector3(1, 1, 1)), L3D.WHITE); };
const joiners = (bt, P) => { for (const [k, d] of [[0, 1], [P.length - 1, -1]]) { const a = P[k], b = P[k + d], h = Math.atan2(b[1] - a[1], b[0] - a[0]); for (const s of [-1, 1]) {
  const nx = -Math.sin(h) * s * K.GAUGE / 2, nz = Math.cos(h) * s * K.GAUGE / 2; bt.geom('rail', BOX(3.6 * MM, 1.2 * MM, 1.4 * MM), new THREE.Matrix4().compose(new THREE.Vector3(a[0] + nx, K.H + K.TIE_H + 0.6 * MM, a[1] + nz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -h, 0)), new THREE.Vector3(1, 1, 1)), col('#9a9ca0')); } } };
K.piece = (bt, P) => { const poses = K.lay(bt, P, 0, { full: true }); tiesInto(bt, poses); joiners(bt, P); };
const STRAIGHTS = { S248: 248, S186: 186, S124: 124, S64: 64, S62: 62, S45: 45.5, S29: 29 };
for (const [id, mm] of Object.entries(STRAIGHTS)) L3D.reg('kato-' + id.toLowerCase(), { cat: 'track', name: `Kato Unitrack ${id} straight`, kit: { S248: '20-000', S186: '20-010', S124: '20-020', S64: '20-040', S62: '20-030', S45: '20-042', S29: '20-045' }[id] + ' [verify part no.]', dims_mm: [mm, 25, 6.4], dims_in: [+(mm * MM).toFixed(3), 0.984, 0.25] },
  bt => K.piece(bt, [[0, 0], [mm * MM, 0]]));
const CURVES = [['R216', 216, [45, 15], '20-170/20-171'], ['R249', 249, [45, 15], '20-100/20-101'], ['R282', 282, [45, 15], '20-110/20-111'], ['R315', 315, [45, 15], '20-120/20-121'], ['R348', 348, [45, 30], '20-132/20-130'], ['R381', 381, [30], '20-140'], ['R481', 481, [15], '20-160'], ['R718', 718, [15], '20-150']];   // per reference/kato-unitrack-catalog.csv (R414 exists only as the outer rail of the WR414/381 double curves)
for (const [id, r, angs, kit] of CURVES) for (const a of angs) L3D.reg(`kato-${id.toLowerCase()}-${a}`, { cat: 'track', name: `Kato Unitrack ${id}-${a} curve`, kit, dims_mm: [r, a], verify: kit.includes('verify') },
  bt => K.piece(bt, arc(r * MM, a, 1, Math.max(6, Math.round(r * MM * a / 57.3 / 0.25)))));
// turnouts: #6 = 186 mm straight + R718-15 diverge (20-202 L / 20-203 R); #4 = 126 mm + R481-15 (20-220 L / 20-221 R)
K.TO = { '#6': { L: 186 * MM, R: 718 * MM, A: 15, PL: 34 * MM }, '#4': { L: 126 * MM, R: 481 * MM, A: 15, PL: 26 * MM } };
K.turnout = (bt, kind, hand, y = 0, low = false) => {
  const S = K.TO[kind] || K.TO['#6'], g = K.GAUGE, R = S.R, A = S.A * Math.PI / 180, top = y + K.H + K.TIE_H, rp = low ? K.RAILP_LOW : K.RAILP, rc = col(K.colors.rail), n = 40;
  const thr = [[0, 0], [S.L, 0]], div = arc(R, S.A, hand, n), xf = Math.sqrt(2 * R * g);
  extrude(bt, 'kato_ballast', thr, K.PROFILE, y, col(K.colors.roadbed), 1.0);
  extrude(bt, 'kato_ballast', div.filter(p => p[0] > S.L * 0.35), K.PROFILE, y + 0.002, col(K.colors.roadbed), 1.0);
  // widened molded roadbed under the points/frog area (covers the gap between the two roadbeds)
  const fill = []; for (let i = 0; i <= 12; i++) { const x = S.L * 0.35 * i / 12 + S.L * 0.3 * i / 12; const zd = hand * (R - Math.sqrt(Math.max(0, R * R - x * x))); fill.push([x, zd / 2]); }
  extrude(bt, 'kato_ballast', fill, [[-K.TOP / 2 - 0.08, 0], [-K.TOP / 2, K.H - 0.001], [K.TOP / 2, K.H - 0.001], [K.TOP / 2 + 0.08, 0]].map(([o, h], i) => [o * (1 + 0.5 * (i % 3 === 0)), h]), y, col(K.colors.roadbed), 1.0);
  const yOn = (r0, x) => hand * (R - Math.sqrt(Math.max(0, r0 * r0 - x * x))); // z of a rail on circle radius r0 centred (0, hand*R)
  const circ = (r0, x0, x1) => { const P = []; for (let i = 0; i <= 24; i++) { const x = x0 + (x1 - x0) * i / 24; P.push([x, yOn(r0, x)]); } return P; };
  const rail = (P, s = 0, prof = rp) => extrude(bt, 'rail', P, prof, top, rc, 4, s);
  const xe = R * Math.sin(A);
  rail([[0, -hand * g / 2], [S.L, -hand * g / 2]]);                         // straight stock rail (outer)
  rail(circ(R - g / 2, 0, xe));                                              // diverging stock rail (outer)
  rail([[S.PL, hand * g / 2], [xf - 1.2 * MM, hand * g / 2]]);              // straight closure rail
  rail(circ(R + g / 2, S.PL, xf - 1.2 * MM));                               // diverging closure rail
  rail([[xf, hand * g / 2], [S.L, hand * g / 2]]); rail(circ(R + g / 2, xf, xe)); // frog point rails
  // switch points: tapered moving rails, set for the straight route (closed against the diverging stock rail)
  const pt = [[-bw * 0.7, 0], [-hw * 0.6, K.RAIL * 0.95], [hw * 0.6, K.RAIL * 0.95], [bw * 0.7, 0]];
  rail([[1.0 * MM, hand * (g / 2 - 0.55 * MM)], [S.PL, hand * g / 2]], 0, pt);
  rail(circ(R + g / 2 + 0.9 * MM, 1.0 * MM, S.PL).map((p, i, a) => [p[0], p[1] - hand * 0.0 * i / a.length]), 0, pt);
  // frog: wing rails + molded frog casting; guard rails opposite the frog
  for (const s of [-1, 1]) rail([[xf - 9 * MM, hand * (g / 2 + s * 0.0) - hand * 1.0 * MM * (s > 0 ? 1 : 0)], [xf - 0.5 * MM, hand * g / 2 - hand * 0.9 * MM * (s > 0 ? 1 : 0)]]);
  bt.box('plain', xf - 6 * MM, top - 0.002, Math.min(hand * g / 2, yOn(R + g / 2, xf)) - 1.6 * MM, xf + 7 * MM, top + 0.4 * MM, Math.max(hand * g / 2, yOn(R + g / 2, xf)) + 1.6 * MM, col(K.colors.frog), 0);
  rail([[xf - 10 * MM, -hand * (g / 2 - 1.0 * MM)], [xf + 10 * MM, -hand * (g / 2 - 1.0 * MM)]]);
  rail(circ(R - g / 2 + 1.0 * MM, xf - 10 * MM, xf + 10 * MM));
  // throw bar + Kato switch-machine housing (molded box beside the points)
  bt.box('plain', 6 * MM, top - 0.3 * MM, -g / 2 - 2 * MM, 8 * MM, top + 0.3 * MM, g / 2 + 2 * MM, col('#2e2e30'), 0);
  const zh = -hand * (K.W / 2 + 2.2 * MM); bt.box('plain', 2 * MM, y, Math.min(zh, zh + hand * 6 * MM) - 3 * MM * (hand > 0 ? 1 : 0), 26 * MM, y + K.H + 0.4 * MM, Math.max(zh, zh + hand * 6 * MM) - 3 * MM * (hand > 0 ? 1 : 0), col(K.colors.housing), 0);
  // long ties spanning both routes
  const ties = []; for (let x = K.TIE_P / 2; x < S.L; x += K.TIE_P) { const zd = yOn(R, Math.min(x, xe)), z0 = Math.min(0, zd), z1 = Math.max(0, zd); ties.push([x, y + K.H, (z0 + z1) / 2, 0, (z1 - z0) + K.TIE_L]); }
  for (const t of ties) bt.geom('plain', low ? K.tieGeoLow(t[4]) : K.tieGeo(t[4]), new THREE.Matrix4().makeTranslation(t[0], t[1], t[2]), L3D.WHITE);
  return { length: S.L, frogX: xf };
};
for (const [id, kind, hand, nm] of [['kato-20-202', '#6', -1, '#6 turnout left'], ['kato-20-203', '#6', 1, '#6 turnout right'], ['kato-20-220', '#4', -1, '#4 turnout left'], ['kato-20-221', '#4', 1, '#4 turnout right']])
  L3D.reg(id, { cat: 'track', name: `Kato Unitrack ${id.slice(5)} ${nm}`, kit: id.slice(5), dims_mm: kind === '#6' ? [186, 'R718-15'] : [126, 'R481-15'], note: 'points, closure rails, frog casting, wing + guard rails, throw bar, switch-machine housing' }, bt => K.turnout(bt, kind, hand));
// 20-048 bumper (end piece with buffer frame + red lamp)
K.bumper = (bt, y = 0) => { const top = y + K.H + K.TIE_H; extrude(bt, 'kato_ballast', [[-12 * MM, 0], [0, 0]], K.PROFILE, y, col(K.colors.roadbed), 1); bt.box('plain', -2 * MM, y, -K.TOP / 2, 0, y + K.H + 3.5 * MM, K.TOP / 2, col('#6a6a6a'), 0);
  for (const s of [-1, 1]) bt.box('plain', -7 * MM, top, s * K.GAUGE / 2 - 0.5 * MM, -2 * MM, top + 3.2 * MM, s * K.GAUGE / 2 + 0.5 * MM, col('#3a3a3a'), 0);
  bt.box('plain', -2.6 * MM, top + 1.6 * MM, -K.GAUGE / 2 - 1 * MM, -1.6 * MM, top + 3.6 * MM, K.GAUGE / 2 + 1 * MM, col('#d8c040'), 0); bt.box('emis', -1.6 * MM, top + 2.2 * MM, -0.8 * MM, -1.0 * MM, top + 3.2 * MM, 0.8 * MM, col('#ff2a2a'), 0); };
L3D.reg('kato-20-048', { cat: 'track', name: 'Kato Unitrack bumper (20-048)', kit: '20-048 [verify: Bumper C / Type A]', dims_mm: [62, 25, 10] }, bt => { K.lay(bt, [[-62 * MM, 0], [0, 0]], 0); K.bumper(bt); });
})(window.L3D);
