/* External .glb overrides (e.g. Grok Build). check_external_assets.py validates assets/external/<id>.glb and writes
   assets/external-data.js: L3D.EXT_DATA[id] = { b64, s (uniform scale -> inches), rx (up-axis fix, radians), off [x,y,z] (inches, after scale), status }.
   Embedded base64 keeps file:// working. L3D.ext.load() parses them before viewer.js runs; procedural assets are the fallback. */
'use strict';
(function (L3D) {
const E = L3D.ext = { scenes: {}, has: id => !!E.scenes[id] && !E.OFF.has(id) };
/* [REALISM 2026-10-19] likeness audit: glbs that scored 1-2 against prototype photos and are beaten by the rebuilt procedural model in likeness.js.
   E.has() reports them as absent, so every caller uses the procedural version; prune_ext then drops them from the package. Grok redo prompts:
   (build path) Delete an id here once its redo glb is ingested. */
E.OFF = new Set(['horse', 'horse-grazing', 'horse-rider', 'person-stand', 'person-walk', 'person-worker', 'person-farmer', 'person-sit',
  /* [RV2 R13] Blender trees now live */
  'veh-sedan', 'veh-suv', 'veh-pickup', 'veh-tractor', 'relay-hut' /* REAL1: ext was a tall block hut w/ green gable; procedural galvanized bungalow is truer */, 'ballast-pile' /* REAL1: ext faces inverted (invisible from above) + near-black */]);
/* Per-asset overrides (registry). rotationY: radians about Y after import; axis: 'swapXZ' (model built with facade along Z);
   front: 'long' = facade goes on a long side of the plan footprint (facing the nearest road), 'any' = nearest-road side (default), 'track' = side nearest a track;
   fit: 'auto' (default: keep true scale unless >40% off), 'width' (scale so facade width = footprint width), 'none';
   doubleSided: material names to render two-sided; roofCap: add a flat roof + parapet if the file has no visible roof. */
E.OVR = Object.assign({
  'gen-house': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, true prototype size; placed at native size only (never stretched)' },
'walthers-933-3855': { mode: 'inst', fit: 'stretch', /* [R33] glb is 10.67 x 2.01; stretched to the 10.2 x 1.76 plan so the dock face sits on the rect edge (overhung W-2 by 0.07) */ front: 'track', rotationY: Math.PI, note: '[RV3] Blender (structs.alb3855): kit 10.5 in long x 2.203 in high, cut to the 1.76 in plan depth; rail doors on the back (-Z) face the siding' },
'load-dump-shed': { mode: 'inst', fit: 'native', front: 'any', note: '[RV3] Blender (structs.dumpshed): scratch 3.0 x 1.5 in drive-through shed, 4.6 m clear; native size' },
'load-guard-shack': { mode: 'inst', fit: 'native', front: 'any', note: '[RV3] Blender (structs.guardshack): 1 x 1 in island with booth + raised gate arm; native size' },
'gen-store': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, true prototype size; placed at native size only (never stretched)' },
'gen-office': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, true prototype size; placed at native size only (never stretched)' },
'gen-warehouse': { fit: 'native', front: 'any', note: '[RV2] Blender round 12, true prototype size; placed at native size only (never stretched); cloned so door_N animate' },
'gen-plant': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, true prototype size; placed at native size only (never stretched)' },
'gen-barn': { fit: 'native', front: 'any', note: '[RV2] Blender round 12, true prototype size; placed at native size only (never stretched); cloned so door_N animate' },
'gen-church': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'gen-shed': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'gen-station': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'gen-gin': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'gen-silo': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'gen-tanks': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'gen-watertower': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'gen-minor': { mode: 'inst', fit: 'native', front: 'any', note: '[RV2] Blender round 12, native size' },
'dpm-50200': { fit: 'auto', keepOrigin: true, note: 'Grok batch6: 66.8 x 42.4 x 100.5 mm (rear/front extras beyond 82.8 mm body)' },
'isle-grain-bins': { fit: 'auto', keepOrigin: true, note: 'Grok batch6: 45.7 mm bin, bbox 53.3 x 63.2 x 54.5 mm with ladder/door; origin = bin centre' },
  'walthers-933-3860': { fit: 'auto', front: 'track', rotationY: Math.PI, padZ: [-1.575, 1.575], note: '[RV2 R16] clone (keeps the rigged spout node); centred on the 80 mm body; the spout is on the -glTF Z (track) side' }, 'walthers-933-3862': { fit: 'cut', cutBody: ['z', -4.83, 2.62], front: 'long', note: '[RV2] true-size kit with a middle depth section removed (shelf is 5.8 in deep); rail + truck faces kept' }, 'walthers-933-3856-bay': { front: 'track', face: 'trackLong', fit: 'none', keepOrigin: true, note: '[R28 item 5] PSP crane bay to the plan footprint: ST Steel bay spur inside along the -Y (facade) wall, rail portal in the +X end, bridge crane + magnet' },
  'walthers-933-3200': { front: 'track', face: 'trackLong', fit: 'none', keepOrigin: true, note: '[R28] rack re-laid: track CL on the -Y/facade side 1.05 m off the origin, deck beside the car' },
  'walthers-933-3864': { front: 'track', face: 'trackLong', fit: 'none', rotationY: Math.PI, keepOrigin: true, note: '[R28 Allied] file origin = building centre (front stair / rail dock overhang must not shift it); truck docks on the -X end, rail dock + doors on the back (-Z)' },
  'walthers-933-3863': { fit: 'none', front: 'long', keepOrigin: true, note3: '[R30] cut BAKED into the glb (rv3/ups/bake_cut.py, 12 -> 8 in): clip planes left a ghost half that could show on the track', note2: '[RV2] owner cut: true-size GLB with the 4 in middle section removed (clip planes), never squashed', note: 'B04 v3 (Oct 15 batch3): exact kit footprint 304.8 x 81 x 165.1 mm, centred; prev v2 in external/originals' },
  'tree-pine': { mode: 'parts', unitH: true }, 'tree-oak': { mode: 'parts', unitH: true }, 'tree-maple': { mode: 'parts', unitH: true }, 'tree-sweetgum': { mode: 'parts', unitH: true }, 'tree-young': { mode: 'parts', unitH: true }, 'tree-cedar': { mode: 'parts', unitH: true }, 'tree-oak-live': { mode: 'parts', unitH: true }, 'tree-cypress': { mode: 'parts', unitH: true }, 'tree-longleaf': { mode: 'parts', unitH: true },
  'veh-sedan': { mode: 'parts' }, 'loco-et44': { mode: 'parts', rs: true }, 'loco-et44-csx': { mode: 'parts', rs: true, base: 'loco-et44', rr: 'CSX', note: 'Grok batch6 (Oct 16): CSX ET44AH, rigged; used for CSX ET44 units via E.rsId' }, 'loco-sd70': { mode: 'parts', rs: true }, 'car-boxcar': { mode: 'parts', rs: true }, 'car-covered_hopper': { mode: 'parts', rs: true }, 'car-hopper': { mode: 'parts', rs: true }, 'loco-gp38': { mode: 'parts', rs: true },
  'car-reefer': { mode: 'parts', rs: true }, 'car-tank': { mode: 'parts', rs: true }, 'car-autorack': { mode: 'parts', rs: true }, 'car-coil': { mode: 'parts', rs: true }, 'loco-gp15': { mode: 'parts', rs: true }, 'loco-es44': { mode: 'parts', rs: true },
  /* [VARIANT-HOOK] grok-sim batches 8-9 rolling stock (rigged) */ 'loco-gp38-ns': { mode: 'parts', rs: true, base: 'loco-gp38' }, 'loco-gp40': { mode: 'parts', rs: true }, 'loco-sd40': { mode: 'parts', rs: true }, 'loco-p42': { mode: 'parts', rs: true }, 'loco-sd70-ns': { mode: 'parts', rs: true, base: 'loco-sd70' }, 'loco-sd70-up': { mode: 'parts', rs: true, base: 'loco-sd70' }, 'loco-mp15': { mode: 'parts', rs: true }, 'car-amfleet': { mode: 'parts', rs: true }, 'car-well': { mode: 'parts', rs: true }, 'car-centerbeam': { mode: 'parts', rs: true }, 'car-gondola': { mode: 'parts', rs: true }, 'car-flat': { mode: 'parts', rs: true }, 'car-covered_hopper-g3250': { mode: 'parts', rs: true, base: 'car-covered_hopper' }, 'car-tank-gbrx': { mode: 'parts', rs: true, base: 'car-tank' }, 'car-boxcar-c60': { mode: 'parts', rs: true, base: 'car-boxcar' },
  /* [TILE-HOOK] path sections (E.tile) + glb-only props: a mode keeps L3D.geo() on the procedural geometry for scattered bushes / fallbacks */
  'fence-board': { mode: 'tile' }, 'fence-chain': { mode: 'tile' }, 'fence-wire': { mode: 'tile' }, 'hedge': { mode: 'tile' }, 'pier': { mode: 'tile', note: 'Y=0 = pile bottoms, deck top ~7 mm (0.276 in)' }, 'loading-dock': { mode: 'tile' },
  'load-coil-rack': { mode: 'prop' }, 'load-container-53': { mode: 'prop' }, 'struct-autorack-adjustable-ramp': { mode: 'prop', note: 'car end (bridge plate) at -Z; autoramp.js / rev4 RVD-ramp turn it 180 deg' },
  'veh-pickup': { mode: 'parts' }, 'veh-ups': { mode: 'parts', noTint: true }, 'veh-semi': { mode: 'parts' }, 'tree-maple': { mode: 'parts', unitH: true },
  'ws-br4956': { front: 'any', fit: 'auto', keepOrigin: true, note: 'Grok batch4 (Oct 15): diner 61 mm deep; pylon sign at -X makes bbox 83 mm wide; origin = diner centre; shell emissive removed' },
  'walthers-933-3891': { front: 'long', fit: 'auto', note: 'Grok batch4 v2: 161.3 x 37.5 x 77.8 mm; mirrored sign UVs flipped in file' },
  'kitbash-polymers': { front: 'long', fit: 'auto', note: 'batch4: 355.9 x 137.2 x 75.9 mm; front long so the 14 in silo row runs along the long side of the plan footprint (was placed rotated and shrunk to 25%)' }, 'walthers-933-3265': { front: 'long', fit: 'auto' }, 'walthers-933-3233': { front: 'long', fit: 'auto' },
  'walthers-933-3858': { front: 'short', fit: 'auto', roofCap: false, note: 'Grok Build church: Y-up, X = gable front (3.6 in), steeple at +Z (street front), slate roof present' },
  'walthers-933-3224': { front: 'long', fit: 'auto', padZ: [-1.777, 1.723], note2: '[RV2] body = kit 3.5 in deep; turret bays/awnings overhang the plan sidewalk' },
  'walthers-933-3240': { front: 'track', fit: 'auto', note: 'grok-sim batch1 (ingest7 2026-10-17): bay window + RIVERTON boards; TRACK side is +Z, so the facade faces the nearest track, not the road' },
  'walthers-933-3851': { front: 'long', fit: 'auto', keepOrigin: true, note: 'Grok Merchants Row III (Oct 14 23:09): 167.5 x 88.8 (chimneys) x 139.9 mm incl. rear fire stair; origin = building centre' },
  'walthers-933-3850': { front: 'long', fit: 'auto', doubleSided: ['tar_roof'], roofCap: 'auto', note: 'Grok Build export: X = facade (192.5 mm), +Z = street front, tar_roof plane at 63 mm faces down' },
  /* [INGEST batch8 2026-10-18] keep the prompt origin = placement point instead of the bbox re-centre done by check_external_assets.py */
  'crossing-gate': { keepOrigin: true, note: 'origin = mast base; the arm makes the bbox 21.5 mm off-centre' }, 'streetlight': { keepOrigin: true, note: 'origin = pole base; mast arm shifts bbox 5.5 mm' },
  'person-sit': { keepOrigin: true, note: 'INGEST batch8 addendum: seated figure, origin = between the feet (fit() would re-centre on the bbox, pushing the feet forward off the bench)' },
  /* [CAR-VARIANT-HOOK 2026-10-19] road/owner variants of the 60 ft boxcar for the next batch: picked by E.rsId(type, null, rr, len) when the glb is ingested */
  'car-boxcar-c60-csx': { mode: 'parts', rs: true, base: 'car-boxcar-c60', rr: 'CSX' }, 'car-boxcar-c60-ttx': { mode: 'parts', rs: true, base: 'car-boxcar-c60', rr: 'TTX' },
  'horse': { keepOrigin: true }, 'horse-grazing': { keepOrigin: true }, 'horse-rider': { keepOrigin: true }, 'spanish-moss': { keepOrigin: 'xyz', note: 'origin = top attach point (Y=0), drape hangs below' },
}, L3D.EXT_OVR || {});
/* REAL1 likeness colour corrections (ext textures too saturated vs the prototype): grade: [saturation, contrast] applied to the base-colour texture once at parse */
for (const [k, g] of Object.entries({ 'hay-bale': [0.55, 0.6, 1.25], 'hay-bale-stack': [0.55, 0.6, 1.3] })) E.OVR[k] = Object.assign({}, E.OVR[k] || {}, { grade: g });
E.grade = (mt, [sat, con, gain = 1]) => { const im = mt.map && mt.map.image; if (!im || !im.width || mt.map.__graded) return; try { const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
  const D = g.getImageData(0, 0, cv.width, cv.height), a = D.data; let mr = 0, mg = 0, mb = 0; const n = a.length / 4; for (let i = 0; i < a.length; i += 4) { mr += a[i]; mg += a[i + 1]; mb += a[i + 2]; } mr /= n; mg /= n; mb /= n;
  for (let i = 0; i < a.length; i += 4) { let r = mr + (a[i] - mr) * con, gg = mg + (a[i + 1] - mg) * con, b = mb + (a[i + 2] - mb) * con; const l = 0.3 * r + 0.59 * gg + 0.11 * b; a[i] = (l + (r - l) * sat) * gain; a[i + 1] = (l + (gg - l) * sat) * gain; a[i + 2] = (l + (b - l) * sat) * gain; }
  g.putImageData(D, 0, 0); mt.map.image = cv; mt.map.needsUpdate = true; mt.map.__graded = true; } catch (e) { console.warn('[layout3d] grade', e); } };
E.ovr = id => E.OVR[id] || {};
function b64ToBuf(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
/* Load: per-asset scripts assets/ext/<id>.js listed in L3D.EXT_INDEX (external-index.js), one at a time, parsed, then the base64 is freed.
   Legacy: a monolithic external-data.js (L3D.EXT_DATA already filled) still works. Missing/failed files -> procedural fallback, never fatal.
   E.status = { want, loaded, missing } for the loading overlay. onProgress(done, total, id) optional. */
E.status = { want: 0, loaded: [], missing: [] }; E.base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^/]*$/, '') : 'assets/';   // ext/ lives next to this file
function loadScript(src) { return new Promise(res => { const s = document.createElement('script'); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); }); }
E.load = async (onProgress) => { L3D.EXT_DATA = L3D.EXT_DATA || {}; const idx = L3D.EXT_INDEX || {}, ids = Object.keys(idx); E.status.want = ids.length;
  if (!THREE.GLTFLoader) { E.status.missing = ids.slice(); return; }
  for (let i = 0; i < ids.length; i++) { const id = ids[i]; onProgress && onProgress(i, ids.length, id);
    if (!L3D.EXT_DATA[id] && !(await loadScript(E.base + 'ext/' + id + '.js'))) { /* [VFIX] parts extracted into sibling/nested folders: try those (window.L3DALT, index.html) */
      let ok = false; for (const u of (window.L3DALT ? window.L3DALT('assets/ext/' + id + '.js') : [])) if (await loadScript(u)) { ok = true; (E.status.alt = E.status.alt || []).push(id); break; }
      if (!ok) { E.status.missing.push(id); continue; } }
    await E.parseAll([id]); if (E.scenes[id]) E.status.loaded.push(id); else E.status.missing.push(id);
    if (L3D.EXT_DATA[id]) L3D.EXT_DATA[id].b64 = null; /* free the base64 string */ }
  const rest = Object.keys(L3D.EXT_DATA).filter(k => !(k in idx)); if (rest.length) await E.parseAll(rest);
  onProgress && onProgress(ids.length, ids.length, ''); };
