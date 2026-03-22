import { describe, expect, it } from "vitest"

import { computeDailyValues } from "@/lib/portfolio/daily-values"
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

    expect(result).toEqual([
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

    // AAPL: 10 - 4 = 6 shares. MSFT: 5 shares.
    // Value: (6 * 100 + 5 * 200) * 32
    expect(result).toEqual([
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

    // TWD — no FX conversion
    expect(result).toEqual([{ date: "2026-03-03", value: 100 * 80 }])
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
})
