# Threshold Square visual pass — October 8, 2026

This is a presentation-only follow-up to `6ad02eb`, while the canonical Tower mechanics decision is
pending. The current candidate remains playable, but **the overall art gate is not passed**.

## Actual comparison

All images below are original 1440×900 gameplay frames from headed Chrome, captured through ordinary
buttons and movement keys. No compositing, image generation, camera teleport or character replacement.
The same seed and waypoint route were used with separate fresh QA saves. Normal input timing introduces
small position differences; exact positions and world times are recorded in `art-oct8/comparison.json`.

| View | Before | After |
| --- | --- | --- |
| Aether approach | [Full gameplay frame](art-oct8/before-aether-01-gameplay.png) | [Full gameplay frame](art-oct8/after-aether-01-gameplay.png) |
| Aether entrance | [Close gameplay frame](art-oct8/before-aether-02-entrance-detail.png) | [Close gameplay frame](art-oct8/after-aether-02-entrance-detail.png) |
| Cinderveil approach | [Full gameplay frame](art-oct8/before-brass-01-gameplay.png) | [Full gameplay frame](art-oct8/after-brass-01-gameplay.png) |
| Cinderveil entrance | [Close gameplay frame](art-oct8/before-brass-02-entrance-detail.png) | [Close gameplay frame](art-oct8/after-brass-02-entrance-detail.png) |
| Aether atrium | [Before](art-oct8/before-aether-03-atrium.png) | [After](art-oct8/after-aether-03-atrium.png) |
| Cinderveil atrium | [Before](art-oct8/before-brass-03-atrium.png) | [After](art-oct8/after-brass-03-atrium.png) |

The Tower now has distinct ceramic/zinc and limestone/bronze finishes, physically based material response,
metre-scaled joints, framed glazing with restrained illumination, and a differentiated central entrance
bay. Cinderveil receives small pediments and a brass instrument motif; Aether uses narrow metal fins and
an instrument ring. The painted window depth is cosmetic, not a new enterable room or parallax system.

The approach replaces the continuous cobble field with large paving courses, flush drainage strips,
guide inlays and a survey medallion. Grilles and notice cases attach to the facade; the door leaf's
panels inherit its open/closed visibility. No new free-standing street obstacle was placed. Existing
solid side-chapel furniture receives surface detail. Two bounded entry lights, stronger sky fill and
shadow reception on the representative materials make the entrance readable. No sunlight clock,
collision, navigation, seed, building identity, simulation, save or progression rule changed.

Visual review found a lower window frame crowding the door surround in the first iteration. Decorative
glazing was omitted from the central entry bay, and door-surround UVs were corrected to metre scale.
The final close frames show that correction. Characters remain the existing placeholders.

## Verification

- Final TypeScript check and production Vite web build passed; bundling took **1m43s**. Build log:
  `.debug/realms/art-build-final.log` (emitted realm client `client-CxrK5eQm.js`).
- Final affected realm, expedition and browser-boundary tests: **22/22 across three files passed**.
  `.debug/realms/art-focused-final.json`.
- Actual comparison route: **5/5 checks passed, zero browser errors**. Both doors traversed, both
  portals crossed, and the same Person, Body, inventory and rank survived return and reload.
- Additional actual lifecycle route: **4/4 checks passed, zero browser errors**, including a closed
  door blocking forward input, opening hiding every new door panel, and four further portal crossings.
  `art-oct8/lifecycle.json` contains the observations.
- After warmup, returning to each realm retained the same mesh/material/texture/light counts:
  Aether 873 meshes, Cinderveil 973 meshes, 190 materials, 224 textures, four total scene lights
  (sun, sky fill and two entry lights), with 81 chunks resident. Later Aether counts differ from its
  first arrival because the shared character factory/cache is warmed; the comparison uses equal phases.
- The earlier **2,050/2,050 aggregate** passed before this visual follow-up. It was not unnecessarily
  repeated; it is not presented as a fresh full-suite run on these new rendering changes.

## Observed cost and limits

| Settled gameplay view | Before p95 frame | After p95 frame | Before/after meshes | Before/after JS heap |
| --- | --- | --- | --- | --- |
| Aether approach | 7.1 ms | 7.3 ms | 825 / 834 | 166.7 / 168.6 MiB |
| Cinderveil approach | 7.1 ms | 7.2 ms | 966 / 973 | 209.5 / 211.6 MiB |

These are observed frame intervals on the RX 6650 XT through ANGLE at 1440×900, with no video recording
overhead. They are short settled samples on a shared machine, not an isolated benchmark, guarantee of
minimum FPS, GPU execution timing or megacity scale proof. Final comparison captures preceded the
production build. The separate lifecycle check overlapped that build and is not used for frame claims.

JS heap varied with garbage collection. The lifecycle's reported used heap rose from approximately
199 to 291 MiB while resource counts stayed constant; this is **not** evidence of a completed memory
soak or proof that heap cannot grow. No VRAM measurement was made. Existing cold chunk-upload stalls,
large shader warmup and broader streaming-budget work remain outstanding.

## Remaining visual work and reproduction

The surrounding districts still have repetitive placeholder facades, roof materials and sparse streets.
The Tower massing still reads as a repeated tall block; this pass improves construction/detail without
changing its canonical physical envelope. The atrium remains under-furnished. Texture response, broader
architectural variation, landscaping with real colliders, city lighting across time states and the
separate character handoff all require further work before claiming the user's quality bar.

Run `Play Torn Veil.cmd` in this worktree for the candidate. For a fresh repeatable comparison, launch
`src/server/realms.ts` with a **new** `TV_REALMS_SAVE` path and seed 918271, then run
`node scripts/web/realms-art-pass.mjs` with `TV_REALMS_EVIDENCE` naming an output directory. The harness
requires starting in Aether; do not reset a live save to satisfy it. After its return, run
`node scripts/web/realms-art-lifecycle.mjs` for the closed/open leaf and repeated-crossing checks.

No new external asset, paid service, external upload or publication was used. No other worker's checkout
or character candidate was changed. The canonical-mechanics scope decision remains pending; this visual
pass neither makes browser combat authoritative nor alters that decision.
