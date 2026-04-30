import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  resolveExtractedTradeTicker,
  scoreInstrumentNameMatch,
} from "@/lib/trades/resolve-ticker"
import type { ExtractedTrade } from "@/lib/trades/schema"

function makeTrade(overrides: Partial<ExtractedTrade> = {}): ExtractedTrade {
  return {
    currency: "USD",
    date: "2026-02-26",
    fee: 3.13,
    price: 89.334,
    quantity: 35,
    securityName: "GRANITESHARES 2X LONG NVDA DAI",
    side: "BUY",
    ticker: "GRANITESHARES 2X LONG NVDA DAI",
    tickerCandidates: [
      {
        confidence: 0.92,
        reason: "GraniteShares 2x Long NVDA Daily ETF is commonly NVDL.",
        ticker: "NVDL",
      },
    ],
    ...overrides,
  }
}

describe("trade ticker resolution", () => {
  const originalApiKey = process.env.TWELVEDATA_API_KEY
  const originalRequestDelay = process.env.TWELVEDATA_REQUEST_DELAY_MS

  beforeEach(() => {
    process.env.TWELVEDATA_API_KEY = "test-key"
    process.env.TWELVEDATA_REQUEST_DELAY_MS = "0"
  })

  afterEach(() => {
    vi.restoreAllMocks()

    if (originalApiKey === undefined) {
      delete process.env.TWELVEDATA_API_KEY
    } else {
      process.env.TWELVEDATA_API_KEY = originalApiKey
    }

    if (originalRequestDelay === undefined) {
      delete process.env.TWELVEDATA_REQUEST_DELAY_MS
    } else {
      process.env.TWELVEDATA_REQUEST_DELAY_MS = originalRequestDelay
    }
  })

  it("scores truncated visible names against returned instrument names", () => {
    expect(
      scoreInstrumentNameMatch({
        instrumentName: "Graniteshares 2x Long Nvidia Daily ETF",
        visibleName: "GraniteShares 2x Long NVDA Dai",
      })
    ).toBe(1)
  })

  it("accepts a visible ticker without calling Twelve Data", async () => {
    const fetchMock = vi.fn()

    const result = await resolveExtractedTradeTicker({
      fetcher: fetchMock as unknown as typeof fetch,
      trade: makeTrade({
        securityName: "GraniteShares 2x Long Nvidia Daily ETF",
        ticker: "NVDL",
        tickerCandidates: [],
      }),
    })

    expect(result).toMatchObject({
      status: "accepted",
      trade: { ticker: "NVDL" },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("resolves a validated candidate from a visible security name", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url.includes("/symbol_search?") && url.includes("symbol=NVDL")) {
        return Response.json({
          data: [
            {
              country: "United States",
              currency: "USD",
              exchange: "NASDAQ",
              instrument_name: "Graniteshares 2x Long Nvidia Daily ETF",
              instrument_type: "ETF",
              mic_code: "XNMS",
              symbol: "NVDL",
            },
          ],
          status: "ok",
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const result = await resolveExtractedTradeTicker({
      fetcher: fetchMock as unknown as typeof fetch,
      trade: makeTrade(),
    })

    expect(result).toMatchObject({
      status: "accepted",
      trade: { ticker: "NVDL" },
    })
  })

  it("rejects a candidate whose returned name does not match the visible name", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url.includes("/symbol_search?") && url.includes("symbol=ANV")) {
        return Response.json({
          data: [
            {
              country: "United States",
              currency: "USD",
              exchange: "NASDAQ",
              instrument_name: "GraniteShares 2x Short NVDA Daily ETF",
              instrument_type: "ETF",
              mic_code: "XNMS",
              symbol: "ANV",
            },
          ],
          status: "ok",
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const result = await resolveExtractedTradeTicker({
      fetcher: fetchMock as unknown as typeof fetch,
      trade: makeTrade({
        tickerCandidates: [
          {
            confidence: 0.7,
            reason: "A loose search result.",
            ticker: "ANV",
          },
        ],
      }),
    })

    expect(result).toMatchObject({
      status: "unresolved",
    })
  })
})
