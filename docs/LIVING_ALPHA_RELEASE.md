# Living Alpha v0.1 — release record

One record for the Living Alpha release: baseline, gates, plan, budgets, blockers and evidence.
Update in place; do not fork planning documents.

## Baseline (established 2026-09-23)

| Item | Observed |
|---|---|
| Integration base | `origin/main` @ `5171eba` (PR #49 merged). The old local `claude/v0.2.2-scale-readiness` had 0 unique commits (all in main), so that branch was restarted from `origin/main`; release work happens on it. |
| Other work preserved | Clones/worktrees under `Documents\ChatGPT\TornVeilOnline*`, `Desktop\projects\torn-veil-online*` untouched. Unpushed local commit `ce76bfa` (codex/integration-playtest-current: Ashford playtest launchers, 1 MiB text limit for authored Ashford) exists only in `TornVeilOnline-playtest`; not merged here. |
| Running services | No Torn Veil bridge/server running. No existing live world. Existing `.debug/*.save.json` files in other clones are developer/test saves and are not touched. |
| Host | Windows 11 Home, Ryzen 5 9600X (6C/12T), 31 GB RAM, RX 6650 XT, C: 208 GB free, D: 311 GB free. AC sleep/hibernate = never (host stays awake on mains). Session user is **not** an administrator. |
| Toolchain | Node 22.23.2 (the PATH `node.exe` already has an inbound-allow firewall rule), UE 5.8 at `C:\Program Files\Epic Games\UE_5.8`, VS 18 Community, Windows SDK 10.0.22621/26100. |
| Network | Tailscale up (`100.86.43.22`, tailnet with Linux/Android/iOS/macOS peers). Wi-Fi is a *Public* profile — the server must never bind 0.0.0.0. |
| Licensed content | Not in git. 3.5 GB Unreal `Content/` present in `Desktop\projects\torn-veil-online` and `TornVeilOnline-playtest` (+ `D:\TornVeilAssetCache`). This worktree has none; the release client build provisions by copy only. |
| Headless startup | `npx tsx src/headless/bridge/playableStartup.ts` → PASS, 71 checks; first snapshot 44 ms, first centre region 3.0 s, max snapshot gap 722 ms. |
| Sim throughput | Regional world seed 918271: 128 persons, generation 3.5 s, 60 Hz stepping at ~20× real time on this host (first 400 physical s). Save 150 ms / 22.9 MB; load 2.9 s; heap 641 MB. |

### Baseline failures against this contract

1. Server is single-player: one `world.playerId`, one controller lease, one command queue, one dialogue,
   snapshots filtered for that one person; additional connections only observe that person's view.
2. Loopback only (`127.0.0.1`), no authentication beyond a header, no accounts, no character creation/selection.
3. Save is one file written with rename (no fsync, no generations, no manifest, no backup, no validated recovery);
   a missing save silently generates a fresh world; nothing fingerprints the seeded generator, so a generator
   change would silently alter a reloaded world.
4. No supervisor, autostart, drain, readiness, bounded logs, release/staging/live separation or update procedure.
5. Unreal client hard-codes `ws://127.0.0.1:<port>`; no packaged build has ever been produced.
6. No supernatural capability; Normal→Iron exists only as a gated reference path.
7. Disconnect policy undefined: the controlled person is never released and would starve while offline.

## Selected release configuration

| Item | Choice |
|---|---|
| World | Regional playable world, seed **918271**: 7 settlements, 127 generated residents, 24.6 km square, roads, rivers, woodland/stone resources, wildlife (hare, roe deer, boar). |
| Destinations | Home settlement + wilderness + a second settlement along the regional road + resource sites (timber/stone/forage/water). |
| Server budget | 60 Hz interaction tick with zero accumulated debt at steady state; snapshot fan-out 10 Hz; save stall ≤ 250 ms per checkpoint; RSS < 2 GB. |
| Client budget | ≥ 30 FPS sustained (target 60) at 1080p on RX 6650 XT in village and combat; p99 frame time recorded. |
| Deployment | This workstation. Live service bound to `127.0.0.1` + Tailscale `100.86.43.22` only; private allowlisted accounts. |
| State location | Outside source trees: `%LOCALAPPDATA%\TornVeilAlpha\<env>\` (state, logs, credentials); backups on second disk `D:\TornVeilAlpha\backups\<env>\`. |

## Work packages (dependency order)

1. **WP1 Live authority service** — multi-person session (per-connection control/dialogue/snapshot/appearance delta),
   accounts + allowlist + character ownership, durable checkpoint store with manifest/fingerprint/generations,
   backups, validated recovery and refusal to silently regenerate, disconnect/uncontrolled-body policy,
   readiness/health/metrics, drain/checkpoint admin on loopback.
2. **WP2 Release & update pipeline** — immutable bundled server releases, dev/staging/live separation,
   supervisor with crash restart and bounded logs, autostart, rehearse-on-copy → drain → capture → fenced cutover
   → verify, migration hook, recovery path.
3. **WP3 Packaged client** — connection/login/character screen, configurable host/credentials, compatibility errors,
   BuildCookRun Win64 package with provisioned licensed content.
4. **WP4 Opportunities & social loop** — player-legible requests/shortages through legitimate knowledge, accept →
   canonical work → conserved payment, commitments journal, two approaches.
5. **WP5 Capability, danger & the supernatural** — distinct creature threat behaviour, smallest coherent
   supernatural mechanic (cost/limit/counterplay, shared by eligible people), two development approaches,
   Normal→Iron through ordinary accelerated simulation.
6. **WP6 Evidence & handoff** — soak, 7-day × 3-seed continuations, contested multiplayer probes,
   persistence/recovery drills, update rehearsal, regression, operator/player guide.

## Acceptance matrix

Status values: PASS (observed, evidence linked), FAIL, UNVERIFIED, BLOCKED (external).

| Gate | Status | Evidence / note |
|---|---|---|
| G1 Packaged entry & visible world | FAIL | No packaged build exists (baseline). |
| G2 45–60 min ordinary session | UNVERIFIED | Requires packaged client + human input. |
| G3 Emergence, 3 episodes, 2 approaches, 3 seeds | UNVERIFIED | |
| G4 Capabilities & advancement | FAIL | No supernatural capability; Iron not reachable in ordinary play yet. |
| G5 Shared-world multiplayer | FAIL | Single-controller server. |
| G6 Persistence & recovery | FAIL | No generations/backup/recovery tooling. |
| G7 Development & update continuity | FAIL | No release/update pipeline. |
| G8 Sustained operation | UNVERIFIED | |
| G9 Regression & integrity | UNVERIFIED | |
| G10 Usable handoff | FAIL | |

## Blockers and external requirements

- Boot-time start before any user logs on needs an administrator to register the provided task
  (the session user is not an administrator). A per-user logon task can be registered without elevation.
- Off-host backup: the only other host visible is the user's NAS media share (`M:`); not written to without
  explicit authorization. Backups on `D:` protect against C: disk loss only.
- A second physical device/network for G5 and the human 45–60 minute session for G2 need the user.

## Next concrete action

Implement WP1: split `BridgeSession` into world session + per-controller sessions, add accounts and the
durable state store, with focused tests.
