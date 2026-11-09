/* Flex-track easements (UMD: window.L3DEase / module.exports). Shared by the viewer, the ops engine and test/geometry_check.js.
   The plans draw main-line corners as tangent -> circular arc -> tangent (abrupt curvature change). Owner builds those corners in FLEX track,
   so we insert clothoid (linear-curvature) spirals: SAME tangent lines, SAME body radius R, spiral length Ls each end. Standard consequence:
   the body arc shifts inward (toward the curve centre) by p = Ls^2 / (24 R) and the spiral starts ~Ls/2 earlier on the tangent.
   Run endpoints, tangent lines and the track graph do not move; length changes by a few thousandths of an inch.
   Kato sectional pieces (yard, spurs, turnouts, the NE/SE R381-30 lift curves) are never touched. Units: plan inches. */
(function (root) {
'use strict';
const MIN_R = 18, L_MAX = 4, L_MIN = 2, P_MIN = 0.02;            // body radius >= 18 in; spiral 2-4 in; offset rule p = L^2/24R >= 0.02 in
const lRule = R => Math.max(L_MIN, Math.sqrt(24 * R * P_MIN));   // minimum spiral length for radius R
const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
function resample(P, h) { const out = [P[0]]; let acc = 0; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], d = hyp(a, b); let t = h - acc; while (t <= d) { out.push([a[0] + (b[0] - a[0]) * t / d, a[1] + (b[1] - a[1]) * t / d]); t += h; } acc = d - (t - h); }
  const z = P[P.length - 1]; if (hyp(out[out.length - 1], z) > 1e-6) out.push(z.slice()); return out; }
const cum = P => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + hyp(P[i - 1], P[i])); return c; };
function distPoly(p, P) { let best = 1e9; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1])); } return best; }
/* curvature profile of a polyline sampled every h: returns {P, S, K} */
function profile(P0, h = 0.1, w = 0.5) { const P = resample(P0, h), n = P.length, S = cum(P), H = [], K = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) H.push(Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]));
  const m = Math.max(1, Math.round(w / h)); for (let i = m; i < n - m - 1; i++) { let d = H[i + m] - H[i - m]; d = Math.atan2(Math.sin(d), Math.cos(d)); K[i] = d / (S[i + m] - S[i - m]); }
  return { P, S, K, H }; }
/* find corners on a polyline: runs of |k| > 1/maxR with one sign. For each: tangent lines (fitted to the straight runs outside the curve),
   PI, deflection, TS/ST = where the drawn curve leaves/rejoins its tangents, body radius = median radius of the middle half, drawn transition lengths */
function lineFit(Q) { const n = Q.length, mx = Q.reduce((a, p) => a + p[0], 0) / n, my = Q.reduce((a, p) => a + p[1], 0) / n; let sxx = 0, sxy = 0, syy = 0; for (const p of Q) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { o: [mx, my], u: [Math.cos(th), Math.sin(th)] }; }
const lineDist = (p, L) => Math.abs((p[0] - L.o[0]) * L.u[1] - (p[1] - L.o[1]) * L.u[0]);
function findCorners(P0, opt = {}) { const { P, S, K } = profile(P0), kmin = 1 / (opt.maxR || 150), out = [], n = P.length; let i = 0;
  while (i < n) { if (Math.abs(K[i]) < kmin) { i++; continue; } const sg = Math.sign(K[i]); let j = i; while (j + 1 < n && (Math.abs(K[j + 1]) >= kmin ? Math.sign(K[j + 1]) === sg : (j + 6 < n && K.slice(j + 1, j + 7).some(k => Math.sign(k) === sg && Math.abs(k) >= kmin)))) j++;
    const c = { i0: i, i1: j, dir: sg }; i = j + 1;
    const L0 = Math.max(0, c.i0 - 60), L1 = Math.min(n - 1, c.i1 + 60); if (c.i0 - L0 < 20 || L1 - c.i1 < 20) continue;   // needs straight track both sides
    const tin = lineFit(P.slice(L0, Math.max(L0 + 2, c.i0 - 5))), tout = lineFit(P.slice(Math.min(L1 - 2, c.i1 + 5), L1 + 1));
    let uIn = tin.u, uOut = tout.u; const dIn = [P[c.i0][0] - P[L0][0], P[c.i0][1] - P[L0][1]]; if (uIn[0] * dIn[0] + uIn[1] * dIn[1] < 0) uIn = [-uIn[0], -uIn[1]]; const dOut = [P[L1][0] - P[c.i1][0], P[L1][1] - P[c.i1][1]]; if (uOut[0] * dOut[0] + uOut[1] * dOut[1] < 0) uOut = [-uOut[0], -uOut[1]];
    let D = Math.atan2(uOut[1], uOut[0]) - Math.atan2(uIn[1], uIn[0]); D = Math.atan2(Math.sin(D), Math.cos(D)); if (Math.abs(D) < 0.05) continue;
    const den = uIn[0] * uOut[1] - uIn[1] * uOut[0], t = ((tout.o[0] - tin.o[0]) * uOut[1] - (tout.o[1] - tin.o[1]) * uOut[0]) / den; c.PI = [tin.o[0] + uIn[0] * t, tin.o[1] + uIn[1] * t];
    let a = c.i0; while (a > L0 && lineDist(P[a], tin) > 0.003) a--; let b = c.i1; while (b < L1 && lineDist(P[b], tout) > 0.003) b++;
    c.iTS = a; c.iST = b; c.TS = P[a]; c.ST = P[b]; c.sTS = S[a]; c.sST = S[b]; c.uIn = uIn; c.uOut = uOut; c.delta = Math.abs(D); c.dir = Math.sign(D);
    c.Tin = hyp(c.TS, c.PI); c.Tout = hyp(c.ST, c.PI); c.len = S[b] - S[a];
    const rr = []; for (let k = a; k <= b; k++) if (Math.abs(K[k]) > 1e-6) rr.push(1 / Math.abs(K[k])); const mid = rr.slice(Math.floor(rr.length / 4), Math.ceil(rr.length * 3 / 4)).sort((x, y) => x - y);
    c.Rbody = mid[mid.length >> 1]; c.Rmin = mid[Math.floor(mid.length * 0.1)];
    // drawn transition: from TS until the (smoothed) curvature first reaches 90 % of the body curvature
    const ks = k => { let m = 0, q = 0; for (let z = Math.max(a, k - 10); z <= Math.min(b, k + 10); z++) { m += Math.abs(K[z]); q++; } return m / q; };
    let e = a; while (e < b && ks(e) < 0.9 / c.Rbody) e++; let f = b; while (f > a && ks(f) < 0.9 / c.Rbody) f--; c.trIn = S[e] - S[a]; c.trOut = S[b] - S[f];
    c.mid = P[(a + b) >> 1]; c.orig = P.slice(a, b + 1);
    out.push(c); }
  return out; }
