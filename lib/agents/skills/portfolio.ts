// lib/agents/skills/portfolio.ts
import type { Skill } from "./types"
import { getDailyValues } from "@/lib/tools/get-daily-values"
import { getFxRate } from "@/lib/tools/get-fx-rate"
import { getHoldings } from "@/lib/tools/get-holdings"
import { getStockPerformance } from "@/lib/tools/get-stock-performance"
import { getTradeHistory } from "@/lib/tools/get-trade-history"

const portfolioTools = {
  getTradeHistory,
  getHoldings,
  getDailyValues,
  getStockPerformance,
  getFxRate,
}

export const portfolioSkill: Skill<typeof portfolioTools> = {
  name: "portfolio",
  description: "Portfolio analysis: trades, holdings, performance, benchmarks",
  tools: portfolioTools,
  systemPrompt: `<capabilities>
You have access to these tools:
- **getTradeHistory**: Retrieve trade records (BUY/SELL) with optional filters for ticker, account, date range, and side.
- **getHoldings**: Get current portfolio holdings with market values, weights, cost basis, and P&L.
- **getDailyValues**: Get daily portfolio value time series plus cash-flow-adjusted S&P 500 and TAIEX benchmarks. This also computes return percentages and max drawdown.
- **getStockPerformance**: Get individual stock price performance over a date range. Returns start price, end price, and return % for each holding. Use this to rank best/worst performers (e.g. YTD, last quarter).
- **getFxRate**: Get the current USD/TWD exchange rate.
</capabilities>

<guidelines>
- When the user asks how to use Vellum (uploading trades, navigating the dashboard, etc.), answer from the product knowledge above. No tool call needed.
- When comparing portfolio performance vs benchmarks, use getDailyValues with the relevant date range.
- When analyzing drawdowns, use getDailyValues which computes max drawdown automatically.
- When the user asks about holdings or positions, use getHoldings.
- When the user asks about specific trades, use getTradeHistory with appropriate filters.
- When the user asks which stocks performed best/worst over a period, use getStockPerformance with the date range.
- Default currency is TWD. Always present values in TWD unless the user explicitly asks for USD. Convert USD values to TWD using getFxRate when needed.
- Format currency values with proper symbols (NT$ for TWD, $ for USD) and thousand separators.
- Format percentages to 2 decimal places.
- Present data in clear markdown tables when comparing multiple items.
- All portfolio values from getDailyValues are denominated in TWD.
- Be concise but thorough. Show the numbers that matter.
</guidelines>`,
  toolLabels: {
    getTradeHistory: "Fetching trade history",
    getHoldings: "Loading portfolio holdings",
    getDailyValues: "Computing portfolio values",
    getStockPerformance: "Analyzing stock performance",
    getFxRate: "Checking exchange rate",
  },
}