E.parseAll = (idList) => { const D = L3D.EXT_DATA || {}, ids = idList.filter(k => D[k] && D[k].b64 && D[k].status !== 'reject'); if (!ids.length || !THREE.GLTFLoader) return Promise.resolve();
  const ld = new THREE.GLTFLoader();
  return Promise.all(ids.map(id => new Promise(res => { try { ld.parse(b64ToBuf(D[id].b64), '', g => {
    const d = D[id], inner = new THREE.Group(); inner.add(g.scene); g.scene.rotation.x = d.rx || 0; const ov = E.ovr(id); inner.rotation.y = (ov.rotationY || 0) + (ov.axis === 'swapXZ' ? Math.PI / 2 : 0); inner.scale.setScalar(d.s || 1); const outer = new THREE.Group(); inner.position.set(...(ov.keepOrigin === 'xyz' ? [0, 0, 0] : ov.keepOrigin ? [0, ((d.off || [0, 0, 0])[1]), 0] : (d.off || [0, 0, 0])));   /* keepOrigin 'xyz': the file origin is the attach point (hanging moss: top at Y=0), keep it in all three axes */   /* keepOrigin: the file's origin is already the building centre (sign/ramp overhang must not shift it) */ outer.add(inner);
    { const sl = g.scene.getObjectByName('site_lot'); if (sl && !/[?&]sitelot=1/.test(location.search)) { sl.parent.remove(sl); E.siteLotHidden = (E.siteLotHidden || 0) + 1;   /* [RV2 R15] the layout paves every lot/apron/sidewalk these kits carry: drop site_lot, fit + centre on the body */
      if (!ov.keepOrigin) { outer.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(outer), cc = b.getCenter(new THREE.Vector3()); inner.position.x -= cc.x; inner.position.z -= cc.z; } } }
    if (ov.padZ) inner.position.z = -(ov.padZ[0] + ov.padZ[1]) / 2;   // padZ in file inches (bbox mm / 25.4)   /* [RV2] centre on the kit pad, not on an overhanging spout */
    let roofSeen = false; outer.traverse(m => { if (m.isMesh) for (const mt of [].concat(m.material)) { if (mt.map && mt.color && Math.max(mt.color.r, mt.color.g, mt.color.b) < 0.02) mt.color.setRGB(1, 1, 1); if (ov.grade) E.grade(mt, ov.grade); /* REAL1: glb baseColorFactor stored as 1/255 (3860 elevator rendered black) */ if (mt.metalness != null && !(ov.metal)) { mt.metalness = Math.min(mt.metalness, 0.2); mt.envMapIntensity = 0; } /* no env map in the viewer: full-metal PBR renders black */ if ((ov.doubleSided || []).includes(mt.name)) mt.side = THREE.DoubleSide; if (/roof/i.test(mt.name || '')) roofSeen = true; } });
    if (ov.roofCap === true || (ov.roofCap === 'auto' && !roofSeen)) { outer.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(outer), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3()), t = 0.03;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(sz.x * 0.98, t, sz.z * 0.9), new THREE.MeshLambertMaterial({ color: 0x3a3a3c })); cap.position.set(c.x, bb.max.y - 0.12, c.z); outer.add(cap);
      const pm = new THREE.MeshLambertMaterial({ color: 0x8a4a38 }); for (const [w, dd, x, z] of [[sz.x, t, c.x, bb.min.z + sz.z * 0.05], [sz.x, t, c.x, bb.max.z - sz.z * 0.05], [t, sz.z * 0.9, bb.min.x, c.z], [t, sz.z * 0.9, bb.max.x, c.z]]) { const pp = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, dd), pm); pp.position.set(x, bb.max.y - 0.07, z); outer.add(pp); } }
    outer.traverse(m => { if (m.isMesh) { if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals(); m.castShadow = true; m.receiveShadow = true; } }); E.scenes[id] = outer; console.info('[layout3d] external asset', id); res(); }, e => { console.warn('[layout3d] external asset failed', id, e); res(); }); } catch (e) { console.warn(e); res(); } })));
};
// structures: footprint-local matrix M (x 0..w, z 0..d), model is centred on its footprint -> shift to centre and fit to the plan footprint (uniform in plan, keeps height ratio)
/* [REVIEW1 scale] true-scale guard: a kit glb may only go on a footprint it fits at 1:160. auto: true scale when the plan footprint is within 0.6-1.6x
   of the kit (else it used to be shrunk/grown uniformly -> 3 ft doors); if only the 90-deg turned kit fits it is turned; stretch (generic glbs) only within
   0.8-1.25 per axis. Otherwise E.fitOK says no and the viewer draws the true-scale procedural builder instead. */
