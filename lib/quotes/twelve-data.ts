import "server-only"

import { getHoldingKey, inferSupportedMarket } from "@/lib/portfolio/holdings"
import {
  type CachedInstrument,
  type FxSnapshotCacheResult,
  getCachedFxSnapshot,
  getCachedPreviousCloseQuotes,
  setCachedFxSnapshot,
  setCachedPreviousCloseQuotes,
} from "@/lib/quotes/cache"
import { fetchTaiwanPreviousClose } from "@/lib/quotes/taiwan-prices"
import { resolveTaiwanTickerByName } from "@/lib/quotes/taiwan-symbols"
import { enqueue } from "@/lib/quotes/throttle"
import type {
  PreviousCloseLookupTarget,
  PreviousCloseQuote,
  SupportedMarket,
} from "@/lib/portfolio/schema"
import { z } from "zod"

const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com"
const US_MIC_PRIORITY = ["XNMS", "XNGS", "XNAS", "XNYS", "ARCX", "BATS", "XASE"]
const TW_MIC_PRIORITY = ["XTAI", "ROCO"]

const RATE_LIMIT_RETRY_DELAY_MS = 15_000

const twelveDataErrorSchema = z.object({
  status: z.literal("error"),
  message: z.string(),
})

const twelveDataEodResponseSchema = z.object({
  symbol: z.string(),
  exchange: z.string().nullable().optional(),
  mic_code: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  datetime: z.string().nullable().optional(),
  close: z.string(),
})
const twelveDataBatchEodResponseSchema = z.record(z.string(), z.unknown())

export type TwelveDataStockLookupItem = {
  country?: string
  currency?: string
  exchange: string
  instrument_name?: string
  instrument_type?: string
  mic_code: string
  symbol: string
}

function countryMatchesMarket(
  country: string | undefined,
  market: SupportedMarket
) {
  if (!country) {
    return false
  }

  const normalizedCountry = country.trim().toUpperCase()

  if (market === "TW") {
    return normalizedCountry === "TAIWAN" || normalizedCountry === "TW"
  }

  return normalizedCountry === "UNITED STATES" || normalizedCountry === "US"
}

export function getAuthorizationHeader() {
  const apiKey = process.env.TWELVEDATA_API_KEY

  if (!apiKey) {
    throw new Error("TWELVEDATA_API_KEY is not configured.")
  }

  return `apikey ${apiKey}`
}

export function buildTwelveDataUrl(
  pathname: string,
  params: Record<string, string | undefined>
) {
  const url = new URL(pathname, TWELVE_DATA_BASE_URL)

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }

  return url
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Unable to fetch previous close data from Twelve Data."
}

function getMicPriority(market: SupportedMarket) {
  return market === "TW" ? TW_MIC_PRIORITY : US_MIC_PRIORITY
}

function getLookupKey(target: PreviousCloseLookupTarget) {
  return getHoldingKey({ market: target.market, ticker: target.ticker })
}

export function parseDecimal(value: string) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new Error(`Twelve Data returned an invalid numeric value: ${value}`)
  }

  return parsed
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return msg.includes("rate limit") || msg.includes("too many requests")
  }
  return false
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Core fetch helper. Runs through the throttle queue and retries once on
 * rate-limit errors after a cooldown.
 */
export async function fetchTwelveDataJson(
  pathname: string,
  params: Record<string, string | undefined>,
  fetcher: typeof fetch,
  { skipThrottle = false }: { skipThrottle?: boolean } = {}
) {
  async function doFetch() {
    const response = await fetcher(buildTwelveDataUrl(pathname, params), {
      cache: "no-store",
      headers: {
        Authorization: getAuthorizationHeader(),
      },
    })

    const payload = await response.json().catch(() => null)
    const maybeError = twelveDataErrorSchema.safeParse(payload)

    if (maybeError.success) {
      throw new Error(maybeError.data.message)
    }

    if (!response.ok) {
      throw new Error(
        `Twelve Data request failed with status ${response.status}.`
      )
    }

    if (!payload) {
      throw new Error("Twelve Data returned an empty response.")
    }

    return payload
  }

  async function fetchWithRetry() {
    try {
      return await doFetch()
    } catch (error) {
      if (isRateLimitError(error)) {
        console.warn(
          `[twelve-data] Rate limited on ${pathname}, retrying in ${RATE_LIMIT_RETRY_DELAY_MS / 1000}s...`
        )
        await sleep(RATE_LIMIT_RETRY_DELAY_MS)
        return await doFetch()
      }
      throw error
    }
  }

  return skipThrottle ? fetchWithRetry() : enqueue(fetchWithRetry)
}

