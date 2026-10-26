/* RadioVoice — plays pre-rendered neural (Kokoro-82M) radio voices from per-voice Opus sprite packs through a live
   Web Audio radio chain (key-up click, 300-3000 Hz band-pass, compression, saturation, hiss, squelch tail).
   Works from file:// (packs are <script>-loaded base64; no fetch). Falls back to speechSynthesis when a phrase
   has words with no clip (or the pack/decoder is unavailable).

   <script src="audio/voice/voices.js"></script><script src="audio/voice/radio-voice.js"></script>
   RadioVoice.init({ base: 'audio/voice/' });             // optional: ctx (AudioContext), volume, fx:true
   await RadioVoice.speak('disp', 'P20, track warrant 1 4 7. Box two ...');       // text
   await RadioVoice.speak('R60:cond', ['R60', 'shoving', 4, 'cars into', 'FAB Riverton Pipe & Steel', 'for a set-out', '.']);
   RadioVoice.coverage('disp', text) -> { ok, missing:[words], units:[keys] }
   Speaker ids = radio.js ids: 'disp','ym','det','<crewId>:eng','<crewId>:cond'. Unknown ids get a stable unused pool voice. */
(function (root) {
  'use strict';
  const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
  const TENS = 'zero ten twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
  const card = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  const digs = s => s.split('').map(c => ONES[+c]).join(' ');
  function numWords(s) {            // mirrors textnorm.num_words (railroad style: 211 -> two eleven)
    if (s.length > 1 && s[0] === '0') return digs(s); const n = +s;
    if (n < 100) return card(n);
    if (n < 1000) { if (n % 100 === 0) return ONES[Math.floor(n / 100)] + ' hundred'; const r = n % 100; return ONES[Math.floor(n / 100)] + ' ' + (r < 10 ? 'oh ' + ONES[r] : card(r)); }
    if (n < 10000) { const a = Math.floor(n / 100), b = n % 100; if (!b) return card(a) + ' hundred'; return card(a) + ' ' + (b < 10 ? 'oh ' + ONES[b] : card(b)); }
    return digs(s);
  }
  function norm(t) {                // mirrors textnorm.norm, but keeps sentence punctuation as separate marks
    t = String(t).toLowerCase().replace(/&/g, ' and ').replace(/\u2019/g, "'").replace(/(\d)\.(\d)/g, '$1 point $2')
      .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').replace(/\d+/g, m => ' ' + numWords(m) + ' ')
      .replace(/[.!?;]+/g, ' . ').replace(/[,:]/g, ' , ').replace(/[^a-z' .,]+/g, ' ').replace(/(^| )'|'( |$)/g, ' ');
    const out = []; for (const w of t.split(/\s+/)) { if (!w) continue; if (w === '.' || w === ',') { if (out.length) out[out.length - 1].p = out[out.length - 1].p === '.' ? '.' : w; } else out.push({ w, p: '' }); }
    return out;
  }
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const selfBase = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^/]*$/, '') : 'audio/voice/';   // pack/ lives next to this file
  const RV = { cfg: null, base: selfBase, ctx: null, vol: 0.9, fx: true, packs: {}, decoded: {}, loading: {}, chain: Promise.resolve(), fallbackOnly: false, onFeed: null };
  RV.init = (o = {}) => { Object.assign(RV, { cfg: o.config || root.RadioVoiceConfig || RV.cfg, base: o.base || RV.base, ctx: o.ctx || RV.ctx, vol: o.volume != null ? o.volume : RV.vol, fx: o.fx !== false }); RV.pool = {}; for (const v of RV.cfg.pool) RV.pool[v.id] = v; return RV; };
  RV.voiceOf = id => { const C = RV.cfg; let v = C.speakers[id]; if (v) return RV.pool[v]; RV._auto = RV._auto || {}; if (RV._auto[id]) return RV.pool[RV._auto[id]];
    const used = new Set([...Object.values(C.speakers), ...Object.values(RV._auto)]); let free = C.pool.filter(p => !used.has(p.id) && p.id !== 'v40'); if (!free.length) free = C.pool;
    v = free[hash(id) % free.length].id; RV._auto[id] = v; return RV.pool[v]; };
  // ---------------------------------------------------------------- pack loading (script tag => file:// safe)
  function loadPack(vid) {
    if (RV.loading[vid]) return RV.loading[vid];
    return (RV.loading[vid] = new Promise((res, rej) => { const P = root.RadioVoicePacks; if (P && P[vid]) return res(P[vid]);
      if (typeof document === 'undefined') return rej(new Error('no DOM')); const s = document.createElement('script'); s.src = RV.base + 'pack/' + vid + '.js';
      s.onload = () => (root.RadioVoicePacks && root.RadioVoicePacks[vid]) ? res(root.RadioVoicePacks[vid]) : rej(new Error('pack ' + vid)); s.onerror = () => { /* [VFIX] try sibling/nested part folders (window.L3DALT, viewer index.html) */ const rel = (root.VOICE_PACK_REL || 'ops/audio/voice/pack/') + vid + '.js', alt = (root.L3DALT ? root.L3DALT(rel) : []); const nx = () => { const u = alt.shift(); if (!u) { if (root.L3DPackMissing) try { root.L3DPackMissing(rel); } catch (e) { } return rej(new Error('pack ' + vid)); } const t = document.createElement('script'); t.src = u; t.onload = () => (root.RadioVoicePacks && root.RadioVoicePacks[vid]) ? res(root.RadioVoicePacks[vid]) : nx(); t.onerror = nx; document.head.appendChild(t); }; nx(); }; document.head.appendChild(s); }));
  }
  function ctx() { if (!RV.ctx && typeof AudioContext !== 'undefined') RV.ctx = new AudioContext(); if (RV.ctx && RV.ctx.state === 'suspended') RV.ctx.resume(); return RV.ctx; }
  async function decoded(vid) {
    if (RV.decoded[vid]) return RV.decoded[vid]; const P = await loadPack(vid); const c = ctx(); if (!c) throw new Error('no WebAudio');
    const bin = atob(P.ogg), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const buf = await c.decodeAudioData(u8.buffer); delete P.ogg; return (RV.decoded[vid] = { P, buf });
  }
  RV.preload = ids => Promise.all([...new Set(ids.map(i => RV.voiceOf(i).id))].map(v => decoded(v).catch(() => null)));
  // ---------------------------------------------------------------- tokens -> clip units (greedy longest match)
  function words(input) {
    if (!Array.isArray(input)) return norm(input); const W = [];
    for (const t of input) { if (t && typeof t === 'object' && t.pause) { if (W.length) W[W.length - 1].pause = t.pause; continue; }
      if (t === '.' || t === ',' || t === '?') { if (W.length) W[W.length - 1].p = t === ',' ? ',' : '.'; continue; } W.push(...norm(typeof t === 'number' ? String(t) : t)); }
    return W;
  }
  function plan(P, W) {
    const units = [], missing = []; const has = k => P.clips[k] || (P.alias[k] && P.clips[P.alias[k]]);
    for (let i = 0; i < W.length;) { let got = 0;
      for (let n = Math.min(14, W.length - i); n >= 1; n--) {
        const k = W.slice(i, i + n).map(x => x.w).join(' '); const c = has(k); if (c) { const last = W[i + n - 1]; const end = last.p === '.' || i + n === W.length;
          const v = (end && c.e) || c.m || c.e; units.push({ k, off: v[0], dur: v[1], p: last.p, end, pause: last.pause }); got = n; break; } }
      if (!got) { missing.push(W[i].w); i++; } else i += got; }
    return { units, missing };
  }
  RV.coverage = (id, input) => { const v = RV.voiceOf(id), P = root.RadioVoicePacks && root.RadioVoicePacks[v.id]; if (!P) return { ok: false, missing: ['<pack not loaded>'], units: [] };
    const r = plan(P, words(input)); return { ok: !r.missing.length, missing: r.missing, units: r.units.map(u => u.k) }; };
  // ---------------------------------------------------------------- playback through a radio chain
  function radioChain(c, t0, len) {
    const out = c.createGain(); out.gain.value = RV.vol; out.connect(c.destination); if (!RV.fx) return { input: out, out };
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300; hp.Q.value = 0.8; const hp2 = c.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 300;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.8; const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 3000;
    const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1800; pk.gain.value = 4; pk.Q.value = 1;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.12;
    const sh = c.createWaveShaper(); const cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cv[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); } sh.curve = cv;
    const pre = c.createGain(); pre.gain.value = 1.6;
    pre.connect(hp); hp.connect(hp2); hp2.connect(pk); pk.connect(comp); comp.connect(sh); sh.connect(lp); lp.connect(lp2); lp2.connect(out);
    const sr = c.sampleRate; if (!RV.noise) { const b = c.createBuffer(1, sr * 2, sr), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; RV.noise = b; }
    const nz = c.createBufferSource(); nz.buffer = RV.noise; nz.loop = true; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1500; nf.Q.value = 0.6; const ng = c.createGain();
    ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(0.012, t0 + 0.01); ng.gain.setValueAtTime(0.012, t0 + len); ng.gain.linearRampToValueAtTime(0.25, t0 + len + 0.012); ng.gain.exponentialRampToValueAtTime(0.0005, t0 + len + 0.24);
    nz.connect(nf); nf.connect(ng); ng.connect(out); nz.start(t0, Math.random()); nz.stop(t0 + len + 0.26);
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 1750; const og = c.createGain(); og.gain.setValueAtTime(0.06, t0); og.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.03); o.connect(og); og.connect(lp); o.start(t0); o.stop(t0 + 0.035);
    return { input: pre, out };
  }
  async function playClips(id, input, o) {
    const v = RV.voiceOf(id); const { P, buf } = await decoded(v.id); const r = plan(P, words(input));
    if (r.missing.length && !o.partial) return { mode: 'fallback', missing: r.missing };
    const c = ctx(); const t0 = c.currentTime + 0.05, lead = RV.fx ? 0.09 : 0; let t = t0 + lead; const sched = [];
    for (const u of r.units) { sched.push([t, u]); t += u.dur + (u.pause != null ? u.pause : u.p === '.' ? 0.3 : u.p === ',' ? 0.14 : 0.025); }
    const len = t - t0; const ch = radioChain(c, t0, len);
    for (const [st, u] of sched) { const s = c.createBufferSource(); s.buffer = buf; const g = c.createGain(); const f = 0.008;
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(1, st + f); g.gain.setValueAtTime(1, st + u.dur - f); g.gain.linearRampToValueAtTime(0, st + u.dur);
      s.connect(g); g.connect(ch.input); s.start(st, u.off, u.dur); }
    await new Promise(res => setTimeout(res, (len + (RV.fx ? 0.3 : 0.05)) * 1000 + 30)); return { mode: 'clips', missing: r.missing, units: r.units.length };
  }
  function playTTS(id, input) {
    return new Promise(res => { if (typeof speechSynthesis === 'undefined') return res({ mode: 'none' }); const v = RV.voiceOf(id), fb = v.fallback || {};
      const text = Array.isArray(input) ? input.map(t => (t && t.pause) ? ',' : t).join(' ').replace(/ ([.,?])/g, '$1') : String(input);
      const u = new SpeechSynthesisUtterance(text); const all = speechSynthesis.getVoices().filter(x => /^en[-_]US/i.test(x.lang)); if (all.length) u.voice = all[hash(v.id) % all.length];
      u.pitch = fb.pitch || 1; u.rate = (fb.rate || 1) * 1.05; u.volume = RV.vol; let done = false; const fin = () => { if (!done) { done = true; res({ mode: 'tts' }); } };
      u.onend = fin; u.onerror = fin; setTimeout(fin, 1500 + text.split(' ').length * 450); speechSynthesis.speak(u); });
  }
  /* speak(speakerId, textOrTokens, {queue=true, partial=false, onstart}) -> Promise<{mode:'clips'|'tts'|'none', missing?}>
     queue: serialize with other speak() calls (no talking over each other). partial: play clips even if some words are missing (skips them). */
  RV.speak = (id, input, o = {}) => {
    if (!RV.cfg) RV.init();
    const run = async () => { o.onstart && o.onstart(id, input); if (!RV.fallbackOnly) { try { const r = await playClips(id, input, o); if (r.mode === 'clips') return r; const f = await playTTS(id, input); f.missing = r.missing; return f; } catch (e) { /* pack/decoder unavailable */ } } return playTTS(id, input); };
    if (o.queue === false) return run(); const p = RV.chain.then(run, run); RV.chain = p.catch(() => null); return p;
  };
  RV.stop = () => { RV.chain = Promise.resolve(); if (RV.ctx) { RV.ctx.close(); RV.ctx = null; RV.decoded = {}; RV.noise = null; } if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); };
  RV.norm = norm; RV.numWords = numWords;
  root.RadioVoice = RV; if (typeof module !== 'undefined') module.exports = RV;
})(typeof window !== 'undefined' ? window : globalThis);
