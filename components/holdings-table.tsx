"use client"

import { memo, useMemo, useState } from "react"

import { type PortfolioHoldingGroup } from "@/lib/portfolio/holdings"
import type { FxRateSnapshot, SupportedMarket } from "@/lib/portfolio/schema"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  PortfolioWeightChart,
  type PortfolioWeightChartHolding,
} from "@/components/portfolio-weight-chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
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

function getProfitAmount(holding: PortfolioHolding) {
  if (holding.marketValue === null) {
    return null
  }

  return holding.marketValue - holding.totalCostOpen
}

function getProfitRatio(holding: PortfolioHolding) {
  const profitAmount = getProfitAmount(holding)

  if (profitAmount === null || holding.totalCostOpen <= 0) {
    return null
  }

  return profitAmount / holding.totalCostOpen
}

function getProfitColor(value: number | null) {
  if (value === null) {
    return undefined
  }

  return value >= 0 ? "var(--color-chart-3)" : "var(--color-destructive)"
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

type PortfolioHolding = PortfolioHoldingGroup["holdings"][number]
type WeightChartViewMode = "all" | "account" | "market"

type WeightChartView = {
  description: string
  holdings: PortfolioWeightChartHolding[]
  selectorLabel: string | null
  selectorOptions: Array<{ label: string; value: string }>
  selectorValue: string | null
}

const TW_TICKER_PATTERN = /^\d{4,6}$/
const CJK_PATTERN = /\p{Script=Han}/u

function getHoldingLabel(holding: PortfolioHoldingGroup["holdings"][number]) {
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

function getHoldingSubtitle(
  holding: PortfolioHoldingGroup["holdings"][number]
) {
  const parts = [
    holding.account,
    holding.exchange ?? "Exchange pending",
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(" · ") : holding.market
}

function prefersDescriptiveLabel(currentLabel: string, nextLabel: string) {
  return TW_TICKER_PATTERN.test(currentLabel) && CJK_PATTERN.test(nextLabel)
}

function getChartableHoldings(holdings: PortfolioHolding[]) {
  return holdings.filter(
    (holding) =>
      (holding.currency === "TWD" || holding.currency === "USD") &&
      holding.marketValue !== null
  )
}

function buildSingleHoldingChartDatum(
  holding: PortfolioHolding,
  contextLabel: string,
  subtitle: string | null
) {
  const label = getHoldingLabel(holding)

  return {
    bucket: holding.currency as "TWD" | "USD",
    contextLabel,
    costBasis: holding.totalCostOpen,
    key: holding.key,
    label: label.primary,
    marketValue: holding.marketValue ?? 0,
    subtitle,
  } satisfies PortfolioWeightChartHolding
}

function buildMergedChartData(
  holdings: PortfolioHolding[],
  contextLabel: string,
  subtitleForAccounts: (
    accounts: string[],
    market: SupportedMarket
  ) => string | null
) {
  const merged = new Map<
    string,
    {
      accounts: Set<string>
      bucket: "TWD" | "USD"
      costBasis: number
      key: string
      label: string
      market: SupportedMarket
      marketValue: number
      secondary: string | null
    }
  >()

  for (const holding of getChartableHoldings(holdings)) {
    const label = getHoldingLabel(holding)
    const canonicalTicker = (holding.quoteTicker ?? holding.ticker)
      .trim()
      .toUpperCase()
    const mergeKey = `${holding.market}:${canonicalTicker}`
    const accountLabel = holding.account ?? "Unassigned account"
    const existing = merged.get(mergeKey)

    if (!existing) {
      merged.set(mergeKey, {
        accounts: new Set([accountLabel]),
        bucket: holding.currency as "TWD" | "USD",
        costBasis: holding.totalCostOpen,
        key: mergeKey,
        label: label.primary,
        market: holding.market,
        marketValue: holding.marketValue ?? 0,
        secondary: label.secondary,
      })
      continue
    }

    existing.accounts.add(accountLabel)
    existing.costBasis += holding.totalCostOpen
    existing.marketValue += holding.marketValue ?? 0

    if (prefersDescriptiveLabel(existing.label, label.primary)) {
      existing.label = label.primary
    }

    if (!existing.secondary && label.secondary) {
      existing.secondary = label.secondary
    }
  }

  return [...merged.values()].map((holding) => {
    const accounts = [...holding.accounts].sort()
    const subtitleParts = [
      holding.secondary,
      subtitleForAccounts(accounts, holding.market),
    ].filter(Boolean)

    return {
      bucket: holding.bucket,
      contextLabel,
      costBasis: holding.costBasis,
      key: holding.key,
      label: holding.label,
      marketValue: holding.marketValue,
      subtitle: subtitleParts.join(" · ") || null,
    } satisfies PortfolioWeightChartHolding
  })
}

function buildWeightChartView({
  holdings,
  mode,
  selectedAccount,
  selectedMarket,
}: {
  holdings: PortfolioHolding[]
  mode: WeightChartViewMode
  selectedAccount: string | null
  selectedMarket: SupportedMarket | null
}): WeightChartView {
  const accountOptions = [
    ...new Set(
      holdings.map((holding) => holding.account ?? "Unassigned account")
    ),
  ]
    .sort()
    .map((account) => ({ label: account, value: account }))
  const marketOptions = [...new Set(holdings.map((holding) => holding.market))]
    .sort((a, b) => (a === "US" ? -1 : b === "US" ? 1 : a.localeCompare(b)))
    .map((market) => ({
      label: market === "US" ? "US market" : "TW market",
      value: market,
    }))

  if (mode === "account") {
    const account = selectedAccount ?? accountOptions[0]?.value ?? null
    const scopedHoldings = account
      ? getChartableHoldings(
          holdings.filter(
            (holding) => (holding.account ?? "Unassigned account") === account
          )
        )
      : []

    return {
      description: account
        ? `Show concentration within ${account}.`
        : "Show concentration within a selected account.",
      holdings: scopedHoldings.map((holding) => {
        const label = getHoldingLabel(holding)

        return buildSingleHoldingChartDatum(
          holding,
          account ?? "Account",
          [label.secondary, holding.market].filter(Boolean).join(" · ") || null
        )
      }),
      selectorLabel: "Account",
      selectorOptions: accountOptions,
      selectorValue: account,
    }
  }

  if (mode === "market") {
    const market =
      selectedMarket ??
      (marketOptions[0]?.value as SupportedMarket | undefined) ??
      null
    const scopedHoldings = market
      ? holdings.filter((holding) => holding.market === market)
      : []

    return {
      description: market
        ? `Show ${market} holdings merged across accounts.`
        : "Show holdings merged within a selected market.",
      holdings: buildMergedChartData(
        scopedHoldings,
        market ? `${market} market` : "Market",
        (accounts) =>
          accounts.length === 1 ? accounts[0] : `${accounts.length} accounts`
      ),
      selectorLabel: "Market",
      selectorOptions: marketOptions,
      selectorValue: market,
    }
  }

  return {
    description:
      "Show all holdings across markets, merged by ticker across accounts.",
    holdings: buildMergedChartData(
      holdings,
      "All holdings",
      (accounts, market) => {
        const accountLabel =
          accounts.length === 1 ? accounts[0] : `${accounts.length} accounts`

        return `${market} · ${accountLabel}`
      }
    ),
    selectorLabel: null,
    selectorOptions: [],
    selectorValue: null,
  }
}

function getGroupSummary(
  group: PortfolioHoldingGroup,
  fxSnapshot: FxRateSnapshot | null
) {
  const holdingLabel = `${group.holdings.length} ${group.holdings.length === 1 ? "holding" : "holdings"}`
  const currencyLabel =
    group.currencies.length === 1
      ? group.currencies[0]
      : `${group.currencies.length} currencies`

  if (group.currencies.length !== 1) {
    return `${holdingLabel} • ${currencyLabel}.`
  }

  if (group.totalMarketValue === null) {
    if (group.missingPriceCount > 0) {
      return `${holdingLabel} • ${currencyLabel} • waiting on ${group.missingPriceCount} previous close ${group.missingPriceCount === 1 ? "price" : "prices"}.`
    }

    return `${holdingLabel} • ${currencyLabel} • market value unavailable.`
  }

  if (group.currencies[0] === "USD" && fxSnapshot) {
    const convertedValue = group.totalMarketValue * fxSnapshot.rate

    return `${holdingLabel} • total value ${formatMoney(group.totalMarketValue, group.currencies[0])} (${formatMoney(convertedValue, "TWD")}).`
  }

  return `${holdingLabel} • total value ${formatMoney(group.totalMarketValue, group.currencies[0])}.`
}

function getGroupAccentCurrency(group: PortfolioHoldingGroup) {
  return group.currencies.length === 1 ? group.currencies[0] : null
}

function getBucketDotColor(currency: string | null) {
  switch (currency) {
    case "TWD":
      return "var(--color-chart-1)"
    case "USD":
      return "var(--color-chart-2)"
    default:
      return "var(--color-muted-foreground)"
  }
}

function getBucketSurfaceClasses(currency: string | null) {
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
  const profitAmount = getProfitAmount(holding)
  const profitRatio = getProfitRatio(holding)

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
            {holding.market} · {getHoldingSubtitle(holding)}
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
          <dt className="text-xs text-muted-foreground">Unrealized P/L</dt>
          <dd
            className="tabular-nums"
            style={{ color: getProfitColor(profitAmount) }}
          >
            {formatMoney(profitAmount, holding.currency)}
          </dd>
          <p
            className="text-xs"
            style={{ color: getProfitColor(profitAmount) }}
          >
            {formatPercent(profitRatio)}
          </p>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Cost basis</dt>
          <dd className="tabular-nums">
            {formatMoney(holding.totalCostOpen, holding.currency)}
          </dd>
        </div>
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
          <dt className="text-xs text-muted-foreground">Account</dt>
          <dd className="truncate">{holding.account ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Currency</dt>
          <dd className="tabular-nums">{holding.currency}</dd>
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
  holdings,
  issues,
  requestError,
}: {
  fxIssue: string | null
  fxSnapshot: FxRateSnapshot | null
  fxStatus: QuoteLoadStatus
  groups: PortfolioHoldingGroup[]
  holdings: PortfolioHolding[]
  issues: string[]
  requestError: string | null
}) {
  const [weightChartMode, setWeightChartMode] =
    useState<WeightChartViewMode>("all")
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<SupportedMarket | null>(
    null
  )
  const holdingCount = groups.reduce(
    (sum, group) => sum + group.holdings.length,
    0
  )
  const chartView = useMemo(
    () =>
      buildWeightChartView({
        holdings,
        mode: weightChartMode,
        selectedAccount,
        selectedMarket,
      }),
    [holdings, selectedAccount, selectedMarket, weightChartMode]
  )
  return (
    <section className="surface-analysis overflow-hidden rounded-xl border border-border/70 bg-background/80">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-secondary/10">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-[0.16em] text-secondary-foreground uppercase">
              Analyze
            </p>
            <h2 className="text-lg font-medium tracking-tight">
              Portfolio analysis
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <p className="text-sm font-medium text-foreground">
              {holdingCount} {holdingCount === 1 ? "holding" : "holdings"}
            </p>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
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

            {holdings.length > 0 ? (
              <section className="rounded-lg border border-primary/20 bg-accent/30 px-4 py-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-start">
                  <div className="flex flex-col gap-2 md:items-start">
                    <ToggleGroup
                      onValueChange={(value) => {
                        if (value) {
                          setWeightChartMode(value as WeightChartViewMode)
                        }
                      }}
                      size="sm"
                      type="single"
                      value={weightChartMode}
                      variant="outline"
                    >
                      <ToggleGroupItem value="all">All</ToggleGroupItem>
                      <ToggleGroupItem value="account">
                        Accounts
                      </ToggleGroupItem>
                      <ToggleGroupItem value="market">Markets</ToggleGroupItem>
                    </ToggleGroup>

                    {chartView.selectorOptions.length > 0 ? (
                      <ToggleGroup
                        onValueChange={(value) => {
                          if (!value) {
                            return
                          }

                          if (weightChartMode === "account") {
                            setSelectedAccount(value)
                            return
                          }

                          setSelectedMarket(value as SupportedMarket)
                        }}
                        size="sm"
                        type="single"
                        value={chartView.selectorValue ?? undefined}
                        variant="outline"
                      >
                        {chartView.selectorOptions.map((option) => (
                          <ToggleGroupItem
                            key={option.value}
                            value={option.value}
                          >
                            {option.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4">
                  <PortfolioWeightChart
                    description={chartView.description}
                    fxIssue={fxIssue}
                    fxSnapshot={fxSnapshot}
                    fxStatus={fxStatus}
                    holdings={chartView.holdings}
                  />
                </div>
              </section>
            ) : null}

            {groups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-secondary/35 bg-background/70 px-4 py-10 text-center text-sm text-muted-foreground">
                Open positions appear here after your trades net into holdings.
              </div>
            ) : null}

            {groups.map((group) => (
              <section className="space-y-3" key={group.label}>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor: getBucketDotColor(
                          getGroupAccentCurrency(group)
                        ),
                      }}
                    />
                    <h3 className="text-base font-medium">{group.label}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {getGroupSummary(group, fxSnapshot)}
                  </p>
                </div>

                <div
                  className={`overflow-hidden rounded-lg border ${getBucketSurfaceClasses(getGroupAccentCurrency(group)).surface}`}
                >
                  <div className="space-y-3 p-3 md:hidden">
                    {group.holdings.map((holding) => (
                      <HoldingSummaryCard key={holding.key} holding={holding} />
                    ))}
                  </div>

                  <div className="hidden md:block">
                    <Table className="min-w-[1360px] table-fixed">
                      <TableHeader
                        className={
                          getBucketSurfaceClasses(getGroupAccentCurrency(group))
                            .header
                        }
                      >
                        <TableRow>
                          <TableHead className="sticky left-0 z-30 min-w-[180px] border-r border-border/60 bg-background/95 shadow-[8px_0_18px_-14px_rgba(0,0,0,0.35)] backdrop-blur supports-[backdrop-filter]:bg-background/90">
                            Ticker
                          </TableHead>
                          <TableHead className="w-[132px] text-right">
                            P/L
                          </TableHead>
                          <TableHead className="w-[92px] text-right">
                            P/L %
                          </TableHead>
                          <TableHead className="w-[92px] text-right">
                            Weight
                          </TableHead>
                          <TableHead className="w-[132px] text-right">
                            Value
                          </TableHead>
                          <TableHead className="text-right">
                            Cost basis
                          </TableHead>
                          <TableHead className="w-[112px] text-right">
                            Open qty
                          </TableHead>
                          <TableHead className="w-[132px] text-right">
                            Avg cost
                          </TableHead>
                          <TableHead className="text-right">
                            Prev close
                          </TableHead>
                          <TableHead className="min-w-[160px]">
                            Account
                          </TableHead>
                          <TableHead className="w-[110px]">Market</TableHead>
                          <TableHead className="w-[92px] text-right">
                            Currency
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.holdings.map((holding) => {
                          const label = getHoldingLabel(holding)
                          const profitAmount = getProfitAmount(holding)
                          const profitRatio = getProfitRatio(holding)

                          return (
                            <TableRow key={holding.key}>
                              <TableCell className="sticky left-0 z-20 border-r border-border/50 bg-background/95 shadow-[8px_0_18px_-14px_rgba(0,0,0,0.28)] backdrop-blur supports-[backdrop-filter]:bg-background/90">
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
                              <TableCell
                                className="text-right tabular-nums"
                                style={{ color: getProfitColor(profitAmount) }}
                              >
                                {formatMoney(profitAmount, holding.currency)}
                              </TableCell>
                              <TableCell
                                className="text-right tabular-nums"
                                style={{ color: getProfitColor(profitAmount) }}
                              >
                                {formatPercent(profitRatio)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatPercent(holding.weight)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(
                                  holding.marketValue,
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
                                {formatQuantity(holding.quantityOpen)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatMoney(
                                  holding.averageCost,
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
                              <TableCell>
                                <span className="text-sm text-foreground">
                                  {holding.account ?? "-"}
                                </span>
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
                              <TableCell className="text-right font-medium tabular-nums">
                                {holding.currency}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell className="font-medium">Total</TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            style={{
                              color:
                                group.currencies.length === 1 &&
                                group.totalMarketValue !== null &&
                                group.totalCostOpen !== null
                                  ? getProfitColor(
                                      group.totalMarketValue -
                                        group.totalCostOpen
                                    )
                                  : undefined,
                            }}
                          >
                            {group.currencies.length === 1 &&
                            group.totalMarketValue !== null &&
                            group.totalCostOpen !== null
                              ? formatMoney(
                                  group.totalMarketValue - group.totalCostOpen,
                                  group.currencies[0]
                                )
                              : "-"}
                          </TableCell>
                          <TableCell
                            className="text-right tabular-nums"
                            style={{
                              color:
                                group.currencies.length === 1 &&
                                group.totalMarketValue !== null &&
                                group.totalCostOpen !== null
                                  ? getProfitColor(
                                      group.totalMarketValue -
                                        group.totalCostOpen
                                    )
                                  : undefined,
                            }}
                          >
                            {group.currencies.length === 1 &&
                            group.totalMarketValue !== null &&
                            group.totalCostOpen !== null &&
                            group.totalCostOpen > 0
                              ? formatPercent(
                                  (group.totalMarketValue -
                                    group.totalCostOpen) /
                                    group.totalCostOpen
                                )
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {group.totalMarketValue === null ? "-" : "100.00%"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(
                              group.totalMarketValue,
                              group.currencies[0] ?? "USD"
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {group.currencies.length === 1
                              ? formatMoney(
                                  group.totalCostOpen,
                                  group.currencies[0]
                                )
                              : "-"}
                          </TableCell>
                          <TableCell colSpan={6} />
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </details>
    </section>
  )
})

HoldingsTable.displayName = "HoldingsTable"
