import { describe, expect, it } from "vitest"

import {
  buildCurrentPortfolioSnapshot,
  convertMarketValueToUsd,
} from "@/lib/portfolio/current-snapshot"
import type { ValuedHolding } from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"

const fxSnapshot: FxRateSnapshot = {
  asOf: "2026-04-29",
  pair: "USD/TWD",
  rate: 31,
}

function makeHolding(overrides: Partial<ValuedHolding>): ValuedHolding {
  return {
    account: null,
    averageCost: 90,
    currency: "USD",
    exchange: "NASDAQ",
    key: "US:AAPL",
    market: "US",
    marketValue: 1000,
    micCode: "XNAS",
    previousClose: 100,
    previousCloseDate: "2026-04-29",
    quantityOpen: 10,
    quoteError: null,
    quoteKey: "US:AAPL",
    quoteTicker: "AAPL",
    ticker: "AAPL",
    totalCostOpen: 900,
    weight: null,
    ...overrides,
  }
}

describe("convertMarketValueToUsd", () => {
  it("keeps USD values unchanged and converts TWD with the EOD FX rate", () => {
    expect(
      convertMarketValueToUsd({
        currency: "USD",
        fxSnapshot,
        value: 1000,
      })
    ).toBe(1000)
    expect(
      convertMarketValueToUsd({
        currency: "TWD",
        fxSnapshot,
        value: 31_000,
      })
    ).toBe(1000)
  })
})

describe("buildCurrentPortfolioSnapshot", () => {
  it("builds USD weights across USD and TWD holdings", () => {
    const snapshot = buildCurrentPortfolioSnapshot({
      fxSnapshot,
      holdings: [
        makeHolding({ ticker: "AAPL" }),
        makeHolding({
          currency: "TWD",
          exchange: "TWSE",
          key: "TW:2330",
          market: "TW",
          marketValue: 31_000,
          micCode: "XTAI",
          previousClose: 1000,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
        }),
      ],
    })

    expect(snapshot.totalUsd).toBe(2000)
    expect(snapshot.isComplete).toBe(true)
    expect(snapshot.holdings.map((holding) => holding.weight)).toEqual([
      0.5, 0.5,
    ])
    expect(snapshot.quoteDates).toEqual(["2026-04-29"])
  })

  it("weights leveraged ETFs by their effective exposure", () => {
    const snapshot = buildCurrentPortfolioSnapshot({
      fxSnapshot,
      holdings: [
        makeHolding({
          key: "US:AMDL",
          marketValue: 1000,
          quoteKey: "US:AMDL",
          quoteTicker: "AMDL",
          ticker: "AMDL",
        }),
        makeHolding({
          key: "US:AMD",
          marketValue: 500,
          quoteKey: "US:AMD",
          quoteTicker: "AMD",
          ticker: "AMD",
        }),
      ],
    })

    expect(snapshot.totalUsd).toBe(1500)
    expect(snapshot.effectiveTotalUsd).toBe(2500)
    expect(
      snapshot.holdings.map((holding) => ({
        effectiveMultiplier: holding.effectiveMultiplier,
        effectiveValueUsd: holding.effectiveValueUsd,
        marketValueUsd: holding.marketValueUsd,
        ticker: holding.ticker,
        weight: holding.weight,
      }))
    ).toEqual([
      {
        effectiveMultiplier: 2,
        effectiveValueUsd: 2000,
        marketValueUsd: 1000,
        ticker: "AMDL",
        weight: 0.8,
      },
      {
        effectiveMultiplier: 1,
        effectiveValueUsd: 500,
        marketValueUsd: 500,
        ticker: "AMD",
        weight: 0.2,
      },
    ])
  })

  it("marks converted value incomplete when TWD holdings need FX", () => {
    const snapshot = buildCurrentPortfolioSnapshot({
      fxSnapshot: null,
      holdings: [
        makeHolding({
          currency: "TWD",
          key: "TW:2330",
          market: "TW",
          marketValue: 31_000,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
        }),
      ],
    })

    expect(snapshot.totalUsd).toBe(0)
    expect(snapshot.missingFxCount).toBe(1)
    expect(snapshot.isComplete).toBe(false)
  })
})