/* spiral-arc-spiral in a local frame: start (0,0) heading 0, turning left; entry spiral L1, exit spiral L2 (clothoids: curvature linear in length) */
function sas(R, delta, L1, L2 = L1, h = 0.05) { const pts = [[0, 0]]; let x = 0, y = 0, th = 0; const La = R * (delta - (L1 + L2) / (2 * R)), Ltot = L1 + Math.max(0, La) + L2, n = Math.max(2, Math.ceil(Ltot / h)), ds = Ltot / n;
  const k = s => s < L1 ? s / (L1 * R) : s < L1 + La ? 1 / R : Math.max(0, (Ltot - s) / (L2 * R));
  for (let i = 0; i < n; i++) { const s = i * ds, k1 = k(s), k2 = k(s + ds / 2), k3 = k(s + ds); const thm = th + (k1 + k2) / 2 * ds / 2; x += Math.cos(thm) * ds; y += Math.sin(thm) * ds; th += (k1 + 4 * k2 + k3) / 6 * ds; pts.push([x, y]); }
  return { pts, end: [x, y], th, len: Ltot, La }; }
/* plan the flex easement of one corner. TS, ST, PI and both tangent lines stay EXACTLY where the plan has them (run ends/tangents do not move).
   Body radius: the plan's drawn body radius (corners within 2 % of 18 in are taken as exactly 18.000 in = 457.2 mm). Spiral lengths L1/L2 are
   solved so the spiral-arc-spiral spans the drawn TS->PI and PI->ST distances; each must be >= max(2 in, offset rule sqrt(24 R p_min)). */
