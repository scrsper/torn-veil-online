# Actual focused-world verification — October 12, 2026

The uninterrupted production-build journey passed at runtime commit **f7bc5c9085c716d75c553d11ea33024788188d90** on isolated branch `codex/authored-motion-correction`. Final documentation/evidence commits do not change runtime code. Main remains **d193c4b285343cb88fd0536c913dfc5775369e7e** and was not merged, pushed or deployed.

## Playable journey

The headless Chrome 1440 × 900 run used ordinary keyboard, mouse and visible controls, with read-only observations. **Passed, 12 captures, zero unexpected browser errors.** It walked the town road, cancelled one portal proposal, crossed to Aether and back, traversed the real forest route, entered the Tower landmark, entered the actual source-mesh floor, returned and reentered the same run, picked up/equipped finite gear, reached real combat, and reloaded the current floor.

Person `p_5`, Body `b_5` and rank Normal remained canonical. Atlas/provisions remained unchanged across both portal journeys. The finite field manual and TV-011 dagger were acquired on the floor. Post-combat reload retained all four inventory entries and health **74.79136152796055**, exactly matching the pre-reload capture. The same `canonical-tower_1` floor 1 continued. Both player and opposing warden `b_8` had real hit sequence 1 after reload. The evidence summarizer asserts health, inventory, identity, rank, run and floor equality, plus an actual opposing-body hit delta in the uninterrupted recording.

Three separate minimal contact/reload checks passed before the final journey. They isolated navigation/input from combat. Earlier full runs stopped at a real column while the target was about 37 m away; accepted swings correctly missed. A tight waypoint tolerance and fixed-camera WASD assumptions were the harness problem. The final driver uses rendered camera heading and a wide side aisle. Attack reach, vertical gates, damage and progression were not relaxed; no state was injected. At the first isolated contact, canonical dagger active reach was 2.1 m, vertical offset zero and target distance about 0.28 m; the later screenshot was about 0.60 m after knockback.

## Regression evidence

- Full normal suite: **242 files, 2,297 tests**, 21 m 8.37 s; **2,269 passed, 24 failed, 4 skipped**. Seven failed files exercised local transport denied by sandbox EACCES/abnormal socket closure. One failed browser allowlist needed the new pure static-geometry and focused-schema modules named explicitly.
- Recheck of **all eight failed files** with localhost access after that deliberate allowlist update: **69/69 passed**, 72.29 s. No transport implementation change was necessary. This is combined coverage with remediation, not a claim that the first aggregate was all green. Unique final coverage is **2,293 passing tests plus four skipped**, with no remaining observed test failure.
- Production TypeScript/Vite build passed. The original byte hashes were verified before staging. Canonical movement/navigation, terrain chunk seams, house room access, journal replay/adoption and Tower tests passed during implementation.
- All **100** focused floor layouts reproduced deterministically and passed connector/support/namespace/route/station certification: **30 physical recipes**, **1,769 opposed opportunities**, 173.68 s. This does not certify 100 floors of actual combat or human climb duration.
- The source-triangle controller uses radius 0.3 m and height 1.75 m. The source audit's 0.45 m / 2.15 m profile is a separate, more conservative static audit, not the runtime controller measured here.

Raw logs and videos remain under `.debug/motion-correction`: `final-simulation-suite.log`, `final-network-recheck.log`, `final-build.log`, `floor-certification.json`, `focused-journey-v11/result.json` and the three `contact-*` evidence folders. Earlier failed captures remain available; they were not replaced or relabelled.

## Observed performance

Hardware inspection confirmed Ryzen 5 9600X (6 cores / 12 logical processors), about 31.1 GiB usable RAM, and RX 6650 XT. Chrome's actual WebGL renderer was ANGLE/D3D11 on that RX 6650 XT. Windows AdapterRAM reported a truncated roughly 4 GiB value; that is not actual VRAM measurement and is not used as a capacity claim.

| Recorded sample window | Frame median / p95 | Host step median / p95 |
| --- | --- | --- |
| Town through Tower approach (1,940 frames; cumulative) | 35.8 / 45.4 ms | 0.90 / 3.56 ms |
| Tower traversal/contact (1,561 frames; cumulative) | 22.4 / 50.8 ms | 1.47 / 3.58 ms |

These are actual recorded headless intervals including automation/video/readback overhead. They are not GPU timers, a stationary benchmark, FPS promises or evidence that a populated megacity fits. Cumulative snapshot windows overlap and cannot be summed. The two-frame reload window is too short for a useful distribution.

Initial town readiness took 3.16 s after its first state; Aether readiness 1.47 s after arrival; return to Brass 2.69 s. These are client arrival-to-stream-ready times, not end-to-end input latency. Chunk residency stayed bounded at 71–81 along the route, with pending loads zero at captured checkpoints. Initial per-chunk upload median/p95 was 0.70/2.70 ms, with a **245 ms** outlier. Recorded streaming frame max was **342 ms**. Asset/loading spikes remain optimization work.

Observed browser used heap was roughly 251–500 MB across capture checkpoints. Host RSS was sampled at approximately 1.28 GB during travel and 799 MB after reload; these are samples, not a peak-memory guarantee. Paged collision cooking and worker/LOD budgets are necessary before scaling the authored geometry broadly. GPU memory and long-run leaks remain unmeasured.

## Actual visual evidence and delivery

The PNGs here are unretouched rendered frames. `motion-before.png` is the main baseline; `motion-after.png` is the isolated authored-motion candidate. They compare motion presentation, not identical geometry/times of day. World/floor captures are from the final successful run. Forest cones, sparse town composition, dark outdoor lighting, repetitive sci-fi facades, exposed/cutaway Tower walls and provisional characters remain visible. **The visual gate is not passed.** Crouch animation binding and broader equipment/animation polish remain open.

The complete 1440 × 900 recording remains locally as `focused-journey-v11/recorded-journey.webm`. A 30,438,139-byte H.264 MP4 of that same actual journey was saved privately to Library as **Veil-authored-world-journey.mp4**:
`libfile_a552cfeaf7888191910959e2c5b8fb5a`, File Service id `file_00000000373881f5852ad7037b759fe8`.
Upload succeeded; this Windows Python runtime does not support the helper's xattr call, so local identity tagging failed. Complete returned identity/version metadata is preserved privately; it was not claimed to be attached to the local file.

## Integration and roadmap boundary

The live 7510 host was healthy on its original commit and root after QA. The portable baseline SHA remained `6f271548b7e83c2846ee3a82d6f59dd526494c7ad1ca7ddda0dc1a08c7b568c2`; its live journal was never substituted with QA. Owned QA hosts were retired after validation. Protected `codex/tower-visual-polish` remained read-only; its denied action was neither retried nor bypassed.

Main adoption remains blocked by required coordinated existing-Tower progression migration and the open visual quality gate. Current adoption fails closed when a retained Tower/legacy expedition is present. See [architecture and safe launch instructions](../../FOCUSED_WORLD_OCT12.md) for the bounded playable foundation and its path to larger realms/continents. Human several-hour pacing, Gold frequency, full-floor NPC playthroughs, multilevel navigation, imported closed doors, arbitrary source-mesh construction and full megacity quality remain future work.

