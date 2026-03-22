import { tool } from "ai"
import { z } from "zod"

import { computeDailyValuesFromTrades } from "@/lib/portfolio/daily-values-service"
import { readStoredTradeRows } from "@/lib/trades/storage"

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

    function filterByDateRange(points: { date: string; value: number }[]) {
      return points.filter((p) => {
        if (dateFrom && p.date < dateFrom) return false
        if (dateTo && p.date > dateTo) return false
        return true
      })
    }

    const series = filterByDateRange(result.series)
    const spx = filterByDateRange(result.benchmarks.spx)
    const twii = filterByDateRange(result.benchmarks.twii)

    // Compute summary stats for the filtered range.
    const startValue = series.length > 0 ? series[0].value : null
    const endValue = series.length > 0 ? series[series.length - 1].value : null
    const portfolioReturn =
      startValue && endValue && startValue > 0
        ? Number((((endValue - startValue) / startValue) * 100).toFixed(2))
        : null

    const spxStart = spx.length > 0 ? spx[0].value : null
    const spxEnd = spx.length > 0 ? spx[spx.length - 1].value : null
    const spxReturn =
      spxStart && spxEnd && spxStart > 0
        ? Number((((spxEnd - spxStart) / spxStart) * 100).toFixed(2))
        : null

    const twiiStart = twii.length > 0 ? twii[0].value : null
    const twiiEnd = twii.length > 0 ? twii[twii.length - 1].value : null
    const twiiReturn =
      twiiStart && twiiEnd && twiiStart > 0
        ? Number((((twiiEnd - twiiStart) / twiiStart) * 100).toFixed(2))
        : null

    // Compute max drawdown from the portfolio series.
    let maxDrawdown: number | null = null

    if (series.length > 1) {
      let peak = series[0].value
      let worstDrawdown = 0

      for (const point of series) {
        if (point.value > peak) {
          peak = point.value
        }

        const drawdown = peak > 0 ? ((peak - point.value) / peak) * 100 : 0

        if (drawdown > worstDrawdown) {
          worstDrawdown = drawdown
        }
      }

      maxDrawdown = Number(worstDrawdown.toFixed(2))
    }

    return {
      costBasisTwd: result.costBasisTwd,
      issues: result.issues,
      dateRange: {
        from: series.length > 0 ? series[0].date : null,
        to: series.length > 0 ? series[series.length - 1].date : null,
        dataPoints: series.length,
      },
      portfolio: {
        series,
        startValue,
        endValue,
        returnPct: portfolioReturn,
        maxDrawdownPct: maxDrawdown,
      },
      benchmarks: {
        spx: {
          series: spx,
          startValue: spxStart,
          endValue: spxEnd,
          returnPct: spxReturn,
        },
        twii: {
          series: twii,
          startValue: twiiStart,
          endValue: twiiEnd,
          returnPct: twiiReturn,
        },
      },
    }
  },
})
