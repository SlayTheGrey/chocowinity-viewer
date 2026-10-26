/* OpsRadio — two-way railroad radio for the ops sim (2D game + 3D overlay). ROUND4.
   Watches the engine (eng.log lines + live state) and turns it into US-style radio exchanges:
   dispatcher <-> crews (track warrants, repeat-backs, release), yardmaster, signal calls by through crews,
   conductor shoving countdowns, set-out/pick-up car counts, defect detectors, emergencies.
   Each speaker has a stable voice (distinct speechSynthesis voice when the browser has several, else pitch/rate),
   utterances are queued (nobody talks over anybody), and every transmission gets a key-up click + squelch tail
   through a 300-3000 Hz band-pass (Web Audio; speechSynthesis itself cannot be routed through Web Audio).
   Levels: 'essential' (authority, warrants, detectors, emergencies, clear-of-limits) or 'full' (+ switching chatter,
   signal calls, shove countdowns). chatter=false keeps only dispatcher/detector essentials.
   Works in node too (no speech): radio.transcript collects {t, who, text}. */
(function (root) {
  'use strict';
  const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const NUMW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const slot = (say, tok) => ({ say, tok, toString() { return say; } });   // a variable part of a line: spoken text + RadioVoice token
  const digits = n => slot(String(n).split('').map(d => DIG[+d] || d).join(' '), String(n).split('').join(' '));   // radio readback: one zero zero / '1 0 0'
  const words = n => slot(NUMW[n] || String(n), +n);
  /* T`...${x}...` -> { text, tokens }: fixed phrase chunks are strings, slots keep their token (numbers as numbers, '1 0 2' digit readouts,
     names as strings). This is the line format for ops/audio/voice/radio-voice.js RadioVoice.speak(speakerId, tokens). */
  const T = (parts, ...vals) => { const tokens = []; let text = '';
    parts.forEach((p, i) => { text += p; const f = p.trim(); if (f) tokens.push(...splitP(f)); if (i < vals.length) { const v = vals[i]; text += String(v); if (v && v.tok !== undefined) tokens.push(v.tok); else if (typeof v === 'number') tokens.push(v); else if (String(v).trim()) tokens.push(String(v).trim()); } });
    return { text, tokens }; };
  const splitP = f => f.split(/(?<=[.,?])\s+/).map(x => x.trim()).filter(Boolean).flatMap(x => /[.,?]$/.test(x) && x.length > 1 ? [x.slice(0, -1), x.slice(-1)] : [x]);
  const asLine = m => typeof m === 'string' ? { text: m, tokens: splitP(m) } : m;
  const ROADS = { NS: 'Norfolk Southern', CSX: 'C S X', CLNA: 'Carolina Coastal', RJC: 'R J C', BNSF: 'B N S F', Amtrak: 'Amtrak' };

  function create(eng, opt = {}) {
    const D = eng.D, R = {
      on: !!opt.on, chatter: opt.chatter !== false, level: opt.level || 'full', feed: [], transcript: [], q: [], busy: false,
      li: 0, sigSeen: {}, det: {}, shove: {}, ctx: null, onFeed: opt.onFeed || null, speak: opt.speak !== false && typeof speechSynthesis !== 'undefined' };
    // ------------------------------------------------------------------ names
    const jobName = j => (j.name || j.id).replace(/^\S+\s+/, '').replace(/\s*\(.*\)\s*/, '').replace(/\s+(local|turn|job)$/i, '').trim();
    const trkOf = id => D.tracks.find(t => t.id === id) || {};
    const midOf = id => { const t = trkOf(id); if (t.mid) return t.mid; const es = (t.edges || []).map(e => eng.E[e]).filter(Boolean); const E = es[Math.floor(es.length / 2)]; if (!E || !E.pts) return null; const q = E.pts[Math.floor(E.pts.length / 2)]; return (t.mid = [q[0], q[1]]); };
    const places = []; for (const j of D.jobs || []) { const t = trkOf(j.stops[0].tid); if (t.id) places.push({ name: jobName(j), level: t.level, mid: midOf(t.id) }); }
    const placeOf = tid => { const t = trkOf(tid); if (!midOf(tid)) return 'the plant'; let b = null, bd = 1e9; for (const p of places) if (p.level === t.level && p.mid) { const d = Math.hypot(p.mid[0] - t.mid[0], p.mid[1] - t.mid[1]); if (d < bd) { bd = d; b = p; } } return b ? b.name : `level ${t.level}`; };
    const indOf = tid => (D.industries || []).find(i => i.tid === tid);
    const shortInd = i => i.name.split(' / ')[0].replace(/\(.*?\)/g, '').replace(/\bSC-(\d)/, 'S C $1').trim();
    const loc = tid => { const i = indOf(tid); if (i) return shortInd(i); const t = trkOf(tid); if (t.type === 'main') return `the main at ${placeOf(tid)}`; if (t.type === 'siding') return `the ${placeOf(tid).replace(/^the /, '')} siding`; return `track ${String(tid).replace(/^T/, '')} at ${placeOf(tid)}`; };
    const jobOf = id => (eng.session && eng.session.jobs || []).find(j => j.id === id) || (D.jobs || []).find(j => j.id === id);
    const jobRoad = j => { const lo = eng.cuts && eng.cuts.flatMap(c => c.cars).find(x => x.loco && x.train === j.id); return (lo && lo.road) || 'NS'; };
    const unit = (road, key) => road + ' ' + (1000 + hash(key) % 8999);
    const call = id => { const j = jobOf(id); if (j) return id === 'YARD' ? 'Yard job' : `${jobRoad(j) === 'NS' ? '' : jobRoad(j) + ' '}${id}`.trim(); return String(id).replace(/'/g, '').replace(/\/\d+/, '').split(' ').slice(0, 2).join(' '); };
    const symRoad = sym => { const m = /^(NS|CSX|RJC|CLNA|BNSF|Amtrak)\b/.exec(sym); return m ? m[1] : 'NS'; };
    const say = s => s.replace(/\bL(\d)\b/g, 'level $1').replace(/\bT(\d+)\b/g, 'track $1').replace(/\bY(\d+)/g, 'Y $1').replace(/(\d+)\/(\d+)/g, '$1').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
    // ------------------------------------------------------------------ speakers + voices
    const SPK = {};
    function speaker(id, label, kind) {
      if (SPK[id]) return SPK[id]; const h = hash(id);
      const base = { disp: [1.0, 1.02], ym: [0.9, 1.08], det: [0.55, 0.92], eng: [0.85, 1.12], cond: [1.15, 1.18], amtrak: [1.05, 1.0] }[kind] || [1, 1.1];
      return (SPK[id] = { id, label, kind, pitch: Math.max(0.3, Math.min(1.8, base[0] + ((h % 7) - 3) * 0.06)), rate: base[1] + ((h >> 3) % 5 - 2) * 0.03, vh: h });
    }
    let voices = [];
    const loadV = () => { if (typeof speechSynthesis === 'undefined') return; const all = speechSynthesis.getVoices(); const en = all.filter(v => /^en(-|_|$)/i.test(v.lang)); voices = (en.length ? en : all).sort((a, b) => (/US/.test(b.lang) - /US/.test(a.lang))); };
    if (R.speak) { loadV(); try { speechSynthesis.addEventListener('voiceschanged', loadV); } catch (e) { } }
    const voiceFor = s => { if (!voices.length) return null; if (s.kind === 'det') return voices[0]; return voices[(s.vh >> 5) % voices.length]; };
    // ------------------------------------------------------------------ radio sound (key-up click, squelch tail, band-pass)
    function ctx() { if (R.ctx || typeof AudioContext === 'undefined') return R.ctx; try { R.ctx = new AudioContext(); const n = R.ctx.sampleRate; const b = R.ctx.createBuffer(1, n, n); const d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; R.noise = b; } catch (e) { R.ctx = null; } return R.ctx; }
    function burst(dur, vol, click) {
      const c = ctx(); if (!c || !R.on) return; if (c.state === 'suspended') c.resume(); const t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = R.noise; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
      vol *= opt.volume ? opt.volume() : 1; const g = c.createGain(); g.gain.setValueAtTime(Math.max(0.0005, vol), t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(c.destination); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
      if (click) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 1800; const g2 = c.createGain(); g2.gain.setValueAtTime(0.05, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.03); o.connect(g2); g2.connect(c.destination); o.start(t); o.stop(t + 0.04); }
    }
    R.unlock = () => { ctx(); if (R.ctx && R.ctx.state === 'suspended') R.ctx.resume(); };
    // ------------------------------------------------------------------ queue
    const ESS = new Set(['essential']);
    function tx(spk, msg, lvl = 'full', crew = true) { const line = asLine(msg), text = line.text;
      if (lvl !== 'essential' && R.level === 'essential') return; if (crew && !R.chatter && lvl !== 'essential') return;
      const dk = spk.id + '|' + text.replace(/[\d.]+/g, '#'); R.seen = R.seen || {};   // same speaker, same words within 120 s: it is a repeat, drop it
      if (!/^(One|Two|Three|Five|Ten)/.test(text) && R.seen[dk] !== undefined && eng.t - R.seen[dk] < 120) return; R.seen[dk] = eng.t;
      const item = { t: eng.t, who: spk.label, spk, speakerId: spk.id, tokens: line.tokens, text };
      R.transcript.push({ t: +eng.t.toFixed(1), who: spk.label, speakerId: spk.id, tokens: line.tokens, text });
      if (R.q.length > 8) R.q = R.q.filter(x => x.lvl === 'essential');   // backlog: drop chatter, keep authority
      item.lvl = lvl; R.q.push(item); pump();
    }
    function show(item) { R.feed.push(item); if (R.feed.length > 80) R.feed.shift(); R.onFeed && R.onFeed(item); }
    function pump() {
      if (R.busy || !R.q.length) return; const it = R.q.shift();
      if (!R.on || !R.speak) { show(it); return pump(); }
      R.busy = true; show(it); burst(0.06, 0.12, true);
      let done = false; const fin = () => { if (done) return; done = true; burst(0.16, 0.18, false); setTimeout(() => { R.busy = false; pump(); }, 450); };
      const RV = root.RadioVoice;
      if (RV && RV.speak && opt.radioVoice !== false) { RV.speak(it.speakerId, it.tokens, { queue: false }).then(fin, fin); setTimeout(fin, 4000 + it.tokens.length * 900); return; }
      const u = new SpeechSynthesisUtterance(say(it.text)); const v = voiceFor(it.spk); if (v) u.voice = v; u.pitch = it.spk.pitch; u.rate = it.spk.rate; u.volume = opt.volume ? Math.max(0, Math.min(1, opt.volume())) : 0.9;
      u.onend = fin; u.onerror = fin; setTimeout(fin, 1500 + say(it.text).split(' ').length * 420 / it.spk.rate);   // Chrome sometimes drops onend
      setTimeout(() => speechSynthesis.speak(u), 120);
    }
    R.setOn = on => { R.on = on; if (!on) { R.q.length = 0; if (R.speak) speechSynthesis.cancel(); if (root.RadioVoice && root.RadioVoice.stop) root.RadioVoice.stop(); R.busy = false; } else R.unlock(); };
    // ------------------------------------------------------------------ speakers in play
    const S_ = sym => call(sym);
    const DS = speaker('disp', 'Dispatcher', 'disp'), YM = speaker('ym', 'Yardmaster', 'ym'), DET = speaker('det', 'Detector', 'det');
    const crew = (id, role) => { const amtrak = /amtrak/i.test(id); return speaker(id + ':' + role, `${call(id)} ${amtrak ? (role === 'eng' ? 'engineer' : 'conductor') : role === 'eng' ? 'engineer' : 'conductor'}`, amtrak ? 'amtrak' : role); };
    const boss = id => id === 'YARD' ? YM : DS;
    const warrant = {};
    // ------------------------------------------------------------------ log lines -> exchanges
    function onLog(l) {
      let m, x = l.text.replace(/^📻\s*/, '');
      if ((m = /^Dispatcher to (\S+): track warrant (\d+) — work (.+?); main/.exec(x))) {
        const id = m[1], tw = m[2], tr = m[3].split(', '); warrant[id] = tw; const lim = `${loc(tr[0])}`; const B = boss(id), c = crew(id, 'cond');
        if (id === 'YARD') { tx(B, T`Yard job, yardmaster. You've got the whole yard lead. Work ${[...new Set(tr.slice(1).map(loc))].join(' and ')}, stay off the main.`, 'essential', false);
          tx(c, T`Yard job, work ${[...new Set(tr.slice(1).map(loc))].join(' and ')}, stay off the main. Got it.`, 'essential'); return; }
        tx(c, T`Dispatcher, ${call(id)}, ready for a warrant to work ${placeOf(tr[0])}. Over.`, 'essential');
        tx(B, T`${call(id)}, track warrant ${digits(tw)}. Box two: you are authorized to occupy ${lim} and work ${placeOf(tr[0])}, ${tr.length - 1} industry tracks. Main track by permission only. Over.`, 'essential', false);
        tx(c, T`Track warrant ${digits(tw)}, box two, occupy ${lim}, work ${placeOf(tr[0])}, main track by permission only, ${call(id)}. Over.`, 'essential');
        tx(B, T`That's correct, ${call(id)}. OK at ${clock()}. Dispatcher out.`, 'essential', false); return; }
      if ((m = /^Dispatcher: (.+?), take it to staging — (\S+)/.exec(x))) { tx(DS, T`${S_(m[1])}, dispatcher. Take it to staging, ${call(m[2])} is working ahead of you. Over.`, 'essential', false); tx(crew(m[1], 'eng'), T`Into staging, ${S_(m[1])}, roger.`, 'essential'); return; }
      if ((m = /^Dispatcher: (.+?), hold in staging — (\S+) has the (L\d) main/.exec(x))) { if (R.held && R.held[m[1]]) return; (R.held = R.held || {})[m[1]] = 1;
        tx(DS, T`${S_(m[1])}, hold in staging. ${call(m[2])} has the ${m[3]} main on a warrant. I'll call you.`, 'essential', false); tx(crew(m[1], 'eng'), T`Hold in staging, ${S_(m[1])}.`, 'essential'); return; }
      if ((m = /^Dispatcher: (.+?), back clear and hold for the meet with (.+)$/.exec(x))) { tx(DS, T`${S_(m[1])}, back it into the clear and hold for ${m[2]}. Over.`, 'essential', false); tx(crew(m[1], 'eng'), T`Back into the clear, hold for ${m[2]}, ${S_(m[1])}.`, 'essential'); return; }
      if ((m = /^(.+?): in the clear, holding for the meet/.exec(x))) { tx(crew(m[1], 'eng'), T`Dispatcher, ${S_(m[1])}, we're in the clear, holding for the meet.`, 'essential'); tx(DS, T`Roger, ${S_(m[1])}.`, 'essential', false); return; }
      if ((m = /^(.+?): calling the lift to (L\d)/.exec(x))) { R.lift = R.lift || {}; if (R.lift[m[1]] === m[2]) return; R.lift[m[1]] = m[2]; /* call once; again only when the wanted level changes */ tx(crew(m[1], 'eng'), T`${S_(m[1])} calling for the lift, ${m[2]}.`); return; }
      if ((m = /^(.+?): lining (\S+) (normal|reverse)/.exec(x))) { tx(crew(m[1], 'cond'), T`${S_(m[1])}, lining ${m[2].replace(/^L\d-/, 'switch ')} ${m[3] === 'normal' ? 'for the main' : 'reversed'}.`); return; }
      if ((m = /^(.+?) holding: (.+)$/.exec(x))) { const k = 'h:' + m[1]; if (R.sigSeen[k] && eng.t - R.sigSeen[k] < 240) return; R.sigSeen[k] = eng.t; const sym = S_(m[1]), w = /reserved for (\S+)/.exec(m[2]);
        tx(crew(m[1], 'eng'), T`Dispatcher, ${sym}, we're stopped at ${trainPlace(m[1])}. What've you got for us?`);
        tx(DS, w ? T`${sym}, hold what you've got, ${call(w[1])} has the switches lined. I'll get you by shortly.` : T`${sym}, hold the signal, I'll have it for you shortly.`, 'full', false); return; }
      if ((m = /^🤖 (\S+): (setout|pull|move) (\S+)→(\S+) \((\d+) cars\)/.exec(l.text))) { const id = m[1], n = +m[5], c = crew(id, 'cond'), to = m[4];
        { const P = R.shove[id]; if (P && P.going && !P.said.done) tx(c, P.k === 'pull' ? "That'll do. Got a joint." : "That'll do."); }
        if (m[2] === 'setout') tx(c, T`${call(id)}, shoving ${words(n)} ${n === 1 ? 'car' : 'cars'} into ${loc(to)} for a set-out.`);
        else if (m[2] === 'pull') tx(c, T`${call(id)}, going in to ${loc(to)} to grab ${words(n)}.`);
        else tx(c, n ? T`${call(id)}, pull ahead to ${loc(to)} with ${words(n)}.` : T`${call(id)}, light engine to ${loc(to)}.`);
        if (m[2] !== 'move') tx(crew(id, 'eng'), 'Backing up.'); R.shove[id] = { k: m[2], i: -1, said: {} }; return; }
      if ((m = /^🤖 (\S+): work complete/.exec(l.text))) { const id = m[1], tw = warrant[id]; const B = boss(id);
        { const P = R.shove[id]; if (P && P.going && !P.said.done) tx(crew(id, 'cond'), "That'll do."); delete R.shove[id]; }
        if (id === 'YARD') { tx(crew(id, 'cond'), T`Yardmaster, yard job. We're done, everything's spotted and the lead is clear.`, 'essential'); tx(YM, T`Thanks, yard job. Tie it down.`, 'essential', false); return; }
        tx(crew(id, 'cond'), T`Dispatcher, ${call(id)}. We're done at ${jobName(jobOf(id) || { id })}, clear of the main, in the clear. Release track warrant ${digits(tw || 100)}.`, 'essential');
        tx(B, T`${call(id)}, track warrant ${digits(tw || 100)} released at ${clock()}. Dispatcher.`, 'essential', false); tx(crew(id, 'cond'), T`Released at ${clock()}, ${call(id)}.`, 'essential'); return; }
      if ((m = /^🤖 (\S+): FAILED: (.+)$/.exec(l.text))) { const id = m[1];
        if (/derail/.test(m[2])) { tx(crew(id, 'eng'), T`Emergency, emergency, emergency. ${call(id)}, we're on the ground at ${jobName(jobOf(id) || { id })}. Main track not fouled. Over.`, 'essential'); tx(DS, T`${call(id)}, dispatcher, copy your emergency. Stop all movement, I'm protecting it.`, 'essential', false); }
        else tx(crew(id, 'cond'), T`Dispatcher, ${call(id)}, we're stuck: ${say(m[2])}.`, 'essential'); return; }
      if ((m = /^🤖 (\S+): holding for (.+)$/.exec(l.text))) { tx(crew(m[1], 'eng'), T`${call(m[1])}, holding for ${m[2]}.`); return; }
      if ((m = /^⚠ (.+)$/.exec(l.text)) && /derail|collision|run-through/.test(m[1])) { tx(DS, T`All trains, dispatcher. Stop movement in the area, reported ${say(m[1].split(':')[0])}.`, 'essential', false); return; }
    }
    function clock() { const s = eng.t * ((D.session && D.session.fast_clock) || 4) + 6 * 3600; const h = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60; const hh = `${String(h).padStart(2, '0')}${String(mm).padStart(2, '0')}`; return slot(hh.split('').map(d => DIG[+d]).join(' '), hh.split('').join(' ')); }
    function trainPlace(sym) { const ai = eng.ai; if (ai && ai.staged && ai.staged.some(s => s.tr.sym === sym)) return 'staging';
      const tr = ai && ai.trains.find(t => t.sym === sym); const c = tr && eng.locoCut(tr.addr); if (!c) return 'staging';
      const es = Object.keys(eng.occupancy(c)).map(Number); if (es.some(e => eng.E[e] && eng.E[e].lift)) return 'the lift';
      const tid = es.map(e => eng.e2t[e]).find(Boolean); if (tid) return placeOf(tid);
      const lg = es.map(e => eng.legOf[e]).find(Boolean); return lg ? `switch ${lg[0].id.replace(/^L\d-0?/, '')} at ${placeOf(eng.e2t[lg[0].stem] || '')}` : 'staging'; }
    function sigTrk(sym) { const tr = eng.ai && eng.ai.trains.find(t => t.sym === sym); const c = tr && eng.locoCut(tr.addr); if (!c) return null; const o = Object.keys(eng.occupancy(c))[0]; return eng.e2t[o]; }
    // ------------------------------------------------------------------ live state: signals, detectors, shove countdown
    const MPH = (root.OpsEngine && root.OpsEngine.MPH) || (v => v * 3.1);
    const dets = {}; for (const lv of [1, 2]) { const mains = D.tracks.filter(t => t.type === 'main' && t.level === lv).sort((a, b) => b.len - a.len); if (mains[0]) { const t = mains[0]; dets[t.edges[Math.floor(t.edges.length / 2)]] = { lv, mp: (lv === 1 ? 112.4 : 131.8) + (hash(D.name) % 9) / 10, tid: t.id }; } }
    function liveTick() {
      const ai = eng.ai; if (!ai) return;
      for (const tr of ai.trains) { const c = eng.locoCut(tr.addr); if (!c) continue; const sp = Math.abs(c.v);
        // defect detector: head enters the detector edge -> announce once the train has passed it
        const occ = eng.occupancy(c); for (const e in dets) { const k = tr.sym + ':' + e, on = !!occ[e];
          if (on && R.det[k] && !R.det[k].said) R.det[k].mph = Math.max(R.det[k].mph, Math.round(MPH(sp)));
          if (on && !R.det[k] && sp > 0.05 && eng.t > 3) R.det[k] = { t: eng.t, axles: c.cars.reduce((a, x) => a + (x.loco && /ET44|SD70|SD40|ES44/i.test(x.model || x.type) ? 6 : 4), 0), mph: Math.round(MPH(sp)) };
          else if (!on && R.det[k] && !R.det[k].said) { const d = R.det[k]; d.said = true; const dt = dets[e];
            tx(DET, T`${ROADS[symRoad(tr.sym)] || symRoad(tr.sym)} detector, milepost ${digits(Math.floor(dt.mp))} point ${DIG[Math.round(dt.mp * 10) % 10]}, track ${dt.lv}. No defects. No defects. Total axles ${d.axles}. Train speed ${d.mph}. Temperature ${54 + hash(D.name + eng.session.seed) % 20} degrees. Detector out.`, 'essential', false); }
          else if (!on && R.det[k] && R.det[k].said && eng.t - R.det[k].t > 120) delete R.det[k]; }
        // signals: the next signal within ~8 in ahead; call each one once per approach
        if (sp < 0.05) continue; const dir = Math.sign(c.v) || 1; const A = eng.ahead(c, dir, 10);
        for (let i = 1; i < A.length; i++) { const sg = ai.signalBetween(A[i - 1].e, A[i].e); if (!sg) continue; const k = tr.sym + ':' + sg.id;
          if (!R.sigSeen[k] || eng.t - R.sigSeen[k] > 300 || (R.sigSeen[k + ':a'] !== sg.aspect && eng.t - R.sigSeen[k] > 120)) { R.sigSeen[k] = eng.t; R.sigSeen[k + ':a'] = sg.aspect; const asp = { G: 'clear', Y: 'approach', R: 'stop' }[sg.aspect];
            const end = (eng.N[sg.node] && midOf(sg.tid) && eng.N[sg.node].x < midOf(sg.tid)[0]) ? 'west' : 'east';
            tx(crew(tr.sym, 'eng'), asp === 'stop' ? T`${S_(tr.sym)}, stop signal, ${end} end ${placeOf(sg.tid)}. Stopping.` : T`${S_(tr.sym)}, ${asp} signal, ${end} end ${placeOf(sg.tid)}.`, asp === 'stop' ? 'essential' : 'full'); }
          break; } }
      // conductor shove countdown (car lengths ~ 5 in = 50 ft)
      for (const j of (eng.session && eng.session.jobs) || []) { const ex = j.exec, S = R.shove[j.id]; if (!ex || !S || ex.done || ex.fail) continue;
        const st = ex.steps[ex.i]; if (!st) continue;
        if (S.i === -1) S.i = ex.i; if (S.i !== ex.i) { if (S.going && !S.said.done) { S.said.done = 1; tx(crew(j.id, 'cond'), S.k === 'pull' ? 'That\'ll do. Got a joint, pull ahead.' : 'That\'ll do.'); } delete R.shove[j.id]; continue; }
        // the cut stopped on its spot (executor left 'go') or the couplers just made the joint: say it now, not at the next move
        if (S.going && !S.said.done && (ex.phase !== 'go' || ex.latched)) { S.said.done = 1; tx(crew(j.id, 'cond'), S.k === 'setout' ? T`That'll do. ${words(st.cars.length)} spotted, cutting 'em off.` : `That'll do. Got a joint.`); continue; }
        if (ex.phase !== 'go' || S.k === 'move') continue; const lo = eng.locoCut(j.addr); if (!lo) continue;
        if (S.n0 === undefined) S.n0 = lo.cars.length;
        if (S.going && !S.said.done && lo.cars.length > S.n0) { S.said.done = 1; tx(crew(j.id, 'cond'), "That'll do. Got a joint."); continue; }   // couplers made the joint: that is the stop call
        let rem = ex.remaining(lo, ex.dir, ex.goal); const ob = eng.obstacle(lo, ex.dir, 80); if (ob.what && ob.what !== 'end') rem = Math.min(rem === null ? 1e9 : rem, ob.dist); if (rem === null || rem > 1e8) continue;
        const cars = rem / 5.1; S.going = true;
        for (const n of [10, 5, 3, 2, 1, 0.5]) if (cars <= n + 0.05 && cars > n - 0.5 && !S.said[n]) { S.said[n] = 1; tx(crew(j.id, 'cond'), n === 10 ? 'Ten cars.' : n === 5 ? 'Five cars, easy.' : (n === 0.5 ? { text: 'Half a car...', tokens: ['half a car', '...'] } : { text: `${['', 'One car', 'Two', 'Three'][n]}...`, tokens: [n, ...(n === 1 ? ['car'] : []), '...'] })); }
        if ((cars < 0.15 || (S.said[0.5] && cars < 0.3)) && Math.abs(lo.v) < 0.02 && !S.said.done) { S.said.done = 1; tx(crew(j.id, 'cond'), S.k === 'setout' ? T`That'll do. ${st.cars.length} spotted, cutting them off.` : T`That'll do. Got a joint.`); } }
    }
    let acc = 0, lastT = null;
    R.poll = () => {   // call every frame / tick
      const L = eng.log; if (R.li > L.length) R.li = L.length;   // log shifts after 400 lines: catch up by text match
      for (; R.li < L.length; R.li++) onLog(L[R.li]);
      if (L.length >= 400) R.li = L.length;
      if (lastT === null) lastT = eng.t; acc += eng.t - lastT; lastT = eng.t; if (acc >= 0.25) { acc = 0; liveTick(); }
    };
    R.html = (n = 14) => R.feed.slice(-n).map(f => `<div class="rf ${f.spk.kind}"><b>${f.who}:</b> ${f.text.replace(/</g, '&lt;')}</div>`).join('');
    R.reset = () => { R.seen = {}; R.li = eng.log.length; R.q.length = 0; R.sigSeen = {}; R.det = {}; R.shove = {}; R.held = {}; lastT = eng.t; };
    return R;
  }
  const API = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.OpsRadio = API;
})(typeof window !== 'undefined' ? window : globalThis);
