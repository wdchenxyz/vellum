# Context

## Project

- Vellum is a local-first investment workspace centered on trade capture, portfolio review, and lightweight portfolio intelligence.
- The primary ingest flow turns broker screenshots and PDFs into structured BUY and SELL rows.
- Saved trades drive holdings, portfolio value history, benchmark comparisons, exposure views, and the built-in portfolio assistant.
- Stack: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Recharts, AI SDK 6, Vitest.

## Language

**Investment Workspace**:
A local-first product surface for trade capture, portfolio review, and lightweight portfolio intelligence.
_Avoid_: Portfolio tracker, trade-capture app, dashboard

**Local-first**:
Vellum stores portfolio data on the user's device rather than in a hosted account system.
_Avoid_: Offline-first, private cloud, no backend

**Trade**:
A single executed BUY or SELL event from a broker confirmation.
_Avoid_: Transaction, order, row

**Proposed Trade**:
A trade produced by extraction before the user has accepted or discarded it.
_Avoid_: Draft row, parsed transaction

**Saved Trade**:
A trade that contributes to trade history, holdings, portfolio value, and Portfolio Assistant answers.
_Avoid_: Row, record

**Brokerage Account**:
A user-defined destination label for grouping trades and holdings by broker or account sleeve.
_Avoid_: Account, portfolio, wallet

**Holding**:
The currently open quantity of one instrument within one brokerage account, derived from saved trades.
_Avoid_: Position

**Portfolio**:
The aggregate investment view derived from all saved trades across all brokerage accounts.
_Avoid_: Account, workspace, dashboard

**Trade Confirmation**:
A broker-provided screenshot or PDF that contains one or more executed trades to extract.
_Avoid_: File, attachment, upload, receipt

**Trade Capture**:
The workflow that turns trade confirmations into reviewed, saved trades.
_Avoid_: Ingest

**Extraction**:
The AI parsing step that proposes trades from a trade confirmation.
_Avoid_: Capture, import

**Portfolio Value**:
The current market value of all open holdings in the portfolio.
_Avoid_: Asset value, net worth, balance

**Reporting Currency**:
The currency used to present combined portfolio values across markets; Vellum defaults to TWD unless a specific view says otherwise.
_Avoid_: Base currency, display currency, normalized currency

**Benchmark**:
A market index comparison series adjusted to the portfolio's trade cash flows.
_Avoid_: Index, market, baseline

**Exposure**:
The effective underlying market value of a holding after applying leverage or inverse direction.
_Avoid_: Weight, allocation, market value

Inverse exposure is tracked as exposure, but excluded from long-only exposure views.

**Exposure Profile**:
Metadata that maps an instrument to its underlying exposure ticker, direction, and multiplier.
_Avoid_: Instrument profile, leverage profile, mapping

**Portfolio Snapshot**:
A point-in-time summary of current holdings, portfolio value, and exposure.
_Avoid_: Snapshot, dashboard, report

**Weight**:
A holding's share of portfolio value before applying exposure profiles.
_Avoid_: Allocation

**Exposure Weight**:
An exposure group's share of total long exposure after applying exposure profiles.
_Avoid_: Weight, allocation

**Instrument**:
A tradable security represented in a trade or holding.
_Avoid_: Asset, stock

**Ticker**:
The market symbol Vellum uses to identify and quote an instrument.
_Avoid_: Symbol, code

**Market**:
The listing market Vellum uses to route quotes and infer native currency.
_Avoid_: Exchange, region, country

**Previous Close**:
The latest available closing price used to value current holdings.
_Avoid_: Live price, current price, quote

**Market Data**:
External price, FX, and benchmark inputs used to value holdings and compare portfolio performance.
_Avoid_: Quote data, news, trends

**Market Context**:
External news, trends, and prediction market signals used to explain or investigate portfolio-relevant events.
_Avoid_: Market data, research, sentiment

**Unrealized P&L**:
The difference between a holding's previous-close market value and its open cost basis.
_Avoid_: Gain, profit, return

**Cost Basis**:
The remaining acquisition cost attached to an open holding.
_Avoid_: Investment amount, principal, total cost

**Trade History**:
The saved record of all reviewed trades, including trades that no longer contribute to open holdings.
_Avoid_: Ledger, activity, transactions

**Portfolio Assistant**:
The built-in assistant that answers questions about Vellum, trade history, holdings, portfolio value, exposure, benchmarks, FX, and market context.
_Avoid_: Chatbot, chat drawer, AI assistant

## Flagged Ambiguities

- Current implementation saves extracted trades immediately; intended language distinguishes **Proposed Trade** from **Saved Trade** so a future review-before-save flow has clear terms.
- Cash balance is out of scope for now; **Portfolio Value** includes open holdings only and excludes uninvested cash or proceeds from sells.

## Relationships

