"use client"

import { memo, useMemo, useState } from "react"

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { FxRateSnapshot } from "@/lib/portfolio/schema"
import {
  buildPortfolioWeightChartSummary,
  type PortfolioWeightBucket,
} from "@/lib/portfolio/weight-chart"
import { CircleAlert } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"

export type PortfolioWeightChartHolding = {
  bucket: PortfolioWeightBucket
  costBasis: number
  key: string
  label: string
  marketValue: number
  subtitle: string | null
}

type QuoteLikeStatus = "idle" | "loading" | "ready" | "error"

type PortfolioWeightChartDatum = PortfolioWeightChartHolding & {
  convertedMarketValue: number | null
  costWeight: number
  displayWeight: number
  isActive: boolean
  isUnderwater: boolean
  profitWeight: number
  unrealizedAmount: number | null
}

const chartConfig = {
  TWD: {
    label: "TWD bucket",
    color: "var(--chart-1)",
  },
  USD: {
    label: "USD bucket",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

const percentageFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  style: "percent",
})

const currencyFormatters = new Map<string, Intl.NumberFormat>()

function formatMoney(value: number, currency: string) {
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

function formatPercent(value: number) {
  return percentageFormatter.format(value)
}

function BucketLegend({ bucket }: { bucket: PortfolioWeightBucket }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground/80">
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: chartConfig[bucket].color }}
      />
      {bucket}
    </span>
  )
}

function isConvertedAcrossFx({
  baseCurrency,
  bucket,
}: {
  baseCurrency: PortfolioWeightBucket
  bucket: PortfolioWeightBucket
}) {
  return baseCurrency !== bucket
}

function getBucketSegmentStyle({
  bucket,
  isActive,
  isUnderwater,
  segment,
}: {
  bucket: PortfolioWeightBucket
  isActive: boolean
  isUnderwater: boolean
  segment: "cost" | "profit"
}) {
  const fillOpacity =
    segment === "cost" ? (isActive ? 0.28 : 0.1) : isActive ? 1 : 0.25

  return {
    fill: `var(--color-${bucket})`,
    fillOpacity,
    stroke:
      isUnderwater && segment === "cost"
        ? "var(--color-destructive)"
        : undefined,
    strokeWidth: isUnderwater && segment === "cost" ? 1.5 : 0,
  }
}

