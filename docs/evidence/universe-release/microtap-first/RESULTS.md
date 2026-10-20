# First integrated short-tap check — timing correction required

Source `f900adf` includes immediate keyboard edges, serialized response-driven
dispatch and preserved cancellation intent. The live request/response trace
confirms that a queued stop is dispatched when the prior response finishes.

Forward and backward taps moved 0.700 m each and passed the unchanged 0.75 m
microtap gate. Diagonal taps moved 1.293 m and 1.321 m and failed it. The checker
waited for a complete two-axis request before starting its 20 ms timer, while
the first key was already held. Actual physical holds were 117 ms and 103 ms;
these are not 20 ms physical taps. The same wait exists in the route driver.

Correct the checker so its key-release clock does not depend on transport
observation. Retain the failure, all request timings and existing spatial bounds;
repeat the microtap and full journey before acceptance. No physics or speed change
is justified by this measurement error.

Zero browser/HTTP errors. Ordinary rendered-town return retained Person `p_5`,
Body `b_5` and all five items. Graceful shutdown wrote checkpoint 1225; exact
read-only restore retains earned 110 XP, Normal stage, John Smith, home discovery
and the original vessel. The checkpoint manifest was unchanged. Raw evidence is
retained locally in `.debug/release-microtap-oct20`.
