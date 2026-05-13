import {
  getExposureProfileKey,
  type ExposureDirection,
  type InstrumentExposureProfile,
} from "@/lib/portfolio/exposure-profiles"
import type { ValuedHolding } from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"

export type SnapshotHolding = {
  account: string | null
  currency: string
  effectiveMultiplier: number
  effectiveValueUsd: number | null
  exposureDirection: ExposureDirection
  exposureProfileSource: string | null
  exposureUnderlyingMarket: ValuedHolding["market"]
  exposureUnderlyingTicker: string
  key: string
  marketValue: number | null
  marketValueUsd: number | null
  market: ValuedHolding["market"]
  previousClose: number | null
  previousCloseDate: string | null
  quantityOpen: number
  quoteError: string | null
  quoteTicker: string | null
  ticker: string
  weight: number | null
}

export type SnapshotExposureGroup = {
  effectiveValueUsd: number
  fillKey: string
  holdings: string[]
  key: string
  market: ValuedHolding["market"]
  marketValueUsd: number
  ticker: string
  weight: number | null
}

export type SnapshotExposureIssue = {
  key: string
  message: string
  ticker: string
}

export type CurrentPortfolioSnapshot = {
  effectiveTotalUsd: number
  exposureGroups: SnapshotExposureGroup[]
  exposureIssues: SnapshotExposureIssue[]
  fxAsOf: string | null
  holdings: SnapshotHolding[]
  isComplete: boolean
  missingFxCount: number
  missingPriceCount: number
  quoteDates: string[]
  totalUsd: number
}

const FLOAT_EPSILON = 1e-8

function roundNumber(value: number, decimals = 10) {
  if (Math.abs(value) < FLOAT_EPSILON) {
    return 0
  }

  return Number(value.toFixed(decimals))
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase()
}

function normalizeCurrency(currency: string) {
  return currency.trim().toUpperCase()
}

function getHoldingExposureTicker(holding: ValuedHolding) {
  return normalizeTicker(holding.quoteTicker ?? holding.ticker)
}

function getHoldingExposureProfile(
  holding: ValuedHolding,
  exposureProfilesByKey: Map<string, InstrumentExposureProfile>
) {
  return exposureProfilesByKey.get(
    getExposureProfileKey({
      market: holding.market,
      ticker: getHoldingExposureTicker(holding),
    })
  )
}

function getEffectiveMultiplier(
  profile: InstrumentExposureProfile | undefined
) {
  if (!profile) {
    return 1
  }

  if (profile.exposureDirection === "inverse") {
    return -profile.exposureMultiplier
  }

  return profile.exposureMultiplier
}

export function convertMarketValueToUsd({
  currency,
  fxSnapshot,
  value,
}: {
  currency: string
  fxSnapshot: FxRateSnapshot | null
  value: number | null
}) {
  if (value === null) {
    return null
  }

  const normalizedCurrency = normalizeCurrency(currency)

  if (normalizedCurrency === "USD") {
    return roundNumber(value)
  }

  if (normalizedCurrency === "TWD" && fxSnapshot) {
    return roundNumber(value / fxSnapshot.rate)
  }

  return null
}

function compareSnapshotHoldings(
  left: SnapshotHolding,
  right: SnapshotHolding
) {
  if (left.weight !== null && right.weight !== null) {
    return right.weight - left.weight
  }

  if (left.effectiveValueUsd !== null && right.effectiveValueUsd !== null) {
    return right.effectiveValueUsd - left.effectiveValueUsd
  }

  if (left.effectiveValueUsd !== null) {
    return -1
  }

  if (right.effectiveValueUsd !== null) {
    return 1
  }

  return left.ticker.localeCompare(right.ticker)
}

function buildExposureIssues(holdings: SnapshotHolding[]) {
  return holdings.flatMap<SnapshotExposureIssue>((holding) => {
    if (holding.exposureDirection === "inverse") {
      return [
        {
          key: `${holding.key}:inverse`,
          message: `${holding.ticker} is inverse exposure and is excluded from the long exposure donut.`,
          ticker: holding.ticker,
        },
      ]
    }

    return []
  })
}

