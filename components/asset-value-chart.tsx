"use client"

import { memo, useMemo, useState } from "react"

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { DailyValuePoint } from "@/lib/portfolio/schema"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

const chartConfig = {
  value: {
    label: "Asset value",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig

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

function filterSeries(
  series: DailyValuePoint[],
  range: TimeRange
): DailyValuePoint[] {
  const cutoff = getCutoffDate(range)

  if (!cutoff) {
    return series
  }

  return series.filter((point) => point.date >= cutoff)
}

// -----------------------------------------------------------------------
// Components
// -----------------------------------------------------------------------

function AssetValueTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: DailyValuePoint }>
}) {
  if (!active || !payload?.length) {
    return null
  }

  const point = payload[0].payload

  return (
    <div className="grid gap-1 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-lg">
      <span className="font-medium text-foreground">
        {formatFullDate(point.date)}
      </span>
      <span className="text-foreground tabular-nums">
        {formatTwd(point.value)}
      </span>
    </div>
  )
}

type AssetValueChartProps = {
  error: string | null
  series: DailyValuePoint[]
  status: "idle" | "loading" | "ready" | "error"
}

export const AssetValueChart = memo(function AssetValueChart({
  error,
  series,
  status,
}: AssetValueChartProps) {
  const [range, setRange] = useState<TimeRange>("all")

  const filteredSeries = useMemo(
    () => filterSeries(series, range),
    [series, range]
  )

  const tickInterval = useMemo(
    () => Math.max(Math.floor(filteredSeries.length / 7) - 1, 0),
    [filteredSeries.length]
  )

  const change = useMemo(() => {
    if (filteredSeries.length < 2) {
      return null
    }

    const first = filteredSeries[0].value
    const last = filteredSeries[filteredSeries.length - 1].value
    const amount = last - first
    const ratio = first > 0 ? amount / first : null

    return { amount, ratio }
  }, [filteredSeries])

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
                style={{
                  color:
                    change.amount >= 0
                      ? "var(--color-chart-3)"
                      : "var(--color-destructive)",
                }}
              >
                {change.amount >= 0 ? "+" : ""}
                {formatTwd(change.amount)}
              </span>
              {change.ratio !== null ? (
                <span
                  className="text-xs tabular-nums"
                  style={{
                    color:
                      change.amount >= 0
                        ? "var(--color-chart-3)"
                        : "var(--color-destructive)",
                  }}
                >
                  ({change.amount >= 0 ? "+" : ""}
                  {(change.ratio * 100).toFixed(2)}%)
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

      {status === "ready" && filteredSeries.length > 0 ? (
        <ChartContainer
          className="aspect-auto h-[240px] w-full"
          config={chartConfig}
        >
          <AreaChart
            accessibilityLayer
            data={filteredSeries}
            margin={{ left: 0, right: 12, top: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="assetFill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-value)"
                  stopOpacity={0.2}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-value)"
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
              content={<AssetValueTooltip />}
              cursor={{ stroke: "var(--color-border)", strokeDasharray: "4 4" }}
            />
            <Area
              dataKey="value"
              fill="url(#assetFill)"
              stroke="var(--color-value)"
              strokeWidth={2}
              type="monotone"
            />
          </AreaChart>
        </ChartContainer>
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
