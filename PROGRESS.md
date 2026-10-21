# Starting Town — PROGRESS (branch claude/starting-town-oct20)

Base: `world-sphere-100f` @ bd6b05d (chosen 2026-10-20 for the most reusable world/engine code: planet + settlement world code, GLB asset registry with sha256 checks, CC0 materials, lighting/atmosphere, media tools). The world-run log that came with the base is preserved at docs/progress/world-sphere-100f-PROGRESS.md.

Driven by /workspace/town-run/loop.sh (Claude Code, Opus 5.5). Each session: read this file, continue, update it.

## Checklist
- [x] Read vault + repo rules; record decisions here
- [x] Town entry point (own page/mode) reusing engine code
- [x] Town layout + terrain, composition
- [x] Lighting, fog, atmosphere, time of day
- [x] Props/dressing from Omnius assets (manifest: docs/town/ASSET_MANIFEST.md)
- [x] Placeholder player: WASD + click-to-move
- [x] Third-person RPG camera: over-shoulder follow, mouse orbit, zoom, collision
- [x] Placeholder NPCs
- [x] tsc --noEmit + targeted vitest green
- [x] Production static build of the town page
- [x] Deploy to Cloudflare Pages (new project) + live URL
- [x] 3-4 screenshots of the deployed build in /workspace/torn-veil-online/media/starting-town/
- [x] Final report in /workspace/town-run/DONE

## Decisions
- **Read (session 1, 2026-10-20 22:10 CT):** vault Agent Operating Guide v0.0.4, Exclusions, Torn Veil index, TV CLAUDE.md, Torn Veil readiness and Constitution review, Agent Ops/Memory; repo AGENTS.md, CLAUDE.md, constitution (vision, §46 rendering is not reality, sim clocks), world-sphere-100f PROGRESS (engine = Babylon.js 9.28, right-handed Y-up; GLB registry `LibraryLoader` with in-browser sha256; cooked library collision `libraryCollision.json`; CC0 scans via `loadScannedMaps`; pagoda exterior `buildPagoda`). PROCEDURAL_SETTLEMENTS / COMBAT_CAMERA_REFINEMENT skimmed for intent only; the town uses its own small camera rig.
- **Shape of the town:** flat town frame (x, z metres, y up), not the sphere: one seeded plan `src/sim/town/layout.ts` (TOWN_SEED 20261020). South gatehouse → cobbled main street through the hamlet-lane GLB → round fountain plaza (tavern east, covered market west, houses ringing it) → north gate framing the Tower of Chrysanthus pagoda on its hill 236 m north (the focal landmark; not enterable here). Stone curtain wall with towers; meadow outside rising to pine hills at the 178 m playable ring; watchpost outside the east gate, ruined junction in the NW meadow.
- **Own page:** `web/town.html` + `web/town.ts` → `src/web/town/main.ts`; `vite.town.config.ts` builds to `dist-town/` with **no** public dir; `scripts/town/stage-assets.mjs` copies exactly the used CC0 textures + HDR and the hash-checked GLBs into the build.
- **Sim/presentation split:** pure modules in `src/sim/town/` (layout, collision, movement, camera math, NPC wander, ground mask); Babylon code in `src/web/town/`. Collision uses the GLBs' cooked footprints (sha-keyed, independent of load state) + plan colliders. NPCs: fixed 10 Hz tick, per-figure seeded RNG streams, idle/wander around anchors (vendors, guards, patrons, strollers); deterministic for seed + tick count. No LLM, no triggers.
- **Assets:** only the torn-veil-assets GLBs (11 of 12; bridge skipped) + vetted CC0 Poly Haven scans + procedural geometry. The focused pack in web/public/focused is NOT used (not from torn-veil-assets). Library `RUNTIME_vegetation` (flat canopy strips) and most `RUNTIME_ground` slabs are hidden in favour of the town's own trees and splat ground.
- **Look:** golden hour default (sun 15° elevation, warm key + cascaded shadows, cool sky fill with warm bounce, EXP2 haze tinted to the horizon, gradient sky with sun glow and cloud deck, volumetric light shafts, lamp glow layer + nearest-lamp point lights). `?time=dusk|day`, `?lite` (1024 single shadow map, no glow/shafts, coarser ground).

## Assets used / skipped
See docs/town/ASSET_MANIFEST.md (11 torn-veil-assets GLBs, 9 CC0 Poly Haven scan sets + CC0 sky HDR; skipped: ravine bridge, the focused pack, unvetted foliage PNGs).

## Known gaps
- The Tower is a distant landmark only (not enterable on this page; its floors are the Tower game in /?world and /?ascent).
- Placeholder figures have no limb animation (bob only); NPCs don't react to the player (they are bodies the player collides with).
- Camera collision tests buildings/walls/GLB spaces + terrain, not props or trees (by design: foliage would yank the boom).
- Headless Chrome needs `env -u DISPLAY` on this box (a stale DISPLAY=:5 breaks SwiftShader WebGL).
- Headless captures use SwiftShader (software GL), so recorded fps there (~0.5) says nothing about real GPUs.

## Log

### 2026-10-20 22:10–23:00 CT — Session 1 (Claude Opus 5.5)
- Read the vault + repo rules (see Decisions). Verified all 12 torn-veil-assets GLBs against SHA256SUMS; provenance keyword scan clean; re-checked the CC0 scan hashes against material-manifest.json.
- Built the town end to end: `src/sim/town/{layout,collision,movement,camera,npcs,groundMask}.ts` (pure), `src/web/town/{main,ground,kit,props,atmosphere,actors,hud}.ts`, `web/town.html`, `vite.town.config.ts`, `scripts/town/stage-assets.mjs`, `docs/town/ASSET_MANIFEST.md`, `tests/town/town.test.ts`.
- Iterated on headless shots (/workspace/town-run/shots/s1–s5): ground splat brightness, cobbles through the hamlet lane, market paving, hidden GLB canopy strips/ground slabs, 38 houses on side-street lots, haze, window glow.
- Commits 9331a41 … (see git log). tsc green; `npx vitest run tests/town` 18/18.
- Deploy: pushed `claude/starting-town-oct20`; created Pages project `torn-veil-town` (wrangler 4.151 tried to delegate Pages→Workers for agents and failed before deploying anything; re-ran create with `--force` as its notice directs; verified no stray Worker). Deployed dist-town → https://torn-veil-town.pages.dev (200; GLBs and textures 200). Added custom domain town.badtengu.com to the project and one new proxied CNAME `town` → torn-veil-town.pages.dev (no record existed; nothing else touched).
- 23:00–23:15 CT: dusk window/lamp bloom tamed; rebuilt and redeployed. Custom domain https://town.badtengu.com is active (200). Final screenshots of the deployed build (checked by eye: no black frames, all 11 GLBs `glb`, no z-fighting): /workspace/torn-veil-online/media/starting-town/20261020-0{1-street-eye-level,2-plaza-fountain-tower,3-behind-player-north-gate,4-dusk-wide}.png. tsc green; tests/town 18/18. Dev server stopped. DONE written.
- Next (if more sessions run): nicer procedural tree silhouettes; a river under the ravine bridge GLB; NPC reaction to the player.
