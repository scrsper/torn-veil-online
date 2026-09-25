# Checkpoint performance candidate — 2026-09-25

The live alpha.12 world is preserved. Its normal operator backups at generation 572 and 619
were profiled read-only. In 45.1 real minutes the checkpoint changed from 71,036,006 to
71,555,715 bytes; events fell from 59,640 to 59,168, while knowledge rose from 49,776 to
50,312. This is preliminary evidence of a retention plateau, not a completed soak.

Most retained events are direct roots of living knowledge, rather than an unbounded causal
ancestry expansion. About 38 MB is told/perceived events. Removing these indiscriminately
would discard provenance. Existing limits and repeated-introduction fixes therefore remain
in place while the final soak measures convergence.

The smallest encoder correction serializes plain top-level checkpoint fields separately and
large arrays in 512-entry segments. It produces identical JSON bytes and the same schema.
The snapshot remains synchronous; no mutable world escapes to a worker and no cache can go
stale. Unit coverage compares full encoding, including nested arrays, Unicode, omitted values,
nonfinite JSON numbers, sparse-compatible arrays and invalid cyclic/BigInt input. Existing
checkpoint integrity, fallback/recovery and reload tests remain applicable.

On the private Node 26.10.0 runtime (V8 14.6), the actual 71.55 MB world serialized in
206.65 / 204.07 / 220.92 ms in the initial profile. Node 22 remained roughly 371–483 ms.
The candidate runtime is therefore explicit, not a global runtime replacement:
`C:\Users\green\TornVeilAlpha\runtimes\node-v26.10.0-win-x64\node.exe`.
The official archive's SHA256 was checked against Node's published checksums. This runtime
is current but not yet LTS. The existing live runtime has not been changed.

`Install-Autostart.ps1 -NodeRuntime <path>` supports pinning the chosen executable by hash.
Release metadata and service status record the actual Node/V8 runtime. The soak observer also
records process CPU, checkpoint commit/serialization time, RSS, event-loop delay, debt, counts,
and save/event/knowledge growth for each half of the run. It must show a zero-client period
and separately report whether a connected-client period occurred.

The final two-hour soak is still required. Offline profiles do not prove service latency,
convergence, backup behavior or stability with a connected client.
