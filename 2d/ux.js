/* [UX1 2026-10-19] Ops usability layer (one file): transport bar (play/pause + speed), current-move banner, train list + timeline. Uses only window.__opsGame and existing buttons. */
(function () {
  if (window.__opsUX) return; window.__opsUX = 1;
  var G = function () { return window.__opsGame; }, $ = function (i) { return document.getElementById(i); };
  var css = '#ux-dock{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:40;display:flex;gap:8px;align-items:center;background:rgba(18,24,33,.93);border:1px solid #3a4658;border-radius:10px;padding:6px 10px;font:13px system-ui,sans-serif;color:#e6edf5;box-shadow:0 4px 18px rgba(0,0,0,.4)}' +
    '#ux-dock button{background:#263243;color:#e6edf5;border:1px solid #44536a;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer}#ux-dock button.on{background:#2f6fd6;border-color:#5b93ee}' +
    '#ux-play{min-width:92px;font-weight:600}#ux-clk{font:600 16px ui-monospace,monospace;padding:0 6px}#ux-tl-b{margin-left:4px}' +
    '#ux-move{position:fixed;left:50%;top:46px;transform:translateX(-50%);z-index:39;max-width:62vw;background:rgba(36,30,10,.94);border:1px solid #c9a227;border-radius:8px;padding:7px 14px;color:#fff3c4;font:14px/1.35 system-ui,sans-serif;pointer-events:none}#ux-move b{color:#ffd54a}' +
    '#ux-tl{position:fixed;left:12px;bottom:62px;z-index:39;width:min(560px,46vw);max-height:42vh;overflow:auto;background:rgba(18,24,33,.95);border:1px solid #3a4658;border-radius:10px;padding:8px 10px;color:#e6edf5;font:13px system-ui,sans-serif}' +
    '#ux-tl h4{margin:0 0 6px;font-size:13px;color:#9fb3c8;text-transform:uppercase;letter-spacing:.05em}.ux-r{display:grid;grid-template-columns:1fr 48px 140px 70px;gap:8px;align-items:center;padding:3px 0;border-bottom:1px solid #263243}' +
    '.ux-r.me{background:rgba(47,111,214,.18)}.ux-bar{height:8px;background:#263243;border-radius:4px;overflow:hidden}.ux-bar i{display:block;height:100%;background:#4caf50}.ux-s{font-size:12px;color:#9fb3c8;text-align:right}.ux-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}.ux-n:hover{text-decoration:underline}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  function boot() {
    var g = G(); if (!g || !g.ready || !g.engine) return setTimeout(boot, 300);
    var d = document.createElement('div'); d.id = 'ux-dock';
    d.innerHTML = '<button id="ux-play" title="Play / pause [P]">▶ Play</button><span>Speed</span>' + [1, 2, 4, 8].map(function (r) { return '<button class="ux-rt" data-r="' + r + '">' + r + '×</button>'; }).join('') +
      '<span id="ux-clk">06:00</span><button id="ux-tl-b" title="Train list and timeline [L]">☰ Trains</button>';
    document.body.appendChild(d);
    var mv = document.createElement('div'); mv.id = 'ux-move'; document.body.appendChild(mv);
    var tl = document.createElement('div'); tl.id = 'ux-tl'; tl.hidden = localStorage.getItem('ux-tl') === '0'; document.body.appendChild(tl);
    $('ux-play').onclick = function () { var p = $('pause'); if (p) p.click(); else g.engine.paused = !g.engine.paused; upd(); };
    d.querySelectorAll('.ux-rt').forEach(function (b) { b.onclick = function () { var r = +b.dataset.r, seg = $('rates'), hit = null;
      if (seg) seg.querySelectorAll('button').forEach(function (x) { if (parseInt(x.textContent) === r) hit = x; });
      if (hit) hit.click(); else g.setRate(r); upd(); }; });
    $('ux-tl-b').onclick = function () { tl.hidden = !tl.hidden; localStorage.setItem('ux-tl', tl.hidden ? '0' : '1'); upd(); };
    addEventListener('keydown', function (e) { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; if (e.key === 'l' || e.key === 'L') $('ux-tl-b').click(); });
    tl.addEventListener('click', function (e) { var n = e.target.closest('[data-a]'); if (n) g.selectLoco(+n.dataset.a); });
    function upd() {
      var e = g.engine, run = !e.paused; $('ux-play').textContent = run ? '⏸ Pause' : '▶ Play'; $('ux-play').classList.toggle('on', run);
      d.querySelectorAll('.ux-rt').forEach(function (b) { b.classList.toggle('on', +b.dataset.r === g.rate); });
      $('ux-clk').textContent = g.fmt(e.t); $('ux-tl-b').classList.toggle('on', !tl.hidden);
      var nm = $('nextmove'), txt = nm ? (nm.innerText || '').trim().split('\n').filter(Boolean) : [];
      var sp = /start session|start card/i; var qs = $('ss'); var cardUp = qs && !qs.classList.contains('hidden');
      if (txt.length && !cardUp) { mv.hidden = false; mv.innerHTML = '<b>Current move:</b> ' + esc(txt.slice(0, 2).join(' — ').replace(/^\W*NEXT MOVE\W*/i, '')).slice(0, 260); } else mv.hidden = true;
      if (!tl.hidden) {
        var me = g.myJob, now = e.t, h = '<h4>Trains · timeline (now ' + g.fmt(now) + ')</h4>';
        e.session.jobs.slice().sort(function (a, b) { return sm(a) - sm(b); }).forEach(function (j) {
          var x = j.exec, n = x && x.steps ? x.steps.length : (j.plan ? j.plan.steps.length : 0), i = x ? Math.min(x.i, n) : 0;
          var s = x ? (x.done ? '✅ done' : x.fail ? '❌ stuck' : 'move ' + (i + 1) + '/' + n) : (j === me ? 'your job' : now >= sm(j) * 60 ? 'due now' : 'waiting');
          var pct = x && x.done ? 100 : n ? Math.round(100 * i / n) : 0, t0 = g.fmt((((g.D.jobs || []).find(function (y) { return y.id === j.id; }) || {}).start_min || 0) * 60);
          h += '<div class="ux-r' + (j === me ? ' me' : '') + '"><span class="ux-n" data-a="' + j.addr + '" title="Select this train">' + esc(j.name) + '</span><span class="ux-s">' + t0 + '</span><span class="ux-bar"><i style="width:' + pct + '%"></i></span><span class="ux-s">' + s + '</span></div>';
        });
        tl.innerHTML = h;
      }
    }
    function sm(j) { return ((g.D.jobs || []).find(function (y) { return y.id === j.id; }) || {}).start_min || 0; }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    setInterval(function () { try { upd(); } catch (err) { } }, 500); upd();
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
})();