E.fitOK = (id, w, d) => { const src = E.scenes[id]; if (!src) return { ok: false }; const ov = E.ovr(id);
  if (ov.fit === 'native') { const sz = E.fbox(src).getSize(new THREE.Vector3()), X = sz.x || 1, Z = sz.z || 1, inb = (a, b) => a >= 0.8 && a <= 1.25 && b >= 0.8 && b <= 1.25;   /* [RV2] generic glb only where its native size fits the plan footprint within 20%; else the parametric builder */
    if (inb(w / X, d / Z)) return { ok: true }; if (inb(w / Z, d / X)) return { ok: true, rot: true }; return { ok: false }; } if (ov.fit === 'cut' || ov.fit === 'none' || ov.fit === 'width' || ov.mode === 'parts' || ov.mode === 'prop') return { ok: true };
  const sz = E.fbox(src).getSize(new THREE.Vector3()), X = sz.x || 1, Z = sz.z || 1;
  if (ov.fit === 'stretch') { const a = w / X, c = d / Z, inb = v => v >= 0.8 && v <= 1.25; return { ok: inb(a) && inb(c) }; }
  const k = Math.min(w / X, d / Z), k2 = Math.min(w / Z, d / X), inr = v => v > 0.6 && v < 1.6;
  if (inr(k) && Math.max(w / X, d / Z) < 2.2) return { ok: true }; if (inr(k2) && Math.max(w / Z, d / X) < 2.2) return { ok: true, rot: true }; return { ok: false }; };
