import { memo } from "react"

import { Badge } from "@/components/ui/badge"
import type { ValuedHolding } from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"
import { TrendingDown, TrendingUp } from "lucide-react"

const currencyFormatters = new Map<string, Intl.NumberFormat>()
const percentageFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  style: "percent",
})

function formatMoney(
  value: number | null,
  currency: string,
  { integers = false }: { integers?: boolean } = {}
) {
  if (value === null) {
    return "-"
  }

  const fractionDigits = integers ? 0 : 2
  const key = `${currency}:${fractionDigits}`
  let formatter = currencyFormatters.get(key)

  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      currency,
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
      style: "currency",
    })
    currencyFormatters.set(key, formatter)
  }

  return formatter.format(value)
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-"
  }

  return percentageFormatter.format(value)
}

function getProfitColor(value: number | null) {
  if (value === null) {
    return "var(--color-muted-foreground)"
  }

  return value >= 0 ? "var(--color-chart-3)" : "var(--color-destructive)"
}

function convertUsdToTwd(value: number, fxSnapshot: FxRateSnapshot | null) {
  if (!fxSnapshot) {
    return null
  }

  return value * fxSnapshot.rate
}

type SummaryTotals = {
  convertibleCostTwd: number
  convertibleMarketTwd: number
  holdingCount: number
  missingMarketCount: number
  needsFxCount: number
}

