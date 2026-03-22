# Architecture Notes

## App Shape

- `app/page.tsx` renders a single trade-capture workspace.
- `components/trade-extractor.tsx` owns upload, extraction, saved-row restore, and downstream portfolio data loading.
- `components/trades-table.tsx` is the primary verification surface after extraction.
- `components/holdings-table.tsx` and `components/portfolio-weight-chart.tsx` provide secondary portfolio analysis.
- Stored trade rows may include optional `account` metadata; holdings aggregation uses it to keep same-ticker positions separated by account.
- Quote lookups are cached on disk in `data/quote-cache.json` so refreshing the page reuses recent previous-close and FX snapshots instead of repeatedly calling upstream APIs.
- The weight chart is view-driven: it can show all holdings merged across accounts, a single account sleeve, or a market slice, while the detailed tables remain account-grouped.

## Conventions

- Prefer compact, data-first UI over decorative wrappers.
- Keep the upload-to-review path obvious before showing analysis.
- Use progressive disclosure for secondary detail and advanced comparisons.