E.fbox = src => { src.updateMatrixWorld(true); const b = new THREE.Box3(); src.traverse(m => { if (!m.isMesh) return; for (let p = m; p; p = p.parent) if (p.name === 'spout') return; b.expandByObject(m); }); return b.isEmpty() ? new THREE.Box3().setFromObject(src) : b; };   // [RV2 R16] fit on the body: a rigged spout swinging over the track is not part of the footprint
E.place = (id, M, P) => { const src = E.scenes[id], o = src.clone(true), bb = E.fbox(src), sz = bb.getSize(new THREE.Vector3()); if (P.rot90) { const t = sz.x; sz.x = sz.z; sz.z = t; }
  const ov = E.ovr(id), k = Math.min(P.w / (sz.x || 1), P.d / (sz.z || 1)), fit = ov.fit === 'none' ? 1 : ov.fit === 'width' ? P.w / (sz.x || 1) : (k > 0.6 && k < 1.6) ? 1 : k;
  const cl = v => Math.max(0.6, Math.min(1.6, v)), S3 = ov.fit === 'cut' ? new THREE.Vector3(Math.min(1, P.w / (sz.x || 1)), 1, Math.min(1, P.d / (sz.z || 1))) /* [UPS] kit cut down at its cut lines: shorten in plan, keep the wall height */ : ov.fit === 'stretch' ? new THREE.Vector3(cl(P.w / (sz.x || 1)), Math.max(0.75, Math.min(1.25, Math.sqrt(cl(P.w / (sz.x || 1)) * cl(P.d / (sz.z || 1))))), cl(P.d / (sz.z || 1))) : new THREE.Vector3(fit, fit, fit);
  if (ov.fit === 'cut') { const lb = bb, c = lb.getCenter(new THREE.Vector3()), ls = lb.getSize(new THREE.Vector3());   /* [RV2] true cut: two clipped true-size halves meet at the cut lines */
    const cb = ov.cutBody, rX = (P.rot90 ? ls.x - P.d : ls.x - P.w), rZ = (P.rot90 ? ls.z - P.w : ls.z - P.d), ax = cb ? cb[0] : rX >= rZ ? 'x' : 'z';
    const lo = cb ? cb[1] : lb.min[ax], hi = cb ? cb[2] : lb.max[ax]; c[ax] = (lo + hi) / 2;   /* [RV2] cutBody = [axis, lo, hi]: the kit body span (a moulded apron beyond it is trimmed) */
    const rem = (hi - lo) - (ax === 'x' ? (P.rot90 ? P.d : P.w) : (P.rot90 ? P.w : P.d));
    if (rem > 0.05) { const r = new THREE.Group(); if (P.rot90) r.rotation.y = Math.PI / 2; const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(M).multiply(new THREE.Matrix4().makeTranslation(P.w / 2, 0, P.d / 2)); g.add(r);
      for (const sg of [-1, 1]) { const cl = src.clone(true), n = new THREE.Vector3(), cut = c[ax] + sg * rem / 2; n[ax] = sg; const lp = new THREE.Plane(n, -sg * cut), wp = lp.clone(), n2 = n.clone().negate(), lp2 = new THREE.Plane(n2, sg * (sg < 0 ? lo : hi)), wp2 = lp2.clone();
        const sh = new THREE.Vector3(); sh[ax] = -sg * rem / 2 - c[ax]; cl.position.add(sh); r.add(cl); const TS = new THREE.Matrix4().makeTranslation(sh.x, sh.y, sh.z), MW = new THREE.Matrix4();
        cl.traverse(m => { if (/^door_|^gangway_/.test(m.name || '')) { const q = m.getWorldPosition ? new THREE.Vector3() : null; src.updateMatrixWorld(true); const sp = new THREE.Vector3(); const twin = src.getObjectByName(m.name); if (twin) { twin.getWorldPosition(sp); if (sg * (sp[ax] - cut) < 0 || sp[ax] < lo - 0.05 || sp[ax] > hi + 0.05) { m.visible = false; m.name += '_cut'; } } }
          if (!m.isMesh) return; m.material = Array.isArray(m.material) ? m.material.map(x => { const y = x.clone(); y.clippingPlanes = [wp, wp2]; return y; }) : Object.assign(m.material.clone(), { clippingPlanes: [wp, wp2] });
          m.onBeforeRender = (rd) => { rd.localClippingEnabled = true; MW.multiplyMatrices(r.matrixWorld, TS); wp.copy(lp).applyMatrix4(MW); wp2.copy(lp2).applyMatrix4(MW); }; });
        (E.placed = E.placed || []).push({ id, o: cl, g, P }); }
      return g; } }
  if (ov.mode === 'inst' && P.parent) { const mm = new THREE.Matrix4().copy(M).multiply(new THREE.Matrix4().makeTranslation(P.w / 2, 0, P.d / 2)).multiply(new THREE.Matrix4().makeRotationY(P.rot90 ? Math.PI / 2 : 0)).multiply(new THREE.Matrix4().makeScale(S3.x, S3.y, S3.z)); const k2 = id + '|' + P.parent.uuid; (E.pending[k2] = E.pending[k2] || { id, parent: P.parent, list: [] }).list.push(mm); return new THREE.Group(); } o.scale.multiplyScalar(fit); if (P.rot90) o.rotation.y += Math.PI / 2;
  const g = new THREE.Group(); g.matrixAutoUpdate = false; g.matrix.copy(M).multiply(new THREE.Matrix4().makeTranslation(P.w / 2, 0, P.d / 2)); g.add(o); (E.placed = E.placed || []).push({ id, o, g, P }); return g; };   // [RV2] placed kit clones keep their rig nodes (crane, doors, gangways) for animation
