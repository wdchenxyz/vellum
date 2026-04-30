# Vellum

Trade-capture and portfolio analytics for self-directed investors. Upload broker confirmations (screenshots or PDFs), let AI extract structured trades, and get a live portfolio dashboard with holdings, valuations, and benchmarks.

## Features

- **AI trade extraction** -- Drag-and-drop broker confirmations (up to 4 files per batch). Extracts BUY/SELL rows with date, ticker, quantity, price, currency, and fees.
- **Trade ledger** -- Persistent transaction log with per-account tagging and individual row deletion.
- **Portfolio holdings** -- Auto-derived open positions (FIFO), grouped by account, with average cost, cost basis, market value, and unrealized P/L.
- **Live quotes** -- Previous-close prices for US equities (Twelve Data) and Taiwan equities (FinMind/TWSE), plus USD/TWD FX conversion.
- **Portfolio summary** -- Total asset value, per-account breakdowns, and quote coverage.
- **Weight chart** -- Horizontal bar chart with cost-vs-gain segments, filterable by account or market.
- **Historical value chart** -- Daily portfolio value over time with S&P 500 and TAIEX benchmark overlays (cash-flow adjusted).

## Tech Stack

Next.js 16 (App Router) / React 19 / TypeScript / Tailwind CSS v4 / shadcn/ui / Recharts / Vercel AI SDK (Claude) / Zod v4

## Getting Started

```bash
pnpm install
pnpm dev
```

The app runs at `http://localhost:3000`. Trade data is stored locally in `data/transactions.sqlite`; the SQLite database and schema are created automatically on first read or write. Legacy `data/transactions.json` data is migrated when the SQLite store is empty.

## Scripts

| Command          | Description             |
| ---------------- | ----------------------- |
| `pnpm dev`       | Start dev server        |
| `pnpm build`     | Production build        |
| `pnpm start`     | Start production server |
| `pnpm lint`      | Run ESLint              |
| `pnpm format`    | Format with Prettier    |
| `pnpm test`      | Run tests (Vitest)      |
| `pnpm typecheck` | Type-check without emit |
