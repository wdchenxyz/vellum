# Architecture Notes

## App Shape

- `app/page.tsx` renders a single trade-capture workspace.
- `components/trade-extractor.tsx` owns upload, extraction, saved-row restore, and downstream portfolio data loading.
- `components/trades-table.tsx` is the primary verification surface after extraction.
- `components/holdings-table.tsx` and `components/portfolio-weight-chart.tsx` provide secondary portfolio analysis.
- Stored trade rows may include optional `account` metadata; holdings aggregation uses it to keep same-ticker positions separated by account.
- Reviewed trades can be saved in one atomic batch with `POST /api/trades/rows`. The request requires a stable `requestId` plus one or more trades; retrying the same request is idempotent, while reusing the ID with different trades returns a conflict.
- Final holdings can be read with `GET /api/portfolio/holdings`; the route shares aggregation, Previous Close, FX, filtering, and valuation logic with the Portfolio Assistant.
- Quote lookups are cached on disk in `data/quote-cache.json` so refreshing the page reuses recent previous-close and FX snapshots instead of repeatedly calling upstream APIs.
- The weight chart is view-driven: it can show all holdings merged across accounts, a single account sleeve, or a market slice, while the detailed tables remain account-grouped.

## Conventions

- Prefer compact, data-first UI over decorative wrappers.
- Keep the upload-to-review path obvious before showing analysis.
- Use progressive disclosure for secondary detail and advanced comparisons.

## Saving Reviewed Trades

```json
{
  "requestId": "broker-confirmation-2026-06-20",
  "trades": [
    {
      "account": "Firstrade",
      "currency": "USD",
      "date": "2026-06-16",
      "fee": null,
      "price": 541.15,
      "quantity": 12,
      "settlementAmount": null,
      "side": "SELL",
      "sourceFile": "IMG_3297.png",
      "ticker": "AMD"
    }
  ]
}
```

`fee` and `settlementAmount` are optional. When `settlementAmount` is absent, Vellum calculates the Saved Trade total from price, quantity, side, and fee. A new batch returns `201`; an idempotent replay returns `200`; conflicting reuse of `requestId` returns `409`.

## Reading Current Holdings

`GET /api/portfolio/holdings` returns final open holdings grouped by brokerage account, including quantity, average cost, Previous Close, market value, Weight, and Unrealized P&L. Optional query parameters are `account`, `ticker`, and `forceRefresh=true|false`.
