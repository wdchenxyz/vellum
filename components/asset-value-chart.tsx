"use client"

import { memo } from "react"

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { Spinner } from "@/components/ui/spinner"
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

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
})

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

function formatTwd(value: number) {
  return twdFormatter.format(value)
}

function formatShortDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`)
  return shortDateFormatter.format(date)
}

function formatFullDate(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`)
  return fullDateFormatter.format(date)
}

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
  if (status === "idle") {
    return null
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-background/60 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Portfolio value</h3>
        <p className="text-xs text-muted-foreground">
          Daily total asset value in TWD
        </p>
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

      {status === "ready" && series.length > 0 ? (
        <ChartContainer
          className="aspect-auto h-[240px] w-full"
          config={chartConfig}
        >
          <AreaChart
            accessibilityLayer
            data={series}
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
              tickFormatter={formatShortDate}
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
    </div>
  )
})

AssetValueChart.displayName = "AssetValueChart"
