/* [REV4-3D 2026-10-16] Scenery props for plan fill zones (export_plan rev4_scenery -> L.props): horses, riders, jumps, troughs, horse trailer,
   cell tower, substation, tie stacks, ballast pile, rail rack, junk cars + crushed stacks, headstones, cedars, ruins, stumps, deer stand, jon boat,
   round hay bales at hay barns. Real N-scale sizes (1:160, inches). Procedural low-poly geometry; vertex colours, white parts take the instance colour. */
'use strict';
(function (L3D) {
const { part, merge, BOX, CYL } = L3D, D = (id, nm, fn) => L3D.defGeo(id, { name: nm, cat: 'prop' }, fn);
const legs = (xs, zs, h, r, c) => xs.flatMap(x => zs.map(z => part(CYL(r, r, h, 5), x, h / 2, z, c)));
// horse ~16 hands: 5.4 ft at withers (0.4 in), 8 ft long (0.6 in)
const horse = (rider) => () => merge([part(BOX(0.42, 0.15, 0.13), 0, 0.3, 0, '#fff'), ...legs([-0.17, 0.17], [-0.045, 0.045], 0.24, 0.022, '#3a2a20'),
  part(BOX(0.16, 0.2, 0.08), 0.24, 0.42, 0, '#fff', 0, 0, -0.7), part(BOX(0.15, 0.07, 0.07), 0.33, 0.5, 0, '#fff', 0, 0, 0.5), part(BOX(0.04, 0.16, 0.03), -0.22, 0.27, 0, '#2a1a10', 0, 0, 0.3)]
  .concat(rider ? [part(CYL(0.035, 0.045, 0.2, 6), 0.02, 0.48, 0, '#1f3f7a'), part(CYL(0.03, 0.03, 0.05, 6), 0.02, 0.62, 0, '#e0b090'), part(CYL(0.035, 0.035, 0.03, 6), 0.02, 0.66, 0, '#222')] : []));
D('horse', 'Horse (16 hands)', horse(false)); D('horse-rider', 'Horse with rider', horse(true));
D('trough', 'Water trough', () => merge([part(BOX(0.4, 0.1, 0.16), 0, 0.05, 0, '#9aa0a6')]));
D('jump', 'Show jump (2 standards + pole)', () => merge([part(BOX(0.03, 0.22, 0.03), 0, 0.11, -0.3, '#fff'), part(BOX(0.03, 0.22, 0.03), 0, 0.11, 0.3, '#fff'), part(BOX(0.02, 0.02, 0.6), 0, 0.17, 0, '#c62828'), part(BOX(0.02, 0.02, 0.6), 0, 0.09, 0, '#fff')]));
D('horse-trailer', 'Gooseneck horse trailer (20 ft)', () => merge([part(BOX(1.3, 0.5, 0.48), 0, 0.33, 0, '#fff'), part(BOX(0.4, 0.15, 0.44), 0.75, 0.62, 0, '#fff'), part(BOX(1.1, 0.08, 0.49), 0, 0.42, 0, '#888'),
  ...[-0.2, 0.2].flatMap(x => [-0.24, 0.24].map(z => part(CYL(0.1, 0.1, 0.06, 10), x, 0.1, z, '#222', Math.PI / 2)))]));
// cell monopole 120 ft (9 in) + antenna triangle + equipment shelter
D('cell-tower', 'Cell tower monopole (120 ft) + shelter', () => merge([part(CYL(0.06, 0.12, 9, 8), 0, 4.5, 0, '#b0b4b8'), part(CYL(0.45, 0.45, 0.04, 3), 0, 8.7, 0, '#9a9ea2'),
  ...[0, 2.09, 4.19].map(a => part(BOX(0.04, 0.5, 0.12), Math.cos(a) * 0.42, 8.6, Math.sin(a) * 0.42, '#e8e8e8')), part(CYL(0.4, 0.4, 0.04, 3), 0, 7.9, 0, '#9a9ea2'),
  part(BOX(0.75, 0.45, 0.5), 0.9, 0.22, 0.4, '#d8d4c8'), part(BOX(0.3, 0.3, 0.3), -0.7, 0.15, 0.5, '#888')]));
// distribution substation ~3.6 x 2.6 in: slab, 2 steel bays (lattice), 3 transformers, bus, insulators
D('substation', 'Distribution substation (115/25 kV)', () => { const P = [part(BOX(3.4, 0.03, 2.4), 0, 0.015, 0, '#bdb8ae')];
  for (const x of [-1.3, -0.4, 0.5, 1.4]) for (const z of [-0.9, 0.9]) P.push(part(BOX(0.05, 1.4, 0.05), x, 0.7, z, '#9ea3a8'));
  for (const z of [-0.9, 0.9]) P.push(part(BOX(2.8, 0.05, 0.05), 0.05, 1.38, z, '#9ea3a8')); for (const x of [-1.3, -0.4, 0.5, 1.4]) P.push(part(BOX(0.05, 0.05, 1.85), x, 1.38, 0, '#9ea3a8'));
  for (const x of [-0.85, 0.05, 0.95]) { P.push(part(BOX(0.42, 0.45, 0.36), x, 0.26, 0, '#6d7378')); for (const k of [-1, 0, 1]) P.push(part(CYL(0.025, 0.025, 0.22, 6), x + k * 0.12, 0.6, 0, '#e8e0c8')); P.push(part(BOX(0.46, 0.3, 0.04), x, 0.24, 0.2, '#5a6066')); }
  for (const z of [-0.5, 0, 0.5]) P.push(part(BOX(2.6, 0.02, 0.02), 0.05, 1.15, z, '#c8c8c8')); P.push(part(BOX(0.6, 0.35, 0.4), 1.2, 0.18, -0.85, '#d0ccc0')); return merge(P); });
D('tie-stack', 'Relay tie stack (8.5 ft ties)', () => merge([0, 1, 2, 3].map(k => part(BOX(0.64, 0.045, 0.42), 0, 0.023 + k * 0.047, 0, '#fff', 0, k % 2 ? 0.05 : 0))));
D('ballast-pile', 'Ballast stockpile', () => { /* REAL1: granite ballast stockpile = smooth cone at the ~37 deg angle of repose (16 ft across, 6 ft high), not a lumpy rock */
  const g = new THREE.ConeGeometry(0.6, 0.45, 20, 4, true), p = g.attributes.position; let s = 77; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0.2) continue; const k = 1 + (r() - 0.5) * 0.12 * (0.225 - y); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } g.computeVertexNormals();
  return merge([part(g, 0, 0.215, 0, '#9a968e')]); });
