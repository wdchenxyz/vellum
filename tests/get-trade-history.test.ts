import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  readStoredTradeRows: vi.fn(),
}))

vi.mock("@/lib/trades/storage", () => ({
  readStoredTradeRows: mocks.readStoredTradeRows,
}))

import { getTradeHistory } from "@/lib/tools/get-trade-history"

function makeRow(
  id: string,
  overrides: Partial<{
    account: string | null
    currency: string | null
    date: string
    price: number
    quantity: number
    side: "BUY" | "SELL"
    ticker: string
    totalAmount: number
  }> = {}
) {
  return {
    account: null,
    currency: "USD",
    date: "2026-03-17",
    id,
    price: 125,
    quantity: 10,
    side: "BUY" as const,
    sourceFile: "broker-note.pdf",
    ticker: "AAPL",
    totalAmount: 1250,
    ...overrides,
  }
}

describe("getTradeHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns every stored trade when no filters are provided", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([
      makeRow("trade-1"),
      makeRow("trade-2", {
        account: "Retirement",
        side: "SELL",
        ticker: "MSFT",
        totalAmount: 700,
      }),
    ])

    const result = await getTradeHistory.execute?.({})

    expect(result).toEqual({
      count: 2,
      trades: [
        {
          account: null,
          currency: "USD",
          date: "2026-03-17",
          id: "trade-1",
          price: 125,
          quantity: 10,
          side: "BUY",
          ticker: "AAPL",
          totalAmount: 1250,
        },
        {
          account: "Retirement",
          currency: "USD",
          date: "2026-03-17",
          id: "trade-2",
          price: 125,
          quantity: 10,
          side: "SELL",
          ticker: "MSFT",
          totalAmount: 700,
        },
      ],
    })
  })

  it("applies combined ticker, account, date, and side filters case-insensitively", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([
      makeRow("trade-1", {
        account: "Taxable Broker",
        date: "2026-03-16",
        ticker: "AAPL",
      }),
      makeRow("trade-2", {
        account: "Taxable Broker",
        date: "2026-03-18",
        ticker: "AAPL",
      }),
      makeRow("trade-3", {
        account: "Retirement",
        date: "2026-03-16",
        ticker: "AAPL",
      }),
      makeRow("trade-4", {
        account: "Taxable Broker",
        date: "2026-03-16",
        side: "SELL",
        ticker: "AAPL",
      }),
      makeRow("trade-5", {
        account: "Taxable Broker",
        date: "2026-03-16",
        ticker: "TSM",
      }),
    ])

    const result = await getTradeHistory.execute?.({
      ticker: " aa ",
      account: " taxable ",
      dateFrom: "2026-03-16",
      dateTo: "2026-03-17",
      side: "BUY",
    })

    expect(result).toEqual({
      count: 1,
      trades: [
        {
          account: "Taxable Broker",
          currency: "USD",
          date: "2026-03-16",
          id: "trade-1",
          price: 125,
          quantity: 10,
          side: "BUY",
          ticker: "AAPL",
          totalAmount: 1250,
        },
      ],
    })
  })

  it("returns an empty list when no stored rows match the filters", async () => {
    mocks.readStoredTradeRows.mockResolvedValue([
      makeRow("trade-1", {
        account: "Retirement",
        side: "SELL",
        ticker: "MSFT",
      }),
    ])

    const result = await getTradeHistory.execute?.({
      ticker: "nvda",
      side: "BUY",
    })

    expect(result).toEqual({
      count: 0,
      trades: [],
    })
  })
})
