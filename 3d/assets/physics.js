/* L3DPhysics — shared train dynamics for the layout3d viewer, the 3D ops session and the 2D ops sim (and node tests).
   Real (prototype) physics, scaled to N 1:160: forces in lbf, masses in short tons, speeds in scale mph.
   Model time is real time, so a scale speed V mph = V * 17.6 / 160 in/s and a scale acceleration a mph/s = a * 17.6 / 160 in/s^2.
   - Locomotive tractive effort: TE(notch, v) = min(adhesion-limited starting TE, notch power * 375 * eta / v)   (hp -> lbf)
   - Train resistance: modified Davis (AREMA): R [lb/ton] = 0.6 + 20/w + 0.01 V + K V^2 / (w n)   (w = tons/axle, n = axles)
   - Grade 20 lb/ton per 1 %; curve 0.8 lb/ton per degree of curvature (D = 5729.6 / R_ft, R_ft = scale radius in feet)
   - Automatic air brake: brake-pipe reduction 0..1 (full service), cylinder pressure follows with apply/release lag; NBR 10 % loaded / 22 % empty
   - Independent brake on the locomotives only (NBR 18 %), emergency = 1.3 x full service, rotating-mass factor 1.05
   - Coupler slack: 6 in (prototype) per coupler, taken up in draft / bunched in buff (drawn and used for car spacing) */
