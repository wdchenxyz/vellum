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

type PositionValuation = {
  hasCompleteValue: boolean
  totalTwd: number
}

type TradeEventProgress = {
  nextTradeDateIndex: number
  positions: Map<string, PositionEntry>
}

type SortedTradeEntry = ReturnType<typeof stableSortTrades>[number]

type BenchmarkProgress = {
  benchmarkUnits: number
  tradeIndex: number
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

function getTradeAmountInTwd(
  trade: TradeTableRow,
  fxRates: DailyPriceSeries,
  date: string
): number {
  const currency = trade.currency?.trim().toUpperCase() ?? null

  if (currency === "USD") {
    const rate = getLastKnownPrice(fxRates, date)
    return trade.totalAmount * (rate ?? 0)
  }

  return trade.totalAmount
}

function advanceTradeEvents(
  tradeDates: string[],
  tradeDateIndex: number,
  tradeEvents: Map<string, Map<string, PositionEntry>>,
  currentPositions: Map<string, PositionEntry>,
  date: string
): TradeEventProgress {
  let nextTradeDateIndex = tradeDateIndex
  let positions = currentPositions

  while (nextTradeDateIndex < tradeDates.length) {
    const tradeDate = tradeDates[nextTradeDateIndex]

    if (tradeDate > date) {
      break
    }

    const snapshot = tradeEvents.get(tradeDate)

    if (snapshot) {
      positions = snapshot
    }

    nextTradeDateIndex++
  }

  return {
    nextTradeDateIndex,
    positions,
  }
}

function valuePositionInTwd(
  position: PositionEntry,
  date: string,
  priceSeries: Map<string, DailyPriceSeries>,
  fxRate: number | null
): number | null {
  if (position.quantity <= 0) {
    return null
  }

  const price = getLastKnownPrice(priceSeries.get(position.quoteKey), date)

  if (price === null) {
    return null
  }

  const nativeValue = position.quantity * price

  if (position.currency === "USD") {
    return fxRate !== null ? nativeValue * fxRate : null
  }

  return nativeValue
}

function computePortfolioValueForDate(
  positions: Map<string, PositionEntry>,
  date: string,
  priceSeries: Map<string, DailyPriceSeries>,
  fxRates: DailyPriceSeries
): PositionValuation {
  const fxRate = getLastKnownPrice(fxRates, date)
  let totalTwd = 0
  let hasOpenPosition = false

  for (const position of positions.values()) {
    if (position.quantity <= 0) {
      continue
    }

    hasOpenPosition = true

    const value = valuePositionInTwd(position, date, priceSeries, fxRate)

    if (value === null) {
      return { hasCompleteValue: false, totalTwd: 0 }
    }

    totalTwd += value
  }

  return { hasCompleteValue: hasOpenPosition, totalTwd }
}

function addInitialCostPointIfNeeded(
  series: DailyValuePoint[],
  trades: TradeTableRow[],
  fxRates: DailyPriceSeries,
  startDate: string,
  date: string,
  totalTwd: number,
  addedCostPoint: boolean
): boolean {
  if (addedCostPoint || startDate > date) {
    return addedCostPoint
  }

  const totalCostTwd = computeTotalCostTwd(trades, fxRates, date)

  if (totalCostTwd > 0 && Math.round(totalCostTwd) !== Math.round(totalTwd)) {
    series.push({ date: startDate, value: Math.round(totalCostTwd) })
  }

  return true
}

/**
 * Compute a cash-flow-adjusted benchmark value series.
 *
 * For every trade the user makes, the benchmark receives the same TWD cash
 * flow but buys/sells benchmark units instead.  This way the only difference
 * between the portfolio line and the benchmark line is investment returns —
 * capital flows are identical.
 *
 * @param isUsd true if the benchmark is USD-denominated (e.g. SPY).
 *              Its price is multiplied by the FX rate to get TWD.
 *              false for TWD-denominated benchmarks (e.g. 0050).
 */
export function computeBenchmarkSeries(
  trades: TradeTableRow[],
  benchmarkPrices: DailyPriceSeries,
  fxRates: DailyPriceSeries,
  tradingDates: string[],
  isUsd: boolean
): DailyValuePoint[] {
  if (trades.length === 0 || tradingDates.length === 0) {
    return []
  }

  const sortedTrades = stableSortTrades(trades)
  let benchmarkUnits = 0
  let tradeIdx = 0
  let addedCostPoint = false

  const series: DailyValuePoint[] = []

  for (const date of tradingDates) {
    const tradeProgress = advanceBenchmarkTrades(
      sortedTrades,
      tradeIdx,
      benchmarkUnits,
      fxRates,
      benchmarkPrices,
      isUsd,
      date
    )
    benchmarkUnits = tradeProgress.benchmarkUnits
    tradeIdx = tradeProgress.tradeIndex

    if (benchmarkUnits <= 0) {
      continue
    }

    const priceTwd = getBenchmarkPriceTwd(benchmarkPrices, fxRates, isUsd, date)

    if (priceTwd !== null) {
      const value = Math.round(benchmarkUnits * priceTwd)
      addedCostPoint = addInitialBenchmarkCostPointIfNeeded(
        series,
        trades,
        fxRates,
        sortedTrades,
        date,
        addedCostPoint
      )
      series.push({ date, value })
    }
  }

  return series
}

function getBenchmarkPriceTwd(
  benchmarkPrices: DailyPriceSeries,
  fxRates: DailyPriceSeries,
  isUsd: boolean,
  date: string
): number | null {
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

function advanceBenchmarkTrades(
  sortedTrades: SortedTradeEntry[],
  tradeIndex: number,
  benchmarkUnits: number,
  fxRates: DailyPriceSeries,
  benchmarkPrices: DailyPriceSeries,
  isUsd: boolean,
  date: string
): BenchmarkProgress {
  const priceTwd = getBenchmarkPriceTwd(benchmarkPrices, fxRates, isUsd, date)

  if (priceTwd === null || priceTwd <= 0) {
    return {
      benchmarkUnits,
      tradeIndex,
    }
  }

  let nextBenchmarkUnits = benchmarkUnits
  let nextTradeIndex = tradeIndex

  while (nextTradeIndex < sortedTrades.length) {
    const { trade } = sortedTrades[nextTradeIndex]

    if (trade.date > date) {
      break
    }

    const cashTwd = getTradeAmountInTwd(trade, fxRates, date)
    const unitsDelta = cashTwd / priceTwd

    if (trade.side === "BUY") {
      nextBenchmarkUnits += unitsDelta
    } else {
      nextBenchmarkUnits = Math.max(nextBenchmarkUnits - unitsDelta, 0)
    }

    nextTradeIndex++
  }

  return {
    benchmarkUnits: nextBenchmarkUnits,
    tradeIndex: nextTradeIndex,
  }
}

function addInitialBenchmarkCostPointIfNeeded(
  series: DailyValuePoint[],
  trades: TradeTableRow[],
  fxRates: DailyPriceSeries,
  sortedTrades: SortedTradeEntry[],
  date: string,
  addedCostPoint: boolean
): boolean {
  const earliestTradeDate = sortedTrades[0]?.trade.date ?? null

  if (
    addedCostPoint ||
    earliestTradeDate === null ||
    earliestTradeDate >= date
  ) {
    return addedCostPoint
  }

  const costTwd = computeTotalCostTwd(trades, fxRates, date)

  if (costTwd > 0) {
    series.push({ date: earliestTradeDate, value: Math.round(costTwd) })
  }

  return true
}

/**
 * Compute the total cost basis in TWD from trades on or before `fxRefDate`.
 * USD trades are converted using the FX rate on the reference date.
 */
function computeTotalCostTwd(
  trades: TradeTableRow[],
  fxRates: DailyPriceSeries,
  fxRefDate: string
): number {
  const rate = getLastKnownPrice(fxRates, fxRefDate) ?? 0
  let total = 0

  for (const trade of trades) {
    if (trade.date > fxRefDate) {
      continue
    }

    const currency = trade.currency?.trim().toUpperCase() ?? null
    const amount = trade.side === "BUY" ? trade.totalAmount : -trade.totalAmount

    if (currency === "USD") {
      total += amount * rate
    } else {
      total += amount
    }
  }

  return Math.max(total, 0)
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
  let tradeDateIndex = 0
  let addedCostPoint = false

  for (const date of dates) {
    const tradeProgress = advanceTradeEvents(
      sortedTradeDates,
      tradeDateIndex,
      tradeEvents,
      currentPositions,
      date
    )
    currentPositions = tradeProgress.positions
    tradeDateIndex = tradeProgress.nextTradeDateIndex
    const { hasCompleteValue, totalTwd } = computePortfolioValueForDate(
      currentPositions,
      date,
      priceSeries,
      fxRates
    )

    if (hasCompleteValue) {
      // Insert a synthetic cost-basis point just before the first real
      // market-value point so the chart starts at the deployed capital.
      addedCostPoint = addInitialCostPointIfNeeded(
        series,
        trades,
        fxRates,
        startDate,
        date,
        totalTwd,
        addedCostPoint
      )

      series.push({ date, value: Math.round(totalTwd) })
    }
  }

  return series
}
