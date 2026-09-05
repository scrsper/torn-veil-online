# Continuous Integration (v0.8 §18)

`.github/workflows/pr.yml` runs on every pull request targeting `main`: `npm ci`, `npm run
typecheck`, `npm test`, `npm run build`, `npm run world:smoke`. It deliberately does not run
`npm run world:check`/`world:soak` (multi-seed/multi-day WorldLab validation) — those are meant
to be run explicitly before a milestone PR is considered ready, not on every push (§18: "do not
run expensive 30/90-day soak validation on every PR").

**This workflow reports status; it does not by itself block a merge.** Making it actually gate
merges requires a one-time, manual repository setting that only a repo admin can make (a GitHub
Actions workflow file cannot enable this on its own):

1. Go to the repository's **Settings → Branches**.
2. Under **Branch protection rules**, add (or edit) a rule for `main`.
3. Enable **"Require status checks to pass before merging"**.
4. Search for and select the check named **`gate`** (the job name in `pr.yml`) — it will only
   appear in the list after the workflow has run at least once on some branch/PR.
5. Save the rule.

Until that manual step is done, `pr.yml`'s result is visible on every PR (and via the commit
status API) but a PR can still be merged with it failing. This is the "precise permission/
configuration blocker" §18 asks to be documented rather than silently skipped or worked around.

## What is NOT covered by CI yet

The Playwright browser functional harness (`npm run test:browser`, §10) is not part of `pr.yml`.
It currently launches Chromium from a fixed path (`PLAYWRIGHT_CHROMIUM_PATH`, default
`/opt/pw-browsers/chromium`) that exists in this project's development sandbox but not on a
stock GitHub Actions runner, which would need an explicit `npx playwright install --with-deps
chromium` step (and the accompanying wall-clock/download cost on every PR) to work at all. Wiring
that up is a reasonable follow-up, not attempted here to avoid adding a CI step that would only
ever fail on a fresh runner.