D('rail-rack', 'Rail on racks (39 ft rail)', () => merge([...[-1.0, 0, 1.0].map(x => part(BOX(0.06, 0.12, 0.6), x, 0.06, 0, '#5a4a3a')), ...[-0.2, -0.1, 0, 0.1, 0.2].map(z => part(BOX(2.9, 0.025, 0.02), 0, 0.13, z, '#7a6a5a'))]));
D('car-stack', 'Crushed-car stack', () => merge([0, 1, 2, 3, 4].map(k => part(BOX(1.05, 0.1, 0.42), (k % 2) * 0.04, 0.05 + k * 0.105, 0, ['#8a3a2a', '#3a4a6a', '#7a7a70', '#9a8a3a', '#5a3a2a'][k], 0, k * 0.08, 0))));
D('headstone', 'Headstone (3 ft)', () => merge([part(BOX(0.04, 0.15, 0.17), 0, 0.075, 0, '#fff'), part(CYL(0.085, 0.085, 0.04, 12).rotateX(Math.PI / 2).rotateY(Math.PI / 2), 0, 0.15, 0, '#fff'), part(BOX(0.07, 0.02, 0.2), 0, 0.01, 0, '#fff')])); /* REAL1: rounded-top granite tablet on a base (was a plain slab) */
D('ruin', 'Old foundation (unit, scaled)', () => merge([part(BOX(1, 0.06, 0.04), 0, 0.03, -0.5, '#fff'), part(BOX(1, 0.06, 0.04), 0, 0.03, 0.5, '#fff'), part(BOX(0.04, 0.06, 1), -0.5, 0.03, 0, '#fff'), part(BOX(0.04, 0.04, 1), 0.5, 0.02, 0, '#fff'), part(BOX(0.4, 0.03, 0.3), 0.15, 0.015, 0.1, '#8a8070')]));
D('chimney', 'Brick chimney (standing alone)', () => merge([part(BOX(0.16, 0.85, 0.14), 0, 0.425, 0, '#9a4a36'), part(BOX(0.2, 0.05, 0.18), 0, 0.86, 0, '#7a3a2a')]));
/* [R30] NS engine terminal on E-1 (track along local x, prop origin on the track CL at deck level): sand tower straddling E-1 (legs 0.85 in = 11.3 ft off CL),
   35 ft hopper on the north legs, and a separate swing-up spout (exempt from clearance like a crane: it is raised clear when no loco is under it);
   fuel crane = standpipe column beside the track with a swing arm and hose. */
