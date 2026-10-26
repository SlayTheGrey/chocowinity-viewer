/* [CHOCO-RSMAP 2026-10-25] drawing only: Chocowinity roster names -> the embedded detailed glbs (before this, ET44AC/ES44AH/GP38-2/SD70ACU and hc/t51/at25
   resolved to ids with no glb and drew the low-detail procedural rollingstock.js shapes). Also LOD0 (full detail) to 96 in from the camera instead of 30 in.
   ?rsmap=0 = old behaviour; ?lodd= still overrides. Ops untouched. */
(function () { const E = window.L3D && L3D.ext, QS = new URLSearchParams(location.search); if (!E || !E.rsId || QS.get('rsmap') === '0') return;
  const LM = { et44ac: 'et44', et44ah: 'et44', es44ah: 'es44', es44ac: 'es44', es44dc: 'es44', gp382: 'gp38', gp402: 'gp40', sd70acu: 'sd70', sd70m: 'sd70', sd70mac: 'sd70', sd70ace: 'sd70', sd402: 'sd40', mp15dc: 'mp15', mp15ac: 'mp15' };
  const CT = { hc: ['boxcar', 1], t51: ['tank', 1], at25: ['tank', 0] };   /* [type, keep length-variant pick]; at25 ammonia tank -> base tank, not the GBRX ethanol tank */
  const r0 = E.rsId; E.rsId = (type, model, rr, len) => { if (type === 'loco') { const k = String(model || '').toLowerCase().replace(/[^a-z0-9]/g, ''); if (LM[k]) model = LM[k]; } else if (CT[type]) { if (!CT[type][1]) len = null; type = CT[type][0]; } return r0(type, model, rr, len); };
  if (!QS.get('lodd')) E.LOD_D = 96; E.rsmap = { LM, CT, lodd: E.LOD_D }; })();
