import { memo } from "react"

import { Badge } from "@/components/ui/badge"
import type { ValuedHolding } from "@/lib/portfolio/holdings"
import {
  buildAccountSummaries,
  getAccountSummaryStatus,
  getAccountSummaryValueMetrics,
  getTotalSummaryStatus,
  getTotalSummaryValues,
} from "@/lib/portfolio/summary-cards"
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

  const { totalCostTwd, totalMarketValueTwd, totals } = getTotalSummaryValues(
    holdings,
    fxSnapshot
  )
  const totalStatus = getTotalSummaryStatus(holdings, fxSnapshot)
  const totalChange = getChangeMetrics({
    cost: totalCostTwd,
    marketValue: totalMarketValueTwd,
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
            {getCoverageBadge(totals)}
          </Badge>
        </div>
        <p className="text-4xl font-semibold tracking-tight text-foreground">
          {formatMoney(totalMarketValueTwd, "TWD", { integers: true })}
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
          {totalStatus === "ready" && fxSnapshot
            ? `USD/TWD ${fxSnapshot.rate.toFixed(2)}`
            : totalStatus === "fx-pending"
              ? "FX rate pending"
              : totalStatus === "price-pending"
                ? "Market price pending"
                : "TWD holdings"}
        </p>
      </div>

      {/* Account cards row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {accountSummaries.map((summary) => {
          const accountStatus = getAccountSummaryStatus(summary)
          const valueMetrics = getAccountSummaryValueMetrics(
            summary,
            fxSnapshot
          )

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
                {formatMoney(valueMetrics.marketValueTwd, "TWD", {
                  integers: true,
                })}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className="text-sm font-medium"
                  style={{
                    color: getProfitColor(valueMetrics.changeAmountTwd),
                  }}
                >
                  {formatMoney(valueMetrics.changeAmountTwd, "TWD", {
                    integers: true,
                  })}
                </span>
                <ChangeRatioBadge value={valueMetrics.changeRatio} />
              </div>
              <p className="text-xs text-muted-foreground">
                {accountStatus === "price-pending"
                  ? "Market price pending"
                  : accountStatus === "fx-pending"
                    ? summary.displayCurrency === "USD" &&
                      summary.marketValue !== null
                      ? `${formatMoney(summary.marketValue, "USD")} · FX rate pending`
                      : "FX rate pending"
                    : summary.displayCurrency === "USD" &&
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