D('sand-tower', 'Sand tower (straddles E-1; 35 ft hopper, 4 steel legs)', () => merge([...legs([-0.55, 0.55], [-0.85, 0.85], 2.7, 0.035, '#6e7378'),
  part(BOX(1.2, 0.04, 1.8), 0, 2.72, 0, '#5e6368'), part(BOX(0.75, 0.75, 0.7), 0, 3.15, -0.7, '#8a8f94'), part(CYL(0.05, 0.38, 0.35, 10), 0, 2.6, -0.7, '#8a8f94'),
  part(BOX(0.04, 0.5, 0.04), 0.5, 3.2, -1.05, '#c8a418'), part(BOX(1.3, 0.03, 0.03), 0, 2.95, -1.05, '#c8a418'), part(BOX(0.26, 0.9, 0.26), -0.9, 0.45, -0.95, '#7a7f84') /* [R33] sand bin between E-1 and the next track (was 0.46 in from it) */]));
D('sand-spout', 'Sand spout boom + telescoping pipe over the E-1 CL (sand fill ~15 ft above rail)', () => merge([part(BOX(0.06, 0.06, 0.8), 0, 2.62, -0.35, '#5e6368'), part(CYL(0.025, 0.025, 0.6, 8), 0, 2.3, 0, '#4a4e52'), part(CYL(0.04, 0.025, 0.1, 8), 0, 1.98, 0, '#2a2c2e') /* [R33] telescoping pipe stowed up: nozzle 1.93 in above the deck (1.64 above rail top), clear of the 1.62 envelope */]));
D('fuel-crane', 'Locomotive fuel crane: standpipe column + swing arm + nozzle hose', () => merge([part(CYL(0.035, 0.04, 1.1, 8), 0, 0.55, 0, '#c8a418'), part(BOX(0.04, 0.04, 0.55), 0, 1.08, -0.27, '#c8a418'), part(CYL(0.012, 0.012, 0.45, 6), 0, 0.85, -0.53, '#1a1a1a'), part(BOX(0.12, 0.1, 0.1), 0, 0.05, 0, '#3a3c3e')]));
D('drip-pan', 'Steel drip pan / containment between the rails (fuel spot, 3 units)', () => merge([part(BOX(1, 0.01, 0.42), 0, 0.005, 0, '#3a3c3e')]));
D('farm-gate', '12 ft tubular farm gate (5 bar) between two 6 in posts', () => merge([part(BOX(0.04, 0.38, 0.04), -0.47, 0.19, 0, '#6a5a40'), part(BOX(0.04, 0.38, 0.04), 0.47, 0.19, 0, '#6a5a40'), ...[0.06, 0.12, 0.18, 0.24, 0.3].map(h => part(BOX(0.88, 0.012, 0.012), 0, h, 0, '#9aa0a4')), part(BOX(0.012, 0.26, 0.012), 0, 0.17, 0, '#9aa0a4')]));
D('radio-antenna', 'Yard radio antenna: 40 ft steel pole, whip + yagi, coax to the office', () => merge([part(CYL(0.02, 0.03, 3.0, 6), 0, 1.5, 0, '#9aa0a4'), part(CYL(0.006, 0.006, 0.6, 4), 0, 3.3, 0, '#d8d8d8'), part(BOX(0.4, 0.015, 0.015), 0, 2.7, 0, '#c8c8c8'), ...[-0.15, -0.05, 0.05, 0.15].map(x => part(BOX(0.01, 0.01, 0.12), x, 2.7, 0, '#c8c8c8')), part(BOX(0.12, 0.04, 0.12), 0, 0.02, 0, '#8a8a8a')]));
D('brake-shoe-rack', 'Brake-shoe / knuckle rack (6 x 3 ft steel rack, rusty shoes)', () => merge([...legs([-0.2, 0.2], [-0.1, 0.1], 0.2, 0.008, '#4a4e52'), part(BOX(0.45, 0.02, 0.25), 0, 0.12, 0, '#4a4e52'), part(BOX(0.42, 0.06, 0.22), 0, 0.16, 0, '#7a4a2a'), part(BOX(0.45, 0.02, 0.25), 0, 0.2, 0, '#4a4e52'), part(BOX(0.3, 0.05, 0.18), 0, 0.24, 0, '#6a3a22')]));
D('yard-limit-sign', 'YARD LIMIT sign (NS: white board, black letters, on a post)', () => merge([part(BOX(0.02, 0.5, 0.02), 0, 0.25, 0, '#6a6a6a'), part(BOX(0.3, 0.12, 0.012), 0, 0.5, 0, '#f4f4f4'), part(BOX(0.24, 0.03, 0.014), 0, 0.5, 0, '#111')]));
D('blue-flag', 'Blue-flag stand (blue signal flag / board on a post at the track end)', () => merge([part(BOX(0.012, 0.3, 0.012), 0, 0.15, 0, '#7a7a7a'), part(BOX(0.012, 0.09, 0.12), 0, 0.27, 0.06, '#1f4fbf')]));
D('guard-booth', 'Gate guard booth (6 x 8 ft, windows all round) + lift-arm stand', () => merge([part(BOX(0.45, 0.62, 0.6), 0, 0.31, 0, '#e8e4da'), part(BOX(0.47, 0.18, 0.62), 0, 0.42, 0, '#5a7488'), part(BOX(0.52, 0.04, 0.68), 0, 0.64, 0, '#4a4038'), part(BOX(0.06, 0.2, 0.06), 0.3, 0.1, 0.4, '#d8c020'), part(BOX(0.025, 0.025, 0.9), 0.3, 0.2, 0.85, '#e02020')]));
D('stump', 'Stump', () => merge([part(CYL(0.05, 0.06, 0.06, 6), 0, 0.03, 0, '#7a6048')]));
D('deer-stand', 'Deer stand (ladder stand)', () => merge([...legs([-0.1, 0.1], [-0.1, 0.1], 1.0, 0.012, '#5a4a3a'), part(BOX(0.26, 0.03, 0.26), 0, 1.0, 0, '#6a5a40'), part(BOX(0.26, 0.12, 0.02), 0, 1.07, 0.13, '#4a5a30')]));
D('hay-bale', 'Round hay bale (5 ft)', () => merge([part(CYL(0.19, 0.19, 0.3, 10), 0, 0.19, 0, '#fff', Math.PI / 2)]));
/* [WIRE 2026-10-16] procedural fallbacks for glb-only prop kinds that should still show before ingest (real 1:160 sizes, inches) */
D('load-coil-rack', 'Steel coil saddle rack, 5 coils (40 ft) [fallback]', () => { const P = [part(BOX(3.0, 0.03, 0.6), 0, 0.015, 0, '#bdb8ae')];
  for (let i = 0; i < 5; i++) { const x = -1.2 + i * 0.6; P.push(part(BOX(0.42, 0.06, 0.5), x, 0.06, 0, '#6a5a40'), part(CYL(0.225, 0.225, 0.375, 14), x, 0.315, 0, i < 3 ? '#4a5058' : '#b8bcc0', 0, 0, Math.PI / 2), part(CYL(0.07, 0.07, 0.38, 10), x, 0.315, 0, '#2a2a2a', 0, 0, Math.PI / 2)); }
  return merge(P); });
