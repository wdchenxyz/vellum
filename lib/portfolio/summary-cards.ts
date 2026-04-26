import type { ValuedHolding } from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"

export type SummaryTotals = {
  convertibleCostTwd: number
  convertibleMarketTwd: number
  holdingCount: number
  missingMarketCount: number
  needsFxCount: number
}

export type AccountSummary = {
  account: string
  cost: number | null
  currencies: string[]
  displayCurrency: string
  holdingCount: number
  marketValue: number | null
  marketValueTwd: number | null
  missingMarketCount: number
  needsFxCount: number
}

export type SummaryFxStatus = "not-required" | "pending" | "ready"
export type TotalSummaryStatus =
  | "not-required"
  | "ready"
  | "fx-pending"
  | "price-pending"
export type AccountSummaryStatus = "ready" | "fx-pending" | "price-pending"
export type AccountSummaryValueMetrics = {
  changeAmountTwd: number | null
  changeRatio: number | null
  costTwd: number | null
  marketValueTwd: number | null
}

export function convertUsdToTwd(
  value: number,
  fxSnapshot: FxRateSnapshot | null
) {
  if (!fxSnapshot) {
    return null
  }

  return value * fxSnapshot.rate
}

export function summarizeInTwd(
  holdings: ValuedHolding[],
  fxSnapshot: FxRateSnapshot | null
): SummaryTotals {
  return holdings.reduce<SummaryTotals>(
    (summary, holding) => {
      summary.holdingCount += 1

      const needsFx = holding.currency === "USD" && !fxSnapshot

      if (needsFx) {
        summary.needsFxCount += 1
      }

      const costTwd =
        holding.currency === "TWD"
          ? holding.totalCostOpen
          : convertUsdToTwd(holding.totalCostOpen, fxSnapshot)

      if (costTwd !== null) {
        summary.convertibleCostTwd += costTwd
      }

      if (holding.marketValue === null) {
        summary.missingMarketCount += 1
        return summary
      }

      if (needsFx) {
        return summary
      }

      const marketTwd =
        holding.currency === "TWD"
          ? holding.marketValue
          : convertUsdToTwd(holding.marketValue, fxSnapshot)

      if (marketTwd !== null) {
        summary.convertibleMarketTwd += marketTwd
      }

      return summary
    },
    {
      convertibleCostTwd: 0,
      convertibleMarketTwd: 0,
      holdingCount: 0,
      missingMarketCount: 0,
      needsFxCount: 0,
    }
  )
}

function hasCompleteMarketValue(summary: {
  missingMarketCount: number
  needsFxCount: number
}) {
  return summary.missingMarketCount === 0 && summary.needsFxCount === 0
}

export function getSummaryFxStatus(
  holdings: ValuedHolding[],
  fxSnapshot: FxRateSnapshot | null
): SummaryFxStatus {
  const hasUsdHoldings = holdings.some((holding) => holding.currency === "USD")

  if (!hasUsdHoldings) {
    return "not-required"
  }

  return fxSnapshot ? "ready" : "pending"
}

export function getTotalSummaryValues(
  holdings: ValuedHolding[],
  fxSnapshot: FxRateSnapshot | null
) {
  const totals = summarizeInTwd(holdings, fxSnapshot)
  const totalNeedsFx = getSummaryFxStatus(holdings, fxSnapshot) === "pending"
  const canValueCost = totals.needsFxCount === 0
  const canValueTotal = hasCompleteMarketValue(totals) && !totalNeedsFx

  return {
    totalCostTwd: canValueCost ? totals.convertibleCostTwd : null,
    totalMarketValueTwd: canValueTotal ? totals.convertibleMarketTwd : null,
    totalNeedsFx,
    totals,
  }
}

export function getTotalSummaryStatus(
  holdings: ValuedHolding[],
  fxSnapshot: FxRateSnapshot | null
): TotalSummaryStatus {
  const totals = summarizeInTwd(holdings, fxSnapshot)

  if (totals.missingMarketCount > 0) {
    return "price-pending"
  }

  const fxStatus = getSummaryFxStatus(holdings, fxSnapshot)

  if (fxStatus === "pending" && totals.needsFxCount > 0) {
    return "fx-pending"
  }

  return fxStatus
}

