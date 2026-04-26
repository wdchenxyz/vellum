import { describe, expect, it } from "vitest"

import {
  computeBenchmarkSeries,
  computeDailyValues,
} from "@/lib/portfolio/daily-values"
import type { DailyPriceSeries } from "@/lib/quotes/history-cache"
import type { TradeTableRow } from "@/lib/trades/schema"

function makeTrade(
  overrides: Partial<TradeTableRow> & { date: string; ticker: string }
): TradeTableRow {
  return {
    account: null,
    currency: "USD",
    id: `trade-${overrides.ticker}-${overrides.date}-${overrides.side ?? "BUY"}`,
    price: 100,
    quantity: 10,
    side: "BUY",
    sourceFile: "test",
    totalAmount: 1000,
    ...overrides,
  }
}

function makePrices(entries: Record<string, number>): DailyPriceSeries {
  return entries
}

describe("computeDailyValues", () => {
  it("computes value for a single BUY", () => {
    const trades = [makeTrade({ date: "2026-03-01", ticker: "AAPL" })]

    const prices = new Map([["US:AAPL", makePrices({ "2026-03-03": 105 })]])
    const fxRates = makePrices({ "2026-03-03": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // Synthetic cost-basis point on trade date + market value on first trading date
    expect(result).toEqual([
      { date: "2026-03-01", value: Math.round(1000 * 32) },
      { date: "2026-03-03", value: Math.round(10 * 105 * 32) },
    ])
  })

  it("reduces position on SELL", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 10 }),
      makeTrade({
        date: "2026-03-02",
        ticker: "AAPL",
        quantity: 3,
        side: "SELL",
      }),
    ]

    const prices = new Map([["US:AAPL", makePrices({ "2026-03-03": 100 })]])
    const fxRates = makePrices({ "2026-03-03": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // 10 - 3 = 7 shares
    expect(result).toEqual([
      { date: "2026-03-03", value: Math.round(7 * 100 * 32) },
    ])
  })

  it("clamps to zero on oversell", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 5 }),
      makeTrade({
        date: "2026-03-02",
        ticker: "AAPL",
        quantity: 10,
        side: "SELL",
      }),
    ]

    const prices = new Map([["US:AAPL", makePrices({ "2026-03-03": 100 })]])
    const fxRates = makePrices({ "2026-03-03": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // Clamped to 0 — no value
    expect(result).toEqual([])
  })

  it("tracks per-account so cross-account sell does not reduce other accounts", () => {
    const trades = [
      makeTrade({
        date: "2026-03-01",
        ticker: "AAPL",
        quantity: 10,
        account: "Account A",
      }),
      makeTrade({
        date: "2026-03-02",
        ticker: "AAPL",
        quantity: 3,
        side: "SELL",
        account: "Account B",
      }),
    ]

    const prices = new Map([["US:AAPL", makePrices({ "2026-03-03": 100 })]])
    const fxRates = makePrices({ "2026-03-03": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // Account B's sell is clamped to 0 (it has no shares).
    // Account A still has 10. Total = 10.
    expect(result).toEqual([
      { date: "2026-03-03", value: Math.round(10 * 100 * 32) },
    ])
  })

  it("handles interleaved BUY/SELL across multiple tickers", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 10 }),
      makeTrade({
        date: "2026-03-02",
        ticker: "MSFT",
        quantity: 5,
        price: 200,
        totalAmount: 1000,
      }),
      makeTrade({
        date: "2026-03-03",
        ticker: "AAPL",
        quantity: 4,
        side: "SELL",
      }),
    ]

    const prices = new Map([
      ["US:AAPL", makePrices({ "2026-03-03": 100 })],
      ["US:MSFT", makePrices({ "2026-03-03": 200 })],
    ])
    const fxRates = makePrices({ "2026-03-03": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // Synthetic cost point for first trade (AAPL cost=1000 USD * FX 32)
    // then market value on Mar 3: AAPL: 10 - 4 = 6, MSFT: 5
    expect(result).toEqual([
      { date: "2026-03-01", value: Math.round(1000 * 32) },
      { date: "2026-03-03", value: Math.round((6 * 100 + 5 * 200) * 32) },
    ])
  })

  it("handles TWD holdings without FX conversion", () => {
    const trades = [
      makeTrade({
        date: "2026-03-01",
        ticker: "0050",
        quantity: 100,
        currency: "TWD",
      }),
    ]

    const prices = new Map([["TW:0050", makePrices({ "2026-03-03": 80 })]])
    const fxRates = makePrices({})

    const result = computeDailyValues(trades, prices, fxRates)

    // Synthetic cost point (TWD — totalAmount directly) + market value
    expect(result).toEqual([
      { date: "2026-03-01", value: 1000 },
      { date: "2026-03-03", value: 100 * 80 },
    ])
  })

  it("same-day BUY then SELL uses insertion order", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 10 }),
      makeTrade({
        date: "2026-03-01",
        ticker: "AAPL",
        quantity: 3,
        side: "SELL",
      }),
    ]

    const prices = new Map([["US:AAPL", makePrices({ "2026-03-01": 100 })]])
    const fxRates = makePrices({ "2026-03-01": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // BUY 10, then SELL 3 on same day = 7
    expect(result).toEqual([
      { date: "2026-03-01", value: Math.round(7 * 100 * 32) },
    ])
  })

  it("full close removes position from valuation", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 10 }),
      makeTrade({
        date: "2026-03-02",
        ticker: "AAPL",
        quantity: 10,
        side: "SELL",
      }),
    ]

    const prices = new Map([["US:AAPL", makePrices({ "2026-03-03": 100 })]])
    const fxRates = makePrices({ "2026-03-03": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // Fully closed — no value
    expect(result).toEqual([])
  })

  it("returns empty for no trades", () => {
    const result = computeDailyValues([], new Map(), {})

    expect(result).toEqual([])
  })

  it("skips USD positions on dates before FX data exists", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 10 }),
    ]

    // Price data starts on 2026-03-03, but FX data only starts on 2026-03-05.
    const prices = new Map([
      ["US:AAPL", makePrices({ "2026-03-03": 100, "2026-03-05": 105 })],
    ])
    const fxRates = makePrices({ "2026-03-05": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // On 2026-03-03 FX is null — USD position is skipped (no zero dip).
    // The first point with a valid FX rate is 2026-03-05.
    // A synthetic cost-basis point is inserted at the trade date using the
    // first available FX rate.
    expect(result).toEqual([
      { date: "2026-03-01", value: Math.round(1000 * 32) },
      { date: "2026-03-05", value: Math.round(10 * 105 * 32) },
    ])
  })

  it("mixed USD + TWD portfolio with FX gap", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 10 }),
      makeTrade({
        date: "2026-03-01",
        ticker: "0050",
        quantity: 100,
        currency: "TWD",
      }),
    ]

    // Both have prices on 2026-03-03, but FX only available on 2026-03-05.
    const prices = new Map([
      ["US:AAPL", makePrices({ "2026-03-03": 100, "2026-03-05": 105 })],
      ["TW:0050", makePrices({ "2026-03-03": 80, "2026-03-05": 82 })],
    ])
    const fxRates = makePrices({ "2026-03-05": 32 })

    const result = computeDailyValues(trades, prices, fxRates)

    // On 2026-03-03 the portfolio is still missing USD FX coverage, so the
    // total asset value stays pending instead of emitting a partial TWD-only
    // total. On 2026-03-05 both positions are fully valued.
    expect(result).toEqual([
      { date: "2026-03-01", value: Math.round(1000 * 32 + 1000) },
      { date: "2026-03-05", value: Math.round(10 * 105 * 32 + 100 * 82) },
    ])
  })

  it("waits for every open holding to have market prices before emitting a daily asset value", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", quantity: 10 }),
      makeTrade({
        date: "2026-03-01",
        ticker: "0050",
        quantity: 100,
        currency: "TWD",
      }),
    ]

    const prices = new Map([
      ["US:AAPL", makePrices({ "2026-03-03": 100, "2026-03-04": 102 })],
      ["TW:0050", makePrices({ "2026-03-04": 80 })],
    ])
    const fxRates = makePrices({
      "2026-03-03": 32,
      "2026-03-04": 32,
    })

    const result = computeDailyValues(trades, prices, fxRates)

    expect(result).toEqual([
      { date: "2026-03-01", value: Math.round(1000 * 32 + 1000) },
      { date: "2026-03-04", value: Math.round(10 * 102 * 32 + 100 * 80) },
    ])
  })

  it("synthetic cost point only includes trades up to the reference date", () => {
    // Two purchases far apart in time (all dates in the past).
    const trades = [
      makeTrade({
        date: "2025-01-10",
        ticker: "AAPL",
        quantity: 10,
        totalAmount: 1000,
      }),
      makeTrade({
        date: "2025-02-10",
        ticker: "MSFT",
        quantity: 5,
        price: 200,
        totalAmount: 1000,
      }),
    ]

    const prices = new Map([
      ["US:AAPL", makePrices({ "2025-01-13": 105, "2025-02-12": 110 })],
      ["US:MSFT", makePrices({ "2025-02-12": 200 })],
    ])
    const fxRates = makePrices({
      "2025-01-13": 32,
      "2025-02-12": 33,
    })

    const result = computeDailyValues(trades, prices, fxRates)

    // Synthetic cost point at startDate ("2025-01-10") should only count the
    // AAPL trade (1000 * 32 = 32000), NOT the later MSFT trade.
    expect(result[0]).toEqual({
      date: "2025-01-10",
      value: Math.round(1000 * 32),
    })

    // 2025-01-13: only AAPL position
    expect(result[1]).toEqual({
      date: "2025-01-13",
      value: Math.round(10 * 105 * 32),
    })

    // 2025-02-12: both positions (AAPL + MSFT)
    expect(result[2]).toEqual({
      date: "2025-02-12",
      value: Math.round(10 * 110 * 33 + 5 * 200 * 33),
    })
  })
})

