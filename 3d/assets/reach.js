/* layout3d REACH simulator. Person (stature, standing/seated, seat height) + arm length (shoulder->fingertip) + lean allowance ->
   per-target class: comfortable (green, <= 0.9 x arm, no lean), stretch (yellow, needs lean <= allowance), out of reach (red).
   The arm path is blocked by the L2 deck slab (+ brackets/valance) when reaching L1 under the overhang; leaning lowers/advances the shoulder.
   Viewer: translucent envelope on the deck surfaces from the current position, coloured rings on turnouts / uncoupling spots / structures,
   'reach here' test (key R or Reach-test button: screen centre in walk mode, last click otherwise) with a simple 3D arm. Headless: L3D.reach.score(). */
'use strict';
(function (L3D) {
const RS = L3D.reach = { cfg: { arm: 31, lean: 8, comfy: 0.9, shoulderStand: 0.818, shoulderSeat: 0.335, showEnv: false }, ctx: null };
const STORE = 'layout3d.reach';
try { const st = JSON.parse(localStorage.getItem(STORE) || '{}'); delete st.showEnv; Object.assign(RS.cfg, st); } catch (e) {} /* overlay always starts off; Shift+R or ?reach=1 */
const q = new URLSearchParams(location.search); for (const k of ['arm', 'lean']) if (q.get(k)) RS.cfg[k] = +q.get(k); RS.cfg.showEnv = q.get('reach') === '1';
// person -> shoulder height (in, above floor)
RS.shoulderY = (P) => P.pose === 'stand' ? P.h * RS.cfg.shoulderStand : P.seat + P.h * RS.cfg.shoulderSeat;
// slabs that block an arm: upper decks over lower ones (deck top .. underside incl. brackets/valance ~1 in)
function slabs(LV) { const S = []; for (const o of LV) { const thick = o.L.id === 1 ? 4.75 : 2.75; /* foam update */ for (const r of o.L.boards) S.push({ r, y0: o.deck - thick - 1.0, y1: o.deck + 0.3, lv: o.L.id }); } return S; }
function blocked(S, a, b, lvT) { const n = 24; for (let i = 1; i < n; i++) { const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
  for (const s of S) { if (s.lv === lvT && t > 0.85) continue; if (y > s.y0 && y < s.y1 && x > s.r[0] && x < s.r[2] && z > s.r[1] && z < s.r[3]) return true; } } return false; }
// classify reaching target T=[x,y,z] (y = surface + 0.5 in grip) from shoulder S=[x,y,z]
RS.classify = (S, T, lvT, Sl) => { const arm = RS.cfg.arm, d = Math.hypot(T[0] - S[0], T[1] - S[1], T[2] - S[2]);
  if (d <= arm * RS.cfg.comfy && !blocked(Sl, S, T, lvT)) return { c: 0, d };
  const hx = T[0] - S[0], hz = T[2] - S[2], hl = Math.hypot(hx, hz) || 1, L = RS.cfg.lean;
  for (const f of [0.5, 1]) { const S2 = [S[0] + hx / hl * L * f, S[1] - L * 0.6 * f, S[2] + hz / hl * L * f]; const d2 = Math.hypot(T[0] - S2[0], T[1] - S2[1], T[2] - S2[2]); if (d2 <= arm && !blocked(Sl, S2, T, lvT)) return { c: 1, d, lean: L * f }; }
  return { c: 2, d, blocked: d <= arm + L && blocked(Sl, S, T, lvT) }; };
const COL = [new THREE.Color('#2ecc40'), new THREE.Color('#ffcc00'), new THREE.Color('#ff3b30')], NAME = ['reachable', 'stretch (lean)', 'out of reach'];
// targets: turnouts (points), uncoupling spots [derived: spur clearance point + mid-spur industry spot], structures (front centre)
RS.targets = (LV) => { const out = []; for (const o of LV) { const L = o.L, h = (x, z) => o.terrain ? o.terrain.h(x, z) : 0;
  L.turnouts.forEach((t, i) => out.push({ kind: 'turnout', name: ((L.labels || []).find(l => l.kind === 'turnout' && Math.hypot(l.x - t.thr[0][0], l.y - t.thr[0][1]) < 0.5) || {}).text || `L${L.id} TO ${i + 1} ${t.part || ''}`, x: t.thr[0][0], z: t.thr[0][1], lv: L.id, y: o.deck + 0.3 }));
  L.tracks.filter(t => t.type === 'spur').forEach((t, i) => { const R = L3D.resample(t.pts, 0.5), n = R.length; if (n < 4) return; for (const [f, w] of [[Math.min(n - 1, 8), 'clearance'], [Math.floor(n / 2), 'industry spot']]) out.push({ kind: 'uncouple', name: `L${L.id} spur ${i + 1} ${w} [derived]`, x: R[f][0], z: R[f][1], lv: L.id, y: o.deck + 0.3 }); });
  L.structures.filter(s => s.h > 0.5).forEach(s => out.push({ kind: 'structure', name: s.name || s.kind, x: (s.r[0] + s.r[2]) / 2, z: (s.r[1] + s.r[3]) / 2, lv: L.id, y: o.deck + h((s.r[0] + s.r[2]) / 2, (s.r[1] + s.r[3]) / 2) + Math.min(s.h, 1.5) })); } return out; };
// headless scoring: for each target, best standing/sitting position in the aisle (walkFree grid within 40 in)
RS.score = (opts = {}) => { const C = RS.ctx; if (!C) return { error: 'reach not initialised' }; const P = C.PERSON, Sl = slabs(C.LV), sy = RS.shoulderY(P), T = RS.targets(C.LV), res = [];
  const cand = []; const R = C.ROOM; for (let x = R[0] + 6; x < R[2] - 6; x += 2) for (let z = R[1] + 6; z < R[3] - 6; z += 2) if (C.walkFree(x, z)) cand.push([x, z]);
  for (const t of T) { let best = { c: 3, d: 1e9 }; for (const c of cand) { const dd = Math.hypot(c[0] - t.x, c[1] - t.z); if (dd > 45) continue; const r = RS.classify([c[0], sy, c[1]], [t.x, t.y, t.z], t.lv, Sl); if (r.c < best.c || (r.c === best.c && r.d < best.d)) best = Object.assign(r, { at: c }); }
    res.push({ kind: t.kind, name: t.name, lv: t.lv, x: +t.x.toFixed(1), z: +t.z.toFixed(1), cls: best.c === 3 ? 'out of reach' : NAME[best.c], dist: +best.d.toFixed(1), lean: best.lean || 0, blockedByL2: !!best.blocked, standAt: best.at && best.at.map(v => +v.toFixed(0)) }); }
  const sum = {}; for (const r of res) { const k = r.kind; sum[k] = sum[k] || { reachable: 0, 'stretch (lean)': 0, 'out of reach': 0 }; sum[k][r.cls]++; }
  return { person: { stature_in: P.h, pose: P.pose, seat_in: P.pose === 'stand' ? null : P.seat, shoulder_in: +sy.toFixed(1), arm_in: RS.cfg.arm, lean_in: RS.cfg.lean, comfortable_fraction: RS.cfg.comfy }, summary: sum, targets: res }; };
// -------- viewer side
RS.init = (C) => { RS.ctx = C; const { scene, camera, LV } = C; RS.sl = slabs(LV); RS.T = RS.targets(LV);
  const ui = document.getElementById('reachslot') || document.getElementById('ui'); const old = document.getElementById('reachrow'); if (old) old.remove(); /* no duplicate rows on re-init */ if (ui) { const row = document.createElement('div'); row.className = 'row'; row.id = 'reachrow';
    row.innerHTML = `Reach: <label><input type="checkbox" id="rch" ${RS.cfg.showEnv ? 'checked' : ''}>envelope [Shift+R]</label> arm <input id="rarm" type="number" min="20" max="40" step="0.5" value="${RS.cfg.arm}" style="width:46px">in lean <input id="rlean" type="number" min="0" max="16" step="1" value="${RS.cfg.lean}" style="width:38px">in <button id="rtest">Reach here [R]</button> <span id="rread"></span>`;
    ui.appendChild(row); const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ arm: RS.cfg.arm, lean: RS.cfg.lean, showEnv: RS.cfg.showEnv })); } catch (e) {} RS.dirty = true; };
    row.querySelector('#rch').onchange = e => { RS.cfg.showEnv = e.target.checked; save(); }; row.querySelector('#rarm').oninput = e => { RS.cfg.arm = +e.target.value || 31; save(); }; row.querySelector('#rlean').oninput = e => { RS.cfg.lean = +e.target.value || 0; save(); };
    row.querySelector('#rtest').onclick = () => RS.test(); }
  RS.grp = new THREE.Group(); RS.grp.name = 'reach'; scene.add(RS.grp);
  // envelope grids (1 in) on every deck, recoloured on move
  RS.env = LV.map(o => { const pts = []; for (const r of o.L.boards) for (let x = r[0] + 0.5; x < r[2]; x += 1) for (let z = r[1] + 0.5; z < r[3]; z += 1) pts.push([x, o.deck + (o.terrain ? Math.max(0, o.terrain.h(x, z)) : 0) + 0.06, z]);
    const g = new THREE.BufferGeometry(), pos = new Float32Array(pts.length * 3), colr = new Float32Array(pts.length * 3); pts.forEach((p, i) => pos.set(p, i * 3)); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }) /* additive: black = invisible */); m.renderOrder = 3; RS.grp.add(m); return { o, pts, g, m }; });
  // target rings
  const ring = new THREE.RingGeometry(0.45, 0.62, 20).rotateX(-Math.PI / 2); RS.rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), RS.T.length); RS.rings.frustumCulled = false; RS.rings.renderOrder = 4; RS.grp.add(RS.rings);
  const M = new THREE.Matrix4(); RS.T.forEach((t, i) => { M.makeTranslation(t.x, t.kind === 'structure' ? t.y - Math.min(1.5, t.y) + t.y * 0 : t.y, t.z); RS.rings.setMatrixAt(i, M.makeTranslation(t.x, (t.kind === 'structure' ? C.LV.find(o => o.L.id === t.lv).deck : t.y) + 0.08, t.z)); RS.rings.setColorAt(i, COL[2]); });
  // arm visual
  const am = new THREE.MeshLambertMaterial({ color: 0xd9b08c }); RS.arm = new THREE.Group(); RS.up = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1, 10), am); RS.fo = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 1, 10), am); RS.hand = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), am); RS.arm.add(RS.up, RS.fo, RS.hand); RS.arm.visible = false; scene.add(RS.arm);
  C.renderer.domElement.addEventListener('pointerdown', e => { const r = C.renderer.domElement.getBoundingClientRect(); RS.mouse = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); });
  window.addEventListener('keydown', e => { if (e.code === 'KeyR' && !/INPUT|SELECT/.test((e.target || {}).tagName || '')) { if (e.shiftKey) { RS.cfg.showEnv = !RS.cfg.showEnv; RS.dirty = true; const cb = document.getElementById('rch'); if (cb) cb.checked = RS.cfg.showEnv; } else if (RS.cfg.showEnv) RS.test(); } });
  RS.dirty = true; RS.last = new THREE.Vector3(1e9, 0, 0); RS.t = 0; };
