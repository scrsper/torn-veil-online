# Realtime martial integration v0.1

Integration branch: `astra/realtime-martial-integration-v0-1`.
Worktree: `C:/Users/green/Desktop/projects/tvo-combat-integration`.
Common base: `31051ecbfc3dc50e2e0e331c804028342566e75d`.
Sources: realtime `947761b7fabaace442ed1920f123d008495db28f` and martial learning `0c6e881636a36a69e85904f9e165a8cfdf8a2738`.
Both histories are retained. No main merge or PR.

## Connected seams

- `physical/martialCombat.ts` selects one movement at actual canonical admission using the existing repertoire and transition selector. The existing bounded buffer stores intent and revalidates at startup. Direct/NPC and player requests enter the same functions.
- A frozen combat action carries technique, previous action/movement, transition and visible demonstration content. The existing sampled contact paths, sweeps, resolver, interruption and injury operator retain physical authority. Specific technique knowledge never manufactures a hit.
- The owning native client receives a cached, derived choice table. Prediction performs a keyed lookup; it has no knowledge database, combo counter, planner or learning rules. Authority reselects on receipt. Existing clips project the selected movement.
- Terminal, meaningfully performed actions submit canonical evidence to `submitTechniqueUse`. Misses can provide bounded solo feedback; an actually moving opponent supplies greater challenge. Static repetition retains the existing solo caps. Selected transition practice shares the movement's evidence/ledger and does not practice the family twice.
- Combat admission owns the single fatigue charge. Evidence settlement never repeats the physical action or applies another physiology cost. Action settlement identity and the person's chronological ledger reject replay, including after load. Early rejection/cancellation and interruption before meaningful execution grant no reward.
- Ordinary visual perception can consume completed, visible demonstrations. It accumulates understanding with witnessed provenance and does not grant mastery or knowledge from button presses. No planner registration or autonomous combat tactics were added.
- Normal `serialize`/`deserialize` now include the martial definition extension and validate its state. Existing knowledge, records, skills and mastery remain their ordinary persisted objects. Live combat, queued intent, evidence identities, resumable paid learning sessions and lineage survive. Event compaction pins live-action provenance. Legacy martial persistence functions are compatibility wrappers.
- Arena save envelopes record their generator so loading rebuilds the Arena, with its three actors and geometry, before applying the normal overlay. Other worlds retain their existing generator paths.

## Playable profiles

| F4 profile | Light → Light → Heavy during recovery windows |
| --- | --- |
| Untrained | Basic punch → second basic punch → crude kick |
| Partial | Jab → basic punch fallback → crude kick |
| Trained | Jab → cross, through learned jab-to-cross → low kick, through learned cross-to-low-kick |

Learned chains require the specific movements, edge knowledge, prerequisites and the edge's defined mastery threshold. A missing edge falls back to an available primitive; one movement never unlocks a whole complexity tier. The eight innate primitives remain physically available without seeded knowledge. R exposes basic cover; V requests an unarmed shove even when carrying a weapon. Cover changes coarse arm hurt volumes; shove uses resolved contact and collision-constrained displacement without weapon injury.

F4 changes explicit development-only Arena fixtures, resets their physical condition, and writes ordinary canonical martial state. F3 resets physical practice while retaining training. The HUD shows the profile, selected technique and actual learned edge. Untrained and trained movements reuse the approved animation assets; this slice does not add animation polish.

## Verification

