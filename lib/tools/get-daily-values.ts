import { tool } from "ai"
import { z } from "zod"

import { computeDailyValuesFromTrades } from "@/lib/portfolio/daily-values-service"
import { readStoredTradeRows } from "@/lib/trades/storage"

type ValuePoint = { date: string; value: number }

function filterPointsByDateRange(
  points: ValuePoint[],
  dateFrom?: string,
  dateTo?: string
) {
  return points.filter((point) => {
    if (dateFrom && point.date < dateFrom) {
      return false
    }

    if (dateTo && point.date > dateTo) {
      return false
    }

    return true
  })
}

function computeReturnPct(startValue: number | null, endValue: number | null) {
  if (!startValue || !endValue || startValue <= 0) {
    return null
  }

  return Number((((endValue - startValue) / startValue) * 100).toFixed(2))
}

function computeSeriesSummary(points: ValuePoint[]) {
  const startValue = points[0]?.value ?? null
  const endValue = points.at(-1)?.value ?? null

  return {
    startValue,
    endValue,
    returnPct: computeReturnPct(startValue, endValue),
  }
}

function computeMaxDrawdownPct(points: ValuePoint[]) {
  if (points.length <= 1) {
    return null
  }

  let peak = points[0].value
  let worstDrawdown = 0

  for (const point of points) {
    if (point.value > peak) {
      peak = point.value
    }

    const drawdown = peak > 0 ? ((peak - point.value) / peak) * 100 : 0

    if (drawdown > worstDrawdown) {
      worstDrawdown = drawdown
    }
  }

  return Number(worstDrawdown.toFixed(2))
}

export const getDailyValues = tool({
  description:
    "Get daily portfolio value time series (in TWD) along with cash-flow-adjusted S&P 500 and TAIEX benchmark series. Use this to analyze portfolio performance over time, compare against benchmarks, compute returns, drawdowns, and volatility. Supports optional date range filtering.",
  inputSchema: z.object({
    dateFrom: z
      .string()
      .optional()
      .describe("Start date inclusive (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("End date inclusive (YYYY-MM-DD)"),
  }),
  execute: async ({ dateFrom, dateTo }) => {
    const trades = await readStoredTradeRows()
    const result = await computeDailyValuesFromTrades(trades)

    const series = filterPointsByDateRange(result.series, dateFrom, dateTo)
    const spx = filterPointsByDateRange(result.benchmarks.spx, dateFrom, dateTo)
    const twii = filterPointsByDateRange(
      result.benchmarks.twii,
      dateFrom,
      dateTo
    )
    const portfolioSummary = computeSeriesSummary(series)
    const spxSummary = computeSeriesSummary(spx)
    const twiiSummary = computeSeriesSummary(twii)

    return {
      costBasisTwd: result.costBasisTwd,
      issues: result.issues,
      dateRange: {
        from: series[0]?.date ?? null,
        to: series.at(-1)?.date ?? null,
        dataPoints: series.length,
      },
      portfolio: {
        series,
        ...portfolioSummary,
        maxDrawdownPct: computeMaxDrawdownPct(series),
      },
      benchmarks: {
        spx: {
          series: spx,
          ...spxSummary,
        },
        twii: {
          series: twii,
          ...twiiSummary,
        },
      },
    }
  },
})
