# Checkpoint performance candidate — 2026-09-25

The live alpha.12 world is preserved. Its normal operator backups at generation 572 and 619
were profiled read-only. In 45.1 real minutes the checkpoint changed from 71,036,006 to
71,555,715 bytes; events fell from 59,640 to 59,168, while knowledge rose from 49,776 to
50,312. This is preliminary evidence of a retention plateau, not a completed soak.

Most retained events are direct roots of living knowledge, rather than an unbounded causal
ancestry expansion. About 38 MB is told/perceived events. Removing these indiscriminately
would discard provenance. Existing limits and repeated-introduction fixes therefore remain
in place while the final soak measures convergence.

The smallest encoder correction serializes plain top-level checkpoint fields separately and
large arrays in 512-entry segments. It produces identical JSON bytes and the same schema.
The snapshot remains synchronous; no mutable world escapes to a worker and no cache can go
stale. Unit coverage compares full encoding, including nested arrays, Unicode, omitted values,
nonfinite JSON numbers, sparse-compatible arrays and invalid cyclic/BigInt input. Existing
checkpoint integrity, fallback/recovery and reload tests remain applicable.

On the private Node 26.10.0 runtime (V8 14.6), the actual 71.55 MB world serialized in
206.65 / 204.07 / 220.92 ms in the initial profile. Node 22 remained roughly 371–483 ms.
The candidate runtime is therefore explicit, not a global runtime replacement:
`C:\Users\green\TornVeilAlpha\runtimes\node-v26.10.0-win-x64\node.exe`.
The official archive's SHA256 was checked against Node's published checksums. This runtime
is current but not yet LTS. The existing live runtime has not been changed.

`Install-Autostart.ps1 -NodeRuntime <path>` supports pinning the chosen executable by hash.
Release metadata and service status record the actual Node/V8 runtime. The soak observer also
records process CPU, checkpoint commit/serialization time, RSS, event-loop delay, debt, counts,
and save/event/knowledge growth for each half of the run. It must show a zero-client period
and separately report whether a connected-client period occurred.

The final two-hour soak is still required. Offline profiles do not prove service latency,
convergence, backup behavior or stability with a connected client.

## Overnight finding and lossless storage correction — September 26

The alpha.13 staging service ran for 19.9 hours with zero restarts and 19 normal backups.
At inspection its RSS was 711,913,472 bytes, event count 71,786, knowledge count 54,048,
and checkpoint size 83,657,739 bytes. The latest serialization was 312.57 ms, maximum
465.38 ms, so the earlier runtime/encoder correction did **not** close the gate.
Growth did slow: the first two hours added 4.49 MB. From September 26 11:25 UTC to
15:22 UTC the checkpoint grew from 83.063394 to 83.704542 MB (0.641148 MB in 3h57m).
This is evidence of convergence of bounded living cognition, not a claim that
historical world storage can never grow with population or consequential history.

Schema 25 adds optional event column rows, flat witness triples, and a table of identical
historical appearance descriptions. It removes repeated JSON keys and duplicate descriptions;
it removes no events, knowledge, witnesses, memories, causes, effects, or other canonical data.
Appearance equality uses the actual historical JSON, never present-day character appearance.
Decoding creates independent appearance records so later changes cannot alias other evidence.
Plain event records remain supported. Developer exports default to the plain representation;
the live service requests the compact representation. `inspect-checkpoint.ts` reports either
representation and can expand a compact checkpoint into a new file for ordinary inspection.

The schema-24 migration changes only the version marker; its existing plain records remain
valid. Normal checkpoints subsequently pack them. The baseline fingerprint retains its
schema-24 semantics because generation is unchanged. A schema-25 server can also recover an
older verified schema-24 generation. Rolling back the executable requires the preserved
pre-update backup, as the existing operator migration procedure states.

Focused validation covers full evidence round trips, independent decoded appearances,
malformed/truncated columns and witnesses, explicit migration, deterministic continued
execution, and fallback from a structurally corrupt but correctly hashed compact generation
to a schema-24 generation. Existing server checkpoint/restart/fence/backup tests also passed.
The 84,855,524-byte archived world becomes 66,153,614 bytes while retaining exactly all
events, people and clock state. Offline timings remain variable (235–322 ms in a mixed-load
profile); only a reasonably isolated service soak can establish the latency gate.
# Connected-client checkpoint correction (September 26)

