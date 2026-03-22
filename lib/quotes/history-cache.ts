import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

const priceSeriesEntrySchema = z.object({
  cachedAt: z.string().datetime(),
  prices: z.record(z.string(), z.number()),
})

const historyCacheSchema = z.object({
  fxRates: priceSeriesEntrySchema.nullable().default(null),
  tickers: z.record(z.string(), priceSeriesEntrySchema).default({}),
})

type HistoryCache = z.infer<typeof historyCacheSchema>

const EMPTY_HISTORY_CACHE: HistoryCache = {
  fxRates: null,
  tickers: {},
}

/** Cached data is considered fresh if the latest entry is from today. */
const HISTORY_CACHE_TTL_MS = 12 * 60 * 60 * 1000

export type DailyPriceSeries = Record<string, number>

let writeQueue = Promise.resolve()

export function getHistoryCacheFilePath(rootDirectory = process.cwd()) {
  return path.join(rootDirectory, "data", "history-cache.json")
}

async function ensureHistoryCacheFile(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true })

  try {
    await readFile(filePath, "utf8")
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      await writeFile(
        filePath,
        `${JSON.stringify(EMPTY_HISTORY_CACHE, null, 2)}\n`
      )
      return
    }

    throw error
  }
}

async function readHistoryCache(filePath = getHistoryCacheFilePath()) {
  await ensureHistoryCacheFile(filePath)
  const rawContent = await readFile(filePath, "utf8")

  try {
    const parsed = historyCacheSchema.safeParse(JSON.parse(rawContent))

    if (!parsed.success) {
      return EMPTY_HISTORY_CACHE
    }

    return parsed.data
  } catch {
    // File is corrupted — start fresh.
    return EMPTY_HISTORY_CACHE
  }
}

async function writeHistoryCache(
  cache: HistoryCache,
  filePath = getHistoryCacheFilePath()
) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8")
}

function withWriteLock<T>(work: () => Promise<T>) {
  const currentWrite = writeQueue.then(work)
  writeQueue = currentWrite.then(
    () => undefined,
    () => undefined
  )

  return currentWrite
}

function isFresh(cachedAt: string) {
  const cachedAtMs = new Date(cachedAt).getTime()

  if (!Number.isFinite(cachedAtMs)) {
    return false
  }

  return Date.now() - cachedAtMs < HISTORY_CACHE_TTL_MS
}

export type PriceCacheResult = {
  fresh: boolean
  prices: DailyPriceSeries
}

export async function getCachedTickerHistory(
  key: string,
  { filePath }: { filePath?: string } = {}
): Promise<PriceCacheResult | null> {
  const cache = await readHistoryCache(filePath)
  const entry = cache.tickers[key]

  if (!entry) {
    return null
  }

  return { fresh: isFresh(entry.cachedAt), prices: entry.prices }
}

export async function setCachedTickerHistory(
  key: string,
  prices: DailyPriceSeries,
  { filePath }: { filePath?: string } = {}
) {
  return withWriteLock(async () => {
    const cache = await readHistoryCache(filePath)
    cache.tickers[key] = {
      cachedAt: new Date().toISOString(),
      prices,
    }

    await writeHistoryCache(cache, filePath)
  })
}

export async function getCachedFxHistory({
  filePath,
}: { filePath?: string } = {}): Promise<PriceCacheResult | null> {
  const cache = await readHistoryCache(filePath)

  if (!cache.fxRates) {
    return null
  }

  return {
    fresh: isFresh(cache.fxRates.cachedAt),
    prices: cache.fxRates.prices,
  }
}

export async function setCachedFxHistory(
  rates: DailyPriceSeries,
  { filePath }: { filePath?: string } = {}
) {
  return withWriteLock(async () => {
    const cache = await readHistoryCache(filePath)
    cache.fxRates = {
      cachedAt: new Date().toISOString(),
      prices: rates,
    }

    await writeHistoryCache(cache, filePath)
  })
}
