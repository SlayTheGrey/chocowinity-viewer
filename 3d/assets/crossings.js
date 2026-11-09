/* crossings.js - automatic grade crossings for layout3d (Owner, 2026-10-14).
   Finds every road x track intersection in LAYOUT (road kind 'over' = real overpass, skipped). Hits closer than CLUSTER along
   one road become ONE consolidated crossing (one set of gates/lights spanning all tracks, "N TRACKS" plate). Never edits track.
   Builds: flush crossing panels at railtop, crossbuck masts, alternating flashers, animated gate arms (public road or any
   main/siding track), crossbucks only for private drives over spurs, white stop lines.  Live: lights flash and gates drop
   when a moving car is within ACT of the crossing; road agents (ops3d) stop at the stop line until the gates are up.
   Same rules as crossing_check.py (the independent audit). */
(function () {
  const L3D = window.L3D = window.L3D || {}; const T = window.THREE;
  const CLUSTER = 4.5, PAD = 0.45, STOPLINE = 0.75, ACT = 14, HOLD = 3, MAST_OFF = 0.2, ARM_H = 0.34;
  const X = L3D.crossings = { list: [], replacesStatic: true, CLUSTER, built: false };
  const cum = P => { const o = [0]; for (let i = 1; i < P.length; i++) o.push(o[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return o; };
  function segx(p, q, r, s) { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (Math.abs(d) < 1e-12) return null;
    const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null; }
  function roadAt(P, C, s) { for (let i = 1; i < P.length; i++) if (s <= C[i] || i === P.length - 1) { const l = C[i] - C[i - 1] || 1, f = Math.max(0, Math.min(1, (s - C[i - 1]) / l)); return [P[i - 1][0] + f * (P[i][0] - P[i - 1][0]), P[i - 1][1] + f * (P[i][1] - P[i - 1][1]), (P[i][0] - P[i - 1][0]) / l, (P[i][1] - P[i - 1][1]) / l]; } return [P[0][0], P[0][1], 1, 0]; }
  X.detect = function (levels) {
    if (X._det) return X.list; X._det = true; const out = X.list;
    levels.forEach((L, li) => (L.roads || []).forEach((r, ri) => {
      if (r.kind === 'over' || !r.pts || r.pts.length < 2) return; const P = r.pts, C = cum(P), hits = [];
      (L.tracks || []).forEach((t, ti) => { const Tp = t.pts; for (let i = 1; i < P.length; i++) for (let j = 1; j < Tp.length; j++) { const x = segx(P[i - 1], P[i], Tp[j - 1], Tp[j]); if (!x) continue;
        hits.push({ s: C[i - 1] + x[0] * (C[i] - C[i - 1]), x: P[i - 1][0] + x[0] * (P[i][0] - P[i - 1][0]), y: P[i - 1][1] + x[0] * (P[i][1] - P[i - 1][1]), track: ti, type: t.type, ang: Math.atan2(Tp[j][1] - Tp[j - 1][1], Tp[j][0] - Tp[j - 1][0]) }); } });
      hits.sort((a, b) => a.s - b.s); const groups = []; for (const h of hits) { const g = groups[groups.length - 1]; if (g && h.s - g[g.length - 1].s < CLUSTER) g.push(h); else groups.push([h]); }
      for (const g of groups) { const types = [...new Set(g.map(h => h.type))].sort(), n = new Set(g.map(h => h.track)).size;
        const gates = types.includes('main') || types.includes('siding') || ((r.kind || 'road') === 'road' && !r.private);   /* [FIX-10] private plant drive over a spur: crossbucks + STOP sign */
        const s0 = g[0].s - PAD, s1 = g[g.length - 1].s + PAD, mid = roadAt(P, C, (s0 + s1) / 2);
        out.push({ id: out.length, lv: li, level: L.id, road: r.name || 'road' + ri, roadKind: r.kind, pts: P, cum: C, w: r.w || 0.8, s0, s1, x: mid[0], y: mid[1], tracks: n, types,
          protection: gates ? 'gates+flashers' : 'crossbucks', hits: g.map(h => [+h.x.toFixed(2), +h.y.toFixed(2), h.type, +h.ang.toFixed(4), h.track]), rural: !gates || g.every(h => !['main', 'siding'].includes(h.type)) && (r.private || (r.kind && r.kind !== 'road')), on: false, hold: 0, arm: 0, t: 0 }); } }));
    return out; };
  X.forRoad = pts => X.list.filter(c => c.pts === pts);
  // [NO-SPOT] a car standing on [sa, sb] of a Route at plan level o must not overlap any crossing; returns the arc length to jump to, else null
  X.noSpot = function (o, route, sa, sb, LV) { if (!X._det && LV) X.detect(LV.map(v => v.L)); const li = LV ? LV.indexOf(o) : -1, v = new T.Vector3();
    for (let s = sa; s <= sb + 1e-6; s += 0.2) { route.at(Math.min(s, sb), v); for (const c of X.list) if (c.lv === li) for (const h of c.hits) if (Math.hypot(h[0] - v.x, h[1] - v.z) < 0.75) return s + 0.95; } return null; };
  // stop line logic for road agents: returns the arc length the agent must not pass, or null
  X.stopFor = function (lv, pts, s, dir, kind) { let best = null; const back = kind === 'person' ? 0.25 : 0.65;
    for (const c of X.list) { if (c.lv !== lv || c.pts !== pts || c.arm < 0.02 && !c.on) continue;
      const line = dir > 0 ? c.s0 - STOPLINE - back : c.s1 + STOPLINE + back; const ahead = dir * (line - s);
      if (ahead > -0.05 && ahead < 3.5 && (best === null || Math.abs(line - s) < Math.abs(best - s))) best = line; } return best; };
  X.limits = function (lv, pts, len) { let lo = 0, hi = len; for (const c of X.list) { if (c.lv !== lv || c.pts !== pts) continue;
      if (c.s0 - STOPLINE - 1.5 < 0) lo = Math.max(lo, c.s1 + STOPLINE + 0.7); if (c.s1 + STOPLINE + 1.5 > len) hi = Math.min(hi, c.s0 - STOPLINE - 0.7); } return lo < hi ? [lo, hi] : [0, len]; };
  // ---- 3D ----
  const M = {}; function mats() { if (M.pole) return; const S = (c, e, ei) => new T.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1, emissive: e || 0, emissiveIntensity: ei || 0 });
    M.pole = S('#c8c8c8'); M.white = S('#f2f2f2'); M.black = S('#151515'); M.panel = S('#3b3a37'); M.fill = S('#5a5a57'); M.rubber = S('#2f2f2e'); M.concrete = S('#b7b3aa'); M.timber = S('#7a5c3e'); M.timber2 = S('#6a4f35'); M.flange = S('#121212'); M.off = S('#3a0d0d'); M.lit = S('#ff2a14', '#ff2a14', 2.2); M.stop = S('#eeeeee');
    M.armW = S('#f4f4f4'); M.armR = S('#c41e1e'); }
  function label(txt) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 72; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 72); g.strokeStyle = '#111'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 66);
    g.fillStyle = '#111'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 128, 38); const tx = new T.CanvasTexture(cv); return new T.MeshStandardMaterial({ map: tx, roughness: 0.7 }); }
  const box = (w, h, d, m) => new T.Mesh(new T.BoxGeometry(w, h, d), m);
  const XSET = 0.43;
  function mast(c, side, gate) { // side: +1 approach from s0 (traffic heading +dir), -1 approach from s1
    const P = roadAt(c.pts, c.cum, side > 0 ? c.s0 - XSET : c.s1 + XSET) /* [R28 clearance] mast >= 0.75 in from the track CL (was 0.12 in back of the panel = 0.47 in) */, dx = P[2] * side, dz = P[3] * side, Rx = -dz, Rz = dx; // heading + right-hand normal
    const off = c.w / 2 + MAST_OFF, g = new T.Group(); g.position.set(P[0] + Rx * off, 0, P[1] + Rz * off); g.rotation.y = -Math.atan2(Rz, Rx); // local +x = right of traffic (outwards), local z = -heading
    const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };
    /* [INGEST batch8] gated crossings: the crossing-gate.glb mast (crossbuck, flasher heads, gate mechanism; origin = mast base, keepOrigin) replaces the
       procedural mast. Its own lowered arm and lenses are left out: the arm and the flasher lamps stay procedural so they still drop and flash. */
    const XID = gate ? 'crossing-gate' : 'crossbuck', XG = L3D.ext && L3D.ext.has && L3D.ext.has(XID) ? L3D.ext.scenes[XID] : null;
    /* passive (crossbucks-only) crossings: crossbuck.glb without its flasher heads (signal_body / lens), and the 'tracks' plate only when there are 2+ tracks */
    const DROP = gate ? (XID === 'crossing-gate' && L3D.ext.scenes[XID] && (() => { let a = false; L3D.ext.scenes[XID].traverse(n => { if (n.name === 'gate_arm_1') a = true; }); return a; })() ? /lens/i : /stripes|lens/i) : c.tracks > 1 ? /lens|signal_body/i : /lens|signal_body|tracks/i;
    if (XG) { const m = XG.clone(true); if (gate) m.rotation.y = Math.PI; /* model arm runs +X; here the arm swings towards local -x */
      m.traverse(n => { if (!n.isMesh) return; const ms = [].concat(n.material), keep = ms.map(mt => !DROP.test(mt.name || ''));
        if (!keep.some(Boolean)) { n.visible = false; return; } if (Array.isArray(n.material) && keep.includes(false)) { const gr = n.geometry.groups; n.geometry = n.geometry.clone(); n.geometry.groups = gr.filter(q => keep[q.materialIndex]); } });
      g.add(m); X.models = (X.models || 0) + 1; }
    else { g.add(at(box(0.028, 1.12, 0.028, M.pole), 0, 0.56, 0));
    for (const a of [Math.PI / 4, -Math.PI / 4]) { const b = box(0.36, 0.05, 0.008, M.white); b.position.set(0, 1.0, 0.02); b.rotation.z = a; g.add(b); } }
    if (c.tracks > 1 && !XG) { const pl = box(0.2, 0.06, 0.006, label(c.tracks + ' TRACKS')); pl.position.set(0, 0.86, 0.02); g.add(pl); }
    const L = [];
    if (XG && gate) for (const lz of [0.062, -0.062]) for (const lx of [-0.07, 0.07]) { const l = new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.01, 14), M.off); l.rotation.x = Math.PI / 2; l.position.set(lx, 0.735, lz); g.add(l); L.push(l); }
    else if (c.protection !== 'crossbucks') { g.add(at(box(0.3, 0.02, 0.02, M.black), 0, 0.72, 0.02));
      for (const lx of [-0.12, 0.12]) { const bk = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.008, 18), M.black); bk.rotation.x = Math.PI / 2; bk.position.set(lx, 0.72, 0.025); g.add(bk);
        const l = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.03, 14), M.off); l.rotation.x = Math.PI / 2; l.position.set(lx, 0.72, 0.04); g.add(l); L.push(l); }
      // second light pair facing the far side (real masts are back-to-back)
      for (const lx of [-0.12, 0.12]) { const l = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.03, 14), M.off); l.rotation.x = Math.PI / 2; l.position.set(lx, 0.72, -0.03); g.add(l); L.push(l); } }
    /* [RV2] Round-10 crossing-gate.glb carries its own arm (gate_arm_1: origin = pivot hub, rest LOWERED along +X, raise = +90 deg about Z):
       drive that node instead of the procedural arm; its length is set to reach across the approach lane like the real one (arms come 12-40 ft) */
    let garm = null; if (XG && gate) { g.updateMatrixWorld(true); g.traverse(n => { if (!garm && n.name === 'gate_arm_1') garm = n; }); }
    if (garm) { const q0 = garm.quaternion.clone(), bb = new T.Box3().setFromObject(garm), wp = new T.Vector3(); garm.getWorldPosition(wp); const reach = Math.max(bb.max.x - wp.x, wp.x - bb.min.x, 0.1), want = c.w / 2 + MAST_OFF - 0.02;
      garm.scale.x *= Math.max(0.4, Math.min(1.6, want / reach)); const Z = new T.Vector3(0, 0, 1), qq = new T.Quaternion();
      const arm2 = { set rz(v) {}, _set(a) { garm.quaternion.copy(q0).multiply(qq.setFromAxisAngle(Z, a)); } }; arm2.rotation = { set z(a) { arm2._set(a); } };
      return { g, L, arm: arm2, sl: (() => { const Sp = roadAt(c.pts, c.cum, side > 0 ? c.s0 - STOPLINE : c.s1 + STOPLINE); const sl = box(c.w / 2 - 0.04, 0.004, 0.05, M.stop); sl.position.set(Sp[0] + Rx * c.w / 4, 0, Sp[1] + Rz * c.w / 4); sl.rotation.y = -Math.atan2(Rz, Rx); sl.userData.stopline = 1; return sl; })() }; }
    let arm = null; if (gate) { const piv = new T.Group(); if (XG) piv.position.set(-0.05, 0.27, 0.04); else piv.position.set(0.06, ARM_H, 0.06); piv.rotation.y = Math.PI; g.add(piv); // arm swings across the approach lane (towards road centre)
      const len = c.w / 2 + MAST_OFF - 0.02, n = Math.max(3, Math.round(len / 0.12)); for (let k = 0; k < n; k++) { const s = box(len / n, 0.028, 0.012, k % 2 ? M.armW : M.armR); s.position.set((k + 0.5) * len / n, 0, 0); piv.add(s); }
      piv.add(at(box(0.08, 0.06, 0.05, M.black), -0.05, 0, 0)); arm = piv; }
    // stop line across the approach lane
    const Sp = roadAt(c.pts, c.cum, side > 0 ? c.s0 - STOPLINE : c.s1 + STOPLINE); const sl = box(c.w / 2 - 0.04, 0.004, 0.05, M.stop);
    sl.position.set(Sp[0] + Rx * c.w / 4, 0, Sp[1] + Rz * c.w / 4); sl.rotation.y = -Math.atan2(Rz, Rx); sl.userData.stopline = 1;
    return { g, L, arm, sl }; }
  X.build = function (api) { if (X.built) return; X.built = true; X.api = api; X.detect(api.LV.map(o => o.L)); mats();
    for (const c of X.list) { const o = api.LV[c.lv], y = o.deck, rt = y + api.RAILTOP, root = new T.Group(); root.name = 'xing' + c.id; o.g.add(root); c.root = root;
      // [RV2 Owner] real crossing: road raised to the railhead between and beside the tracks, smooth approach ramps, and per-track
      // crossing panels laid along each track (rubber on the main/siding, concrete on industry track, timber planks on rural spurs)
      // flush with the railhead, flangeways beside each rail; rails stay exposed, ties are covered.
      const a = roadAt(c.pts, c.cum, c.s0), b = roadAt(c.pts, c.cum, c.s1), len = Math.hypot(b[0] - a[0], b[1] - a[1]), ra = Math.atan2(b[1] - a[1], b[0] - a[0]), top = rt - 0.003;
      const pn = box(len, top - y, c.w + 0.1, M.fill); pn.position.set((a[0] + b[0]) / 2, (top - y) / 2 + y, (a[1] + b[1]) / 2); pn.rotation.y = -ra; pn.receiveShadow = true; root.add(pn);
      const RL = 1.8, y0 = y + 0.022;
      for (const [sv, sg] of [[c.s0, -1], [c.s1, 1]]) { const e = roadAt(c.pts, c.cum, sv), f = roadAt(c.pts, c.cum, sv + sg * RL), hw = c.w / 2 + 0.05;   // approach ramp (follows the road)
        const nx = -e[3], nz = e[2], nx2 = -f[3], nz2 = f[2], P = [[e[0] + nx * hw, top, e[1] + nz * hw], [e[0] - nx * hw, top, e[1] - nz * hw], [f[0] - nx2 * hw, y0, f[1] - nz2 * hw], [f[0] + nx2 * hw, y0, f[1] + nz2 * hw]];
        const pos = [], tri = (A, B, C) => pos.push(...A, ...B, ...C); tri(P[0], P[1], P[2]); tri(P[0], P[2], P[3]);
        for (const [i, j] of [[0, 3], [1, 2]]) { const A = P[i], B = P[j]; tri(A, B, [A[0], y, A[2]]); tri(B, [B[0], y, B[2]], [A[0], y, A[2]]); }
        const g2 = new T.BufferGeometry(); g2.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g2.computeVertexNormals(); const rm = new T.Mesh(g2, M.fill); rm.receiveShadow = true; root.add(rm); }
      c.rampH = d => Math.max(y0, top - (top - y0) * d / RL);
      const G2 = X.GAUGE2 || 0.177, HW = 0.018, FW = 0.022, OUT = 0.32;
      for (const h of c.hits) { const ta = h[3] || 0, cross = Math.abs(Math.sin(ra - ta)) || 1, Lp = Math.min(3 * c.w, (c.w + 0.3) / cross), g = new T.Group(); g.position.set(h[0], 0, h[1]); g.rotation.y = -ta; root.add(g);
        const kind = c.rural ? 'timber' : (h[2] === 'main' || h[2] === 'siding') ? 'rubber' : 'concrete', mat = M[kind], seg = kind === 'timber' ? Lp : 0.6, n = Math.max(1, Math.round(Lp / seg)), sl = Lp / n;
        const strips = [[-G2 + HW + FW, G2 - HW - FW], [G2 + HW + FW, G2 + OUT], [-G2 - OUT, -G2 - HW - FW]];
        for (const [z0, z1] of strips) {
          if (kind === 'timber') { const nb = Math.max(2, Math.round((z1 - z0) / 0.06)), bw = (z1 - z0) / nb; for (let k = 0; k < nb; k++) { const pl = box(Lp, top - y, bw - 0.006, k % 2 ? M.timber : M.timber2); pl.position.set(0, (top - y) / 2 + y, z0 + bw * (k + 0.5)); pl.receiveShadow = true; g.add(pl); } continue; }
          for (let k = 0; k < n; k++) { const pl = box(sl - 0.008, top - y + 0.002, z1 - z0, mat); pl.position.set(-Lp / 2 + sl * (k + 0.5), (top - y + 0.002) / 2 + y, (z0 + z1) / 2); pl.receiveShadow = true; g.add(pl); } }
        for (const sd of [-1, 1]) for (const z of [sd * (G2 - HW - FW / 2), sd * (G2 + HW + FW / 2)]) { const fl = box(Lp, 0.004, FW, M.flange); fl.position.set(0, top - 0.03, z); g.add(fl); }   // flangeway floors, dark
      }
      c.lights = []; c.arms = [];
      for (const side of [1, -1]) { const m = mast(c, side, c.protection !== 'crossbucks'); m.g.position.y = y; m.sl.position.y = c.rampH(STOPLINE) + 0.002; root.add(m.g); root.add(m.sl); c.lights.push(...m.L); if (m.arm) c.arms.push(m.arm); }
      c.setArm = v => { c.arm = v; for (const p of c.arms) p.rotation.z = (1 - v) * Math.PI / 2 * 0.97; }; c.setArm(0); }
    return X.list; };
  const _prev = new WeakMap();
  function cars() { const out = [], api = X.api; if (!api) return out;
    for (const t of api.trains || []) for (const c of t.cars || []) if (c.cx !== undefined) { let li = 0, bd = 1e9; api.LV.forEach((o, i) => { const d = Math.abs((c.cy || 0) - o.deck - api.RAILTOP); if (d < bd) { bd = d; li = i; } }); out.push([c, li, c.cx, c.cz]); }
    const O = window.__ops3d || window.LAYOUT3D_OPS; const eng = O && (O.engine || O.eng); if (eng && eng.cuts) for (const cut of eng.cuts) for (const c of cut.cars) { const P = c._pose; if (P) out.push([c, Math.round(P.level) - 1, P.x, P.y]); }
    return out; }
  X.tick = function (dt, force) { if (!X.built || !X.list.length) return; { const now = performance.now(); dt = X._last ? Math.min(0.5, Math.max(0, (now - X._last) / 1000)) : 0; X._last = now; } /* own clock: rAF stamps can lag performance.now */ X.t = (X.t || 0) + dt; const cs = cars(), mv = [];
    for (const [c, li, x, z] of cs) { const p = _prev.get(c); const sp = p && dt > 0 ? Math.hypot(x - p[0], z - p[1]) / dt : 0; _prev.set(c, [x, z]); mv.push([li, x, z, sp]); }
    for (const c of X.list) { let near = false; for (const [li, x, z, sp] of mv) { if (li !== c.lv) continue; for (const h of c.hits) { const d = Math.hypot(h[0] - x, h[1] - z); if (d < 0.9 || (d < ACT && sp > 0.05)) { near = true; break; } } if (near) break; }
      if (X.forceOn && X.forceOn(c)) near = true;
      if (near) { c.hold = HOLD; if (!c.on) c.t = 0; c.on = true; } else if (c.on && (c.hold -= dt) <= 0) c.on = false; c.t += dt;
      if (c.protection !== 'crossbucks') { const tgt = c.on && c.t > 1.2 ? 1 : 0; const v = Math.max(0, Math.min(1, c.arm + Math.sign(tgt - c.arm) * dt / 2.2)); if (v !== c.arm) c.setArm(v); }
      const flash = (c.on || c.arm > 0.01) && c.protection !== 'crossbucks', ph = Math.floor(X.t * 1.8) % 2;
      c.lights.forEach((l, i) => { const m = flash && (i % 2) === ph ? M.lit : M.off; if (l.material !== m) l.material = m; }); } };
  X.pageList = () => X.list.map(c => ({ level: c.level, road: c.road, x: +c.x.toFixed(2), y: +c.y.toFixed(2), tracks: c.tracks, types: c.types, protection: c.protection, hits: c.hits, gates: c.arms ? c.arms.length : 0, lights: c.lights ? c.lights.length : 0, built: !!c.root }));
})();
