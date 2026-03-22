import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  fxRateSnapshotSchema,
  previousCloseQuoteSchema,
  type FxRateSnapshot,
  type PreviousCloseLookupTarget,
  type PreviousCloseQuote,
} from "@/lib/portfolio/schema"
import { getHoldingKey } from "@/lib/portfolio/holdings"
import { z } from "zod"

const previousCloseCacheEntrySchema = z.object({
  cachedAt: z.string().datetime(),
  quote: previousCloseQuoteSchema,
})

const fxSnapshotCacheEntrySchema = z.object({
  cachedAt: z.string().datetime(),
  snapshot: fxRateSnapshotSchema,
})

const quoteCacheSchema = z.object({
  fxSnapshots: z.record(z.string(), fxSnapshotCacheEntrySchema).default({}),
  previousCloses: z
    .record(z.string(), previousCloseCacheEntrySchema)
    .default({}),
})

type QuoteCache = z.infer<typeof quoteCacheSchema>

const EMPTY_QUOTE_CACHE: QuoteCache = {
  fxSnapshots: {},
  previousCloses: {},
}

export const PREVIOUS_CLOSE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
export const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000

export function getQuoteCacheFilePath(rootDirectory = process.cwd()) {
  return process.env.QUOTE_CACHE_FILE_PATH
    ? path.resolve(process.env.QUOTE_CACHE_FILE_PATH)
    : path.join(rootDirectory, "data", "quote-cache.json")
}

async function ensureQuoteCacheFile(filePath: string) {
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
        `${JSON.stringify(EMPTY_QUOTE_CACHE, null, 2)}\n`
      )
      return
    }

    throw error
  }
}

async function readQuoteCache(filePath = getQuoteCacheFilePath()) {
  await ensureQuoteCacheFile(filePath)
  const rawContent = await readFile(filePath, "utf8")
  const parsed = quoteCacheSchema.safeParse(JSON.parse(rawContent))

  if (!parsed.success) {
    throw new Error("Stored quote cache is invalid JSON.")
  }

  return parsed.data
}

async function writeQuoteCache(
  cache: QuoteCache,
  filePath = getQuoteCacheFilePath()
) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8")
}

function isFresh(cachedAt: string, ttlMs: number) {
  const cachedAtMs = new Date(cachedAt).getTime()

  if (!Number.isFinite(cachedAtMs)) {
    return false
  }

  return Date.now() - cachedAtMs < ttlMs
}

export async function getCachedPreviousCloseQuotes(
  targets: PreviousCloseLookupTarget[],
  {
    filePath,
    ttlMs = PREVIOUS_CLOSE_CACHE_TTL_MS,
  }: { filePath?: string; ttlMs?: number } = {}
) {
  const cache = await readQuoteCache(filePath)
  const quotesByKey: Record<string, PreviousCloseQuote> = {}
  const missingTargets: PreviousCloseLookupTarget[] = []

  for (const target of targets) {
    const key = getHoldingKey({ market: target.market, ticker: target.ticker })
    const entry = cache.previousCloses[key]

    if (entry && isFresh(entry.cachedAt, ttlMs)) {
      quotesByKey[key] = entry.quote
      continue
    }

    missingTargets.push(target)
  }

  return { missingTargets, quotesByKey }
}

export async function setCachedPreviousCloseQuotes(
  quotes: PreviousCloseQuote[],
  { filePath }: { filePath?: string } = {}
) {
  if (quotes.length === 0) {
    return
  }

  const cache = await readQuoteCache(filePath)
  const cachedAt = new Date().toISOString()

  for (const quote of quotes) {
    if (quote.error || quote.previousClose === null) {
      continue
    }

    cache.previousCloses[quote.key] = {
      cachedAt,
      quote,
    }
  }

  await writeQuoteCache(cache, filePath)
}

export async function getCachedFxSnapshot(
  pair: string,
  {
    filePath,
    ttlMs = FX_CACHE_TTL_MS,
  }: { filePath?: string; ttlMs?: number } = {}
) {
  const cache = await readQuoteCache(filePath)
  const entry = cache.fxSnapshots[pair]

  if (!entry || !isFresh(entry.cachedAt, ttlMs)) {
    return null
  }

  return entry.snapshot
}

export async function setCachedFxSnapshot(
  snapshot: FxRateSnapshot,
  { filePath }: { filePath?: string } = {}
) {
  const cache = await readQuoteCache(filePath)
  cache.fxSnapshots[snapshot.pair] = {
    cachedAt: new Date().toISOString(),
    snapshot,
  }

  await writeQuoteCache(cache, filePath)
}
