import { describe, expect, it } from "vitest"

import type { ValuedHolding } from "@/lib/portfolio/holdings"
import {
  buildAccountSummaries,
  getAccountSummaryStatus,
  getAccountSummaryValueMetrics,
  getSummaryFxStatus,
  getTotalSummaryStatus,
  getTotalSummaryValues,
} from "@/lib/portfolio/summary-cards"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"

function makeHolding(overrides: Partial<ValuedHolding> = {}): ValuedHolding {
  return {
    account: "Main",
    averageCost: 100,
    currency: "USD",
    exchange: "NASDAQ",
    key: "US:AAPL:MAIN",
    market: "US",
    marketValue: 150,
    micCode: "XNAS",
    previousClose: 150,
    previousCloseDate: "2026-04-03",
    quantityOpen: 1,
    quoteError: null,
    quoteKey: "US:AAPL",
    quoteTicker: "AAPL",
    ticker: "AAPL",
    totalCostOpen: 100,
    weight: 1,
    ...overrides,
  }
}

const fxSnapshot: FxRateSnapshot = {
  asOf: "2026-04-03",
  pair: "USD/TWD",
  rate: 32,
}

describe("getTotalSummaryValues", () => {
  it("returns null total market value when any holding is still missing a quote", () => {
    const summary = getTotalSummaryValues(
      [
        makeHolding(),
        makeHolding({
          key: "US:MSFT:MAIN",
          marketValue: null,
          previousClose: null,
          quoteKey: "US:MSFT",
          quoteTicker: null,
          ticker: "MSFT",
        }),
      ],
      fxSnapshot
    )

    expect(summary.totals.missingMarketCount).toBe(1)
    expect(summary.totalCostTwd).toBe(6400)
    expect(summary.totalMarketValueTwd).toBeNull()
  })

  it("counts each FX-blocked USD holding once when totals are pending", () => {
    const summary = getTotalSummaryValues(
      [
        makeHolding(),
        makeHolding({
          key: "US:MSFT:MAIN",
          marketValue: 300,
          previousClose: 300,
          quoteKey: "US:MSFT",
          quoteTicker: "MSFT",
          ticker: "MSFT",
          totalCostOpen: 200,
        }),
      ],
      null
    )

    expect(summary.totals.needsFxCount).toBe(2)
    expect(summary.totalNeedsFx).toBe(true)
    expect(summary.totalCostTwd).toBeNull()
    expect(summary.totalMarketValueTwd).toBeNull()
  })
})

describe("getSummaryFxStatus", () => {
  it("treats TWD-only portfolios as not requiring FX status", () => {
    const status = getSummaryFxStatus(
      [
        makeHolding({
          currency: "TWD",
          key: "TW:2330:MAIN",
          market: "TW",
          marketValue: 1200,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
          totalCostOpen: 900,
        }),
      ],
      null
    )

    expect(status).toBe("not-required")
  })

  it("marks USD portfolios as pending when the FX snapshot is unavailable", () => {
    const status = getSummaryFxStatus([makeHolding()], null)

    expect(status).toBe("pending")
  })

  it("marks USD portfolios as ready when the FX snapshot is available", () => {
    const status = getSummaryFxStatus([makeHolding()], fxSnapshot)

    expect(status).toBe("ready")
  })
})

describe("getTotalSummaryStatus", () => {
  it("treats missing market prices as the primary pending state", () => {
    const status = getTotalSummaryStatus(
      [
        makeHolding(),
        makeHolding({
          key: "US:MSFT:MAIN",
          marketValue: null,
          previousClose: null,
          quoteKey: "US:MSFT",
          quoteTicker: null,
          ticker: "MSFT",
        }),
      ],
      null
    )

    expect(status).toBe("price-pending")
  })

  it("reports FX pending only when prices are complete but conversion is blocked", () => {
    const status = getTotalSummaryStatus(
      [
        makeHolding(),
        makeHolding({
          currency: "TWD",
          key: "TW:2330:MAIN",
          market: "TW",
          marketValue: 1200,
          previousClose: 600,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
          totalCostOpen: 900,
        }),
      ],
      null
    )

    expect(status).toBe("fx-pending")
  })
})

