# Continuous Integration

`.github/workflows/pr.yml` runs on every pull request targeting `main`: `npm ci`, `npm run
typecheck`, `npm test`, `npm run build`.

This is a deliberately minimal bootstrap. It does not run `npm run world:smoke` (or any
WorldLab/multi-seed validation) — that harness does not exist on `main` yet; it currently lives
on a separate, still-in-review PR. **Add a `world:smoke` (or equivalent) step to this gate once
that harness lands on `main` or is separately approved** — do not backport WorldLab/simulation/
rendering/gameplay code into this workflow just to run it sooner.

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
status API) but a PR can still be merged with it failing. This is the precise permission/
configuration step required after merge — documented here rather than silently skipped.

## What is NOT covered by this workflow

- **WorldLab / `world:smoke`**: see above — not on `main` yet.
- **The Playwright browser functional harness** (if/when one exists): expect it to need an
  explicit `npx playwright install --with-deps chromium` step (plus the associated wall-clock/
  download cost on every PR) to run on a fresh GitHub Actions runner, unlike a development
  sandbox that may have a browser pre-installed at a fixed path.
