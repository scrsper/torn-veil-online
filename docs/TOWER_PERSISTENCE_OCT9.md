# Late-floor persistence and input stability â€” October 9

This local change continues the earned-growth checkpoint `53c98b12ca6fa6a81da732ebabcc2d5201a0cac6`
on `codex/connected-realms`. It preserves the canonical simulation, Babylon client,
existing assets and rank rules. The separate Tower-polish worktree was not changed.
There was no push, merge, deployment or new external service.
Implementation commit: `7efb13c4eb06ab30aecea99dc41cbe1a3437a39d`.
Migration-guard follow-up: `89ed176d95bcb0a38e29a42bdd7a5ed0dda2711c`.
The recorded simulation/rendering measurements precede only this guard extension;
simulation, rendering, compression and operation execution did not change afterward.

## What changed

The realm host previously serialized and synchronously rewrote its entire world
every five simulation seconds. A successful Tower transition serialized it three
times: rollback capture, commit capture, and another capture in the write callback.
The summit save held 314,039,271 bytes. Its largest fields were people (120 MB),
events (119 MB), situations (50 MB) and execution state (20 MB). Most of the people
data was acquired knowledge and memories. Deleting that data would change history.

The host now records ordered operations in checksummed journal batches, written
through a temporary file, file sync and atomic rename. A save acknowledgement means
its batch is durable. A single worker replays those same operations through
`RealmRuntime`, `RealmSession`, `TowerController` and the existing simulation. The
worker writes a lossless gzip checkpoint every thirty simulation seconds while the
main host continues simulation and presentation. Routine autosaves never capture,
clone or stringify the full live world. No LLM runs in this path.

The checkpoint contains the ordinary schema-31 canonical save plus host continuation
metadata: pending input, command identities and acknowledgement frontier, cadence,
and pending portal choice. Recorded server timestamps preserve input expiry during
replay. Startup releases the old connection's input and pending portal choice;
authorization is issued again to a new connection. Unique people, event causes,
injuries, inventories, finite rewards, NPC histories and progression proofs remain
in the canonical snapshot. No lossy summary or new history-pruning policy is used.

Tower/legacy structural transitions retain **one** main-thread rollback capture.
Their successful result is committed through the journal before HTTP acknowledgement.
An invalid transition restores the world and continuation. Transition IDs/revisions
retain their existing at-most-once rules. Routine movement and combat use the shared
command queue, not this structural capture path.

The ascent client no longer sends movement continuously when idle. It stops sending
state samples when host frames are stale or the socket is backed up. During queue
congestion, obsolete trailing movement samples receive explicit cancellation
receipts. Coalescing cannot cross an action or interaction boundary. It never turns
a backlog into extra physical movement; at most one movement sample executes per
step. Ordered interactions and finite rewards retain stable receipts.

## Durability and migration

For a configured `world.json`, the active save is now **`world.json.store/`**. The
original imported JSON remains unchanged. Copy the whole active directory for a
backup; copying only the old JSON would omit later progress. The directory contains
`CURRENT.json`, a compressed base, a previous compressed base and any journal tail.
Older redundant snapshots and journal segments are removed only after a complete
new base is atomically committed. This does not reduce the meaning or contents of
the current canonical history. Temporary debris from interrupted writes is ignored.

The prior working code checkpoint remains in Git at `53c98b12`, and the retained
earned source saves were only copied for this work. To inspect that prior checkpoint,
use a separate checkout and a fresh copy of its original JSON; do not point the old
host at the new active store or overwrite either saved history.

A live writer fence prevents two hosts from owning this directory. A damaged
committed file, missing base, sequence gap or incompatible replay is an error;
the host does not silently create a replacement character. Disk/replica failures
pause the host rather than acknowledging undurable state. Backlogs are bounded.

Replay is sensitive to executable mechanics. A conservative fingerprint covers
the complete executable source tree, dependency lock and Node/V8/ICU runtime,
including validators outside the simulation directory. Checkout line endings are
normalized and filename ordering is independent of locale. If code
changes with an outstanding journal tail, startup refuses that replay and keeps
the files. Resume with the old revision and shut down cleanly to checkpoint before
upgrading. A fully checkpointed base can use the existing save migrations, and a
new-engine base is committed before new-engine journal entries. Schema-31's existing
24â€“31 readers are unchanged. This is a local development host feature; packaging
the replay worker into a distributable release remains separate work.

To export a verified active save to ordinary canonical JSON, stop the host and run:

```powershell
node --import tsx scripts/tower/export-realms.mjs .debug/realms/world.json .debug/realms/export-new.json
```

The export refuses to overwrite an existing destination. It includes the durable
journal tail; it is suitable for the existing checkpoint auditor.

## Observed evidence

Measurements below are local wall-clock observations on the intended Windows host,
not simulated playtime or a general hardware guarantee. No new 100-floor climb was
run. The retained earned floor-95 and completed-summit saves were copied for QA.
OS inventory confirms the Ryzen 5 9600X, 33,436,114,944 bytes of physical RAM, and
RX 6650 XT plus integrated Radeon adapters. Per-adapter GPU/VRAM usage was not measured.

| Summit measurement | Observed result |
|---|---:|
| Previous synchronous capture/write/rename, three samples | median 2,307 ms; max 2,464 ms |
| New durable journal flush, six samples | median 3.97 ms; max 4.45 ms |
| Full compressed checkpoint | 49,466,041 bytes from 315,598,881 bytes |
| Worker full capture / total checkpoint | 1,398 / 2,892 ms |
| Main canonical step, 600 samples | median 0.70 ms; p95 4.01 ms; max 160.52 ms |
| Main event-loop excess delay, gameplay phase | p95 26.25 ms; max 172.01 ms |

