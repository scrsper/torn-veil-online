# Starting Town — PROGRESS (branch claude/starting-town-oct20)

Base: `world-sphere-100f` @ bd6b05d (chosen 2026-10-20 for the most reusable world/engine code: planet + settlement world code, GLB asset registry with sha256 checks, CC0 materials, lighting/atmosphere, media tools). The world-run log that came with the base is preserved at docs/progress/world-sphere-100f-PROGRESS.md.

Driven by /workspace/town-run/loop.sh (Claude Code, Opus 5.5). Each session: read this file, continue, update it.

## Checklist
- [ ] Read vault + repo rules; record decisions here
- [ ] Town entry point (own page/mode) reusing engine code
- [ ] Town layout + terrain, composition
- [ ] Lighting, fog, atmosphere, time of day
- [ ] Props/dressing from Omnius assets (manifest: docs/town/ASSET_MANIFEST.md)
- [ ] Placeholder player: WASD + click-to-move
- [ ] Third-person RPG camera: over-shoulder follow, mouse orbit, zoom, collision
- [ ] Placeholder NPCs
- [ ] tsc --noEmit + targeted vitest green
- [ ] Production static build of the town page
- [ ] Deploy to Cloudflare Pages (new project) + live URL
- [ ] 3-4 screenshots of the deployed build in /workspace/torn-veil-online/media/starting-town/
- [ ] Final report in /workspace/town-run/DONE

## Decisions
- **Read (session 1, 2026-10-20 22:10 CT):** vault Agent Operating Guide v0.0.4, Exclusions, Torn Veil index, TV CLAUDE.md, Torn Veil readiness and Constitution review, Agent Ops/Memory; repo AGENTS.md, CLAUDE.md, constitution (vision, §46 rendering is not reality, sim clocks), world-sphere-100f PROGRESS (engine = Babylon.js 9.28, right-handed Y-up; GLB registry `LibraryLoader` with in-browser sha256; cooked library collision `libraryCollision.json`; CC0 scans via `loadScannedMaps`; pagoda exterior `buildPagoda`). PROCEDURAL_SETTLEMENTS / COMBAT_CAMERA_REFINEMENT skimmed for intent only; the town uses its own small camera rig.
- **Shape of the town:** flat town frame (x, z metres, y up), not the sphere: one seeded plan `src/sim/town/layout.ts` (TOWN_SEED 20261020). South gatehouse → cobbled main street through the hamlet-lane GLB → round fountain plaza (tavern east, covered market west, houses ringing it) → north gate framing the Tower of Chrysanthus pagoda on its hill 236 m north (the focal landmark; not enterable here). Stone curtain wall with towers; meadow outside rising to pine hills at the 178 m playable ring; watchpost outside the east gate, ruined junction in the NW meadow.
- **Own page:** `web/town.html` + `web/town.ts` → `src/web/town/main.ts`; `vite.town.config.ts` builds to `dist-town/` with **no** public dir; `scripts/town/stage-assets.mjs` copies exactly the used CC0 textures + HDR and the hash-checked GLBs into the build.
- **Sim/presentation split:** pure modules in `src/sim/town/` (layout, collision, movement, camera math, NPC wander, ground mask); Babylon code in `src/web/town/`. Collision uses the GLBs' cooked footprints (sha-keyed, independent of load state) + plan colliders. NPCs: fixed 10 Hz tick, per-figure seeded RNG streams, idle/wander around anchors (vendors, guards, patrons, strollers); deterministic for seed + tick count. No LLM, no triggers.
- **Assets:** only the torn-veil-assets GLBs (11 of 12; bridge skipped) + vetted CC0 Poly Haven scans + procedural geometry. The focused pack in web/public/focused is NOT used (not from torn-veil-assets). Library `RUNTIME_vegetation` (flat canopy strips) and most `RUNTIME_ground` slabs are hidden in favour of the town's own trees and splat ground.
- **Look:** golden hour default (sun 15° elevation, warm key + cascaded shadows, cool sky fill with warm bounce, EXP2 haze tinted to the horizon, gradient sky with sun glow and cloud deck, volumetric light shafts, lamp glow layer + nearest-lamp point lights). `?time=dusk|day`, `?lite` (1024 single shadow map, no glow/shafts, coarser ground).

## Assets used / skipped

## Known gaps

## Log