D('light-tower', 'Yard light pole (40 ft galvanised pole, 4-lamp head) [R36e: was a 90 ft mast that read as a pole up to L2]', () => merge([part(BOX(0.22, 0.05, 0.22), 0, 0.025, 0, '#a8a49a'), part(BOX(0.05, 3.0, 0.05), 0, 1.55, 0, '#9aa0a4'), part(BOX(0.42, 0.04, 0.12), 0, 3.06, 0, '#7c8286'), part(BOX(0.4, 0.1, 0.05), 0, 2.99, 0.06, '#f4f0d8')]));
D('load-container-53', '53 ft domestic container (grounded) [fallback]', () => merge([part(BOX(3.975, 0.69, 0.6375), 0, 0.365, 0, '#fff'), part(BOX(3.99, 0.03, 0.65), 0, 0.715, 0, '#fff'), part(BOX(0.05, 0.6, 0.6), -2.0, 0.36, 0, '#d0d0d0')]));
// 933-3885 auto island canopy 6 x 1-7/8 in, 16 ft clear (1.2 in): 4 posts, white deck with red fascia, 4 pump islands + dispensers along X
D('walthers-933-3885-canopy', 'Gas station pump canopy + islands (933-3885) [fallback]', () => { const P = [part(BOX(6.0, 0.1, 1.875), 0, 1.25, 0, '#f4f4f4'), part(BOX(6.02, 0.08, 1.895), 0, 1.2, 0, '#c8202a')];
  for (const x of [-2.25, -0.75, 0.75, 2.25]) P.push(part(BOX(0.9, 0.04, 0.22), x, 0.02, 0, '#cfcfcf'), part(BOX(0.12, 0.36, 0.1), x - 0.25, 0.22, 0, '#e8e8e8'), part(BOX(0.12, 0.36, 0.1), x + 0.25, 0.22, 0, '#e8e8e8'), part(BOX(0.06, 1.2, 0.06), x, 0.6, 0, '#d0d0d0'));
  return merge(P); });
