# Known defects and gaps (web client)

Current quality target: [QUALITY_TARGET.md](QUALITY_TARGET.md). This historical
list predates the imported-human milestones; see `.ai/STATE.md` and the linked
milestone evidence for subsequent fixes. Unverified art, feel and performance
claims remain open until their corresponding acceptance gates are met.

Honest list as of the last commit on `claude/web-rebirth`. "Open" means not fixed; "Mitigated" means
reduced but present. Severity is my judgement, not a human's.

## Blocking a "done" claim

| # | Gap | Notes |
|---|---|---|
| D1 | **No human playtest, no physical controller test** | Verdicts are all pending (`HUMAN_TEST_GUIDE.md`). The gamepad path was exercised only by injection; nothing here certifies feel, clarity or enjoyment. |
| D2 | Many player-facing systems are only wired, not driven | `COVERAGE_LEDGER.md` marks each row. Verified end to end: talk, trade with confirmation, eat, Items/Abilities/Journal, save, reconnect. Not driven: sell/give, hush, sparring, work, gathering/butchering, injury and recovery, drinking, doors. |
| D3 | Combat is verified against real targets only lightly | Inputs reach the server and animate; timed parry, multi-opponent, doorway and lock-release cases were not evaluated; contact sparks are built but were not seen on a real hit. |
| D4 | **Art is prototype-level next to the concept sheets** | See A1–A5. It is recognisable and coherent, not "high-quality stylised fantasy realism" yet. |
| D5 | No first-hour playthrough | A 40–45 min automated soak checks stability, not a meaningful play arc. |

## Art and presentation

| # | Gap | Severity |
|---|---|---|
| A1 | Faces, hands and hair are low-detail (egg-shaped heads, mitten hands, helmet-like hair caps on some hairstyles); portraits inherit this. The hero is a showroom preview with a rough fur stole | high |
| A2 | Wildlife bodies are rounded but crude; concept previews (void stag, rift hawk, veil wraith, shattered colossus) are simple silhouettes, not finished creatures | high |
| A3 | Buildings: real geometry, roofs fitted to the simulation's cells, windows and chimneys, but repeating plank textures and plain, dark interiors; no interior lighting pass | medium |
| A4 | No weapon trails; contact feedback is a small spark burst (untested on a real hit) plus camera kick, sound and rumble | medium |
| A5 | Distant vista, clouds and water are plain; dense forest canopy is very dark by day and near black at deep night | medium |
| A6 | Quality governor only steps **down** and was proven with CPU throttling, not real weak hardware | low |
| A7 | Live portrait: rendered by a render-target readback about 8 times a second; in one run it was still blank ~0.3 s after opening and filled later; elders' long-face morph reads oddly | low |
| A8 | Conversation camera frames the pair but the player's own body still often covers half the screen | low |

## Behaviour

| # | Gap | Notes |
|---|---|---|
| B1 | Decorative trees, bushes and rocks are not collision | The simulation has no collision for client decoration, so the character can stand inside one (the client cannot add authority). The camera ignores plants while the player is inside one and is otherwise kept out of trunks, bushes and rocks. |
| B2 | `rejected:committed` receipts under rapid attack input | Expected server behaviour (an action is already committed); the client cancels the anticipated motion. The player sees a brief re-anticipation rather than a message. |
| B3 | The simulation keeps a *finished* combat action on a body, so its activity reads `combat` long afterwards | The client only treats a live action, a hit, or an attack/confront goal as a fighting stance. Upstream behaviour unchanged. |
| B4 | Streaming: region builds are time-sliced and shader variants warmed, but an isolated 60–130 ms frame still occurs in some runs (0–2 in ~7 000) | Mitigated; `PERFORMANCE.md`. |
| B5 | Accounts are limited to three characters; the fourth is refused | The web client shows "Character limit (3) reached" with a way back; there is no character-deletion UI (none exists upstream for players). |
| B6 | Auto-reconnect and the "Signed in elsewhere" take-back were exercised by unit test and the Reconnect button, not by pulling the network | |
| B7 | `window.__tv` debug handle is present in production builds | It exposes client state only (no credential; the gateway never sends one). Used by the evidence scripts. |
| B9 | Texture/heap growth in a long session (cloth prints cached forever): fixed in code, **not re-soaked** | A 40-minute soak showed textures 180 → 729 and a drifting heap; the cache is now bounded (`PERFORMANCE.md`). Memory stability over an hour is unproven until a new soak. |
| B8 | Decorative bushes/rocks can hide the player for a frame or two when the camera is very low | Mitigated by camera plant obstruction. |

## Fixed during this work because running it found them

Garments missing on later people (shared textures disposed with the first person to leave); a material leak of
~200 per settlement passed; WebGPU stalls from light-count shader churn; `undefined` item names; trade rows with stock
notes skipping their confirmation; HUD text under 12 px; daytime grass blown out to white; pointer-lock refusal
logged as an error; a lantern-carry pose reading as "hands up"; hairline sawtooth on the hair cap; creature "collar" and
"shoulder plate" artefacts. Each was found by a run or a screenshot, not by inspection.

## Not implemented (by design or scope)

- Jump/vault/dive (Lane B): none; see `EXTENSIONS.md`.
- Concept enemies as canonical entities: none; previews are labelled and never spawned.
- Non-loopback browser access: not offered.
- Voiced dialogue: none (voice "babble" is a synthesised cue that follows text).
- Full accessibility audit: reduced motion, large text, high contrast, colour-vision assist, subtitles and keyboard/pad
  navigation exist; a screen-reader pass was not done.
