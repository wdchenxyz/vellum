import { beforeEach, describe, expect, it, vi } from "vitest"

import type { AggregatedHolding } from "@/lib/portfolio/holdings"
import type { DailyPriceSeries } from "@/lib/quotes/history-cache"
import type { TradeTableRow } from "@/lib/trades/schema"

const mocks = vi.hoisted(() => ({
  aggregateHoldings: vi.fn(),
  computeBenchmarkSeries: vi.fn(),
  computeDailyValues: vi.fn(),
  fetchBenchmarkHistory: vi.fn(),
  fetchFxHistory: vi.fn(),
  fetchTickerHistory: vi.fn(),
  fetchUsdTwdFxSnapshot: vi.fn(),
}))

vi.mock("@/lib/portfolio/holdings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/portfolio/holdings")>(
    "@/lib/portfolio/holdings"
  )

  return {
    ...actual,
    aggregateHoldings: mocks.aggregateHoldings,
  }
})

vi.mock("@/lib/portfolio/daily-values", () => ({
  computeBenchmarkSeries: mocks.computeBenchmarkSeries,
  computeDailyValues: mocks.computeDailyValues,
}))

vi.mock("@/lib/quotes/history", () => ({
  fetchBenchmarkHistory: mocks.fetchBenchmarkHistory,
  fetchFxHistory: mocks.fetchFxHistory,
  fetchTickerHistory: mocks.fetchTickerHistory,
}))

vi.mock("@/lib/quotes/twelve-data", () => ({
  fetchUsdTwdFxSnapshot: mocks.fetchUsdTwdFxSnapshot,
}))

import { computeDailyValuesFromTrades } from "@/lib/portfolio/daily-values-service"

function makeTrade(
  overrides: Partial<TradeTableRow> & { date: string; ticker: string }
): TradeTableRow {
  return {
    account: null,
    currency: "USD",
    id: `trade-${overrides.ticker}-${overrides.date}-${overrides.side ?? "BUY"}`,
    price: 100,
    quantity: 1,
    side: "BUY",
    sourceFile: "test",
    totalAmount: 100,
    ...overrides,
  }
}

function makeHolding(
  overrides: Partial<AggregatedHolding> & {
    key: string
    market: "US" | "TW"
    quoteKey: string
    ticker: string
  }
): AggregatedHolding {
  return {
    account: null,
    averageCost: 100,
    currency: "USD",
    quantityOpen: 1,
    totalCostOpen: 100,
    ...overrides,
  }
}

