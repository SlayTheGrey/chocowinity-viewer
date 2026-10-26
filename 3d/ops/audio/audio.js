/* OpsAudio — reusable Web Audio module (ops game + layout3d viewer). All sounds are synthesised procedurally (see SOURCES.md):
   no network, works from file://. Spatial audio with PannerNode (HRTF, inverse distance falloff, plan inches as units).
   API (window.OpsAudio):
     const A = OpsAudio.create({ unitsPerMetre: 1 })       // units = your world units (plan inches for the ops game)
     A.start()                         // call from a user gesture (first click); safe to call repeatedly
     A.setListener(x, y, z, yawRad)    // listener position/heading (top-down: y = plan y, z = height)
     A.attachToTrain(id, () => ({x, y, z, speedMph, notch, curve, braking, dir}), {model:'EMD'|'GE'})  // continuous engine/rail sounds
     A.detachTrain(id)
     A.playAt(name, {x, y, z}, opts)   // one-shots: 'coupler', 'airhose', 'turnout', 'brakehiss', 'squeal', 'clank', 'derail'
     A.horn(id|pos, pattern)           // pattern: 'crossing' (long-long-short-long), 'short', 'long', 'twoShort' (ahead), 'threeShort' (back)
     A.bell(id, on)                    // locomotive bell on/off
     A.crossing(key, pos, on)          // grade-crossing bells on/off at pos
     A.setAmbient({ hour, water:[{x,y}], industry:[{x,y}], roads:[{x,y}] })  // birds by day, crickets at night, frogs near water, hum near plants, traffic
     A.setVolume(category, v)          // categories: master, engines, horns, effects, ambient (0..1)
     A.toggleMute() / A.muted
   Everything degrades silently when Web Audio is unavailable (node / headless tests). */
