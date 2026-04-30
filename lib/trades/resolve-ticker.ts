import "server-only"

import { selectInstrumentMatch, fetchTwelveDataJson } from "@/lib/quotes/twelve-data"
import type { ExtractedTrade, TickerCandidate } from "@/lib/trades/schema"
import type { PreviousCloseLookupTarget } from "@/lib/portfolio/schema"
import { z } from "zod"

const US_TICKER_PATTERN = /^[A-Z][A-Z0-9.-]{0,9}$/
const TW_TICKER_PATTERN = /^\d{4,6}$/
const CJK_PATTERN = /\p{Script=Han}/u
const MIN_NAME_MATCH_SCORE = 0.6
const MIN_TOP_SCORE_GAP = 0.15

const symbolSearchResponseSchema = z.object({
  data: z
    .array(
      z.object({
        country: z.string().optional(),
        currency: z.string().optional(),
        exchange: z.string(),
        instrument_name: z.string().optional(),
        instrument_type: z.string().optional(),
        mic_code: z.string(),
        symbol: z.string(),
      })
    )
    .default([]),
  status: z.string().optional(),
})

type CandidateValidation = {
  instrumentName: string | null
  score: number
  ticker: string
}

export type TickerResolutionResult =
  | {
      status: "accepted"
      trade: ExtractedTrade
    }
  | {
      issue: string
      status: "unresolved"
      trade: ExtractedTrade
    }

function normalizeTicker(value: string) {
  return value.trim().toUpperCase()
}

function normalizeCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? null
}

function isTickerLike(value: string) {
  const normalized = normalizeTicker(value)

  return (
    US_TICKER_PATTERN.test(normalized) ||
    TW_TICKER_PATTERN.test(normalized) ||
    CJK_PATTERN.test(normalized)
  )
}

function getExpectedMarket(candidate: string, trade: ExtractedTrade) {
  const normalizedCurrency = normalizeCurrency(trade.currency)

  if (TW_TICKER_PATTERN.test(candidate) || normalizedCurrency === "TWD") {
    return "TW" as const
  }

  if (US_TICKER_PATTERN.test(candidate) || normalizedCurrency === "USD") {
    return "US" as const
  }

  return null
}

function normalizeToken(token: string) {
  const normalized = token.toLowerCase()

  if (normalized === "nvidia") {
    return "nvda"
  }

  return normalized
}

function tokenizeName(value: string) {
  return value
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, " ")
    .split(/\s+/)
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length >= 2)
}

function tokenMatches(visibleToken: string, instrumentTokens: Set<string>) {
  if (instrumentTokens.has(visibleToken)) {
    return true
  }

  for (const instrumentToken of instrumentTokens) {
    if (
      visibleToken.length >= 3 &&
      instrumentToken.startsWith(visibleToken)
    ) {
      return true
    }

    if (
      instrumentToken.length >= 3 &&
      visibleToken.startsWith(instrumentToken)
    ) {
      return true
    }
  }

  return false
}

function hasToken(value: string, token: string) {
  return tokenizeName(value).includes(token)
}

function hasDirectionConflict({
  instrumentName,
  visibleName,
}: {
  instrumentName: string
  visibleName: string
}) {
  const visibleLong = hasToken(visibleName, "long")
  const visibleShort = hasToken(visibleName, "short")
  const instrumentLong = hasToken(instrumentName, "long")
  const instrumentShort = hasToken(instrumentName, "short")

  return (
    (visibleLong && instrumentShort && !instrumentLong) ||
    (visibleShort && instrumentLong && !instrumentShort)
  )
}

export function scoreInstrumentNameMatch({
  instrumentName,
  visibleName,
}: {
  instrumentName: string
  visibleName: string
}) {
  const visibleTokens = tokenizeName(visibleName)
  const instrumentTokens = new Set(tokenizeName(instrumentName))

  if (visibleTokens.length === 0 || instrumentTokens.size === 0) {
    return 0
  }

  const matchedCount = visibleTokens.filter((token) =>
    tokenMatches(token, instrumentTokens)
  ).length

  return matchedCount / visibleTokens.length
}

