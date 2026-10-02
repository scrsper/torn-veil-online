# Orbit combat control pass

This local branch starts at `50c8b0db1629be68348a5876deff8f382d1b0db8`, preserving the character-foundations checkout. It improves the existing Babylon scene and disposable launcher. No simulation mechanics, character assets, retained saves, Unreal files or original ZIPs change.

## Launch and controls

From this separate worktree, double-click `Play Torn Veil Camera Combat.cmd`, or run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/web/Play-CameraCombat.ps1`. It serves this worktree's `.debug/orbit/visual-bundle` and opens the same disposable canonical tavern courtyard. Close Chrome or use Ctrl+C to stop it. The main Desktop character checkout still launches its own earlier bundle until these local changes are explicitly integrated.

WASD moves relative to camera; Shift sprints; middle-button drag orbits/tilts; wheel zooms. F toggles lock, T cycles candidates, H/left-click attacks, G makes a heavy strike, B/right-click guards, Space dodges in the current movement direction. Neutral Space remains a canonical backstep relative to body facing. E interacts, Tab opens abilities, Escape opens/closes menus. Timing and input-buffer windows remain canonical: an overly early follow-up can still be rejected; there is no client auto-combo or hidden retry.

## Concrete repairs

- Projected target death, disappearance or distance beyond 26 metres releases lock even during menus/dialogue; cycling an empty candidate list releases it too. Acquisition retains the existing full-direction elevated-view behavior and now uses the correct fixed-isometric movement basis for directional scoring.
- A failed dodge send no longer consumes its local duplicate-press debounce. Headless regressions exercise diagonal normalized movement-relative directions at four camera headings and neutral backstep.
- Gamepad disconnect releases controller buttons while keeping held keyboard keys intact. Focus loss clears latched guard/focus/sprint/crouch and stale zoom/look. Releasing an attack button does not prematurely terminate a simultaneously held middle-button orbit drag.
- High-rate canonical local combat state replaces stale own-body action presentation. A queued follow-up cannot restart the current strike pose before it actually starts; interrupted actions cease posing. Commands still go directly to the existing server buffer, and rejected commands retain the existing anticipation cancellation path.
- Camera collision pulls inward immediately and now genuinely eases outward after clearing an obstruction, retaining actual collision distance between frames.
- Existing reversible roof/upper-wall cutaways also inspect the locked fighter, rather than only the player. Canonical movement collision, walls and doors remain unchanged. Vegetation retains existing obstruction behavior; this is not a general all-geometry fade system.

## Validation and limits

Focused input/camera/control regressions plus existing canonical realtime-combat-action tests: 46 tests passed across four files, combining the initial aggregate run's 35 unchanged passing tests with the corrected final 11-test combat-feel run. The first new focus-loss fixture failed because it set a public guard flag without the corresponding sent-guard state; the fixture was corrected and the complete new file passed. Typecheck passed. Private Vite build and launcher prerequisite check passed. No full simulation suite was run.

After parent confirmed TRELLIS idle, the bounded real Chrome run passed all 24 checks with no page errors or inference requests. It verified ordinary-input lock release/reacquisition, normalized camera-relative directional dodge, canonical melee damage (80 to 75.71354), actual keyboard interior traversal/exit/reentry, player and locked-target visibility, and six camera-switch round trips with 1009 meshes/135 materials unchanged. The owned browser and services were closed afterward so inference can resume. Evidence and a short playthrough are in `docs/evidence/orbit-combat-feel`. Validation uses the existing disclosed disposable dialogue/doorway/combat fixtures; it is not human acceptance or a character-reference showcase. Other building layouts, foliage occlusion, long sessions and actual controller hardware remain unverified.

Characters still use the existing prototype kit. Character fidelity and any future TRELLIS output's topology, material, rig and deformation quality are separate gates. This pass does not integrate the rejected MPFB hero or claim reference-quality characters. No push, merge, deployment or public hosting occurred.
