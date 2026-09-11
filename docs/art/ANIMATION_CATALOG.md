# Torn Veil animation catalog

Mesh: /Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.
Skeleton: /Game/Characters/Mannequins/Meshes/SK_Mannequin.

| Presentation | Exact asset |
|---|---|
| Locomotion | /Game/Characters/Mannequins/Anims/Unarmed/BS_Idle_Walk_Run |
| Idle | /Game/Characters/Mannequins/Anims/Unarmed/MM_Idle |
| Walk | /Game/Characters/Mannequins/Anims/Unarmed/Walk/MF_Unarmed_Walk_Fwd |
| Jog | /Game/Characters/Mannequins/Anims/Unarmed/Jog/MF_Unarmed_Jog_Fwd |
| Attack (1.0 s) | /Game/Characters/Mannequins/Anims/Unarmed/Attack/MM_Attack_01 |
| Hit (0.7 s, full pose) | /Game/TornVeil/Characters/Animations/A_TV_HitReact_Front |
| Collapse and prone settle (1.7 s) | /Game/TornVeil/Characters/Animations/A_TV_Downed |

Verified Blend Space axes: X=direction, Y=speed in cm/s. Idle samples are Y=0,
walk Y=300, jog Y=600; v0.1 uses forward X=0. Native replay uses loaded clip length.
No skeleton, Animation Blueprint, Blend Space or vendor clip was edited.

`create_humanoid_combat_animations.py` reproducibly bakes the original local additive
`/Game/Characters/Mannequins/Anims/Rifle/HitReact/MM_HitReact_Front_Lgt_01`
onto MM_Idle for runtime single-node playback. The original death source
`/Game/Characters/Mannequins/Anims/Death/MM_Death_Front_01` is a 1.1-second
pre-ragdoll lead-in. The owned derivative removes root drift and adds a 0.6-second
keyframed prone settle. It moves presentation bones only, without local physics.
Terminal component-space pelvis/head heights are 21.27/11.79 cm. These adaptations
keep the existing skeleton and save only Torn Veil-owned packages.

The separate GameAnimationSample remains read-only reference. Starts/stops,
pivots, warping, trajectory history and Motion Matching are deferred. No sample-local
movement system or sample asset dependency graph was migrated.
