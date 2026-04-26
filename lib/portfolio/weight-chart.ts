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

function normalizeActiveBuckets(activeBuckets: PortfolioWeightBucket[]) {
  return activeBuckets.length > 0 ? activeBuckets : ["TWD", "USD"]
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

function requiresFxRate({
  baseCurrency,
  buckets,
  holdings,
}: {
  baseCurrency: PortfolioWeightBucket
  buckets?: PortfolioWeightBucket[]
  holdings: PortfolioWeightChartBarInput[]
}) {
  return holdings.some(
    (holding) =>
      holding.bucket !== baseCurrency &&
      (!buckets || buckets.includes(holding.bucket))
  )
}

function buildBarComputation({
  baseCurrency,
  holding,
  isActive,
  usdTwdRate,
}: {
  baseCurrency: PortfolioWeightBucket
  holding: PortfolioWeightChartBarInput
  isActive: boolean
  usdTwdRate: number | null
}): PortfolioWeightChartComputation {
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
    isActive,
    key: holding.key,
    profitWeight: null,
    unrealizedAmount,
  }
}

function sumMarketValues(
  bars: PortfolioWeightChartComputation[],
  predicate: (bar: PortfolioWeightChartComputation) => boolean
) {
  return roundNumber(
    bars.reduce(
      (sum, bar) =>
        predicate(bar) ? sum + (bar.convertedMarketValue ?? 0) : sum,
      0
    )
  )
}

function calculateWeight({
  denominator,
  marketValue,
}: {
  denominator: number
  marketValue: number | null
}) {
  if (marketValue === null || denominator <= 0) {
    return null
  }

  return roundNumber(marketValue / denominator, 6)
}

function assignSegmentWeights({
  activeMarketValueTotal,
  allMarketValueTotal,
  bar,
  needsFxRateForActive,
  needsFxRateForAll,
}: {
  activeMarketValueTotal: number
  allMarketValueTotal: number
  bar: PortfolioWeightChartComputation
  needsFxRateForActive: boolean
  needsFxRateForAll: boolean
}) {
  if (!needsFxRateForAll) {
    bar.allWeight = calculateWeight({
      denominator: allMarketValueTotal,
      marketValue: bar.convertedMarketValue,
    })
  }

  if (!needsFxRateForActive && bar.isActive) {
    bar.activeWeight = calculateWeight({
      denominator: activeMarketValueTotal,
      marketValue: bar.convertedMarketValue,
    })
  }

  bar.displayWeight = bar.isActive ? bar.activeWeight : bar.allWeight

  const segmentDenominator = bar.isActive
    ? activeMarketValueTotal
    : allMarketValueTotal

  if (
    bar.displayWeight === null ||
    bar.convertedMarketValue === null ||
    bar.convertedCostBasis === null ||
    segmentDenominator <= 0
  ) {
    return
  }

  const costAmount = Math.min(bar.convertedCostBasis, bar.convertedMarketValue)
  const profitAmount = Math.max(
    bar.convertedMarketValue - bar.convertedCostBasis,
    0
  )

  bar.costWeight = roundNumber(costAmount / segmentDenominator, 6)
  bar.profitWeight = roundNumber(profitAmount / segmentDenominator, 6)
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
  const normalizedActiveBuckets = normalizeActiveBuckets(activeBuckets)
  const baseCurrency = getBaseCurrency(normalizedActiveBuckets)
  const needsFxRateForActive =
    requiresFxRate({
      baseCurrency,
      buckets: normalizedActiveBuckets,
      holdings,
    }) && !usdTwdRate
  const needsFxRateForAll =
    requiresFxRate({
      baseCurrency,
      holdings,
    }) && !usdTwdRate

  const bars = holdings.map((holding) =>
    buildBarComputation({
      baseCurrency,
      holding,
      isActive: normalizedActiveBuckets.includes(holding.bucket),
      usdTwdRate,
    })
  )

  const allMarketValueTotal = sumMarketValues(bars, () => true)
  const activeMarketValueTotal = sumMarketValues(bars, (bar) => bar.isActive)

  for (const bar of bars) {
    assignSegmentWeights({
      activeMarketValueTotal,
      allMarketValueTotal,
      bar,
      needsFxRateForActive,
      needsFxRateForAll,
    })
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
