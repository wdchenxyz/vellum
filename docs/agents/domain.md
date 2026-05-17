# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo.

Before exploring, read:

- `docs/context.md` for project language, current product shape, and implementation focus.
- `docs/decisions/` for lasting architectural or product decisions relevant to the area being changed.
- `docs/architecture/` for current structural notes about app modules and conventions.
- `docs/issues/` for root-cause notes when diagnosing a bug that may have prior history.

If a file or note does not exist, proceed silently. Do not suggest creating new domain docs upfront unless the task is specifically about documenting decisions or resolving terminology.

## Use the project's vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term from `docs/context.md`. Avoid drifting to synonyms when the context doc already establishes a term.

If the concept you need is missing from `docs/context.md`, note the gap only when it affects the task.

## Flag decision conflicts

If your output contradicts a decision note under `docs/decisions/`, surface the conflict explicitly rather than silently overriding it.