Alpha.17's isolated final attempt **failed**: zero-player checkpoints took 216–235 ms,
but an ordinary packaged connection produced 290–334 ms checkpoints (326 ms on character
creation). The save compacted from 66.1 MB to 63.9 MB during the observation; that does not
excuse the blocking latency. Raw samples and the explicit early failure are retained privately
under `.debug/finish50/soak-alpha17-31411be`.

The next implementation keeps a synchronous, complete canonical JSON snapshot, including
its clock and ownership at that exact boundary. UTF-8 bytes are copied into an owned,
transferable allocation. One background worker then performs the lossless schema-25 event
packing. No mutable world references cross that boundary, and simulation can continue while
packing runs. Packing consumes temporary rows in batches to avoid retaining a second full
event graph. The store accepts the resulting bytes directly, avoiding a second UTF-8 conversion.

The file format, migration path, checksums, writer fence, generation rename, CURRENT pointer,
backup and recovery contracts stay the same. There is one in-flight checkpoint per service;
an encoding error, worker exit or 60-second timeout rejects the checkpoint. Shutdown awaits
the final commit before terminating the worker. A crash during encoding leaves the previous
committed generation recoverable. This changes storage work scheduling, not canonical history,
knowledge, retention or NPC behavior.

`lastSerializeMs`/`maxSerializeMs` include synchronous snapshot capture, metadata capture,
UTF-8 copying and transfer submission: the work that stalls the simulation. `lastEncodeMs` /
`maxEncodeMs` report background parse/packing/encoding, `lastCommitMs` reports durable commit,
and `lastCheckpointMs` reports the whole operation. Background time is not a stall and must
still be reported rather than hidden. A new final soak is required; this design is not itself
a performance pass.

The synchronous capture is emitted as bounded JSON parts (eight people or 512 ordinary
array entries per part), then copied directly into one dedicated transferable UTF-8 buffer.
It avoids flattening a world-sized UTF-16 string and avoids transferring hundreds of separate
allocations. Concatenated parts are byte-identical to ordinary JSON, including omissions and
Unicode escaping. A cold mature-world diagnostic measured 157.23 ms JSON capture plus
15.43 ms transfer preparation (172.65 ms blocking total), with 523.46 ms of background encoding.
This measurement was taken with the Iron runner paused; it is not a realtime soak result.

Validation of this slice: 27 focused worker/server/persistence tests pass; the final shutdown
check passes with all 14 server integration checks. Seven event-table/JSON tests verify exact
streamed bytes, mutable witnesses, historical appearances and malformed input. A mature
84,855,524-byte checkpoint round-trips every snapshot field exactly into 66,153,614 stored
bytes. Its mixed-load capture measurement is diagnostic only; the final soak is still required.

## Bounding transient routine history between maintenance passes

Alpha.19 passed its connected ten-minute preflight and all 1,240 regression tests, but its
longer isolated soak failed after about 29 minutes: blocking capture reached 258.495 ms against
the unchanged 250 ms budget. Knowledge stayed around 53,250 records while event count rose
during a busy settlement period. Before the first Chronicle era, maintenance still ran only
once per world hour, allowing disposable detail to accumulate between passes.

On a preserved checkpoint copy, the existing compactor removed 27,432 events, including 13,032
completed goals, 12,409 arrivals and 1,572 path failures. Stored size fell from 69,905,562 to
64,230,025 bytes. The complete people, bodies, clock and scheduler state remained identical.
This is a reproduction of transient retention pressure, not a new performance acceptance pass.

The intermediate alpha.20 candidate ran pre-era maintenance every five world minutes. Its retention decisions, protected
knowledge/practice/causal references, recent-detail window and small-batch guard are unchanged.
The weekly cadence for established Chronicle eras is unchanged. The existing persisted
maintenance accumulator continues across reloads; no new state representation or schema is
introduced. More frequent maintenance also needs observation for CPU and tick-debt cost.

That experiment passed 60 focused checks, including bounded routine-detail retirement, causal
traversability, knowledge/practice retention and the maintenance phase across save/reload;
typecheck was clean. Three additional one-hour continuations were coherent and reloaded exactly,
but changed later trajectories compared with the old cadence. Their foundation means/maxima,
Normal populations and conserved currency remained the same. The experiment is preserved in
history; the final correction below restores the established hourly cadence.

## Exhausted hunting-ground retry loop

Tracing the burst found hunters finishing an unsuccessful gathering action as if work had
completed, then immediately accepting the same scheduled shift at the same exhausted ground.
A focused reproduction produced 98 false work completions in ten world minutes.

