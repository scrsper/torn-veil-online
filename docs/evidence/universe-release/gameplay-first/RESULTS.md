# Preserved fresh-character gameplay failure

The ordinary unendowed seed918271 character on `956e837` passed walking,
resident rendering, portal cancellation/crossing and identity/rank/inventory
reload checks. After reload, clicking Walk to portal moved the body to the real
portal, but the welcome screen still captured E. The bounded checker timed out
waiting for the actual portal confirmation; no input or save injection occurred.
The failure screenshot confirms the visible welcome overlay. The host remained
healthy; its owned controller checkpointed and closed it normally (exit0).

The fix remembers welcome dismissal in session storage for the playing tab and
releases welcome ownership on explicit travel/journal actions and direct Tower
launch. Storage-denied fallback stays dismissible. Other views without the
optional town session key retain their existing welcome behavior.

The host also logged an unused Vite development-WebSocket port collision while
the independent game-control socket worked. Embedded Vite now explicitly
disables that unused socket as well as HMR; the canonical game socket remains.
Fresh boot/reload/gameplay and owned same-save restart must verify the changes.

Raw `.debug/input-gameplay-first/result.json`, `failure.png`, video and
`input-gameplay-controller-first/controller.json` remain in the isolated input
checkout. Failed save is retained at the portal; the original7533 save was not
involved. NPC conversation is not implemented by the current town E handler;
door/portal/source and combat tests must not be described as dialogue coverage.