// instanced assets: flatten the glTF into one vertex-coloured geometry (material base colours; textures are not carried into instancing)
/* textured instancing: one {geo, mat} per glTF primitive, baked to inches (optionally unit height for scaled vegetation) */
E.pending = {};
E.parts = id => { E._p = E._p || {}; if (E._p[id]) return E._p[id]; const src = E.scenes[id], ov = E.ovr(id); src.updateMatrixWorld(true); const bb = E.fbox(src), H = bb.max.y - bb.min.y || 1, out = [];
  src.traverse(m => { if (!m.isMesh) return; const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); if (ov.unitH) g.scale(1 / H, 1 / H, 1 / H); if (g.attributes.color) g.deleteAttribute('color'); g.computeBoundingSphere();
    for (const mt0 of [].concat(m.material)) { const mt = mt0.clone(); mt.vertexColors = false; if (mt.map) mt.map.anisotropy = 4; if (/leaves|needle|foliage/i.test(mt.name || '') || mt.transparent) { mt.alphaTest = Math.max(mt.alphaTest || 0, 0.4); mt.transparent = false; mt.side = THREE.DoubleSide; } out.push({ geo: g, mat: mt, name: mt.name }); break; } });
  return (E._p[id] = out); };
E.len = id => { const bb = new THREE.Box3().setFromObject(E.scenes[id]); return bb.max.x - bb.min.x; };
/* instance helper: place(item) -> Matrix4 (precomputed once so random jitter is shared by all parts) */
E.instance = (parent, id, mats, opt = {}) => { const out = []; for (const pt of E.parts(id)) { const m = new THREE.InstancedMesh(pt.geo, pt.mat, Math.max(1, mats.length)); m.name = id; m.userData.kind = id; m.count = mats.length; mats.forEach((mm, i) => m.setMatrixAt(i, mm)); if (opt.colors) opt.colors.forEach((c, i) => m.setColorAt(i, c)); m.instanceMatrix.needsUpdate = true; m.castShadow = opt.cast !== false; m.receiveShadow = true; m.frustumCulled = false; parent.add(m); out.push(m); } return out; };
/* rolling stock: textured glb body as a drop-in for an InstancedMesh (setMatrixAt / instanceMatrix.needsUpdate / setColorAt).
   E.rsId('loco', 'ET44') -> 'loco-et44', E.rsId('covered_hopper') -> 'car-covered_hopper'. Body is stretched along X to the car's true length
   (len in inches, coupler to coupler as used by the train code). The glb carries its own trucks, so callers should hide procedural trucks. */
/* [RS-ROAD] railroad-aware lookup: E.rsId('loco', 'ET44', 'CSX') -> 'loco-et44-csx' when that glb is loaded, else 'loco-et44'.
   E.RS_BASE maps variant registry ids to their base id (loco-et44-csx -> loco-et44). */
E.RS_BASE = { 'loco-et44-csx': 'loco-et44', 'loco-gp38-ns': 'loco-gp38', 'loco-sd70-ns': 'loco-sd70', 'loco-sd70-up': 'loco-sd70', 'car-boxcar-c60-csx': 'car-boxcar-c60', 'car-boxcar-c60-ttx': 'car-boxcar-c60' };   /* [VARIANT-HOOK] grok-sim batch 8 road variants */
/* [VARIANT-HOOK 2026-10-16] car variants picked by roster length (rev4: g32 3.3 in vs h51 4.7 in hoppers, GBRX 4.6 in ethanol tanks, all boxcars are 60 ft c60);
   used only when that variant glb is ingested, else the base car-<type> glb / procedural car */
E.RS_VAR = { covered_hopper: len => len && len < 4.0 ? 'car-covered_hopper-g3250' : null, tank: len => len && len >= 4.55 ? 'car-tank-gbrx' : null, boxcar: () => 'car-boxcar-c60' };
/* [CAR-VARIANT-HOOK 2026-10-19] cars: length variant first (RS_VAR), then a road/owner variant of it or of the base (car-boxcar-c60 + 'CSX' -> car-boxcar-c60-csx) when
   that glb is loaded and E.RS_BASE names it. rr comes from E.carRR(car): car.rr / car.road / car.owner, else the reporting marks at the start of car.marks. */
E.carRR = c => { if (!c) return null; const r = c.rr || c.road || c.owner || (typeof c.marks === 'string' ? (c.marks.match(/^[A-Z]{2,4}/) || [])[0] : null); return r || null; };
E.rsId = (type, model, rr, len) => { if (type !== 'loco') { const v = E.RS_VAR[type] && E.RS_VAR[type](len), b = v && E.rsHas(v) ? v : 'car-' + type; if (rr) { const w = b + '-' + String(rr).toLowerCase().replace(/[^a-z0-9]/g, ''); if (E.RS_BASE[w] === b && E.rsHas(w)) return w; } return b; } const b = 'loco-' + String(model || '').toLowerCase().replace(/[^a-z0-9]/g, ''); if (rr) { const v = b + '-' + String(rr).toLowerCase().replace(/[^a-z0-9]/g, ''); if (E.RS_BASE[v] === b && E.rsHas(v)) return v; } return b; };
E.rsHas = id => E.has(id) && !!E.ovr(id).rs;
/* [RV2] LOD: when '<id>_lod1' (Blender round 9 LOD1, same rig node names) is loaded, each car instance draws the high-detail LOD0 within
   LOD_D plan inches of the camera (?lodd=, default 30 in = 400 ft scale) and LOD1 beyond, with 10% hysteresis; the unused LOD gets a zero matrix */
