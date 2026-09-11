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
| Hit (0.7 s) | /Game/Characters/Mannequins/Anims/Rifle/HitReact/MM_HitReact_Front_Lgt_01 |
| Collapse (1.1 s) | /Game/Characters/Mannequins/Anims/Death/MM_Death_Front_01 |

Verified Blend Space axes: X=direction, Y=speed in cm/s. Idle samples are Y=0,
walk Y=300, jog Y=600; v0.1 uses forward X=0. Native replay uses loaded clip length.
No skeleton, Animation Blueprint, Blend Space or vendor clip was edited.

The separate GameAnimationSample remains read-only reference. Starts/stops,
pivots, warping, trajectory history and Motion Matching are deferred. No sample-local
movement system or sample asset dependency graph was migrated.
