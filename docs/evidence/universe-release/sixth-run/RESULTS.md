# Integrated release attempt 6 — complete travel, two failed checks

Clean `27cc37c`, production input source `f900adf`. The full ordinary route passed
46 checks: physical paving/step/slope/departure, personal ascent, moving flight,
Vesperspire 3 landing/reload, home landing and ordinary rendered-town return.
Identity, five carried items, both discoveries and the original parked vessel
were preserved. Clear departure was 0.431 m from the required point, inside the
unchanged 1 m gate. Step-up passed at 0.471 m, inside the unchanged 0.65 m gate.

The run **failed overall**:

- One GET `/realms/universe` returned 503. Its body could not be captured across
  reload, so the existing strict classifier could not prove the save-busy reason.
  A later successful GET is recorded, but that alone does not classify the error.
- The automatic horizon check measured maximum frame excess 0.005812 radians,
  exceeding the retained 0.003-radian allowance above 90 degrees/second. Preserve
  the complete trace and identify clock/sampling versus camera behavior before
  correcting it. No relaxation of the cap is authorized by this evidence.

Root visually inspected moving ascent, moving side/front space flight and foreign
ground. The full character is legible and clear of the controls. Space contrast
remains weak; the foreign arrival terrain is dark and sparse. These are bounded
prototype observations, not a visual-polish or content-completeness claim.

Contact hard findings were empty. Missing stable left slope and returned-flat
right contact windows and clipped slope-front foot framing remain explicit
coverage limits. The short-tap 0.75 m precision target from the preceding run also
remains failed; this successful route does not erase that latency measurement.

Graceful host stop wrote checkpoint 16575. Exact read-only restore preserved
110 earned XP, Normal stage, current John Smith, inactive town residency, both
discoveries and the vessel; manifest unchanged. No save edit. Raw images, motion
and sole traces remain in `.debug/release-journey-oct20-v6`.
