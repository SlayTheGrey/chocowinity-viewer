/* [UX1 2026-10-19] Viewer usability layer (one file): always-visible mode badge, per-mode controls overlay (K / ? chip),
   smooth camera tweens for views and map jumps, a short fade on mode switches, gentler orbit defaults. */
(function () {
  if (window.__viewerUX) return; window.__viewerUX = 1;
  var NAMES = { orbit: ['🌐', 'Overview'], walk: ['🚶', 'Walk the aisle'], cab: ['🚂', 'Cab ride'], chase: ['🎥', 'Follow train'], fly: ['✈️', 'Fly'], ped: ['🧍', '1:160 person'] };
  var KEYS = {
    orbit: [['Drag', 'turn'], ['Right-drag', 'pan'], ['Wheel', 'zoom'], ['Map click', 'go there'], ['1–6', 'switch mode']],
    walk: [['W A S D', 'walk'], ['Drag / click', 'look'], ['Shift', 'faster'], ['Home', 'back to start'], ['Esc', 'release mouse']],
    cab: [['N', 'next train'], ['+ / −', 'train speed'], ['P', 'pause trains'], ['Drag', 'look around']],
    chase: [['N', 'next train'], ['Drag', 'orbit train'], ['Wheel', 'distance'], ['+ / −', 'train speed']],
    fly: [['W A S D', 'fly'], ['E / Space', 'up'], ['Q / C', 'down'], ['Wheel / + −', 'fly speed'], ['Shift', 'boost'], ['Z', 'precision'], ['X', 'pass through decks']],
    ped: [['W A S D', 'walk'], ['Drag', 'look'], ['Shift', 'run'], ['Space', 'jump'], ['C', 'crouch'], ['M', 'map: click to go']]
  };
  var css = '#ux-badge{position:fixed;left:50%;top:44px;transform:translateX(-50%);z-index:30;background:rgba(20,27,38,.9);color:#e8eef6;border:1px solid #3b4a60;border-radius:16px;padding:3px 12px;font:600 13px system-ui,sans-serif;pointer-events:none;transition:opacity .4s}' +
    '#ux-keys{position:fixed;left:12px;bottom:56px;z-index:30;background:rgba(20,27,38,.92);color:#e8eef6;border:1px solid #3b4a60;border-radius:10px;padding:8px 12px;font:12.5px system-ui,sans-serif;min-width:190px}' +
    '#ux-keys h5{margin:0 0 5px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#9db0c6;display:flex;justify-content:space-between}#ux-keys h5 span{cursor:pointer}' +
    '#ux-keys kbd{display:inline-block;min-width:22px;background:#2a3648;border:1px solid #4a5a72;border-bottom-width:2px;border-radius:4px;padding:0 5px;margin-right:6px;font:11.5px ui-monospace,monospace;text-align:center}#ux-keys div{margin:2px 0}' +
    '#ux-kchip{position:fixed;left:12px;bottom:56px;z-index:30;background:rgba(20,27,38,.92);color:#e8eef6;border:1px solid #3b4a60;border-radius:14px;padding:3px 10px;font:12px system-ui,sans-serif;cursor:pointer}' +
    '#ux-fade{position:fixed;inset:0;background:#0b0f15;opacity:0;pointer-events:none;z-index:25;transition:opacity .18s}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  function boot() {
    var S = window.__layout3d, A = S && S.api; if (!S || !S.ready || !A || !A.getMode) return setTimeout(boot, 400);
    var bot = navigator.webdriver;   // automated tests keep instant camera moves
    var badge = el('div', 'ux-badge'), keys = el('div', 'ux-keys'), chip = el('div', 'ux-kchip'), fade = el('div', 'ux-fade');
    chip.textContent = '⌨ Controls (K)'; chip.title = 'Show the controls for this mode';
    var open = localStorage.getItem('ux-keys') !== '0';
    function show(v) { open = v; localStorage.setItem('ux-keys', v ? '1' : '0'); draw(true); }
    chip.onclick = function () { show(true); };
    addEventListener('keydown', function (e) { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return; if (e.code === 'KeyK') show(!open); });
    try { if (A.orbit) { A.orbit.dampingFactor = 0.08; A.orbit.rotateSpeed = 0.6; A.orbit.zoomSpeed = 0.8; A.orbit.panSpeed = 0.7; } } catch (e) { }
    // smooth tweens: setView and map jumps in overview move the camera over ~0.7 s instead of cutting
    if (!bot && A.setView && A.camera && A.orbit) {
      var sv = A.setView, cam = A.camera, O = A.orbit, tw = null;
      var tween = function (p0, t0) { var p1 = cam.position.clone(), t1 = O.target.clone(); if (p0.distanceTo(p1) < 0.5) return;
        cam.position.copy(p0); O.target.copy(t0); var t = performance.now();
        tw = function (now) { var k = Math.min(1, (now - t) / 700), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          cam.position.lerpVectors(p0, p1, e); O.target.lerpVectors(t0, t1, e); O.update(); if (k < 1) requestAnimationFrame(tw); else tw = null; };
        requestAnimationFrame(tw); };
      A.setView = function (v) { var m = A.getMode(), p0 = cam.position.clone(), t0 = O.target.clone(); sv(v); if (m === 'orbit') tween(p0, t0); };
      var mapc = document.getElementById('map-cv');
      if (mapc) mapc.addEventListener('pointerdown', function () { if (A.getMode() !== 'orbit') return; var p0 = cam.position.clone(), t0 = O.target.clone();
        setTimeout(function () { if (A.getMode() === 'orbit') tween(p0, t0); }, 0); }, true);
    }
    var last = A.getMode(), hideT = 0;
    function draw(force) {
      var m = A.getMode() || 'orbit', n = NAMES[m] || ['', m];
      if (m !== last) { if (!bot) { fade.style.opacity = .55; setTimeout(function () { fade.style.opacity = 0; }, 180); } last = m; force = true; }
      if (!force) return;
      badge.textContent = n[0] + '  ' + n[1] + ' mode'; badge.style.opacity = 1; clearTimeout(hideT); hideT = setTimeout(function () { badge.style.opacity = .55; }, 2500);
      keys.hidden = !open; chip.hidden = open;
      keys.innerHTML = '<h5>' + n[1] + ' controls <span title="Hide (K)">✕</span></h5>' + (KEYS[m] || []).map(function (r) { return '<div><kbd>' + r[0] + '</kbd>' + r[1] + '</div>'; }).join('') +
        '<div style="margin-top:5px;color:#9db0c6">Mode buttons are at the top · ? = full help</div>';
      keys.querySelector('h5 span').onclick = function () { show(false); };
    }
    setInterval(function () { try { draw(false); } catch (e) { } }, 250); draw(true);
  }
  function el(t, id) { var e = document.createElement(t); e.id = id; document.body.appendChild(e); return e; }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
})();
