/* [UI 2026-10-16] layout3d viewer shell: toolbar mode indicator, train list, jump-to-location search, quick start, pointer-lock hints.
   Talks to viewer.js only through window.__layout3d.api and the existing DOM ids (viewer.js keeps working without this file). */
(function () { 'use strict';
const $ = id => document.getElementById(id), KEY = 'layout3d.ui2', QS = new URLSearchParams(location.search);
let st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const MODES = { walk: ['Walk', 'W A S D move · click to look · M map'], orbit: ['Overview', 'drag rotate · right-drag pan · wheel zoom · M map'], chase: ['Follow train', 'N next train · +/− speed'], cab: ['Cab ride', 'N next train · wheel zoom'], follow: ['Follow person / vehicle', '7 next · V eye view'],
  fly: ['Fly', 'W A S D · Space/E up · C/Q down · wheel speed · Shift boost · Z precise · X decks'], ped: ['Pedestrian', 'W A S D walk · Shift run · Space jump · M map: click to go'] };   /* [FLYPED] */
function wait() { const S = window.__layout3d; if (!S || !S.ready || !S.api) return setTimeout(wait, 200); init(S, S.api); } wait();
function init(S, A) {
  // title: plan name in the toolbar, details under the panel header
  const full = $('ttl').textContent; const name = (full.split(' — ')[0] || 'Layout 3D'); $('tb-plan').textContent = name; $('plansub').textContent = full.split(' — ').slice(1).join(' — '); $('ttl').textContent = 'Settings'; document.title = name + ' — Layout 3D';
  // collapsible sections remember their state
  st.sec = st.sec || {}; document.querySelectorAll('details.sec').forEach(d => { const k = d.dataset.sec; if (k in st.sec) d.open = st.sec[k]; d.addEventListener('toggle', () => { st.sec[k] = d.open; save(); }); });
  // sensible defaults: stats off unless chosen (F still toggles)
  if (st.stats === undefined) st.stats = false; $('fps').checked = st.stats; $('fps').onchange({ target: $('fps') });
  $('fps').addEventListener('change', () => { st.stats = $('fps').checked; save(); }); addEventListener('keydown', e => { if (e.code === 'KeyF') setTimeout(() => { st.stats = $('fps').checked; save(); }); });
  // reach row (assets/reach.js appends it to #ui) -> Reach section
  const mvReach = () => { const r = $('reachrow'); if (r && r.parentNode !== $('reachslot')) $('reachslot').appendChild(r); }; mvReach(); setInterval(mvReach, 1000);
  setTimeout(() => { if (!$('reachrow')) document.querySelector('[data-sec=reach]').style.display = 'none'; }, 3000);
  // current mode indicator + pointer-lock hint
  const lockHint = $('lockhint'); let lastSig = '';
  function tick() { const locked = A.plc && A.plc.isLocked; const m2 = curMode(); const sig = m2 + locked + A.SIM.paused + A.getSel();
    if (sig !== lastSig) { lastSig = sig; const m = m2, M = MODES[m] || [m, '']; $('modename').textContent = M[0]; $('modehint').textContent = '· ' + M[1]; document.querySelectorAll('#topbar [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); { const b7 = document.getElementById('m7btn'); if (b7) b7.classList.toggle('on', m === 'follow'); } /* [CHOCO-UI1] mode-7 button lights up */
      lockHint.classList.toggle('hidden', !/^(walk|fly|ped)$/.test(m)); lockHint.innerHTML = locked ? 'Mouse captured · <b>Esc</b> to release' : '<b>Click</b> the view to look around (or drag) · <b>W A S D</b> to ' + (m === 'fly' ? 'fly' : 'walk');
      $('pause').innerHTML = (A.SIM.paused ? '&#9654;<span class="lb"> Run</span>' : '&#9208;<span class="lb"> Pause</span>') + '<kbd>P</kbd>'; $('pause').classList.toggle('on', A.SIM.paused); } }
  setInterval(tick, 150); tick();
  $('homeb').onclick = () => { $('homeb').blur(); dispatchEvent(new KeyboardEvent('keydown', { code: 'Home' })); };
  // [UX] Settings button: show / hide the settings panel (it used to be findable only by its header in the corner)
  if ($('setb')) $('setb').onclick = () => { $('setb').blur(); if (window.L3DUI && L3DUI.state.hidden) L3DUI.setHidden(false); const b = $('ui').querySelector('.l3d-minb'); if (b) b.click(); setTimeout(() => $('setb').classList.toggle('on', !(window.L3DUI && L3DUI.state.min && L3DUI.state.min.ui)), 20); };
  setInterval(() => { if ($('setb')) $('setb').classList.toggle('on', !(window.L3DUI && (L3DUI.state.hidden || (L3DUI.state.min && L3DUI.state.min.ui)))); }, 700);
  // [FLYPED] Fly & Pedestrian section: log speed slider 0.05..200 in/s, deck pass-through, train lights
  if (A.flyped && $('flyspd')) { const F = A.flyped.FLY, toV = s => Math.round(Math.log(s / 0.05) / Math.log(4000) * 100), toS = v => 0.05 * Math.pow(4000, v / 100);
    const show = () => { $('flyspdv').textContent = F.spd < 1 ? F.spd.toFixed(2) : F.spd.toFixed(1); if (document.activeElement !== $('flyspd')) $('flyspd').value = toV(F.spd); $('flypass').checked = F.pass; };
    $('flyspd').oninput = () => { F.spd = toS(+$('flyspd').value); show(); }; $('flypass').onchange = () => { F.pass = $('flypass').checked; }; setInterval(show, 400); show();
    const tl = $('tlights'); if (tl) { tl.checked = st.lights !== false; const ap = () => { window.L3D_LIGHTS_OFF = !tl.checked; }; ap(); tl.onchange = () => { st.lights = tl.checked; save(); ap(); }; } }
  // train list with Follow (chase) / Cab buttons
  function OU() { return window.__ops3d && window.__ops3d.uiApi; }   // ops sim drives the trains when present
  const DIRS = {}; ((window.OPS_DATA || {}).trains || []).forEach(t => DIRS[t.sym] = t.dir); ((window.LAYOUT || {}).trains || []).forEach(t => DIRS[t.sym] = DIRS[t.sym] || t.dir);
  function rows() { const O = OU(); if (O && !A.trains.length) return O.locos().map(l => { const sym = Object.keys(DIRS).find(k => l.train && (k === l.train || k.replace(/\s*\(.*\)/, '') === l.train)) || l.train;   // [UX] readable: train name, then loco and direction
      return { key: l.addr, name: sym || l.label, sub: `${l.road ? l.road + ' · ' : ''}DCC ${l.addr} · ${l.mph.toFixed(0)} mph${DIRS[sym] ? ' · runs ' + DIRS[sym] : ''}` }; });
    return A.trains.map((t, i) => ({ key: i, name: t.sym, sub: `${t.cars.length} units · ${t.len.toFixed(0)} in · runs ${t.dir}${/^lift/.test(t.route) ? ' · via elevator' : ''}` })); }
  function curMode() { const O = OU(), om = O && O.getMode(); return om || A.getMode(); } /* [CHOCO-UI R1] ops 'follow' (key 7) is its own mode, not Follow train */
  function trains() { const R = rows(), O = OU(), ops = O && !A.trains.length, sel = ops ? O.getSel() : A.getSel(), m = curMode(), ul = $('trainlist');
    const sig = R.map(r => r.key + r.name).join('|'); if (ul.dataset.sig !== sig) { ul.dataset.sig = sig; ul.innerHTML = R.map(r => `<li data-k="${esc(r.key)}"><div class="tn"><b>${esc(r.name)}</b><small></small></div><button class="tr-follow" title="Follow this train (Chase) [4]">&#127909; Follow</button><button class="tr-cab" title="Ride in the cab [3]">&#128647; Cab</button></li>`).join('') || ((window.OPS_DATA || {}).trains || []).length ? '<li><small>Planned through trains (' + window.OPS_DATA.trains.length + '): ' + window.OPS_DATA.trains.map(t => esc(t.sym)).join(', ') + '; plus the locals and yard jobs. Each appears here when the ops session runs it.</small></li>' : '<li><small>No trains on this plan</small></li>'; } /* [CHOCO-PLANNED] */
    [...ul.querySelectorAll('li[data-k]')].forEach((li, i) => { const on = String(R[i].key) === String(sel); li.querySelector('small').textContent = R[i].sub; li.classList.toggle('sel', on); li.querySelector('.tr-follow').classList.toggle('on', on && m === 'chase'); li.querySelector('.tr-cab').classList.toggle('on', on && m === 'cab'); }); }
  setInterval(trains, 1000);
  function ride(k, m) { const O = OU(); if (O && !A.trains.length) { O.select(+k); O.setOpsMode(m); } else { A.setSel(+k); A.setMode(m); } lastSig = ''; tick(); }
  $('trainlist').onclick = e => { const b = e.target.closest('button'), li = e.target.closest('li[data-k]'); if (!li) return; if (b) { b.blur(); ride(li.dataset.k, b.classList.contains('tr-cab') ? 'cab' : 'chase'); } else { const O = OU(); if (O && !A.trains.length) O.select(+li.dataset.k); else A.setSel(+li.dataset.k); trains(); } };
  // with the ops sim, Cab / Chase (buttons, 3 / 4) ride the selected ops loco; Walk / Orbit / Home leave the ops camera
  const opsRoute = m => { const O = OU(); if (!O || A.trains.length) return false; if (m === 'cab' || m === 'chase') { O.setOpsMode(m); return true; } if (O.getMode()) O.setOpsMode(null); return false; };
  document.querySelectorAll('#topbar [data-mode]').forEach(b => b.addEventListener('click', e => { if (opsRoute(b.dataset.mode)) { e.stopImmediatePropagation(); } b.blur(); setTimeout(tick, 30); }, true));
  addEventListener('keydown', e => { if (/input|select|textarea/i.test(e.target.tagName || '')) return; const m = { Digit1: 'orbit', Digit2: 'walk', Digit3: 'cab', Digit4: 'chase', Home: 'walk' }[e.code]; if (m && opsRoute(m)) e.stopImmediatePropagation(); }, true);
  // jump-to-location list
  const LOC = locations(A); const jp = $('jump'), q = $('jump-q'), list = $('jump-list'); let act = 0, shown = [];
  function render() { const s = q.value.trim().toLowerCase(); shown = LOC.filter(l => !s || (l.name + ' ' + l.cat).toLowerCase().includes(s)).slice(0, 80); act = Math.min(act, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((l, i) => `<li class="${i === act ? 'act' : ''}" data-i="${i}" title="Walk to ${esc(l.name)}"><span>${esc(l.name)}</span><span class="cat">${esc(l.cat)}</span></li>`).join('') || '<li class="cat">No match</li>'; }
  function go(i) { const l = shown[i]; if (!l) return; const F = A.flyped, md = A.getMode();   /* [FLYPED] Fly / Pedestrian keep their mode */
    if (F && (md === 'ped' || md === 'fly')) { let li = 0, bd = 1e9; A.LV.forEach((o, k) => { const d = Math.abs((l.y || o.deck) - o.deck - 1.5); if (d < bd) { bd = d; li = k; } }); if (md === 'ped') F.placePed(li, l.x, l.z); else F.flyTo(li, l.x, l.z); closeJump(); return; }
    if (!A.teleport(l.x, l.z, l.y)) return; closeJump(); }
  function openJump() { jp.classList.remove('hidden'); if (window.L3DUI && L3DUI.state.min && L3DUI.state.min.jump) jp.querySelector('.l3d-minb') && jp.querySelector('.l3d-minb').click(); if (A.plc.isLocked) A.plc.unlock(); render(); setTimeout(() => q.focus(), 30); }
  function closeJump() { jp.classList.add('hidden'); q.blur(); }
  document.querySelector('[data-panel-open=jump]').onclick = e => { e.currentTarget.blur(); jp.classList.contains('hidden') ? openJump() : closeJump(); };
  jp.querySelector('[data-close=jump]').onclick = closeJump; q.oninput = () => { act = 0; render(); };
  list.onclick = e => { const li = e.target.closest('li[data-i]'); if (li) go(+li.dataset.i); };
  q.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'ArrowDown') { act = Math.min(shown.length - 1, act + 1); render(); e.preventDefault(); } else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); render(); e.preventDefault(); } else if (e.key === 'Enter') go(act); else if (e.key === 'Escape') closeJump(); });
  q.addEventListener('keyup', e => e.stopPropagation());
  addEventListener('keydown', e => { if (/input|select|textarea/i.test(e.target.tagName || '')) return; if (e.code === 'KeyJ') { e.preventDefault(); openJump(); } else if (e.code === 'Escape' && !jp.classList.contains('hidden')) closeJump(); });
  // first-run quick start (the help card); "don't show again" remembered
  const help = $('help'); $('qs-never').checked = !!st.qsOff;
  const closeHelp = () => { st.qsOff = $('qs-never').checked; save(); help.classList.add('hidden'); };
  if ($('qs-go')) $('qs-go').onclick = closeHelp; $('helpx').onclick = closeHelp; help.addEventListener('click', e => { if (e.target === help) closeHelp(); });
  addEventListener('keydown', e => { if (e.code === 'Escape' && !help.classList.contains('hidden')) closeHelp(); });
  // [UX 2026-10-18] task-based start: three big choices instead of a key table (the table is under "All controls")
  help.querySelectorAll('[data-start]').forEach(b => b.onclick = () => { const m = b.dataset.start; closeHelp();
    if (m === 'fly') { A.setView('town'); A.setMode('fly'); } else if (m === 'ped') { const sp = A.flyped && A.flyped.streetSpot(); if (sp) A.flyped.placePed(sp[0], sp[1], sp[2], sp[3]); else A.setMode('ped'); }
    else if (m === 'overview') A.setView('overview'); else if (m === 'walk') { A.setMode('walk'); if (A.goSpawn) A.goSpawn(); } else { const R = rows(); if (R.length) ride(R[0].key, 'cab'); else A.setMode('cab'); } lastSig = ''; tick(); });
  const want = QS.get('qs') === '1' || (!st.qsOff && !QS.has('shot') && QS.get('ui') !== '0' && QS.get('qs') !== '0');
  if (want) help.classList.remove('hidden');
  layoutMap(A, { rows, ride, OU, st, save, tick: () => { lastSig = ''; tick(); } });
}
// [UX 2026-10-18] layout map: plan view of one deck with you, the trains and the main areas; click anywhere to go there
// (Walk: stand on the aisle facing that spot; other modes: the overview camera flies over it). M toggles, tabs pick the deck.
function layoutMap(A, U) { const panel = $('map'), cv = $('map-cv'); if (!panel || !cv) return; const L = window.LAYOUT || {}, EX = L.extent || [132, 122], cx = cv.getContext('2d');
  const levels = (L.levels || []).map((V, i) => ({ V, i, name: 'L' + (V.id || i + 1) })); if (L.l3 && L.l3.tracks) levels.push({ V: L.l3, i: 2, name: 'L3', l3: true });
  let lv = U.st.mapLv || 0; const pad = 6, sc = Math.min((cv.width - 2 * pad) / EX[0], (cv.height - 2 * pad) / EX[1]); const P = (x, y) => [pad + x * sc, pad + y * sc], W2 = (px, py) => [(px - pad) / sc, (py - pad) / sc];
  const AREAS = locations(A).filter(l => /^(Industry|Yard|Town)/.test(l.cat)); const tabs = $('map-tabs');
  tabs.innerHTML = levels.map((o, k) => `<button data-lv="${k}">${o.name}</button>`).join(''); tabs.onclick = e => { e.stopPropagation(); const b = e.target.closest('[data-lv]'); if (!b) return; lv = +b.dataset.lv; U.st.mapLv = lv; U.save(); b.blur(); draw(); };
  const lvOfY = y => { const md = A.getMode(); if (md === 'ped' && A.flyped) return A.flyped.st.lv; if (md === 'fly') { let b = 0; (A.flyped ? A.flyped.levels() : A.LV).forEach((o, k) => { if (y >= o.deck - 0.5) b = k; }); return b; }   /* [FLYPED] */
    let best = 0, bd = 1e9; A.LV.forEach((o, k) => { const d = Math.abs(y - A.EYE - o.deck); if (d < bd) { bd = d; best = k; } }); return best; };
  function draw() { if (panel.classList.contains('l3d-collapsed') || panel.classList.contains('hidden')) return; const o = levels[lv] || levels[0]; if (!o) return;
    tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === lv));
    cx.fillStyle = '#10161d'; cx.fillRect(0, 0, cv.width, cv.height); const V = o.V;
    cx.fillStyle = '#26352a'; for (const b of V.boards || []) { const [x0, y0] = P(b[0], b[1]), [x1, y1] = P(b[2], b[3]); cx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    cx.fillStyle = '#2f5a7a55'; for (const w of V.water || []) if (w.pts) { cx.beginPath(); w.pts.forEach((q, k) => { const [x, y] = P(q[0], q[1]); k ? cx.lineTo(x, y) : cx.moveTo(x, y); }); cx.fill(); }
    cx.fillStyle = '#8a7a6a88'; for (const st of V.structures || []) if (st.r && !st.minor) { const [x0, y0] = P(st.r[0], st.r[1]), [x1, y1] = P(st.r[2], st.r[3]); cx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    cx.lineCap = 'round'; for (const t of V.tracks || []) { if (!t.pts) continue; cx.strokeStyle = t.type === 'main' ? '#e5e7eb' : t.type === 'siding' ? '#9ca3af' : '#a1866a'; cx.lineWidth = t.type === 'main' ? 1.6 : 1; cx.beginPath(); t.pts.forEach((q, k) => { const [x, y] = P(q[0], q[1]); k ? cx.lineTo(x, y) : cx.moveTo(x, y); }); cx.stroke(); }
    if (!o.l3) for (const a of AREAS) if (a.cat.endsWith('L' + (o.V.id || lv + 1))) { const [x, y] = P(a.x, a.z); cx.fillStyle = '#f59e0b'; cx.beginPath(); cx.arc(x, y, 2.6, 0, 7); cx.fill(); }
    // trains
    cx.fillStyle = '#ef4444'; const O = U.OU();
    if (O && !A.trains.length) { for (const l of O.locos()) if (l.pos && l.pos.level === lv + 1) { const [x, y] = P(l.pos.x, l.pos.y); cx.fillRect(x - 3, y - 3, 6, 6); } }
    else for (const t of A.trains) { if (t.lv !== lv || t.state === 'staged' || !t.cars[0] || t.cars[0].cx == null) continue; const c = t.cars[0], [x, y] = P(c.cx, c.cz); cx.fillRect(x - 3, y - 3, 6, 6); }
    // you
    const cam = A.camera, here = lvOfY(cam.position.y); if (!o.l3 && here === lv || A.getMode() === 'orbit') { const [x, y] = P(cam.position.x, cam.position.z); const d = new THREE.Vector3(); cam.getWorldDirection(d); const an = Math.atan2(d.z, d.x);
      cx.save(); cx.translate(Math.max(4, Math.min(cv.width - 4, x)), Math.max(4, Math.min(cv.height - 4, y))); cx.rotate(an); cx.fillStyle = '#38bdf8'; cx.beginPath(); cx.moveTo(8, 0); cx.lineTo(-5, -5); cx.lineTo(-2, 0); cx.lineTo(-5, 5); cx.closePath(); cx.fill(); cx.restore(); } }
  setInterval(draw, 300); draw();
  const near = (wx, wy) => { let b = null, bd = 6; for (const a of AREAS) { if (!a.cat.endsWith('L' + (levels[lv] && levels[lv].V.id || lv + 1))) continue; const d = Math.hypot(a.x - wx, a.z - wy); if (d < bd) { bd = d; b = a; } } return b; };
  cv.onmousemove = e => { const r = cv.getBoundingClientRect(), [wx, wy] = W2((e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height); const a = near(wx, wy); $('map-tip').textContent = a ? a.name : 'click the map to go there'; };
  cv.onclick = e => { const r = cv.getBoundingClientRect(), [wx, wy] = W2((e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height); const o = levels[lv]; if (!o) return;
    const deck = o.l3 && A.deckAbs ? A.deckAbs(2) : (A.LV[lv] || A.LV[0]).deck;
    if (A.getMode() === 'walk') { A.teleport(wx, wy, deck + 1.5); }
    else if (A.flyped && A.getMode() === 'ped' && (!o.l3 || A.flyped.levels().length > A.LV.length)) { A.flyped.placePed(o.l3 ? A.LV.length : lv, wx, wy); }   /* [FLYPED] walk there as a 1:160 person (L3 staging shelf too) */
    else if (A.flyped && A.getMode() === 'fly' && (!o.l3 || A.flyped.levels().length > A.LV.length)) { A.flyped.flyTo(o.l3 ? A.LV.length : lv, wx, wy); }
    else { const O = U.OU(); if (O && O.getMode && O.getMode()) O.setOpsMode(null); A.setMode('orbit'); A.orbit.target.set(wx, deck, wy); const under = !o.l3 && lv < A.LV.length - 1; A.camera.position.set(wx, deck + (under ? 12 : 34), wy + (under ? 26 : 40));   /* a lower deck: stay under the deck above */ A.orbit.update(); }
    U.tick(); draw(); };
  document.querySelectorAll('[data-go=aisle]').forEach(b => b.onclick = () => { b.blur(); dispatchEvent(new KeyboardEvent('keydown', { code: 'Home' })); });
  const toggle = () => { const m = window.L3DUI && L3DUI.state.min; const btn = panel.querySelector('.l3d-minb'); if (btn) btn.click(); setTimeout(draw, 30); };
  $('mapb').onclick = e => { e.currentTarget.blur(); toggle(); };
  addEventListener('keydown', e => { if (/input|select|textarea/i.test(e.target.tagName || '')) return; if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) toggle(); });
  window.__l3dmap = { draw, setLevel: k => { lv = k; draw(); } };
}
// industries (ops data), yard, town, stations, signals and scenes, all searchable
function locations(A) { const L = window.LAYOUT || {}, out = [], seen = new Set(), lv = A.LV;
  const add = (name, cat, x, z, li) => { const k = name.toLowerCase(); if (!name || seen.has(k) || !isFinite(x) || !isFinite(z)) return; seen.add(k); out.push({ name, cat, x, z, y: (lv[li] || lv[0]).deck + 1.5 }); };
  const OD = window.OPS_DATA; if (OD && OD.industries) { const E = {}; (OD.graph.edges || []).forEach(e => E[e.id] = e); const TK = {}; (OD.tracks || []).forEach(t => TK[t.id] = t);
    OD.industries.forEach(i => { const t = TK[i.tid]; if (!t) return; const pts = t.edges.flatMap(id => (E[id] || {}).pts || []); if (!pts.length) return; const p = pts[pts.length >> 1]; add(i.name, 'Industry · L' + t.level, p[0], p[1], t.level - 1); });
    (OD.tracks || []).filter(t => /yard/i.test(t.type)).slice(0, 1).forEach(t => { const pts = t.edges.flatMap(id => (E[id] || {}).pts || []); if (pts.length) { const p = pts[pts.length >> 1]; add('Yard', 'Yard · L' + t.level, p[0], p[1], t.level - 1); } }); }
  add('Aisle spawn', 'Start', A.spawn.look[0], A.spawn.look[1], 0); if (A.LOOK0) add('Town centre', 'Town · L1', A.LOOK0[0], A.LOOK0[1], 0);
  (L.levels || []).forEach((V, li) => {
    (V.structures || []).filter(s => s.name && s.r && !s.minor && !/^(backyard|lineside|farm:|industry:|MOW:|sign:)/i.test(s.name)).forEach(s => { const nm = s.name.replace(/\s*\(.*?\)|\s*\[.*?\]/g, '').trim();
      add(nm, (s.kind === 'industrial' ? 'Industry' : /yard|car-shop|MOW/i.test(s.name) ? 'Yard' : 'Town') + ' · L' + V.id, (s.r[0] + s.r[2]) / 2, (s.r[1] + s.r[3]) / 2, li); });
    (V.labels || []).forEach(l => { if (l.kind === 'signal') add(l.text, 'Signal · L' + V.id, l.x, l.y, li); else if (l.kind === 'life') add(l.text.charAt(0).toUpperCase() + l.text.slice(1), (/yard/i.test(l.text) ? 'Yard' : 'Scene') + ' · L' + V.id, l.x, l.y, li); }); });
  const ord = c => /^Start/.test(c) ? 0 : /^Industry/.test(c) ? 1 : /^Yard/.test(c) ? 2 : /^Town/.test(c) ? 3 : /^Signal/.test(c) ? 4 : 5;
  return out.sort((a, b) => ord(a.cat) - ord(b.cat) || a.name.localeCompare(b.name)); }
})();
