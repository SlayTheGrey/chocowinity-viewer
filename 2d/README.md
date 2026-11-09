# tools/layout3d/ops — operations simulator + playable ops game

This module is self-contained. It does not edit `tools/layout3d/app/` or `assets/`. It reads a plan's `layout.json` and writes into `<plan>/ops-sim/`.

## Build any plan (cheap)
```
(build path) tools/layout3d/ops/build_ops.py reference/<plan> [--seeds 1,2,3] [--zip] [--compare reference/<other-plan>] [--resim]
```
* Outputs: `<plan>/ops-report.md` (scorecard, comparison, industries, jobs per seed, move plans, dispatcher log, limits), `<plan>/roster.json` (written once and then kept, so you can edit it), and `<plan>/ops-sim/` (`index.html`, `ops-data.js`, game/engine/audio/control JS, `ops-results.json` cache). With `--zip` it also writes `<plan>/ops-sim.zip`.
* Sim results are cached in `ops-results.json`. Pass `--resim` after you change `ops.json`, `roster.json` or the layout.
* Headless test: `node tools/layout3d/ops/test/run_game.js <plan>/ops-sim <outdir> [seconds]`. It needs Playwright. It runs the game in auto mode (`?test=1&seed=1`), writes screenshots (start/end/L1/L2/ride/help) and `test-result.json` (job status, score, violations, console errors, engine log).

## Data files (per plan)
* `layout.json` (layout3d/1). The graph is built from levels → tracks/turnouts/elevator (`graph.py`). Lift pieces become a movable edge: 18 in travel, 8 s cycle, with an interlock.
* `ops.json` (put it next to the plan or in `reference/<plan>/ops.json`):
  * `industries`: `[{id, name, track:[x,y,level], groups:[{name, spots, types}]}]`. Groups run bumper-first.
  * `jobs`: `[{id, name, level, hold:[x,y,level], industries, loco, game:true|false, block:'auto'}]`.
  * `session`: `{minutes, fast_clock, through_headway_min, seed, through_trains}`.
  * optional `session.timetable` (list of `{sym, start, legs: [[kind, from, to, t0_min, t1_min]], hold_staging_min, hold_main_min}`): `dispatch.py` then runs in **timetable mode** (through trains only when the timetable runs them, fouling windows at each job's `start_min`, lift waits = the timetable's main-track holds; staging holds reported separately). Without it (or with `session.dispatch = "headway"`) the old stress mode runs a through train every `through_headway_min` for the whole session, so lift waits pile up and are not comparable with a timetable.
* `roster.json`: locos and cars generated from `trains.json` consists, car lengths and planned purchases. Edit it to add or remove equipment. Car cards and session cars only draw from this pool. Equipment that belongs to through trains (priority ≤ 3) is excluded from the locals.

## file:// boot guard and split zips (2026-10-18)
* `index.html` loads every core file with plain `<script>`/`<link>` tags. An inline boot guard (`window.OPSBOOT`, first in `<head>`) names any file that fails to load, plus the zip that holds it when the game was split. After the core scripts it checks each one's global (`OPS_DATA`, `L3DPhysics`, `L3DEase`, `OpsEngine`, `OpsAudioSamples`, `OpsAudio`, `RadioVoiceConfig`, `RadioVoice`, `OpsRadio`, `OpsControl`). It also explains Chrome's opaque "Script error.", and shows "The game did not start" if `window.__opsGame` never appears. It never shows a blank page.
* `parts-manifest.js` comes first. build_ops writes a stub (`window.OPS_PARTS = null;`); `split_ops_parts.py` replaces it in part 1.
* Voice packs are optional. A missing pack falls back to browser speech, and a small note names the zip that holds it. Packs also load from sibling or nested part folders (`window.OPSALT`, `VOICE_PACK_REL`).
* The one-zip ops-sim is about 32.6 MB because 40 voice packs are 9 kbps Opus, which barely compresses. To stay under a transfer limit, use
  `python tools/layout3d/ops/split_ops_parts.py <plan>/ops-sim --out DIR --name rev4-ops-sim --limit-mb 22.6 --first v04,v01,...`
  Part 1 holds the whole game plus the most-heard voices (`--first` takes the order measured in real sessions) and runs alone. The other parts hold only voices.

