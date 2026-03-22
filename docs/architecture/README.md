# Architecture Notes

## App Shape

- `app/page.tsx` renders a single trade-capture workspace.
- `components/trade-extractor.tsx` owns upload, extraction, saved-row restore, and downstream portfolio data loading.
- `components/trades-table.tsx` is the primary verification surface after extraction.
- `components/holdings-table.tsx` and `components/portfolio-weight-chart.tsx` provide secondary portfolio analysis.

## Conventions

- Prefer compact, data-first UI over decorative wrappers.
- Keep the upload-to-review path obvious before showing analysis.
- Use progressive disclosure for secondary detail and advanced comparisons.