describe("computeDailyValuesFromTrades", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.aggregateHoldings.mockReturnValue({ holdings: [], issues: [] })
    mocks.computeBenchmarkSeries.mockReturnValue([])
    mocks.computeDailyValues.mockReturnValue([])
    mocks.fetchBenchmarkHistory.mockResolvedValue({ spx: {}, twii: {} })
    mocks.fetchFxHistory.mockResolvedValue({})
    mocks.fetchTickerHistory.mockResolvedValue({})
    mocks.fetchUsdTwdFxSnapshot.mockResolvedValue({ rate: 32 })
  })

  it("returns the shared empty result for empty trades", async () => {
    const result = await computeDailyValuesFromTrades([])

    expect(result).toEqual({
      benchmarks: { spx: [], twii: [] },
      costBasisTwd: 0,
      issues: [],
      series: [],
    })
    expect(mocks.aggregateHoldings).not.toHaveBeenCalled()
  })

  it("deduplicates quote history fetches and computes cost basis in TWD", async () => {
    const trades = [
      makeTrade({ date: "2026-03-01", ticker: "AAPL" }),
      makeTrade({ account: "IBKR", date: "2026-03-02", ticker: "AAPL" }),
      makeTrade({
        currency: "TWD",
        date: "2026-03-03",
        ticker: "2330",
        totalAmount: 900,
      }),
    ]
    const holdings = [
      makeHolding({
        key: "US:AAPL:FIRSTRADE",
        account: "Firstrade",
        quoteKey: "US:AAPL",
        ticker: "AAPL",
        totalCostOpen: 100,
        market: "US",
      }),
      makeHolding({
        key: "US:AAPL:IBKR",
        account: "IBKR",
        quoteKey: "US:AAPL",
        ticker: "AAPL",
        totalCostOpen: 50,
        market: "US",
      }),
      makeHolding({
        key: "TW:2330",
        currency: "TWD",
        market: "TW",
        quoteKey: "TW:2330",
        ticker: "2330",
        totalCostOpen: 900,
      }),
    ]
    const aaplSeries: DailyPriceSeries = { "2026-03-04": 110 }
    const twSeries: DailyPriceSeries = { "2026-03-04": 950 }

    mocks.aggregateHoldings.mockReturnValue({ holdings, issues: [] })
    mocks.fetchFxHistory.mockResolvedValue({ "2026-03-04": 32 })
    mocks.fetchTickerHistory.mockImplementation(async ({ key }) => {
      if (key === "US:AAPL") {
        return aaplSeries
      }

      return twSeries
    })
    mocks.computeDailyValues.mockReturnValue([{ date: "2026-03-04", value: 1 }])
    mocks.computeBenchmarkSeries
      .mockReturnValueOnce([{ date: "2026-03-04", value: 2 }])
      .mockReturnValueOnce([{ date: "2026-03-04", value: 3 }])

    const result = await computeDailyValuesFromTrades(trades)
    const priceSeries = mocks.computeDailyValues.mock.calls[0]?.[1] as Map<
      string,
      DailyPriceSeries
    >

    expect(mocks.fetchTickerHistory).toHaveBeenCalledTimes(2)
    expect(mocks.fetchTickerHistory).toHaveBeenNthCalledWith(1, {
      key: "US:AAPL",
      market: "US",
      ticker: "AAPL",
    }, "2026-03-01")
    expect(mocks.fetchTickerHistory).toHaveBeenNthCalledWith(2, {
      key: "TW:2330",
      market: "TW",
      ticker: "2330",
    }, "2026-03-01")
    expect(priceSeries.get("US:AAPL")).toEqual(aaplSeries)
    expect(priceSeries.get("TW:2330")).toEqual(twSeries)
    expect(result).toEqual({
      benchmarks: {
        spx: [{ date: "2026-03-04", value: 2 }],
        twii: [{ date: "2026-03-04", value: 3 }],
      },
      costBasisTwd: 5700,
      issues: [],
      series: [{ date: "2026-03-04", value: 1 }],
    })
  })

  it("keeps computed series when benchmark history is unavailable", async () => {
    const trades = [makeTrade({ date: "2026-03-01", ticker: "AAPL" })]
    const holdings = [
      makeHolding({
        key: "US:AAPL",
        market: "US",
        quoteKey: "US:AAPL",
        ticker: "AAPL",
      }),
    ]

    mocks.aggregateHoldings.mockReturnValue({ holdings, issues: [] })
    mocks.fetchTickerHistory.mockRejectedValue(new Error("ticker unavailable"))
    mocks.computeDailyValues.mockReturnValue([{ date: "2026-03-04", value: 123 }])
    mocks.fetchBenchmarkHistory.mockRejectedValue(new Error("benchmark unavailable"))

    const result = await computeDailyValuesFromTrades(trades)

    expect(result).toEqual({
      benchmarks: { spx: [], twii: [] },
      costBasisTwd: 3200,
      issues: ["US:AAPL: ticker unavailable"],
      series: [{ date: "2026-03-04", value: 123 }],
    })
    expect(mocks.computeBenchmarkSeries).not.toHaveBeenCalled()
  })

  it("keeps TWD cost basis pending when USD holdings lack a spot FX snapshot", async () => {
    const trades = [makeTrade({ date: "2026-03-01", ticker: "AAPL" })]
    const holdings = [
      makeHolding({
        key: "US:AAPL",
        market: "US",
        quoteKey: "US:AAPL",
        ticker: "AAPL",
      }),
    ]

    mocks.aggregateHoldings.mockReturnValue({ holdings, issues: [] })
    mocks.fetchUsdTwdFxSnapshot.mockResolvedValue(null)

    const result = await computeDailyValuesFromTrades(trades)

    expect(result.costBasisTwd).toBeNull()
  })
})
