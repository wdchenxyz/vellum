# Effective Exposure For Portfolio Donuts

## Initial Request

- Achieve correct effective exposure for donut charts in the portfolio section.
- Some records may involve leveraged tickers, such as `TSLL` for 2x `TSLA` or `GGLL` for 2x `GOOGL`.
- Decide whether a new LLM extraction schema field is needed.
- Check whether Twelve Data can provide effective exposure by ticker lookup.

## Current State

- Confirmation extraction records transaction facts only: date, ticker, quantity, price, currency, fee, and side.
- Stored trade rows include account, source file, generated id, and computed total amount.
- The current portfolio donut already applies a small hardcoded leveraged ticker map in `lib/portfolio/current-snapshot.ts`.
- Unknown leveraged products currently default to `1x`, which understates effective exposure.
- The donut uses effective value for slice size, but the headline still shows raw portfolio value.

## Current Data Flow

- `components/trade-extractor.tsx` loads saved rows from `/api/trades/rows`.
- `app/api/trades/rows/route.ts` reads rows from SQLite through `readStoredTradeRows`.
- `lib/trades/storage.ts` reads the `transactions` table and returns normalized trade rows.
- `components/portfolio-snapshot.tsx` runs `aggregateHoldings(rows)`.
- `lib/portfolio/holdings.ts` turns trade rows into open holdings by account, ticker, and market.
- `components/portfolio-snapshot.tsx` fetches previous close quotes and USD/TWD FX when needed.
- `lib/portfolio/current-snapshot.ts` converts market value to USD, applies `EXPOSURE_MULTIPLIERS`, then calculates weight as `effectiveValueUsd / effectiveTotalUsd`.
- `components/portfolio-snapshot.tsx` renders the donut from `effectiveValueUsd` and `weight`.

## Twelve Data Findings

- The existing quote integration in `lib/quotes/twelve-data.ts` only resolves instruments and previous close prices.
- The Twelve Data Node client exposes ETF endpoints such as `/etfs/list`, `/etfs/world`, `/etfs/world/summary`, `/etfs/world/composition`, `/etfs/world/performance`, and `/etfs/world/risk`.
- The documented ETF list and summary models expose fields such as symbol, name, fund family, fund type, currency, NAV, last price, net assets, and overview.
- The documented ETF top holdings model exposes symbol, name, exchange, MIC code, and weight.
- There is no documented structured field for underlying ticker, leverage multiplier, inverse direction, or effective exposure multiplier.
- ETF composition can be useful supporting evidence, but it should not be treated as the source of truth for leveraged ETF exposure because leveraged products often use swaps, derivatives, cash, or Treasuries.

External reference: https://github.com/twelvedata/twelvedata-node

## Possible Approaches

### 1. Keep The Hardcoded Map

- Maintain the existing `EXPOSURE_MULTIPLIERS` map in code.
- Lowest implementation cost.
- Poor long-term maintainability because missed tickers silently become `1x`.
- No place to store underlying ticker, inverse direction, metadata source, or review status.

### 2. Dedicated Local Metadata Module

- Move leveraged product metadata into a dedicated local module, for example `lib/portfolio/instruments.ts`.
- Track fields such as ticker, underlying ticker, multiplier, direction, label, and source.
- Still code-managed, but cleaner than embedding it in snapshot calculation.
- Good near-term improvement if the list is small and manually curated.

### 3. SQLite-Backed Instrument Metadata

- Add an `instrument_metadata` or `instrument_exposure_profiles` table.
- Store ticker-level metadata separately from trade rows.
- Suggested fields:
  - `market`
  - `ticker`
  - `instrument_name`
  - `exposure_underlying`
  - `exposure_multiplier`
  - `exposure_direction`
  - `source`
  - `review_status`
  - `updated_at`
- This supports manual overrides, user review, future enrichment, and durable metadata without changing historical trade records.

### 4. Twelve Data Assisted Lookup

- Use Twelve Data ETF endpoints to fetch ETF name, fund family, fund type, overview, and composition.
- Use that metadata to detect likely leveraged products and propose a profile.
- Treat Twelve Data as a metadata source, not a direct effective exposure oracle.
- Require a local reviewed profile before applying non-`1x` exposure.

### 5. LLM Assisted Classification

- Use an LLM to classify instrument metadata from ETF name, overview, and possibly provider text.
- Example classification: `TSLL` means long `TSLA` at `2x`.
- This can reduce manual work, but should be review-required because over- or under-stating exposure is a portfolio correctness issue.
- Do not populate leverage directly during confirmation extraction.

### 6. Add `securityName` To Extraction

- Optionally ask the confirmation extractor to capture a visible security name if present.
- This can provide useful evidence, such as `Direxion Daily TSLA Bull 2X Shares`.
- It should not become the source of truth for exposure multiplier.
- This is useful only if confirmations reliably include the product name.

## Recommendation

- Do not add an LLM-extracted `exposureMultiplier` field to trade rows.
- Keep trade extraction focused on transaction facts.
- Add a separate instrument metadata layer for exposure profiles.
- Start with a local metadata module or SQLite table, depending on how soon manual review/editing is needed.
- Use Twelve Data as enrichment input for discovering ETF names and descriptions.
- Apply non-`1x` exposure only when an instrument profile is reviewed or explicitly trusted.

## Proposed Implementation Plan

- [ ] Move the current `EXPOSURE_MULTIPLIERS` map out of `lib/portfolio/current-snapshot.ts`.
- [ ] Introduce an exposure profile model that can represent:
  - direct holdings at `1x`
  - long leveraged products such as `TSLL -> TSLA, +2x`
  - inverse products such as `SQQQ -> QQQ, -3x`
  - products where exposure is unknown or review is needed
- [ ] Update `buildCurrentPortfolioSnapshot` to consume exposure profiles instead of a local hardcoded multiplier map.
- [ ] Decide chart behavior:
  - capital allocation by held ticker
  - effective exposure by held ticker
  - grouped effective exposure by underlying ticker
- [ ] Update donut labels and tooltip copy so effective exposure is not mislabeled as actual market value.
- [ ] Add tests for:
  - unknown leveraged ticker defaults to `1x`
  - known 2x long product changes effective weight
  - inverse product can produce negative or separate short exposure behavior
  - direct and leveraged exposure to the same underlying can be grouped when selected
- [ ] Optionally add a Twelve Data enrichment path for ETF metadata lookup.
- [ ] Optionally add a review UI for unresolved leveraged products.

## Open Questions

- Should the default donut show capital allocation, effective exposure, or let users toggle?
- Should inverse exposure appear as negative weight, a separate short bucket, or an absolute exposure bucket?
- Should direct and leveraged positions be merged by underlying in the default chart?
- Should metadata be code-managed for the MVP, or persisted in SQLite from the start?
- What confidence threshold is required before applying a non-`1x` inferred multiplier?

## Non-Goals

- Do not change confirmation extraction to guess leverage.
- Do not mutate existing trade records to add instrument classification.
- Do not rely on ETF composition alone to infer leveraged exposure.
- Do not silently apply LLM-inferred exposure without a trusted or reviewed metadata record.
