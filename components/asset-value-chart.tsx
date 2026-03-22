"use client"

import { memo, useMemo, useState } from "react"

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { BenchmarkSeries, DailyValuePoint } from "@/lib/portfolio/schema"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts"

// -----------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------

const chartConfig = {
  portfolio: {
    label: "Portfolio",
    color: "var(--chart-1)",
  },
  spx: {
    label: "S&P 500",
    color: "var(--chart-4)",
  },
  twii: {
    label: "TAIEX",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig

// -----------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------

const twdFormatter = new Intl.NumberFormat("en-US", {
  currency: "TWD",
  maximumFractionDigits: 0,
  style: "currency",
})

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

function formatTwd(value: number) {
  return twdFormatter.format(value)
}

function formatPercent(value: number) {
  const sign = value >= 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function formatTickDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date)
}

function formatFullDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`)
  return fullDateFormatter.format(date)
}

// -----------------------------------------------------------------------
// Time range
// -----------------------------------------------------------------------

type TimeRange = "7d" | "1m" | "6m" | "ytd" | "all"

const TIME_RANGE_OPTIONS: { label: string; value: TimeRange }[] = [
  { label: "7D", value: "7d" },
  { label: "1M", value: "1m" },
  { label: "6M", value: "6m" },
  { label: "YTD", value: "ytd" },
  { label: "All", value: "all" },
]

function getCutoffDate(range: TimeRange): string | null {
  if (range === "all") {
    return null
  }

  const now = new Date()

  if (range === "ytd") {
    return `${now.getFullYear()}-01-01`
  }

  const offsets: Record<string, number> = {
    "7d": 7,
    "1m": 30,
    "6m": 182,
  }

  const days = offsets[range] ?? 30
  now.setDate(now.getDate() - days)

  return now.toISOString().slice(0, 10)
}

function filterByRange<T extends { date: string }>(
  series: T[],
  range: TimeRange
): T[] {
  const cutoff = getCutoffDate(range)

  if (!cutoff) {
    return series
  }

  return series.filter((point) => point.date >= cutoff)
}

// -----------------------------------------------------------------------
// Chart data
// -----------------------------------------------------------------------

type ChartPoint = {
  date: string
  portfolio: number
  portfolioPct: number | null
  spx: number | null
  spxPct: number | null
  twii: number | null
  twiiPct: number | null
}

function pctChange(current: number, base: number): number | null {
  return base > 0 ? ((current - base) / base) * 100 : null
}

function buildChartData(
  portfolio: DailyValuePoint[],
  benchmarks: BenchmarkSeries
): ChartPoint[] {
  const spxByDate = new Map(benchmarks.spx.map((p) => [p.date, p.value]))
  const twiiByDate = new Map(benchmarks.twii.map((p) => [p.date, p.value]))

  const firstPortfolio = portfolio.length > 0 ? portfolio[0].value : null
  const firstSpx = benchmarks.spx.length > 0 ? benchmarks.spx[0].value : null
  const firstTwii = benchmarks.twii.length > 0 ? benchmarks.twii[0].value : null

  return portfolio.map((point) => {
    const spx = spxByDate.get(point.date) ?? null
    const twii = twiiByDate.get(point.date) ?? null

    return {
      date: point.date,
      portfolio: point.value,
      portfolioPct:
        firstPortfolio !== null ? pctChange(point.value, firstPortfolio) : null,
      spx,
      spxPct:
        spx !== null && firstSpx !== null ? pctChange(spx, firstSpx) : null,
      twii,
      twiiPct:
        twii !== null && firstTwii !== null ? pctChange(twii, firstTwii) : null,
    }
  })
}

// -----------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------

function getChangeColor(value: number) {
  return value >= 0 ? "var(--color-chart-3)" : "var(--color-destructive)"
}

function TooltipRow({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

function ChartPointTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartPoint }>
}) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0].payload

  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-lg">
      <span className="font-medium text-foreground">
        {formatFullDate(point.date)}
      </span>
      <TooltipRow
        color="var(--color-portfolio)"
        label="Portfolio"
        value={
          point.portfolioPct !== null
            ? `${formatTwd(point.portfolio)} (${formatPercent(point.portfolioPct)})`
            : formatTwd(point.portfolio)
        }
      />
      {point.spx !== null ? (
        <TooltipRow
          color="var(--color-spx)"
          label="S&P 500"
          value={
            point.spxPct !== null
              ? `${formatTwd(point.spx)} (${formatPercent(point.spxPct)})`
              : formatTwd(point.spx)
          }
        />
      ) : null}
      {point.twii !== null ? (
        <TooltipRow
          color="var(--color-twii)"
          label="TAIEX"
          value={
            point.twiiPct !== null
              ? `${formatTwd(point.twii)} (${formatPercent(point.twiiPct)})`
              : formatTwd(point.twii)
          }
        />
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------
// Main chart
// -----------------------------------------------------------------------

type AssetValueChartProps = {
  benchmarks: BenchmarkSeries
  costBasisTwd: number
  error: string | null
  series: DailyValuePoint[]
  status: "idle" | "loading" | "ready" | "error"
}

export const AssetValueChart = memo(function AssetValueChart({
  benchmarks,
  costBasisTwd,
  error,
  series,
  status,
}: AssetValueChartProps) {
  const [range, setRange] = useState<TimeRange>("all")

  const filteredSeries = useMemo(
    () => filterByRange(series, range),
    [series, range]
  )

  const filteredBenchmarks = useMemo(
    () => ({
      spx: filterByRange(benchmarks.spx, range),
      twii: filterByRange(benchmarks.twii, range),
    }),
    [benchmarks, range]
  )

  const chartData = useMemo(
    () => buildChartData(filteredSeries, filteredBenchmarks),
    [filteredSeries, filteredBenchmarks]
  )

  const tickInterval = useMemo(
    () => Math.max(Math.floor(chartData.length / 7) - 1, 0),
    [chartData.length]
  )

  const hasBenchmarks = benchmarks.spx.length > 0 || benchmarks.twii.length > 0

  const change = useMemo(() => {
    if (filteredSeries.length < 1) {
      return null
    }

    const last = filteredSeries[filteredSeries.length - 1].value

    // For "All" view, use cost basis (matches the total asset card).
    // For other views, use the first visible data point.
    const base =
      range === "all" && costBasisTwd > 0
        ? costBasisTwd
        : filteredSeries[0].value
    const amount = last - base
    const ratio = base > 0 ? amount / base : null

    return { amount, ratio }
  }, [filteredSeries, range, costBasisTwd])

  if (status === "idle") {
    return null
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Portfolio value</h3>
          {change ? (
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-medium tabular-nums"
                style={{ color: getChangeColor(change.amount) }}
              >
                {change.amount >= 0 ? "+" : ""}
                {formatTwd(change.amount)}
              </span>
              {change.ratio !== null ? (
                <span
                  className="text-xs tabular-nums"
                  style={{ color: getChangeColor(change.amount) }}
                >
                  ({formatPercent(change.ratio * 100)})
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Daily total asset value in TWD
            </p>
          )}
        </div>

        {status === "ready" && series.length > 0 ? (
          <ToggleGroup
            onValueChange={(value) => {
              if (value) {
                setRange(value as TimeRange)
              }
            }}
            size="sm"
            type="single"
            value={range}
            variant="outline"
          >
            {TIME_RANGE_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            Loading historical prices...
          </div>
        </div>
      ) : null}

      {status === "error" && error ? (
        <div className="flex min-h-[200px] items-center justify-center px-4 text-center text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {status === "ready" && series.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
          Not enough price data to chart.
        </div>
      ) : null}

      {status === "ready" && error ? (
        <p className="text-xs text-muted-foreground/80">{error}</p>
      ) : null}

      {status === "ready" && chartData.length > 0 ? (
        <>
          {hasBenchmarks ? (
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: chartConfig.portfolio.color }}
                />
                Portfolio
              </span>
              {benchmarks.spx.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: chartConfig.spx.color }}
                  />
                  S&P 500
                </span>
              ) : null}
              {benchmarks.twii.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: chartConfig.twii.color }}
                  />
                  TAIEX
                </span>
              ) : null}
            </div>
          ) : null}

          <ChartContainer
            className="aspect-auto h-[260px] w-full"
            config={chartConfig}
          >
            <ComposedChart
              accessibilityLayer
              data={chartData}
              margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
            >
              <defs>
                <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-portfolio)"
                    stopOpacity={0.15}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-portfolio)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                interval={tickInterval}
                tickFormatter={formatTickDate}
                tickLine={false}
                tickMargin={8}
              />
              <YAxis
                axisLine={false}
                domain={["auto", "auto"]}
                tickFormatter={(v) => formatTwd(Number(v))}
                tickLine={false}
                tickMargin={4}
                width={90}
              />
              <ChartTooltip
                content={<ChartPointTooltip />}
                cursor={{
                  stroke: "var(--color-border)",
                  strokeDasharray: "4 4",
                }}
              />
              <Area
                dataKey="portfolio"
                fill="url(#portfolioFill)"
                stroke="var(--color-portfolio)"
                strokeWidth={2}
                type="monotone"
              />
              {benchmarks.spx.length > 0 ? (
                <Line
                  dataKey="spx"
                  dot={false}
                  stroke="var(--color-spx)"
                  strokeDasharray="2 4"
                  strokeLinecap="round"
                  strokeWidth={2}
                  type="monotone"
                />
              ) : null}
              {benchmarks.twii.length > 0 ? (
                <Line
                  dataKey="twii"
                  dot={false}
                  stroke="var(--color-twii)"
                  strokeDasharray="2 4"
                  strokeLinecap="round"
                  strokeWidth={2}
                  type="monotone"
                />
              ) : null}
            </ComposedChart>
          </ChartContainer>
        </>
      ) : null}

      {status === "ready" &&
      filteredSeries.length === 0 &&
      series.length > 0 ? (
        <div className="flex min-h-[200px] items-center justify-center text-sm text-muted-foreground">
          No data in selected range.
        </div>
      ) : null}
    </div>
  )
})

AssetValueChart.displayName = "AssetValueChart"
