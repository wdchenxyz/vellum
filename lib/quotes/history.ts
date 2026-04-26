import "server-only"

import type { SupportedMarket } from "@/lib/portfolio/schema"
import {
  type DailyPriceSeries,
  type PriceCacheResult,
  getCachedFxHistory,
  getCachedTickerHistory,
  setCachedFxHistory,
  setCachedTickerHistory,
} from "@/lib/quotes/history-cache"
import { resolveTaiwanTickerByName } from "@/lib/quotes/taiwan-symbols"
import { fetchTwelveDataJson, parseDecimal } from "@/lib/quotes/twelve-data"
import { z } from "zod"

const FINMIND_DATA_URL = "https://api.finmindtrade.com/api/v4/data"

export type RawBenchmarkPrices = {
  spx: DailyPriceSeries
  twii: DailyPriceSeries
}

type BenchmarkKey = keyof RawBenchmarkPrices

const BENCHMARK_CACHE_KEYS: Record<BenchmarkKey, string> = {
  spx: "BENCH:SPY",
  twii: "BENCH:0050",
}

type BenchmarkDef = {
  market: "US" | "TW"
  symbol: string
}

type BenchmarkResult = {
  key: BenchmarkKey
  prices: DailyPriceSeries
}

const BENCHMARK_DEFS: Record<BenchmarkKey, BenchmarkDef> = {
  spx: { market: "US", symbol: "SPY" },
  twii: { market: "TW", symbol: "0050" },
}

export type HistoryTarget = {
  key: string
  ticker: string
  market: SupportedMarket
}

type HistoryCacheLoader = () => Promise<PriceCacheResult | null>

type FreshHistoryFetcher = (
  existingPrices: DailyPriceSeries | null
) => Promise<DailyPriceSeries>

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

/**
 * Given existing cached dates, return a fetch start date that only covers
 * the gap. We overlap by 2 days to handle any corrections/adjustments.
 */
function getIncrementalStartDate(
  existingPrices: DailyPriceSeries,
  fallbackStartDate: string
): string {
  const dates = Object.keys(existingPrices).sort()

  if (dates.length === 0) {
    return fallbackStartDate
  }

  const latest = new Date(`${dates[dates.length - 1]}T00:00:00`)
  latest.setDate(latest.getDate() - 2)

  return latest.toISOString().slice(0, 10)
}

function getFetchStartDate(
  startDate: string,
  existingPrices: DailyPriceSeries | null
) {
  return existingPrices
    ? getIncrementalStartDate(existingPrices, startDate)
    : startDate
}

function mergeHistoricalPrices(
  existingPrices: DailyPriceSeries | null,
  newPrices: DailyPriceSeries
) {
  return existingPrices ? { ...existingPrices, ...newPrices } : newPrices
}

function refreshHistoryInBackground(
  fetchFresh: FreshHistoryFetcher,
  cachedPrices: DailyPriceSeries,
  getErrorMessage: (error: unknown) => string
) {
  void fetchFresh(cachedPrices).catch((error) => {
    console.warn(getErrorMessage(error))
  })
}

async function resolveCachedHistory({
  loadCached,
  fetchFresh,
  getBackgroundRefreshError,
}: {
  loadCached: HistoryCacheLoader
  fetchFresh: FreshHistoryFetcher
  getBackgroundRefreshError: (error: unknown) => string
}) {
  const cached = await loadCached()

  if (cached?.fresh) {
    return cached.prices
  }

  if (cached?.usable) {
    refreshHistoryInBackground(
      fetchFresh,
      cached.prices,
      getBackgroundRefreshError
    )
    return cached.prices
  }

  return fetchFresh(cached?.prices ?? null)
}

async function fetchFreshTickerHistory(
  target: HistoryTarget,
  startDate: string,
  existingPrices: DailyPriceSeries | null,
  fetcher: typeof fetch
): Promise<DailyPriceSeries> {
  const fetchStart = getFetchStartDate(startDate, existingPrices)

  let newPrices: DailyPriceSeries

  if (target.market === "TW") {
    const stockId = await resolveTwTicker(target.ticker, fetcher)
    newPrices = await fetchFinMindDailyPrices(stockId, fetchStart, fetcher)
  } else {
    newPrices = await fetchTwelveDataTimeSeries(
      target.ticker.trim().toUpperCase(),
      fetchStart,
      fetcher
    )
  }

  const merged = mergeHistoricalPrices(existingPrices, newPrices)

  await setCachedTickerHistory(target.key, merged)

  return merged
}

