# Playable startup reliability

Branch: `codex/playable-bridge-startup-fix`, from merged main `09cf24d`. No Regional Life work or canonical simulation changes.

## Confirmed cause

The actual running project was `C:/Users/green/Desktop/projects/torn-veil-online`. Its source was current, but `UnrealEditor-TornVeilOnline.dll` dated September 7. Launch copied template assets and opened that stale binary without invoking Unreal Build Tool. The binary retained Unreal's **1,048,576-byte** default WebSocket text limit. Its log explicitly closed with **1009: Received text message exceeded memory limit**. The updated source's 8 MiB setting was not in the binary the user ran.

The merged server also placed a **2,600,389-byte** nine-region message before the first snapshot. That made canonical startup depend on accepting and processing all initial presentation. Both problems are fixed. The printed `0 NPCs` was visibility, not world population: this save contained seven settlements, 127 other Persons, and valid player `p_128` / body `b_128`.

Previous tests exercised `BridgeSession` directly, an unrestricted Node WebSocket, or a separately built native client/developer projection fixture. They did not launch this checkout's stale DLL, enforce native wire limits, or require a snapshot before presentation. The new smoke starts the real playable server and reproduces the native receive/acknowledgement assumptions; real PIE validation uses the user's Desktop checkout and existing save.

## Runtime contract

| Area | Change |
|---|---|
| Launcher | Runs incremental UBT before opening Unreal. Fails on build/prerequisite errors; detects an already-open project, verifies bridge health/protocol, and prints both checkout paths. No manual build step is needed on each pull |
| Greeting | `hello → scene → snapshot`, before any region generation. Scene supplies the player's current presentation origin |
| Versioning | Canonical envelope remains version 1; regional protocol is version 2, negotiated with `X-Torn-Veil-Region-Protocol: 2`. Stale playable clients receive a clear protocol rejection |
| Residency | `regions_state` carries desired region IDs, center, unloads and origin. Center first, then cardinal neighbors, then corners |
| Transfer | `presentation_chunk` carries at most 64 KiB of raw JSON as base64. Wire messages are capped at **128 KiB**; native receive limit is **256 KiB**; a single assembled transfer is capped at **4 MiB** |
| Backpressure | One unacknowledged chunk per connection. The final acknowledgement follows native application. A slow renderer cannot queue nine regions ahead of snapshots |
| Work budget | One region is generated lazily per transfer. Snapshots are sent first each publishing turn. Native callbacks assemble data; the tick applies one completed transfer after liveness/input processing |
| Updates | A region can be applied independently, including its dynamic state. Later semantic updates, region invalidation, unloading and origin rebasing remain supported |
| Freshness | Separate transport connection, valid canonical snapshot and presentation progress. Freshness uses monotonic time with a **1.5-second** bound (15 nominal snapshot intervals), allowing measured editor/projection pauses. Stale snapshots stop movement and show “snapshots stalled,” without pretending the transport disconnected |
| Authority | Unreal CharacterMovement remains `MOVE_NONE`; GameSim still adjudicates movement and expires abandoned intent after 300 ms |
| Diagnostics | Connection role, greeting sizes/buffering, binding, per-transfer size/chunks/projection time, input start/stop and close code/reason. Native logs hello/scene/binding/liveness/transfer application. No per-frame lifecycle logging |

The installed `ws` implementation passes `maxPayload` to its **Receiver**, not its Sender. The server's 4,096-byte inbound limit remains appropriate for intentions/acknowledgements; it never constrained the old outbound region frame. The original failure was the native receiver, not this setting.

## Evidence

