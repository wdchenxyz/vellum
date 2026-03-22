import {
  getHoldingKey,
  getQuoteLookupKey,
  inferSupportedMarket,
} from "@/lib/portfolio/holdings"
import type { DailyPriceSeries } from "@/lib/quotes/history-cache"
import type { TradeTableRow } from "@/lib/trades/schema"

export type DailyValuePoint = {
  date: string
  value: number
}

type PositionEntry = {
  currency: string
  quantity: number
  quoteKey: string
}

/**
 * Build a sorted list of every calendar date from `startDate` to `endDate`
 * (inclusive) that appears in at least one of the provided price series.
 * This keeps the chart aligned to real trading days.
 */
function collectTradingDates(
  priceSeries: Map<string, DailyPriceSeries>,
  fxRates: DailyPriceSeries,
  startDate: string,
  endDate: string
): string[] {
  const dateSet = new Set<string>()

  for (const series of priceSeries.values()) {
    for (const date of Object.keys(series)) {
      if (date >= startDate && date <= endDate) {
        dateSet.add(date)
      }
    }
  }

  for (const date of Object.keys(fxRates)) {
    if (date >= startDate && date <= endDate) {
      dateSet.add(date)
    }
  }

  return [...dateSet].sort()
}

/**
 * Sort trades by date with a stable tiebreaker on insertion order.
 * Matches the sort behaviour of `sortTradesByDate` in holdings.ts so that
 * BUY before SELL on the same date is deterministic.
 */
function stableSortTrades(trades: TradeTableRow[]) {
  return trades
    .map((trade, index) => ({ trade, index }))
    .sort((a, b) => {
      const byDate = a.trade.date.localeCompare(b.trade.date)

      if (byDate !== 0) {
        return byDate
      }

      return a.index - b.index
    })
}

/**
 * Walk trades chronologically and produce a map of date -> position snapshot.
 *
 * Positions are tracked **per account** (matching `aggregateHoldings`), then
 * collapsed to per-quoteKey totals for each snapshot so the value chart shows
 * the correct total portfolio quantity.
 */
function buildTradeEvents(trades: TradeTableRow[]) {
  // Per-account quantities — mirrors aggregateHoldings behaviour.
  const accountPositions = new Map<
    string,
    { quoteKey: string; currency: string; quantity: number }
  >()
  const events = new Map<string, Map<string, PositionEntry>>()

  for (const { trade } of stableSortTrades(trades)) {
    const market = inferSupportedMarket({
      ticker: trade.ticker,
      currency: trade.currency,
    })

    if (!market) {
      continue
    }

    const quoteKey = getQuoteLookupKey({ ticker: trade.ticker, market })
    const holdingKey = getHoldingKey({
      account: trade.account,
      ticker: trade.ticker,
      market,
    })
    const currency = market === "TW" ? "TWD" : "USD"

    const existing = accountPositions.get(holdingKey)
    const currentQty = existing?.quantity ?? 0
    const delta = trade.side === "BUY" ? trade.quantity : -trade.quantity
    const nextQty = Math.max(currentQty + delta, 0)

    accountPositions.set(holdingKey, { quoteKey, currency, quantity: nextQty })

    // Collapse per-account positions into per-quoteKey totals.
    const collapsed = new Map<string, PositionEntry>()

    for (const pos of accountPositions.values()) {
      const existing = collapsed.get(pos.quoteKey)
      const prevQty = existing?.quantity ?? 0

      collapsed.set(pos.quoteKey, {
        currency: pos.currency,
        quantity: prevQty + pos.quantity,
        quoteKey: pos.quoteKey,
      })
    }

    events.set(trade.date, collapsed)
  }

  return events
}

function getLastKnownPrice(
  series: DailyPriceSeries | undefined,
  date: string
): number | null {
  if (!series) {
    return null
  }

  // Exact match first.
  if (date in series) {
    return series[date]
  }

  // Carry forward: find the most recent date <= `date`.
  let best: string | null = null

  for (const d of Object.keys(series)) {
    if (d <= date && (best === null || d > best)) {
      best = d
    }
  }

  return best ? series[best] : null
}

/**
 * Compute a cash-flow-adjusted benchmark value series.
 *
 * On the first chart date the benchmark is seeded with the portfolio's actual
 * market value (so all three lines start at the same point).  For any trades
 * that occur **after** the first date, the benchmark receives the same TWD
 * cash flow but buys/sells benchmark units instead.
 *
 * @param portfolioSeries The portfolio's daily value series (used to seed
 *                        the benchmark on the first date).
 * @param isUsd true if the benchmark is USD-denominated (e.g. SPY).
 */