describe("computeBenchmarkSeries", () => {
  it("adds a synthetic cost point before the first benchmark value", () => {
    const trades = [makeTrade({ date: "2026-03-01", ticker: "AAPL" })]

    const result = computeBenchmarkSeries(
      trades,
      makePrices({ "2026-03-03": 100 }),
      makePrices({ "2026-03-03": 32 }),
      ["2026-03-03"],
      true
    )

    expect(result).toEqual([
      { date: "2026-03-01", value: 32000 },
      { date: "2026-03-03", value: 32000 },
    ])
  })

  it("defers applying trades until the benchmark has a usable price", () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL", totalAmount: 1000 }),
      makeTrade({
        date: "2026-03-02",
        ticker: "AAPL",
        side: "SELL",
        totalAmount: 250,
      }),
    ]

    const result = computeBenchmarkSeries(
      trades,
      makePrices({ "2026-03-01": 100, "2026-03-03": 100 }),
      makePrices({ "2026-03-03": 32 }),
      ["2026-03-01", "2026-03-03"],
      true
    )

    expect(result).toEqual([
      { date: "2026-03-01", value: 24000 },
      { date: "2026-03-03", value: 24000 },
    ])
  })

  it("uses benchmark prices directly for TWD-denominated series", () => {
    const trades = [
      makeTrade({
        currency: "TWD",
        date: "2026-03-01",
        ticker: "0050",
        totalAmount: 8000,
      }),
    ]

    const result = computeBenchmarkSeries(
      trades,
      makePrices({ "2026-03-03": 80 }),
      makePrices({}),
      ["2026-03-03"],
      false
    )

    expect(result).toEqual([
      { date: "2026-03-01", value: 8000 },
      { date: "2026-03-03", value: 8000 },
    ])
  })
})
