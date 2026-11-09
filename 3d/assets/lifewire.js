/* lifewire.js [R34] - wires blender-pipeline life.js (ambient people, animals, UPS/mail rounds, forklifts with operators) into the viewer.
   One life instance per level (life.js is a singleton: L3D.life drives L1, the namespaced copy L3D.life2 drives L2). Data = LAYOUT.levels[k].life
   (tools/layout3d/life_export.py), plan inches; each instance lives in a Group lifted to the level deck so heights in the data are above the deck.
   GLBs come base64 from life-data.js (window.L3D_LIFE_GLB). ?life=0 disables. viewer.js calls L3D.lifewire.init(api) after logistics and
   L3D.lifewire.update(dt, camera) every frame. */
'use strict';
(function () {
const L3D = window.L3D = window.L3D || {}, W = L3D.lifewire = { on: false, inst: [], err: [] };
W.init = function (api) {
  if (/[?&]life=0/.test(location.search) || !window.L3D_LIFE_GLB || !L3D.life || !window.LAYOUT) return;
  const LY = window.LAYOUT.levels, NS = [L3D.life, L3D.life2];
  LY.forEach((lv, k) => { const ns = NS[k]; if (!ns || !lv.life || !api.LV[k]) return; const o = api.LV[k];
    const g = new THREE.Group(); g.name = 'life-L' + (k + 1); g.position.y = o.deck; api.scene.add(g);
    const D = Object.assign({}, lv.life); delete D.lots; delete D.lotsUnlinked;
    const p = ns.init({ scene: g, data: D, assets: window.L3D_LIFE_GLB, unitsPerMeter: 39.37 / 160, glbScale: 1 / 25.4, hour: 11, dayOfWeek: 3, seed: 5 + k, timeWarp: 1, maxActors: 160,
      heightAt: (x, z) => (o.terrain ? o.terrain.h(x, z) : 0),
      /* [R36] a car station is only worked while a (non-loco) car stands still on its spot on this level: no pallets on bare rails */
      carAt: (x, z, r) => { if (/[?&]demospot=1/.test(location.search)) return { demo: true, len: 4 }; /* [R36] staged-shot demo spot */ const H = window.__ops3d, eng = H && H.engine; if (!eng) return null; for (const cut of eng.cuts) { if (Math.abs(cut.v || 0) > 0.01) continue; let lvl = -1; try { lvl = Math.round(eng.edgeLevel(cut.path[0].e)); } catch (e) {} if (lvl !== k + 1) continue;
        for (const c of cut.cars) { if (c.loco || c.type === 'loco' || !c._pose) continue; const P = c._pose, ca = Math.cos(P.a), sa = Math.sin(P.a), dx = x - P.x, dz = z - P.y, al = dx * ca + dz * sa, cr = -dx * sa + dz * ca; if (Math.abs(al) < (c.len || 3) / 2 - 0.3 && Math.abs(cr) < (r || 0.3)) return c; } } return null; } })
      .then(st => { W.inst.push({ ns, k, g, st }); W.on = true;
        /* [R36] static 'load-forklift' props had no operator: hide their instanced meshes on this level and park rigged forklifts (seated operator) in their place */
        try { const lvG = api.LV[k].g || api.LV[k].group; const H = ((lv.life || {}).forkliftSites || []).map(f => f.home); const P = (lv.props || []).filter(q => q.kind === 'load-forklift' && !H.some(h => Math.hypot(h[0] - q.x, h[1] - q.y) < 2.5)); /* [R36 P6] a working site's forklift replaces the static prop at its home (no parked twin) */ if ((lv.props || []).some(q => q.kind === 'load-forklift') && ns.addParked) { (lvG || api.scene).traverse(m => { if (m.isInstancedMesh && m.name === 'load-forklift') { m.visible = false; m.userData.replacedBy = 'fk-parked'; } });
            ns.addParked(P.map(q => ({ x: q.x, z: q.y, yaw: q.a || 0 }))); } } catch (e) { W.err.push('parked L' + (k + 1) + ': ' + e.message); } }).catch(e => { W.err.push('L' + (k + 1) + ': ' + e.message); console.error('[lifewire]', e); });
    W.ready = (W.ready || []).concat([p]); });
};
W.update = function (dt, camera) { for (const I of W.inst) try { I.ns.update(dt, camera); } catch (e) { if (W.err.length < 5) W.err.push(e.message); } };
W.stats = () => W.inst.map(I => Object.assign({ level: I.k + 1 }, I.ns.stats ? I.ns.stats() : {}));
})();
