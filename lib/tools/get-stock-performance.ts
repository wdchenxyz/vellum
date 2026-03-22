import { tool } from "ai"
import { z } from "zod"

import { aggregateHoldings, getQuoteLookupKey } from "@/lib/portfolio/holdings"
import type { DailyPriceSeries } from "@/lib/quotes/history-cache"
import { fetchTickerHistory } from "@/lib/quotes/history"
import { readStoredTradeRows } from "@/lib/trades/storage"

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

    // Filter to requested tickers if specified.
    const targetHoldings = tickers
      ? holdings.filter((h) =>
          tickers.some((t) =>
            h.ticker.toUpperCase().includes(t.trim().toUpperCase())
          )
        )
      : holdings

    if (targetHoldings.length === 0) {
      return { stocks: [], issues: ["No matching holdings found."] }
    }

    // Deduplicate by quoteKey.
    const uniqueTargets = new Map<
      string,
      { key: string; ticker: string; market: "US" | "TW"; currency: string }
    >()

    for (const holding of targetHoldings) {
      if (!uniqueTargets.has(holding.quoteKey)) {
        uniqueTargets.set(holding.quoteKey, {
          key: holding.quoteKey,
          ticker: holding.ticker,
          market: holding.market,
          currency: holding.currency,
        })
      }
    }

    const fetchIssues: string[] = []

    const results = await Promise.all(
      [...uniqueTargets.values()].map(async (target) => {
        try {
          const series = await fetchTickerHistory(
            { key: target.key, ticker: target.ticker, market: target.market },
            dateFrom
          )

          const startPoint = getPriceNear(series, dateFrom)
          const endPoint = dateTo
            ? getPriceNear(series, dateTo)
            : getLatestPrice(series)

          if (!startPoint || !endPoint) {
            fetchIssues.push(`${target.ticker}: insufficient price data.`)
            return null
          }

          const returnPct =
            startPoint.price > 0
              ? Number(
                  (
                    ((endPoint.price - startPoint.price) / startPoint.price) *
                    100
                  ).toFixed(2)
                )
              : null

          return {
            ticker: target.ticker,
            market: target.market,
            currency: target.currency,
            startDate: startPoint.date,
            startPrice: startPoint.price,
            endDate: endPoint.date,
            endPrice: endPoint.price,
            returnPct,
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error"
          fetchIssues.push(`${target.ticker}: ${message}`)
          return null
        }
      })
    )

    const stocks = results
      .filter(
        (r): r is NonNullable<typeof r> => r !== null && r.returnPct !== null
      )
      .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0))

    return {
      stocks,
      issues: [...aggIssues, ...fetchIssues],
    }
  },
})
