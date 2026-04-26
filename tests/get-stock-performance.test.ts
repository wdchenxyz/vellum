import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  aggregateHoldings: vi.fn(),
  fetchTickerHistory: vi.fn(),
  readStoredTradeRows: vi.fn(),
}))

vi.mock("@/lib/portfolio/holdings", () => ({
  aggregateHoldings: mocks.aggregateHoldings,
}))

vi.mock("@/lib/quotes/history", () => ({
  fetchTickerHistory: mocks.fetchTickerHistory,
}))

vi.mock("@/lib/trades/storage", () => ({
  readStoredTradeRows: mocks.readStoredTradeRows,
}))

import { getStockPerformance } from "@/lib/tools/get-stock-performance"

describe("getStockPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns a no-trades issue before aggregating holdings", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([])

    const result = await getStockPerformance.execute?.({
      dateFrom: "2026-01-01",
    })

    expect(mocks.aggregateHoldings).not.toHaveBeenCalled()
    expect(result).toEqual({
      stocks: [],
      issues: ["No trades found."],
    })
  })

  it("filters matching holdings, deduplicates quote fetches, and sorts by return", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.aggregateHoldings.mockReturnValue({
      holdings: [
        {
          ticker: "AAPL",
          quoteKey: "US:AAPL",
          market: "US",
          currency: "USD",
        },
        {
          ticker: "AAPL",
          quoteKey: "US:AAPL",
          market: "US",
          currency: "USD",
        },
        {
          ticker: "TSM",
          quoteKey: "US:TSM",
          market: "US",
          currency: "USD",
        },
      ],
      issues: ["aggregation issue"],
    })
    mocks.fetchTickerHistory.mockImplementation(async ({ ticker }) => {
      if (ticker === "AAPL") {
        return {
          "2026-01-01": 100,
          "2026-03-01": 120,
        }
      }

      return {
        "2026-01-01": 100,
        "2026-03-01": 90,
      }
    })

    const result = await getStockPerformance.execute?.({
      dateFrom: "2026-01-01",
      tickers: [" aa ", "tsm"],
    })

    expect(mocks.fetchTickerHistory).toHaveBeenCalledTimes(2)
    expect(mocks.fetchTickerHistory).toHaveBeenNthCalledWith(
      1,
      { key: "US:AAPL", ticker: "AAPL", market: "US" },
      "2026-01-01"
    )
    expect(mocks.fetchTickerHistory).toHaveBeenNthCalledWith(
      2,
      { key: "US:TSM", ticker: "TSM", market: "US" },
      "2026-01-01"
    )
    expect(result).toEqual({
      stocks: [
        {
          ticker: "AAPL",
          market: "US",
          currency: "USD",
          startDate: "2026-01-01",
          startPrice: 100,
          endDate: "2026-03-01",
          endPrice: 120,
          returnPct: 20,
        },
        {
          ticker: "TSM",
          market: "US",
          currency: "USD",
          startDate: "2026-01-01",
          startPrice: 100,
          endDate: "2026-03-01",
          endPrice: 90,
          returnPct: -10,
        },
      ],
      issues: ["aggregation issue"],
    })
  })

  it("preserves aggregation issues and reports fetch failures or missing price data", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.aggregateHoldings.mockReturnValue({
      holdings: [
        {
          ticker: "AAPL",
          quoteKey: "US:AAPL",
          market: "US",
          currency: "USD",
        },
        {
          ticker: "MSFT",
          quoteKey: "US:MSFT",
          market: "US",
          currency: "USD",
        },
        {
          ticker: "NVDA",
          quoteKey: "US:NVDA",
          market: "US",
          currency: "USD",
        },
      ],
      issues: ["aggregation issue"],
    })
    mocks.fetchTickerHistory.mockImplementation(async ({ ticker }) => {
      if (ticker === "AAPL") {
        return {
          "2026-01-01": 100,
          "2026-03-01": 130,
        }
      }

      if (ticker === "MSFT") {
        return {}
      }

      throw new Error("history unavailable")
    })

    const result = await getStockPerformance.execute?.({
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
    })

    expect(result).toEqual({
      stocks: [
        {
          ticker: "AAPL",
          market: "US",
          currency: "USD",
          startDate: "2026-01-01",
          startPrice: 100,
          endDate: "2026-03-01",
          endPrice: 130,
          returnPct: 30,
        },
      ],
      issues: [
        "aggregation issue",
        "MSFT: insufficient price data.",
        "NVDA: history unavailable",
      ],
    })
  })
})