- A **Trade Confirmation** produces zero or more **Proposed Trades** through **Extraction**.
- A **Proposed Trade** becomes a **Saved Trade** when accepted into **Trade History**.
- **Trade History** contains all **Saved Trades**, including trades that no longer contribute to open holdings.
- A **Holding** is derived from saved BUY and SELL trades for one **Instrument** in one **Brokerage Account**.
- A **Portfolio** aggregates holdings across all brokerage accounts.
- **Portfolio Value** is calculated from open holdings using **Previous Close** and **Reporting Currency**.
- **Unrealized P&L** compares a holding's previous-close market value against its **Cost Basis**.
- **Market Data** supplies previous close, FX, price history, and benchmark inputs.
- A **Benchmark** compares portfolio performance after adjusting for the portfolio's trade cash flows.
- An **Exposure Profile** maps an instrument to underlying exposure; **Exposure** and **Exposure Weight** apply that profile.
- A **Portfolio Snapshot** summarizes current holdings, portfolio value, and exposure.
- The **Portfolio Assistant** can answer from trade history, holdings, portfolio value, exposure, benchmarks, FX, and market context.

## Example Dialogue

> **Dev:** "If the user uploads a Firstrade PDF with two fills, do we create two **Trades**?"
> **Domain expert:** "The PDF is one **Trade Confirmation**. **Extraction** may produce two **Proposed Trades**. Once accepted, those become **Saved Trades** in **Trade History**."
>
> **Dev:** "If the same ticker appears in Firstrade and 元大複委託, is that one **Holding**?"
> **Domain expert:** "No. A **Holding** belongs to one **Brokerage Account**. The **Portfolio** aggregates both holdings."
>
> **Dev:** "Should the **Portfolio Value** include cash from past sells?"
> **Domain expert:** "No. Cash balance is out of scope for now; **Portfolio Value** is based only on open holdings valued with **Previous Close**."
>
> **Dev:** "Why does NVDL show a different **Exposure Weight** than **Weight**?"
> **Domain expert:** "Its **Exposure Profile** maps it to 2x long NVDA exposure, so **Weight** reflects market value while **Exposure Weight** reflects effective long exposure."

## Product Surface

- `app/page.tsx` renders the main Vellum workspace: upload, extraction, review, portfolio snapshot, chat trigger, and palette toggle.
- `components/trade-extractor.tsx` owns upload, account metadata, optional notes, extraction notices, saved-row restore, deletion, and the handoff into portfolio views.
- `components/trades-table.tsx` is the primary verification surface after extraction.
- `components/portfolio-snapshot.tsx`, `components/holdings-table.tsx`, `components/portfolio-summary-cards.tsx`, `components/asset-value-chart.tsx`, and `components/portfolio-weight-chart.tsx` provide the secondary portfolio analysis surface.
- `components/chat-drawer.tsx` exposes the Portfolio Assistant for questions about trades, holdings, performance, benchmarks, FX, and market/news context.

## Current Focus

- Keep the primary flow centered on upload, extraction, and row review.
- Treat holdings and charting as secondary analysis revealed only when needed.
- Preserve clear, trustworthy presentation over decorative UI chrome.
- Use a restrained teal-and-bronze palette so color supports hierarchy without adding clutter.
- Keep audit-driven accessibility, responsive behavior, and performance fixes in step with UI polish.
- Keep assistant answers grounded in tool results for portfolio data; never fabricate prices, holdings, or performance numbers.

## Design Context

- Source of truth lives in `.impeccable.md`.
- Direction: calm, utilitarian, trustworthy; light-first; Bloomberg-lite without glossy marketing patterns.
- Favor dense, data-first operational UI over marketing-style composition.

## Data And Integration Model

- Trade records are stored locally and validated with Zod schemas under `lib/trades/`.
- Quote snapshots, USD/TWD FX, and price history are cached locally under `lib/quotes/` and `data/` to avoid unnecessary upstream calls.
- Holdings aggregation, value series, benchmark comparison, summary cards, exposure profiles, and current snapshot logic live under `lib/portfolio/`.
- Supported markets are US equities and Taiwan equities; combined portfolio values normalize to TWD or USD depending on the analysis surface.
- API routes under `app/api/` expose extraction, stored trade rows, previous close quotes, FX, daily portfolio values, exposure profiles, and chat streams.
- The chat assistant uses a skill registry under `lib/agents/skills/`, currently split into portfolio tools and news/market intelligence tools.

## Recent Status

- Simplified the page shell, upload surface, and review flow.
- Moved portfolio analysis behind progressive disclosure to reduce default cognitive load.
- Added a warm teal-and-bronze color system across tokens, tables, disclosures, and charts.
- Fixed the primary CTA name, labeled the optional note field, and restored success-state contrast.
- Increased touch targets, removed the hidden theme hotkey, and made attachment removal easier on touch devices.
- Added mobile card views for trade and holding review, tokenized surface styling, and capped chart growth for large portfolios.
- Added optional account metadata to stored trade rows so holdings can stay separated by broker account.
- Added persistent quote caching so repeated refreshes reuse recent previous-close and USD/TWD snapshots instead of hitting upstream quote APIs every time.
- Refactored the portfolio weight chart around user goals: all-holdings, by-account, and by-market views, with merged ticker bars across accounts where appropriate.
- Added daily portfolio value and benchmark computation from stored trades.
- Added exposure profile support for leveraged and inverse instruments, including seeded profiles for common leveraged US ETFs.
- Added a chat drawer backed by AI SDK tools for trade history, holdings, daily values, stock performance, FX, news, trends, and prediction market summaries.
- Added repo-local agent configuration under `AGENTS.md` and `docs/agents/` so engineering skills can use GitHub Issues, default triage labels, and this single-context domain-doc layout.
