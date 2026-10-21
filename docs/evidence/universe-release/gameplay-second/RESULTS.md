# Preserved Tower checker mismatch

Current implementation `cac6710` passes the previously failing portal round trip
after reload: the welcome is dismissed within the playing tab, and E works.
The fresh unendowed character enters the canonical Tower with the same person,
body and Normal rank; the imported shared character renders.

The older smoke checker then waits for Take Ember field manual without opening
the current I inventory panel. The canonical item and take interaction are both
present one metre from the player; the panel is intentionally closed to protect
the playfield. This is a checker mismatch, not a missing-item gameplay failure.
The next pass opens I for pickup/study/save/return, closes it before combat and
uses the rendered movement basis for ordinary route keys. Reload tests must
observe a real held guard before reloading, not pass with guard already false.

Raw `.debug/input-gameplay-second/result.json`, screenshots/video and
`input-gameplay-controller-second/controller.json` remain. The owned host saved
the live Tower run and exited0; its original JSON import and the failed save are
retained. No town return or complete combat pass is claimed for this attempt.
Its host log has no unused development-socket port error. The separate owned
same-save traversal restart also passes20 checks on `cac6710`, final read-only
checkpoint19680; the original7533 restart remains unresolved.
