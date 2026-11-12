# Maestro browser verification — 22 October 2026, 15:13–15:19 CT

Actual execution, not worker self-report:
- Required real-asset suite: 32 tests across 7 files passed; no skipped tests. Foundation build completed with source identity `ac29fb8d64c7ac25caa72fb1b2b40651c94669af612748329454659801116b5f` (includes typecheck).
- Fresh headed Chrome run: `browser-2026-10-22T20-16-56-575Z/results.json`.
- Same-save host restart: `browser-2026-10-22T20-18-35-104Z/results.json`.
- Both runs loaded actual studio female player and eligible male/female NPCs through shared adapter, no missing required bones and no fallback. Actual ordinary movement passed. Guard projection true while held, false after release. Attack requested, not proof of contact/damage.
- Browser reload identity passed. Separately gracefully stopped first host (exit0), relaunched SAME save with `--continue` and unchanged build/runtime. Programmatic comparison of final pre-stop browser snapshot vs first resumed snapshot: exact Person object (including projected inventory), Body ID, HP and position equal; actual studio base still loaded. No old save editing/migration. This is not a deep full-journal equivalence audit.
- Strict capture exit is STILL FAILURE: optional `arena/mixamo_clips.glb` and `arena/unarmed_clips.glb` return404 (and ERR_ABORTED). Both runs retain unmodified errors and failed no-browser-errors assertion. No shader/page exceptions beyond these missing resource requests were recorded.
- Screenshots exist for player/NPCs, ordinary walk, guard/release, attack request and orbit. Independent pixel review is pending. Do not equate loaded diagnostics or screenshots with accepted material/rig quality.
- Owned resumed host received graceful shutdown; no forced termination. No commit/push.

Remaining: inspect actual screenshots and correct visual defects; prevent optional unavailable animation requests without weakening error assertions; distinct elf artwork/race population and broad creator customization not implemented. Town door/combat/disengage gameplay gates remain separate unfinished work.
