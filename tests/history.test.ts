import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PriceCacheResult } from "@/lib/quotes/history-cache"

const mocks = vi.hoisted(() => ({
  getCachedFxHistory: vi.fn(),
  getCachedTickerHistory: vi.fn(),
  setCachedFxHistory: vi.fn(),
  setCachedTickerHistory: vi.fn(),
}))

vi.mock("@/lib/quotes/history-cache", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/quotes/history-cache")
  >("@/lib/quotes/history-cache")

  return {
    ...actual,
    getCachedFxHistory: mocks.getCachedFxHistory,
    getCachedTickerHistory: mocks.getCachedTickerHistory,
    setCachedFxHistory: mocks.setCachedFxHistory,
    setCachedTickerHistory: mocks.setCachedTickerHistory,
  }
})

import {
  fetchBenchmarkHistory,
  fetchFxHistory,
  fetchTickerHistory,
} from "@/lib/quotes/history"

function makeCacheResult(
  overrides: Partial<PriceCacheResult> & { prices: Record<string, number> }
): PriceCacheResult {
  return {
    fresh: false,
    usable: false,
    ...overrides,
  }
}

describe("fetchTickerHistory", () => {
  const target = { key: "US:AAPL", market: "US" as const, ticker: "AAPL" }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWELVEDATA_API_KEY = "test-key"
    process.env.TWELVEDATA_REQUEST_DELAY_MS = "0"
  })

  it("returns fresh ticker cache entries without refetching", async () => {
    mocks.getCachedTickerHistory.mockResolvedValue(
      makeCacheResult({
        fresh: true,
        prices: { "2026-03-17": 215.3 },
        usable: true,
      })
    )

    const fetchMock = vi.fn()

    const result = await fetchTickerHistory(target, "2026-03-01", fetchMock)

    expect(result).toEqual({ "2026-03-17": 215.3 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.setCachedTickerHistory).not.toHaveBeenCalled()
  })

  it("returns usable stale ticker prices while refreshing in the background", async () => {
    mocks.getCachedTickerHistory.mockResolvedValue(
      makeCacheResult({
        prices: { "2026-03-10": 210 },
        usable: true,
      })
    )

    const fetchMock = vi.fn(async () =>
      Response.json({
        values: [{ close: "214.75", datetime: "2026-03-12" }],
      })
    )

    const result = await fetchTickerHistory(target, "2026-03-01", fetchMock)

    expect(result).toEqual({ "2026-03-10": 210 })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mocks.setCachedTickerHistory).toHaveBeenCalledWith("US:AAPL", {
      "2026-03-10": 210,
      "2026-03-12": 214.75,
    })
  })
})

describe("fetchFxHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWELVEDATA_API_KEY = "test-key"
    process.env.TWELVEDATA_REQUEST_DELAY_MS = "0"
  })

  it("returns fresh FX cache entries without refetching", async () => {
    mocks.getCachedFxHistory.mockResolvedValue(
      makeCacheResult({
        fresh: true,
        prices: { "2026-03-17": 32.1 },
        usable: true,
      })
    )

    const fetchMock = vi.fn()

    const result = await fetchFxHistory("2026-03-01", fetchMock)

    expect(result).toEqual({ "2026-03-17": 32.1 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.setCachedFxHistory).not.toHaveBeenCalled()
  })

  it("fetches and merges missing FX history before returning", async () => {
    mocks.getCachedFxHistory.mockResolvedValue(
      makeCacheResult({
        prices: { "2026-03-10": 31.9 },
      })
    )

    const fetchMock = vi.fn(async () =>
      Response.json({
        values: [
          { close: "32.15", datetime: "2026-03-12" },
          { close: "32.05", datetime: "2026-03-11" },
        ],
      })
    )

    const result = await fetchFxHistory("2026-03-01", fetchMock)
    const requestedUrl = fetchMock.mock.calls[0]?.[0]?.toString()

    expect(result).toEqual({
      "2026-03-10": 31.9,
      "2026-03-11": 32.05,
      "2026-03-12": 32.15,
    })
    expect(requestedUrl).toContain("symbol=USD%2FTWD")
    expect(requestedUrl).toContain("start_date=2026-03-07")
    expect(mocks.setCachedFxHistory).toHaveBeenCalledWith({
      "2026-03-10": 31.9,
      "2026-03-11": 32.05,
      "2026-03-12": 32.15,
    })
  })
})

