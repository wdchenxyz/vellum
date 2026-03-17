export type PortfolioWeightBucket = "USD" | "TWD"

export type PortfolioWeightChartBarInput = {
  bucket: PortfolioWeightBucket
  costBasis: number | null
  marketValue: number | null
  key: string
}

export type PortfolioWeightChartComputation = {
  activeWeight: number | null
  allWeight: number | null
  convertedCostBasis: number | null
  convertedMarketValue: number | null
  costWeight: number | null
  displayWeight: number | null
  isUnderwater: boolean
  isActive: boolean
  key: string
  profitWeight: number | null
  unrealizedAmount: number | null
}

export type PortfolioWeightChartSummary = {
  activeBuckets: PortfolioWeightBucket[]
  allMarketValueTotal: number | null
  baseCurrency: PortfolioWeightBucket
  bars: PortfolioWeightChartComputation[]
  needsFxRateForActive: boolean
  needsFxRateForAll: boolean
}

const FLOAT_EPSILON = 1e-8

function roundNumber(value: number, decimals = 10) {
  if (Math.abs(value) < FLOAT_EPSILON) {
    return 0
  }

  return Number(value.toFixed(decimals))
}

function getBaseCurrency(activeBuckets: PortfolioWeightBucket[]) {
  if (activeBuckets.length === 1) {
    return activeBuckets[0]
  }

  return "TWD"
}

function convertMarketValue({
  baseCurrency,
  bucket,
  marketValue,
  usdTwdRate,
}: {
  baseCurrency: PortfolioWeightBucket
  bucket: PortfolioWeightBucket
  marketValue: number | null
  usdTwdRate: number | null
}) {
  if (marketValue === null) {
    return null
  }

  if (bucket === baseCurrency) {
    return marketValue
  }

  if (!usdTwdRate) {
    return null
  }

  if (bucket === "USD" && baseCurrency === "TWD") {
    return roundNumber(marketValue * usdTwdRate)
  }

  if (bucket === "TWD" && baseCurrency === "USD") {
    return roundNumber(marketValue / usdTwdRate)
  }

  return null
}

export function buildPortfolioWeightChartSummary({
  activeBuckets,
  holdings,
  usdTwdRate,
}: {
  activeBuckets: PortfolioWeightBucket[]
  holdings: PortfolioWeightChartBarInput[]
  usdTwdRate: number | null
}): PortfolioWeightChartSummary {
  const normalizedActiveBuckets: PortfolioWeightBucket[] =
    activeBuckets.length > 0 ? activeBuckets : ["TWD", "USD"]
  const baseCurrency = getBaseCurrency(normalizedActiveBuckets)
  const needsFxRateForActive =
    holdings.some(
      (holding) =>
        normalizedActiveBuckets.includes(holding.bucket) &&
        holding.bucket !== baseCurrency
    ) && !usdTwdRate
  const needsFxRateForAll =
    holdings.some((holding) => holding.bucket !== baseCurrency) && !usdTwdRate

  const bars = holdings.map<PortfolioWeightChartComputation>((holding) => {
    const convertedCostBasis = convertMarketValue({
      baseCurrency,
      bucket: holding.bucket,
      marketValue: holding.costBasis,
      usdTwdRate,
    })
    const convertedMarketValue = convertMarketValue({
      baseCurrency,
      bucket: holding.bucket,
      marketValue: holding.marketValue,
      usdTwdRate,
    })
    const unrealizedAmount =
      convertedCostBasis !== null && convertedMarketValue !== null
        ? roundNumber(convertedMarketValue - convertedCostBasis)
        : null

    return {
      activeWeight: null,
      allWeight: null,
      convertedCostBasis,
      convertedMarketValue,
      costWeight: null,
      displayWeight: null,
      isUnderwater: unrealizedAmount !== null && unrealizedAmount < 0,
      isActive: normalizedActiveBuckets.includes(holding.bucket),
      key: holding.key,
      profitWeight: null,
      unrealizedAmount,
    }
  })

  const allMarketValueTotal = roundNumber(
    bars.reduce((sum, bar) => sum + (bar.convertedMarketValue ?? 0), 0)
  )
  const activeMarketValueTotal = roundNumber(
    bars.reduce(
      (sum, bar) => sum + (bar.isActive ? (bar.convertedMarketValue ?? 0) : 0),
      0
    )
  )

  for (const bar of bars) {
    if (
      !needsFxRateForAll &&
      bar.convertedMarketValue !== null &&
      allMarketValueTotal > 0
    ) {
      bar.allWeight = roundNumber(
        bar.convertedMarketValue / allMarketValueTotal,
        6
      )
    }

    if (
      !needsFxRateForActive &&
      bar.isActive &&
      bar.convertedMarketValue !== null &&
      activeMarketValueTotal > 0
    ) {
      bar.activeWeight = roundNumber(
        bar.convertedMarketValue / activeMarketValueTotal,
        6
      )
    }

    bar.displayWeight = bar.isActive ? bar.activeWeight : bar.allWeight

    const segmentDenominator = bar.isActive
      ? activeMarketValueTotal
      : allMarketValueTotal

    if (
      bar.displayWeight !== null &&
      bar.convertedMarketValue !== null &&
      bar.convertedCostBasis !== null &&
      segmentDenominator > 0
    ) {
      const costAmount = Math.min(
        bar.convertedCostBasis,
        bar.convertedMarketValue
      )
      const profitAmount = Math.max(
        bar.convertedMarketValue - bar.convertedCostBasis,
        0
      )

      bar.costWeight = roundNumber(costAmount / segmentDenominator, 6)
      bar.profitWeight = roundNumber(profitAmount / segmentDenominator, 6)
    }
  }

  return {
    activeBuckets: normalizedActiveBuckets,
    allMarketValueTotal: allMarketValueTotal > 0 ? allMarketValueTotal : null,
    baseCurrency,
    bars,
    needsFxRateForActive,
    needsFxRateForAll,
  }
}