export function computeBenchmarkSeries(
  trades: TradeTableRow[],
  benchmarkPrices: DailyPriceSeries,
  fxRates: DailyPriceSeries,
  portfolioSeries: DailyValuePoint[],
  isUsd: boolean
): DailyValuePoint[] {
  if (portfolioSeries.length === 0) {
    return []
  }

  const tradingDates = portfolioSeries.map((p) => p.date)
  const firstDate = tradingDates[0]

  function getBenchmarkPriceTwd(date: string): number | null {
    const rawPrice = getLastKnownPrice(benchmarkPrices, date)

    if (rawPrice === null) {
      return null
    }

    if (!isUsd) {
      return rawPrice
    }

    const rate = getLastKnownPrice(fxRates, date)

    return rate !== null ? rawPrice * rate : null
  }

  function getTradeCashFlowTwd(trade: TradeTableRow, date: string): number {
    const currency = trade.currency?.trim().toUpperCase() ?? null

    if (currency === "USD") {
      const rate = getLastKnownPrice(fxRates, date)
      return trade.totalAmount * (rate ?? 0)
    }

    return trade.totalAmount
  }

  // Seed benchmark with the portfolio's market value on the first date.
  const firstBenchPrice = getBenchmarkPriceTwd(firstDate)

  if (firstBenchPrice === null || firstBenchPrice <= 0) {
    return []
  }

  let benchmarkUnits = portfolioSeries[0].value / firstBenchPrice

  // Only process trades that happen AFTER the first chart date —
  // trades on or before the first date are captured by the seed.
  const futureTrades = stableSortTrades(trades).filter(
    ({ trade }) => trade.date > firstDate
  )
  let tradeIdx = 0

  const series: DailyValuePoint[] = []

  for (const date of tradingDates) {
    // Apply any trades on or before this date (only future trades).
    while (tradeIdx < futureTrades.length) {
      const { trade } = futureTrades[tradeIdx]

      if (trade.date > date) {
        break
      }

      const benchPriceTwd = getBenchmarkPriceTwd(date)

      if (benchPriceTwd !== null && benchPriceTwd > 0) {
        const cashTwd = getTradeCashFlowTwd(trade, date)
        const unitsDelta = cashTwd / benchPriceTwd

        if (trade.side === "BUY") {
          benchmarkUnits += unitsDelta
        } else {
          benchmarkUnits = Math.max(benchmarkUnits - unitsDelta, 0)
        }
      }

      tradeIdx++
    }

    if (benchmarkUnits <= 0) {
      continue
    }

    const priceTwd = getBenchmarkPriceTwd(date)

    if (priceTwd !== null) {
      series.push({ date, value: Math.round(benchmarkUnits * priceTwd) })
    }
  }

  return series
}

/**
 * Compute daily total portfolio value in TWD.
 *
 * - Walks every trading date from first trade to today.
 * - Carries forward positions and prices between gaps.
 * - USD holdings are converted to TWD using the daily FX rate.
 */
export function computeDailyValues(
  trades: TradeTableRow[],
  priceSeries: Map<string, DailyPriceSeries>,
  fxRates: DailyPriceSeries
): DailyValuePoint[] {
  if (trades.length === 0) {
    return []
  }

  const tradeEvents = buildTradeEvents(trades)
  const sortedTradeDates = [...tradeEvents.keys()].sort()
  const startDate = sortedTradeDates[0]
  const endDate = new Date().toISOString().slice(0, 10)
  const dates = collectTradingDates(priceSeries, fxRates, startDate, endDate)

  if (dates.length === 0) {
    return []
  }

  const series: DailyValuePoint[] = []
  let currentPositions = new Map<string, PositionEntry>()

  for (const date of dates) {
    // Apply any trades on or before this date that haven't been applied yet.
    for (const tradeDate of sortedTradeDates) {
      if (tradeDate > date) {
        break
      }

      const snapshot = tradeEvents.get(tradeDate)

      if (snapshot) {
        currentPositions = snapshot
      }
    }

    // Remove consumed trade events so we don't reprocess them.
    while (sortedTradeDates.length > 0 && sortedTradeDates[0] <= date) {
      sortedTradeDates.shift()
    }

    const fxRate = getLastKnownPrice(fxRates, date)
    let totalTwd = 0
    let hasAnyPrice = false

    for (const position of currentPositions.values()) {
      if (position.quantity <= 0) {
        continue
      }

      const price = getLastKnownPrice(priceSeries.get(position.quoteKey), date)

      if (price === null) {
        continue
      }

      hasAnyPrice = true
      const nativeValue = position.quantity * price

      if (position.currency === "USD") {
        totalTwd += nativeValue * (fxRate ?? 0)
      } else {
        totalTwd += nativeValue
      }
    }

    if (hasAnyPrice) {
      series.push({ date, value: Math.round(totalTwd) })
    }
  }

  return series
}