export async function fetchTickerHistory(
  target: HistoryTarget,
  startDate: string,
  fetcher: typeof fetch = fetch
): Promise<DailyPriceSeries> {
  return resolveCachedHistory({
    loadCached: () => getCachedTickerHistory(target.key),
    fetchFresh: (existingPrices) =>
      fetchFreshTickerHistory(target, startDate, existingPrices, fetcher),
    getBackgroundRefreshError: (error) =>
      `[history] Background refresh failed for ${target.key}: ${error instanceof Error ? error.message : String(error)}`,
  })
}

async function fetchFreshFxHistory(
  startDate: string,
  existingPrices: DailyPriceSeries | null,
  fetcher: typeof fetch
): Promise<DailyPriceSeries> {
  const fetchStart = getFetchStartDate(startDate, existingPrices)

  const newRates = await fetchTwelveDataTimeSeries(
    "USD/TWD",
    fetchStart,
    fetcher
  )

  const merged = mergeHistoricalPrices(existingPrices, newRates)

  await setCachedFxHistory(merged)

  return merged
}

export async function fetchFxHistory(
  startDate: string,
  fetcher: typeof fetch = fetch
): Promise<DailyPriceSeries> {
  return resolveCachedHistory({
    loadCached: () => getCachedFxHistory(),
    fetchFresh: (existingPrices) =>
      fetchFreshFxHistory(startDate, existingPrices, fetcher),
    getBackgroundRefreshError: (error) =>
      `[history] Background FX refresh failed: ${error instanceof Error ? error.message : String(error)}`,
  })
}

async function fetchBenchmarkPrices(
  def: BenchmarkDef,
  startDate: string,
  fetcher: typeof fetch
) {
  return def.market === "TW"
    ? fetchFinMindDailyPrices(def.symbol, startDate, fetcher)
    : fetchTwelveDataTimeSeries(def.symbol, startDate, fetcher)
}

async function fetchAndCacheBenchmarkPrices(
  key: BenchmarkKey,
  startDate: string,
  fetcher: typeof fetch,
  existingPrices: DailyPriceSeries | null
) {
  const cacheKey = BENCHMARK_CACHE_KEYS[key]
  const fetchStart = existingPrices
    ? getIncrementalStartDate(existingPrices, startDate)
    : startDate
  const newPrices = await fetchBenchmarkPrices(
    BENCHMARK_DEFS[key],
    fetchStart,
    fetcher
  )
  const merged = existingPrices
    ? { ...existingPrices, ...newPrices }
    : newPrices

  await setCachedTickerHistory(cacheKey, merged)

  return merged
}

function refreshBenchmarkPricesInBackground(
  key: BenchmarkKey,
  startDate: string,
  fetcher: typeof fetch,
  existingPrices: DailyPriceSeries
) {
  void fetchAndCacheBenchmarkPrices(
    key,
    startDate,
    fetcher,
    existingPrices
  ).catch((error) => {
    console.warn(
      `[history] Background benchmark refresh failed for ${key}:`,
      error instanceof Error ? error.message : error
    )
  })
}

async function fetchBenchmarkResult(
  key: BenchmarkKey,
  startDate: string,
  fetcher: typeof fetch
): Promise<BenchmarkResult> {
  const cached = await getCachedTickerHistory(BENCHMARK_CACHE_KEYS[key])

  if (cached?.fresh) {
    return { key, prices: cached.prices }
  }

  if (cached?.usable) {
    refreshBenchmarkPricesInBackground(key, startDate, fetcher, cached.prices)
    return { key, prices: cached.prices }
  }

  try {
    const prices = await fetchAndCacheBenchmarkPrices(
      key,
      startDate,
      fetcher,
      cached?.prices ?? null
    )

    return { key, prices }
  } catch {
    // Return stale data if available, otherwise empty.
    return { key, prices: cached?.prices ?? {} }
  }
}

function buildBenchmarkPrices(results: BenchmarkResult[]): RawBenchmarkPrices {
  const benchmarks: RawBenchmarkPrices = { spx: {}, twii: {} }

  for (const result of results) {
    benchmarks[result.key] = result.prices
  }

  return benchmarks
}

export async function fetchBenchmarkHistory(
  startDate: string,
  fetcher: typeof fetch = fetch
): Promise<RawBenchmarkPrices> {
  const results = await Promise.all(
    (Object.keys(BENCHMARK_DEFS) as BenchmarkKey[]).map((key) =>
      fetchBenchmarkResult(key, startDate, fetcher)
    )
  )

  return buildBenchmarkPrices(results)
}
