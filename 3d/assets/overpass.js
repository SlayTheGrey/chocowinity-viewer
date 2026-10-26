/* overpass.js - true highway overpasses for roads of kind 'over' (Owner 2026-10-15: US 17 near the church).
   Scenery only, never touches track. Per 'over' road: finds the tracks it spans, places a girder bridge whose underside is
   CLEAR (23 scale ft = 1.725 in) above railtop, as a CONTINUOUS VIADUCT at full height from end to end (no return ramp; ends run off the wall/fascia),
   column-bent piers every ~3.6 in placed clear of tracks (>= PIER_CLR), other roads and buildings,
   footprint is removed before the viewer builds it. L3D.overpass.report = clearance numbers for the test. */
(function () {
  const L3D = window.L3D = window.L3D || {}; const T = window.THREE;
  const CLEAR = 23 * 12 / 160, GIRDER = 0.30, SLAB = 0.06, PIER_CLR = 0.75, ABUT_OFF = 1.0, FLAT = 0.6;
  const X = L3D.overpass = { report: [] };
  const cum = P => { const o = [0]; for (let i = 1; i < P.length; i++) o.push(o[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return o; };
  const at = (P, C, s) => { for (let i = 1; i < P.length; i++) if (s <= C[i] || i === P.length - 1) { const l = C[i] - C[i - 1] || 1, f = Math.max(0, Math.min(1, (s - C[i - 1]) / l)); return [P[i - 1][0] + f * (P[i][0] - P[i - 1][0]), P[i - 1][1] + f * (P[i][1] - P[i - 1][1]), (P[i][0] - P[i - 1][0]) / l, (P[i][1] - P[i - 1][1]) / l]; } return [P[0][0], P[0][1], 1, 0]; };
  function segx(p, q, r, s) { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (Math.abs(d) < 1e-12) return null; const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null; }
  const dSeg = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)); return Math.hypot(a[0] + u * dx - x, a[1] + u * dy - y); };
  const trackDist = (L, x, y) => { let d = 1e9; for (const t of L.tracks) for (let i = 1; i < t.pts.length; i++) d = Math.min(d, dSeg(x, y, t.pts[i - 1], t.pts[i])); return d; };
  const roadDist = (L, self, x, y) => { let d = 1e9; for (const r of L.roads || []) { if (r === self || r.kind === 'over') continue; for (let i = 1; i < r.pts.length; i++) d = Math.min(d, dSeg(x, y, r.pts[i - 1], r.pts[i]) - r.w / 2); } return d; };
  const inBld = (L, x, y) => (L.structures || []).some(b => x > b.r[0] - 0.1 && x < b.r[2] + 0.1 && y > b.r[1] - 0.1 && y < b.r[3] + 0.1);
  // 2026-10-15 (Owner): continuous viaduct at full bridge height wall-to-fascia, no return ramp. Piers ~SPAN apart, nudged until both
  // columns are >= PIER_CLR from every track centreline, >= 0.25 in outside every other road and outside buildings; else the span grows.
  const SPAN = 3.6;
  function plan(L, r, H) {
    const P = r.pts, C = cum(P), len = C[C.length - 1], hits = [];
    for (const t of L.tracks) for (let i = 1; i < P.length; i++) for (let j = 1; j < t.pts.length; j++) { const f = segx(P[i - 1], P[i], t.pts[j - 1], t.pts[j]); if (f !== null) hits.push(C[i - 1] + f * (C[i] - C[i - 1])); }
    hits.sort((a, b) => a - b);
    const ok = s => { const p = at(P, C, s), nx = -p[3], nz = p[2]; let clr = 1e9; for (const sg of [-1, 1]) { const x = p[0] + nx * sg * r.w / 3, y = p[1] + nz * sg * r.w / 3;
      if (roadDist(L, r, x, y) < 0.25 || inBld(L, x, y)) return null; clr = Math.min(clr, trackDist(L, x, y) - 0.1); } return clr >= PIER_CLR ? clr : null; };
    const piers = []; let last = 0;
    while (last + SPAN < len - 0.6) { let best = null; for (let d = 0; d <= 1.6 && best === null; d += 0.1) for (const s of [last + SPAN - d, last + SPAN + d]) { if (s <= last + 1.2 || s >= len - 0.4) continue; const c = ok(s); if (c !== null) { best = { s, clr: +c.toFixed(2) }; break; } }
      if (!best) { last += SPAN; continue; } piers.push(best); last = best.s; }
    return { P, C, len, hits, sA: 0, sB: len, r0: len, h: () => H, piers, skipped: [] }; }
  X.prep = function (D) { // drop scenery sitting on the elevated footprint (cars/people/lamps at grade would be buried)
    for (const L of D.levels) for (const r of L.roads || []) { if (r.kind !== 'over') continue; const g = plan(L, r, 1); if (!g) continue;
      const on = (x, y) => { for (let s = 0; s <= g.len; s += 0.25) { const p = at(g.P, g.C, s); if (Math.hypot(p[0] - x, p[1] - y) < r.w / 2 + 0.45) return true; } return false; };
      const n0 = (L.vehicles || []).length; L.vehicles = (L.vehicles || []).filter(v => !on(v.x, v.y)); L.people = (L.people || []).filter(p => !on(p[0], p[1])); L.lamps = (L.lamps || []).filter(p => !on(p[0], p[1]));
      X.report.push({ road: r.name, removedVehicles: n0 - L.vehicles.length }); } };
  X.build = function (api) {
    const M = (c, r) => new T.MeshStandardMaterial({ color: c, roughness: r || 0.85 }); const conc = M('#b9b4aa'), dark = M('#8e8a82'), asph = M('#3e3e40', 0.95), earth = M('#6f8f4e', 1), line = M('#d8b230', 0.6), edge = M('#e6e6e0', 0.6);
    api.LV.forEach((o, li) => { const L = o.L, y0 = o.deck, rt = api.RAILTOP, H = rt + CLEAR + GIRDER + SLAB;
      for (const r of L.roads || []) { if (r.kind !== 'over') continue; const g = plan(L, r, H); if (!g) continue; const G = new T.Group(); G.name = 'overpass:' + r.name; o.g.add(G);
        const seg = (s0, s1, f) => { const a = at(g.P, g.C, s0), b = at(g.P, g.C, s1), l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 1e-4) return; const m = f(l, (g.h(s0) + g.h(s1)) / 2); if (!m) return;
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); m.rotation.y = -ang; m.position.x = (a[0] + b[0]) / 2; m.position.z = (a[1] + b[1]) / 2; G.add(m); return m; };
        const box = (w, h, d, mat) => new T.Mesh(new T.BoxGeometry(w, h, d), mat);
        const ST = 0.25; for (let s = 0; s < g.len - 1e-6; s += ST) { const s1 = Math.min(g.len, s + ST);
          seg(s, s1, (l, h) => { const m = box(l + 0.02, GIRDER, r.w + 0.12, dark); m.position.y = y0 + h - SLAB - GIRDER / 2; return m; }); // girders
          seg(s, s1, (l, h) => { const m = box(l + 0.02, SLAB, r.w + 0.2, conc); m.position.y = y0 + h - SLAB / 2; return m; });       // deck slab
          seg(s, s1, (l, h) => { const m = box(l + 0.02, 0.012, r.w, asph); m.position.y = y0 + h + 0.006; return m; });
          if (r.w >= 1.2 && Math.floor(s / 0.9) !== Math.floor((s + 0.45) / 0.9)) seg(s, s1, (l, h) => { const m = box(l * 0.9, 0.004, 0.025, line); m.position.y = y0 + h + 0.014; return m; });
          for (const sg of [-1, 1]) seg(s, s1, (l, h) => { const m = box(l + 0.02, 0.08, 0.06, edge); m.position.y = y0 + h + 0.04; m.translateZ(sg * (r.w / 2 + 0.07)); return m; }); } // jersey barriers
        for (const p of g.piers) { const c = at(g.P, g.C, p.s), nx = -c[3], nz = c[2], top = y0 + H - SLAB - GIRDER;
          for (const sg of [-1, 1]) { const col = new T.Mesh(new T.CylinderGeometry(0.1, 0.11, top - y0, 16), conc); col.position.set(c[0] + nx * sg * r.w / 3, (top + y0) / 2, c[1] + nz * sg * r.w / 3); G.add(col); }
          seg(p.s - 0.1, p.s + 0.1, () => { const m = box(0.2, 0.14, r.w + 0.15, conc); m.position.y = top - 0.07; return m; }); }
        // a few cars on the highway
        try { const geo = L3D.geo('veh-sedan'); if (!geo.attributes.color) L3D.vcol(geo, L3D.WHITE); const cols = ['#b22222', '#e8e8e8', '#1f4e8c'];
          [0.2, 0.45, 0.7].forEach((f, i) => { const s = f * g.len, c = at(g.P, g.C, s), dir = i % 2 ? -1 : 1, off = dir * r.w * 0.22;
            const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: cols[i], roughness: 0.4 })); m.position.set(c[0] - c[3] * off, y0 + H + 0.012, c[1] + c[2] * off); m.rotation.y = -Math.atan2(c[3] * dir, c[2] * dir); G.add(m); }); } catch (e) { }
        const up = api.LV[li + 1]; const rep = X.report.find(x => x.road === r.name) || (X.report.push({ road: r.name }), X.report[X.report.length - 1]);
        Object.assign(rep, { level: L.id, tracksSpanned: g.hits.length, clearanceIn: +(H - SLAB - GIRDER - rt).toFixed(3), clearanceScaleFt: +((H - SLAB - GIRDER - rt) * 160 / 12).toFixed(1), deckTopIn: +H.toFixed(2),
          headroomToNextDeckIn: up ? +(up.deck - (y0 + H)).toFixed(2) : null, piers: g.piers, piersDropped: g.skipped,
          viaductLenIn: +g.len.toFixed(2), maxSpanIn: +Math.max(...[0, ...g.piers.map(p => p.s), g.len].map((v, i, a) => i ? v - a[i - 1] : 0)).toFixed(2), returnRamp: false }); } }); return X.report; };
  if (window.LAYOUT) try { X.prep(window.LAYOUT); } catch (e) { console.error('overpass prep', e); }
})();
