/* [AMBIENCE 2026-10-18] realism pass 2 for the layout3d viewer (shared tool, any plan):
   - Time of day: Day / Evening / Night (Settings > Display, key T, URL ?tod=evening|night). Evening = low warm sun from the west with long shadows,
     dimmer blue room fill; Night = moonlight. Painted backdrop + water sky follow; streetlights glow with a light pool on the road;
     loco headlights get brighter with a beam on the track, road vehicles show head- and tail-lights (ops3d.js reads L3D.ambience.k).
   - Rail colour: rusty brown rail sides, bright railhead (shader tweak on the shared 'rail' material, no extra geometry).
   ?q=low: time of day still works, but no light pools (glows only). */
(function () {
const L3D = window.L3D = window.L3D || {}; const AM = L3D.ambience = { k: 0, mode: 'day' };
let A = null, T = null, base = null, glow = [], pools = [], ceil = [], ptex = null, gtex = null;
const QS = new URLSearchParams(location.search), LOW = QS.get('q') === 'low', KEY = 'layout3d.tod';
const P = {
  day:     { sun: 0xfff4e0, si: 0.62, off: null, hs: 0xfffaf0, hg: 0x6a5a48, hi: 0.62, ai: 0.14, ac: 0xffffff, bg: 0x3a3f45, ceil: 0xffffff, sky: 0xe8e8e8, wt: '#6f95bf', wh: '#c8d8e4', k: 0 },
  evening: { sun: 0xffa060, si: 0.55, off: [-150, 34, -20], hs: 0xd89a80, hg: 0x40344a, hi: 0.34, ai: 0.07, ac: 0x8a96c8, bg: 0x1d2130, ceil: 0x4a4440, sky: 0xd09070, wt: '#5a5f8a', wh: '#e0a070', k: 0.65 },
  night:   { sun: 0x8ea8ff, si: 0.16, off: [-50, 120, 60], hs: 0x5a6a98, hg: 0x1a1a24, hi: 0.2, ai: 0.05, ac: 0x6070a0, bg: 0x090c14, ceil: 0x1c1c22, sky: 0x2a3150, wt: '#1c2440', wh: '#30385a', k: 1 } };
const radial = (stops) => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); for (const [o, c] of stops) gr.addColorStop(o, c); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(cv); return t; };
AM.todAt = function (t) { const h = typeof t === 'number' ? t / 3600 : (+String(t).split(':')[0]) + (+(String(t).split(':')[1] || 0)) / 60; return h >= 6.5 && h < 18.5 ? 'day' : (h >= 18.5 && h < 20) || (h >= 5.75 && h < 6.5) ? 'evening' : 'night'; };
AM.init = function (api) { A = api; T = window.THREE;
  base = { sunOff: A.sun.position.clone().sub(A.sun.target.position) };
  railRust();
  gtex = radial([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,236,190,0.9)'], [0.5, 'rgba(255,210,140,0.25)'], [1, 'rgba(255,200,120,0)']]);
  ptex = radial([[0, 'rgba(255,214,150,0.55)'], [0.55, 'rgba(255,200,130,0.22)'], [1, 'rgba(255,190,120,0)']]);
  A.LV.forEach(o => lamps(o)); ceiling();
  let m = QS.get('tod'); if (!P[m] && QS.get('time')) m = AM.todAt(QS.get('time'));   // [RV3] ?time=HH:MM picks the lighting when no explicit ?tod
  if (!P[m]) { try { m = localStorage.getItem(KEY); } catch (e) {} } AM.set(P[m] ? m : 'day', true);
  const sel = document.getElementById('tod'); if (sel) { sel.value = AM.mode; sel.onchange = () => { AM.set(sel.value); sel.blur(); }; }
  addEventListener('keydown', e => { if (e.code !== 'KeyT' || /input|select|textarea/i.test(e.target.tagName || '') || e.ctrlKey || e.metaKey) return; AM.set({ day: 'evening', evening: 'night', night: 'day' }[AM.mode]); });
};
AM.sunOff = () => { const p = P[AM.mode]; return p.off ? new T.Vector3(...p.off).normalize().multiplyScalar(base.sunOff.length()) : base.sunOff.clone(); };
AM.set = function (m, boot) { const p = P[m]; if (!p || !A) return; AM.mode = m; AM.k = p.k; if (!boot) { try { localStorage.setItem(KEY, m); } catch (e) {} }
  A.sun.color.setHex(p.sun); A.sun.intensity = p.si; A.sun.position.copy(A.sun.target.position).add(AM.sunOff()); A.sun.target.updateMatrixWorld();
  if (A.hemi) { A.hemi.color.setHex(p.hs); A.hemi.groundColor.setHex(p.hg); A.hemi.intensity = p.hi; } if (A.amb) { A.amb.intensity = p.ai; A.amb.color.setHex(p.ac); }
  A.scene.background = new T.Color(p.bg); if (L3D.MAT && L3D.MAT.skyb) L3D.MAT.skyb.color.setHex(p.sky);
  for (const o of A.LV) { const w = o.waterMesh && o.waterMesh.material && o.waterMesh.material.uniforms; if (w && w.skyTop) { w.skyTop.value.set(p.wt); w.skyHor.value.set(p.wh); if (w.sunDir) { o._sd0 = o._sd0 || w.sunDir.value.clone(); if (p.off) w.sunDir.value.copy(AM.sunOff()).normalize(); else w.sunDir.value.copy(o._sd0); } } }
  for (const m of ceil) m.material.color.setHex(p.ceil); for (const g of glow) g.visible = p.k > 0.3; for (const q of pools) { q.visible = p.k > 0.3; q.material.opacity = p.k; }
  const sel = document.getElementById('tod'); if (sel) sel.value = m; if (A.renderer.shadowMap.autoUpdate === false) A.renderer.shadowMap.needsUpdate = true; };
AM.update = function () {};
function ceiling() {   // the room's ceiling light panels dim with the time of day (own material copy; signals keep the shared emissive one)
  const em = L3D.mat && L3D.mat('emis'); if (!em) return; let mc = null;
  A.scene.traverse(m => { if (!m.isMesh || m.material !== em || !m.geometry) return; m.geometry.computeBoundingBox(); if (m.geometry.boundingBox.min.y < 80) return; mc = mc || em.clone(); m.material = mc; ceil.push(m); }); }
function lamps(o) {   // streetlight heads: the cobra head hangs 0.4 in out over the road at 1.86 in
  const L = o.L.lamps || []; if (!L.length) return; const pos = [], pool = [];
  for (const p of L) { let a = 0, bd = 1e9; for (const rd of o.L.roads || []) for (let j = 0; j + 1 < rd.pts.length; j++) { const A0 = rd.pts[j], B0 = rd.pts[j + 1], dx = B0[0] - A0[0], dz = B0[1] - A0[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - A0[0]) * dx + (p[1] - A0[1]) * dz) / l2)), qx = A0[0] + dx * t, qz = A0[1] + dz * t, d = Math.hypot(qx - p[0], qz - p[1]); if (d < bd) { bd = d; a = Math.atan2(qz - p[1], qx - p[0]); } }
    const hx = p[0] + Math.cos(a) * 0.4, hz = p[1] + Math.sin(a) * 0.4, gy = o.deck + (o.terrain ? Math.max(0, o.terrain.h(hx, hz)) : 0); pos.push(hx, o.deck + 1.83, hz); pool.push([hx, gy + 0.03, hz]); }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  const pts = new T.Points(g, new T.PointsMaterial({ map: gtex, size: 0.5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0xffe2b0 })); pts.visible = false; pts.renderOrder = 4; o.g.add(pts); glow.push(pts);
  if (LOW) return;
  const im = new T.InstancedMesh(new T.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ map: ptex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, color: 0xffd8a0, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -4 }), pool.length);
  const m4 = new T.Matrix4(); pool.forEach((q, i) => { m4.makeTranslation(q[0], q[1], q[2]); im.setMatrixAt(i, m4); }); im.visible = false; im.renderOrder = 3; o.g.add(im); pools.push(im); }
function railRust() {   // sides of the rail rust brown, the polished head stays steel (object normal of the merged track batch = world normal)
  const m = L3D.mat && L3D.mat('rail'); if (!m || m.userData.rust) return; m.userData.rust = true;
  m.onBeforeCompile = sh => { sh.vertexShader = 'varying float vRust;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vRust = 1.0 - smoothstep(0.5, 0.85, abs(objectNormal.y));');
    sh.fragmentShader = 'varying float vRust;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.23, 0.16), vRust * 0.78);'); };
  m.customProgramCacheKey = () => 'rail-rust'; m.needsUpdate = true; }
})();
