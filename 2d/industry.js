/* [LOGI 2026-10-19] Ops industry activity panel. Runs the town logistics schedule headless (engine/logistics-core.js +
   logistics-data.js from tools/gen_logistics.py) on the ops session clock (06:00 + engine.t x fast clock).
   Spotting a delivered car on its industry track (no loco attached) starts that industry's truck jobs ~10 min later
   (the same rule the 3D viewer uses). Panel lists each business: trucks due / at dock / done, and recent rail tie-ins.
   Optional: missing data or core -> no panel. Toggle with the "Industries" button or key I. */
(function () {
  var G = window.__opsGame, D = window.LOGISTICS, C = window.L3D && L3D.logiCore; if (!G || !D || !C) return;
  var S = null, lastT = -1, poll = 0, open = false, box, btn;
  function clock() { var fc = (G.D.session && G.D.session.fast_clock) || 4; return (6 * 3600 + G.engine.t * fc) % 86400; }
  function reset() { S = C.create(D, {}); S.holdRail(true); S.seek(clock()); }
  function hm(t) { return C.hm ? C.hm(t) : String(Math.floor(t / 3600) % 24).padStart(2, '0') + ':' + String(Math.floor(t / 60) % 60).padStart(2, '0'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function render() { if (!open) return; var h = '<div style="display:flex;justify-content:space-between"><b>Industry activity ' + hm(S.clock) + '</b><span style="cursor:pointer" id="indX">x</span></div>';
    var log = S.log.filter(function (l) { return /rail car spotted/.test(l[2]); }).slice(-6).reverse();
    h += '<div style="margin:4px 0;opacity:.85">' + (log.length ? log.map(function (l) { return hm(l[0]) + ' ' + esc(l[1]) + ': ' + esc(l[2]); }).join('<br>') : 'No rail cars spotted yet - spot a delivered car on its industry track to start that industry\'s trucks.') + '</div>';
    Object.keys(D.biz).forEach(function (b) { var B = D.biz[b], st = S.bizStatus(b); if (!st.length) return;
      var due = st.filter(function (x) { return x.state === 'held' || /^(due|off|waiting)/.test(x.state); }).length, done = st.filter(function (x) { return /done|gone/.test(x.state); }).length, act = st.length - due - done;
      h += '<details><summary><b>' + esc(b) + '</b> ' + esc(B.name.split('(')[0]) + ' <span style="opacity:.7">active ' + act + ' / due ' + due + ' / done ' + done + '</span></summary>' +
        st.slice(0, 30).map(function (x) { return '<div style="padding-left:10px">' + (x.t != null ? hm(x.t) + ' ' : '') + esc(x.what) + ' <i>' + esc(x.state) + '</i>' + (x.trig ? ' [rail ' + esc(x.trig) + ']' : '') + '</div>'; }).join('') + '</details>'; });
    box.innerHTML = h; var X = document.getElementById('indX'); if (X) X.onclick = toggle; }
  function toggle() { open = !open; box.style.display = open ? 'block' : 'none'; render(); }
  function ui() { btn = document.createElement('button'); btn.textContent = 'Industries'; btn.title = 'Industry activity (I)'; btn.id = 'indBtn';
    btn.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:40'; btn.onclick = toggle; document.body.appendChild(btn);
    box = document.createElement('div'); box.id = 'indPanel'; box.style.cssText = 'display:none;position:fixed;right:10px;bottom:40px;width:380px;max-height:60vh;overflow:auto;z-index:40;background:rgba(20,24,28,.92);color:#eee;font:12px/1.4 system-ui,sans-serif;padding:8px;border-radius:6px';
    document.body.appendChild(box); addEventListener('keydown', function (e) { if (e.code === 'KeyI' && !/INPUT|SELECT|TEXTAREA/.test((e.target || {}).tagName || '')) toggle(); }); }
  function step() { try { var eng = G.engine; if (!eng) return; if (!S || eng.t < lastT) reset(); var t = clock(); var dt = Math.max(0, (eng.t - (lastT < 0 ? eng.t : lastT))); lastT = eng.t;
      if (Math.abs(t - S.clock) > 900) S.seek(t); else if (dt > 0) S.tick(dt, { clock: t, motion: 1 });
      if (++poll % 4 === 0) S.pollRail(eng); render(); } catch (e) { (G.errs || []).push('industry panel: ' + e.message); } }
  ui(); setInterval(step, 500);
  window.__opsIndustry = { get S() { return S; }, step: step, toggle: toggle };
})();