function buildLongExposureGroups(holdings: SnapshotHolding[]) {
  const groups = new Map<string, SnapshotExposureGroup>()

  for (const holding of holdings) {
    if (
      holding.effectiveValueUsd === null ||
      holding.marketValueUsd === null ||
      holding.exposureDirection !== "long" ||
      holding.effectiveValueUsd < 0
    ) {
      continue
    }

    const key = getExposureProfileKey({
      market: holding.exposureUnderlyingMarket,
      ticker: holding.exposureUnderlyingTicker,
    })
    const existing = groups.get(key)
    const marketValueUsd = roundNumber(
      (existing?.marketValueUsd ?? 0) + holding.marketValueUsd
    )
    const effectiveValueUsd = roundNumber(
      (existing?.effectiveValueUsd ?? 0) + holding.effectiveValueUsd
    )
    const sourceHoldings = [...(existing?.holdings ?? []), holding.ticker]

    groups.set(key, {
      effectiveValueUsd,
      fillKey: existing?.fillKey ?? holding.key,
      holdings: [...new Set(sourceHoldings)].sort(),
      key,
      market: holding.exposureUnderlyingMarket,
      marketValueUsd,
      ticker: holding.exposureUnderlyingTicker,
      weight: null,
    })
  }

  const effectiveLongTotalUsd = roundNumber(
    [...groups.values()].reduce(
      (total, group) => total + group.effectiveValueUsd,
      0
    )
  )

  return [...groups.values()]
    .map((group) => ({
      ...group,
      weight:
        effectiveLongTotalUsd > 0
          ? roundNumber(group.effectiveValueUsd / effectiveLongTotalUsd, 6)
          : null,
    }))
    .sort((left, right) => right.effectiveValueUsd - left.effectiveValueUsd)
}

export function buildCurrentPortfolioSnapshot({
  exposureProfiles = [],
  fxSnapshot,
  holdings,
}: {
  exposureProfiles?: InstrumentExposureProfile[]
  fxSnapshot: FxRateSnapshot | null
  holdings: ValuedHolding[]
}): CurrentPortfolioSnapshot {
  const exposureProfilesByKey = new Map(
    exposureProfiles.map((profile) => [
      getExposureProfileKey({
        market: profile.market,
        ticker: profile.ticker,
      }),
      profile,
    ])
  )
  const snapshotHoldings = holdings.map<SnapshotHolding>((holding) => {
    const marketValueUsd = convertMarketValueToUsd({
      currency: holding.currency,
      fxSnapshot,
      value: holding.marketValue,
    })
    const exposureProfile = getHoldingExposureProfile(
      holding,
      exposureProfilesByKey
    )
    const effectiveMultiplier = getEffectiveMultiplier(exposureProfile)
    const effectiveValueUsd =
      marketValueUsd === null
        ? null
        : roundNumber(marketValueUsd * effectiveMultiplier)
    const exposureTicker = getHoldingExposureTicker(holding)

    return {
      account: holding.account,
      currency: holding.currency,
      effectiveMultiplier,
      effectiveValueUsd,
      exposureDirection: exposureProfile?.exposureDirection ?? "long",
      exposureProfileSource: exposureProfile?.source ?? null,
      exposureUnderlyingMarket:
        exposureProfile?.underlyingMarket ?? holding.market,
      exposureUnderlyingTicker:
        exposureProfile?.underlyingTicker ?? exposureTicker,
      key: holding.key,
      market: holding.market,
      marketValue: holding.marketValue,
      marketValueUsd,
      previousClose: holding.previousClose,
      previousCloseDate: holding.previousCloseDate,
      quantityOpen: holding.quantityOpen,
      quoteError: holding.quoteError,
      quoteTicker: holding.quoteTicker,
      ticker: holding.ticker,
      weight: null,
    }
  })

  const totalUsd = roundNumber(
    snapshotHoldings.reduce(
      (total, holding) => total + (holding.marketValueUsd ?? 0),
      0
    )
  )
  const effectiveTotalUsd = roundNumber(
    snapshotHoldings.reduce(
      (total, holding) => total + (holding.effectiveValueUsd ?? 0),
      0
    )
  )

  const holdingsWithWeights = snapshotHoldings
    .map((holding) => ({
      ...holding,
      weight:
        effectiveTotalUsd > 0 && holding.effectiveValueUsd !== null
          ? roundNumber(holding.effectiveValueUsd / effectiveTotalUsd, 6)
          : null,
    }))
    .sort(compareSnapshotHoldings)
  const exposureGroups = buildLongExposureGroups(holdingsWithWeights)
  const exposureIssues = buildExposureIssues(holdingsWithWeights)

  const missingPriceCount = holdingsWithWeights.filter(
    (holding) => holding.marketValue === null
  ).length
  const missingFxCount = holdingsWithWeights.filter(
    (holding) => holding.marketValue !== null && holding.marketValueUsd === null
  ).length
  const quoteDates = [
    ...new Set(
      holdingsWithWeights
        .map((holding) => holding.previousCloseDate)
        .filter((date): date is string => Boolean(date))
    ),
  ].sort()

  return {
    effectiveTotalUsd,
    exposureGroups,
    exposureIssues,
    fxAsOf: fxSnapshot?.asOf ?? null,
    holdings: holdingsWithWeights,
    isComplete: missingPriceCount === 0 && missingFxCount === 0,
    missingFxCount,
    missingPriceCount,
    quoteDates,
    totalUsd,
  }
}
