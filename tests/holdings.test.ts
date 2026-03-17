import { describe, expect, it } from "vitest"

import {
  aggregateHoldings,
  applyPreviousCloseQuotes,
  getHoldingKey,
} from "@/lib/portfolio/holdings"
import type { PreviousCloseQuote } from "@/lib/portfolio/schema"

function makeTrade(
  overrides: Partial<{
    currency: string | null
    date: string
    fee: number | null
    id: string
    price: number
    quantity: number
    side: "BUY" | "SELL"
    ticker: string
  }>
) {
  return {
    currency: "USD",
    date: "2026-01-01",
    fee: 0,
    id: crypto.randomUUID(),
    price: 100,
    quantity: 1,
    side: "BUY" as const,
    ticker: "AAPL",
    ...overrides,
  }
}

describe("aggregateHoldings", () => {
  it("computes average cost across multiple buys including buy fees", () => {
    const result = aggregateHoldings([
      makeTrade({ fee: 1, price: 100, quantity: 10 }),
      makeTrade({ date: "2026-01-02", fee: 1, price: 120, quantity: 10 }),
    ])

    expect(result.issues).toEqual([])
    expect(result.holdings).toEqual([
      {
        averageCost: 110.1,
        currency: "USD",
        key: "US:AAPL",
        market: "US",
        quantityOpen: 20,
        ticker: "AAPL",
        totalCostOpen: 2202,
      },
    ])
  })

  it("keeps average cost stable after a partial sell", () => {
    const result = aggregateHoldings([
      makeTrade({ price: 100, quantity: 10 }),
      makeTrade({ date: "2026-01-02", price: 120, quantity: 10 }),
      makeTrade({
        date: "2026-01-03",
        fee: 7,
        price: 130,
        quantity: 5,
        side: "SELL",
      }),
    ])

    expect(result.issues).toEqual([])
    expect(result.holdings[0]).toMatchObject({
      averageCost: 110,
      quantityOpen: 15,
      totalCostOpen: 1650,
    })
  })

  it("removes fully sold positions", () => {
    const result = aggregateHoldings([
      makeTrade({ price: 100, quantity: 10 }),
      makeTrade({
        date: "2026-01-02",
        price: 100,
        quantity: 10,
        side: "SELL",
      }),
    ])

    expect(result.issues).toEqual([])
    expect(result.holdings).toEqual([])
  })

  it("flags oversold positions and excludes them from holdings", () => {
    const result = aggregateHoldings([
      makeTrade({ ticker: "2330", currency: "TWD", quantity: 2 }),
      makeTrade({
        ticker: "2330",
        currency: "TWD",
        date: "2026-01-02",
        quantity: 3,
        side: "SELL",
      }),
    ])

    expect(result.holdings).toEqual([])
    expect(result.issues).toContain(
      "2330: sell quantity exceeds open quantity, so this position is excluded from valuation."
    )
  })

  it("classifies Taiwan numeric tickers into the TWD bucket", () => {
    const result = aggregateHoldings([
      makeTrade({ ticker: "2330", currency: null, quantity: 3 }),
    ])

    expect(result.holdings[0]).toMatchObject({
      currency: "TWD",
      key: "TW:2330",
      market: "TW",
      ticker: "2330",
    })
  })
})