RS.shoulder = () => { const C = RS.ctx, cam = C.camera, walk = C.getMode() === 'walk'; const sy = RS.shoulderY(C.PERSON); if (walk) { const f = new THREE.Vector3(); cam.getWorldDirection(f); f.y = 0; f.normalize(); return [cam.position.x + f.x * 2, sy, cam.position.z + f.z * 2]; }
  return RS.anchor || null; };
RS.update = (dt) => { if (!RS.ctx) return; RS.t += dt; const C = RS.ctx; RS.grp.visible = RS.cfg.showEnv; if (!RS.cfg.showEnv || RS.t < 0.4) return; RS.t = 0;
  let S = RS.shoulder(); if (!S) { // orbit mode: anchor = aisle point nearest to the orbit target
    const tg = C.target(); let b = null, bd = 1e9; for (let a = 0; a < 6.283; a += 0.2) for (const r of [10, 16, 22, 30, 40]) { const x = tg.x + Math.cos(a) * r, z = tg.z + Math.sin(a) * r; if (C.walkFree(x, z)) { const d = r; if (d < bd) { bd = d; b = [x, z]; } } } if (!b) return; S = [b[0], RS.shoulderY(C.PERSON), b[1]]; }
  const key = S.map(v => v.toFixed(0)).join() + RS.cfg.arm + RS.cfg.lean + C.PERSON.h + C.PERSON.pose + C.PERSON.seat; if (key === RS.key && !RS.dirty) return; RS.key = key; RS.dirty = false; RS.S = S;
  for (const E of RS.env) { const c = E.g.attributes.color.array; E.pts.forEach((p, i) => { const dh = Math.hypot(p[0] - S[0], p[2] - S[2]); let k; if (dh > RS.cfg.arm + RS.cfg.lean + 2) k = null; else k = RS.classify(S, [p[0], p[1] + 0.5, p[2]], E.o.L.id, RS.sl).c; const cc = k == null || k === 2 ? null : COL[k]; /* only comfortable+stretch drawn; red shown on rings */ if (!cc) { c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0; } else { c[i * 3] = cc.r; c[i * 3 + 1] = cc.g; c[i * 3 + 2] = cc.b; } });
    E.g.attributes.color.needsUpdate = true; }
  const cnt = [0, 0, 0]; RS.T.forEach((t, i) => { const r = RS.classify(S, [t.x, t.y + 0.5, t.z], t.lv, RS.sl); cnt[r.c]++; RS.rings.setColorAt(i, COL[r.c]); }); RS.rings.instanceColor.needsUpdate = true;
  const rr = document.getElementById('rread'); if (rr) rr.textContent = `shoulder ${S[1].toFixed(1)} in · targets ${cnt[0]} green / ${cnt[1]} yellow / ${cnt[2]} red`; };