E.LOD_D = +(new URLSearchParams(location.search).get('lodd') || 30);
E.rsMesh = (id, n, parent, len) => { const RG = E.rig(id), L1 = E.has(id + '_lod1') ? E.rig(id + '_lod1') : null;
  if (RG && L1 && E.LOD_D > 0) { const A = E.rsRigMesh(id, RG, n, parent, len), B = E.rsRigMesh(id + '_lod1', L1, n, parent, len), sel = new Uint8Array(n), Z = new THREE.Matrix4().makeScale(0, 0, 0), p = new THREE.Vector3(), cam = () => (window.__layout3d && window.__layout3d.api && window.__layout3d.api.camera) || null;
    const pick = (i, m) => { const c = cam(); if (!c) return 0; p.setFromMatrixPosition(m); const d = p.distanceTo(c.position), cur = sel[i]; sel[i] = cur ? (d > E.LOD_D * 0.9 ? 1 : 0) : (d > E.LOD_D * 1.1 ? 1 : 0); return sel[i]; };
    E.lodStats = E.lodStats || { lod0: 0, lod1: 0 };
    return { isExtRS: true, rig: A.rig, insetFront: A.insetFront, insetRear: A.insetRear, wheelR: A.wheelR, count: n, lod: { A, B, sel },
      instanceMatrix: { set needsUpdate(v) { A.instanceMatrix.needsUpdate = v; B.instanceMatrix.needsUpdate = v; } }, instanceColor: { needsUpdate: false }, setColorAt() {},
      setMatrixAt(i, m) { const l = pick(i, m); (l ? B : A).setMatrixAt(i, m); (l ? A : B).setMatrixAt(i, Z); },
      setTruckAt(i, kk, m, spin) { const l = sel[i]; (l ? B : A).setTruckAt(i, kk, m, spin); (l ? A : B).setTruckAt(i, kk, Z, 0); },
      couplerPivot(kk, m, out) { return A.couplerPivot(kk, m, out); },
      setCouplerAt(i, kk, m, a) { const l = sel[i]; (l ? B : A).setCouplerAt(i, kk, m, a); (l ? A : B).setCouplerAt(i, kk, Z, 0); },
      set visible(v) { A.visible = v; B.visible = v; } }; }
  if (RG) return E.rsRigMesh(id, RG, n, parent, len);
 const ms = E.instance(parent, id, Array.from({ length: n }, () => new THREE.Matrix4())), SC = new THREE.Matrix4().makeScale(len / E.len(id), 1, 1), T = new THREE.Matrix4();
  return { isExtRS: true, parts: ms, count: n, instanceMatrix: { set needsUpdate(v) { ms.forEach(m => m.instanceMatrix.needsUpdate = v); } }, instanceColor: { needsUpdate: false }, setColorAt() {}, setMatrixAt(i, m) { T.multiplyMatrices(m, SC); ms.forEach(x => x.setMatrixAt(i, T)); }, set visible(v) { ms.forEach(m => m.visible = v); } }; };
/* rigged rolling stock (new prompt convention): nodes truck_front / truck_rear (pivot = truck centre on rail head), wheelset_N inside each truck
   (origin at axle centre), coupler_front / coupler_rear. E.rig(id) splits the glb into body / truck / wheelset parts baked in their own local frames. */
E.rig = id => { E._rig = E._rig || {}; if (id in E._rig) return E._rig[id]; const src = E.scenes[id]; src.updateMatrixWorld(true); const find = n => { let r = null; src.traverse(o => { if (!r && (o.name || '').toLowerCase().replace(/[^a-z_0-9]/g, '') === n) r = o; }); return r; };
  const TF = find('truck_front'), TR = find('truck_rear'); if (!TF || !TR) return (E._rig[id] = null);
  const under = (o, a) => { for (let p = o; p; p = p.parent) if (p === a) return true; return false; }, inv = new THREE.Matrix4(),
    /* [RIG-SCALE FIX] truck / wheelset frames are taken WITHOUT their world scale: the glb is in mm and src carries the mm->inch import scale,
       so inverse(frame.matrixWorld) used to cancel that scale and leave truck + wheel geometry (and wheelset offsets) in raw mm = 25x too big. */
    rigid = M => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); M.decompose(p, q, sc); return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)); },
    bake = (m, frame) => { const g = m.geometry.clone(); g.applyMatrix4(inv.copy(rigid(frame.matrixWorld)).invert().multiply(m.matrixWorld)); if (g.attributes.color) g.deleteAttribute('color'); g.computeBoundingSphere(); return g; };
  const mats = m => [].concat(m.material).map(x => { const c = x.clone(); c.vertexColors = false; return c; })[0];
  const body = [], trucks = [TF, TR].map(T => { const ws = []; T.traverse(o => { if (/^wheelset/i.test(o.name || '') && !ws.includes(o)) ws.push(o); }); const parts = [], wsl = ws.map(w => ({ node: w, local: rigid(T.matrixWorld).invert().multiply(rigid(w.matrixWorld)), parts: [] }));
    T.traverse(m => { if (!m.isMesh) return; const W = wsl.find(w => under(m, w.node)); if (W) W.parts.push({ geo: bake(m, W.node), mat: mats(m) }); else parts.push({ geo: bake(m, T), mat: mats(m) }); });
    return { node: T, x: new THREE.Vector3().setFromMatrixPosition(T.matrixWorld).x, parts, ws: wsl }; });
  const CP = ['coupler_front', 'coupler_rear'].map(n => { const o = find(n); return o ? { node: o, piv: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld), parts: [] } : null; });   // [RV2] couplers swing about their draft-gear pivot
  src.traverse(m => { if (m.isMesh && !under(m, TF) && !under(m, TR)) { const C = CP.find(c => c && under(m, c.node)); const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); if (C) g.translate(-C.piv.x, -C.piv.y, -C.piv.z); if (g.attributes.color) g.deleteAttribute('color'); g.computeBoundingSphere(); (C ? C.parts : body).push({ geo: g, mat: mats(m) }); } });
  const L = E.len(id); let wr = 0.021; trucks.forEach(t => t.ws.forEach(w => w.parts.forEach(p => { p.geo.computeBoundingBox(); wr = Math.max(0.01, (p.geo.boundingBox.max.y - p.geo.boundingBox.min.y) / 2); })));
  return (E._rig[id] = { body, trucks, cp: CP, len: L, insetFront: L / 2 - trucks[0].x, insetRear: L / 2 + trucks[1].x, wheelR: wr }); };
