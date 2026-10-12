# Retained-save migration and forest review — October 12, 2026

The later [character metres and camera review](CHARACTER_METRES_OCT12.md) measures the existing character against the approved kit, corrects the import/framing, and records final roof visibility and contact-route validation. It supersedes the camera defaults below without changing approved room topology or canonical progression.

This checkpoint supersedes the blanket migration warning in the earlier focused-world report. Runtime and rendered evidence were validated at **652fb45555f755e212f2b742d15afc4232a623f9**. The tested prototype was locally consolidated into **main** as **862245031e38fae648932e4b945a3e2969d93088**; later documentation-only updates retain the same runtime.

## Actual migration dependency

The live 7510 journal was copied as a coherent committed prefix and exported using its original engine. The verified export includes sequence **137**, schema 31, seed 918271, Person **p_5**, Body **b_5**, **Normal** rank, **80** health and inventory **i_1 / i_2**. It has **no canonical Tower and no checkpoint-only expedition**. The last durable operation is disconnect; main remains idle and healthy. A generic guard was previously mistaken for a conflict in this actual save.

The original portable import, compressed checkpoint and committed journal batches are retained. Their file hashes are in the private backup index. A separate portable migration and new-engine journal stage were created outside main. The CLI asserts player/person truth, items, containers, history, RNGs, clocks, diffs, door states and all body fields except permitted exterior relocation/velocity/route fields. It preserves the active Tower body exactly.

The actual copy invariant caught three suppressed old parcel door states being silently dropped. The focused grid now retains those latent states during adoption and reload. They do not animate imported fixed-open GLB leaves; the prior state remains available for rollback and later adapters.

The explicit `preserve-canonical-floors-v1` policy checks run ID and revision. It retains existing folded descriptors, geometry, people, enemies, finite sources/rewards, commands and progression proofs. It adapts only the Brass exterior return landing. Existing floors remain literal; newly opened floors can use the verified source kit. Stale or invalid requests fail without clearing control state.

Six migration tests passed: active/returned runs in both realms, stale-intent rejection and latent door retention. A separate historical **floor-100 Silver QA base** also migrated without changing its **202 inventory entries**, 100 floors, completion status, revision 101 or receipts. That test used its verified sequence-8526 base, **not its later journal tail**. Its older engine fingerprint is `c6d45011d0b6d44dec54bc6227643e5f97fe7710207f3dd188e45648429df56b`. It is not the live player's save and will not supply the live player's rank or loot.

Checkpoint-only legacy expeditions retain a separate guard: their browser-owned arena/checkpoint binding and exterior landing need their own coordinated adapter. The protected `codex/tower-visual-polish` branch remains at **e7cd628** and was not edited or tested through its denied QA path. This legacy case does **not** occur in the actual live export.

## Corrected forest and motion

Parent inspection rejected the first brighter forest pass: solid cones, pasted foliage, polygon soil edges, noisy textures, weak grounding and intrusive framing remained. The corrected presentation uses the existing credited textures and original imported trees:

- Decorative cone proxies are hidden; their canonical collision/source bytes remain unchanged. Radial branch layers derive from each authored canopy's bounds and stable name. Close/far layers are bounded at 49/16 cards per tree, with route-excluded understory sampled on actual source ground.
- Verified source route metadata drives continuous soil/grass coverage. Shared world-space texture sampling removes material-slot colour boundaries. Ground self-shadow casting is removed; leaf/trunk shadows and soft player-foot grounding remain.
- Texture frequency/normal contrast is reduced. Foliage between the eye and player fades; the route and body remain visible. Close camera defaults are 5.4 m / 23°, with Elevated and Wide choices. Saved preferences remain separate from canonical state.
- Travel controls collapse into a small disclosure; default movement instructions leave the playfield. Wren and the existing people/Mixamo/unarmed baseline remain. Authored crouch idle/movement now follows the canonical crouch state; jog and Shift sprint remain distinct.

