# Shared motion and contact checkpoint — October 9

The comparison uses the existing installed character assets and clips. No Opus v1/v2
mesh, rig, or material candidate is installed. This is actual Babylon gameplay driven
by body-bound commands through the canonical BridgeSession, captured in headed
Chrome. The isolated fixture never opens an ordinary player's save.

## What changed

- The shared character adapter corrects the asset's +Z facing under the canonical
  -Z actor root. The simulation's facing and contact geometry are unchanged.
- Canonical move IDs select jab, cross, kicks and heavy strikes. Authored contact
  frames are retimed to canonical preparation, active and recovery intervals.
- Dodges use their direction and physical action clock. Completed retained actions
  no longer suppress walking. Walk/run pacing uses baked stride measurements.
- Standing foot pins release during running, strikes and dodges. Guarding movement
  uses the existing lower-body layer; contact counters drive authored hit reactions.
- Actual transmitted damage creates bounded physical recoil through the shared
  collision kernel. The remaining response persists; reload does not replay it.
- An ordinary NPC attack-plan step uses fresh sight of an occupied approach or
  another committed strike to guard and reposition. This does not reserve a global
  attacker slot, prevent unseen flanks, grant invulnerability, or alter hit testing.
- City movement now uses shared bodily eligibility, injury/effect speed and combat
  locks. Navigation and portal interaction cannot bypass incapacity.

## Matched evidence

`captures.json` contains source paths, checks, GPU identification and video SHA-256.
Both runs use the same 1440×900 sequence: walk/start/stop/turn/run, four strike inputs,
directional dodge, receiving strikes, guard, then five opponents and retargeting.

| Actual short capture | Baseline | Motion + contact |
|---|---:|---:|
| Frame interval p50 | 6.9 ms | 6.9 ms |
| Frame interval p95 | 7.1 ms | 7.1 ms |
| Frame interval p99 | 7.5 ms | 7.5 ms |
| Server step p95 | 0.967 ms | 1.191 ms |
| Browser JS heap sample | 382,339,299 bytes | 380,255,472 bytes |
| Script assertions | 4 passed | 4 passed |
| Browser errors | 0 | 0 |

The GPU reported **AMD Radeon RX 6650 XT / ANGLE D3D11**. These runs are refresh
limited, short, and not controlled GPU benchmarks. Heap samples are not VRAM usage
or a leak/soak test. They do not establish megacity readiness or improvement in GPU
cost. The arena review host's five partners are explicit test drivers exercising the
shared mechanics and spacing policy, not evidence of autonomous encounter design.

A read-only Windows inventory confirmed an **AMD Ryzen 5 9600X**, 6 cores / 12
logical processors, and 33,436,114,944 bytes of OS-visible physical memory. Dedicated
VRAM allocation was not measured. Inventory was taken on the same local machine.

Screenshots here are unedited actual frames. Full videos remain local:

- `.debug/motion-oct9/before-c98207a-r2/before-c98207a-r2-gameplay.webm`
- `.debug/motion-oct9/after-contact-r2/after-contact-r2-gameplay.webm`

The earlier failed `before-c98207a` attempt is retained as debugging evidence and is
excluded. The successful baseline is the `-r2` run.

An additional read-only inspection of the original latest capture passed 11 checks:
canonical walking, four accepted strikes including a cross, victim displacement,
active sidestep displacement, locomotion after recovery, incoming contact, all five
partners eventually attacking, and the recorded assets/commands/video. Its report is
`evidence-check.json`. These are recorded-state checks, not extra visual-quality passes.
The latest actual VP8 video is 1440x900, 26.96 seconds, 2,834,677 bytes.

Two subsequent edge-case fixes bind kick recoil to the matching contact event and
preserve crouched collision clearance without reducing external recoil by walking
speed. Both were reproduced by failing regressions before correction. The capture
above predates those fixes; it contains neither a spell after a kick nor crouching.

## Quality judgment and limits

Facing and action selection are visibly corrected, and the crowd occupies more space.
**The reference's overall movement/character quality is not matched.** Foot grounding,
turn quality, fine hand/weapon contact, contact shadows and clothing still need work.
This capture covers unarmed motion, not a completed sword/shield comparison. It does
not prove all replacement meshes or clothing kits look correct.

The coordinator inspected the [motion reference](https://x.com/psergiomr/status/2107539384958632383).
Observed goals were bent-knee stance, whole-body anticipation/contact/recovery,
victim displacement and nearby enemies managing space. Engine, FPS, latency,
root-motion method and IK were not established by that video. Its developer also
described melee attack spacing in the [reply](https://x.com/psergiomr/status/2107562025006026844).

The rich legacy Tower still uses its scoped Fighter combat. Its checkpoint adapter
continues to preserve canonical identity and quarantine unverified rewards. This
motion/arcana checkpoint does **not** finish the larger canonical Tower migration,
Silver/Gold metaphysics, multi-hour balance or the documentarian character.

## Launch and reproduce

From this worktree, with Node available:

```powershell
$env:TV_REALMS_ASSETS='web/public'
node --import tsx src/server/motionReview.ts
```

Open `http://127.0.0.1:7518/?motion-review`. WASD moves, Shift runs, J strikes, K
uses a heavy strike, L uses a low strike, Space dodges, G guards, Tab retargets.
The fixture buttons reset only this isolated laboratory. Capture with
`node scripts/web/motion-review.mjs` and a fresh `TV_MOTION_LABEL`.

Inspect that completed capture without rerunning or altering it:
`node scripts/web/motion-evidence-check.mjs .debug/motion-oct9/after-contact-r2`.

The ordinary connected world still launches through `Play Torn Veil.cmd` / the
existing `realms:play` command. Its previous traversal evidence is in
`docs/evidence/connected-realms`; those videos are separate from this motion lab.