export function selectInstrumentMatch(
  items: TwelveDataStockLookupItem[],
  target: PreviousCloseLookupTarget,
  lookupSymbol = target.ticker
) {
  const normalizedTicker = lookupSymbol.trim().toUpperCase()
  const exactMatches = items.filter(
    (item) => item.symbol.trim().toUpperCase() === normalizedTicker
  )
  const marketMatches = exactMatches.filter((item) =>
    countryMatchesMarket(item.country, target.market)
  )

  const candidates = marketMatches.length > 0 ? marketMatches : exactMatches

  if (candidates.length === 0) {
    return null
  }

  const micPriority = getMicPriority(target.market)

  return [...candidates].sort((left, right) => {
    const leftPriority = micPriority.indexOf(left.mic_code)
    const rightPriority = micPriority.indexOf(right.mic_code)

    const normalizedLeftPriority = leftPriority === -1 ? 999 : leftPriority
    const normalizedRightPriority = rightPriority === -1 ? 999 : rightPriority

    if (normalizedLeftPriority !== normalizedRightPriority) {
      return normalizedLeftPriority - normalizedRightPriority
    }

    return left.exchange.localeCompare(right.exchange)
  })[0]
}

function buildPreviousCloseErrorQuote(
  target: PreviousCloseLookupTarget,
  error: unknown
): PreviousCloseQuote {
  return {
    asOf: null,
    currency: target.market === "TW" ? "TWD" : "USD",
    error: getErrorMessage(error),
    exchange: null,
    key: getLookupKey(target),
    market: target.market,
    micCode: null,
    previousClose: null,
    ticker: target.ticker.trim().toUpperCase(),
  }
}

function buildDirectUsInstrument(
  target: PreviousCloseLookupTarget
): CachedInstrument {
  return {
    country: "United States",
    currency: "USD",
    exchange: "",
    instrument_type: "Common Stock",
    mic_code: "",
    symbol: target.ticker.trim().toUpperCase(),
  }
}

async function resolveInstrument(
  target: PreviousCloseLookupTarget,
  fetcher: typeof fetch
): Promise<CachedInstrument> {
  if (target.market === "TW") {
    const resolvedTaiwanTicker = await resolveTaiwanTickerByName(
      target.ticker,
      fetcher
    )

    if (!resolvedTaiwanTicker) {
      throw new Error(
        `No supported Taiwan listing was found for ${target.ticker}.`
      )
    }

    return {
      country: "Taiwan",
      currency: "TWD",
      exchange: resolvedTaiwanTicker.exchange,
      instrument_name: resolvedTaiwanTicker.matchedName,
      instrument_type: "Common Stock",
      mic_code: resolvedTaiwanTicker.micCode,
      symbol: resolvedTaiwanTicker.symbol,
    }
  }

  return buildDirectUsInstrument(target)
}

async function fetchPreviousClose(
  target: PreviousCloseLookupTarget,
  fetcher: typeof fetch
) {
  const instrument = await resolveInstrument(target, fetcher)

  return fetchPreviousCloseForInstrument(target, instrument, fetcher)
}

async function fetchPreviousCloseForInstrument(
  target: PreviousCloseLookupTarget,
  instrument: CachedInstrument,
  fetcher: typeof fetch,
  { skipThrottle = false }: { skipThrottle?: boolean } = {}
) {
  if (target.market === "TW") {
    const taiwanQuote = await fetchTaiwanPreviousClose(
      instrument.symbol,
      fetcher
    )

    return {
      asOf: taiwanQuote.asOf,
      currency: "TWD",
      exchange: instrument.exchange,
      key: getLookupKey(target),
      market: target.market,
      micCode: instrument.mic_code,
      previousClose: taiwanQuote.previousClose,
      ticker: instrument.symbol,
    }
  }

  const payload = await fetchTwelveDataJson(
    "/eod",
    {
      mic_code: instrument.mic_code || undefined,
      symbol: instrument.symbol,
    },
    fetcher,
    { skipThrottle }
  )

  return buildUsPreviousCloseQuote(target, instrument, payload)
}

function buildUsPreviousCloseQuote(
  target: PreviousCloseLookupTarget,
  instrument: CachedInstrument,
  payload: unknown
): PreviousCloseQuote {
  const parsed = twelveDataEodResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("Twelve Data returned an invalid end-of-day response.")
  }

  const market = inferSupportedMarket({
    ticker: target.ticker,
    currency: parsed.data.currency ?? instrument.currency ?? null,
  })

  if (!market || market !== target.market) {
    throw new Error(
      `Resolved market for ${target.ticker} is outside the MVP scope.`
    )
  }

  return {
    asOf: parsed.data.datetime ?? null,
    currency: parsed.data.currency ?? instrument.currency ?? null,
    exchange: parsed.data.exchange ?? instrument.exchange,
    key: getLookupKey(target),
    market: target.market,
    micCode: parsed.data.mic_code ?? instrument.mic_code,
    previousClose: parseDecimal(parsed.data.close),
    ticker: instrument.symbol,
  }
}

