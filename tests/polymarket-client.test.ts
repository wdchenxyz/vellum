import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fetchActiveMarkets,
  type PredictionMarket,
} from "@/lib/news/polymarket-client"

function createMockResponse(markets: Record<string, unknown>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => markets,
  } as unknown as Response
}

describe("fetchActiveMarkets", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("fetches and returns processed market data", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      createMockResponse([
        {
          id: "m1",
          question: "Will Fed cut rates?",
          slug: "fed-cut-rates",
          outcomes: ["Yes", "No"],
          outcomePrices: ["0.65", "0.35"],
          volume: "1500000",
          liquidity: "500000",
        },
      ])
    )

    const result = await fetchActiveMarkets(10, mockFetch)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: "m1",
      question: "Will Fed cut rates?",
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.65", "0.35"],
      volume: "1500000",
    })
  })

  it("limits to requested count", async () => {
    const markets = Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`,
      question: `Question ${i}?`,
      outcomes: ["Yes", "No"],
      outcomePrices: ["0.5", "0.5"],
      volume: "1000",
    }))
    const mockFetch = vi
      .fn()
      .mockResolvedValue(createMockResponse(markets))

    const result = await fetchActiveMarkets(5, mockFetch)

    // API handles limit via query param; we pass through
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(
      new URL(mockFetch.mock.calls[0][0] as string).searchParams.get("limit")
    ).toBe("5")
  })

  it("returns empty array on fetch failure", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error"))

    const result = await fetchActiveMarkets(10, mockFetch)

    expect(result).toEqual([])
  })

  it("returns empty array on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response)

    const result = await fetchActiveMarkets(10, mockFetch)

    expect(result).toEqual([])
  })
})