describe("applyPreviousCloseQuotes", () => {
  it("computes market value and weight per currency bucket", () => {
    const { holdings } = aggregateHoldings([
      makeTrade({ price: 100, quantity: 10, ticker: "AAPL" }),
      makeTrade({ date: "2026-01-02", price: 50, quantity: 5, ticker: "MSFT" }),
      makeTrade({
        ticker: "2330",
        currency: "TWD",
        date: "2026-01-03",
        price: 900,
        quantity: 2,
      }),
    ])

    const quotesByKey: Record<string, PreviousCloseQuote> = {
      [getHoldingKey({ market: "US", ticker: "AAPL" })]: {
        asOf: "2026-03-17",
        currency: "USD",
        exchange: "NASDAQ",
        key: "US:AAPL",
        market: "US",
        micCode: "XNAS",
        previousClose: 150,
        ticker: "AAPL",
      },
      [getHoldingKey({ market: "US", ticker: "MSFT" })]: {
        asOf: "2026-03-17",
        currency: "USD",
        exchange: "NASDAQ",
        key: "US:MSFT",
        market: "US",
        micCode: "XNAS",
        previousClose: 50,
        ticker: "MSFT",
      },
      [getHoldingKey({ market: "TW", ticker: "2330" })]: {
        asOf: "2026-03-17",
        currency: "TWD",
        exchange: "TWSE",
        key: "TW:2330",
        market: "TW",
        micCode: "XTAI",
        previousClose: 1000,
        ticker: "2330",
      },
    }

    const result = applyPreviousCloseQuotes(holdings, quotesByKey)
    const usdGroup = result.groups.find((group) => group.currency === "USD")
    const twdGroup = result.groups.find((group) => group.currency === "TWD")

    expect(usdGroup?.totalMarketValue).toBe(1750)
    expect(usdGroup?.holdings[0]).toMatchObject({
      marketValue: 1500,
      ticker: "AAPL",
      weight: 0.857143,
    })
    expect(usdGroup?.holdings[1]).toMatchObject({
      marketValue: 250,
      ticker: "MSFT",
      weight: 0.142857,
    })

    expect(twdGroup?.totalMarketValue).toBe(2000)
    expect(twdGroup?.holdings[0]).toMatchObject({
      marketValue: 2000,
      ticker: "2330",
      weight: 1,
    })
  })

  it("merges Taiwan holdings that resolve to the same numeric ticker", () => {
    const { holdings } = aggregateHoldings([
      makeTrade({
        ticker: "華通",
        currency: "TWD",
        quantity: 1000,
        price: 100,
      }),
      makeTrade({
        ticker: "2313",
        currency: "TWD",
        date: "2026-01-02",
        quantity: 1000,
        price: 120,
      }),
    ])

    const quotesByKey: Record<string, PreviousCloseQuote> = {
      [getHoldingKey({ market: "TW", ticker: "華通" })]: {
        asOf: "2026-03-17",
        currency: "TWD",
        exchange: "TWSE",
        key: "TW:華通",
        market: "TW",
        micCode: "XTAI",
        previousClose: 130,
        ticker: "2313",
      },
      [getHoldingKey({ market: "TW", ticker: "2313" })]: {
        asOf: "2026-03-17",
        currency: "TWD",
        exchange: "TWSE",
        key: "TW:2313",
        market: "TW",
        micCode: "XTAI",
        previousClose: 130,
        ticker: "2313",
      },
    }

    const result = applyPreviousCloseQuotes(holdings, quotesByKey)
    const twdGroup = result.groups.find((group) => group.currency === "TWD")

    expect(twdGroup?.holdings).toHaveLength(1)
    expect(twdGroup?.holdings[0]).toMatchObject({
      averageCost: 110,
      marketValue: 260000,
      quantityOpen: 2000,
      quoteTicker: "2313",
      ticker: "華通",
      totalCostOpen: 220000,
      weight: 1,
    })
  })

  it("recalculates weights from priced holdings when a quote is still pending", () => {
    const { holdings } = aggregateHoldings([
      makeTrade({ ticker: "AAPL", quantity: 10, price: 100 }),
      makeTrade({
        date: "2026-01-02",
        ticker: "MSFT",
        quantity: 5,
        price: 50,
      }),
    ])

    const quotesByKey: Record<string, PreviousCloseQuote> = {
      [getHoldingKey({ market: "US", ticker: "AAPL" })]: {
        asOf: "2026-03-17",
        currency: "USD",
        exchange: "NASDAQ",
        key: "US:AAPL",
        market: "US",
        micCode: "XNAS",
        previousClose: 150,
        ticker: "AAPL",
      },
    }

    const result = applyPreviousCloseQuotes(holdings, quotesByKey)
    const usdGroup = result.groups.find((group) => group.currency === "USD")

    expect(usdGroup?.totalMarketValue).toBeNull()
    expect(usdGroup?.missingPriceCount).toBe(1)
    expect(usdGroup?.holdings[0]).toMatchObject({
      marketValue: 1500,
      ticker: "AAPL",
      weight: 1,
    })
    expect(usdGroup?.holdings[1]).toMatchObject({
      marketValue: null,
      ticker: "MSFT",
      weight: null,
    })
  })
})
