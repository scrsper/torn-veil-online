# Ashford visual projection performance

Measured during the v0.5 visual pass in Unreal Editor 5.8 on 2026-09-08.

| Projection mode | Total actors | Static-mesh actors | HISM batch actors | Lights |
| --- | ---: | ---: | ---: | ---: |
| Independent visual actors | 7,115 | 7,070 | 0 | 30 |
| Batched visual projection | 123 | 55 | 23 | 30 |

The batched generator placed 9,319 deterministic visual instances across 23 HISM groups. The
generated `Ashford.umap` decreased from about 10.6 MB to about 1.6 MB.

An editor frame-counter sample was attempted for both modes. Both returned approximately 3 FPS
(31 frames in about 10.3 seconds) while Unreal was launched hidden and out of focus. Disabling
`t.IdleWhenNotForeground` did not change the result, so that number is background/editor throttle,
not a reproducible gameplay frame-time measurement. It must not be presented as client FPS.

The actor counts are repeatable and show that repeated roof courses, rafters, plinth blocks,
vegetation, and props no longer create thousands of independent actors. A foreground packaged or
PIE profiling run remains necessary for a trustworthy millisecond frame-time comparison.