## Playing (`<plan>/ops-sim/index.html`, works from file://)
* **Mode:** Mixed (you run your local; AI runs the through trains and the other locals), Automated (AI runs everything, so you can watch or ride along), or Manual CTC (you line routes and the AI holds).
* **View:** both decks, L1, L2, ride-along cab, or follow (click a person or vehicle to follow it).
* **Throttle panel (DCC):** address select, 28/128 steps, knob / ↑↓ / wheel, R reverse, Space stop, E e-stop. F0 is the light, F1 the bell, F2 the crossing horn pattern. CV3/CV4 set momentum. MU consisting is supported.
* **Mouse:** click a turnout to throw it. Click a coupler (the gap between cars) to uncouple by hand. Couplers close automatically when cars meet at ≤ 4 smph. Click LIFT to cycle the lift. The interlock refuses to move the lift if a car is fouling it.
* **Keys:** P pause, H/? help, M mute. Use the speed select ×1–×8. Save and Load use localStorage.
* **Rules that score as violations:** run-through, throwing a turnout under a car (derail), overspeed on a #4 or curve (derail), hard coupling over 4 smph, collision, lift misuse, cars longer than 68 ft on a #4, and violating a blue flag or a warrant.
* **Fast clock:** 4:1. Car cards and switch lists are generated from the seed. AI through trains follow the roster priorities (Amtrak > intermodal > manifest > locals) and use the lift on a figure-8.

## Hooks for the 3D viewer / other code
* `window.OPS_DATA`: graph (nodes and edges with points/level), tracks, industries, jobs, sessions, precomputed plans `"JOB:seed"`, roster, scene, and score.
* `window.OpsEngine`: `new Engine(OPS_DATA)`, `new AI(engine)`, `setupSession(eng, seed, jobIds)`, `PlanExec`, `scoreSession`, `PRIO`, `MPH/IPS`.
  * Engine API: `tick(dt)`, `throwTurnout(id, 'N'|'D', who)`, `requestLift(level)`, `uncouple(cut, k)`, `posAt(cut, d)`, `carPose(cut, i)` (x, y, level, angle per car, which is what a 3D viewer needs to place models), `on(ev => …)` for the events turnout/couple/uncouple/violation/liftdone/horn, and `save()`/`load()`.
* `window.OpsAudio.create()`: spatial procedural audio (see `audio/audio.js` header and `audio/SOURCES.md`).
* `window.OpsControl.throttle(el, {engine, audio, getLocos, onSelect})`: the DCC handheld UI.
* `window.__opsGame`: `{engine, ai, audio, run(seconds), status(), setRate(r), D, ready}`, used by the headless test.
* **Viewer integration (documented hook, not wired in):** load `ops-data.js` + `engine/engine.js` into the viewer page, create an Engine, call `eng.tick(dt)` each frame and place each car mesh at `eng.carPose(cut, i)` (z = level deck height + lift offset from `eng.edgeLevel`). The 2D game's draw() is the reference for this.

## Python modules
`graph.py` (track graph and validation) · `tracks.py` (tracks between branch points) · `planner.py` (A* switching planner with moves, set-outs, pulls, capacities and a main-track penalty) · `sim.py` (seeded sessions, job runs) · `dispatch.py` (coarse through-train dispatcher with lift resource) · `report.py` (scoring and markdown) · `opsdata.py` (ops.json, roster) · `build_ops.py`.

## Limits
Audio is procedural (no CC0 recordings are embedded). The cab view is a rotated 2D top-down view, not 3D. The dispatcher is block/reservation based (no signals model). The planner is a bounded search, so "search limit" does not prove a move is impossible. The AI executes the precomputed plans for seeds 1–3 only. Cars standing over turnouts are reported as findings instead of being re-planned.