function geomT(R, delta, L1, L2) { const g = sas(R, delta, L1, L2, 0.02), xPI = g.end[0] - g.end[1] / Math.tan(g.th); return { tin: xPI, tout: Math.hypot(g.end[0] - xPI, g.end[1]), g }; }
function plan(c, opt = {}) { const r = { Rplan: c.Rbody, deltaDeg: c.delta * 180 / Math.PI, fits: true, why: '' };
  const R = Math.abs(c.Rbody - MIN_R) / MIN_R < 0.02 ? MIN_R : c.Rbody; r.R = R;
  let L1 = Math.max(c.trIn, L_MIN), L2 = Math.max(c.trOut, L_MIN);
  const fit1 = (Lfix, which) => { let lo = 0.05, hi = Math.max(0.1, 2 * R * c.delta * 0.98 - Lfix); for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, t = which ? geomT(R, c.delta, Lfix, m).tout : geomT(R, c.delta, m, Lfix).tin; if (t > (which ? c.Tout : c.Tin)) hi = m; else lo = m; } return (lo + hi) / 2; };
  for (let it = 0; it < 8; it++) { L1 = fit1(L2, 0); L2 = fit1(L1, 1); }
  const G = geomT(R, c.delta, L1, L2); r.L1 = L1; r.L2 = L2; r.Ls = Math.min(L1, L2); r.Lrule = lRule(R); r.p = [L1 * L1 / (24 * R), L2 * L2 / (24 * R)]; r.tsErr = Math.max(Math.abs(G.tin - c.Tin), Math.abs(G.tout - c.Tout));
  if (r.tsErr > 0.01 || G.g.La < 0) { r.fits = false; r.why = `cannot meet the drawn tangent points with R ${R.toFixed(2)} in (err ${r.tsErr.toFixed(3)} in)`; r.Ls = 0; return r; }
  if (r.Ls < r.Lrule) { r.fits = false; r.why = `spiral ${r.Ls.toFixed(2)} in is shorter than the offset rule ${r.Lrule.toFixed(2)} in`; }
  const g = G.g; r.len = g.len; r.oldLen = cum(c.orig).pop(); r.dLen = g.len - r.oldLen;
  const nIn = [-c.uIn[1] * c.dir, c.uIn[0] * c.dir], TS = c.TS;
  r.pts = g.pts.map(([x, y]) => [TS[0] + c.uIn[0] * x + nIn[0] * y, TS[1] + c.uIn[1] * x + nIn[1] * y]); r.endErr = hyp(r.pts[r.pts.length - 1], c.ST); r.pts[r.pts.length - 1] = c.ST.slice(); r.TS = c.TS; r.ST = c.ST;
  const midN = r.pts[r.pts.length >> 1]; r.inward = hyp(midN, c.PI) - hyp(c.mid, c.PI); r.maxDev = Math.max(...c.orig.filter((_, k) => k % 4 === 0).map(p => distPoly(p, r.pts)));
  r.orig = c.orig; return r; }
/* replace the corner zone of any polyline that runs along the original corner (tracks, routes, ops edges) with the eased curve */
function remap(P, plans, tol = 0.03) { if (!plans.length) return P; let Q = P;
  for (const r of plans) { if (!r.pts || !r.Ls) continue; const O = r.orig; // original geometry over the same zone (tangent + arc + tangent)
    const inZ = Q.map(p => distPoly(p, O) < tol); if (!inZ.some(Boolean)) continue;
    // walk runs of in-zone points; only replace runs that cover (nearly) the whole zone so short neighbours are left alone
    const out = []; let i = 0; while (i < Q.length) { if (!inZ[i]) { out.push(Q[i]); i++; continue; } let j = i; while (j + 1 < Q.length && inZ[j + 1]) j++;
      const a = Q[i], b = Q[j], dA = hyp(a, r.TS), dB = hyp(b, r.ST), dA2 = hyp(a, r.ST), dB2 = hyp(b, r.TS);
      if (j - i > 3 && ((dA < 0.15 && dB < 0.15) || (dA2 < 0.15 && dB2 < 0.15))) { const E = dA < 0.15 ? r.pts : r.pts.slice().reverse(); out.push(a); for (let k = 1; k < E.length - 1; k++) out.push(E[k].slice()); out.push(b); }
      else for (let k = i; k <= j; k++) out.push(Q[k]);
      i = j + 1; }
    Q = out; }
  return Q; }
/* plan every flex corner on one level: main-line corners only. Kato sectional curves (the NE/SE R381-30 lift curves) are excluded. */
function planLevel(L, opt = {}) { const mains = (L.tracks || []).filter(t => t.type === 'main'), exclude = (L.elevator || []).filter(e => /R381|NEVER ALTER/i.test(e.name || '')).map(e => e.pts), res = [];
  const TO = (L.turnouts || []).flatMap(t => [t.thr[0], t.thr[t.thr.length - 1]]);
  for (const [ti, t] of mains.entries()) for (const c of findCorners(t.pts)) { c.track = ti; c.kato = exclude.some(E => distPoly(c.mid, E) < 0.05);
    if (c.kato) { res.push({ c, r: { skip: 'Kato R381-30 sectional (not flex)' } }); continue; }
    // a turnout end inside the drawn transition (e.g. a #6 heel just past the TS): start/end the spiral at the turnout instead (tangent unchanged, TS slides along it)
    c.moved = [];
    for (const q of TO) { if (distPoly(q, c.orig) > 0.03) continue; const dTS = hyp(q, c.TS), dST = hyp(q, c.ST);
      if (dTS > 0.05 && dTS < 4 && dTS < dST) { const t = (q[0] - c.PI[0]) * c.uIn[0] + (q[1] - c.PI[1]) * c.uIn[1]; c.TS = [c.PI[0] + c.uIn[0] * t, c.PI[1] + c.uIn[1] * t]; c.Tin = -t; c.moved.push(['TS', dTS]); }
      else if (dST > 0.05 && dST < 4) { const t = (q[0] - c.PI[0]) * c.uOut[0] + (q[1] - c.PI[1]) * c.uOut[1]; c.ST = [c.PI[0] + c.uOut[0] * t, c.PI[1] + c.uOut[1] * t]; c.Tout = t; c.moved.push(['ST', dST]); } }
    if (c.moved.length) { const i0 = c.orig.findIndex(p => hyp(p, c.TS) < 0.08), i1 = c.orig.findIndex(p => hyp(p, c.ST) < 0.08); c.orig = c.orig.slice(Math.max(0, i0), i1 < 0 ? undefined : i1 + 1); c.orig[0] = c.TS.slice(); c.orig[c.orig.length - 1] = c.ST.slice(); c.trIn = Math.max(L_MIN, c.trIn - (c.moved.find(m => m[0] === 'TS') || [0, 0])[1]); }
    const r = plan(c, opt); r.moved = c.moved; r.turnoutInZone = TO.some(q => distPoly(q, c.orig) < 0.02 && hyp(q, c.TS) > 0.05 && hyp(q, c.ST) > 0.05); if (r.turnoutInZone) { r.fits = false; r.why = 'a turnout sits inside the curve'; r.pts = null; r.Ls = 0; }
    res.push({ c, r }); }
  return res; }