describe("buildAccountSummaries", () => {
  it("returns null account value when a single-currency account has missing prices", () => {
    const [account] = buildAccountSummaries(
      [
        makeHolding(),
        makeHolding({
          key: "US:MSFT:MAIN",
          marketValue: null,
          previousClose: null,
          quoteKey: "US:MSFT",
          quoteTicker: null,
          ticker: "MSFT",
        }),
      ],
      fxSnapshot
    )

    expect(account.account).toBe("Main")
    expect(account.missingMarketCount).toBe(1)
    expect(account.marketValue).toBeNull()
    expect(account.marketValueTwd).toBeNull()
  })

  it("marks fully priced USD accounts as FX-pending when no FX snapshot is available", () => {
    const [account] = buildAccountSummaries(
      [
        makeHolding(),
        makeHolding({
          key: "US:MSFT:MAIN",
          marketValue: 300,
          previousClose: 300,
          quoteKey: "US:MSFT",
          quoteTicker: "MSFT",
          ticker: "MSFT",
          totalCostOpen: 200,
        }),
      ],
      null
    )

    expect(account.account).toBe("Main")
    expect(account.cost).toBe(300)
    expect(account.marketValue).toBe(450)
    expect(account.marketValueTwd).toBeNull()
    expect(account.needsFxCount).toBe(1)
    expect(getAccountSummaryStatus(account)).toBe("fx-pending")
  })

  it("returns null mixed-currency account value until all holdings are fully valued", () => {
    const [account] = buildAccountSummaries(
      [
        makeHolding({
          account: "Global",
          key: "US:AAPL:GLOBAL",
          quoteKey: "US:AAPL",
        }),
        makeHolding({
          account: "Global",
          currency: "TWD",
          exchange: "TWSE",
          key: "TW:2330:GLOBAL",
          market: "TW",
          marketValue: null,
          micCode: "XTAI",
          previousClose: null,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
          totalCostOpen: 900,
        }),
      ],
      fxSnapshot
    )

    expect(account.account).toBe("Global")
    expect(account.displayCurrency).toBe("TWD")
    expect(account.cost).toBe(4100)
    expect(account.marketValueTwd).toBeNull()
    expect(getAccountSummaryStatus(account)).toBe("price-pending")
  })

  it("converts mixed-currency account cost into TWD once all holdings are valued", () => {
    const [account] = buildAccountSummaries(
      [
        makeHolding({
          account: "Global",
          key: "US:AAPL:GLOBAL",
          marketValue: 150,
          quoteKey: "US:AAPL",
          totalCostOpen: 100,
        }),
        makeHolding({
          account: "Global",
          currency: "TWD",
          exchange: "TWSE",
          key: "TW:2330:GLOBAL",
          market: "TW",
          marketValue: 1200,
          micCode: "XTAI",
          previousClose: 600,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
          totalCostOpen: 900,
        }),
      ],
      fxSnapshot
    )

    expect(account.account).toBe("Global")
    expect(account.displayCurrency).toBe("TWD")
    expect(account.cost).toBe(4100)
    expect(account.marketValueTwd).toBe(6000)
    expect(getAccountSummaryStatus(account)).toBe("ready")
  })

  it("treats mixed-currency accounts with complete prices but missing FX as FX-pending", () => {
    const [account] = buildAccountSummaries(
      [
        makeHolding({
          account: "Global",
          key: "US:AAPL:GLOBAL",
          marketValue: 150,
          quoteKey: "US:AAPL",
          totalCostOpen: 100,
        }),
        makeHolding({
          account: "Global",
          currency: "TWD",
          exchange: "TWSE",
          key: "TW:2330:GLOBAL",
          market: "TW",
          marketValue: 1200,
          micCode: "XTAI",
          previousClose: 600,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
          totalCostOpen: 900,
        }),
      ],
      null
    )

    expect(account.account).toBe("Global")
    expect(account.cost).toBeNull()
    expect(account.marketValueTwd).toBeNull()
    expect(account.needsFxCount).toBe(1)
    expect(getAccountSummaryStatus(account)).toBe("fx-pending")
  })
})

describe("getAccountSummaryValueMetrics", () => {
  it("converts fully valued mixed-currency accounts into TWD change metrics", () => {
    const [account] = buildAccountSummaries(
      [
        makeHolding({
          account: "Global",
          key: "US:AAPL:GLOBAL",
          marketValue: 150,
          quoteKey: "US:AAPL",
          totalCostOpen: 100,
        }),
        makeHolding({
          account: "Global",
          currency: "TWD",
          exchange: "TWSE",
          key: "TW:2330:GLOBAL",
          market: "TW",
          marketValue: 1200,
          micCode: "XTAI",
          previousClose: 600,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
          totalCostOpen: 900,
        }),
      ],
      fxSnapshot
    )

    const metrics = getAccountSummaryValueMetrics(account, fxSnapshot)

    expect(metrics).toEqual({
      changeAmountTwd: 1900,
      changeRatio: 1900 / 4100,
      costTwd: 4100,
      marketValueTwd: 6000,
    })
  })

  it("keeps TWD change metrics pending when FX conversion is unavailable", () => {
    const [account] = buildAccountSummaries([makeHolding()], null)

    const metrics = getAccountSummaryValueMetrics(account, null)

    expect(metrics).toEqual({
      changeAmountTwd: null,
      changeRatio: null,
      costTwd: null,
      marketValueTwd: null,
    })
  })

  it("keeps mixed-currency market change pending while retaining converted cost basis", () => {
    const [account] = buildAccountSummaries(
      [
        makeHolding({
          account: "Global",
          key: "US:AAPL:GLOBAL",
          marketValue: 150,
          quoteKey: "US:AAPL",
          totalCostOpen: 100,
        }),
        makeHolding({
          account: "Global",
          currency: "TWD",
          exchange: "TWSE",
          key: "TW:2330:GLOBAL",
          market: "TW",
          marketValue: null,
          micCode: "XTAI",
          previousClose: null,
          quoteKey: "TW:2330",
          quoteTicker: "2330",
          ticker: "2330",
          totalCostOpen: 900,
        }),
      ],
      fxSnapshot
    )

    const metrics = getAccountSummaryValueMetrics(account, fxSnapshot)

    expect(metrics).toEqual({
      changeAmountTwd: null,
      changeRatio: null,
      costTwd: 4100,
      marketValueTwd: null,
    })
  })
})
