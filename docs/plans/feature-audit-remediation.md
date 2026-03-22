# Audit Remediation

## Goal

- Resolve the highest-value issues from the UI audit.
- Ship fixes in small commits by priority.
- Keep docs aligned with the remediated state.

## Steps

- [x] Checkpoint current design context and UI plans
- [x] Immediate: fix CTA naming, note-field labeling, success-state contrast
- [x] Short-term: improve touch targets, attachment removal, theme hotkey behavior
- [x] Medium-term: adapt mobile review, tokenized surfaces, reduce client-only rendering
- [x] Long-term: simplify nested analysis UI, expose prompt styling API, cap chart growth
- [x] Verify with typecheck, lint, test, and build

## Commit Sequence

- `ea9605f` `docs: capture design context and UI plans`
- `5c33ccd` `fix: harden trade input accessibility`
- `1783c27` `fix: improve touch targets and remove hidden hotkey`
- `eff5d6e` `fix: adapt mobile review and tokenized surfaces`
- `238f75a` `refactor: simplify analysis UI and prompt styling`

## Notes

- `PromptInput` now exposes `inputGroupClassName`, removing page-level dependence on internal slot selectors.
- Trade and holdings review now switch to stacked card summaries on small screens instead of forcing horizontal panning.
- Portfolio analysis keeps one disclosure level; the weight chart stays inline once analysis is opened.

## Follow-up

- Consider adding a visible theme toggle if manual theme override becomes a product requirement.
- Consider virtualizing or summarizing very large holding sets if portfolios grow beyond the current chart cap.