E.rsRigMesh = (id, RG, n, parent, len) => { const k = len / RG.len, mk = (pt, cnt, part) => { const m = new THREE.InstancedMesh(pt.geo, pt.mat, Math.max(1, cnt)); m.userData.rs = { id, part }; m.frustumCulled = false; m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); parent.add(m); return m; };
  const body = RG.body.map(p => mk(p, n, 'body')), tr = RG.trucks.map(t => ({ parts: t.parts.map(p => mk(p, n, 'truck')), ws: t.ws.map(w => ({ local: w.local, parts: w.parts.map(p => mk(p, n, 'wheel')) })) })), SC = new THREE.Matrix4().makeScale(k, 1, 1), T = new THREE.Matrix4(), R = new THREE.Matrix4(), W = new THREE.Matrix4();
  const cp = (RG.cp || []).map(c => c && c.parts.length ? { piv: c.piv, parts: c.parts.map(p => mk(p, n, 'coupler')) } : null), CPM = new THREE.Matrix4(), CPY = new THREE.Matrix4(), CPV = new THREE.Vector3();
  const all = [...body, ...tr.flatMap(t => [...t.parts, ...t.ws.flatMap(w => w.parts)]), ...cp.flatMap(c => c ? c.parts : [])];
  return { isExtRS: true, rig: RG, insetFront: RG.insetFront * k, insetRear: RG.insetRear * k, wheelR: RG.wheelR, count: n, instanceMatrix: { set needsUpdate(v) { all.forEach(m => m.instanceMatrix.needsUpdate = v); } }, instanceColor: { needsUpdate: false }, setColorAt() {},
    setMatrixAt(i, m) { T.multiplyMatrices(m, SC); body.forEach(x => x.setMatrixAt(i, T)); cp.forEach(c => { if (c) { CPM.copy(m).multiply(CPY.makeTranslation(c.piv.x * k, c.piv.y, c.piv.z)); c.parts.forEach(x => x.setMatrixAt(i, CPM)); } }); },
    /* [RV2] coupler kk (0 front / 1 rear) of car i: m = body matrix, knuckle = world point of the mating knuckle; the shank swings about its pivot to
       point at it, clamped to the real +-13 deg */
    couplerPivot(kk, m, out) { const c = cp[kk]; if (!c) return null; return out.set(c.piv.x * k, c.piv.y, c.piv.z).applyMatrix4(m); },
    setCouplerAt(i, kk, m, ang) { const c = cp[kk]; if (!c) return; const a = Math.max(-0.227, Math.min(0.227, ang)); CPM.copy(m).multiply(CPY.makeTranslation(c.piv.x * k, c.piv.y, c.piv.z)).multiply(CPY.makeRotationY(a)); c.parts.forEach(x => x.setMatrixAt(i, CPM)); },
    /* k = 0 front / 1 rear; m = truck pivot matrix on the track (position + yaw); spin = wheel angle (rad) */
    setTruckAt(i, kk, m, spin = 0) { const t = tr[kk]; t.parts.forEach(x => x.setMatrixAt(i, m)); R.makeRotationZ(-spin); t.ws.forEach(w => { W.multiplyMatrices(m, w.local).multiply(R); w.parts.forEach(x => x.setMatrixAt(i, W)); }); },
    set visible(v) { all.forEach(m => m.visible = v); } }; };
/* [VEH-WHEELS 2026-10-15] road-vehicle wheels classified by their ACTUAL position, never by node name (Grok files disagree: veh-sedan / veh-ups
   put wheel_FL at +Z, veh-pickup at -Z). Front = +X, left = -Z (Y up). Returns [{node, front, left, x, z, r, spinSign}] or null; spinSign = +1 for every
   wheel (axles along Z, forward roll = negative rotation about Z for all wheels since both sides share the axis), steer = front wheels only. */
E.vehWheels = id => { const src = E.scenes[id]; if (!src) return null; src.updateMatrixWorld(true); const out = [], p = new THREE.Vector3(), bb = new THREE.Box3();
  src.traverse(o => { if (o === src || !/wheel/i.test(o.name || '')) return;
    o.getWorldPosition(p); bb.setFromObject(o); out.push({ node: o, name: o.name, x: p.x, z: p.z, r: (bb.max.y - bb.min.y) / 2, front: false, left: p.z < 0, spinSign: 1 }); });
  if (!out.length) return null; const xs = out.map(w => w.x), mid = (Math.max(...xs) + Math.min(...xs)) / 2; out.forEach(w => { w.front = w.x > mid; w.steer = w.front && w.x === Math.max(...xs); }); return out; };
/* [RV2] road-vehicle rig (Blender round 7-10 contract): <id> > body + wheel_* (origin = wheel centre, spin about Z; wheel_F* steer about Y) and, on
   tractor-trailers, a 'trailer' node (origin = kingpin) whose wheel_T* children ride with it. Returns the meshes baked in the model frame (inches,
   front +X, like E.parts) grouped by moving part, plus the axle / kingpin stations the viewer needs for the tractrix. null = not rigged. */
E.vehRig = id => { E._vr = E._vr || {}; if (id in E._vr) return E._vr[id]; const src = E.scenes[id]; if (!src) return (E._vr[id] = null); src.updateMatrixWorld(true);
  let any = false; src.traverse(o => { if (/^wheel_/i.test(o.name || '')) any = true; }); if (!any) return (E._vr[id] = null);
  const G = [{ k: 'body' }], byNode = new Map(), p = new THREE.Vector3(), bb = new THREE.Box3();
  const grpOf = m => { let w = null, tr = null; for (let o = m; o && o !== src; o = o.parent) { const n = o.name || ''; if (!w && /^wheel_/i.test(n)) w = o; if (!tr && /^trailer$/i.test(n)) tr = o; }
    const key = w || tr; if (!key) return 0; if (byNode.has(key)) return byNode.get(key); key.getWorldPosition(p);
    const g = w ? { k: 'wheel', name: w.name, piv: p.clone(), trailer: !!tr, front: /^wheel_F/i.test(w.name), r: 0 } : { k: 'trailer', piv: p.clone() };
    G.push(g); byNode.set(key, G.length - 1); return G.length - 1; };
  const out = []; src.traverse(m => { if (!m.isMesh) return; const gi = grpOf(m), g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); if (g.attributes.color) g.deleteAttribute('color'); g.computeBoundingSphere();
    if (G[gi].k === 'wheel') { g.computeBoundingBox(); G[gi].r = Math.max(G[gi].r, (g.boundingBox.max.y - g.boundingBox.min.y) / 2); }
    for (const mt0 of [].concat(m.material)) { const mt = mt0.clone(); mt.vertexColors = false; if (mt.map) mt.map.anisotropy = 4; out.push({ geo: g, mat: mt, name: mt.name, grp: gi }); break; } });
  const W = G.filter(g => g.k === 'wheel'), avg = a => a.length ? a.reduce((s, g) => s + g.piv.x, 0) / a.length : null, TR = G.find(g => g.k === 'trailer');
  const xF = avg(W.filter(g => g.front)), xR = avg(W.filter(g => !g.front && !g.trailer)), xT = avg(W.filter(g => g.trailer));
  const tIdx = G.indexOf(TR); G.forEach(g => { if (g.k === 'wheel' && g.trailer) g.parent = tIdx; });
  return (E._vr[id] = { parts: out, G, xF, xR, xK: TR ? TR.piv.x : null, xT, trailer: TR ? tIdx : -1, wb: xF != null && xR != null ? xF - xR : 0.3, r: W.length ? W[0].r || 0.03 : 0.03 }); };
