# layout3d asset library (v3)

These are procedural three.js modules loaded with plain `<script>` tags, so they work over file://. The viewer picks them up automatically, so plans need no changes.

| file | contents |
|---|---|
| core.js | shared helpers, canvas textures, materials (`L3D.mat`, `L3D.MATS` hook), `Batch` (merge per material, `setT` local transform), `L3D.reg` |
| track.js | Kato Unitrack: `L3D.kato.lay` (roadbed profile, code 80 rail, tie poses), `turnout(bt,'#6'/'#4',hand)`, `bumper`, plus registered straights, curves and turnouts |
| structures.js | kit builders (Walthers / DPM / WS / MU / ISE / kitbash), typed generics `gen-*`, `L3D.resolveStructure(s)` (regex on name/kit no., else by kind) |
| scenery.js | instanced assets via `L3D.geo(id)` / `L3D.geoLow(id)`: trees, hedges, utility poles, signals, crossings, huts, vehicles, people, props. Path assets via `L3D.path.fence / pier` |
| rollingstock.js | `L3D.rs.carGeo(type,len,livery)` / `locoGeo(model,rr,len)` with roadname liveries on a canvas atlas (1 draw call per type+livery) |
| external.js + external-index.js + ext/<id>.js | drop-in .glb overrides (see below) |
| registry.json / registry.js | id → name, category, kit no., measured size (in), triangle count, builder, [verify] flags. Regenerate with `node test/gen_registry.js` |
| gallery.html | shows every asset (open from tools/layout3d/assets/) |
| SOURCES.md | dimensions and sources, plus the [verify] list |
| GROK-BUILD-PROMPTS.md / -top10.md | ready-to-paste prompts for external high-quality models (regenerate: `python3 gen_prompts.py`) |

## External .glb overrides
To override an asset, put `assets/external/<asset-id>.glb` in place, or attach it in chat so it lands in `(build path)<asset-id>.glb`. Then run `python3 check_external_assets.py` (report only) or `--write` (embed).
`build_viewer.py` runs it with `--write` automatically. The check covers:
- glTF 2.0 binary, fully self-contained
- unit detection (N mm / in / real m, cm, ft, mm)
- size against the registry, auto-scaling when off by more than 5% (with a warning)
- Z-up → Y-up
- re-centring the origin to the footprint centre on the ground
- triangle budget and texture sizes; Draco/meshopt is rejected

Accepted models are base64-embedded into `ext/<id>.js` (one script per asset, loaded one at a time and freed after parsing; listed in `external-index.js`) so file:// still works. Structures use the full PBR glTF, fitted to the plan footprint. Instanced assets (vehicles, trees…) are flattened to vertex colour, so their textures are not used. Rejected or missing files fall back to the procedural asset.

## Terrain, water, nature, reach (added 2026-10-13)
- `terrain.js` – `L3D.terrain.build(o, ctx)` heightfield per level (0.5 in grid). Track corridor, roads, lots and structure pads are exactly deck height (grade 0, foundations leveled); 0.55 in shoulders, ditches 0.95 in out / 0.14 in deep; fields undulate; water bottoms −0.5 in, surface −0.32 in with banks; ground blends to the fascia and rises toward the backdrop. Per-plan overrides: `<plan>/terrain.json` (auto-written by build_viewer.py if missing): `defaults`, per-level `params`, `points` [x,y,dz,radius], `contours`, `features` (cut / fill / embankment / pond), `season`, `moss`, `woods`. URL: `terrain=0`, `season=spring|summer|fall|winter`, `moss=0`, `woods=0`.
- `water.js` – rippling reflective shader (fresnel sky, sun glint, tannin depth colour, foam/mud at shallow edges).
- `nature.js` – species (loblolly/longleaf pine, oaks, live oak + Spanish moss, sweetgum, cedar, bald cypress + knees), understory, kudzu, tufts, wildflowers, cattails, hedgerows, forest-edge falloff, crop rows at real spacing (tobacco 48 in, cotton 38 in, soy/corn 30 in), rocks. Instanced, chunked, distance-culled, hi/low LOD for trees and crops.
- `reach.js` – reach envelope, target rings (turnouts, derived uncoupling spots, structures) and the "Reach here [R]" arm test. `arm`, `lean`, `reach=0` URL params.
- Checks: `terrain_check.py <plan>` → `terrain-check.md/json`; `reach_check.py <plan> --height 71 [--pose seated --seat 18.5] --arm 31 --lean 8` → `reach-check-*.md/json`.
- `glb_downscale.py <file.glb> [--max 1024]` shrinks textures in an external .glb (original kept in `external/originals/`).