All canonical snapshot fields matched after worker checkpoint/reload, excluding
only the save timestamp. A worker was interrupted during another large checkpoint:
the previous base remained, the committed tail replayed exactly, and a later
unflushed step was excluded. The original imported save matched its source hash.
The floor-95 sample also matched every canonical field; six flushes had a 3.97 ms
median and a 4.28 ms maximum, with a 43.6 MB compressed snapshot.

The first rendered summit recording passed nine checks: actual earned Silver load,
no idle command traffic, six acknowledged saves including movement, a background
checkpoint with a live host, reload, Tower return, portal cancellation by reload,
and portal round-trip preservation. Save acknowledgement at the browser took
11.6â€“71.6 ms, including transport/render scheduling. It had no browser errors. An
abruptly stopped host's recovered export retained the final inventory, body, rank,
completed run and exactly two committed crossings. The recording depicts the
journey and persistence checks, not the preceding 100-floor climb.

The final 122.20-second recording repeated all nine checks successfully. Its
background-checkpoint segment recorded 3,685 frames: median 8.7 ms, p95 14.1 ms,
maximum 190.8 ms. Traversal recorded 5,934 frames: median 7.0 ms, p95 29.9 ms,
maximum 133 ms. The retained traversal receipt window contains 600 accepted
commands; it is a bounded window, not a count of the entire run. Six browser save
acknowledgements had a 45.7 ms median and 61.9 ms maximum. Host RSS, including the
worker, was 2.46 GB at the sampled checkpoint; browser JS heap was 283 MB.

The recording is `actual-persistence-summit-journey.webm`, with an H.264 MP4 copy
(`actual-persistence-summit-journey.mp4`, 122.20 seconds, 1440 x 900, 49,076,897
bytes). The conversion retains the captured journey and playback speed; its encoding
and a decoded frame were verified. It is accompanied by five actual rendered screenshots in `.debug/tower-stability/summit-browser-final/`. It includes
the earned summit, a live background checkpoint, Tower return, Cinderveil and the
return to Aether Reach. These are captured gameplay, not concept art or mockups.

Final validation on the complete source/runtime guard passed **2,120/2,120 tests
in 213 files**, using the normal single-worker aggregate (31m 17.60s, exit 0). The
focused suite passed **50/50 in five files**; TypeScript and the production web
build also passed. No runtime code changed during or after the final aggregate.

Final rendered phase measurements and aggregate verification are recorded in
`docs/evidence/tower-stability-oct9/RESULTS.json`. Raw development
attempts, including the repaired worker startup failure, remain under
`.debug/tower-stability/`; failed attempts are not presented as passing evidence.

Reproduce the large-save check in a new output directory:

```powershell
node --max-old-space-size=8000 --import tsx scripts/tower/persistence-benchmark.mjs <earned-save.json> <new-evidence-directory>
```

Launch from this worktree with `npm run realms:play`, or `node --import tsx
src/server/realms.ts` when local assets are already staged. The default address is
`http://127.0.0.1:7510/?realms`. `TV_REALMS_SAVE`, `TV_REALMS_PORT` and the existing
read-only `TV_REALMS_ASSETS` override remain available.

## Limits and remaining work

Compression does not bound logical history growth. Two compressed generations plus
the retained 314 MB import use more total disk than one compressed file; the size
table is not a claim about total disk use. The replica adds memory and CPU demand.
Full replay equivalence is tested on real retained saves, not checked by recapturing
the entire main world at every autosave. Future nondeterministic external inputs
must be explicitly recorded, with regression coverage, before entering this path.

The system still has occasional simulation/GC spikes, startup/load work and a
synchronous rollback capture for structural Tower transitions. Thirty-second
background snapshots also impose disk/worker costs. Longer unattended sessions,
bounded archival storage, transactional structural mutations without full rollback
capture, and broader hardware/load testing remain work. This does not establish a
finished megacity, reference-level art fidelity, a guaranteed frame rate or human
playtime. The prior art gate and regional/national rank validation remain open.

## Gold recommendation â€” no rank change implemented

The current gate averages **all** stored distinct-opponent proofs, requires 97%
quality for Gold, and stops adding proofs at 2,048. That can permanently punish
early learning. With their present evidence, even perfect remaining proofs up to
the cap would leave the retained 1,523-proof summit run at about **91.84%** and the
1,383-proof floor-95 run at about **91.59%**, below 97%. This is a mathematical
consequence of the existing rule, not evidence that either character deserves Gold.

Distinct weak opponents also contribute: consent/aggression, personal damage and a
minimum health pool do not establish a stage-relevant challenge. An arbitrary
97% lifetime mean has not been calibrated against human play or a world's actual
distribution of power. Merely lowering it or granting Gold at a floor counter would
hide those problems and change rank meaning without justification.

For review, separate the permanent causal/anti-repeat evidence ledger from the
assessment window. Keep every opponent identity, source event and earlier injury
record, with lossless indexed archival if needed. Evaluate demonstrated current
capacity using recent, stage-relevant challenges, actual hostile capability and
exposure, learned forms and finite source integration. Define challenge qualification
in shared physical mechanics for players and NPCs; weak farming should not satisfy
a higher-capacity demonstration. Choose window sizes and thresholds through
adversarial and human calibration, then validate the intended regional/national
meaning against a broader world. Those policy choices require design review and
have deliberately **not** been implemented in this persistence repair.