type ResolvedUsPreviousCloseTarget = {
  instrument: CachedInstrument
  target: PreviousCloseLookupTarget
}

function getBatchEodPayload(
  payload: Record<string, unknown>,
  instrument: CachedInstrument
) {
  const normalizedSymbol = instrument.symbol.trim().toUpperCase()

  return (
    payload[instrument.symbol] ??
    payload[normalizedSymbol] ??
    Object.entries(payload).find(
      ([symbol]) => symbol.trim().toUpperCase() === normalizedSymbol
    )?.[1]
  )
}

async function fetchUsPreviousCloseBatchGroup(
  group: ResolvedUsPreviousCloseTarget[],
  fetcher: typeof fetch
) {
  if (group.length === 1) {
    const [{ instrument, target }] = group
    return [
      await fetchPreviousCloseForInstrument(target, instrument, fetcher, {
        skipThrottle: true,
      }),
    ]
  }

  const payload = await fetchTwelveDataJson(
    "/eod",
    {
      mic_code: group[0]?.instrument.mic_code || undefined,
      symbol: group.map(({ instrument }) => instrument.symbol).join(","),
    },
    fetcher,
    { skipThrottle: true }
  )
  const parsed = twelveDataBatchEodResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error(
      "Twelve Data returned an invalid batch end-of-day response."
    )
  }

  return group.map(({ instrument, target }) => {
    const quotePayload = getBatchEodPayload(parsed.data, instrument)

    if (!quotePayload) {
      throw new Error(
        `Twelve Data did not return an end-of-day quote for ${instrument.symbol}.`
      )
    }

    return buildUsPreviousCloseQuote(target, instrument, quotePayload)
  })
}

async function fetchUsPreviousCloseBatch(
  targets: ResolvedUsPreviousCloseTarget[],
  fetcher: typeof fetch
) {
  const groupsByMic = new Map<string, ResolvedUsPreviousCloseTarget[]>()

  for (const target of targets) {
    const micCode = target.instrument.mic_code || "__default__"
    const group = groupsByMic.get(micCode) ?? []
    group.push(target)
    groupsByMic.set(micCode, group)
  }

  const quotes: PreviousCloseQuote[] = []

  for (const group of groupsByMic.values()) {
    try {
      quotes.push(...(await fetchUsPreviousCloseBatchGroup(group, fetcher)))
    } catch (error) {
      quotes.push(
        ...group.map(({ target }) =>
          buildPreviousCloseErrorQuote(target, error)
        )
      )
    }
  }

  return quotes
}

async function fetchForcedPreviousCloseQuotes(
  targets: PreviousCloseLookupTarget[],
  fetcher: typeof fetch
) {
  const quotes: PreviousCloseQuote[] = []
  const usTargets: ResolvedUsPreviousCloseTarget[] = []

  await Promise.all(
    targets.map(async (target) => {
      try {
        const instrument = await resolveInstrument(target, fetcher)

        if (target.market === "TW") {
          quotes.push(
            await fetchPreviousCloseForInstrument(target, instrument, fetcher)
          )
          return
        }

        usTargets.push({ instrument, target })
      } catch (error) {
        quotes.push(buildPreviousCloseErrorQuote(target, error))
      }
    })
  )

  quotes.push(...(await fetchUsPreviousCloseBatch(usTargets, fetcher)))

  return quotes
}

async function fetchMissingPreviousCloseQuotes(
  targets: PreviousCloseLookupTarget[],
  fetcher: typeof fetch
) {
  return fetchForcedPreviousCloseQuotes(targets, fetcher)
}

function buildPreviousCloseLookup(
  freshQuotes: Record<string, PreviousCloseQuote>,
  staleQuotes: Record<string, PreviousCloseQuote>,
  fetchedQuotes: PreviousCloseQuote[]
) {
  const quotesByKey: Record<string, PreviousCloseQuote> = {
    ...freshQuotes,
    ...staleQuotes,
  }

  for (const quote of fetchedQuotes) {
    quotesByKey[quote.key] = quote
  }

  return quotesByKey
}

function mapQuotesToTargets(
  targets: PreviousCloseLookupTarget[],
  quotesByKey: Record<string, PreviousCloseQuote>
) {
  return targets.map((target) => quotesByKey[getLookupKey(target)])
}