The final review capture passed with **107 samples and zero unexpected browser errors**. House comparison has identical position/yaw/pitch; the forest comparison matches camera preferences/orientation and differs by **0.32 m** at the stop. Camera obstruction may differ because decorative proxies no longer act as visible camera walls. No positions, damage, ranks, clocks or scene materials were injected by the harness.

These are improvements to a **prototype**, not accepted finished art. Repeated source trunks, limited kit diversity, sparse occupied activity, imperfect vegetation transitions, far-building detail, character/equipment polish, realistic light/contact and broader composition remain open. Canonical solid canopy collision is retained even though its decorative display changed; future flight/soft-foliage mechanics need a separate physical policy.

## Validation and artifacts

The final normal aggregate passed **2,303 / 2,303 tests across 243 files**, in **20m 4.16s**, at the canonical migration checkpoint before the render-only forest correction. Canonical simulation/progression/persistence code has not changed since that pass. The changed camera/browser boundary/authored access/terrain checks passed **22 / 22** afterward; production typecheck/build passed.

The final **V19 uninterrupted journey** passed on the verified migrated copy at 652fb455: town movement, portal cancellation/round trips, forest traversal, Tower entry/return/reentry, finite gear, actual canonical combat and reload. It captured 12 frames with zero unexpected browser errors. The evidence validator confirms opposing-body contact and exact post-combat identity, health, inventory, rank, run and floor preservation. No human climb duration, Gold frequency or megacity performance is inferred.

Private Library artifacts preserve their identities:
- Comparison sheet: `libfile_f2c4f6bf4d8c819184663b51c0d28aa4`, **version 1**.
- Current jog frame: `libfile_45ff23a642a08191a38d38e09f1e8b0c`, **version 1**.
- Short current motion: `libfile_48f749dcec388191abc5d9ae7deb5ea4`, **version 1**.
- Journey video: `libfile_a552cfeaf7888191910959e2c5b8fb5a`, **version 2**, final V19 corrected-forest journey. Earlier versions remain in Library history.

The local Windows xattr helper cannot tag files because `os.setxattr` is unavailable. Library writes succeeded; complete identities/version results are preserved privately. No duplicate Library items, user-reference uploads or public sharing were created.

## Consolidation completed locally

After the initial rejection below, the parent supplied the user's exact explicit consolidation instructions. A single retry of the same local action was approved. Main fast-forwarded; the verified staged checkpoint was installed at sequence 137 without deleting the old base, journal batches or imported JSON. The existing launcher restarted hidden on port 7510, using its original current-save path.

Post-adoption checks confirmed a healthy matching root/build, no persistence/update errors, Person p_5 / Body b_5, Normal rank, 80 health, inventory i_1 / i_2, focused generator chrysanthus-focused-3 and no Tower run. The startup disconnect advanced the durable frontier to 138. The original imported JSON SHA remains unchanged. The protected Tower worktree was not edited or accessed through its denied QA action.

There is one canonical launch path: **`connected-realms/Play Torn Veil.cmd`**, which serves the consolidated game on **`http://127.0.0.1:7510/`**. Private QA ports/saves are test artifacts, not alternate canonical games. Rollback data and the old compiled build are retained under the task's private migration backup. Nothing was pushed or publicly deployed. Prototype-quality limitations above remain explicit; functional consolidation is not visual acceptance.

### Initial approval rejection, subsequently resolved

Automatic approval review rejected the attempted main consolidation **before execution**. The rejected action would stop the main host, fast-forward main and upgrade its journal checkpoint. The stated reason was the original explicit no-merge/main-unchanged boundary and risk to main/live state; assistant-side assertions of authorization could not override it. **No component of that command ran**, and no alternate route was used.

Read-only checks immediately after that rejection confirmed main was still clean at d193c4b, PID 26972 healthy, durable sequence 137 unchanged, and no installed-upgrade marker. A main-build backup was then preserved independently by read-only copying. The subsequently approved action installed the staged checkpoint; this historical rejection does not describe the final state.

The supplied explicit user authorization resolved the approval question. Local consolidation and save adoption are complete; no further approval is pending for that action. No push, external deployment, paid service or protected-worktree mutation occurred.

