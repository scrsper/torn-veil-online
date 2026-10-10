# Environment audit

Reference milestone update, 2026-10-04: reused Blender 5.2.2 LTS and MPFB 2.0.17. No software installation or OS changes. Acquired the official MakeHuman system assets CC0 archive (280,737,770 bytes), extracted 517 entries after path/symlink and CRC checks. Exact archive/file hashes are in the provenance registry and `makehuman-files.json`. Original user images were read only; reference copies are byte-identical.

Audited 2026-10-03/04 during bootstrap before dependency installation. Workspace resolved from `Join-Path $env:USERPROFILE 'Desktop/projects/ontology'`. Machine paths are discovered at runtime, not embedded in project configuration.

| Tool | Detected / action |
|---|---|
| Blender | Existing **5.2.2 LTS**, build `d13f752e3b9c`, 2026-09-15, under `%ProgramFiles%/Blender Foundation/Blender 5.2`; reused |
| MPFB | Existing **2.0.17**, Blender extension under `%APPDATA%/Blender Foundation/Blender/5.2/extensions/blender_org/mpfb`; reused |
| Node | Existing **22.23.2**, user-local Hermes distribution; reused |
| npm | Existing **10.9.8**; reused |
| Git | Existing **2.55.0.windows.3**; reused, initialized this repository |
| PowerShell | Existing **7.6.5** via bundled Codex runtime |
| Python | Bundled runtime **3.12.14**; Windows `python.exe` PATH entry was a Store alias |
| Blender Python | **3.13.13**, used for all Blender processing |
| Browser | Existing cached Playwright Chromium installations; reused by Playwright **1.62.1**, no browser download |
| Other art tooling | Blackmagic Design, Epic Games and Unity Hub directories detected; not modified or needed |
| Existing art | Sibling Blender projects found; no imported content reused without established provenance |
| Existing Quaternius files | None found in the targeted Downloads / sibling art-workspace audit |
| Torn Veil | Read-only package audit found TypeScript, Vite, Babylon core/loaders **9.28.0**, Playwright, appearance/foundry tools. No files modified |

Only project npm dependencies were installed. No global software, paid products, machine settings, OS security changes or duplicate Blender installation. See `package-lock.json` for exact transitive versions. Babylon core/loaders are pinned to 9.28.0 to match the active Torn Veil project. Runtime schemas use Zod 3.25.76; TypeScript 5.9.3, Vite 7.1.12, Vitest 3.2.4, tsx 4.20.6, Khronos glTF validator 2.0.0-dev.3.10 support development.

`npm run blender:probe` writes `generated/validation/environment-probe.json`. The probe enabled MPFB and generated the bundled 19,158-vertex base human in an ephemeral process. It did not save user preferences or publish generated geometry. MPFB requires `default_set=True` while enabling so its preference lookup exists; this affects the process only because preferences are not saved.

The initial npm peer mismatch was resolved by selecting Node 22 typings compatible with Vite. No `--force` or peer-dependency bypass was used.

`BLENDER_PATH` can override auto-detection. Background Chromium acceptance used WebGL fallback. The visible in-app browser successfully rendered Human, Imp and the processed GLB with WebGPU after explicit shader registration and unused-UV cleanup. Both backend paths were actually exercised.
