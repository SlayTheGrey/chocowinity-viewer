/* [CHOCO-L3STAGE3D 2026-10-25] drawing only: show ops-staged trains (ai.stage3, real car lengths) parked on L3 S1-S5 in the 3D viewer.
   Packed end-to-end from the S (departure) end like the 2D [CHOCO-L3DRAW]; a train keeps its track while staged. Ops timing untouched. */
(function () {
  const D = window.LAYOUT; if (!D || !D.l3 || !window.THREE) return;
  const Y = D.deckHeights[D.deckHeights.length - 1] + D.levelSeparation + 0.02; /* L3 deck + rail top */
  const ST = (D.l3.tracks || []).filter(t => /^S\d/.test(t.name)).map(t => { const p = t.pts[0][1] > t.pts[t.pts.length - 1][1] ? t.pts.slice().reverse() : t.pts.slice(); /* d=0 at the S end (high plan y) */
    const q = p[0][1] > p[p.length - 1][1] ? p : p.slice().reverse(); const c = [0]; for (let i = 1; i < q.length; i++) c.push(c[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1])); return { name: t.name, p: q, c, len: c[c.length - 1] }; });
  const at = (S, d) => { d = Math.max(0, Math.min(S.len, d)); let i = 1; while (i < S.c.length - 1 && S.c[i] < d) i++; const a = S.p[i - 1], b = S.p[i], f = (d - S.c[i - 1]) / ((S.c[i] - S.c[i - 1]) || 1); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[1] - a[1], b[0] - a[0])]; };
  const G = new THREE.Group(); G.name = 'choco-l3stage'; const PARK = new Map(), MAT = {}; let added = false, last = -1;
  const isLoco = c => !!(c.loco || c.isLoco || /loco|engine|^(ES44|SD|GP|AC44|ET44)/i.test((c.kind || c.type || c.model || '') + ''));
  const colOf = c => isLoco(c) ? '#c23a2e' : /tank/i.test(c.kind || c.type || '') ? '#2b2d30' : /hopper|cov/i.test(c.kind || c.type || '') ? '#8d8a80' : /well|stack|inter/i.test(c.kind || c.type || '') ? '#d4d0c4' : /box|reef/i.test(c.kind || c.type || '') ? '#7a3b2a' : '#6f6a60';
  const mat = c => MAT[c] || (MAT[c] = new THREE.MeshLambertMaterial({ color: c }));
  function tick() { requestAnimationFrame(tick); const H = window.__ops3d, ai = H && H.ai, sc = window.__choco && window.__choco.scene; if (!ai || !sc) return;
    if (!added) { sc.add(G); added = true; } const now = performance.now(); if (now - last < 500) return; last = now;
    const q3 = ai.stage3 || [], live = new Set(q3); for (const [k, v] of PARK) if (!live.has(k)) { G.remove(v.g); PARK.delete(k); }
    for (const st of q3) { if (PARK.has(st)) continue; const cars = st.cars || [], L = cars.reduce((m, c) => m + (c.len || 3), 0) + 0.2 * cars.length;
      const used = ST.map(S => 1.0 + [...PARK.values()].filter(v => v.S === S).reduce((m, v) => Math.max(m, v.o + v.L), 0));
      let bi = -1; for (let i = 0; i < ST.length; i++) if (used[i] + L <= ST[i].len - 1.0 && (bi < 0 || used[i] < used[bi])) bi = i; if (bi < 0) continue;
      const S = ST[bi], o = used[bi], g = new THREE.Group(); let s = o;
      /* [CHOCO-L3CARS] car-shaped bodies by type (tank / hopper / box / well+stack / gondola / loco), colour variety, ONE merged mesh per train */ const parts = [];
      for (let ci = 0; ci < cars.length; ci++) { const c = cars[ci], l = c.len || 3, m = at(S, s + l / 2), k = ((c.kind || c.type || c.model || '') + '').toLowerCase(), hv = (ci * 7 + (st.tr && st.tr.sym || '').length * 3) % 5;
        const tz = l / 2 - 0.35;
        parts.push({ m, x: tz, y: 0.07, z: 0, sx: 0.36, sy: 0.12, sz: 0.3, col: '#1c1c1c' }, { m, x: -tz, y: 0.07, z: 0, sx: 0.36, sy: 0.12, sz: 0.3, col: '#1c1c1c' });
        const L = l - 0.1; parts.push({ m, x: 0, y: 0.15, z: 0, sx: L, sy: 0.04, sz: 0.36, col: '#2a2a2a' });
        if (isLoco(c)) { const lc = ['#1b1b1b', '#2c3e7a', '#c9a227', '#1b1b1b', '#3d5a40'][hv]; parts.push({ m, x: -0.25, y: 0.38, z: 0, sx: L - 1.2, sy: 0.4, sz: 0.3, col: lc }, { m, x: L / 2 - 0.55, y: 0.44, z: 0, sx: 0.6, sy: 0.52, sz: 0.36, col: lc }, { m, x: L / 2 - 0.55, y: 0.56, z: 0, sx: 0.62, sy: 0.1, sz: 0.37, col: '#202a33' }); }
        else if (/tank/.test(k)) parts.push({ m, x: 0, y: 0.38, z: 0, sx: L - 0.3, sy: 0.36, sz: 0.36, col: ['#2b2d30', '#1f2124', '#d9d9d6', '#2b2d30', '#5b5f63'][hv], cyl: 1 }, { m, x: 0, y: 0.58, z: 0, sx: 0.3, sy: 0.06, sz: 0.2, col: '#3a3a3a' });
        else if (/hopper|cov/.test(k)) parts.push({ m, x: 0, y: 0.36, z: 0, sx: L - 0.2, sy: 0.34, sz: 0.38, col: ['#8d8a80', '#a7a49b', '#6e6b63', '#b9b3a3', '#8a7d6b'][hv] }, { m, x: 0, y: 0.55, z: 0, sx: L - 0.3, sy: 0.08, sz: 0.3, col: '#9a978e' }, { m, x: L * 0.25, y: 0.14, z: 0, sx: 0.4, sy: 0.12, sz: 0.3, col: '#5e5b54' }, { m, x: -L * 0.25, y: 0.14, z: 0, sx: 0.4, sy: 0.12, sz: 0.3, col: '#5e5b54' });
        else if (/well|stack|inter/.test(k)) parts.push({ m, x: 0, y: 0.13, z: 0, sx: L - 0.2, sy: 0.1, sz: 0.38, col: '#3a3d40' }, { m, x: 0, y: 0.3, z: 0, sx: Math.min(L - 0.4, 3.0), sy: 0.26, sz: 0.34, col: ['#c0392b', '#2e6da4', '#d4d0c4', '#3f7f4f', '#8e44ad'][hv] }, { m, x: 0, y: 0.56, z: 0, sx: Math.min(L - 0.4, 3.0), sy: 0.26, sz: 0.34, col: ['#d4d0c4', '#b9770e', '#2e6da4', '#7f8c8d', '#c0392b'][hv] });
        else if (/box|reef/.test(k)) parts.push({ m, x: 0, y: 0.38, z: 0, sx: L - 0.2, sy: 0.42, sz: 0.38, col: /reef/.test(k) ? '#e6e3da' : ['#7a3b2a', '#5d2f22', '#2f4f6f', '#8a5a2b', '#6b6b2f'][hv] }, { m, x: 0, y: 0.6, z: 0, sx: L - 0.2, sy: 0.03, sz: 0.4, col: '#4a4a4a' }, { m, x: 0, y: 0.36, z: 0, sx: 0.45, sy: 0.38, sz: 0.39, col: '#3b3b3b' });
        else parts.push({ m, x: 0, y: 0.3, z: 0, sx: L - 0.2, sy: 0.26, sz: 0.38, col: ['#4a3b30', '#5a5a5a', '#3f4a3a', '#6f4e37', '#2e2e2e'][hv] }, { m, x: 0, y: 0.43, z: 0, sx: L - 0.4, sy: 0.02, sz: 0.3, col: '#1a1a1a' });
        s += l + 0.2; }
      const BX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), CY = new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateZ(Math.PI / 2).toNonIndexed(); const pos = [], nor = [], col = [], mt = new THREE.Matrix4(), mn = new THREE.Matrix3(), v = new THREE.Vector3(), cc = new THREE.Color();
      for (const p of parts) { const G0 = p.cyl ? CY : BX; mt.compose(new THREE.Vector3(p.m[0], Y + p.y, p.m[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.m[2]), new THREE.Vector3(1, 1, 1)).multiply(new THREE.Matrix4().makeTranslation(p.x, 0, p.z)).multiply(new THREE.Matrix4().makeScale(p.sx, p.sy, p.sz)); mn.getNormalMatrix(mt); cc.set(p.col);
        const PA = G0.attributes.position, NA = G0.attributes.normal; for (let i = 0; i < PA.count; i++) { v.fromBufferAttribute(PA, i).applyMatrix4(mt); pos.push(v.x, v.y, v.z); v.fromBufferAttribute(NA, i).applyMatrix3(mn).normalize(); nor.push(v.x, v.y, v.z); col.push(cc.r, cc.g, cc.b); } }
      const GG = new THREE.BufferGeometry(); GG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); GG.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); GG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const mesh = new THREE.Mesh(GG, MAT.vc || (MAT.vc = new THREE.MeshLambertMaterial({ vertexColors: true }))); mesh.castShadow = true; g.add(mesh); g.userData.nCars = cars.length;
      g.userData = { nCars: cars.length, sym: st.tr && st.tr.sym, track: S.name }; G.add(g); PARK.set(st, { g, S, o, L }); }
    window.__l3stage3d = [...PARK.values()].map(v => ({ sym: v.g.userData.sym, track: v.S.name, cars: v.g.userData.nCars, o: +v.o.toFixed(1), L: +v.L.toFixed(1) })); }
  requestAnimationFrame(tick);
})();