export function getAccountSummaryStatus(
  summary: Pick<AccountSummary, "missingMarketCount" | "needsFxCount">
): AccountSummaryStatus {
  if (summary.missingMarketCount > 0) {
    return "price-pending"
  }

  if (summary.needsFxCount > 0) {
    return "fx-pending"
  }

  return "ready"
}

export function getAccountSummaryValueMetrics(
  summary: Pick<AccountSummary, "cost" | "displayCurrency" | "marketValueTwd">,
  fxSnapshot: FxRateSnapshot | null
): AccountSummaryValueMetrics {
  const costTwd =
    summary.displayCurrency === "USD"
      ? convertUsdToTwd(summary.cost ?? 0, fxSnapshot)
      : summary.cost
  const marketValueTwd = summary.marketValueTwd

  if (costTwd === null || marketValueTwd === null) {
    return {
      changeAmountTwd: null,
      changeRatio: null,
      costTwd,
      marketValueTwd,
    }
  }

  const changeAmountTwd = marketValueTwd - costTwd

  return {
    changeAmountTwd,
    changeRatio: costTwd > 0 ? changeAmountTwd / costTwd : null,
    costTwd,
    marketValueTwd,
  }
}

export function buildAccountSummaries(
  holdings: ValuedHolding[],
  fxSnapshot: FxRateSnapshot | null
) {
  const grouped = new Map<string, ValuedHolding[]>()

  for (const holding of holdings) {
    const key = holding.account ?? "Unassigned account"
    const group = grouped.get(key) ?? []
    group.push(holding)
    grouped.set(key, group)
  }

  return [...grouped.entries()]
    .map<AccountSummary>(([account, accountHoldings]) => {
      const currencies = [
        ...new Set(accountHoldings.map((holding) => holding.currency)),
      ].sort()
      const singleCurrency = currencies.length === 1 ? currencies[0] : null
      const twdTotals = summarizeInTwd(accountHoldings, fxSnapshot)

      if (!singleCurrency) {
        return {
          account,
          cost: twdTotals.needsFxCount === 0 ? twdTotals.convertibleCostTwd : null,
          currencies,
          displayCurrency: "TWD",
          holdingCount: twdTotals.holdingCount,
          marketValue: null,
          marketValueTwd: hasCompleteMarketValue(twdTotals)
            ? twdTotals.convertibleMarketTwd
            : null,
          missingMarketCount: twdTotals.missingMarketCount,
          needsFxCount: twdTotals.needsFxCount,
        }
      }

      const missingMarketCount = accountHoldings.filter(
        (holding) => holding.marketValue === null
      ).length
      const nativeCost = accountHoldings.reduce(
        (sum, holding) => sum + holding.totalCostOpen,
        0
      )
      const nativeMarketValue = accountHoldings.reduce(
        (sum, holding) => sum + (holding.marketValue ?? 0),
        0
      )
      const needsFxCount = singleCurrency === "USD" && !fxSnapshot ? 1 : 0
      const canValueAccount = missingMarketCount === 0

      return {
        account,
        cost: nativeCost,
        currencies,
        displayCurrency: singleCurrency,
        holdingCount: accountHoldings.length,
        marketValue: canValueAccount ? nativeMarketValue : null,
        marketValueTwd: canValueAccount
          ? singleCurrency === "USD"
            ? convertUsdToTwd(nativeMarketValue, fxSnapshot)
            : nativeMarketValue
          : null,
        missingMarketCount,
        needsFxCount,
      }
    })
    .sort((left, right) => {
      const leftComparable = left.marketValueTwd ?? left.marketValue ?? 0
      const rightComparable = right.marketValueTwd ?? right.marketValue ?? 0

      return rightComparable - leftComparable
    })
}