function getCandidateTickers(trade: ExtractedTrade) {
  const candidates = new Map<string, TickerCandidate>()

  for (const candidate of trade.tickerCandidates ?? []) {
    const ticker = normalizeTicker(candidate.ticker)

    if (!US_TICKER_PATTERN.test(ticker) && !TW_TICKER_PATTERN.test(ticker)) {
      continue
    }

    candidates.set(ticker, {
      confidence: candidate.confidence ?? null,
      reason: candidate.reason?.trim() || null,
      ticker,
    })
  }

  return [...candidates.values()].sort(
    (left, right) => (right.confidence ?? 0) - (left.confidence ?? 0)
  )
}

async function validateCandidate({
  candidate,
  fetcher,
  trade,
}: {
  candidate: TickerCandidate
  fetcher: typeof fetch
  trade: ExtractedTrade
}): Promise<CandidateValidation | null> {
  const ticker = normalizeTicker(candidate.ticker)
  const market = getExpectedMarket(ticker, trade)

  if (!market) {
    return null
  }

  if (market === "TW") {
    return null
  }

  let payload: unknown

  try {
    payload = await fetchTwelveDataJson(
      "/symbol_search",
      { symbol: ticker },
      fetcher
    )
  } catch {
    return null
  }

  const parsed = symbolSearchResponseSchema.safeParse(payload)

  if (!parsed.success) {
    return null
  }

  const target: PreviousCloseLookupTarget = { market, ticker }
  const match = selectInstrumentMatch(parsed.data.data, target, ticker)

  if (!match || normalizeTicker(match.symbol) !== ticker) {
    return null
  }

  const normalizedCurrency = normalizeCurrency(trade.currency)

  if (
    normalizedCurrency &&
    match.currency &&
    normalizeCurrency(match.currency) !== normalizedCurrency
  ) {
    return null
  }

  const visibleName = trade.securityName ?? trade.ticker
  const instrumentName = match.instrument_name ?? ""

  if (
    instrumentName &&
    hasDirectionConflict({ instrumentName, visibleName })
  ) {
    return null
  }

  const score = instrumentName
    ? scoreInstrumentNameMatch({ instrumentName, visibleName })
    : 0

  if (score < MIN_NAME_MATCH_SCORE) {
    return null
  }

  return {
    instrumentName: instrumentName || null,
    score,
    ticker,
  }
}

export async function resolveExtractedTradeTicker({
  fetcher = fetch,
  trade,
}: {
  fetcher?: typeof fetch
  trade: ExtractedTrade
}): Promise<TickerResolutionResult> {
  if (isTickerLike(trade.ticker)) {
    return { status: "accepted", trade }
  }

  const candidates = getCandidateTickers(trade)

  if (candidates.length === 0) {
    return {
      issue: `${trade.ticker}: no visible ticker was found and no ticker candidate was available for validation.`,
      status: "unresolved",
      trade,
    }
  }

  const validations = (
    await Promise.all(
      candidates.map((candidate) =>
        validateCandidate({ candidate, fetcher, trade })
      )
    )
  )
    .filter((result): result is CandidateValidation => result !== null)
    .sort((left, right) => right.score - left.score)

  if (validations.length === 0) {
    return {
      issue: `${trade.ticker}: ticker candidates could not be validated against Twelve Data.`,
      status: "unresolved",
      trade,
    }
  }

  const [best, secondBest] = validations

  if (secondBest && best.score - secondBest.score < MIN_TOP_SCORE_GAP) {
    return {
      issue: `${trade.ticker}: multiple ticker candidates matched too closely for automatic resolution.`,
      status: "unresolved",
      trade,
    }
  }

  return {
    status: "accepted",
    trade: {
      ...trade,
      ticker: best.ticker,
    },
  }
}
