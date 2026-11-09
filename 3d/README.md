# Layout 3D viewer (layout3d)
**Open:** double-click `index.html` (Chrome, Edge, Firefox or Safari). Everything is local: three.js r147 is in `vendor/`, the plan is in `layout-data.js`. No internet or server is needed.
If a locked-down browser refuses local scripts, run `python3 -m http.server` in this folder and open http://localhost:8000.

| Key / control | Action |
|---|---|
| 1 / 2 / 3 / 4 | Orbit / Walk / Cab ride / Chase |
| Orbit | left-drag rotate · right-drag pan · wheel zoom · View buttons: Overview, L1, L2, Elevator |
| Walk | click to capture the mouse (Esc releases) · W A S D · mouse look · Shift sprint (100 in/s, walk 50 in/s) · Space / C raise / lower eye · drag-to-look without capture |
| Home | Walk: back to the aisle spawn |
| N | next train for Cab / Chase |
| P · + / − · slider | pause · scale speed (mph, default 40) |
| L · F · G · Q · H | labels · stats (fps, draw calls, triangles) · shadows · quality Low/Med/High · help |

Scale: world units are real inches; models are N scale (1:160). Eye height 67 in (5 ft 11 in). L1 deck top 38 in, L2 deck top 56 in (18 in separation), unless the plan data says otherwise.
URL options (for scripted screenshots): `?mode=orbit|walk|cab|chase&view=overview|l1|l2|elev&train=N&t=SECONDS&q=low|med|high&shadows=1&labels=1&ui=0&cam=x,y,z,tx,ty,tz`.

## Walk height, seating and reach (added 2026-10-13)
- Height row: preset (child 4'0", 5'0", 5'6", Owner 5'11" default, 6'4", wheelchair, Owner in office chair...), height slider, pose (standing / office / stool / dining / wheelchair), seat slider. Eye = height − 4 in standing (67 in for 5'11"); seat + 0.434 × stature seated. Readout shows standing, seat and eye height in ft-in and cm; a badge pops up on Space/C. Saved in localStorage; URL `height=71&pose=office&seat=18.5`. Seated walking is slower with wider chair clearance.
- Reach row: envelope toggle (green = comfortable ≤ 0.9 × arm, yellow = with lean), arm (default 31 in, Owner measured), lean (8 in), "Reach here [R]" shows a 3D arm to the clicked point and reports reach, accounting for the L2 deck overhang. Target rings are coloured green/yellow/red.

## Clean view / panels
- **Tab** (or the small eye button, bottom-right) hides ALL panels, menus, HUD, zoom indicator and the radio feed for a clean full view; Tab or the eye brings them back.
- Each main panel (controls, ops session, stats) has a **–** button (or click the panel title) to minimise it on its own.
- Both are remembered (localStorage) next time you open the viewer.
- Zoom in Walk / Cab: mouse wheel or + / - (down to 10°), 0 or middle-click resets.

## Start view / aisle spawn (added 2026-10-15)
- Opens in **Walk** standing in the operator aisle nearest the middle of the layout (free floor inside the benchwork footprint, picked from the plan), facing the nearest fascia, eye 67 in. `?mode=orbit` (or `view=`/`cam=`) still starts in Orbit; `?spawn=x,z[,tx,tz]` (plan inches, optional look-at) overrides the spot if walkable.
- Switching to Walk from Orbit / Cab / Chase keeps your x/z (dropped to eye height, view levelled) only when you are over the aisle floor; otherwise you are teleported to the spawn. **Home** returns to the spawn any time.

## UI (2026-10 redesign)
- Top toolbar: Walk (2) / Orbit (1) / Chase (4) / Cab (3), current mode + hint, Jump to… (J), Home, Run/Pause (P), Help (H), eye button / Tab hides all UI. Settings panel (right) has collapsible sections (state remembered); each panel's – minimises (localStorage).
- Jump to…: searchable list of industries, yard, aisle spawn, town, structures, signals; arrows + Enter, Esc closes; teleports in Walk.
- First-run quick start (tick "don't show again"; `?qs=1` forces it, `?qs=0` hides it).
- Train list: Follow (Chase) and Cab buttons per train.
- Cab stand (Cab mode): W/S throttle notch 0-8, ; / ' automatic brake, , / . independent brake, Space horn, V bell; speed in mph and km/h.

## Physics (assets/physics.js, shared with the ops engine and ops/physics.py)
Mass-based: tractive effort (adhesion / horsepower limited, per-notch), modified Davis rolling resistance, 20 lb/ton per % grade, 0.8 lb/ton per degree of curve, air brakes with cylinder lag, independent brake, coupler slack (6 in prototype per coupler). Speeds are scale mph (N in/s = mph x 17.6 / 160): yard 10, main 40-60.
Tests: `node test/physics_check.js [plan]`, `node test/geometry_check.js [--strict] [plan]`.

## Level 3 (future staging)
`build_viewer.py <plan> --levels 3` (or `<plan>/layout3d-options.json` `{"levels": 3}`, or `?levels=3` at runtime) draws an L3 deck shell 18 in above L2 plus the lift landing tracks. The lift serves L1/L2/L3 with the same interlock; trains going to staging ride to L3 and despawn, and come back on the lift after `?stage=` seconds (default 60). The ops engine/game take the same option (`build_ops.py --levels 3`, `?levels=3`). Test: `node test/l3_shot.js <viewer-dir> [ops-dir]`.

## Flex main-line corners (assets/easement.js)
Main-line corners are built in flex track. The viewer, ops engine and geometry_check all use the same shared code. It replaces each drawn corner with a clothoid spiral-arc-spiral and keeps TS, ST, PI and both tangent lines exactly where they are. The body radius is 18.000 in. The spiral lengths are solved so the curve still meets the drawn tangent points. Kato sectional track is left alone: yard, spurs, sidings, turnouts and the NE/SE R381-30 lift curves. Add `?flex=0` to the URL to see the drawn polylines instead. build_ops writes the eased corners into ops-data (`flex`), and the engine splices them into the main edges.

## Pruning unused external models (prune_ext.js, 2026-10-17)
A plan viewer embeds every ingested glb (`assets/ext/<id>.js`, 45 models ≈ 210 MB). To ship under ~100 MB, prune the ones the plan never
uses **after** `build_viewer.py`:

    node prune_ext.js <plan>/viewer3d-v3            # dry run: lists used / unused ext models (headless Chrome, ?levels=3)
    node prune_ext.js <plan>/viewer3d-v3 --apply    # moves unused to <plan>/pruned-ext-viewer3d-v3/ and drops them from external-index.js

"Used" = instanced parts, merged geometry, rigged rolling stock, tiled fences/docks and placed structures recorded by the page.
`--keep id,id` keeps extra ids (default `loco-es44,veh-sedan`, spawned only by some sessions). Rebuild (not un-prune) to restore.
Then package with `package_viewer.py` (never point `--out` at a folder holding other deliverables: it moves other files to obsolete/).

## Texture shrink (post-build)
After build + prune, run `python shrink_ext_textures.py <viewer>` (textures capped at 1024 px; JPEG q85 where there is no alpha). This keeps the single zip under 100 MiB.