Nearby arrival or extraction now records a dated, provenance-bearing game-ground observation
in the existing knowledge ledger. A hunter who personally found no game can choose other goals
for one ordinary hunt interval (30 world minutes), then check again. A distant worker is not told
the ground's current state. Empty attempts fail; successful extraction that exhausts stock can
finish normally. The same action mechanics serve players and NPCs. No wages, output, skill or
progress are awarded for the failed attempt.

The focused reproduction now produces no false completion; ordinary renewable-resource upkeep
allows a later return and actual extraction. More frequent compaction is no longer the proposed
solution: hourly maintenance and existing retention/provenance rules remain in place. Economy,
knowledge, logistics, persistence, bounded-world and final soak validation must cover this change.

## Pantry-delivery commitment completion

The mature staging continuation exposed a second empty-plan loop: one farmer recorded 217
`provision_home` completions in 129.6 world seconds after depositing their surplus. The pantry
errand had acquired commitment protection but never released it, so its original carried-food
reference kept rebuilding a finished delivery. A replay from the preserved staging checkpoint
reproduced the repeated completions without editing a person or the pantry.

A finished pantry errand now ends its matching commitment and clears that completed goal;
ordinary deliberation can select another shopping trip if the pantry is still low. A failed
provisioning action abandons the failed errand rather than preserving its old plan. Multi-trip
hauls and other commitments retain their existing lifecycle. No inventory or wealth is granted.
The same checkpoint replay now records one completion across 1,800 world seconds. The targeted
34-test economy suite passes, including the new stale-commitment regression and existing
conserved food/money, purchases, deliveries, needs and household knowledge checks.

## Revisited observations and refused family testimony

The longer mature-world observation found two further retry cases. An unchanged game-ground
claim was passed to general learning, which correctly ignores duplicate facts; its observation
date therefore never refreshed. Once the first thirty-minute window expired, hunters revisited
every 0.6 world seconds. Extending the fixture across two revisit intervals reproduced 399
arrivals in seventy world minutes. Local observation now refreshes `lastConfirmedAt`, preserves
unchanged evidence, and replaces availability/source only when personally observed stock changes.
The extended test bounds revisits and verifies renewed stock is both harvested and believed.

Family-sharing goals also offered testimony to sleeping/unreachable listeners, although the
communication operator correctly refused it. The action still claimed completion, producing
thousands of empty plans. Goal selection now uses the existing embodied conversation predicate
and the same eight-hop testimony limit as communication. A refused or forgotten keyed testimony
fails instead of reporting success; no listener gains knowledge or a fabricated delivery marker.
The focused before-fix tests reproduced both cases; afterward all 84 checks across resource,
lineage, knowledge, retention and social-causality integration pass, with clean typecheck.
A mature saved-world continuation and final performance acceptance remain required.

## Haul access and saved-world recovery

The final bounded continuation found one resident with 955 repeated path failures while
carrying twelve grain to a tavern. The normal interior was reachable; the selected work
fixture was not. Hauling transfers place stock, so its load and deposit plans now use the
place's ordinary interior access point instead of a production fixture. This changes no
inventory, ownership, navigation or delivery rules.

The regression failed before the correction and passes afterward, including conserved
cargo and physical travel. The same affected saved resident resumed ordinary autonomy and
delivered all twelve grain within the next world hour without editing their plan or body.
The 25 logistics checks, 92 navigation/economy integration checks and typecheck pass.
Historical failed-route events remain evidence; bounded verification distinguishes those
from newly generated failures rather than deleting the old history.

## Resumption priority must not create goal churn

Semantic review of seed 918273 found a farmer alternating planting and pantry shopping every
nine world seconds. The suspended errand received a 0.4 resumption bonus, won selection, lost
that bonus when active, and immediately lost against the same unchanged competing motivation.
Structural-reference checks alone did not flag this as a failure; semantic churn must also be
inspected before accepting a world continuation.

The resumption bonus now uses the same 0.12 margin as ordinary switch hysteresis. Remembering
an unfinished errand still favors returning, but cannot by itself reverse the next decision.
This adds no absolute protection or new state and leaves physiological/emergency rules intact.
The focused fixture reproduced 120 suspensions in one world hour before the change. It now
allows ordinary social recovery, then completes a real purchase and conserved food delivery
within three world hours without the alternating routes. The 107 economy/logistics integration
checks, 46 physiological/commitment checks and typecheck pass. Fresh bounded continuations also
record semantic anomalies, rather than treating structural checks alone as complete acceptance.