| Measurement | Result |
|---|---|
| Old greeting | 63-byte hello; 219-byte scene; **2,600,389-byte regions**; then 947-byte snapshot at 451.86 ms in diagnostic Node client |
| Old per-region geometry | 26,495–686,387 bytes; the nine-region envelope caused the limit failure |
| New live smoke | 82-byte hello; 227-byte scene; 865-byte snapshot at **43 ms**, then progressive chunks |
| New largest wire message | **87,508 bytes**, under the enforced 128 KiB bound |
| Slow renderer | Withheld first acknowledgement for 850 ms; snapshots and canonical movement continued |
| Smoke snapshot gap | Maximum 732.69 ms while focused tests were also running; inside native freshness bound |
| Native existing save | Controller assigned; hello/scene/snapshot bound to `p_128` / `b_128`; LIVE before terrain; center `47,53` then all nine regions |
| Native projection | Same coordinate transform as canonical player; center procedural mesh present; settled reconciliation error **0 cm** |
| Native movement | Held W: `(12054.5,16,13765.5)` → `(12059.77,16,13765.5)`, **5.27 m**, while neighboring regions loaded |
| Other native keys | A moved −Z 5.78 m; S moved −X 5.44 m; D moved +Z 5.78 m |
| Restart | Stop PIE released ownership; starting PIE again in the same editor reacquired the same canonical body, returned LIVE and rebuilt nine regions |
| Projection cost | Existing-save cold center projection measured 246.08 ms. Subsequent sampled regions were roughly 6–176 ms; no worker/native simulation migration was needed |

Held-key automation is explicit: the editor-only `TV.TestMoveKey W|A|S|D [seconds]` command dispatches press/release through **PlayerController::InputKey and the real configured WASD bindings**. It auto-releases within five seconds and cannot edit positions or simulation state. The operating-system UI was used to launch Play and inspect the resulting movement/world. This is not a relocation probe or local-physics test.

Evidence files:

- [Original native close reason](evidence/startup/before-native-close.txt) and [original message sizes/order](evidence/startup/before-messages.json).
- [Real-server smoke](evidence/startup/live-smoke.json), [canonical native-key positions](evidence/startup/native-wasd.json), [server lifecycle](evidence/startup/server-lifecycle.txt), [native lifecycle](evidence/startup/native-lifecycle.txt).
- [LIVE before input](evidence/startup/native-before-input.png), [during canonical movement](evidence/startup/native-during-input.png), [LIVE after PIE restart](evidence/startup/native-restart.png). Matching JSON files record snapshot count/age, body IDs, region count, coordinates and disabled local movement.
- [Controller released](evidence/startup/native-controller-released.json). Normal PIE stops recorded close 1000; final editor teardown also exercised close 1006, with ownership released in both cases. No unexpected close occurred during active play.

## Validation and reproduction

- Focused bridge/region tests: **12 passed** across three files.
- Additional lifecycle, combat, dialogue, embodiment, action parity, movement and mechanism-menu regressions: **44 passed** across seven files.
- Real-server `npm run bridge:playable:verify`: passed 56 checks, including bounded messages, deliberate presentation backpressure, ordinary movement, observer assignment and reconnect.
- TypeScript typecheck and production bundle passed (123 modules).
- UE 5.8 editor target built successfully in both checkouts, including the launch-triggered build and editor-only keyboard acceptance helper.
- Actual Desktop-checkout `npm run bridge:playable → ./unreal/scripts/Launch.ps1 → Play` passed with the existing save. Test bridge/editor were stopped after saving. The canonical world was not reset.
- The full world regression suite was not repeated: this fix changes bridge/presentation/launch paths, and the 56 relevant regression tests plus live socket/native acceptance cover the affected boundaries. No assertions or time limits were weakened.

```powershell
npm run bridge:playable
# In another terminal:
./unreal/scripts/Launch.ps1
# Press Play.

# Automated socket acceptance (separate temporary world and port):
npm run bridge:playable:verify
# During real PIE, read-only native assertions and screenshot:
./unreal/scripts/Invoke-EditorPython.ps1 -Script unreal/scripts/verify_startup_pie.py
```

Remaining limits: region generation is synchronous but bounded to one region; the editor can still show a truthful stalled-snapshot state during a genuinely long pause. The shared TCP stream does not promise hard real-time delivery. World art, machinery and the prior milestone's other showcase gaps are unchanged. No new simulation, LOD or Regional Life subsystem was introduced.
