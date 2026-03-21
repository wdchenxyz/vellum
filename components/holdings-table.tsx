import { memo } from "react"

import {
  type PortfolioCurrencyGroup,
  type PortfolioSummary,
} from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  PortfolioWeightChart,
  type PortfolioWeightChartHolding,
} from "@/components/portfolio-weight-chart"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ChevronDown, CircleAlert } from "lucide-react"

export type QuoteLoadStatus = "idle" | "loading" | "ready" | "error"

const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

const percentageFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  style: "percent",
})

const currencyFormatters = new Map<string, Intl.NumberFormat>()

function formatQuantity(value: number) {
  return quantityFormatter.format(value)
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "-"
  }

  return percentageFormatter.format(value)
}

function formatMoney(value: number | null, currency: string) {
  if (value === null) {
    return "-"
  }

  let formatter = currencyFormatters.get(currency)

  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      currency,
      maximumFractionDigits: 2,
      style: "currency",
    })
    currencyFormatters.set(currency, formatter)
  }

  return formatter.format(value)
}

type PortfolioHolding = PortfolioCurrencyGroup["holdings"][number]

function getHoldingLabel(holding: PortfolioCurrencyGroup["holdings"][number]) {
  if (
    holding.market === "TW" &&
    holding.quoteTicker &&
    holding.quoteTicker !== holding.ticker
  ) {
    return {
      primary: holding.ticker,
      secondary: holding.quoteTicker,
    }
  }

  return {
    primary: holding.ticker,
    secondary: null,
  }
}

function getCombinedWeightChartData(groups: PortfolioCurrencyGroup[]) {
  return groups.flatMap((group) =>
    group.holdings
      .filter(
        (holding) =>
          (group.currency === "TWD" || group.currency === "USD") &&
          holding.marketValue !== null
      )
      .map((holding) => {
        const label = getHoldingLabel(holding)

        return {
          bucket: group.currency as "TWD" | "USD",
          costBasis: holding.totalCostOpen,
          key: holding.key,
          label: label.primary,
          marketValue: holding.marketValue ?? 0,
          subtitle: label.secondary,
        } satisfies PortfolioWeightChartHolding
      })
  )
}

function formatSummary(summary: PortfolioSummary) {
  return summary.totalMarketValue === null
    ? `${summary.currency} pending`
    : `${summary.currency} ${formatMoney(summary.totalMarketValue, summary.currency)}`
}

function getPortfolioStatusCopy({
  holdingCount,
  status,
}: {
  holdingCount: number
  status: QuoteLoadStatus
}) {
  if (holdingCount === 0) {
    return "Open holdings appear after imported buys and sells net out."
  }

  switch (status) {
    case "loading":
      return "Loading previous closes for the current holdings."
    case "error":
      return "Previous-close data is partially unavailable."
    case "ready":
      return "Previous-close data is ready for the current holdings."
    default:
      return "Open when you want a valuation view."
  }
}

function getGroupSummary(group: PortfolioCurrencyGroup) {
  const holdingLabel = `${group.holdings.length} ${group.holdings.length === 1 ? "holding" : "holdings"}`

  if (group.totalMarketValue === null) {
    if (group.missingPriceCount > 0) {
      return `${holdingLabel} • waiting on ${group.missingPriceCount} previous close ${group.missingPriceCount === 1 ? "price" : "prices"}.`
    }

    return `${holdingLabel} • market value unavailable.`
  }

  return `${holdingLabel} • total value ${formatMoney(group.totalMarketValue, group.currency)}.`
}

function getBucketDotColor(currency: string) {
  switch (currency) {
    case "TWD":
      return "var(--color-chart-1)"
    case "USD":
      return "var(--color-chart-2)"
    default:
      return "var(--color-muted-foreground)"
  }
}

function getBucketSurfaceClasses(currency: string) {
  switch (currency) {
    case "TWD":
      return {
        surface: "border-primary/20 bg-primary/5",
        header: "bg-primary/10",
      }
    case "USD":
      return {
        surface: "border-secondary/35 bg-secondary/15",
        header: "bg-secondary/30",
      }
    default:
      return {
        surface: "border-border/70 bg-background/95",
        header: "bg-muted/60",
      }
  }
}