function mapCachedQuotesToTargets(
  targets: PreviousCloseLookupTarget[],
  quotesByKey: Record<string, PreviousCloseQuote>
) {
  return targets.flatMap((target) => {
    const quote = quotesByKey[getLookupKey(target)]
    return quote ? [quote] : []
  })
}

function getCachedFxSnapshotOrRefresh(
  cachedResult: FxSnapshotCacheResult,
  fetcher: typeof fetch
) {
  if (!cachedResult) {
    return null
  }

  if (!cachedResult.fresh) {
    void refreshFxSnapshot(fetcher)
  }

  return cachedResult.snapshot
}

export async function fetchPreviousCloseSnapshots(
  targets: PreviousCloseLookupTarget[],
  fetcher: typeof fetch = fetch,
  {
    forceRefresh = false,
    returnCachedImmediately = false,
  }: { forceRefresh?: boolean; returnCachedImmediately?: boolean } = {}
): Promise<PreviousCloseQuote[]> {
  if (forceRefresh) {
    const fetchedQuotes = await fetchForcedPreviousCloseQuotes(targets, fetcher)

    await setCachedPreviousCloseQuotes(fetchedQuotes)

    return mapQuotesToTargets(
      targets,
      buildPreviousCloseLookup({}, {}, fetchedQuotes)
    )
  }

  const { freshQuotes, staleTargets, staleQuotes, missingTargets } =
    await getCachedPreviousCloseQuotes(targets)

  const cachedQuotes = buildPreviousCloseLookup(freshQuotes, staleQuotes, [])
  const hasCachedQuotes = Object.keys(cachedQuotes).length > 0

  if (returnCachedImmediately && hasCachedQuotes) {
    const refreshTargets = [...staleTargets, ...missingTargets]

    if (refreshTargets.length > 0) {
      void refreshStaleQuotes(refreshTargets, fetcher)
    }

    return mapCachedQuotesToTargets(targets, cachedQuotes)
  }

  const fetchedQuotes = await fetchMissingPreviousCloseQuotes(
    missingTargets,
    fetcher
  )

  await setCachedPreviousCloseQuotes(fetchedQuotes)

  if (staleTargets.length > 0) {
    void refreshStaleQuotes(staleTargets, fetcher)
  }

  return mapQuotesToTargets(
    targets,
    buildPreviousCloseLookup(freshQuotes, staleQuotes, fetchedQuotes)
  )
}

async function refreshStaleQuotes(
  targets: PreviousCloseLookupTarget[],
  fetcher: typeof fetch
) {
  const refreshed: PreviousCloseQuote[] = []

  for (const target of targets) {
    try {
      refreshed.push(await fetchPreviousClose(target, fetcher))
    } catch (error) {
      console.warn(
        `[twelve-data] Background refresh failed for ${target.ticker}:`,
        getErrorMessage(error)
      )
    }
  }

  await setCachedPreviousCloseQuotes(refreshed).catch((error) => {
    console.warn("[twelve-data] Failed to write refreshed quotes:", error)
  })
}

export async function fetchUsdTwdFxSnapshot(
  fetcher: typeof fetch = fetch,
  { forceRefresh = false }: { forceRefresh?: boolean } = {}
) {
  if (forceRefresh) {
    return await fetchFreshFxSnapshot(fetcher, { skipThrottle: true })
  }

  const cachedResult: FxSnapshotCacheResult =
    await getCachedFxSnapshot("USD/TWD")
  const cachedSnapshot = getCachedFxSnapshotOrRefresh(cachedResult, fetcher)

  if (cachedSnapshot) {
    return cachedSnapshot
  }

  return await fetchFreshFxSnapshot(fetcher)
}

async function fetchFreshFxSnapshot(
  fetcher: typeof fetch,
  { skipThrottle = false }: { skipThrottle?: boolean } = {}
) {
  const payload = await fetchTwelveDataJson(
    "/eod",
    {
      symbol: "USD/TWD",
    },
    fetcher,
    { skipThrottle }
  )
  const parsed = twelveDataEodResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("Twelve Data returned an invalid USD/TWD response.")
  }

  const snapshot = {
    asOf: parsed.data.datetime ?? null,
    pair: "USD/TWD",
    rate: parseDecimal(parsed.data.close),
  }

  await setCachedFxSnapshot(snapshot)

  return snapshot
}

async function refreshFxSnapshot(fetcher: typeof fetch) {
  try {
    await fetchFreshFxSnapshot(fetcher)
  } catch (error) {
    console.warn(
      "[twelve-data] Background FX refresh failed:",
      getErrorMessage(error)
    )
  }
}
