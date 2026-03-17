import {
  type PortfolioCurrencyGroup,
  type PortfolioSummary,
} from "@/lib/portfolio/holdings"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  PortfolioWeightChart,
  type PortfolioWeightChartHolding,
} from "@/components/portfolio-weight-chart"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CircleAlert, LoaderCircle } from "lucide-react"

export type QuoteLoadStatus = "idle" | "loading" | "ready" | "error"

const quantityFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
})

const percentageFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  style: "percent",
})

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

  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value)
}

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

function getQuoteStatusLabel(status: QuoteLoadStatus) {
  switch (status) {
    case "loading":
      return "Loading previous closes"
    case "error":
      return "Quote request failed"
    case "ready":
      return "Previous close ready"
    default:
      return "Waiting for holdings"
  }
}

function SummaryBadges({ summaries }: { summaries: PortfolioSummary[] }) {
  if (summaries.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {summaries.map((summary) => (
        <Badge key={summary.currency} variant="secondary">
          {summary.currency}{" "}
          {summary.totalMarketValue === null
            ? "pending"
            : formatMoney(summary.totalMarketValue, summary.currency)}
        </Badge>
      ))}
    </div>
  )
}

export function HoldingsTable({
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

  return (
    <Card className="border-border/70 bg-card/85 shadow-sm backdrop-blur-sm">
      <CardHeader>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <CardTitle>Open holdings</CardTitle>
            <CardDescription>
              Average-cost positions derived from appended BUY and SELL rows.
              Use the combined chart to compare selected buckets together, while
              the table keeps each bucket weight breakdown.
            </CardDescription>
          </div>
          <CardAction>
            <div className="flex flex-wrap justify-end gap-2">
              <Badge variant="secondary">
                {holdingCount} {holdingCount === 1 ? "holding" : "holdings"}
              </Badge>
              <Badge variant={status === "error" ? "destructive" : "outline"}>
                {status === "loading" ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : null}
                {getQuoteStatusLabel(status)}
              </Badge>
            </div>
          </CardAction>
        </div>
        <SummaryBadges summaries={summaries} />
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {requestError ? (
          <Alert variant="destructive">
            <CircleAlert className="size-4" />
            <AlertTitle>Price lookup failed</AlertTitle>
            <AlertDescription>{requestError}</AlertDescription>
          </Alert>
        ) : null}

        {issues.length > 0 ? (
          <Alert variant="destructive">
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

        <PortfolioWeightChart
          fxIssue={fxIssue}
          fxSnapshot={fxSnapshot}
          fxStatus={fxStatus}
          holdings={combinedWeightChartData}
        />

        {groups.length === 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Market</TableHead>
                <TableHead className="text-right">Open Qty</TableHead>
                <TableHead className="text-right">Avg Cost</TableHead>
                <TableHead className="text-right">Cost Basis</TableHead>
                <TableHead className="text-right">Prev Close</TableHead>
                <TableHead className="text-right">Market Value</TableHead>
                <TableHead className="text-right">Bucket Weight</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell
                  className="py-12 text-center text-muted-foreground"
                  colSpan={8}
                >
                  Open positions will appear here after your uploaded trades are
                  netted into holdings.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ) : null}

        {groups.map((group) => (
          <div className="flex flex-col gap-3" key={group.currency}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-medium">
                  {group.currency} bucket
                </h3>
                <p className="text-sm text-muted-foreground">
                  {group.totalMarketValue === null
                    ? group.missingPriceCount > 0
                      ? `Waiting on ${group.missingPriceCount} previous close ${group.missingPriceCount === 1 ? "price" : "prices"}.`
                      : "Market value is not available yet."
                    : `Total market value ${formatMoney(group.totalMarketValue, group.currency)}.`}
                </p>
              </div>
              {group.missingPriceCount > 0 ? (
                <Badge variant="outline">
                  {group.missingPriceCount} pending{" "}
                  {group.missingPriceCount === 1 ? "quote" : "quotes"}
                </Badge>
              ) : null}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Market</TableHead>
                  <TableHead className="text-right">Open Qty</TableHead>
                  <TableHead className="text-right">Avg Cost</TableHead>
                  <TableHead className="text-right">Cost Basis</TableHead>
                  <TableHead className="text-right">Prev Close</TableHead>
                  <TableHead className="text-right">Market Value</TableHead>
                  <TableHead className="text-right">Bucket Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.holdings.map((holding) => {
                  const label = getHoldingLabel(holding)

                  return (
                    <TableRow key={holding.key}>
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium">{label.primary}</span>
                          {label.secondary ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {label.secondary}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <Badge variant="outline" className="w-fit">
                            {holding.market}
                          </Badge>
                          <span className="truncate text-xs text-muted-foreground">
                            {holding.exchange ?? "Exchange pending"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQuantity(holding.quantityOpen)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(holding.averageCost, holding.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(holding.totalCostOpen, holding.currency)}
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
                        {formatMoney(holding.marketValue, holding.currency)}
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
                  <TableCell className="text-right tabular-nums">-</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(group.totalMarketValue, group.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group.totalMarketValue === null ? "-" : "100.00%"}
                  </TableCell>
                </TableRow>
              </TableFooter>
              <TableCaption>
                {group.totalMarketValue === null
                  ? "Weights are recalculated from priced holdings only while quotes are pending in this bucket."
                  : "Weights are calculated within this currency bucket."}
              </TableCaption>
            </Table>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