function HoldingSummaryCard({ holding }: { holding: PortfolioHolding }) {
  const label = getHoldingLabel(holding)

  return (
    <article className="rounded-lg border border-border/70 bg-background/80 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground">{label.primary}</p>
          {label.secondary ? (
            <p className="truncate text-xs text-muted-foreground">
              {label.secondary}
            </p>
          ) : null}
          <p className="truncate text-xs text-muted-foreground">
            {holding.market} · {holding.exchange ?? "Exchange pending"}
          </p>
        </div>

        <div className="text-right">
          <p className="font-medium tabular-nums">
            {formatMoney(holding.marketValue, holding.currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPercent(holding.weight)} weight
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Open qty</dt>
          <dd className="tabular-nums">
            {formatQuantity(holding.quantityOpen)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Avg cost</dt>
          <dd className="tabular-nums">
            {formatMoney(holding.averageCost, holding.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Cost basis</dt>
          <dd className="tabular-nums">
            {formatMoney(holding.totalCostOpen, holding.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Prev close</dt>
          <dd className="tabular-nums">
            {formatMoney(holding.previousClose, holding.currency)}
          </dd>
          <p className="text-xs text-muted-foreground">
            {holding.previousCloseDate ?? holding.quoteError ?? "-"}
          </p>
        </div>
      </dl>
    </article>
  )
}

export const HoldingsTable = memo(function HoldingsTable({
  fxIssue,
  fxSnapshot,
  fxStatus,
  groups,
  summaries,
  status,
  issues,
  requestError,
}: {
  fxIssue: string | null
  fxSnapshot: FxRateSnapshot | null
  fxStatus: QuoteLoadStatus
  groups: PortfolioCurrencyGroup[]
  summaries: PortfolioSummary[]
  status: QuoteLoadStatus
  issues: string[]
  requestError: string | null
}) {
  const holdingCount = groups.reduce(
    (sum, group) => sum + group.holdings.length,
    0
  )
  const combinedWeightChartData = getCombinedWeightChartData(groups)
  const summariesLabel = summaries.map(formatSummary).join(" • ")

  return (
    <section className="surface-analysis overflow-hidden rounded-xl border border-secondary/30 bg-background/80">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-4 px-4 py-4 transition-colors hover:bg-secondary/10">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-[0.16em] text-secondary-foreground uppercase">
              Analyze
            </p>
            <h2 className="text-lg font-medium tracking-tight">
              Portfolio analysis
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {getPortfolioStatusCopy({ holdingCount, status })}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">
                {holdingCount} {holdingCount === 1 ? "holding" : "holdings"}
              </p>
              <p className="max-w-72 text-xs text-muted-foreground">
                {summariesLabel || "No open holdings yet."}
              </p>
            </div>
            <ChevronDown className="mt-0.5 size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </div>
        </summary>

        <div className="border-t border-border/70 px-4 py-4">
          <div className="flex flex-col gap-6">
            {requestError ? (
              <Alert
                className="border-destructive/30 bg-destructive/5"
                variant="destructive"
              >
                <CircleAlert className="size-4" />
                <AlertTitle>Price lookup failed</AlertTitle>
                <AlertDescription>{requestError}</AlertDescription>
              </Alert>
            ) : null}

            {issues.length > 0 ? (
              <Alert
                className="border-destructive/30 bg-destructive/5"
                variant="destructive"
              >
                <CircleAlert className="size-4" />
                <AlertTitle>Some transactions are excluded</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-1">
                    {issues.map((issue) => (
                      <p key={issue}>{issue}</p>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            {combinedWeightChartData.length > 0 ? (
              <details className="group rounded-lg border border-primary/20 bg-accent/30 px-4 py-3">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Weight chart</h3>
                    <p className="text-sm text-muted-foreground">
                      Optional cross-bucket view for priced holdings.
                    </p>
                  </div>
                  <ChevronDown className="mt-0.5 size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>

                <div className="mt-4">
                  <PortfolioWeightChart
                    fxIssue={fxIssue}
                    fxSnapshot={fxSnapshot}
                    fxStatus={fxStatus}
                    holdings={combinedWeightChartData}
                  />
                </div>
              </details>
            ) : null}

            {groups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-secondary/35 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
                Open positions appear here after your trades net into holdings.
              </div>
            ) : null}

            {groups.map((group) => (
              <section className="space-y-3" key={group.currency}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor: getBucketDotColor(group.currency),
                      }}
                    />
                    <h3 className="text-base font-medium">
                      {group.currency} bucket
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {getGroupSummary(group)}
                  </p>
                </div>

                <div
                  className={`overflow-hidden rounded-lg border ${getBucketSurfaceClasses(group.currency).surface}`}
                >
                  <div className="space-y-3 p-3 md:hidden">
                    {group.holdings.map((holding) => (
                      <HoldingSummaryCard key={holding.key} holding={holding} />
                    ))}
                  </div>

                  <div className="hidden md:block">
                    <Table className="min-w-[860px]">
                      <TableHeader
                        className={
                          getBucketSurfaceClasses(group.currency).header
                        }
                      >
                        <TableRow>
                          <TableHead>Ticker</TableHead>
                          <TableHead>Market</TableHead>
                          <TableHead className="text-right">Open qty</TableHead>
                          <TableHead className="text-right">Avg cost</TableHead>
                          <TableHead className="text-right">
                            Cost basis
                          </TableHead>
                          <TableHead className="text-right">
                            Prev close
                          </TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead className="text-right">Weight</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.holdings.map((holding) => {
                          const label = getHoldingLabel(holding)

                          return (
                            <TableRow key={holding.key}>
                              <TableCell>
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="font-medium">
                                    {label.primary}
                                  </span>
                                  {label.secondary ? (
                                    <span className="truncate text-xs text-muted-foreground">
                                      {label.secondary}
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <span className="font-medium">
                                    {holding.market}
                                  </span>
                                  <span className="truncate text-xs text-muted-foreground">
                                    {holding.exchange ?? "Exchange pending"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatQuantity(holding.quantityOpen)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(
                                  holding.averageCost,
                                  holding.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(
                                  holding.totalCostOpen,
                                  holding.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                <div className="flex flex-col items-end gap-0.5">
                                  <span>
                                    {formatMoney(
                                      holding.previousClose,
                                      holding.currency
                                    )}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {holding.previousCloseDate ??
                                      holding.quoteError ??
                                      "-"}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(
                                  holding.marketValue,
                                  holding.currency
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatPercent(holding.weight)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell className="font-medium" colSpan={4}>
                            Total
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(group.totalCostOpen, group.currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            -
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(
                              group.totalMarketValue,
                              group.currency
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {group.totalMarketValue === null ? "-" : "100.00%"}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </div>

                {group.totalMarketValue === null ? (
                  <p className="text-xs text-muted-foreground">
                    Weights use priced holdings only while quotes are pending.
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </details>
    </section>
  )
})

HoldingsTable.displayName = "HoldingsTable"
