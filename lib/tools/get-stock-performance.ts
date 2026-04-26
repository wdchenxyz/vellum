import { tool } from "ai"
import { z } from "zod"

import { aggregateHoldings, type ValuedHolding } from "@/lib/portfolio/holdings"
import type { SupportedMarket } from "@/lib/portfolio/schema"
import type { DailyPriceSeries } from "@/lib/quotes/history-cache"
import { fetchTickerHistory } from "@/lib/quotes/history"
import { readStoredTradeRows } from "@/lib/trades/storage"

type StockPerformanceTarget = {
  key: string
  ticker: string
  market: SupportedMarket
  currency: string
}

type StockPerformanceRow = {
  ticker: string
  market: SupportedMarket
  currency: string
  startDate: string
  startPrice: number
  endDate: string
  endPrice: number
  returnPct: number | null
}

type StockPerformanceResult = {
  stock: StockPerformanceRow | null
  issue: string | null
}

/**
 * Find the closest price on or after `date`, then fall back to the closest
 * price on or before `date`. Returns null if the series is empty.
 */
function getPriceNear(
  series: DailyPriceSeries,
  date: string
): { date: string; price: number } | null {
  const dates = Object.keys(series).sort()

  if (dates.length === 0) {
    return null
  }

  // On or after: first date >= target.
  for (const d of dates) {
    if (d >= date) {
      return { date: d, price: series[d] }
    }
  }

  // Fall back: latest date before target.
  const last = dates[dates.length - 1]
  return { date: last, price: series[last] }
}

function getLatestPrice(
  series: DailyPriceSeries
): { date: string; price: number } | null {
  const dates = Object.keys(series).sort()

  if (dates.length === 0) {
    return null
  }

  const last = dates[dates.length - 1]
  return { date: last, price: series[last] }
}

function matchesRequestedTicker(
  holding: ValuedHolding,
  tickers: string[] | undefined
) {
  if (!tickers) {
    return true
  }

  const normalizedTicker = holding.ticker.toUpperCase()
  return tickers.some((ticker) =>
    normalizedTicker.includes(ticker.trim().toUpperCase())
  )
}

function filterTargetHoldings(
  holdings: ValuedHolding[],
  tickers: string[] | undefined
) {
  return holdings.filter((holding) => matchesRequestedTicker(holding, tickers))
}

function collectUniqueTargets(holdings: ValuedHolding[]) {
  const uniqueTargets = new Map<string, StockPerformanceTarget>()

  for (const holding of holdings) {
    if (!uniqueTargets.has(holding.quoteKey)) {
      uniqueTargets.set(holding.quoteKey, {
        key: holding.quoteKey,
        ticker: holding.ticker,
        market: holding.market,
        currency: holding.currency,
      })
    }
  }

  return [...uniqueTargets.values()]
}

function computeReturnPct(startPrice: number, endPrice: number) {
  if (startPrice <= 0) {
    return null
  }

  return Number((((endPrice - startPrice) / startPrice) * 100).toFixed(2))
}

function buildStockPerformanceRow({
  dateFrom,
  dateTo,
  series,
  target,
}: {
  dateFrom: string
  dateTo?: string
  series: DailyPriceSeries
  target: StockPerformanceTarget
}): StockPerformanceRow | null {
  const startPoint = getPriceNear(series, dateFrom)
  const endPoint = dateTo
    ? getPriceNear(series, dateTo)
    : getLatestPrice(series)

  if (!startPoint || !endPoint) {
    return null
  }

  return {
    ticker: target.ticker,
    market: target.market,
    currency: target.currency,
    startDate: startPoint.date,
    startPrice: startPoint.price,
    endDate: endPoint.date,
    endPrice: endPoint.price,
    returnPct: computeReturnPct(startPoint.price, endPoint.price),
  }
}

async function fetchTargetPerformance({
  dateFrom,
  dateTo,
  target,
}: {
  dateFrom: string
  dateTo?: string
  target: StockPerformanceTarget
}): Promise<StockPerformanceResult> {
  try {
    const series = await fetchTickerHistory(
      { key: target.key, ticker: target.ticker, market: target.market },
      dateFrom
    )
    const stock = buildStockPerformanceRow({ dateFrom, dateTo, series, target })

    if (!stock) {
      return {
        stock: null,
        issue: `${target.ticker}: insufficient price data.`,
      }
    }

    return { stock, issue: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return {
      stock: null,
      issue: `${target.ticker}: ${message}`,
    }
  }
}

function buildStockPerformanceResponse(results: StockPerformanceResult[]) {
  const stocks = results
    .flatMap((result) =>
      result.stock && result.stock.returnPct !== null ? [result.stock] : []
    )
    .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0))
  const issues = results.flatMap((result) =>
    result.issue ? [result.issue] : []
  )

  return { stocks, issues }
}

export const getStockPerformance = tool({
  description:
    "Get individual stock price performance for holdings over a date range. Returns start price, end price, and return % for each stock in the portfolio. Useful for ranking which stocks performed best/worst over a period (e.g. YTD, last quarter).",
  inputSchema: z.object({
    dateFrom: z
      .string()
      .describe("Start date for performance measurement (YYYY-MM-DD)"),
    dateTo: z
      .string()
      .optional()
      .describe(
        "End date for performance measurement (YYYY-MM-DD). Defaults to latest available."
      ),
    tickers: z
      .array(z.string())
      .optional()
      .describe(
        "Specific tickers to check. If omitted, all current holdings are used."
      ),
  }),
  execute: async ({ dateFrom, dateTo, tickers }) => {
    const trades = await readStoredTradeRows()

    if (trades.length === 0) {
      return { stocks: [], issues: ["No trades found."] }
    }

    const { holdings, issues: aggIssues } = aggregateHoldings(trades)
    const targetHoldings = filterTargetHoldings(holdings, tickers)

    if (targetHoldings.length === 0) {
      return { stocks: [], issues: ["No matching holdings found."] }
    }

    const uniqueTargets = collectUniqueTargets(targetHoldings)
    const results = await Promise.all(
      uniqueTargets.map((target) =>
        fetchTargetPerformance({ dateFrom, dateTo, target })
      )
    )
    const { stocks, issues: fetchIssues } =
      buildStockPerformanceResponse(results)

    return {
      stocks,
      issues: [...aggIssues, ...fetchIssues],
    }
  },
})