RS.test = () => { const C = RS.ctx; if (!C) return; const rc = new THREE.Raycaster(); rc.setFromCamera(C.getMode() === 'walk' || !RS.mouse ? new THREE.Vector2(0, 0) : RS.mouse, C.camera);
  const hits = rc.intersectObjects(C.LV.map(o => o.g), true).filter(h => h.object.visible && h.object.type !== 'Points'); if (!hits.length) return; const T = hits[0].point, lv = (C.LV.find(o => o.g === (function up(ob) { return ob.parent && ob.parent.type !== 'Scene' ? up(ob.parent) : ob; })(hits[0].object)) || C.LV[0]).L.id;
  const S = RS.S || RS.shoulder() || [T.x, RS.shoulderY(C.PERSON), T.z + 20]; const r = RS.classify(S, [T.x, T.y, T.z], lv, RS.sl), arm = RS.cfg.arm;
  // arm: shoulder -> elbow -> hand (2-bone, elbow drops), reaching as far as it can toward T
  const s = new THREE.Vector3(...S), t = new THREE.Vector3(T.x, T.y, T.z), dir = t.clone().sub(s), d = dir.length(); dir.normalize(); const reachD = Math.min(d, arm + (r.c === 1 ? r.lean || 0 : 0)), hnd = s.clone().addScaledVector(dir, reachD - 1.5);
  const half = arm * 0.48, mid = s.clone().lerp(hnd, 0.5), sag = Math.sqrt(Math.max(0, half * half - (s.distanceTo(hnd) / 2) ** 2)); const el = mid.clone().add(new THREE.Vector3(0, -sag, 0));
  const seg = (m, a, b) => { m.position.copy(a).lerp(b, 0.5); m.scale.set(1, a.distanceTo(b), 1); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); };
  seg(RS.up, s, el); seg(RS.fo, el, hnd); RS.hand.position.copy(hnd); RS.arm.visible = C.getMode() === 'walk'; /* [R36] arm overlay only in walk; it drew pale spikes in orbit/fly shots */ RS.hand.material.color.copy(COL[r.c]).lerp(new THREE.Color(0xd9b08c), 0.5);
  const msg = `Reach here: ${d.toFixed(1)} in from shoulder (arm ${arm} in) → ${NAME[r.c]}${r.lean ? ', lean ' + r.lean.toFixed(0) + ' in' : ''}${r.blocked ? ', arm path blocked by upper deck' : ''}`; const rr = document.getElementById('rread'); if (rr) rr.textContent = msg; RS.lastTest = { d, cls: NAME[r.c], msg }; return RS.lastTest; };
})(window.L3D);
