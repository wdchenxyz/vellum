import type { ValuedHolding } from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"

export type SnapshotHolding = {
  account: string | null
  currency: string
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

export type SnapshotExposure = {
  key: string
  sources: string[]
  ticker: string
  valueUsd: number
  weight: number
}

export type CurrentPortfolioSnapshot = {
  exposureTotalUsd: number
  exposures: SnapshotExposure[]
  fxAsOf: string | null
  holdings: SnapshotHolding[]
  isComplete: boolean
  missingFxCount: number
  missingPriceCount: number
  quoteDates: string[]
  totalUsd: number
}

const FLOAT_EPSILON = 1e-8

const EXPOSURE_RULES: Record<string, { multiplier: number; ticker: string }> = {
  AMDL: { multiplier: 2, ticker: "AMD" },
  GGLL: { multiplier: 2, ticker: "GOOGL" },
  MUU: { multiplier: 2, ticker: "MU" },
  NVDL: { multiplier: 2, ticker: "NVDA" },
  TSLL: { multiplier: 2, ticker: "TSLA" },
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

  if (left.marketValueUsd !== null && right.marketValueUsd !== null) {
    return right.marketValueUsd - left.marketValueUsd
  }

  if (left.marketValueUsd !== null) {
    return -1
  }

  if (right.marketValueUsd !== null) {
    return 1
  }

  return left.ticker.localeCompare(right.ticker)
}

function buildEffectiveExposures(holdings: SnapshotHolding[]) {
  const exposuresByTicker = new Map<
    string,
    { sources: Set<string>; ticker: string; valueUsd: number }
  >()

  for (const holding of holdings) {
    if (holding.marketValueUsd === null) {
      continue
    }

    const rule =
      EXPOSURE_RULES[normalizeTicker(holding.quoteTicker ?? holding.ticker)] ?? {
        multiplier: 1,
        ticker: normalizeTicker(holding.quoteTicker ?? holding.ticker),
      }
    const valueUsd = roundNumber(holding.marketValueUsd * rule.multiplier)
    const existing = exposuresByTicker.get(rule.ticker)

    if (!existing) {
      exposuresByTicker.set(rule.ticker, {
        sources: new Set([holding.ticker]),
        ticker: rule.ticker,
        valueUsd,
      })
      continue
    }

    existing.sources.add(holding.ticker)
    existing.valueUsd = roundNumber(existing.valueUsd + valueUsd)
  }

  const exposureTotalUsd = roundNumber(
    [...exposuresByTicker.values()].reduce(
      (total, exposure) => total + exposure.valueUsd,
      0
    )
  )

  const exposures = [...exposuresByTicker.values()]
    .map<SnapshotExposure>((exposure) => ({
      key: exposure.ticker,
      sources: [...exposure.sources].sort(),
      ticker: exposure.ticker,
      valueUsd: exposure.valueUsd,
      weight:
        exposureTotalUsd > 0
          ? roundNumber(exposure.valueUsd / exposureTotalUsd, 6)
          : 0,
    }))
    .sort((left, right) => {
      if (right.weight !== left.weight) {
        return right.weight - left.weight
      }

      return left.ticker.localeCompare(right.ticker)
    })

  return { exposureTotalUsd, exposures }
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

    return {
      account: holding.account,
      currency: holding.currency,
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

  const holdingsWithWeights = snapshotHoldings
    .map((holding) => ({
      ...holding,
      weight:
        totalUsd > 0 && holding.marketValueUsd !== null
          ? roundNumber(holding.marketValueUsd / totalUsd, 6)
          : null,
    }))
    .sort(compareSnapshotHoldings)

  const { exposureTotalUsd, exposures } =
    buildEffectiveExposures(holdingsWithWeights)
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
    exposureTotalUsd,
    exposures,
    fxAsOf: fxSnapshot?.asOf ?? null,
    holdings: holdingsWithWeights,
    isComplete: missingPriceCount === 0 && missingFxCount === 0,
    missingFxCount,
    missingPriceCount,
    quoteDates,
    totalUsd,
  }
}
