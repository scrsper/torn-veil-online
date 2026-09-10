# Unreal foundation

The TypeScript `World` and `Simulation` remain authoritative for the seeded world and authored Ashford reference.
The C++ client sends direction/sprint intent over a loopback WebSocket. TypeScript validates
movement against its grid and sends snapshots at 10 Hz while stepping at 20 Hz.
Unreal interpolates manifestations and reconciles canonical player positions, with local CharacterMovement disabled.
Abandoned input expires after 300 ms. Native snapshot freshness is separate from transport and presentation streaming; the client pauses input after 1.5 seconds without a valid snapshot.

From the repository root in PowerShell:

```powershell
npm ci
npm run bridge:playable
# In another terminal (Launch performs the incremental native build):
./unreal/scripts/Launch.ps1
```

Launch opens UE **5.8**; press Play. For Ashford use `npm run bridge` and `Launch.ps1 -Scenario Ashford`.
Regional protocol 2 sends the canonical snapshot before bounded presentation chunks. See [startup reliability and evidence](../docs/PLAYABLE_STARTUP_FIX.md).
`Setup-Assets.ps1` copies the installed Epic template Manny skeleton/animations locally.
Requires UE Templates and Feature Packs, Visual Studio C++ tools, Windows SDK 22621,
and the .NET Framework SDK.

### If Windows has no usable SDK installed

UnrealBuildTool will refuse before it compiles anything:

```
Platform Win64 is not a valid platform to build. SDK validation failed:
  Sdk: not found. Required version 10.0.19041.0.
```

`Build.ps1` and `Launch.ps1` set `UE_SDKS_ROOT` to `.debug/AutoSDK` when that directory
exists, which lets a hand-assembled toolchain stand in for an installed one. `.debug/` is
gitignored, so this is per-machine and never committed. The layout UBT looks for is:

```
.debug/AutoSDK/HostWin64/Win64/
  VS2026/<MSVC version>/          bin, include, lib   (from the MSVC toolchain)
  Windows Kits/10/                Include/<ver>, Lib/<ver>, bin
  Windows Kits/NETFXSDK/4.6.2/    Include/um, Lib
```

This machine's copy carries MSVC 14.51.36231 and Windows SDK 10.0.22621.0. Confirm the
build is actually using it — the log names the toolchain it picked:

```
Using Visual Studio 14.51.36256 toolchain (...\.debug\AutoSDK\...) and Windows 10.0.22621.0 SDK (...)
```

It must be a real directory here, not a junction into another checkout. A link into a
second clone works right up until that clone is deleted or moved, and then the failure
appears as a missing SDK rather than as a missing link.

Controls: WASD camera-relative movement, Shift run, mouse orbit, wheel smooth zoom,
Tab select nearby canonical person, LMB (or X) a light melee strike, F6 developer inspector,
E performs the nearby canonical interaction; C consumes carried food; Q drops the last carried item.

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

**Seen now.** It has been run and looked at, and it took four fixes to get there. Three were
units the engine does not check: `FColor` is declared B, G, R, A, so a positional
`unreal.Color(255, 226, 188)` made both the sun and the paper lanterns cold blue; a
DirectionalLight's intensity is lux and was set to 5.5, while the lanterns are candelas and were
set to 1400, so the lanterns outshone the sun by about 250x and flooded a 0.022-albedo roof to
flat cream; and `ExtendDefaultLuminanceRange=True` makes the post-process exposure clamp EV100
rather than a multiplier, so 0.6..2.2 was near-darkness EV and the camera compensated by blowing
out everything left. The fourth was `volumetric_fog`, which is not a property name --
`enable_volumetric_fog` is -- and which aborted the script before it saved anything.

None of those fail loudly. They render, wrongly. `light_the_corner`'s docstring now carries the
reasoning so the constants are not mistaken for taste.

