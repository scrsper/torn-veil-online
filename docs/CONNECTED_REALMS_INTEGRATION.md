# Connected-world integration manifest

**Historical integration checkpoint:** this document records the initial
checkpoint-only expedition adapter. The primary October 11 build uses the
host-owned canonical Tower described in [current state](CURRENT_STATE.md) and
[canonical Tower](CANONICAL_TOWER_OCT9.md). The legacy adapter below is available
only through an explicit historical lab URL; its remaining authority gap does
not describe the current primary Tower.

Candidate: `codex/connected-realms` at `<candidate-checkout>`.
Independent foundation commit: **708adbd**. Adapter implementation commit: **48ff6c2**. Authorized Tower merge: **0d12c7a**, integrating
**e7cd628ea961b012b94a102f90a60bb8202a994f** and its committed ancestors.
Initial base: **caeec71**, descending from local `origin/main` **10a648b**.

## Implemented boundary

Walk through the real Tower door, choose **Ascend Tower**, play its encounter floors, and return to the
saved atrium landing. Either realm's Tower can resume the same run. The real-input combined journey
cleared floor one, saved floor two, reloaded the same equipment, returned to the same world Person/Body,
then crossed the portal and resumed that floor from Cinderveil. This is more than a URL shortcut.

- `RealmExpedition` binds the existing Person ID, Body ID, stable building ID, realm, clear return point,
  host-generated run ID/seed, status and revision. No new World Person or inventory is created.
- A single controller lease covers city and expedition pages. Same-origin, bounded JSON requests carry
  the current lease, revision and command identity. Another tab cannot mutate the active run.
- The host validates checkpoint schema, owner/run/seed, sequential floors and untouched floor starts.
  Save acknowledgements follow atomic file replacement. Failed writes roll back the transition;
  duplicate acknowledged commands survive reload without replaying their effect.
- Schema **27** stores the binding and scoped checkpoint in the ordinary world save. Schemas 24/25/26
  remain readable without a binding. An incompatible binding stops load and preserves the file.
- The optional `TowerHost` interface keeps standalone Tower localStorage behavior intact. Bound runs
  use the world Person as climber identity, expose the canonical Body ID in actor metadata, and do not
  write standalone checkpoints, class discoveries or achievement counters. R cannot replace a bound run.
- The browser pauses encounter play while checkpoint writes are pending or failed. Reload/return
  resumes the last saved **floor start**, not an unrecorded mid-floor state. A world page reopened while
  the expedition is active offers Continue/Return recovery controls.

## Explicit remaining authority gap

**The existing ArenaWorld still runs combat in the browser.** Schema and sequence validation do not
prove kills, damage, earned loot or advancement. The host stores that data under the explicit
`authority: checkpoint-only` boundary and grants **no** World items, health, injury, death or ontology
changes from it. Expedition gear/capability history is scoped to the climb. This retains the existing
Tower semantics rather than inventing a second global player rank or copying an untrusted tier label.

During a bound expedition, the realm simulation pauses and its canonical Body remains anchored at the
saved atrium position. The arena's actor is an encounter projection, not a newly registered World Body.
Falling ends the scoped expedition; it does not assert that the World Person died. Cross-realm movement
and return preserve the ordinary character state. Existing live rural characters have not been migrated
into this new realm baseline.

To complete one shared physical/combat authority:

1. Host the encounter roster, movement/contact, damage and defeat through deterministic canonical actions.
2. Map actual encounter item provenance/equipment to ordinary World Items rather than trusting checkpoint gear.
3. Apply injury/death and unconsumed rewards transactionally with the return, using causal receipts.
4. Advance the World Person through `core/advancement.ts`; its current implemented breakthrough is Normal
   to Iron. The expedition's Bronze/Silver/Gold labels cannot bypass those metaphysical gates.
5. Replace the paused realm clock with bounded coarse continuation, after departure/return embodiment is
   defined for every interacting system. Verify interrupted transfers, multiplayer ownership and migrations.

No full global-reward integration, populated megacity performance or visual acceptance is claimed.

The subsequent focused audit, `CONNECTED_REALMS_CANONICAL_TOWER_AUDIT.md`, maps this gap to the existing
BridgeSession, physical actions, inventory, injury/death and advancement contracts. It records the
substantial prototype-feature conflict and the proposed smallest safe implementation before replacement.

## Preserved work and assets

| Component | Status |
| --- | --- |
| Canonical World/Simulation, inventory, physiology, ontology and history | Retained; ordinary realm traversal uses existing kernels. |
| Existing Babylon renderer, materials, atmosphere and CharacterFactory | Reused. Character interface remains replaceable. |
| Authorized Tower visual/progression/creator handoff through e7cd628 | Merged from committed Git objects only. The Tower worker's checkout was not edited. |
| Untracked `art/tools/arena/build_omni_candidate.py` and other character experiments | Not copied or integrated. |
| Registered creator male/female GLBs | Staged byte-for-byte in this checkout with provenance hash verification. Originals untouched. |
| Main checkout's active Observatory/tooling and reference-hero changes | Preserved untouched. |
| Rural living-world launch/save, Unreal archive, authoring tools | Retained. No reset, replacement or migration of unrelated work. |
| Scorpion/Valheim and unrelated projects | Outside scope. |

The original Tower authorization denial was not rerun through this task. Its coordinator separately
obtained approval for the exact commit retry; only the resulting authorized stable commit was integrated.
No push, main merge, deployment, paid service, uncertain-license asset acquisition or reference upload occurred.

The user rejected the current characters and requested exceptional visual quality throughout the Veil.
The separate character owner controls the reference-matched geometry/face/anatomy/hands/clothing pass.
There is no competing character-authoring fork here. The Threshold Square art gate remains **NOT PASSED**.

See `CONNECTED_REALMS.md` for launch/scaling, `CONNECTED_REALMS_ART_GATE.md` for visual defects, and
`evidence/connected-realms/COMBINED_RESULTS.md` for verification of this combined candidate. Earlier worker
results and modeled 259-minute / 4.67%-Gold pacing estimates are not proof of this candidate's behavior.
