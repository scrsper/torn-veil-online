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
Tab select nearby canonical person, F6 developer inspector, E gather a nearby resource
through the existing simulation action (when available). No player combat in the foundation.

The map is deliberately an integration floor, not settlement art. Canonical terrain and
building collision still live in TypeScript; detailed visual/collision projection remains
future work. Do not treat the floor as a second world or add Unreal NPC schedules.

Epic template content is **not redistributed in Git**. It remains governed by the Unreal
Engine license from the user's engine installation. See Epic's Unreal Engine EULA:
https://www.unrealengine.com/eula/unreal. Code uses `ws` (MIT) and existing repo dependencies.

Debug endpoints: `http://127.0.0.1:8787/health`, `/snapshot`, `/scene`.
The first native WebSocket connection controls the Traveler; later connections observe.
This is a local development bridge, not a multiplayer/public server. Every body has its
own ID and owner entity ID; withdrawn bodies are removed independently of identities.