What it looks like: the bakery reads as intended -- deep eaves with a real shadow line under
them, dark timber posts on the ken grid with cream plaster between, the raised engawa, warm
paper lanterns at the wall. Two things are still visibly wrong and were deliberately not chased:
the roof reads warm brown rather than charcoal because the low sun tints it, and the integration
floor is a featureless orange plane, so the corner sits in a desert rather than a village.

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

And it does not replace looking in a second way, learned the hard way. This suite passed 33/33
against a bridge the real client could not connect to at all. It opens its socket with the `ws`
package while the client uses libwebsockets, and the bridge's admission test happened to turn on
a header the two send differently — so the one client on the machine that the bridge would admit
was the test's own. Where this file speaks *for* the client, it has to open the connection the
way the client does; it now sends the same handshake header `TVBridgeSubsystem::Connect` sends.
Treat "livecheck passes" as evidence about the protocol, never as evidence that Play works.

## Editor automation

Two independent channels reach the editor, and this project had one of them silently
misconfigured for longer than anyone could tell — see `Config/DefaultRemoteControl.ini`, which
now holds the settings and explains the trap at length.

Briefly: `URemoteControlSettings` is `UCLASS(config = RemoteControl)` and lives in the
`RemoteControlCommon` module, so it is read from `Config/DefaultRemoteControl.ini` under
`[/Script/RemoteControlCommon.RemoteControlSettings]`. The settings were in `DefaultEngine.ini`,
where no section name works at all. Both the original section and a previous attempt to correct
it named the wrong module as well.

The reason this survived two fixes is that it cannot be diagnosed from the endpoint.
`bAutoStartWebServer` defaults to true, so `/remote/info` answers 200 and the channel looks
healthy; `bRestrictServerAccess` also defaults to true, so calls are refused whether or not the
section is read. A reachable server that refuses everything is what *both* the broken and the
"fixed" configuration look like from outside. Three switches gate a Python call arriving as a
console command and all three are required — see the ini.

Level authoring should not depend on that channel at all, and this is why:

Level authoring should not depend on that channel at all:

```powershell
./unreal/scripts/Run-EditorPython.ps1 -Script unreal/scripts/create_foundation_level.py
```

`UnrealEditor-Cmd.exe -run=pythonscript` loads the same project, plugins and `unreal` module
headlessly and returns a real exit code.

Two things worth knowing about that path. It cannot save a level the interactive editor has
open — the save fails with a sharing violation and the script exits non-zero having built
everything and persisted none of it, so close the editor first or run the script inside it. And
`.ps1` files here must stay ASCII: Windows PowerShell 5.1 reads a BOM-less script as the system
ANSI codepage, so a UTF-8 em dash in a string silently breaks the file's parse and the engine is
never reached. PowerShell 7 reads it fine, which is how one got committed.

## Playable life loop

The lower HUD reads hunger, thirst, wealth and carried quantities from snapshots. E buys one
unit of reachable merchandise, takes a reachable world item, gathers a reachable resource, or
drinks at a reachable water source; C consumes carried food; Q drops the last carried item.
The prompt and price come from canonical action derivation. An interaction packet contains only
an opaque interaction ID and the ordinary protocol version/sequence. TypeScript re-derives the
action and checks the item, seller, possession, reach and solid passage before calling the existing
commerce or consumption path. Stock, payment, nutrition and ownership are never authored in C++.

For PIE automation, Interact/Consume/Drop and Forward/Right are the reflected handlers bound to E/C/Q
and movement. Disable hardware input polling on the pawn while driving its axis handlers, then
restore it afterward; otherwise the idle keyboard overwrites injected axis values. These handlers
still submit ordinary intents. No direct bridge packet is needed to test the Unreal client.

Phase 1 observed in PIE: 32 NPCs, purchase 50 -> 49 silver and bread 2 -> 3, consumption bread
3 -> 2 with hunger reduced to zero, then a walk to the village well and thirst reduced to zero.
The HUD and both prompts were also checked in captured PIE frames. Existing bakery art/collision
and camera clipping remain a presentation follow-up.
