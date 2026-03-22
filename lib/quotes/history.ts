import "server-only"

import type { SupportedMarket } from "@/lib/portfolio/schema"
import {
  type DailyPriceSeries,
  getCachedFxHistory,
  getCachedTickerHistory,
  setCachedFxHistory,
  setCachedTickerHistory,
} from "@/lib/quotes/history-cache"
import { resolveTaiwanTickerByName } from "@/lib/quotes/taiwan-symbols"
import {
  buildTwelveDataUrl,
  fetchTwelveDataJson,
  parseDecimal,
} from "@/lib/quotes/twelve-data"
import { z } from "zod"

const FINMIND_DATA_URL = "https://api.finmindtrade.com/api/v4/data"

export type HistoryTarget = {
  key: string
  ticker: string
  market: SupportedMarket
}

// ---------------------------------------------------------------------------
// Twelve Data time_series (US equities + FX)
// ---------------------------------------------------------------------------

const twelveDataTimeSeriesResponseSchema = z.object({
  values: z.array(
    z.object({
      datetime: z.string(),
      close: z.string(),
    })
  ),
})

async function fetchTwelveDataTimeSeries(
  symbol: string,
  startDate: string,
  fetcher: typeof fetch
): Promise<DailyPriceSeries> {
  const payload = await fetchTwelveDataJson(
    "/time_series",
    {
      symbol,
      interval: "1day",
      start_date: startDate,
      outputsize: "5000",
    },
    fetcher
  )
  const parsed = twelveDataTimeSeriesResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error(
      `Twelve Data returned an invalid time series for ${symbol}.`
    )
  }

  const prices: DailyPriceSeries = {}

  for (const point of parsed.data.values) {
    prices[point.datetime] = parseDecimal(point.close)
  }

  return prices
}

// ---------------------------------------------------------------------------
// FinMind (Taiwan equities)
// ---------------------------------------------------------------------------

const finMindDailyPriceResponseSchema = z.object({
  data: z
    .array(
      z.object({
        close: z.number(),
        date: z.string(),
      })
    )
    .default([]),
})

async function fetchFinMindDailyPrices(
  stockId: string,
  startDate: string,
  fetcher: typeof fetch
): Promise<DailyPriceSeries> {
  const url = new URL(FINMIND_DATA_URL)
  url.searchParams.set("dataset", "TaiwanStockPrice")
  url.searchParams.set("data_id", stockId.trim().toUpperCase())
  url.searchParams.set("start_date", startDate)

  const response = await fetcher(url, { cache: "no-store" })

  if (!response.ok) {
    throw new Error(`Unable to load Taiwan daily price history for ${stockId}.`)
  }

  const payload = await response.json().catch(() => null)
  const parsed = finMindDailyPriceResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error(
      `FinMind returned invalid daily price history for ${stockId}.`
    )
  }

  const prices: DailyPriceSeries = {}

  for (const point of parsed.data.data) {
    prices[point.date] = point.close
  }

  return prices
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function resolveTwTicker(
  ticker: string,
  fetcher: typeof fetch
): Promise<string> {
  const resolved = await resolveTaiwanTickerByName(ticker, fetcher)

  if (resolved) {
    return resolved.symbol
  }

  // If not resolved by name, assume it's already a numeric stock ID.
  return ticker.trim().toUpperCase()
}

export async function fetchTickerHistory(
  target: HistoryTarget,
  startDate: string,
  fetcher: typeof fetch = fetch
): Promise<DailyPriceSeries> {
  const cached = await getCachedTickerHistory(target.key)

  if (cached) {
    return cached
  }

  let prices: DailyPriceSeries

  if (target.market === "TW") {
    const stockId = await resolveTwTicker(target.ticker, fetcher)
    prices = await fetchFinMindDailyPrices(stockId, startDate, fetcher)
  } else {
    prices = await fetchTwelveDataTimeSeries(
      target.ticker.trim().toUpperCase(),
      startDate,
      fetcher
    )
  }

  await setCachedTickerHistory(target.key, prices)

  return prices
}

export async function fetchFxHistory(
  startDate: string,
  fetcher: typeof fetch = fetch
): Promise<DailyPriceSeries> {
  const cached = await getCachedFxHistory()

  if (cached) {
    return cached
  }

  const rates = await fetchTwelveDataTimeSeries("USD/TWD", startDate, fetcher)

  await setCachedFxHistory(rates)

  return rates
}
