import { NextResponse } from "next/server"

import {
  computeBenchmarkSeries,
  computeDailyValues,
} from "@/lib/portfolio/daily-values"
import {
  aggregateHoldings,
  getQuoteLookupKey,
  inferSupportedMarket,
} from "@/lib/portfolio/holdings"
import type { BenchmarkSeries } from "@/lib/portfolio/schema"
import type { DailyPriceSeries } from "@/lib/quotes/history-cache"
import {
  fetchBenchmarkHistory,
  fetchFxHistory,
  fetchTickerHistory,
} from "@/lib/quotes/history"
import { readStoredTradeRows } from "@/lib/trades/storage"

export const dynamic = "force-dynamic"
export const maxDuration = 60
export const runtime = "nodejs"

export async function GET() {
  try {
    const trades = await readStoredTradeRows()

    if (trades.length === 0) {
      return NextResponse.json({ series: [] })
    }

    const { holdings } = aggregateHoldings(trades)

    if (holdings.length === 0) {
      return NextResponse.json({ series: [] })
    }

    // Determine earliest trade date for the fetch window.
    const sortedDates = trades
      .map((trade) => trade.date)
      .sort((a, b) => a.localeCompare(b))
    const startDate = sortedDates[0]

    // Deduplicate by quoteKey — one price series per unique ticker+market.
    const uniqueTargets = new Map<
      string,
      { key: string; ticker: string; market: "US" | "TW" }
    >()

    for (const holding of holdings) {
      if (!uniqueTargets.has(holding.quoteKey)) {
        uniqueTargets.set(holding.quoteKey, {
          key: holding.quoteKey,
          ticker: holding.ticker,
          market: holding.market,
        })
      }
    }

    const hasUsd = holdings.some((holding) => holding.currency === "USD")

    // Fetch historical prices + FX in parallel.
    const fetchIssues: string[] = []

    const [fxRates, ...tickerResults] = await Promise.all([
      hasUsd
        ? fetchFxHistory(startDate)
        : Promise.resolve({} as DailyPriceSeries),
      ...[...uniqueTargets.values()].map(async (target) => {
        try {
          const prices = await fetchTickerHistory(target, startDate)
          return { key: target.key, prices }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error"
          fetchIssues.push(`${target.key}: ${message}`)
          return { key: target.key, prices: {} as DailyPriceSeries }
        }
      }),
    ])

    const priceSeries = new Map<string, DailyPriceSeries>()

    for (const result of tickerResults) {
      if (Object.keys(result.prices).length > 0) {
        priceSeries.set(result.key, result.prices)
      }
    }

    // Also build quoteKey mappings from the raw trades (to handle Chinese
    // ticker names that get normalised during aggregation).
    for (const trade of trades) {
      const market = inferSupportedMarket({
        ticker: trade.ticker,
        currency: trade.currency,
      })

      if (!market) {
        continue
      }

      const rawKey = getQuoteLookupKey({ ticker: trade.ticker, market })

      if (!priceSeries.has(rawKey)) {
        // Find the aggregated holding's quoteKey that matches this trade's
        // ticker (they may differ if the ticker was a Chinese name that
        // resolved to a numeric stock ID).
        for (const holding of holdings) {
          if (
            holding.market === market &&
            holding.ticker.toUpperCase() === trade.ticker.trim().toUpperCase()
          ) {
            const series = priceSeries.get(holding.quoteKey)

            if (series) {
              priceSeries.set(rawKey, series)
            }

            break
          }
        }
      }
    }

    const series = computeDailyValues(trades, priceSeries, fxRates)

    // Compute cash-flow-adjusted benchmark value series.
    const tradingDates = series.map((point) => point.date)
    let benchmarks: BenchmarkSeries = { spx: [], twii: [] }

    try {
      const rawBenchmarks = await fetchBenchmarkHistory(startDate)

      benchmarks = {
        spx: computeBenchmarkSeries(
          trades,
          rawBenchmarks.spx,
          fxRates,
          tradingDates,
          true
        ),
        twii: computeBenchmarkSeries(
          trades,
          rawBenchmarks.twii,
          fxRates,
          tradingDates,
          false
        ),
      }
    } catch {
      // Non-critical — chart still works without benchmarks.
    }

    // Compute cost basis in TWD using the same method as the summary card:
    // aggregateHoldings cost * latest FX rate.
    const fxDates = Object.keys(fxRates).sort()
    const latestFxRate =
      fxDates.length > 0 ? fxRates[fxDates[fxDates.length - 1]] : 0
    let costBasisTwd = 0

    for (const holding of holdings) {
      const rate = holding.currency === "USD" ? latestFxRate : 1
      costBasisTwd += holding.totalCostOpen * rate
    }

    return NextResponse.json(
      {
        benchmarks,
        costBasisTwd: Math.round(costBasisTwd),
        series,
        issues: fetchIssues,
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to compute daily portfolio values."

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