/* [FIX-2/10 2026-10-17] road signs + rail safety appliances (1:160 inches): stop 7 ft, speed limit, traffic signal mast, derail (rail-mounted, yellow) + sign */
const post = (h, c = '#8a8e92') => part(CYL(0.012, 0.012, h, 5), 0, h / 2, 0, c);
D('sign-stop', 'Stop sign (30 in octagon on 7 ft post)', () => merge([post(0.55), part(CYL(0.095, 0.095, 0.012, 8), 0, 0.6, 0, '#c8102e', Math.PI / 2, Math.PI / 8)]));
D('sign-speed', 'Speed limit sign', () => merge([post(0.55), part(BOX(0.012, 0.18, 0.14), 0, 0.6, 0, '#f4f4f4')]));
D('sign-generic', 'Road sign', () => merge([post(0.55), part(BOX(0.012, 0.14, 0.16), 0, 0.6, 0, '#e8c020')]));
D('sign-derail', 'DERAIL sign (yellow, low post)', () => merge([post(0.25), part(BOX(0.012, 0.08, 0.16), 0, 0.27, 0, '#f0c800')]));
D('traffic-signal', 'Traffic signal mast arm', () => merge([post(1.4, '#5a5e62'), part(BOX(1.2, 0.03, 0.03), 0.6, 1.38, 0, '#5a5e62'), part(BOX(0.05, 0.22, 0.07), 1.1, 1.24, 0, '#2a2a2a'), part(BOX(0.05, 0.22, 0.07), 0.6, 1.24, 0, '#2a2a2a')]));
D('derail', 'Hinged derail (Hayes HB, on the rail) + DERAIL sign', () => merge([part(BOX(0.14, 0.03, 0.06), 0, 0.02, 0, '#f0c800'), part(BOX(0.02, 0.05, 0.02), 0.06, 0.04, 0.03, '#f0c800'), part(CYL(0.008, 0.008, 0.24, 4), 0, 0.12, 0.35, '#8a8e92'), part(BOX(0.012, 0.07, 0.14), 0, 0.25, 0.35, '#f0c800')]));
D('load-container-chassis', 'Intermodal chassis with 53 ft container [fallback]', () => merge([part(BOX(3.95, 0.04, 0.5), 0, 0.2, 0, '#2a2a2a'), ...[-1.6, -1.35].flatMap(x => [part(CYL(0.12, 0.12, 0.56, 8), x, 0.12, 0, '#1a1a1a', Math.PI / 2)]), part(BOX(3.975, 0.69, 0.6375), 0, 0.57, 0, '#fff')]));
D('load-trailer-53', '53 ft dry van trailer (parked, landing gear down) [fallback]', () => merge([part(BOX(3.975, 0.78, 0.64), 0, 0.62, 0, '#f0f0f0'), ...[-1.65, -1.4].map(x => part(CYL(0.12, 0.12, 0.6, 8), x, 0.12, 0, '#1a1a1a', Math.PI / 2)), part(BOX(0.04, 0.22, 0.5), 1.4, 0.12, 0, '#4a4a4a')]));
const PROC_FB = new Set(['load-coil-rack', 'load-container-53', 'walthers-933-3885-canopy', 'load-container-chassis', 'load-trailer-53']), BOXCOL = ['#c8a020', '#e06a1a', '#9aa0a6', '#1f4f8a', '#b71c1c', '#eeeeee'];
const RUST = ['#7a3a22', '#5a4a3a', '#8a5a2a', '#3a4a5a', '#6a6a60', '#8a2a20', '#4a5a40', '#a08a5a'];
L3D.props = { build(o, C) {
  const L = o.L, PR = L.props || [], T = o.terrain, Y = (x, z) => o.deck + (T ? T.h(x, z) : 0) + 0.005, by = {}, cc = new THREE.Color();
  const FREE = new Set(['junk-car', 'headstone', 'cedar', 'horse', 'trough', 'stump', 'tie-stack', 'jump', 'car-stack', 'hay-bale']);
  const ok = p => C.onBoard(o, p.x, p.y, 0.1) && (p.near || C.trackDist(o, p.x, p.y, 1) > 0.45) && /* [FIX-10] signs/derails may stand close to the rail */ !(FREE.has(p.kind) && C.occupied(o, p.x, p.y, 0.35));
  for (const p of PR) if (ok(p)) (by[p.kind] = by[p.kind] || []).push(p);
  const XH = id => !!(L3D.ext && L3D.ext.has && L3D.ext.has(id));
  for (const s of L.structures) if (/hay storage|hay barn/i.test(s.name) && !XH('walthers-933-3853-hay')) for (let i = 0; i < 6; i++) (by['hay-bale'] = by['hay-bale'] || []).push({ x: s.r[0] - 0.35 - (i % 2) * 0.42, y: s.r[1] + 0.5 + Math.floor(i / 2) * 0.45, a: 0 });
  /* [INGEST batch8] horse farm hay: round bales and one stacked row in the lot beside the hay pole barn (fed from the barn, as on real small horse farms) */
  for (const s of L.structures) if (/hay storage/i.test(s.name) && XH('hay-bale')) { const x0 = s.r[0] - 0.42; (by['hay-bale-stack'] = by['hay-bale-stack'] || []).push({ x: x0, y: s.r[1] + 0.9, a: Math.PI / 2 });
    for (let i = 0; i < 3; i++) { const q = { x: x0 - 0.05 + (i % 2) * 0.1, y: s.r[1] + 2.0 + i * 0.42, a: i * 0.7 }; if (C.onBoard(o, q.x, q.y, 0.1) && !C.occupied(o, q.x, q.y, 0.25)) (by['hay-bale'] = by['hay-bale'] || []).push(q); } }
  const G = { horse: 'horse', 'junk-car': 'veh-sedan', 'tow-pickup': 'veh-pickup', cedar: 'tree-cedar', jonboat: 'boat', billboard: 'billboard' };
  const _cnt = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length]));
  /* [VARIANT-HOOK 2026-10-16] ingested grok-sim glbs replace the procedural stand-ins (same id as the prop kind unless mapped here); load-* kinds
     (pad/pit dressing from export_plan) are glb-only and are skipped until ingested. p.sx stretches along X (pipe bridge span). */
  const XID = { substation: ['ws-785-2253', 'substation'], horse: null, jump: ['jump', 'jump-oxer'] /* [INGEST batch8] riding ring: vertical + oxer */, 'junk-car': ['junk-car', 'junk-pickup'], 'tow-pickup': ['veh-pickup'] /* [R34] hitched rig tow vehicle */ }, _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _E = new THREE.Euler(), _V = new THREE.Vector3(), _S = new THREE.Vector3();
  const xinst = (id, list) => { const mats = list.map(p => _M.compose(_V.set(p.x, Y(p.x, p.y) + (p.dy || 0), p.y), _Q.setFromEuler(_E.set(0, p.a || 0, 0)), _S.set(p.sx || 1, 1, p.sz || 1)).clone()); L3D.ext.instance(o.g, id, mats); };
  /* [WIRE batch8-addendum 2026-10-19] ruin.glb (3 x 3 in slab) scaled to the planned foundation w x d; chimney.glb stands at one gable end where the plan
     marks a chimney (burned-out farmhouse). Grounded 53 ft boxes (load-container-53.glb, 2 high) in the row behind each container chassis on the ramp pad. */
  if (by.ruin && XH('ruin')) { for (const p of by.ruin) { p.sx = (p.w || 3) / 3; p.sz = (p.d || 3) / 3; }
    if (XH('chimney')) xinst('chimney', by.ruin.filter(p => p.chimney).map(p => { const ox = (p.w || 3) / 2 - 0.3; return { x: p.x + Math.cos(p.a || 0) * ox, y: p.y - Math.sin(p.a || 0) * ox, a: p.a || 0 }; })); }
  if (by['load-container-chassis'] && XH('load-container-53')) { const cs = []; for (const p of by['load-container-chassis']) for (const dyy of [-0.85, 0.85, -1.7, 1.7]) { const q = { x: p.x, y: p.y + dyy, a: p.a || 0 }, ends = [-1.99, -1.0, 0, 1.0, 1.99].map(t => [q.x + Math.cos(q.a) * t, q.y - Math.sin(q.a) * t]); if (ends.every(([ex, ey]) => C.onBoard(o, ex, ey, 0.25) && C.trackDist(o, ex, ey, 1.5) > 0.98 /* [R28 item 7] box half-width 0.16 + 0.75 clearance + curve overhang */ && !L.structures.some(t => ex > t.r[0] - 0.2 && ex < t.r[2] + 0.2 && ey > t.r[1] - 0.2 && ey < t.r[3] + 0.2) && !PR.some(r => r !== p && /^load-(container|trailer)/.test(r.kind) && Math.abs(r.y - ey) < 0.7 && Math.abs(r.x - ex) < 2.3)))   /* on the ramp pad (a lot, so C.occupied is always true there): clear of buildings and the other chassis rows */ { cs.push(q); if (L3D.hash(p.x + 'stk') < 0.6) cs.push({ ...q, dy: 0.713 }); break; } } if (cs.length) xinst('load-container-53', cs); }
  for (const k of Object.keys(by)) {
    const list = by[k];
    if (k === 'horse' && L3D.logistics && L3D.logistics.active) { delete by[k]; continue; }   // [LOGI] horses graze / work the ring in logistics.js
    if (k === 'horse') { const rid = list.filter(p => p.rider), stand = list.filter(p => !p.rider), g = XH('horse-grazing');
      if (XH('horse-rider') && rid.length) { xinst('horse-rider', rid); by[k] = by[k].filter(p => !p.rider); }
      if (XH('horse') && stand.length) { xinst('horse', g ? stand.filter((p, i) => i % 3 !== 2) : stand); if (g) xinst('horse-grazing', stand.filter((p, i) => i % 3 === 2)); by[k] = by[k].filter(p => p.rider); }
      if (!by[k].length) delete by[k]; continue; }
    const ids = (XID[k] || [k]).filter(XH);
    if (ids.length) { ids.forEach((id, j) => xinst(id, list.filter((p, i) => i % ids.length === j))); delete by[k]; continue; }
    if (/^load-|^struct-|^walthers-|^ws-/.test(k) && !PROC_FB.has(k)) delete by[k];   /* [WIRE] coil rack / grounded container keep a procedural fallback */
  }
  for (const [k, list] of Object.entries(by)) {
    if (k === 'horse') { /* [REALISM] rebuilt horses (likeness.js): bay / chestnut / sorrel / grey / black coats, every third loose horse grazing */
      const coat = p => cc.set(['#6a3a1e', '#3a2414', '#8a4a26', '#c8c0b0', '#2a1a12', '#7a5a3a'][Math.floor(L3D.hash(p.x + ',' + p.y) * 6)]).clone(), BM = L3D.bakedMat ? { mat: L3D.bakedMat() } : {};
      for (const [gid, LL] of [['horse-rider', list.filter(p => p.rider)], ['horse', list.filter((p, i) => !p.rider && (i % 3 !== 2 || !L3D.likenessPeople))], ['horse-grazing', L3D.likenessPeople ? list.filter((p, i) => !p.rider && i % 3 === 2) : []]])
        if (LL.length) C.inst(o, L3D.geo(gid), LL, p => [p.x, Y(p.x, p.y), p.y, p.a, [1, 1, 1], coat(p)], Object.assign({ key: 'plain', cast: true, detail: 160 }, BM)); continue; }
    if (k === 'ruin') { C.inst(o, L3D.geo('ruin'), list, p => [p.x, Y(p.x, p.y), p.y, p.a, [p.w || 1.8, 1, p.d || 1.4], cc.set('#a09a8a').clone()], { key: 'plain', detail: 200 });
      const ch = list.filter(p => p.chimney); C.inst(o, L3D.geo('chimney'), ch, p => [p.x + 0.7, Y(p.x, p.y), p.y - 0.4, p.a], { key: 'plain', cast: true, detail: 260 }); continue; }
    const geo = L3D.geo(G[k] || k), big = ['cell-tower', 'substation', 'billboard', 'ballast-pile', 'load-container-53', 'load-coil-rack'].includes(k);
    C.inst(o, geo, list, p => { let col = null, sc = [1, 1, 1], y = Y(p.x, p.y);
      if (k === 'junk-car') { col = cc.set(RUST[Math.floor(L3D.hash(p.x * 3 + p.y) * RUST.length)]).clone(); y -= 0.03; }
      if (k === 'tie-stack') col = cc.set('#4a3626').clone(); if (k === 'cedar') { const h = 2.0 + L3D.hash(p.x) * 1.0; sc = [h, h, h]; col = cc.setHSL(0.31, 0.4, 0.2).clone(); }
      if (k === 'headstone') col = cc.set(L3D.hash(p.y) < 0.5 ? '#c8c4bc' : '#9a968e').clone(); if (k === 'hay-bale') col = cc.set('#c8b070').clone(); if (k === 'jonboat') col = cc.set('#6a7a5a').clone(); if (k === 'load-container-53' || k === 'load-container-chassis') col = cc.set(BOXCOL[Math.floor(L3D.hash(p.x * 7 + p.y) * BOXCOL.length)]).clone();
      return [p.x, y, p.y, p.a, sc, col]; }, { key: 'plain', cast: big || k === 'horse-trailer', detail: big ? 900 : 220 });
  }
  o.propsCount = _cnt;
} };
})(window.L3D);
