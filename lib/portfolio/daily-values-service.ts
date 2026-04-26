import "server-only"

import {
  computeBenchmarkSeries,
  computeDailyValues,
} from "@/lib/portfolio/daily-values"
import {
  aggregateHoldings,
  getQuoteLookupKey,
  inferSupportedMarket,
} from "@/lib/portfolio/holdings"
import type { BenchmarkSeries, DailyValuePoint } from "@/lib/portfolio/schema"
import type { DailyPriceSeries } from "@/lib/quotes/history-cache"
import {
  fetchBenchmarkHistory,
  fetchFxHistory,
  fetchTickerHistory,
} from "@/lib/quotes/history"
import { fetchUsdTwdFxSnapshot } from "@/lib/quotes/twelve-data"
import type { TradeTableRow } from "@/lib/trades/schema"

export type DailyValuesResult = {
  benchmarks: BenchmarkSeries
  costBasisTwd: number | null
  issues: string[]
  series: DailyValuePoint[]
}

type HistoryTarget = {
  key: string
  ticker: string
  market: "US" | "TW"
}

type HistoricalMarketData = {
  fxRates: DailyPriceSeries
  fxSnapshot: Awaited<ReturnType<typeof fetchUsdTwdFxSnapshot>> | null
  issues: string[]
  priceSeries: Map<string, DailyPriceSeries>
}

const EMPTY_RESULT: DailyValuesResult = {
  benchmarks: { spx: [], twii: [] },
  costBasisTwd: 0,
  issues: [],
  series: [],
}

function collectUniqueHistoryTargets(
  holdings: ReturnType<typeof aggregateHoldings>["holdings"]
): Map<string, HistoryTarget> {
  const uniqueTargets = new Map<string, HistoryTarget>()

  for (const holding of holdings) {
    if (!uniqueTargets.has(holding.quoteKey)) {
      uniqueTargets.set(holding.quoteKey, {
        key: holding.quoteKey,
        ticker: holding.ticker,
        market: holding.market,
      })
    }
  }

  return uniqueTargets
}

function getTradeStartDate(trades: TradeTableRow[]) {
  return trades
    .map((trade) => trade.date)
    .sort((left, right) => left.localeCompare(right))[0]
}

async function fetchHistoricalMarketData(
  targets: Iterable<HistoryTarget>,
  startDate: string,
  hasUsd: boolean
): Promise<HistoricalMarketData> {
  const issues: string[] = []

  const [fxRates, fxSnapshot, ...tickerResults] = await Promise.all([
    hasUsd
      ? fetchFxHistory(startDate)
      : Promise.resolve({} as DailyPriceSeries),
    hasUsd ? fetchUsdTwdFxSnapshot() : Promise.resolve(null),
    ...[...targets].map(async (target) => {
      try {
        const prices = await fetchTickerHistory(target, startDate)
        return { key: target.key, prices }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"
        issues.push(`${target.key}: ${message}`)
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

  return {
    fxRates,
    fxSnapshot,
    issues,
    priceSeries,
  }
}

function addRawTradePriceAliases(
  trades: TradeTableRow[],
  holdings: ReturnType<typeof aggregateHoldings>["holdings"],
  priceSeries: Map<string, DailyPriceSeries>
) {
  for (const trade of trades) {
    const market = inferSupportedMarket({
      ticker: trade.ticker,
      currency: trade.currency,
    })

    if (!market) {
      continue
    }

    const rawKey = getQuoteLookupKey({ ticker: trade.ticker, market })

    if (priceSeries.has(rawKey)) {
      continue
    }

    const matchingHolding = holdings.find(
      (holding) =>
        holding.market === market &&
        holding.ticker.toUpperCase() === trade.ticker.trim().toUpperCase()
    )

    const series = matchingHolding
      ? priceSeries.get(matchingHolding.quoteKey)
      : undefined

    if (series) {
      priceSeries.set(rawKey, series)
    }
  }
}

async function computeBenchmarks(
  trades: TradeTableRow[],
  startDate: string,
  fxRates: DailyPriceSeries,
  tradingDates: string[]
): Promise<BenchmarkSeries> {
  try {
    const rawBenchmarks = await fetchBenchmarkHistory(startDate)

    return {
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
    return EMPTY_RESULT.benchmarks
  }
}

function computeCostBasisTwd(
  holdings: ReturnType<typeof aggregateHoldings>["holdings"],
  spotFxRate: number | null
) {
  const hasUsdHoldings = holdings.some((holding) => holding.currency === "USD")

  if (hasUsdHoldings && spotFxRate === null) {
    return null
  }

  let total = 0

  for (const holding of holdings) {
    const rate = holding.currency === "USD" ? (spotFxRate ?? 0) : 1
    total += holding.totalCostOpen * rate
  }

  return Math.round(total)
}

/**
 * Compute daily portfolio values, benchmarks, and cost basis from trades.
 * Shared between the `/api/portfolio/daily-values` route and chat tools.
 */
export async function computeDailyValuesFromTrades(
  trades: TradeTableRow[]
): Promise<DailyValuesResult> {
  if (trades.length === 0) {
    return EMPTY_RESULT
  }

  const { holdings } = aggregateHoldings(trades)

  if (holdings.length === 0) {
    return EMPTY_RESULT
  }

  const startDate = getTradeStartDate(trades)
  const uniqueTargets = collectUniqueHistoryTargets(holdings)
  const hasUsd = holdings.some((holding) => holding.currency === "USD")
  const { fxRates, fxSnapshot, issues, priceSeries } =
    await fetchHistoricalMarketData(uniqueTargets.values(), startDate, hasUsd)

  addRawTradePriceAliases(trades, holdings, priceSeries)

  const series = computeDailyValues(trades, priceSeries, fxRates)
  const tradingDates = series.map((point) => point.date)
  const benchmarks = await computeBenchmarks(
    trades,
    startDate,
    fxRates,
    tradingDates
  )
  const costBasisTwd = computeCostBasisTwd(holdings, fxSnapshot?.rate ?? null)

  return {
    benchmarks,
    costBasisTwd,
    issues,
    series,
  }
}