(function (root) {
'use strict';
function create(opt = {}) {
  const S = { ctx: null, started: false, muted: false, vol: { master: 0.8, engines: 0.8, horns: 0.8, effects: 0.8, ambient: 0.5 }, gains: {}, trains: {}, xings: {}, amb: null, listener: { x: 0, y: 0, z: 0 } };
  const U = opt.unitsPerMetre || 1;
  function start() {
    if (S.started) { S.ctx && S.ctx.resume && S.ctx.resume(); return true; }
    const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return false;
    S.ctx = new AC(); S.started = true;
    S.gains.master = S.ctx.createGain(); S.gains.master.connect(S.ctx.destination);
    for (const k of ['engines', 'horns', 'effects', 'ambient']) { S.gains[k] = S.ctx.createGain(); S.gains[k].connect(S.gains.master); }
    applyVol(); S.noise = noiseBuffer(2); S.brown = noiseBuffer(2, true); ambientInit(); loadSamples(); return true;
  }
  // real recordings (audio/samples.js, optional): decoded once; every sound keeps its synthesized fallback
  S.buf = {}; S.useSamples = opt.samples !== false;
  function loadSamples() { const L = root.OpsAudioSamples; if (!L || !S.useSamples) return;
    for (const k in L) { try { const bin = atob(L[k]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const p = S.ctx.decodeAudioData(u.buffer, b => { S.buf[k] = b; }, () => {}); if (p && p.catch) p.catch(() => {}); } catch (e) {} } }
  function smp(k) { return S.useSamples ? S.buf[k] : null; }
  function applyVol() { if (!S.ctx) return; S.gains.master.gain.value = S.muted ? 0 : S.vol.master; for (const k of ['engines', 'horns', 'effects', 'ambient']) S.gains[k].gain.value = S.vol[k]; }
  function noiseBuffer(sec, brown) { const n = S.ctx.sampleRate * sec, b = S.ctx.createBuffer(1, n, S.ctx.sampleRate), d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    // seamless loop: crossfade the ends
    const f = Math.min(2000, n / 4); for (let i = 0; i < f; i++) { const a = i / f; d[i] = d[i] * a + d[n - f + i] * (1 - a); } return b; }
  function panner(pos) { const p = S.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 8 * U; p.maxDistance = 600 * U; p.rolloffFactor = 1.2; setPos(p, pos); return p; }
  function setPos(p, pos) { if (!pos) return; const t = S.ctx.currentTime; if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, 0.05); p.positionY.setTargetAtTime(pos.z || 0, t, 0.05); p.positionZ.setTargetAtTime(pos.y, t, 0.05); } else p.setPosition(pos.x, pos.z || 0, pos.y); }
  function setListener(x, y, z, yaw = 0) { S.listener = { x, y, z }; if (!S.ctx) return; const L = S.ctx.listener, t = S.ctx.currentTime;
    if (L.positionX) { L.positionX.setTargetAtTime(x, t, 0.05); L.positionY.setTargetAtTime(z || 0, t, 0.05); L.positionZ.setTargetAtTime(y, t, 0.05);
      L.forwardX.setTargetAtTime(Math.cos(yaw), t, 0.05); L.forwardY.value = 0; L.forwardZ.setTargetAtTime(Math.sin(yaw), t, 0.05); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(x, z || 0, y); L.setOrientation(Math.cos(yaw), 0, Math.sin(yaw), 0, 1, 0); } }
  function src(buf, loop) { const s = S.ctx.createBufferSource(); s.buffer = buf; s.loop = !!loop; return s; }
  // ------------------------------------------------------------- continuous train sound
  function attachToTrain(id, getState, o = {}) {
    if (!S.ctx) { S.trains[id] = { pending: [getState, o] }; return; }
    const c = S.ctx, out = panner(getState()), g = c.createGain(); g.gain.value = 0; g.connect(out); out.connect(S.gains.engines);
    // prime mover: two detuned pulse-ish oscillators through a resonant lowpass + firing-rate AM
    const ge = o.model === 'GE';
    const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4; lp.frequency.value = 220;
    const am = c.createGain(), lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = 8; lfoG.gain.value = 0.35; lfo.connect(lfoG); lfoG.connect(am.gain); am.gain.value = 0.6;
    o1.connect(lp); o2.connect(lp); lp.connect(am);
    const turbo = src(S.noise, true), tf = c.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = ge ? 2600 : 1800; tf.Q.value = 6; const tg = c.createGain(); tg.gain.value = 0;
    turbo.connect(tf); tf.connect(tg); tg.connect(g);
    const eg = c.createGain(); eg.gain.value = 0.5; am.connect(eg); eg.connect(g);
    // rail: rumble + flange squeal + clickety-clack
    const rum = src(S.brown, true), rg = c.createGain(); rg.gain.value = 0; rum.connect(rg); rg.connect(g);
    const sq = c.createOscillator(), sqg = c.createGain(), sqv = c.createOscillator(), sqvg = c.createGain(); sq.frequency.value = 3200; sqv.frequency.value = 6; sqvg.gain.value = 90; sqv.connect(sqvg); sqvg.connect(sq.frequency); sqg.gain.value = 0; sq.connect(sqg); sqg.connect(g);
    const hiss = src(S.noise, true), hf = c.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 3000; const hg = c.createGain(); hg.gain.value = 0; hiss.connect(hf); hf.connect(hg); hg.connect(g);
    for (const n of [o1, o2, lfo, turbo, rum, sq, sqv, hiss]) n.start();
    S.trains[id] = { getState, out, g, o1, o2, lp, lfo, tg, rg, sqg, hg, eg, ge, clack: 0, bellOn: false, bellT: 0 };
  }
  function detachTrain(id) { const t = S.trains[id]; if (!t) return; if (t.g) { t.g.gain.setTargetAtTime(0, S.ctx.currentTime, 0.1); setTimeout(() => { try { t.out.disconnect(); } catch (e) {} }, 400); } delete S.trains[id]; }
  function updateTrains(dt) {
    const c = S.ctx, now = c.currentTime;
    for (const id in S.trains) { const t = S.trains[id]; if (t.pending) { delete S.trains[id]; attachToTrain(id, ...t.pending); continue; }
      const st = t.getState(); if (!st) continue; setPos(t.out, st);
      const notch = Math.max(0, Math.min(8, st.notch || 0)), rpm = (t.ge ? 340 : 270) + notch * (t.ge ? 80 : 75);   // idle..run 8
      const fire = rpm / 60 * (t.ge ? 6 : 8);   // firing pulses / s
      t.o1.frequency.setTargetAtTime(fire, now, 0.6); t.o2.frequency.setTargetAtTime(fire * 0.5 * 1.01, now, 0.6); t.lfo.frequency.setTargetAtTime(fire / 4, now, 0.6);
      t.lp.frequency.setTargetAtTime(160 + notch * 70, now, 0.5); t.tg.gain.setTargetAtTime(notch > 3 ? 0.04 * (notch - 3) : 0, now, 0.8);
      t.g.gain.setTargetAtTime(st.loco === false ? 0.5 : 0.9, now, 0.3); t.eg.gain.setTargetAtTime(st.loco === false ? 0 : 0.35 + notch * 0.05, now, 0.3);
      const sp = Math.abs(st.speedMph || 0);
      if (!t.smp && st.loco !== false && smp('idle') && smp('moving')) { const a = src(smp('idle'), true), b = src(smp('moving'), true), ga = c.createGain(), gb = c.createGain(); ga.gain.value = gb.gain.value = 0;
        a.connect(ga); b.connect(gb); ga.connect(t.g); gb.connect(t.g); a.start(now, Math.random() * 4); b.start(now, Math.random() * 4); t.smp = { a, b, ga, gb }; }
      if (t.smp) { const mix = Math.min(1, sp / 15); t.smp.a.playbackRate.setTargetAtTime(0.9 + notch * 0.04, now, 0.6); t.smp.b.playbackRate.setTargetAtTime(0.85 + notch * 0.05, now, 0.6);
        t.smp.ga.gain.setTargetAtTime(0.8 * (1 - mix) + 0.15, now, 0.4); t.smp.gb.gain.setTargetAtTime(0.9 * mix, now, 0.4); t.eg.gain.setTargetAtTime(0.06 + notch * 0.015, now, 0.3); }
      t.rg.gain.setTargetAtTime(Math.min(0.25, sp / 160), now, 0.3);
      t.sqg.gain.setTargetAtTime(st.curve && sp > 3 ? Math.min(0.05, 0.004 * sp * st.curve) : 0, now, 0.2);
      t.hg.gain.setTargetAtTime(st.braking ? 0.05 : 0, now, 0.15);
      // clickety-clack: N-scale prototype 39 ft rails -> joints every 2.9 in; two trucks per car
      if (sp > 1) { t.clack += dt * sp * 17.6 / 160 / 2.9; if (t.clack >= 1) { t.clack -= 1; clack(t.out, Math.min(1, sp / 40)); setTimeout(() => clack(t.out, Math.min(1, sp / 40) * 0.8), 1000 * Math.min(0.25, 0.9 / Math.max(1, sp))); } }
      if (t.bellOn && now >= t.bellT) { t.bellT = now + 0.62; ding(t.out, 820, 0.18); }
    }
  }
  function clack(out, k) { const c = S.ctx, s = src(S.noise), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
    const t = c.currentTime; g.gain.setValueAtTime(0.18 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.06); }
  function ding(out, f0, amp, cat) { const c = S.ctx, t = c.currentTime, g = c.createGain(); g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); g.connect(out || S.gains[cat || 'effects']);
    for (const [m, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]]) { const o = c.createOscillator(); o.frequency.value = f0 * m; const og = c.createGain(); og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.95); } }
  // ------------------------------------------------------------- one-shots
  function playAt(name, pos, o = {}) {
    if (!S.ctx) return; const c = S.ctx, t = c.currentTime, out = panner(pos), g = c.createGain(); out.connect(S.gains.effects); g.connect(out);
    const burst = (f, q, a, d, type = 'bandpass', off = 0) => { const s = src(S.noise), fl = c.createBiquadFilter(), gg = c.createGain(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      gg.gain.setValueAtTime(a, t + off); gg.gain.exponentialRampToValueAtTime(0.001, t + off + d); s.connect(fl); fl.connect(gg); gg.connect(g); s.start(t + off, Math.random()); s.stop(t + off + d + 0.05); };
    const tone = (f, a, d, off = 0, type = 'sine') => { const os = c.createOscillator(), gg = c.createGain(); os.type = type; os.frequency.value = f; gg.gain.setValueAtTime(a, t + off); gg.gain.exponentialRampToValueAtTime(0.001, t + off + d); os.connect(gg); gg.connect(g); os.start(t + off); os.stop(t + off + d + 0.05); };
    g.gain.value = o.gain || 1;
    switch (name) {
      case 'coupler': burst(1400, 8, 0.8, 0.12); tone(620, 0.25, 0.25, 0, 'triangle'); tone(1730, 0.12, 0.18, 0.005); burst(300, 1, 0.4, 0.15, 'lowpass', 0.01); break;
      case 'clank': burst(900, 6, 0.5, 0.1); tone(480, 0.15, 0.2, 0, 'triangle'); break;
      case 'airhose': burst(5000, 0.7, 0.35, 1.4, 'highpass'); burst(2200, 2, 0.25, 0.2); break;
      case 'turnout': burst(2500, 5, 0.6, 0.03); tone(120, 0.12, 0.18, 0.0, 'sawtooth'); burst(1800, 4, 0.5, 0.03, 'bandpass', 0.16); break;
      case 'brakehiss': burst(4000, 0.8, 0.3, 1.2, 'highpass'); break;
      case 'squeal': { const os = c.createOscillator(), gg = c.createGain(); os.frequency.setValueAtTime(3100, t); os.frequency.linearRampToValueAtTime(2800, t + 1); gg.gain.setValueAtTime(0.06, t); gg.gain.linearRampToValueAtTime(0, t + 1.1); os.connect(gg); gg.connect(g); os.start(t); os.stop(t + 1.2); break; }
      case 'derail': burst(400, 0.7, 1, 0.8, 'lowpass'); burst(1500, 3, 0.6, 0.4); tone(90, 0.4, 0.6, 0, 'sawtooth'); break;
      case 'liftmotor': { const os = c.createOscillator(), gg = c.createGain(); os.type = 'sawtooth'; os.frequency.value = 95; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.12, t + 0.4); gg.gain.setValueAtTime(0.12, t + 7.6); gg.gain.linearRampToValueAtTime(0, t + 8); os.connect(lp); lp.connect(gg); gg.connect(g); os.start(t); os.stop(t + 8.1); break; }
      case 'click': tone(2000, 0.1, 0.03); break;
      default: tone(440, 0.1, 0.2);
    }
  }
  const NS_CHIME = [311.1, 370.0, 415.3, 493.9, 622.3];   // Nathan P5 (NS-style 5-chime), D#4 F#4 G#4 B4 D#5
  const PATTERNS = { crossing: [[1.6, 0.4], [1.6, 0.4], [0.6, 0.4], [2.6, 0]], short: [[0.5, 0]], long: [[1.6, 0]], twoShort: [[0.5, 0.35], [0.5, 0]], threeShort: [[0.45, 0.3], [0.45, 0.3], [0.45, 0]] };
  function horn(who, pattern = 'crossing') {
    if (!S.ctx) return; const c = S.ctx; const tr = typeof who === 'object' ? null : S.trains[who]; let out;
    if (tr && tr.out) out = tr.out; else { out = panner(who); out.connect(S.gains.horns); }
    const g = c.createGain(); g.connect(tr ? S.gains.horns : out); if (tr) { const p2 = panner(tr.getState()); p2.connect(S.gains.horns); g.disconnect(); g.connect(p2); }
    const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 2400; bp.connect(g);
    let t = c.currentTime + 0.02;
    if (smp('horn')) { for (const [dur, gap] of PATTERNS[pattern] || PATTERNS.short) { const s = src(smp('horn'), true); s.loopStart = 0.35; s.loopEnd = 2.1; const og = c.createGain();
        og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.9, t + 0.06); og.gain.setValueAtTime(0.9, t + dur - 0.08); og.gain.linearRampToValueAtTime(0, t + dur); s.connect(og); og.connect(g); s.start(t, 0.1); s.stop(t + dur + 0.05); t += dur + gap; }
      return; }
    for (const [dur, gap] of PATTERNS[pattern] || PATTERNS.short) {
      for (const f of NS_CHIME) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004); const og = c.createGain();
        og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.05, t + 0.08); og.gain.setValueAtTime(0.05, t + dur - 0.1); og.gain.linearRampToValueAtTime(0, t + dur); o.connect(og); og.connect(bp); o.start(t); o.stop(t + dur + 0.05); }
      t += dur + gap; }
  }
  function bell(id, on) { const t = S.trains[id]; if (t) t.bellOn = on; }
  function crossing(key, pos, on) { if (!S.ctx) return; let x = S.xings[key];
    if (on && !x) { const out = panner(pos); out.connect(S.gains.effects);
      if (smp('crossing')) { const s = src(smp('crossing'), true), g = S.ctx.createGain(); g.gain.value = 0.7; s.connect(g); g.connect(out); s.start(); x = S.xings[key] = { out, s }; }
      else x = S.xings[key] = { out, iv: setInterval(() => ding(out, 1250, 0.25), 520) }; }
    if (!on && x) { clearInterval(x.iv); if (x.s) try { x.s.stop(S.ctx.currentTime + 0.3); } catch (e) {} setTimeout(() => { try { x.out.disconnect(); } catch (e) {} }, 1000); delete S.xings[key]; } }
  // ------------------------------------------------------------- ambient
  function ambientInit() { const c = S.ctx; S.amb = { birdsT: 0, frogT: 0, cricket: null, traffic: null, hum: [], frogs: [] };
    const tr = src(S.brown, true), tf = c.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 350; const tg = c.createGain(); tg.gain.value = 0.05; tr.connect(tf); tf.connect(tg); tg.connect(S.gains.ambient); tr.start(); S.amb.traffic = tg;
    const cr = c.createOscillator(); cr.frequency.value = 4500; const cg = c.createGain(); cg.gain.value = 0; const am = c.createOscillator(); am.type = 'square'; am.frequency.value = 28; const amg = c.createGain(); amg.gain.value = 0.5; am.connect(amg); amg.connect(cg.gain);
    const crg = c.createGain(); crg.gain.value = 0; cr.connect(cg); cg.connect(crg); crg.connect(S.gains.ambient); cr.start(); am.start(); S.amb.cricket = crg; }
  function setAmbient(a) { S.ambCfg = a; }
  function updateAmbient(dt) {
    const c = S.ctx, a = S.ambCfg || {}, hour = a.hour === undefined ? 12 : a.hour, day = hour > 6 && hour < 19.5, now = c.currentTime;
    S.amb.cricket.gain.setTargetAtTime(day ? 0 : 0.012, now, 2); S.amb.traffic.gain.setTargetAtTime(day ? 0.05 : 0.02, now, 2);
    S.amb.birdsT -= dt; if (day && S.amb.birdsT <= 0) { S.amb.birdsT = 1 + Math.random() * 4; bird(); }
    S.amb.frogT -= dt; const L = S.listener; const nearW = (a.water || []).some(w => Math.hypot(w.x - L.x, w.y - L.y) < 60);
    if (smp('frogs')) { if (!S.amb.frogLoop) { const s = src(smp('frogs'), true), g = c.createGain(); g.gain.value = 0; s.connect(g); g.connect(S.gains.ambient); s.start(); S.amb.frogLoop = g; }
      S.amb.frogLoop.gain.setTargetAtTime(nearW ? (day ? 0.08 : 0.35) : (day ? 0 : 0.05), now, 1.5); }
    else if (nearW && S.amb.frogT <= 0) { S.amb.frogT = 0.8 + Math.random() * (day ? 6 : 1.5); frog(); }
    const nearI = (a.industry || []).some(p => Math.hypot(p.x - L.x, p.y - L.y) < 25);
    if (nearI && !S.amb.humNode) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; const g = c.createGain(); g.gain.value = 0.02; o.connect(f); f.connect(g); g.connect(S.gains.ambient); o.start(); S.amb.humNode = { o, g }; }
    if (!nearI && S.amb.humNode) { S.amb.humNode.g.gain.setTargetAtTime(0, now, 0.5); const h = S.amb.humNode; setTimeout(() => h.o.stop(), 1500); S.amb.humNode = null; }
  }
  function bird() { const c = S.ctx, t = c.currentTime, n = 2 + Math.floor(Math.random() * 4), base = 2500 + Math.random() * 2500; const p = c.createStereoPanner ? c.createStereoPanner() : c.createGain(); if (p.pan) p.pan.value = Math.random() * 2 - 1; p.connect(S.gains.ambient);
    for (let i = 0; i < n; i++) { const o = c.createOscillator(), g = c.createGain(), t0 = t + i * 0.13; o.frequency.setValueAtTime(base, t0); o.frequency.exponentialRampToValueAtTime(base * (0.6 + Math.random() * 0.8), t0 + 0.09);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.03, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1); o.connect(g); g.connect(p); o.start(t0); o.stop(t0 + 0.12); } }
  function frog() { const c = S.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = 110 + Math.random() * 60; f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 3;
    const am = c.createOscillator(), ag = c.createGain(); am.frequency.value = 30; ag.gain.value = 0.02; am.connect(ag); ag.connect(g.gain);
    g.gain.setValueAtTime(0.02, t); g.gain.setValueAtTime(0, t + 0.35); o.connect(f); f.connect(g); g.connect(S.gains.ambient); o.start(t); am.start(t); o.stop(t + 0.4); am.stop(t + 0.4); }
  let last = 0;
  function frame(nowMs) { if (S.ctx && !S.muted) { const dt = Math.min(0.1, (nowMs - last) / 1000 || 0.016); updateTrains(dt); updateAmbient(dt); } last = nowMs; root.requestAnimationFrame && root.requestAnimationFrame(frame); }
  root.requestAnimationFrame && root.requestAnimationFrame(frame);
  return { start, setListener, attachToTrain, detachTrain, playAt, horn, bell, crossing, setAmbient,
    setVolume(cat, v) { S.vol[cat] = v; applyVol(); }, getVolume(cat) { return S.vol[cat]; },
    setSamples(on) { S.useSamples = !!on; if (on && S.ctx && !Object.keys(S.buf).length) loadSamples(); }, get samplesLoaded() { return Object.keys(S.buf); },
    toggleMute() { S.muted = !S.muted; applyVol(); return S.muted; }, get muted() { return S.muted; }, get started() { return S.started; }, _state: S };
}
const API = { create };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.OpsAudio = API;
})(typeof window !== 'undefined' ? window : globalThis);