(function (root) { 'use strict';
const SCALE = 160, G = 32.174, FT_PER_MPH = 1.46667;
const IPS = mph => mph * 17.6 / SCALE, MPH = ips => ips * SCALE / 17.6;
const SLACK_IN = 6 / SCALE, SHOE_MU = 0.35;   // composite shoe friction: retarding force = mu x shoe force (NBR x weight)                         // model inches per coupler
const LIMITS = { yard: 10, spur: 10, siding: 15, lift: 10, main: 40, mainFast: 60, turnout4: 10, turnout6: 15 };
// prototype rolling stock: tons empty / loaded, axles, frontal area ft^2 (only the lead unit sees air drag)
const CARS = { h51: [32, 143], g32: [28, 100], cp: [30, 130], tk: [30, 100], gbrx: [38, 143], gon: [32, 120], coil: [38, 120], c60: [35, 110], rf: [45, 90],
  cb: [35, 110], f68: [32, 100], c89: [35, 80], well: [38, 140], ar: [50, 75], amfleet: [55, 55], boxcar: [35, 110], tank: [34, 120], hopper: [30, 130],
  covered_hopper: [32, 143], flat: [32, 100], gondola: [32, 120], reefer: [45, 90], autorack: [50, 75], centerbeam: [35, 110] };
const LOCOS = [ // [regex on model/type, tons, hp, starting TE lbf, max mph, axles]
  [/ET44|ES44|AC44|AC6000|Tier ?4/i, 216, 4400, 180000, 75, 6], [/SD70|SD60|SD75/i, 205, 4000, 113000, 70, 6], [/SD40|SD45/i, 184, 3000, 92000, 65, 6],
  [/Dash ?[89]|C40|C44|B40/i, 196, 4400, 108000, 70, 6], [/P42|P40|Genesis/i, 134, 4250, 66000, 110, 4], [/GP40|GP50|GP60/i, 139, 3000, 70000, 65, 4],
  [/GP38|GP39|GP35|GP7|GP9|GP15|GP18|GP20|gp38/i, 125, 2000, 64000, 65, 4], [/SW|MP15|NW2|switch/i, 124, 1500, 62000, 45, 4], [/./, 130, 2000, 64000, 65, 4]];
function locoSpec(model) { for (const L of LOCOS) if (L[0].test(String(model || ''))) return { tons: L[1], hp: L[2], te0: L[3], vmax: L[4], axles: L[5] }; return null; }
const hash = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
function carSpec(car) { // car: {type, loco, model, id, loaded?}
  if (car.loco) { const L = locoSpec(car.model || car.type); return Object.assign({ loco: true, loaded: 1 }, L); }
  const T = CARS[car.type] || CARS[String(car.type || '').replace(/[^a-z_]/g, '')] || [33, 100];
  const loaded = car.loaded != null ? (car.loaded ? 1 : 0) : (car.type === 'amfleet' ? 1 : (hash(car.id || car.type) % 3 ? 1 : 0));   // deterministic 2/3 loaded
  const tons = loaded ? T[1] : T[0]; return { loco: false, tons, axles: 4, loaded }; }
function davis(C, v) { return C.tons * 0.6 + 20 * C.axles + 0.01 * C.tons * v + 0.07 * v * v * C.n + (C.locos ? 0.0024 * 105 * v * v : 0); }   // lb; air drag 0.07 V^2 per car + lead-unit frontal area 105 ft^2
// a consist's static summary (cache on the cut; recompute when the car list changes)
function consist(cars) { let tons = 0, locoTons = 0, te0 = 0, hp = 0, brakeLb = 0, axles = 0, vmax = 80; const specs = cars.map(carSpec);
  for (const s of specs) { tons += s.tons; axles += s.axles; if (s.loco) { locoTons += s.tons; te0 += s.te0; hp += s.hp; vmax = Math.min(vmax, s.vmax); } brakeLb += SHOE_MU * (s.loco ? 0.18 : (s.loaded ? 0.10 * 143 / s.tons * s.tons / 143 : 0.22)) * s.tons * 2000; }
  return { n: cars.length, tons, locoTons, te0, hp, brakeLb, axles, vmax, locos: specs.filter(s => s.loco).length, specs }; }
const notchFrac = n => n <= 0 ? 0 : [0, 0.07, 0.15, 0.25, 0.37, 0.5, 0.64, 0.81, 1][Math.min(8, Math.round(n))];
/* forces [lbf] for speed v (scale mph, >= 0) in the direction of travel. ctl: {notch 0..8, auto 0..1 (cylinder), ind 0..1, emergency}
   env: {grade % (+ = uphill in the travel direction), radius (model inches; 0 / Infinity = tangent)} */
function forces(C, v, ctl, env) { env = env || {}; ctl = ctl || {};
  const p = notchFrac(ctl.notch || 0) * C.hp, te = C.locos ? Math.min(C.te0 * (notchFrac(ctl.notch || 0) > 0 ? Math.min(1, 0.35 + notchFrac(ctl.notch)) : 0), p * 375 * 0.82 / Math.max(v, 0.5)) : 0;
  const roll = davis(C, v);
  const grade = 20 * C.tons * (env.grade || 0);
  const Rft = env.radius && isFinite(env.radius) ? env.radius * SCALE / 12 : 0, curve = Rft ? 0.8 * C.tons * (5729.6 / Rft) : 0;
  const air = (ctl.emergency ? 1.3 : Math.min(1, ctl.auto || 0)) * C.brakeLb, ind = Math.min(1, ctl.ind || 0) * SHOE_MU * 0.18 * C.locoTons * 2000;
  return { te, roll, grade, curve, brake: air + ind, mass: C.tons * 2000 / G * 1.05 }; }
/* acceleration in scale mph/s along the direction of travel (dir: +1 / -1 is the reverser; v signed scale mph) */
function accel(C, v, ctl, env) { const sp = Math.abs(v), F = forces(C, sp, ctl, env), mv = sp < 0.05 ? (ctl.dir || 1) : Math.sign(v);
  const drive = F.te * (ctl.dir || 1); const resist = F.roll + F.curve + F.brake;      // always oppose motion
  let net = drive - F.grade * mv; // grade: + uphill in the direction of motion
  if (sp < 0.05) { if (Math.abs(net) <= resist) return 0; net -= Math.sign(net) * resist; } else net -= mv * resist;
  return net / F.mass / FT_PER_MPH; }
/* capability for speed-setpoint drivers (DCC decoders, AI crews): best acceleration (notch 8) and full-service braking at speed v */
function caps(C, v, env) { const sp = Math.abs(v); const up = Math.max(0.02, accel(C, sp, { notch: 8, dir: 1 }, env)); const F = forces(C, sp, { auto: 1 }, env);
  const dn = (F.roll + F.curve + F.brake) / F.mass / FT_PER_MPH; return { acc: up, dec: Math.max(0.05, dn), vmax: C.vmax }; }
/* integrate one step: returns new signed speed (scale mph). Stops cleanly at 0 when braking (no reversal by brakes/resistance). */
function step(C, v, ctl, env, dt) { const a = accel(C, v, ctl, env); let nv = v + a * dt; if (v !== 0 && Math.sign(nv) !== Math.sign(v) && Math.sign(a) !== (ctl.dir || 1) * 1 && !(ctl.notch > 0)) nv = 0; if (!(ctl.notch > 0) && (Math.abs(nv) < 0.01 || (Math.abs(nv) < 0.06 && ((ctl.auto || 0) + (ctl.ind || 0)) > 0.05))) nv = 0; return Math.max(-C.vmax, Math.min(C.vmax, nv)); }
/* brake cylinder lag: automatic brake applies at ~0.25 /s (service), releases at ~0.12 /s; independent ~0.6 /s */
function brakeLag(cur, target, dt, rateUp = 0.25, rateDn = 0.12) { return target > cur ? Math.min(target, cur + rateUp * dt) : Math.max(target, cur - rateDn * dt); }
/* stopping distance (model in) from v scale mph at full service, flat tangent */
function stopDist(C, v) { const c = caps(C, v, {}); const vi = IPS(Math.abs(v)), a = IPS(c.dec); return vi * vi / (2 * a); }
/* curve radius from three points (any units) */
function radius3(a, b, c) { const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); return cr < 1e-9 ? Infinity : ab * bc * ca / (2 * cr); }
/* coupler slack: per-coupler state s in [-1 bunched, +1 stretched], driven by the sign of the in-train force; returns model-inch offset of car i */
function slackUpdate(st, n, a, dt) { st.s = st.s == null ? 0 : st.s; const tgt = a > 0.02 ? 1 : a < -0.02 ? -1 : st.s; st.s += Math.max(-dt * 3, Math.min(dt * 3, tgt - st.s)); return st.s; }
const slackOffset = (st, i) => (st && st.s || 0) * SLACK_IN * i / 2;
const API = { SCALE, IPS, MPH, LIMITS, CARS, LOCOS, SLACK_IN, locoSpec, carSpec, consist, forces, accel, caps, step, brakeLag, stopDist, radius3, slackUpdate, slackOffset, notchFrac };
if (typeof module !== 'undefined' && module.exports) module.exports = API; root.L3DPhysics = API;
})(typeof window !== 'undefined' ? window : globalThis);
