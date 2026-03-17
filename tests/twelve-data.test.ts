import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  fetchPreviousCloseSnapshots,
  selectInstrumentMatch,
} from "@/lib/quotes/twelve-data"

describe("selectInstrumentMatch", () => {
  it("prefers Taiwan Stock Exchange over TPEx when symbols collide", () => {
    const match = selectInstrumentMatch(
      [
        {
          country: "Taiwan",
          currency: "TWD",
          exchange: "TPEX",
          mic_code: "ROCO",
          symbol: "2330",
        },
        {
          country: "Taiwan",
          currency: "TWD",
          exchange: "TWSE",
          mic_code: "XTAI",
          symbol: "2330",
        },
      ],
      { market: "TW", ticker: "2330" }
    )

    expect(match?.mic_code).toBe("XTAI")
  })

  it("prefers the United States listing when the same ETF ticker exists abroad", () => {
    const match = selectInstrumentMatch(
      [
        {
          country: "Mexico",
          currency: "MXN",
          exchange: "BMV",
          mic_code: "XMEX",
          symbol: "MUU",
        },
        {
          country: "United States",
          currency: "USD",
          exchange: "NASDAQ",
          mic_code: "XNMS",
          symbol: "MUU",
        },
      ],
      { market: "US", ticker: "MUU" }
    )

    expect(match?.country).toBe("United States")
    expect(match?.mic_code).toBe("XNMS")
  })
})

describe("fetchPreviousCloseSnapshots", () => {
  const originalApiKey = process.env.TWELVEDATA_API_KEY

  beforeEach(() => {
    process.env.TWELVEDATA_API_KEY = "test-key"
  })

  afterEach(() => {
    process.env.TWELVEDATA_API_KEY = originalApiKey
  })

  it("resolves previous close prices for US and Taiwan holdings", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url === "https://openapi.twse.com.tw/v1/opendata/t187ap03_L") {
        return Response.json([])
      }

      if (url === "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2") {
        return new Response("<html><body></body></html>")
      }

      if (url === "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4") {
        return new Response("<html><body></body></html>")
      }

      if (url.includes("/symbol_search?") && url.includes("symbol=AAPL")) {
        return Response.json({
          data: [
            {
              country: "United States",
              currency: "USD",
              exchange: "NASDAQ",
              mic_code: "XNAS",
              symbol: "AAPL",
            },
          ],
          status: "ok",
        })
      }

      if (url.includes("dataset=TaiwanStockInfo")) {
        return Response.json({
          data: [
            {
              stock_id: "2330",
              stock_name: "台積電",
              type: "twse",
            },
          ],
          status: 200,
        })
      }

      if (url.includes("/symbol_search?") && url.includes("symbol=MUU")) {
        return Response.json({
          data: [
            {
              country: "Mexico",
              currency: "MXN",
              exchange: "BMV",
              mic_code: "XMEX",
              symbol: "MUU",
            },
            {
              country: "United States",
              currency: "USD",
              exchange: "NASDAQ",
              mic_code: "XNMS",
              symbol: "MUU",
            },
          ],
          status: "ok",
        })
      }

      if (
        url.includes("dataset=TaiwanStockPrice") &&
        url.includes("data_id=2330")
      ) {
        return Response.json({
          data: [
            {
              close: 980.5,
              date: "2026-03-17",
              stock_id: "2330",
            },
          ],
          status: 200,
        })
      }

      if (url.includes("/eod?") && url.includes("symbol=AAPL")) {
        return Response.json({
          close: "150.25",
          currency: "USD",
          datetime: "2026-03-17",
          exchange: "NASDAQ",
          mic_code: "XNAS",
          symbol: "AAPL",
        })
      }

      if (url.includes("/eod?") && url.includes("symbol=MUU")) {
        return Response.json({
          close: "213.88",
          currency: "USD",
          datetime: "2026-03-16",
          exchange: "NASDAQ",
          mic_code: "XNMS",
          symbol: "MUU",
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const result = await fetchPreviousCloseSnapshots(
      [
        { market: "US", ticker: "AAPL" },
        { market: "US", ticker: "MUU" },
        { market: "TW", ticker: "2330" },
      ],
      fetchMock as typeof fetch
    )

    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString().includes("dataset=TaiwanStockInfo")
      )
    ).toBe(true)
    expect(result).toEqual([
      {
        asOf: "2026-03-17",
        currency: "USD",
        exchange: "NASDAQ",
        key: "US:AAPL",
        market: "US",
        micCode: "XNAS",
        previousClose: 150.25,
        ticker: "AAPL",
      },
      {
        asOf: "2026-03-16",
        currency: "USD",
        exchange: "NASDAQ",
        key: "US:MUU",
        market: "US",
        micCode: "XNMS",
        previousClose: 213.88,
        ticker: "MUU",
      },
      {
        asOf: "2026-03-17",
        currency: "TWD",
        exchange: "TWSE",
        key: "TW:2330",
        market: "TW",
        micCode: "XTAI",
        previousClose: 980.5,
        ticker: "2330",
      },
    ])
  })

  it("maps a Taiwan company name to its numeric ticker with FinMind fallback", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url === "https://openapi.twse.com.tw/v1/opendata/t187ap03_L") {
        return new Response("upstream error", { status: 500 })
      }

      if (url === "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2") {
        return new Response("upstream error", { status: 500 })
      }

      if (url === "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4") {
        return new Response("upstream error", { status: 500 })
      }

      if (url.includes("dataset=TaiwanStockInfo")) {
        return Response.json({
          data: [
            {
              stock_id: "2313",
              stock_name: "華通",
              type: "twse",
            },
          ],
          status: 200,
        })
      }

      if (
        url.includes("dataset=TaiwanStockPrice") &&
        url.includes("data_id=2313")
      ) {
        return Response.json({
          data: [
            {
              close: 184.57,
              date: "2026-03-16",
              stock_id: "2313",
            },
          ],
          status: 200,
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const result = await fetchPreviousCloseSnapshots(
      [{ market: "TW", ticker: "華通" }],
      fetchMock as typeof fetch
    )

    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString().includes("dataset=TaiwanStockInfo")
      )
    ).toBe(true)
    expect(result).toEqual([
      {
        asOf: "2026-03-16",
        currency: "TWD",
        exchange: "TWSE",
        key: "TW:華通",
        market: "TW",
        micCode: "XTAI",
        previousClose: 184.57,
        ticker: "2313",
      },
    ])
  })

  it("returns a per-symbol error when Twelve Data cannot resolve a listing", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url === "https://openapi.twse.com.tw/v1/opendata/t187ap03_L") {
        return Response.json([])
      }

      if (url === "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2") {
        return new Response("<html><body></body></html>")
      }

      if (url === "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4") {
        return new Response("<html><body></body></html>")
      }

      if (url.includes("dataset=TaiwanStockInfo")) {
        return Response.json({
          data: [],
          status: 200,
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const result = await fetchPreviousCloseSnapshots(
      [{ market: "TW", ticker: "9999" }],
      fetchMock as typeof fetch
    )

    expect(result).toEqual([
      {
        asOf: null,
        currency: "TWD",
        error: "No supported Taiwan listing was found for 9999.",
        exchange: null,
        key: "TW:9999",
        market: "TW",
        micCode: null,
        previousClose: null,
        ticker: "9999",
      },
    ])
  })
})
