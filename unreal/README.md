# Unreal foundation

The existing TypeScript `World`, `Simulation`, and 32-person cast remain authoritative.
The C++ client sends direction/sprint intent over a loopback WebSocket. TypeScript validates
movement against its grid and sends snapshots at 10 Hz while stepping at 20 Hz.
Unreal interpolates NPC manifestations and reconciles its predicted player position.
Disconnects expire input after 300 ms and freeze client movement after 500 ms.

From the repository root in PowerShell:

```powershell
npm ci
npm run bridge
# In another terminal (first build):
./unreal/scripts/Build.ps1
./unreal/scripts/Launch.ps1
```

Open `unreal/TornVeilOnline/TornVeilOnline.uproject` with UE **5.8** and press Play.
`Setup-Assets.ps1` copies the installed Epic template Manny skeleton/animations locally.
Requires UE Templates and Feature Packs, Visual Studio C++ tools, Windows SDK 22621,
and the .NET Framework SDK. This machine's incomplete SDK/toolchain was reconstructed
in ignored `.debug/AutoSDK`; `Build.ps1` and `Launch.ps1` use it when present.

Controls: WASD camera-relative movement, Shift run, mouse orbit, wheel smooth zoom,
Tab select nearby canonical person, LMB (or X) a light melee strike, F6 developer inspector,
E gather a nearby resource through the existing simulation action (when available).

A strike is intent and nothing else. The client may name a body it can see; the simulation
re-checks reach, facing and recovery against canonical state and resolves the blow through
`Simulation.attack` -> `Simulation.applyHit` — the same path an NPC's own attack takes, with the
same lethality rules (an ordinary blow downs a person rather than killing them; a subdued,
surrendered or in-custody person is out of the fight and cannot be struck further) and the same
perception, so witnesses learn about it the ordinary way. No damage number, no hit decision and
no death ever originates in Unreal. Attack, hit, downed and dead are read back off the canonical
body (`pose`, `health`, `incapacitated`, `dead`, `lastAttackAt`, `lastHitAt`).

## One settlement corner

```powershell
npm run bridge                                    # in another terminal
./unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/create_settlement_corner.py
```

`create_settlement_corner.py` dresses exactly three canonical places — Bramble's Bakery, the
bread stall and the village well, the north-west approach the Traveler spawns onto — and nothing
else. The footprints, heights and doorways all come from the running bridge's `/scene`, so the
corner sits where the simulation says those buildings are; the script refuses to run without the
bridge rather than invent a footprint. Re-running is safe: everything it makes is tagged and the
tagged actors are cleared first.

The look is grounded Japanese vernacular, not European half-timber: charcoal kawara over an eave
that reaches 1.65 m past the wall, dark timber posts on a ken grid with cream plaster between
them, a raised engawa on the side the canonical door is on, and warm paper lanterns. Late
afternoon sun, low and warm, with volumetric fog so the overhang has depth under it.

It is built from engine primitives and generated materials on purpose — nothing is downloaded,
nothing is redistributed, and it runs on a bare UE 5.8 install. Swapping any of these boxes for
real modular meshes later is a per-actor change, not a rewrite. Humanoids stay Epic's template
skeleton; no procedural people are generated here or anywhere else.

**Unverified.** This script was authored without an editor to run it in. Its Python parses and
its geometry is derived rather than eyeballed, but nobody has yet seen the corner. Treat the
first run as a review, not a result.

The rest of the map is deliberately an integration floor, not settlement art. Canonical terrain and
building collision still live in TypeScript; detailed visual/collision projection remains
future work. Do not treat the floor as a second world or add Unreal NPC schedules.

Epic template content is **not redistributed in Git**. It remains governed by the Unreal
Engine license from the user's engine installation. See Epic's Unreal Engine EULA:
https://www.unrealengine.com/eula/unreal. Code uses `ws` (MIT) and existing repo dependencies.

Debug endpoints: `http://127.0.0.1:8787/health`, `/snapshot`, `/scene`.
The first native WebSocket connection controls the Traveler; later connections observe.
This is a local development bridge, not a multiplayer/public server. Every body has its
own ID and owner entity ID; withdrawn bodies are removed independently of identities.

## Recognised class

`src/sim/mind/vocation.ts` reads a class out of a life: Armsman, Artisan or Scout, or — for most
people — nothing at all. It is a recognition, not a label anyone is issued and not a container of
stats. It reads skills (which only rose through real successful practice), attributes, canonical
`Conflict` history and first-hand place knowledge; it never reads occupation, and a test greps the
file to keep that true. Nothing in it writes to the world or multiplies anything: a recognised
Armsman hits exactly as hard as the same person did before anyone recognised them.

The consequence is deliberate and worth expecting: Ashford's bakers and its cook are read as
Artisans and its smith is not, because the smith has not yet practised anything in the
simulation's terms. Class follows practice, not title. Unreal shows it on the nameplate and in
the target panel, alongside — never instead of — occupation, with the evidence it was read from.

## Verifying the integration

```bash
npm run bridge:verify
```

`src/headless/bridge/livecheck.ts` starts a real bridge on its own port and drives it over the
real protocol, speaking exactly what `TVBridgeSubsystem.cpp` speaks — a native connection, a
`move` intent every 50 ms, and the same projection math `ATVCharacter::Project` applies. It
asserts the canonical player and all 32 canonical NPCs are projected with real Torn Veil
identities, that NPCs move under canonical simulation state, that the player moves *only*
because TypeScript moved him, that client-side prediction stays inside the smoothing budget,
that abandoned input expires after the documented grace, that replayed/mis-versioned/non-intent
packets are rejected, and that the projected body set never grows (no runaway spawning).

This is the reproducible part of "press Play and look". It does not replace looking: meshes,
animation, camera feel and lighting still need a human at the editor.

## Editor automation

Two independent channels reach the editor, and this project used to have one of them silently
misconfigured — see the note in `Config/DefaultEngine.ini`. The Remote Control settings lived
under `WebRemoteControl.WebRemoteControlSettings`, which is not the class that owns them, so the
web server started (making the endpoint reachable) while `bEnableRemotePythonExecution` was never
read and every Python call over it was refused. They now live under the correct
`[/Script/RemoteControl.RemoteControlSettings]`.

Level authoring should not depend on that channel at all:

```powershell
./unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/create_foundation_level.py
```

`UnrealEditor-Cmd.exe -run=pythonscript` loads the same project, plugins and `unreal` module
headlessly and returns a real exit code.
