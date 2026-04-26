import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  aggregateHoldings: vi.fn(),
  applyPreviousCloseQuotes: vi.fn(),
  fetchPreviousCloseSnapshots: vi.fn(),
  fetchUsdTwdFxSnapshot: vi.fn(),
  readStoredTradeRows: vi.fn(),
}))

vi.mock("@/lib/portfolio/holdings", () => ({
  aggregateHoldings: mocks.aggregateHoldings,
  applyPreviousCloseQuotes: mocks.applyPreviousCloseQuotes,
}))

vi.mock("@/lib/quotes/twelve-data", () => ({
  fetchPreviousCloseSnapshots: mocks.fetchPreviousCloseSnapshots,
  fetchUsdTwdFxSnapshot: mocks.fetchUsdTwdFxSnapshot,
}))

vi.mock("@/lib/trades/storage", () => ({
  readStoredTradeRows: mocks.readStoredTradeRows,
}))

import { getHoldings } from "@/lib/tools/get-holdings"

describe("getHoldings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchUsdTwdFxSnapshot.mockResolvedValue({
      asOf: "2026-04-03",
      pair: "USD/TWD",
      rate: 32,
    })
  })

  it("returns an empty response when there are no stored trades", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([])

    const result = await getHoldings.execute?.({})

    expect(mocks.aggregateHoldings).not.toHaveBeenCalled()
    expect(mocks.fetchPreviousCloseSnapshots).not.toHaveBeenCalled()
    expect(result).toEqual({
      groups: [],
      totalHoldings: 0,
    })
  })

  it("returns preserved aggregation issues when no holdings remain", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.aggregateHoldings.mockReturnValue({
      holdings: [],
      issues: ["No open positions."],
    })

    const result = await getHoldings.execute?.({})

    expect(mocks.fetchPreviousCloseSnapshots).not.toHaveBeenCalled()
    expect(mocks.applyPreviousCloseQuotes).not.toHaveBeenCalled()
    expect(result).toEqual({
      groups: [],
      totalHoldings: 0,
      issues: ["No open positions."],
    })
  })

  it("builds quote targets, preserves issues, and filters the shaped response", async () => {
    const holdings = [
      { ticker: "AAPL", market: "US" },
      { ticker: "TSM", market: "US" },
    ]

    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.aggregateHoldings.mockReturnValue({
      holdings,
      issues: ["quote issue"],
    })
    mocks.fetchPreviousCloseSnapshots.mockResolvedValue([
      { key: "US:AAPL", price: 160 },
      { key: "US:TSM", price: 200 },
    ])
    mocks.applyPreviousCloseQuotes.mockReturnValue({
      groups: [
        {
          label: "Taxable",
          currencies: ["USD"],
          totalCostOpen: 500,
          totalMarketValue: 580,
          missingPriceCount: 0,
          holdings: [
            {
              ticker: "AAPL",
              market: "US",
              currency: "USD",
              quantityOpen: 2,
              averageCost: 120,
              totalCostOpen: 240,
              previousClose: 160,
              previousCloseDate: "2026-03-01",
              marketValue: 320,
              weight: 55.17,
            },
            {
              ticker: "TSM",
              market: "US",
              currency: "USD",
              quantityOpen: 1,
              averageCost: 260,
              totalCostOpen: 260,
              previousClose: null,
              previousCloseDate: null,
              marketValue: null,
              weight: null,
            },
          ],
        },
        {
          label: "Retirement",
          currencies: ["USD"],
          totalCostOpen: 100,
          totalMarketValue: 110,
          missingPriceCount: 0,
          holdings: [
            {
              ticker: "MSFT",
              market: "US",
              currency: "USD",
              quantityOpen: 1,
              averageCost: 100,
              totalCostOpen: 100,
              previousClose: 110,
              previousCloseDate: "2026-03-01",
              marketValue: 110,
              weight: 100,
            },
          ],
        },
      ],
    })

    const result = await getHoldings.execute?.({
      account: " taxable ",
      ticker: " aa ",
    })

    expect(mocks.fetchPreviousCloseSnapshots).toHaveBeenCalledWith([
      { ticker: "AAPL", market: "US" },
      { ticker: "TSM", market: "US" },
    ])
    expect(mocks.applyPreviousCloseQuotes).toHaveBeenCalledWith(holdings, {
      "US:AAPL": { key: "US:AAPL", price: 160 },
      "US:TSM": { key: "US:TSM", price: 200 },
    })
    expect(result).toEqual({
      groups: [
        {
          account: "Taxable",
          currencies: ["USD"],
          displayCurrency: "USD",
          netValueChangePct: 33.33,
          netValueChangeTwd: 2560,
          totalCostOpen: 240,
          totalCostBasisTwd: 7680,
          totalMarketValue: 320,
          totalMarketValueTwd: 10240,
          missingPriceCount: 0,
          valuationStatus: "ready",
          holdings: [
            {
              ticker: "AAPL",
              market: "US",
              currency: "USD",
              quantityOpen: 2,
              averageCost: 120,
              totalCostOpen: 240,
              previousClose: 160,
              previousCloseDate: "2026-03-01",
              marketValue: 320,
              weight: 55.17,
              unrealizedPnl: 80,
              unrealizedPnlPct: 33.33,
            },
          ],
        },
      ],
      totalHoldings: 1,
      issues: ["quote issue"],
    })
  })

  it("drops groups with no holdings left after ticker filtering", async () => {
    const holdings = [{ ticker: "AAPL", market: "US" }]

    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.aggregateHoldings.mockReturnValue({
      holdings,
      issues: [],
    })
    mocks.fetchPreviousCloseSnapshots.mockResolvedValue([
      { key: "US:AAPL", price: 160 },
    ])
    mocks.applyPreviousCloseQuotes.mockReturnValue({
      groups: [
        {
          label: "Taxable",
          currencies: ["USD"],
          totalCostOpen: 240,
          totalMarketValue: 320,
          missingPriceCount: 0,
          holdings: [
            {
              ticker: "AAPL",
              market: "US",
              currency: "USD",
              quantityOpen: 2,
              averageCost: 120,
              totalCostOpen: 240,
              previousClose: 160,
              previousCloseDate: "2026-03-01",
              marketValue: 320,
              weight: 1,
            },
          ],
        },
      ],
    })

    const result = await getHoldings.execute?.({
      ticker: "TSM",
    })

    expect(result).toEqual({
      groups: [],
      totalHoldings: 0,
      issues: [],
    })
  })

  it("returns mixed-currency TWD valuation status and totals for filtered groups", async () => {
    const holdings = [
      { ticker: "AAPL", market: "US" },
      { ticker: "2330", market: "TW" },
    ]

    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.aggregateHoldings.mockReturnValue({
      holdings,
      issues: [],
    })
    mocks.fetchPreviousCloseSnapshots.mockResolvedValue([
      { key: "US:AAPL", price: 150 },
      { key: "TW:2330", price: 600 },
    ])
    mocks.applyPreviousCloseQuotes.mockReturnValue({
      groups: [
        {
          label: "Global",
          currencies: ["TWD", "USD"],
          totalCostOpen: null,
          totalMarketValue: null,
          missingPriceCount: 0,
          holdings: [
            {
              ticker: "AAPL",
              market: "US",
              currency: "USD",
              quantityOpen: 1,
              averageCost: 100,
              totalCostOpen: 100,
              previousClose: 150,
              previousCloseDate: "2026-03-01",
              marketValue: 150,
              weight: null,
            },
            {
              ticker: "2330",
              market: "TW",
              currency: "TWD",
              quantityOpen: 2,
              averageCost: 450,
              totalCostOpen: 900,
              previousClose: 600,
              previousCloseDate: "2026-03-01",
              marketValue: 1200,
              weight: null,
            },
          ],
        },
      ],
    })

    const result = await getHoldings.execute?.({})

    expect(result).toEqual({
      groups: [
        {
          account: "Global",
          currencies: ["USD", "TWD"],
          displayCurrency: "TWD",
          netValueChangePct: 46.34,
          netValueChangeTwd: 1900,
          totalCostOpen: null,
          totalCostBasisTwd: 4100,
          totalMarketValue: null,
          totalMarketValueTwd: 6000,
          missingPriceCount: 0,
          valuationStatus: "ready",
          holdings: [
            {
              ticker: "AAPL",
              market: "US",
              currency: "USD",
              quantityOpen: 1,
              averageCost: 100,
              totalCostOpen: 100,
              previousClose: 150,
              previousCloseDate: "2026-03-01",
              marketValue: 150,
              weight: null,
              unrealizedPnl: 50,
              unrealizedPnlPct: 50,
            },
            {
              ticker: "2330",
              market: "TW",
              currency: "TWD",
              quantityOpen: 2,
              averageCost: 450,
              totalCostOpen: 900,
              previousClose: 600,
              previousCloseDate: "2026-03-01",
              marketValue: 1200,
              weight: null,
              unrealizedPnl: 300,
              unrealizedPnlPct: 33.33,
            },
          ],
        },
      ],
      totalHoldings: 2,
      issues: [],
    })
  })

  it("keeps mixed-currency cost basis available while market value stays price-pending", async () => {
    const holdings = [
      { ticker: "AAPL", market: "US" },
      { ticker: "2330", market: "TW" },
    ]

    mocks.readStoredTradeRows.mockResolvedValue([{ id: "trade-1" }])
    mocks.aggregateHoldings.mockReturnValue({
      holdings,
      issues: [],
    })
    mocks.fetchPreviousCloseSnapshots.mockResolvedValue([
      { key: "US:AAPL", price: 150 },
      { key: "TW:2330", price: null },
    ])
    mocks.applyPreviousCloseQuotes.mockReturnValue({
      groups: [
        {
          label: "Global",
          currencies: ["TWD", "USD"],
          totalCostOpen: null,
          totalMarketValue: null,
          missingPriceCount: 1,
          holdings: [
            {
              ticker: "AAPL",
              market: "US",
              currency: "USD",
              quantityOpen: 1,
              averageCost: 100,
              totalCostOpen: 100,
              previousClose: 150,
              previousCloseDate: "2026-03-01",
              marketValue: 150,
              weight: null,
            },
            {
              ticker: "2330",
              market: "TW",
              currency: "TWD",
              quantityOpen: 2,
              averageCost: 450,
              totalCostOpen: 900,
              previousClose: null,
              previousCloseDate: null,
              marketValue: null,
              weight: null,
            },
          ],
        },
      ],
    })

    const result = await getHoldings.execute?.({})

    expect(result).toEqual({
      groups: [
        {
          account: "Global",
          currencies: ["USD", "TWD"],
          displayCurrency: "TWD",
          netValueChangePct: null,
          netValueChangeTwd: null,
          totalCostOpen: null,
          totalCostBasisTwd: 4100,
          totalMarketValue: null,
          totalMarketValueTwd: null,
          missingPriceCount: 1,
          valuationStatus: "price-pending",
          holdings: [
            {
              ticker: "AAPL",
              market: "US",
              currency: "USD",
              quantityOpen: 1,
              averageCost: 100,
              totalCostOpen: 100,
              previousClose: 150,
              previousCloseDate: "2026-03-01",
              marketValue: 150,
              weight: null,
              unrealizedPnl: 50,
              unrealizedPnlPct: 50,
            },
            {
              ticker: "2330",
              market: "TW",
              currency: "TWD",
              quantityOpen: 2,
              averageCost: 450,
              totalCostOpen: 900,
              previousClose: null,
              previousCloseDate: null,
              marketValue: null,
              weight: null,
              unrealizedPnl: null,
              unrealizedPnlPct: null,
            },
          ],
        },
      ],
      totalHoldings: 2,
      issues: [],
    })
  })
})
