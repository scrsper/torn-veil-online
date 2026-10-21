# Preserved combat-driver failure

On unchanged `cac6710`, fresh ordinary play passes the portal round trip,
canonical Tower entry, real manual pickup/study, rank gate, mouse-strike action,
held guard and release, and selection of an actually visible warden. The body
takes canonical damage while fighting; health/progression are not reset.

The automated fighter records misses/interruption and then times out chasing a
moving opponent. Its older target observer can replace its local target with a
new visible body without cycling the actual UI target, while Q continues facing
the UI selection. It also insists on0.7m separation before striking and uses
unarmed attacks despite an ordinary trial dagger being available at entry.
No successful enemy contact or complete gameplay pass is claimed.

The corrected driver uses actual Tab inputs to select the currently observed
target, opens I to pick up/equip the real trial dagger, and approaches within
weapon reach before striking. The required proof remains a new canonical
non-self `hit`/`guarded` contact receipt with an event ID. No enemy position,
health, inventory, simulation time or damage rule is changed. This does not
certify unarmed contact or combat balance.

Raw `.debug/input-gameplay-third/result.json`, images/video and
`input-gameplay-controller-third/controller.json` remain. The owned host saved
the active Tower run and exited0; the failed save is preserved with its actual
remaining health. A new ordinary fixture is used for the next bounded pass.