- **197 distinct TypeScript tests pass across 20 relevant files**, accumulated across coherent targeted runs: 15 new integration cases, martial learning/selection, realtime actions/geometry/protocol/session/native traces, responsiveness/practice, persistence/chronicle, combat foundation/projection, bridge, knowledge/retention and development.
- `npm run build` passes, including TypeScript typecheck and Vite production build. Unreal 5.8 Development Editor build passes. **9/9 native realtime automation tests pass**, including the new martial projection test.
- Independent final review found a carried-weapon shove mismatch. Fixed by normalizing explicit shove intent to unarmed before selection/resolution; regression verifies contact/displacement, prediction agreement and unchanged health/injuries. No other blocking finding was reported.
- Native ordinary-input probe verifies all three sequences and **zero intervening idle frames in all six buffered follow-ups**. Six unbuffered inputs measured **16.23–27.23 ms dispatch → first observed active choreography**. Native prediction callback p95: attack **0.060 ms**, defense **0.074 ms**. These are engine observations, not hardware input-to-photon measurements. Prior reported range was approximately 16.7–26.4 ms; this small sample shows no material regression.
- A separate warmed canonical lookup measurement with 1,005 knowledge items and 2,000 iterations measured selection p95 **0.113 ms** and cached projection p95 **0.100 ms**. [Measured data](evidence/martial-combat-integration/lookup.json).
- [Timing and verified sequences](evidence/martial-combat-integration/timing.json). [Normal-speed Arena capture](evidence/martial-combat-integration/gameplay-normal-speed.mp4): approximately 14.5 seconds, encoded using actual screenshot timestamps. Screenshot capture stalls rendering; its timings were excluded from the latency result.
- The running Arena's saved file was independently restored: three actors, 48×8×48 geometry, trained repertoire and recorded contact retained. Launcher supports an explicit save path and rejects a port owned by another checkout.
- No full regression run: the long suite and known 851/852 family baseline remain uninvestigated. Raw native logs/probe frames are local under `.debug/`; only concise evidence is committed. Unhydrated vendor LFS pointers produce asset-registry warnings in this isolated checkout; the reused Arena/Manny/combat assets needed for the playtest are available.

## Launch and test

From this integration worktree, with UE 5.8, licensed template assets and the Windows C++ toolchain installed:

```powershell
Set-Location C:\Users\green\Desktop\projects\tvo-combat-integration
# Already installed and built in this worktree. For another checkout:
npm ci --ignore-scripts --no-audit --no-fund
npx tsx scripts/generate-interaction-spec.ts
git lfs checkout 'unreal/TornVeilOnline/Content/TornVeil/Combat/**' 'unreal/TornVeilOnline/Content/TornVeil/Characters/**' 'unreal/TornVeilOnline/Content/TornVeil/Maps/TornVeilWorld.umap'
pwsh -File unreal/scripts/Build.ps1
pwsh -File unreal/scripts/Start-CombatArena.ps1 -Port 8791 -Save .debug/arena-integration-save.json
```

The asset checkout command uses locally available LFS objects; a fresh machine must fetch those paths first. This worktree reuses the canonical checkout's template Characters and local SDK via junctions; no vendor source or canonical checkout was edited.

WASD moves; mouse orbits; Shift sprints. LMB is Light, RMB Heavy, Space + direction dodges (neutral backsteps), Ctrl ducks, R covers, V shoves. F1 passive partner; F2 repeated incoming attacks; F3 recover/reset; **F4 cycles profiles**; F5 saves when `-Save` is supplied. The saved Arena may open trained: check the HUD and cycle to untrained first. Step back slightly before comparing free chains. Press LMB, press LMB again about 0.33 seconds later, then RMB about 0.5 seconds later. Every component resolves separately. Restart the server with the same `-Save` to resume; its practice controller returns to passive. Omitting `-Save` creates a disposable session.

To reproduce machine evidence with the Arena server running:

```powershell
pwsh -File unreal/scripts/Run-ResponsiveCombatProbe.ps1 -Port 8791 -Martial -Output .debug/martial-timing
npx tsx scripts/analyze-martial-combat-probe.ts .debug/martial-timing/probe.json
```

Add `-Capture` only for a separate visual run. The probe explicitly initializes the three development profiles and exits the native process after its bounded scenario.

## Deliberately deferred / integration risks

No autonomous combat planning, broad perception/planner/cancellation overhaul, physiology redesign, weapon learning library, networking change or animation polishing. Ordinary explicit teaching, manuals and timed learning providers remain from the martial slice; their general planner registration is still deferred. Real combat now supplies its own paid evidence through the integration adapter.

Future changes to combat timing or motion must preserve the one-action boundary and regenerate/check the shared native specification. Future martial fields must remain canonical and update the derived projection/cache and save validation together. Weapon attacks retain the existing canonical resolver path; this playable repertoire fixture focuses on unarmed combat. Shove/cover use the existing coarse contact representation. Profile reset is a development override, not a learning route for ordinary worlds.

The main conflict surfaces for later integration are `physical/combatAction.ts`, `persist/save.ts`, the small `mind/agent.ts` perception hook, bridge commands/session and native prediction. Reconcile those owners once; do not register a second physical effort charge or knowledge store. Neither source branch nor main was modified by this integration work.
