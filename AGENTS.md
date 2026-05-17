# Repository Instructions

## Git Workflow

1. Branch per task - Always create a new branch for each feature or bug fix.
2. Atomic commits - Use clear, descriptive commit messages that explain the why, not just the what. Keep commits in reasonable chunks; avoid large commits with unrelated changes.
3. Pull request - When ready to merge, create a PR with a clear description of the changes, rationale, and relevant context.
4. Squash merge + delete branch - Merge the PR with squash and delete the branch afterward to keep the commit history clean.
5. Update the main branch after merging - Always pull the latest changes to the main branch after merging to ensure your local copy is up to date.
6. When the user says "good to ship!", do the above steps to merge the feature branch into main.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `wdchenxyz/vellum`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock skill triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read `docs/context.md`, then relevant notes under `docs/decisions/` and `docs/architecture/`. See `docs/agents/domain.md`.
