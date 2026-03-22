import {
  inferSupportedMarket,
  getQuoteLookupKey,
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
 * Walk trades chronologically and produce a map of date -> position snapshot.
 * Only dates where a trade occurs get an entry; the caller carries forward.
 */
function buildTradeEvents(trades: TradeTableRow[]) {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date))
  const positions = new Map<string, PositionEntry>()
  const events = new Map<string, Map<string, PositionEntry>>()

  for (const trade of sorted) {
    const market = inferSupportedMarket({
      ticker: trade.ticker,
      currency: trade.currency,
    })

    if (!market) {
      continue
    }

    const quoteKey = getQuoteLookupKey({ ticker: trade.ticker, market })
    const existing = positions.get(quoteKey)
    const currentQty = existing?.quantity ?? 0
    const delta = trade.side === "BUY" ? trade.quantity : -trade.quantity
    const nextQty = Math.max(currentQty + delta, 0)

    positions.set(quoteKey, {
      currency: market === "TW" ? "TWD" : "USD",
      quantity: nextQty,
      quoteKey,
    })

    // Snapshot all current positions at this date.
    events.set(trade.date, new Map(positions))
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