describe("fetchBenchmarkHistory", () => {
  const originalApiKey = process.env.TWELVEDATA_API_KEY
  const originalRequestDelay = process.env.TWELVEDATA_REQUEST_DELAY_MS

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWELVEDATA_API_KEY = "test-key"
    process.env.TWELVEDATA_REQUEST_DELAY_MS = "0"
  })

  afterEach(() => {
    process.env.TWELVEDATA_API_KEY = originalApiKey
    process.env.TWELVEDATA_REQUEST_DELAY_MS = originalRequestDelay
  })

  it("returns fresh benchmark cache entries without refetching", async () => {
    mocks.getCachedTickerHistory.mockImplementation(async (key: string) => {
      if (key === "BENCH:SPY") {
        return makeCacheResult({
          fresh: true,
          prices: { "2026-03-17": 580 },
          usable: true,
        })
      }

      return makeCacheResult({
        fresh: true,
        prices: { "2026-03-17": 160 },
        usable: true,
      })
    })

    const fetchMock = vi.fn()

    const result = await fetchBenchmarkHistory(
      "2026-03-01",
      fetchMock as typeof fetch
    )

    expect(result).toEqual({
      spx: { "2026-03-17": 580 },
      twii: { "2026-03-17": 160 },
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.setCachedTickerHistory).not.toHaveBeenCalled()
  })

  it("fetches and merges missing benchmark history before returning", async () => {
    mocks.getCachedTickerHistory.mockImplementation(async (key: string) => {
      if (key === "BENCH:SPY") {
        return makeCacheResult({
          prices: { "2026-03-10": 575 },
        })
      }

      return null
    })

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url.includes("/time_series?") && url.includes("symbol=SPY")) {
        return Response.json({
          values: [
            { close: "579.25", datetime: "2026-03-12" },
            { close: "581.5", datetime: "2026-03-11" },
          ],
        })
      }

      if (
        url.includes("dataset=TaiwanStockPrice") &&
        url.includes("data_id=0050") &&
        url.includes("start_date=2026-03-01")
      ) {
        return Response.json({
          data: [
            { close: 182.4, date: "2026-03-11" },
            { close: 183.1, date: "2026-03-12" },
          ],
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const result = await fetchBenchmarkHistory(
      "2026-03-01",
      fetchMock as typeof fetch
    )
    const requestedUrls = fetchMock.mock.calls.map(([input]) =>
      input.toString()
    )

    expect(result).toEqual({
      spx: {
        "2026-03-10": 575,
        "2026-03-11": 581.5,
        "2026-03-12": 579.25,
      },
      twii: {
        "2026-03-11": 182.4,
        "2026-03-12": 183.1,
      },
    })
    expect(
      requestedUrls.find(
        (url) => url.includes("/time_series?") && url.includes("symbol=SPY")
      )
    ).toContain("start_date=2026-03-07")
    expect(mocks.setCachedTickerHistory).toHaveBeenCalledWith("BENCH:SPY", {
      "2026-03-10": 575,
      "2026-03-11": 581.5,
      "2026-03-12": 579.25,
    })
    expect(mocks.setCachedTickerHistory).toHaveBeenCalledWith("BENCH:0050", {
      "2026-03-11": 182.4,
      "2026-03-12": 183.1,
    })
  })

  it("returns usable stale prices while refreshing them in the background", async () => {
    mocks.getCachedTickerHistory.mockImplementation(async (key: string) => {
      if (key === "BENCH:SPY") {
        return makeCacheResult({
          prices: { "2026-03-10": 575 },
          usable: true,
        })
      }

      return makeCacheResult({
        fresh: true,
        prices: { "2026-03-12": 183.1 },
        usable: true,
      })
    })

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url.includes("/time_series?") && url.includes("symbol=SPY")) {
        return Response.json({
          values: [{ close: "579.25", datetime: "2026-03-12" }],
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const result = await fetchBenchmarkHistory(
      "2026-03-01",
      fetchMock as typeof fetch
    )

    expect(result).toEqual({
      spx: { "2026-03-10": 575 },
      twii: { "2026-03-12": 183.1 },
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mocks.setCachedTickerHistory).toHaveBeenCalledWith("BENCH:SPY", {
      "2026-03-10": 575,
      "2026-03-12": 579.25,
    })
  })

  it("falls back to cached or empty prices when benchmark fetches fail", async () => {
    mocks.getCachedTickerHistory.mockImplementation(async (key: string) => {
      if (key === "BENCH:SPY") {
        return makeCacheResult({
          prices: { "2026-03-10": 575 },
        })
      }

      return null
    })

    const fetchMock = vi.fn(async () => {
      throw new Error("upstream unavailable")
    })

    const result = await fetchBenchmarkHistory(
      "2026-03-01",
      fetchMock as typeof fetch
    )

    expect(result).toEqual({
      spx: { "2026-03-10": 575 },
      twii: {},
    })
    expect(mocks.setCachedTickerHistory).not.toHaveBeenCalled()
  })
})
