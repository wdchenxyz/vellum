import "server-only"

import { getHoldingKey, inferSupportedMarket } from "@/lib/portfolio/holdings"
import { fetchTaiwanPreviousClose } from "@/lib/quotes/taiwan-prices"
import { resolveTaiwanTickerByName } from "@/lib/quotes/taiwan-symbols"
import type {
  PreviousCloseLookupTarget,
  PreviousCloseQuote,
  SupportedMarket,
} from "@/lib/portfolio/schema"
import { z } from "zod"

const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com"
const US_MIC_PRIORITY = ["XNMS", "XNGS", "XNAS", "XNYS", "ARCX", "BATS", "XASE"]
const TW_MIC_PRIORITY = ["XTAI", "ROCO"]

const twelveDataErrorSchema = z.object({
  status: z.literal("error"),
  message: z.string(),
})

const twelveDataStocksResponseSchema = z.object({
  data: z
    .array(
      z.object({
        symbol: z.string(),
        instrument_name: z.string().optional(),
        instrument_type: z.string().optional(),
        exchange: z.string(),
        mic_code: z.string(),
        currency: z.string().optional(),
        country: z.string().optional(),
      })
    )
    .default([]),
  status: z.string().optional(),
})

const twelveDataEodResponseSchema = z.object({
  symbol: z.string(),
  exchange: z.string().nullable().optional(),
  mic_code: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  datetime: z.string().nullable().optional(),
  close: z.string(),
})

export type TwelveDataStockLookupItem = z.infer<
  typeof twelveDataStocksResponseSchema
>["data"][number]

function getCountryName(market: SupportedMarket) {
  return market === "TW" ? "Taiwan" : "United States"
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

function getAuthorizationHeader() {
  const apiKey = process.env.TWELVEDATA_API_KEY

  if (!apiKey) {
    throw new Error("TWELVEDATA_API_KEY is not configured.")
  }

  return `apikey ${apiKey}`
}

function buildTwelveDataUrl(
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

function parseDecimal(value: string) {
  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new Error(`Twelve Data returned an invalid numeric value: ${value}`)
  }

  return parsed
}

async function fetchTwelveDataJson(
  pathname: string,
  params: Record<string, string | undefined>,
  fetcher: typeof fetch
) {
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

async function resolveInstrument(
  target: PreviousCloseLookupTarget,
  fetcher: typeof fetch
) {
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

  const lookupSymbol = target.ticker.trim().toUpperCase()

  const payload = await fetchTwelveDataJson(
    "/symbol_search",
    {
      symbol: lookupSymbol,
    },
    fetcher
  )
  const parsed = twelveDataStocksResponseSchema.safeParse(payload)

  if (!parsed.success) {
    throw new Error("Twelve Data returned an invalid instrument response.")
  }

  const instrument = selectInstrumentMatch(
    parsed.data.data,
    target,
    lookupSymbol
  )

  if (!instrument) {
    throw new Error(
      `No supported ${getCountryName(target.market)} listing was found for ${target.ticker}.`
    )
  }

  return instrument
}

async function fetchPreviousClose(
  target: PreviousCloseLookupTarget,
  fetcher: typeof fetch
) {
  const instrument = await resolveInstrument(target, fetcher)

  if (target.market === "TW") {
    const taiwanQuote = await fetchTaiwanPreviousClose(
      instrument.symbol,
      fetcher
    )

    return {
      asOf: taiwanQuote.asOf,
      currency: "TWD",
      exchange: instrument.exchange,
      key: getHoldingKey({ market: target.market, ticker: target.ticker }),
      market: target.market,
      micCode: instrument.mic_code,
      previousClose: taiwanQuote.previousClose,
      ticker: instrument.symbol,
    }
  }

  const payload = await fetchTwelveDataJson(
    "/eod",
    {
      mic_code: instrument.mic_code,
      symbol: instrument.symbol,
    },
    fetcher
  )
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
    key: getHoldingKey({ market: target.market, ticker: target.ticker }),
    market: target.market,
    micCode: parsed.data.mic_code ?? instrument.mic_code,
    previousClose: parseDecimal(parsed.data.close),
    ticker: instrument.symbol,
  }
}

export async function fetchPreviousCloseSnapshots(
  targets: PreviousCloseLookupTarget[],
  fetcher: typeof fetch = fetch
): Promise<PreviousCloseQuote[]> {
  return Promise.all(
    targets.map(async (target) => {
      try {
        return await fetchPreviousClose(target, fetcher)
      } catch (error) {
        return {
          asOf: null,
          currency: target.market === "TW" ? "TWD" : "USD",
          error: getErrorMessage(error),
          exchange: null,
          key: getHoldingKey({ market: target.market, ticker: target.ticker }),
          market: target.market,
          micCode: null,
          previousClose: null,
          ticker: target.ticker.trim().toUpperCase(),
        }
      }
    })
  )
}
