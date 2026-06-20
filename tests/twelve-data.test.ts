import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getCachedFxSnapshot,
  getCachedPreviousCloseQuotes,
  setCachedFxSnapshot,
} from "@/lib/quotes/cache"
import {
  fetchPreviousCloseSnapshots,
  fetchUsdTwdFxSnapshot,
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
  const originalQuoteCacheFilePath = process.env.QUOTE_CACHE_FILE_PATH
  const originalRequestDelay = process.env.TWELVEDATA_REQUEST_DELAY_MS
  const tempDirectories: string[] = []

  function restoreEnv(
    name: "TWELVEDATA_API_KEY" | "TWELVEDATA_REQUEST_DELAY_MS"
  ) {
    const originalValue =
      name === "TWELVEDATA_API_KEY" ? originalApiKey : originalRequestDelay

    if (originalValue === undefined) {
      delete process.env[name]
      return
    }

    process.env[name] = originalValue
  }

  function restoreQuoteCacheEnv() {
    if (originalQuoteCacheFilePath === undefined) {
      delete process.env.QUOTE_CACHE_FILE_PATH
      return
    }

    process.env.QUOTE_CACHE_FILE_PATH = originalQuoteCacheFilePath
  }

  async function createTempQuoteCacheFilePath() {
    const directory = await mkdtemp(path.join(tmpdir(), "vellum-quotes-"))
    tempDirectories.push(directory)
    return path.join(directory, "quote-cache.json")
  }

  beforeEach(async () => {
    process.env.TWELVEDATA_API_KEY = "test-key"
    process.env.TWELVEDATA_REQUEST_DELAY_MS = "0"
    process.env.QUOTE_CACHE_FILE_PATH = await createTempQuoteCacheFilePath()
  })

  afterEach(async () => {
    vi.useRealTimers()
    restoreEnv("TWELVEDATA_API_KEY")
    restoreEnv("TWELVEDATA_REQUEST_DELAY_MS")
    restoreQuoteCacheEnv()
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true }))
    )
  })

  it("resolves previous close prices for US and Taiwan holdings", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void init
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

      if (url.includes("/eod?")) {
        return Response.json({
          AAPL: {
            close: "150.25",
            currency: "USD",
            datetime: "2026-03-17",
            exchange: "NASDAQ",
            mic_code: "XNAS",
            symbol: "AAPL",
          },
          MUU: {
            close: "213.88",
            currency: "USD",
            datetime: "2026-03-16",
            exchange: "NASDAQ",
            mic_code: "XNMS",
            symbol: "MUU",
          },
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
    expect(
      fetchMock.mock.calls
        .filter(([input]) =>
          [
            "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
            "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2",
            "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4",
          ].includes(input.toString())
        )
        .every(([, init]) => init?.cache === "no-store")
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

  it("reuses cached previous close quotes across repeated loads", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

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

      throw new Error(`Unexpected URL ${url}`)
    })

    const first = await fetchPreviousCloseSnapshots(
      [{ market: "US", ticker: "AAPL" }],
      fetchMock as typeof fetch
    )
    const second = await fetchPreviousCloseSnapshots(
      [{ market: "US", ticker: "AAPL" }],
      fetchMock as typeof fetch
    )

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("bypasses cached previous close quotes when force refresh is requested", async () => {
    let eodCalls = 0
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

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

      if (url.includes("/eod?") && url.includes("symbol=AAPL")) {
        eodCalls += 1

        return Response.json({
          close: eodCalls === 1 ? "150.25" : "151.75",
          currency: "USD",
          datetime: eodCalls === 1 ? "2026-03-17" : "2026-03-18",
          exchange: "NASDAQ",
          mic_code: "XNAS",
          symbol: "AAPL",
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const first = await fetchPreviousCloseSnapshots(
      [{ market: "US", ticker: "AAPL" }],
      fetchMock as typeof fetch
    )
    const forced = await fetchPreviousCloseSnapshots(
      [{ market: "US", ticker: "AAPL" }],
      fetchMock as typeof fetch,
      { forceRefresh: true }
    )

    expect(first[0]).toMatchObject({
      asOf: "2026-03-17",
      previousClose: 150.25,
    })
    expect(forced[0]).toMatchObject({
      asOf: "2026-03-18",
      previousClose: 151.75,
    })
    expect(eodCalls).toBe(2)
  })

  it("returns cached previous close quotes immediately while missing quotes refresh in the background", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

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

      if (url.includes("/symbol_search?") && url.includes("symbol=MSFT")) {
        return Response.json({
          data: [
            {
              country: "United States",
              currency: "USD",
              exchange: "NASDAQ",
              mic_code: "XNAS",
              symbol: "MSFT",
            },
          ],
          status: "ok",
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

      if (url.includes("/eod?") && url.includes("symbol=MSFT")) {
        return Response.json({
          close: "401.50",
          currency: "USD",
          datetime: "2026-03-18",
          exchange: "NASDAQ",
          mic_code: "XNAS",
          symbol: "MSFT",
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    await fetchPreviousCloseSnapshots(
      [{ market: "US", ticker: "AAPL" }],
      fetchMock as typeof fetch
    )

    const cached = await fetchPreviousCloseSnapshots(
      [
        { market: "US", ticker: "AAPL" },
        { market: "US", ticker: "MSFT" },
      ],
      fetchMock as typeof fetch,
      { returnCachedImmediately: true }
    )

    expect(cached).toEqual([
      expect.objectContaining({
        asOf: "2026-03-17",
        previousClose: 150.25,
        ticker: "AAPL",
      }),
    ])
    await vi.waitFor(async () => {
      const refreshed = await getCachedPreviousCloseQuotes([
        { market: "US", ticker: "MSFT" },
      ])

      expect(refreshed.freshQuotes["US:MSFT"]).toMatchObject({
        asOf: "2026-03-18",
        previousClose: 401.5,
      })
    })
  })

  it("batches uncached US previous close loads without symbol search", async () => {
    let eodCalls = 0
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

      if (url.includes("/symbol_search?")) {
        throw new Error(
          "Previous close loads should not resolve US symbols first."
        )
      }

      if (url.includes("/eod?")) {
        eodCalls += 1

        return Response.json({
          AAPL: {
            close: "151.75",
            currency: "USD",
            datetime: "2026-03-18",
            exchange: "NASDAQ",
            mic_code: "XNAS",
            symbol: "AAPL",
          },
          MSFT: {
            close: "401.50",
            currency: "USD",
            datetime: "2026-03-18",
            exchange: "NASDAQ",
            mic_code: "XNAS",
            symbol: "MSFT",
          },
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const quotes = await fetchPreviousCloseSnapshots(
      [
        { market: "US", ticker: "AAPL" },
        { market: "US", ticker: "MSFT" },
      ],
      fetchMock as typeof fetch,
      { returnCachedImmediately: true }
    )

    expect(quotes).toEqual([
      expect.objectContaining({
        asOf: "2026-03-18",
        previousClose: 151.75,
        ticker: "AAPL",
      }),
      expect.objectContaining({
        asOf: "2026-03-18",
        previousClose: 401.5,
        ticker: "MSFT",
      }),
    ])
    expect(eodCalls).toBe(1)
    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString().includes("/symbol_search?")
      )
    ).toBe(false)
  })

  it("batches forced US previous close refreshes without symbol search", async () => {
    let eodCalls = 0
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = input.toString()

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

      if (url.includes("/symbol_search?") && url.includes("symbol=MSFT")) {
        return Response.json({
          data: [
            {
              country: "United States",
              currency: "USD",
              exchange: "NASDAQ",
              mic_code: "XNAS",
              symbol: "MSFT",
            },
          ],
          status: "ok",
        })
      }

      if (url.includes("/eod?")) {
        eodCalls += 1

        return Response.json({
          AAPL: {
            close: "151.75",
            currency: "USD",
            datetime: "2026-03-18",
            exchange: "NASDAQ",
            mic_code: "XNAS",
            symbol: "AAPL",
          },
          MSFT: {
            close: "401.50",
            currency: "USD",
            datetime: "2026-03-18",
            exchange: "NASDAQ",
            mic_code: "XNAS",
            symbol: "MSFT",
          },
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    const quotes = await fetchPreviousCloseSnapshots(
      [
        { market: "US", ticker: "AAPL" },
        { market: "US", ticker: "MSFT" },
      ],
      fetchMock as typeof fetch,
      { forceRefresh: true }
    )

    expect(quotes).toEqual([
      expect.objectContaining({
        asOf: "2026-03-18",
        previousClose: 151.75,
        ticker: "AAPL",
      }),
      expect.objectContaining({
        asOf: "2026-03-18",
        previousClose: 401.5,
        ticker: "MSFT",
      }),
    ])
    expect(eodCalls).toBe(1)
    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString().includes("/symbol_search?")
      )
    ).toBe(false)
  })
})

describe("fetchUsdTwdFxSnapshot", () => {
  const originalApiKey = process.env.TWELVEDATA_API_KEY
  const originalQuoteCacheFilePath = process.env.QUOTE_CACHE_FILE_PATH
  const originalRequestDelay = process.env.TWELVEDATA_REQUEST_DELAY_MS
  const tempDirectories: string[] = []

  function restoreEnv(
    name: "TWELVEDATA_API_KEY" | "TWELVEDATA_REQUEST_DELAY_MS"
  ) {
    const originalValue =
      name === "TWELVEDATA_API_KEY" ? originalApiKey : originalRequestDelay

    if (originalValue === undefined) {
      delete process.env[name]
      return
    }

    process.env[name] = originalValue
  }

  function restoreQuoteCacheEnv() {
    if (originalQuoteCacheFilePath === undefined) {
      delete process.env.QUOTE_CACHE_FILE_PATH
      return
    }

    process.env.QUOTE_CACHE_FILE_PATH = originalQuoteCacheFilePath
  }

  async function createTempQuoteCacheFilePath() {
    const directory = await mkdtemp(path.join(tmpdir(), "vellum-fx-"))
    tempDirectories.push(directory)
    return path.join(directory, "quote-cache.json")
  }

  beforeEach(async () => {
    process.env.TWELVEDATA_API_KEY = "test-key"
    process.env.TWELVEDATA_REQUEST_DELAY_MS = "0"
    process.env.QUOTE_CACHE_FILE_PATH = await createTempQuoteCacheFilePath()
  })

  afterEach(async () => {
    vi.useRealTimers()
    restoreEnv("TWELVEDATA_API_KEY")
    restoreEnv("TWELVEDATA_REQUEST_DELAY_MS")
    restoreQuoteCacheEnv()
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true }))
    )
  })

  it("loads the USD/TWD previous close from Twelve Data", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        close: "31.95997",
        datetime: "2026-03-16",
        symbol: "USD/TWD",
      })
    )

    const result = await fetchUsdTwdFxSnapshot(fetchMock as typeof fetch)

    expect(result).toEqual({
      asOf: "2026-03-16",
      pair: "USD/TWD",
      rate: 31.95997,
    })
  })

  it("reuses the cached USD/TWD snapshot across repeated loads", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        close: "31.95997",
        datetime: "2026-03-16",
        symbol: "USD/TWD",
      })
    )

    const first = await fetchUsdTwdFxSnapshot(fetchMock as typeof fetch)
    const second = await fetchUsdTwdFxSnapshot(fetchMock as typeof fetch)

    expect(first).toEqual(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("bypasses the cached USD/TWD snapshot when force refresh is requested", async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1

      return Response.json({
        close: calls === 1 ? "31.95997" : "31.3728",
        datetime: calls === 1 ? "2026-03-16" : "2026-05-11",
        symbol: "USD/TWD",
      })
    })

    const first = await fetchUsdTwdFxSnapshot(fetchMock as typeof fetch)
    const forced = await fetchUsdTwdFxSnapshot(fetchMock as typeof fetch, {
      forceRefresh: true,
    })

    expect(first).toEqual({
      asOf: "2026-03-16",
      pair: "USD/TWD",
      rate: 31.95997,
    })
    expect(forced).toEqual({
      asOf: "2026-05-11",
      pair: "USD/TWD",
      rate: 31.3728,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns a stale USD/TWD snapshot while refreshing it in the background", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-03-16T00:00:00.000Z"))

    await setCachedFxSnapshot({
      asOf: "2026-03-16",
      pair: "USD/TWD",
      rate: 31.5,
    })

    vi.setSystemTime(new Date("2026-03-17T13:00:00.000Z"))

    const fetchMock = vi.fn(async () =>
      Response.json({
        close: "31.95997",
        datetime: "2026-03-17",
        symbol: "USD/TWD",
      })
    )

    const result = await fetchUsdTwdFxSnapshot(fetchMock as typeof fetch)

    expect(result).toEqual({
      asOf: "2026-03-16",
      pair: "USD/TWD",
      rate: 31.5,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => {
      const refreshed = await getCachedFxSnapshot("USD/TWD")

      expect(refreshed?.snapshot).toEqual({
        asOf: "2026-03-17",
        pair: "USD/TWD",
        rate: 31.95997,
      })
    })
  })
})