/* [RIG-CHECK] sanity check for rigged rolling stock in the live scene: every visible wheel instance must be N-scale sized (dia < 0.4 in),
   every truck < 1.6 in long, and both must sit within half a car length (+0.6 in) of a body instance of the same model. Returns a list of problems. */
E.rigCheck = (scene) => { const out = [], B = {}, box = new THREE.Box3(), M = new THREE.Matrix4(), c = new THREE.Vector3(), sz = new THREE.Vector3(), parts = [];
  scene.updateMatrixWorld(true); scene.traverse(m => { if (m.isInstancedMesh && m.userData.rs && m.visible) parts.push(m); });
  for (const m of parts) { m.geometry.computeBoundingBox(); for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, M); M.premultiply(m.matrixWorld); box.copy(m.geometry.boundingBox).applyMatrix4(M); box.getCenter(c); box.getSize(sz);
      if (sz.x > 1e3 || !isFinite(sz.x) || sz.length() < 1e-3) continue;   /* parked/unused slot (zero or huge sentinel) */
      const r = m.userData.rs, key = r.id; if (r.part === 'body') (B[key] = B[key] || []).push({ c: c.clone(), half: Math.max(sz.x, sz.z) / 2 });
      else { const gs = m.geometry.boundingBox.getSize(new THREE.Vector3()), k = M.getMaxScaleOnAxis(), dia = Math.min(gs.x, gs.y) * k /* disc spans local X/Y (axle = Z); unrotated, so spin does not inflate it */, lenx = Math.max(gs.x, gs.z) * k; if (r.part === 'wheel' && dia > 0.4) out.push(`${key} wheel #${i} diameter ${dia.toFixed(2)} in`); if (r.part === 'truck' && lenx > 1.6) out.push(`${key} truck #${i} length ${lenx.toFixed(2)} in`); (B['_' + key] = B['_' + key] || []).push({ c: c.clone(), what: r.part + ' #' + i }); } } }
  for (const k of Object.keys(B).filter(k => k[0] === '_')) { const id = k.slice(1), bodies = B[id] || [];
    for (const p of B[k]) { const ok = bodies.some(b => b.c.distanceTo(p.c) < b.half + 0.6); if (!ok) out.push(`${id} ${p.what} detached (no car body within reach at ${p.c.x.toFixed(1)},${p.c.y.toFixed(1)},${p.c.z.toFixed(1)})`); } }
  return out; };
/* [TILE-HOOK 2026-10-16] tileable path sections from grok-sim batches 3/5/10 (fence-board / fence-chain / fence-wire, hedge, pier, loading-dock):
   one section with its length along X, centred on the origin, +Z = outer face (dock bumpers / road side). Each straight-ish run gets
   n = round(run length / L) sections stretched to fit exactly; +Z points to the LEFT of the a->b direction. Yf(p) = ground height, ok(p) filters a
   section by its centre. opt: { depth (plan depth, in: scales Z), yOff }. Returns false when the glb is not ingested (caller draws its fallback). */
E.tile = (parent, id, P, Yf, ok, opt = {}) => { if (!E.has(id) || !P || P.length < 2) return false;
  const bb = new THREE.Box3().setFromObject(E.scenes[id]), L = (bb.max.x - bb.min.x) || 1, sz = opt.depth ? opt.depth / ((bb.max.z - bb.min.z) || 1) : 1, mats = [], up = new THREE.Vector3(0, 1, 0);
  /* runs: split the polyline at corners (> 25 deg turn) so a section never cuts a corner; dense curve points are tiled continuously by arc length */
  const pts = P.filter((p, i) => !i || Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) > 1e-4), runs = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) { const r = runs[runs.length - 1]; r.push(pts[i]); if (i + 1 < pts.length) { const a = pts[i - 1], b = pts[i], c = pts[i + 1], t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 0.44) runs.push([b]); } }
  for (const r of runs) { if (r.length < 2) continue; const cum = [0]; for (let i = 1; i < r.length; i++) cum.push(cum[i - 1] + Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1])); const S = cum[cum.length - 1]; if (S < 1e-3) continue;
    const n = Math.max(1, Math.round(S / L)), sx = S / (n * L), at = s => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [r[i - 1][0] + (r[i][0] - r[i - 1][0]) * f, r[i - 1][1] + (r[i][1] - r[i - 1][1]) * f]; };
    for (let k = 0; k < n; k++) { const s0 = k * S / n, s1 = (k + 1) * S / n, A = at(s0), B = at(s1), p = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; if (ok && !ok(p)) continue;
      const q = new THREE.Quaternion().setFromAxisAngle(up, -Math.atan2(B[1] - A[1], B[0] - A[0])), sxk = Math.hypot(B[0] - A[0], B[1] - A[1]) / L || sx;
      if (opt.span) { /* [R34] span mode: Yf -> [bottom, top]; the section is scaled vertically so its bbox runs exactly bottom..top (pilings end at the deck, never at the glb's own unit height) */
        const [yb, yt] = Yf(p), H = (bb.max.y - bb.min.y) || 1, sy = Math.max(0.05, yt - yb) / H; mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], yb - bb.min.y * sy, p[1]), q, new THREE.Vector3(sxk, sy, sz))); continue; }
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], Yf(p) + (opt.yOff || 0), p[1]), q, new THREE.Vector3(sxk, 1, sz))); } }
  if (mats.length) E.instance(parent, id, mats); E.tileCount = E.tileCount || {}; E.tileCount[id] = (E.tileCount[id] || 0) + mats.length; return true; };
E.flush = () => { for (const [k, P] of Object.entries(E.pending)) { E.instance(P.parent, P.id, P.list); delete E.pending[k]; } };
E.geometry = id => { const src = E.scenes[id]; src.updateMatrixWorld(true); const parts = [];
  src.traverse(m => { if (!m.isMesh) return; let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrixWorld); const c = (Array.isArray(m.material) ? m.material[0] : m.material).color || new THREE.Color(1, 1, 1);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); parts.push(L3D.vcol(g, c)); });
  return parts.length ? L3D.merge(parts) : null; };
const geo0 = L3D.geo; if (geo0) L3D.geo = id => (E.has(id) && !E.ovr(id).mode && (E._g = E._g || {}, E._g[id] = E._g[id] || E.geometry(id))) || geo0(id);
})(window.L3D);