function PortfolioWeightTooltip({
  active,
  baseCurrency,
  payload,
}: {
  active?: boolean
  baseCurrency: PortfolioWeightBucket
  payload?: Array<{ payload: PortfolioWeightChartDatum }>
}) {
  if (!active || !payload?.length) {
    return null
  }

  const datum = payload[0].payload

  return (
    <div className="grid min-w-48 gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-lg">
      <div className="grid gap-0.5">
        <span className="font-medium text-foreground">{datum.label}</span>
        {datum.subtitle ? (
          <span className="text-muted-foreground">{datum.subtitle}</span>
        ) : null}
        <span className="text-muted-foreground">
          {datum.bucket} bucket{datum.isActive ? "" : " · context only"}
        </span>
      </div>

      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Weight</span>
          <span className="tabular-nums">
            {formatPercent(datum.displayWeight)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Cost basis</span>
          <span className="tabular-nums">
            {formatMoney(datum.costBasis, datum.bucket)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Market value</span>
          <span className="tabular-nums">
            {formatMoney(datum.marketValue, datum.bucket)}
          </span>
        </div>
        {datum.convertedMarketValue !== null &&
        isConvertedAcrossFx({
          baseCurrency,
          bucket: datum.bucket,
        }) ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Converted value</span>
            <span className="tabular-nums">
              {formatMoney(datum.convertedMarketValue, baseCurrency)}
            </span>
          </div>
        ) : null}
        {datum.unrealizedAmount !== null ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Unrealized P/L</span>
            <span
              className="tabular-nums"
              style={{
                color:
                  datum.unrealizedAmount >= 0
                    ? "var(--color-foreground)"
                    : "var(--color-destructive)",
              }}
            >
              {formatMoney(datum.unrealizedAmount, baseCurrency)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const PortfolioWeightChart = memo(function PortfolioWeightChart({
  fxIssue,
  fxSnapshot,
  fxStatus,
  holdings,
}: {
  fxIssue: string | null
  fxSnapshot: FxRateSnapshot | null
  fxStatus: QuoteLikeStatus
  holdings: PortfolioWeightChartHolding[]
}) {
  const availableBuckets = useMemo(
    () =>
      [
        ...new Set(holdings.map((holding) => holding.bucket)),
      ].sort() as Array<PortfolioWeightBucket>,
    [holdings]
  )
  const [selectedBuckets, setSelectedBuckets] = useState<
    PortfolioWeightBucket[]
  >([])
  const effectiveSelectedBuckets = useMemo(() => {
    const nextBuckets = selectedBuckets.filter((bucket) =>
      availableBuckets.includes(bucket)
    )

    return nextBuckets.length > 0 ? nextBuckets : availableBuckets
  }, [availableBuckets, selectedBuckets])

  const summary = useMemo(
    () =>
      buildPortfolioWeightChartSummary({
        activeBuckets: effectiveSelectedBuckets,
        holdings: holdings.map((holding) => ({
          bucket: holding.bucket,
          costBasis: holding.costBasis,
          key: holding.key,
          marketValue: holding.marketValue,
        })),
        usdTwdRate: fxSnapshot?.rate ?? null,
      }),
    [effectiveSelectedBuckets, fxSnapshot?.rate, holdings]
  )

  const bars = useMemo(() => {
    const barsByKey = new Map(summary.bars.map((bar) => [bar.key, bar]))

    return holdings
      .map((holding) => {
        const bar = barsByKey.get(holding.key)

        if (
          !bar ||
          bar.displayWeight === null ||
          bar.costWeight === null ||
          bar.profitWeight === null
        ) {
          return null
        }

        return {
          ...holding,
          convertedMarketValue: bar.convertedMarketValue,
          costWeight: bar.costWeight,
          displayWeight: bar.displayWeight,
          isActive: bar.isActive,
          isUnderwater: bar.isUnderwater,
          profitWeight: bar.profitWeight,
          unrealizedAmount: bar.unrealizedAmount,
        }
      })
      .filter(
        (holding): holding is PortfolioWeightChartDatum => holding !== null
      )
      .sort((left, right) => {
        if (left.isActive !== right.isActive) {
          return left.isActive ? -1 : 1
        }

        if (right.displayWeight !== left.displayWeight) {
          return right.displayWeight - left.displayWeight
        }

        if (left.bucket !== right.bucket) {
          return left.bucket.localeCompare(right.bucket)
        }

        return left.label.localeCompare(right.label)
      })
  }, [holdings, summary.bars])

  if (holdings.length === 0) {
    return null
  }

  const chartHeight = Math.max(bars.length * 52, 260)
  const showFxContext = availableBuckets.length > 1

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h4 className="text-sm font-medium">Weight chart</h4>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Compare priced holdings by market value.
            {showFxContext
              ? ` Mixed selections normalize to ${summary.baseCurrency}.`
              : ""}
          </p>
        </div>

        {availableBuckets.length > 1 ? (
          <ToggleGroup
            className="border border-primary/15 bg-background/80 p-1"
            onValueChange={(nextBuckets) => {
              const nextSelection = nextBuckets as PortfolioWeightBucket[]

              if (nextSelection.length > 0) {
                setSelectedBuckets(nextSelection)
              }
            }}
            size="sm"
            type="multiple"
            value={effectiveSelectedBuckets}
            variant="outline"
          >
            {availableBuckets.map((bucket) => (
              <ToggleGroupItem key={bucket} value={bucket}>
                {bucket}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {availableBuckets.map((bucket) => (
          <BucketLegend bucket={bucket} key={bucket} />
        ))}
        <span>Faded = cost basis</span>
        <span>Solid = gain</span>
        <span>Red edge = below cost</span>
        {showFxContext && fxSnapshot ? (
          <span>USD/TWD {fxSnapshot.rate.toFixed(4)}</span>
        ) : null}
      </div>

      {showFxContext && fxIssue ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <p>{fxIssue}</p>
        </div>
      ) : null}

      {showFxContext && fxStatus === "loading" ? (
        <p className="text-xs text-muted-foreground">
          Loading the USD/TWD previous close
          {summary.needsFxRateForActive
            ? ` to normalize mixed-bucket weights into ${summary.baseCurrency}.`
            : "."}
        </p>
      ) : null}

      {bars.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-border/70 px-4 text-center text-sm text-muted-foreground">
          Weight bars appear after the selected buckets have priced holdings.
        </div>
      ) : (
        <ChartContainer
          className="aspect-auto min-h-[260px] w-full"
          config={chartConfig}
          style={{ height: `${chartHeight}px` }}
        >
          <BarChart
            accessibilityLayer
            data={bars}
            layout="vertical"
            margin={{ left: 0, right: 20, top: 8, bottom: 8 }}
          >
            <CartesianGrid horizontal={false} />
            <YAxis
              axisLine={false}
              dataKey="label"
              tickLine={false}
              tickMargin={10}
              type="category"
              width={80}
            />
            <XAxis
              axisLine={false}
              domain={[0, 1]}
              tickFormatter={(value) => formatPercent(Number(value))}
              tickLine={false}
              tickMargin={8}
              type="number"
            />
            <ChartTooltip
              content={
                <PortfolioWeightTooltip baseCurrency={summary.baseCurrency} />
              }
              cursor={false}
            />
            <Bar dataKey="costWeight" radius={[8, 0, 0, 8]} stackId="value">
              {bars.map((bar) => (
                <Cell
                  key={`${bar.key}-cost`}
                  {...getBucketSegmentStyle({
                    bucket: bar.bucket,
                    isActive: bar.isActive,
                    isUnderwater: bar.isUnderwater,
                    segment: "cost",
                  })}
                />
              ))}
            </Bar>
            <Bar dataKey="profitWeight" radius={[0, 8, 8, 0]} stackId="value">
              {bars.map((bar) => (
                <Cell
                  key={`${bar.key}-profit`}
                  {...getBucketSegmentStyle({
                    bucket: bar.bucket,
                    isActive: bar.isActive,
                    isUnderwater: false,
                    segment: "profit",
                  })}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </div>
  )
})

PortfolioWeightChart.displayName = "PortfolioWeightChart"
