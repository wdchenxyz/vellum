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

const instrumentResolutionSchema = z.object({
  country: z.string().optional(),
  currency: z.string().optional(),
  exchange: z.string(),
  instrument_name: z.string().optional(),
  instrument_type: z.string().optional(),
  mic_code: z.string(),
  symbol: z.string(),
})

const instrumentCacheEntrySchema = z.object({
  cachedAt: z.string().datetime(),
  instrument: instrumentResolutionSchema,
})

export type CachedInstrument = z.infer<typeof instrumentResolutionSchema>

const quoteCacheSchema = z.object({
  fxSnapshots: z.record(z.string(), fxSnapshotCacheEntrySchema).default({}),
  instruments: z.record(z.string(), instrumentCacheEntrySchema).default({}),
  previousCloses: z
    .record(z.string(), previousCloseCacheEntrySchema)
    .default({}),
})

type QuoteCache = z.infer<typeof quoteCacheSchema>

const EMPTY_QUOTE_CACHE: QuoteCache = {
  fxSnapshots: {},
  instruments: {},
  previousCloses: {},
}

export const PREVIOUS_CLOSE_CACHE_TTL_MS = 12 * 60 * 60 * 1000
export const FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000

/** Stale data is still usable — returned immediately while refreshed in the background. */
const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Instrument resolutions rarely change. */
const INSTRUMENT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

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

function isUsable(cachedAt: string) {
  return isFresh(cachedAt, STALE_TTL_MS)
}

// ---------------------------------------------------------------------------
// Previous close quotes — stale-while-revalidate
// ---------------------------------------------------------------------------

export type PreviousClosesCacheResult = {
  freshQuotes: Record<string, PreviousCloseQuote>
  staleTargets: PreviousCloseLookupTarget[]
  staleQuotes: Record<string, PreviousCloseQuote>
  missingTargets: PreviousCloseLookupTarget[]
}

export async function getCachedPreviousCloseQuotes(
  targets: PreviousCloseLookupTarget[],
  {
    filePath,
    ttlMs = PREVIOUS_CLOSE_CACHE_TTL_MS,
  }: { filePath?: string; ttlMs?: number } = {}
): Promise<PreviousClosesCacheResult> {
  const cache = await readQuoteCache(filePath)
  const freshQuotes: Record<string, PreviousCloseQuote> = {}
  const staleQuotes: Record<string, PreviousCloseQuote> = {}
  const staleTargets: PreviousCloseLookupTarget[] = []
  const missingTargets: PreviousCloseLookupTarget[] = []

  for (const target of targets) {
    const key = getHoldingKey({ market: target.market, ticker: target.ticker })
    const entry = cache.previousCloses[key]

    if (entry && isFresh(entry.cachedAt, ttlMs)) {
      freshQuotes[key] = entry.quote
      continue
    }

    if (entry && isUsable(entry.cachedAt)) {
      staleQuotes[key] = entry.quote
      staleTargets.push(target)
      continue
    }

    missingTargets.push(target)
  }

  return { freshQuotes, staleTargets, staleQuotes, missingTargets }
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

// ---------------------------------------------------------------------------
// FX snapshots — stale-while-revalidate
// ---------------------------------------------------------------------------

export type FxSnapshotCacheResult = {
  snapshot: FxRateSnapshot
  fresh: boolean
} | null

export async function getCachedFxSnapshot(
  pair: string,
  {
    filePath,
    ttlMs = FX_CACHE_TTL_MS,
  }: { filePath?: string; ttlMs?: number } = {}
): Promise<FxSnapshotCacheResult> {
  const cache = await readQuoteCache(filePath)
  const entry = cache.fxSnapshots[pair]

  if (!entry) {
    return null
  }

  if (isFresh(entry.cachedAt, ttlMs)) {
    return { snapshot: entry.snapshot, fresh: true }
  }

  if (isUsable(entry.cachedAt)) {
    return { snapshot: entry.snapshot, fresh: false }
  }

  return null
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

// ---------------------------------------------------------------------------
// Instrument resolution cache
// ---------------------------------------------------------------------------

export async function getCachedInstrumentResolution(
  key: string,
  { filePath }: { filePath?: string } = {}
): Promise<CachedInstrument | null> {
  const cache = await readQuoteCache(filePath)
  const entry = cache.instruments[key]

  if (!entry || !isFresh(entry.cachedAt, INSTRUMENT_CACHE_TTL_MS)) {
    return null
  }

  return entry.instrument
}

export async function setCachedInstrumentResolution(
  key: string,
  instrument: CachedInstrument,
  { filePath }: { filePath?: string } = {}
) {
  const cache = await readQuoteCache(filePath)
  cache.instruments[key] = {
    cachedAt: new Date().toISOString(),
    instrument,
  }

  await writeQuoteCache(cache, filePath)
}
