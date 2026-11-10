# Torn Veil working instructions

The user-designated working repository is
`C:\Users\green\Desktop\projects\torn-veil-online`.
Perform all Torn Veil code, documentation, configuration and asset edits there.
GitHub `scrsper/torn-veil-online` / `main` is the integrated source baseline.

Godot is replacing Babylon.js as the game client (owner direction, 2026-11-10). The
Godot project is on the owner's machine only and is not in this repository yet; ask
for its location before doing client work. Babylon.js (`src/web/`) is the client
currently in this tree, over the TypeScript simulation (`src/sim/`). Do not delete or
rework the Babylon client, or assume how Godot connects to the simulation, without
an explicit instruction. Start from `README.md`, `.ai/REPO_MAP.md`,
`.ai/TESTING.md` and `docs/CURRENT_STATE.md`.

Unreal is archived and no longer in this tree; see `docs/UNREAL_ARCHIVE.md` for
recovery. The former `AGENTS.md` was removed on 2026-10-11; references to it in
older documents and comments are historical.

Documents/release/archived checkouts are reference and recovery copies. A different
editing location requires an explicit user instruction.