## Round 2 additions
- **Session sizing** (sim.size_session): trims through filler/set-outs so each local fits its hold track; results in sessions[].fill / ops-report "Consist sizing".
- **Planner fallbacks** (sim.fallback): clear-then-spot, car-by-car bumper-first, relaxed order at 4x budget; run_job retries with through cars dropped.
- **Plan executor (engine.js PlanExec)**: direction by topology, pulls clear of its own cut before throwing a turnout, backs clear of fouling points, never couples to another train, per-move track warrants (eng.reserve), watchdog on blocked backing moves.
- **Dispatcher (AI)**: block signals at both ends of every main/siding (G/Y/R; CTC hold via click), head-on meet breaker (lower-priority train backs clear and waits), work window (through train in a local's way 45 s -> sent to staging, returns when crews finish), non-overlapping through-train placement.
- **Game UI**: CTC panel (C: route lining OE.lineRoute, turnouts, signals, occupied blocks), Yardmaster screen (Y), radio voice via Web Speech (V).
- **Audio**: real recordings in audio/samples.js (licenses: audio/SOURCES.md), synth fallback kept.
- **3D hook**: `window.LAYOUT3D_OPS = {enabled, attach(api), update(dt), camera(dt, mode)}` set by ops/viewer/ops3d.js before app/viewer.js; viewer.js lines tagged `OPS-HOOK`/`OPSH` (skip demo trains, call update/camera, attach STATS.api). build_viewer.py injects ops scripts at `<!--AUDIO-->`. URL: ops=0, seed, opsmode=auto|mixed, rate, ride=first|<addr>, follow=N, fp=1, chase. Keys: 5 cab (mouse-drag look, B look back), 6 follow (click a person/car, V first person), 7 chase, 2 walk.

## Round 3 additions
- **Car identities through the plan.** Every planner step carries `after` (track → token order a→b: L loco, X through block, S:/O:/K: ind:grp) and `stop`. `PlanExec` uncouples / keeps coupling to match it; industry cars stand in planner order against the bumper (`placeOnTrack`). Headless check `node (build path) <ops-sim> <seed>` = set-outs spotted on the right track, planner-vs-engine order, long cars on #4 diverging legs, violations.
- **#4 rule (cars > 68 ft: rf, cb, c89, ar, amfleet).** planner.py: a move/dart whose route takes the *diverging* leg of a #4 (`part` matches `#4`) may not carry a token longer than `LONG_IN` = 5.5 in. opsdata.long_rule: an industry its job can only reach through a #4 diverging leg gets its long groups re-typed (rf→c60, cb/c89→f68, ar→c60; noted in `ind['long_rule']`). Engine fillers never use long cars. The game's rule (game.js `rules()`) now only fires on the diverging leg — the straight route of a #4 is fine.
- **Score fix.** standing_room counts only real hold-track overhang notes (round 2 counted fallback notes: best-version 57.1→44.5 was this bug; now 54.5, the rest is previously failing jobs now planned = more main-foul/switch time).
- **Dispatcher work window.** A local holding on a main sends that level's through trains to staging until it is done (radio "hold in staging — P20 has the L1 main"); through trains are placed only on free, non-adjacent main edges at session start; track warrants per move.
- **Fallbacks / planning budget.** run_job: fill-0 retry, then *held set-outs* (drop set-outs one by one, first from the failing industry, then from any; `r['held']` is applied to the game session). Total fallback time per job is capped by `JOB_BUDGET` (env `OPS_JOB_BUDGET`, default 600 s) — the round-3 "hang" was unbounded retries of 40–80k-state searches (2 blocks × 6 attempts × several minutes). `kill -USR1 <build_ops pid>` dumps the Python stack.
- **Credits.** Game "Credits" button and 3D overlay credits box read `window.OpsAudioCredits` (audio/samples.js): diesel (Work With Sounds / Technical Museum of Slovenia, CC BY 4.0), frogs (ElemePodcast, CC BY 4.0), US crossing bell (Eric Leonardson, archive.org aporee_4384_5756, CC BY-SA 3.0 — no CC0/PD US bell found). See audio/SOURCES.md.
- Plan findings for fresh-start-rev36: `reference/fresh-start-rev36/ops-findings.md` (north siding split into 21/22/16 in pieces → P20 holds on main T0; T44 32 in → R62 holds on main T39).
- Open: fresh-start-rev36 seed 3 P20 has no plan (70.2 in train on the 71.2 in main hold T0; search limit, and the held-set-out fallback did not converge within ~38 min). Fix is the layout one in ops-findings.md (a hold track ≥ 40 in).

## Round 4: two-way radio + popup fix
- **Popup close bug:** `.pop` panels (CTC, Yardmaster, Credits) had no `.hidden` CSS rule, so ✕ / toggles never hid them. Fixed (`.hidden{display:none!important}`), plus Esc and click-outside close; Help got a ✕ and backdrop-click close. 3D Credits box: ✕, Esc, click-outside. Verified headless (playwright: open → ✕ / Esc / outside click → hidden, all 4 panels).
- **audio/radio.js (OpsRadio)**, shared by the 2D game and the 3D overlay (`ops3d.js` loads `ops/audio/radio.js` itself, no build_viewer change). Turns engine log lines + live state into US-practice exchanges: track warrant request / issue / repeat-back / "that's correct, OK at hhmm" / release; staging holds and meets with repeat-backs; yardmaster instructions to the yard job; set-out / pick-up calls with car counts; conductor shove countdown (ten, five, three, two, one, "that'll do"); signal calls by through crews (clear / approach / stop, east/west end + place name); defect detectors on the longest main per level (axles, speed, temperature); emergency calls on derailment. Distinct stable voice per speaker (getVoices() en voice by hash, else pitch/rate), queued (nobody talks over anybody, backlog drops chatter first, repeats within 120 s dropped), key-up click + squelch tail through a 300–3000 Hz band-pass (speechSynthesis itself cannot be filtered). Toggles: 📻 Radio (V), Chatter on/off, level full/essential. Radio feed with speaker labels. Node-usable: `create(eng,{speak:false})` → `transcript` (sample: audio/radio-sample-transcript.txt).

## 2026-10 updates
- UI: toolbar with session status, Run/Pause, speed buttons (1x…), views, Help; start card (mode, seed, jobs) before the session starts (paused until Start; `?start=1` skips it); side panel sections: train cards (Drive / Ride), grouped switch list with progress, throttle, lift & score, dispatcher log with filters, sound. Tab / eye hides the UI, – minimises the side panel (both remembered).
- Physics: engine moves use the shared mass-based model (engine/physics.js = tools/layout3d/assets/physics.js); planner move costs use ops/physics.py (same model). ops-report.md times in existing plans were produced by the old constant-acceleration model; regenerate with `build_ops.py <plan> --resim` when you want them updated (writes the plan's ops-report.md).
- Level 3: `--levels 3` / `layout3d-options.json` / `?levels=3`; every other L2 lift trip goes to L3 staging, despawns, and comes back down after `stageDwell` (180 s).
- Flex corners: ops-data.js carries `flex` (eased main-line corners from assets/easement.js). The engine splices them into the main edges (end nodes fixed), so curve resistance and overhang follow the eased radius.
- **2026-10-16 engine fixes (rev4 seed 3):** LEAVECLEAR (a move never leaves cars fouling a turnout), SETOUTCOUNT (exact planned counts plus far-end coupled cars; after-state counting only with X blocks), PULLALL, FETCH (couple the move's cars standing apart on st.frm first), LEADK, BACKDIR, NOSTEAL (a departing job leaves delivered set-outs on their spot). Trace tool: `test/_trace.js <ops-sim> <seed> <out.json> [secs]` (env J=<job> logs that job's arrivals).