/* apply to a whole layout (levels[]) in place; returns the per-level plan list. opts.flex === false disables */
function applyLayout(levels, opt = {}) { const all = []; levels.forEach((L, li) => { const pl = planLevel(L, opt), use = pl.filter(x => x.r.pts && x.r.Ls).map(x => x.r); all.push(pl);
  for (const t of L.tracks || []) if (t.type === 'main') t.pts = remap(t.pts, use);
  for (const r of L.routes || []) { r.pts = remap(r.pts, use); if (r.length) r.length = cum(r.pts).slice(-1)[0] + (r.closed ? hyp(r.pts[r.pts.length - 1], r.pts[0]) : 0); }
  L._flex = use; }); return all; }
/* flex corners of a layout (levels[] from layout.json) in a compact form for the ops graph: [{level (1-based), TS, ST, pts}] */
function flexFromLayout(levels, opt = {}) { const out = []; levels.forEach((L, li) => { for (const { r } of planLevel(L, opt)) if (r.pts) out.push({ level: li + 1, TS: r.TS, ST: r.ST, R: r.R, L1: r.L1, L2: r.L2, pts: resample(r.pts, 0.25).map(p => [+p[0].toFixed(5), +p[1].toFixed(5)]) }); }); return out; }
/* splice an eased corner into a (possibly coarse) polyline: cut at the TS and ST stations, insert the curve. Needs TS and ST within tol of P. */
function splice(P, f, tol = 0.1) { const S = cum(P), proj = q => { let best = [1e9, 0]; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12; let t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]); if (d < best[0]) best = [d, S[i - 1] + t * Math.sqrt(l2)]; } return best; };
  const [dA, sA] = proj(f.TS), [dB, sB] = proj(f.ST); if (dA > tol || dB > tol) return null; const fwd = sA < sB, s0 = Math.min(sA, sB), s1 = Math.max(sA, sB), E = fwd ? f.pts : f.pts.slice().reverse();
  const out = []; for (let i = 0; i < P.length && S[i] < s0 - 1e-6; i++) out.push(P[i]); out.push(...E.map(p => p.slice())); for (let i = 0; i < P.length; i++) if (S[i] > s1 + 1e-6) out.push(P[i]); return out; }
/* ops graph: ease the main-line edges in place (end nodes fixed). flex = D.flex (written by build_ops) or flexFromLayout(LAYOUT.levels). Idempotent. */
function easeGraph(G, flex) { if (!G || G._eased || !flex || !flex.length) return []; G._eased = true; const out = [];
  for (const e of G.edges) { if (e.type !== 'main' || !e.pts || e.pts.length < 2) continue;
    for (const f of flex) { if (f.level !== e.level) continue; const Q = splice(e.pts, f); if (!Q) continue; const l0 = cum(e.pts).pop(); e.pts = Q; const l1 = cum(Q).pop(); if (e.len != null) e.len = l1; out.push({ edge: e.id, level: e.level, R: f.R, dLen: l1 - l0 }); } }
  return out; }
const API = { MIN_R, L_MAX, L_MIN, P_MIN, lRule, resample, profile, findCorners, sas, plan, remap, planLevel, applyLayout, easeGraph, flexFromLayout, splice, distPoly, cum };
if (typeof module !== 'undefined' && module.exports) module.exports = API; root.L3DEase = API;
})(typeof window !== 'undefined' ? window : globalThis);