function summarizeInTwd(
  holdings: ValuedHolding[],
  fxSnapshot: FxRateSnapshot | null
): SummaryTotals {
  return holdings.reduce<SummaryTotals>(
    (summary, holding) => {
      summary.holdingCount += 1

      const costTwd =
        holding.currency === "TWD"
          ? holding.totalCostOpen
          : convertUsdToTwd(holding.totalCostOpen, fxSnapshot)

      if (costTwd !== null) {
        summary.convertibleCostTwd += costTwd
      } else if (holding.currency === "USD") {
        summary.needsFxCount += 1
      }

      if (holding.marketValue === null) {
        summary.missingMarketCount += 1
        return summary
      }

      const marketTwd =
        holding.currency === "TWD"
          ? holding.marketValue
          : convertUsdToTwd(holding.marketValue, fxSnapshot)

      if (marketTwd !== null) {
        summary.convertibleMarketTwd += marketTwd
      } else if (holding.currency === "USD") {
        summary.needsFxCount += 1
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

type AccountSummary = {
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

function buildAccountSummaries(
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
          cost: null,
          currencies,
          displayCurrency: "TWD",
          holdingCount: twdTotals.holdingCount,
          marketValue: null,
          marketValueTwd: twdTotals.convertibleMarketTwd,
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

      return {
        account,
        cost: nativeCost,
        currencies,
        displayCurrency: singleCurrency,
        holdingCount: accountHoldings.length,
        marketValue: nativeMarketValue,
        marketValueTwd:
          singleCurrency === "USD"
            ? convertUsdToTwd(nativeMarketValue, fxSnapshot)
            : nativeMarketValue,
        missingMarketCount,
        needsFxCount: singleCurrency === "USD" && !fxSnapshot ? 1 : 0,
      }
    })
    .sort((left, right) => {
      const leftComparable = left.marketValueTwd ?? left.marketValue ?? 0
      const rightComparable = right.marketValueTwd ?? right.marketValue ?? 0

      return rightComparable - leftComparable
    })
}

function getChangeMetrics({
  cost,
  marketValue,
}: {
  cost: number | null
  marketValue: number | null
}) {
  if (cost === null || marketValue === null) {
    return { amount: null, ratio: null }
  }

  const amount = marketValue - cost

  return {
    amount,
    ratio: cost > 0 ? amount / cost : null,
  }
}

function ChangeRatioBadge({ value }: { value: number | null }) {
  if (value === null) {
    return null
  }

  const isPositive = value >= 0
  const Icon = isPositive ? TrendingUp : TrendingDown

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{
        borderColor: isPositive
          ? "color-mix(in oklch, var(--color-chart-3) 30%, transparent)"
          : "color-mix(in oklch, var(--color-destructive) 30%, transparent)",
        color: isPositive ? "var(--color-chart-3)" : "var(--color-destructive)",
      }}
    >
      <Icon className="size-3.5" />
      {isPositive ? "+" : ""}
      {formatPercent(value)}
    </span>
  )
}

function getCoverageBadge({
  holdingCount,
  missingMarketCount,
  needsFxCount,
}: {
  holdingCount: number
  missingMarketCount: number
  needsFxCount: number
}) {
  if (holdingCount === 0) {
    return "No holdings"
  }

  if (missingMarketCount > 0 || needsFxCount > 0) {
    return `${holdingCount} · pending`
  }

  return `${holdingCount} live`
}

export const PortfolioSummaryCards = memo(function PortfolioSummaryCards({
  fxSnapshot,
  holdings,
}: {
  fxSnapshot: FxRateSnapshot | null
  holdings: ValuedHolding[]
}) {
  if (holdings.length === 0) {
    return null
  }

  const totalTwd = summarizeInTwd(holdings, fxSnapshot)
  const totalNeedsFx =
    holdings.some((holding) => holding.currency === "USD") && !fxSnapshot
  const totalChange = getChangeMetrics({
    cost: totalNeedsFx ? null : totalTwd.convertibleCostTwd,
    marketValue: totalNeedsFx ? null : totalTwd.convertibleMarketTwd,
  })
  const accountSummaries = buildAccountSummaries(holdings, fxSnapshot)

  return (
    <section className="space-y-3">
      {/* Total asset — full width */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-primary/20 bg-primary/[0.03] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Total asset</p>
          <Badge
            className="h-auto rounded-full px-2 py-0.5 text-[11px]"
            variant="outline"
          >
            {getCoverageBadge(totalTwd)}
          </Badge>
        </div>
        <p className="text-4xl font-semibold tracking-tight text-foreground">
          {formatMoney(
            totalNeedsFx ? null : totalTwd.convertibleMarketTwd,
            "TWD",
            { integers: true }
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="text-sm font-medium"
            style={{ color: getProfitColor(totalChange.amount) }}
          >
            {formatMoney(totalChange.amount, "TWD", { integers: true })}
          </span>
          <ChangeRatioBadge value={totalChange.ratio} />
        </div>
        <p className="text-xs text-muted-foreground">
          {fxSnapshot
            ? `USD/TWD ${fxSnapshot.rate.toFixed(2)}`
            : "FX rate pending"}
        </p>
      </div>

      {/* Account cards row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {accountSummaries.map((summary) => {
          const twdValue = summary.marketValueTwd
          const twdCost =
            summary.displayCurrency === "USD"
              ? convertUsdToTwd(summary.cost ?? 0, fxSnapshot)
              : summary.cost
          const twdChange = getChangeMetrics({
            cost: twdCost,
            marketValue: twdValue,
          })

          return (
            <div
              className="flex flex-col justify-between gap-4 rounded-xl border border-border/70 bg-background/90 px-5 py-4"
              key={summary.account}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-foreground">
                  {summary.account}
                </p>
                <Badge
                  className="h-auto shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                  variant="outline"
                >
                  {getCoverageBadge(summary)}
                </Badge>
              </div>
              <p className="text-3xl font-semibold tracking-tight text-foreground">
                {formatMoney(twdValue, "TWD", { integers: true })}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className="text-sm font-medium"
                  style={{ color: getProfitColor(twdChange.amount) }}
                >
                  {formatMoney(twdChange.amount, "TWD", { integers: true })}
                </span>
                <ChangeRatioBadge value={twdChange.ratio} />
              </div>
              <p className="text-xs text-muted-foreground">
                {summary.displayCurrency === "USD" &&
                summary.marketValue !== null
                  ? `${formatMoney(summary.marketValue, "USD")} · ${summary.currencies[0]}`
                  : `${summary.currencies.join(" / ")} holdings`}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
})
