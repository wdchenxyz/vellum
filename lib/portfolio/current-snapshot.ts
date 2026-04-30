import type { ValuedHolding } from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"

export type SnapshotHolding = {
  account: string | null
  currency: string
  effectiveMultiplier: number
  effectiveValueUsd: number | null
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

export type CurrentPortfolioSnapshot = {
  effectiveTotalUsd: number
  fxAsOf: string | null
  holdings: SnapshotHolding[]
  isComplete: boolean
  missingFxCount: number
  missingPriceCount: number
  quoteDates: string[]
  totalUsd: number
}

const FLOAT_EPSILON = 1e-8

const EXPOSURE_MULTIPLIERS: Record<string, number> = {
  AMDL: 2,
  GGLL: 2,
  MUU: 2,
  NVDL: 2,
  TSLL: 2,
}

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

function getEffectiveMultiplier(holding: ValuedHolding) {
  const ticker = normalizeTicker(holding.quoteTicker ?? holding.ticker)

  return EXPOSURE_MULTIPLIERS[ticker] ?? 1
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

export function buildCurrentPortfolioSnapshot({
  fxSnapshot,
  holdings,
}: {
  fxSnapshot: FxRateSnapshot | null
  holdings: ValuedHolding[]
}): CurrentPortfolioSnapshot {
  const snapshotHoldings = holdings.map<SnapshotHolding>((holding) => {
    const marketValueUsd = convertMarketValueToUsd({
      currency: holding.currency,
      fxSnapshot,
      value: holding.marketValue,
    })
    const effectiveMultiplier = getEffectiveMultiplier(holding)
    const effectiveValueUsd =
      marketValueUsd === null
        ? null
        : roundNumber(marketValueUsd * effectiveMultiplier)

    return {
      account: holding.account,
      currency: holding.currency,
      effectiveMultiplier,
      effectiveValueUsd,
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

  const missingPriceCount = holdingsWithWeights.filter(
    (holding) => holding.marketValue === null
  ).length
  const missingFxCount = holdingsWithWeights.filter(
    (holding) =>
      holding.marketValue !== null && holding.marketValueUsd === null
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
    fxAsOf: fxSnapshot?.asOf ?? null,
    holdings: holdingsWithWeights,
    isComplete: missingPriceCount === 0 && missingFxCount === 0,
    missingFxCount,
    missingPriceCount,
    quoteDates,
    totalUsd,
  }
}
